// Launch Radar value model and farm planner. ONE file, run by both sides:
//   - main.ts loads this exact file to write /output/board.json (ranks, implied values, farm_steps);
//   - the page loads it to score the same snapshot again in the browser and checks it against board.json.
// Nothing here names a protocol. Every number is derived from the snapshot's own figures:
//   1. FIT    The protocols whose token already trades are the calibration set, one point per token
//             (records sharing a ticker, e.g. a protocol's V2 and V3, pool their TVL). An OLS fit of log10(mcap) on log10(TVL) gives the market's own price of TVL (a, b, R^2, residual sd).
//   2. CLASS  Each category's median residual, shrunk toward 0 by n/(n+K), adjusts the fitted multiple.
//   3. TREND  7-day TVL change, clamped to +/-25%, is compounded over two more weeks: TVL_eff.
//   4. TIME   Days listed with no token: TVL held without a token is organic, so retention
//             r = R0 + (1 - R0)(1 - e^(-days/365)) haircuts young, points-driven TVL.
//   implied = 10^(a + b log10 TVL_eff + class) x r, to 3 significant figures.
(function (root) {
  'use strict';

  var P = {
    trend_clamp: 25, // per cent a week
    trend_weeks: 2,
    shrink_k: 5,
    class_clamp: 0.6, // log10 units
    retention_floor: 0.55,
    retention_days: 365,
    airdrop_share: 0.3, // airdrop as a share of the launch market cap (it is a large part of the first float)
    season_days: 365, // the drop is earned pro rata to capital x days over a one-year points season
    cash_yield: 0.045, // what the farm capital would earn idle in T-bills: the opportunity cost
  };
  // Products of tokens that already trade, and exchange wallets: never a launch of their own.
  var DERIVED = ['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC'];
  var VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
  var WRAPPED = /\b(wrapped|staked|staking)\b/i;
  var EXCHANGE = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
  var DAY = 86400000;

  // Gas in USD per transaction, and the wallet to use, by chain. Unknown chains fall back to an L2 guess.
  var GAS = { Ethereum: 2.5, Bitcoin: 1.5, Tron: 1.2, Binance: 0.06, Arbitrum: 0.04, Base: 0.03, Optimism: 0.03,
    Ink: 0.02, Monad: 0.02, Plasma: 0.02, Berachain: 0.03, Avalanche: 0.05, Polygon: 0.02, Sonic: 0.02, Linea: 0.04,
    Solana: 0.01, Sui: 0.01, Aptos: 0.01, Algorand: 0.001, Stellar: 0.001, Ripple: 0.001, Flare: 0.01, Hyperliquid: 0.02,
    'Hyperliquid L1': 0.02, Mantle: 0.03, Scroll: 0.04, Unichain: 0.02, Katana: 0.02, Plume: 0.02, 'Plume Mainnet': 0.02 };
  var WALLET = { Solana: 'Phantom', Bitcoin: 'Xverse', Babylon: 'Keplr', 'Babylon Genesis': 'Keplr', Noble: 'Keplr', Tron: 'TronLink', Sui: 'Slush',
    Aptos: 'Petra', Algorand: 'Pera', Stellar: 'Freighter', Ripple: 'Xaman', Bittensor: 'Talisman', Ton: 'Tonkeeper' };

  // DefiLlama's chain names, as a farmer finds them in a wallet.
  var LABEL = { Binance: 'BNB Chain', Ripple: 'XRP Ledger', 'Plume Mainnet': 'Plume', 'Hyperliquid L1': 'Hyperliquid' };
  function label(c) { return LABEL[c] || c; }
  function gasOf(chain) { return GAS[chain] !== undefined ? GAS[chain] : 0.1; }
  function walletOf(chain) { return WALLET[chain] || 'Rabby (or any EVM)'; }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function sig3(v) { if (!(v > 0)) return 1; var e = Math.pow(10, Math.max(0, Math.floor(Math.log10(v)) - 2)); return Math.max(1, Math.round(v / e) * e); }
  function median(xs) { var s = xs.slice().sort(function (p, q) { return p - q; }); var n = s.length; return n === 0 ? 0 : n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; }
  function hasToken(p) { return p.gecko_id !== null || p.symbol !== null || p.mcap_usd !== null; }
  function ageDays(asOf, listed) { if (!listed) return null; return Math.max(0, Math.floor((Date.parse(asOf + 'T00:00:00Z') - Date.parse(listed + 'T00:00:00Z')) / DAY)); }

  function usd(n) {
    var a = Math.abs(n), s = n < 0 ? '-$' : '$';
    if (a >= 1e9) return s + (a / 1e9).toFixed(a >= 1e10 ? 1 : 2) + 'B';
    if (a >= 1e6) return s + (a / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M';
    if (a >= 1e4) return s + Math.round(a / 1e3) + 'K';
    if (a >= 100) return s + Math.round(a).toLocaleString('en-US');
    if (a >= 1) return s + a.toFixed(2).replace(/\.00$/, '');
    return a > 0 && a < 0.01 ? '<' + s + '0.01' : s + a.toFixed(2);
  }

  // 1. FIT: least squares of log10(mcap) on log10(TVL) over the snapshot's traded tokens.
  function fitMarket(protocols) {
    // One point per token, keyed by CoinGecko id. A record with a ticker but no id (Aave V3 beside
    // Aave V2's id) joins the id whose ticker it shares, only when exactly one id carries that ticker.
    var tokens = {}, all = [], bySym = {};
    var usable = protocols.filter(function (p) { return hasToken(p) && p.tvl_usd > 0 && DERIVED.indexOf(p.category) < 0; });
    usable.forEach(function (p) { if (p.gecko_id && p.symbol) { var k = p.symbol.toUpperCase(); (bySym[k] = bySym[k] || {})[p.gecko_id] = true; } });
    usable.forEach(function (p) {
      var ids = p.symbol ? Object.keys(bySym[p.symbol.toUpperCase()] || {}) : [];
      var id = p.gecko_id ? 'g:' + p.gecko_id : ids.length === 1 ? 'g:' + ids[0] : 's:' + (p.symbol || p.slug).toUpperCase(), t = tokens[id];
      if (!t) { t = tokens[id] = { slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: 0, mcap_usd: 0, symbol: p.symbol, top: 0, members: 0 }; all.push(t); }
      t.tvl_usd += p.tvl_usd; t.members += 1; t.mcap_usd = Math.max(t.mcap_usd, p.mcap_usd || 0);
      if (p.tvl_usd > t.top) { t.top = p.tvl_usd; t.slug = p.slug; t.name = p.name.replace(VERSIONED, ''); t.category = p.category; t.chains = p.chains; }
    });
    var set = all.filter(function (t) { return t.mcap_usd > 0; });
    var xs = set.map(function (p) { return Math.log10(p.tvl_usd); }), ys = set.map(function (p) { return Math.log10(p.mcap_usd); });
    var n = set.length, mx = 0, my = 0, sxy = 0, sxx = 0, syy = 0, i;
    for (i = 0; i < n; i++) { mx += xs[i] / n; my += ys[i] / n; }
    for (i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) * (xs[i] - mx); syy += (ys[i] - my) * (ys[i] - my); }
    var b = sxy / sxx, a = my - b * mx, byCat = {}, sse = 0;
    var live = set.map(function (p, k) {
      var r = ys[k] - (a + b * xs[k]); sse += r * r;
      var c = p.category || 'Uncategorised'; (byCat[c] = byCat[c] || []).push(r);
      return { slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, symbol: p.symbol, members: p.members, fitted_usd: Math.round(Math.pow(10, a + b * xs[k])), resid: r };
    });
    // 2. CLASS: a category's median residual, shrunk toward zero when few of its tokens trade.
    var classes = {};
    Object.keys(byCat).forEach(function (c) {
      var m = byCat[c].length;
      classes[c] = { n: m, median: median(byCat[c]), adj: clamp(median(byCat[c]) * m / (m + P.shrink_k), -P.class_clamp, P.class_clamp) };
    });
    return { a: a, b: b, n: n, r2: (sxy * sxy) / (sxx * syy), sd: Math.sqrt(sse / (n - 2)), classes: classes, live: live };
  }

  // Why a pre-token record is not a launch of its own, or null when the radar ranks it.
  function exclusion(p, onWatch) {
    if (onWatch) return null;
    if (DERIVED.indexOf(p.category) >= 0) return p.category;
    if (VERSIONED.test(p.name)) return 'Versioned deployment';
    if (WRAPPED.test(p.name)) return 'Wrapped or staked product';
    if (EXCHANGE.test(p.name)) return 'Exchange product';
    return null;
  }

  // 3 + 4: one protocol's implied value, with each factor kept so the page can show the waterfall.
  function value(p, fit, asOf, unknownAge) {
    var g = p.change_7d === null ? 0 : clamp(p.change_7d, -P.trend_clamp, P.trend_clamp);
    var trend = Math.pow(1 + g / 100, P.trend_weeks), tvlEff = p.tvl_usd * trend;
    var base = Math.pow(10, fit.a + fit.b * Math.log10(p.tvl_usd));
    var trended = Math.pow(10, fit.a + fit.b * Math.log10(tvlEff));
    var cls = fit.classes[p.category || 'Uncategorised'], adj = cls ? cls.adj : 0;
    var classed = trended * Math.pow(10, adj);
    var age = ageDays(asOf, p.listed_at), days = age === null ? unknownAge : age;
    var retention = P.retention_floor + (1 - P.retention_floor) * (1 - Math.exp(-days / P.retention_days));
    var implied = sig3(classed * retention);
    // The fit's own spread: one residual sd either side is the range a reader should hold the value to.
    return { low: sig3(implied / Math.pow(10, fit.sd)), high: sig3(implied * Math.pow(10, fit.sd)), base: base, trended: trended, classed: classed, implied: implied, growth_pct: g, trend: trend, class_adj: adj, class_n: cls ? cls.n : 0, age_days: age, age_used: days, retention: retention };
  }

  // Age bands: how long DefiLlama has tracked it with no token recorded. Not a launch probability.
  var BANDS = ['Under 6 months', '6 months to 2 years', 'Over 2 years', 'Age unknown'];
  function windowOf(age) { return age === null ? BANDS[3] : age < 180 ? BANDS[0] : age < 730 ? BANDS[1] : BANDS[2]; }

  // What to do with the money, by category: the verb a farmer follows on the protocol's own app.
  function actionOf(p, cap, chain) {
    var c = (p.category || '').toLowerCase(), n = p.name, $ = usd(cap);
    if (/curator|allocator|aggregator/.test(c)) return { act: 'Deposit ' + $ + ' USDC into the largest USDC vault ' + n + ' runs on ' + chain + ', picked from the vault list in its own app', touch: 'claim any vault rewards and re-deposit them', tx: 1 };
    if (/basis|yield|cedefi/.test(c)) return { act: 'Deposit ' + $ + ' USDC into ' + n + "'s flagship yield or delta-neutral vault on " + chain + ' and keep the receipt token in the wallet', touch: 'compound or re-stake the receipt token', tx: 1 };
    if (/lend|cdp|collateral/.test(c)) return { act: 'Supply ' + $ + ' USDC to ' + n + ' on ' + chain + ', then borrow 25% of it in a stablecoin and supply that back (health factor above 2)', touch: 'repay and re-borrow $50', tx: 2 };
    if (/dex|liquidity/.test(c)) return { act: 'Provide ' + $ + ' to ' + n + "'s deepest stablecoin pool on " + chain + ' (full range, so it never leaves range)', touch: 'make two swaps of about $50 through the pool', tx: 2 };
    if (/deriv|options|perp|prediction/.test(c)) return { act: (/prediction/.test(c) ? 'Fund ' + $ + ' USDC on ' + n + ' and buy both outcomes of one liquid market, so the position is close to neutral' : 'Deposit ' + $ + ' USDC as margin on ' + n + ' and open a hedged position: equal long and short at under 2x'), touch: 'close and reopen one position to log volume', tx: 2 };
    if (/rwa/.test(c)) return { act: 'Pass ' + n + "'s KYC if it asks, then subscribe " + $ + ' USDC into its tokenised yield product on ' + chain, touch: '', tx: 0 };
    if (/restak|staking|chain|dtao/.test(c)) return { act: 'Stake ' + $ + " of the chain's native asset through " + n + ' on ' + chain + ' with its default validator or pool', touch: 'claim and restake the staking rewards', tx: 1 };
    if (/stable/.test(c)) return { act: 'Mint or swap into ' + $ + ' of ' + n + "'s stablecoin on " + chain + ' and deposit it in its savings or earn module', touch: 'compound the savings yield', tx: 1 };
    if (/payment/.test(c)) return { act: 'Open a ' + $ + ' channel or account on ' + n + ' and route a few payments through it', touch: 'send one small payment', tx: 1 };
    if (/insurance/.test(c)) return { act: 'Deposit ' + $ + ' USDC into ' + n + "'s cover or underwriting pool on " + chain, touch: 'claim pool rewards', tx: 1 };
    if (/governance|incentive/.test(c)) return { act: 'Deposit ' + $ + ' into ' + n + "'s incentive gauge on " + chain + ' and vote its emissions toward your pool', touch: 'cast the weekly vote', tx: 1 };
    return { act: 'Deposit ' + $ + ' USDC into ' + n + "'s main product on " + chain, touch: 'make one deposit or claim', tx: 1 };
  }

  // A protocol's farm plan: seven steps, each with its dollar cost and its time. The totals are summed
  // from the steps themselves, so the plan and its summary cannot disagree.
  function farmPlan(p, v, implied) {
    var ranked = p.chains.map(function (c, i) { return { c: c, g: gasOf(c), i: i }; });
    ranked.sort(function (x, y) { return x.g - y.g || x.i - y.i; });
    var chain = ranked.length ? label(ranked[0].c) : 'its main chain', gas = ranked.length ? ranked[0].g : 0.1;
    var cap = gas >= 1 ? 2500 : 1000; // mainnet gas eats a small position
    var age = v.age_days, days = age === null ? 60 : age < 180 ? 90 : age < 730 ? 60 : 45, weeks = Math.round(days / 7);
    var kyc = /rwa/i.test(p.category || '');
    var a = actionOf(p, cap, chain);
    var fund = cap * 0.001 + gas, deposit = gas * 2, weekly = gas * a.tx * weeks, exit = gas * 2;
    var opp = cap * P.cash_yield * days / 365;
    var per1k = implied * P.airdrop_share * (days / P.season_days) * 1000 / p.tvl_usd, drop = per1k * cap / 1000;
    var cash = fund + deposit + weekly + exit, costs = cash + opp;
    var why = ranked.length > 1 ? ' (lowest modelled gas of the ' + ranked.length + ' chains it lists)' : '';
    var steps = [
      { act: 'Set up a fresh ' + walletOf(chain) + ' wallet used only for this farm on ' + chain + why + ', seed phrase written on paper', cost: '$0', time: '10 min', min: 10 },
      { act: 'Move ' + usd(cap) + ' onto ' + chain + ' from an exchange or a bridge, plus a little of the gas token', cost: usd(fund) + ' (0.1% route fee + gas)', time: '20 min', min: 20 },
      { act: a.act, cost: usd(deposit) + ' gas (approve + deposit); ' + usd(cap) + ' of capital at risk', time: kyc ? '1-3 days for KYC, then 15 min' : '15 min', min: 15 },
      { act: a.tx ? 'Once a week, ' + a.touch + ', so the wallet shows activity in every weekly points snapshot' : 'Once a week, check that the balance accrues; a held deposit is what earns points here, so no transaction is needed', cost: a.tx ? usd(weekly) + ' gas (' + a.tx * weeks + ' transactions over ' + weeks + ' weeks)' : '$0', time: '5 min a week, ' + weeks * 5 + ' min in all', min: weeks * 5 },
      { act: 'Hold for ' + days + ' days. If it runs a points or airdrop program, the modelled drop is ' + usd(drop) + ' = ' + P.airdrop_share * 100 + '% of ' + usd(implied) + ' x ' + usd(cap) + '/' + usd(p.tvl_usd) + ' of TVL x ' + days + '/' + P.season_days + ' days', cost: usd(opp) + ' of forgone T-bill yield at 4.5%', time: days + ' days', min: 0 },
      { act: "Check for a points or rewards page linked from " + p.name + "'s own site, and track your balance there; never sign an approval sent by DM or a lookalike claim site", cost: '$0', time: '10 min', min: 10 },
      { act: 'Exit rule: on day ' + days + ', or earlier if 7-day TVL falls more than 25%, withdraw unless points are still accruing; if a token launches, claim it and sell ' + usd(costs) + ' of it to cover the plan', cost: usd(exit) + ' gas to withdraw or claim', time: '15 min', min: 15 },
    ];
    var mins = steps.reduce(function (t, x) { return t + x.min; }, 0);
    return { chain: chain, capital: cap, days: days, cash_cost: cash, opp_cost: opp, hands_on_min: mins, drop_usd: drop, per_1k: per1k, edge: drop / costs, steps: steps };
  }

  // The whole radar from one snapshot: the fit, the ranked pre-token board, the traded set kept apart.
  function build(snap) {
    var fit = fitMarket(snap.protocols);
    var watch = {}; snap.watchlist.forEach(function (s) { watch[s] = true; });
    var excluded = {}, cands = [];
    snap.protocols.forEach(function (p) {
      if (hasToken(p) && !watch[p.slug]) return;
      var why = exclusion(p, watch[p.slug]);
      if (why) { excluded[why] = (excluded[why] || 0) + 1; return; }
      cands.push(p);
    });
    var ages = cands.map(function (p) { return ageDays(snap.as_of, p.listed_at); }).filter(function (d) { return d !== null; });
    var unknownAge = Math.round(median(ages));
    var rows = cands.map(function (p) {
      var v = value(p, fit, snap.as_of, unknownAge);
      var set = watch[p.slug] ? 'watchlist' : p.tvl_usd < snap.floor_usd ? 'early' : 'off-list';
      return { slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, change_7d: p.change_7d, listed_at: p.listed_at, set: set, window: windowOf(v.age_days), v: v, implied: v.implied, plan: farmPlan(p, v, v.implied) };
    });
    rows.sort(function (x, y) { return y.implied - x.implied || y.tvl_usd - x.tvl_usd || (x.slug < y.slug ? -1 : 1); });
    rows.forEach(function (r, i) { r.rank = i + 1; });
    return { as_of: snap.as_of, source: snap.source, floor_usd: snap.floor_usd, params: P, fit: fit, unknown_age: unknownAge, rows: rows, excluded: excluded, watchlist_size: snap.watchlist.length };
  }

  function stepText(s) { return s.act + '. Cost: ' + s.cost + '. Time: ' + s.time + '.'; }

  root.RadarModel = { build: build, stepText: stepText, usd: usd, params: P, bands: BANDS };
})(typeof window !== 'undefined' ? window : globalThis);
