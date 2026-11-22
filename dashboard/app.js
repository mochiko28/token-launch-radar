// Launch Radar page. It re-runs dashboard/model.js on the snapshot in ../data.js (written by main.ts),
// checks every rank and implied value against the board.json digest, then renders three views:
// the pre-token board (filter, sort), one protocol's detail (value waterfall + farm plan), and the
// traded tokens the model is fitted on. All state lives in the URL hash, so every view is linkable.
(function () {
  'use strict';
  var M = window.RadarModel, S = window.SNAPSHOT, B = window.BOARD || [];
  var app = document.getElementById('app'), tip = document.getElementById('tip');
  if (!M || !S) { app.textContent = 'data.js is missing: run main.ts first.'; return; }
  var R = M.build(S), usd = M.usd, rows = R.rows, fit = R.fit;
  var bySlug = {}; rows.forEach(function (r) { bySlug[r.slug] = r; });

  // board.json and the page agree row for row, or the header says where they part.
  var agree = B.length === rows.length && B.every(function (d) { var r = bySlug[d[0]]; return r && r.rank === d[1] && r.implied === d[2]; });

  var state = { view: 'board', p: rows[0].slug, q: '', set: 'all', cat: 'all', chain: 'all', win: 'all', min: 0, sort: 'rank', dir: 1 };
  var COLS = [
    { k: 'rank', l: '#', n: true, f: function (r) { return r.rank; } },
    { k: 'name', l: 'Protocol', f: function (r) { return r.name.toLowerCase(); } },
    { k: 'tvl', l: 'TVL', n: true, f: function (r) { return r.tvl_usd; } },
    { k: 'g7', l: '7d', n: true, f: function (r) { return r.change_7d === null ? -1e9 : r.change_7d; } },
    { k: 'age', l: 'No token for', n: true, f: function (r) { return r.v.age_days === null ? -1 : r.v.age_days; } },
    { k: 'implied', l: 'Implied value', n: true, f: function (r) { return r.implied; } },
    { k: 'mult', l: '×TVL', n: true, f: function (r) { return r.implied / r.tvl_usd; } },
    { k: 'per1k', l: 'Drop/$1k', n: true, f: function (r) { return r.plan.per_1k; } },
    { k: 'cost', l: 'Plan cost', n: true, f: function (r) { return r.plan.cash_cost + r.plan.opp_cost; } },
    { k: 'edge', l: 'Edge', n: true, f: function (r) { return r.plan.edge; } },
  ];

  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) e.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c !== null && c !== undefined) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  // Edge as a status: text and glyph, never colour alone.
  function edge(e) { var c = e >= 1.5 ? 'good' : e >= 1 ? 'ok' : 'weak'; return h('span', { class: 'edge ' + c, text: (c === 'good' ? '▲ ' : c === 'ok' ? '■ ' : '▽ ') + e.toFixed(e < 10 ? 2 : 1) + '×' }); }
  function tick(v) { return v >= 1e9 ? '$' + v / 1e9 + 'B' : '$' + v / 1e6 + 'M'; }
  function pct(v) { return v === null ? 'n/a' : (v > 0 ? '+' : '') + v.toFixed(1) + '%'; }
  function trend(v) { return h('span', { class: v === null ? 'note' : v >= 0 ? 'up' : 'down', text: (v === null ? '' : v >= 0 ? '▲ ' : '▼ ') + pct(v) }); }
  function age(d) { return d === null ? 'unknown' : d >= 365 ? (d / 365).toFixed(1) + ' yr' : d + ' d'; }
  function mins(m) { return m >= 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : m + ' min'; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // ---- URL hash <-> state ----
  function readHash() {
    location.hash.replace(/^#/, '').split('&').forEach(function (kv) {
      var p = kv.split('='); if (!p[0] || !(p[0] in state)) return;
      var v = decodeURIComponent(p[1] || ''); state[p[0]] = typeof state[p[0]] === 'number' ? Number(v) || 0 : v;
    });
    if (!bySlug[state.p]) state.p = rows[0].slug;
  }
  function go(patch) { for (var k in patch) state[k] = patch[k]; var o = []; for (var k2 in state) o.push(k2 + '=' + encodeURIComponent(state[k2])); history.replaceState(null, '', '#' + o.join('&')); render(); }

  // ---- filters ----
  var cats = uniq(rows.map(function (r) { return r.category || 'Uncategorised'; }));
  var chains = uniq([].concat.apply([], rows.map(function (r) { return r.chains; })));
  function uniq(a) { var s = {}; a.forEach(function (x) { s[x] = (s[x] || 0) + 1; }); return Object.keys(s).sort(function (x, y) { return s[y] - s[x] || (x < y ? -1 : 1); }); }
  function visible() {
    var q = state.q.toLowerCase();
    var out = rows.filter(function (r) {
      return (state.set === 'all' || r.set === state.set) && (state.cat === 'all' || (r.category || 'Uncategorised') === state.cat) &&
        (state.chain === 'all' || r.chains.indexOf(state.chain) >= 0) && (state.win === 'all' || r.window === state.win) &&
        r.tvl_usd >= state.min && (!q || (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) >= 0);
    });
    var col = COLS.filter(function (c) { return c.k === state.sort; })[0] || COLS[0];
    out.sort(function (a, b) { var x = col.f(a), y = col.f(b); return (x < y ? -1 : x > y ? 1 : a.rank - b.rank) * state.dir; });
    return out;
  }

  // ---- header, tabs, KPIs ----
  function chrome() {
    var meta = document.getElementById('meta'); meta.innerHTML = '';
    meta.appendChild(h('span', { class: 'chip', text: 'Snapshot ' + R.as_of + ' · DefiLlama' }));
    meta.appendChild(h('span', { class: 'chip ' + (agree ? 'ok' : 'bad'), title: 'The page re-scores the snapshot with model.js and compares every rank and value with board.json',
      text: agree ? '✓ ' + rows.length + '/' + B.length + ' rows match board.json' : '✗ page and board.json differ' }));
    var tabs = document.getElementById('tabs'); tabs.innerHTML = '';
    [['board', 'Pre-token board', rows.length], ['detail', 'Protocol detail', null], ['traded', 'Already trading', fit.n], ['method', 'Method', null]].forEach(function (t) {
      tabs.appendChild(h('button', { 'aria-selected': String(state.view === t[0]), onclick: function () { go({ view: t[0] }); } }, [t[1], t[2] !== null ? h('span', { class: 'count', text: String(t[2]) }) : null]));
    });
    var watched = rows.filter(function (r) { return r.set === 'watchlist'; }).length;
    var early = rows.filter(function (r) { return r.set !== 'watchlist'; }).length;
    var total = rows.reduce(function (s, r) { return s + r.implied; }, 0);
    var exN = Object.keys(R.excluded).reduce(function (s, k) { return s + R.excluded[k]; }, 0);
    var k = document.getElementById('kpis'); k.innerHTML = ''; k.hidden = state.view === 'detail';
    [[rows.length, 'pre-token protocols ranked'], [watched + ' / ' + R.watchlist_size, 'watchlist covered'], [early, 'found off the watchlist'],
     [usd(total), 'total implied value'], ['TVL^' + fit.b.toFixed(2), 'market fit, n=' + fit.n + ', R² ' + fit.r2.toFixed(2)], [exN, 'token products set aside']].forEach(function (x) {
      k.appendChild(h('div', { class: 'kpi' }, [h('b', { text: String(x[0]) }), h('span', { text: x[1] })]));
    });
  }

  // ---- the fit chart: traded tokens (dots), the fit line, and the pre-token board (rings) ----
  function scatter(sel, height, width, shown) {
    var W = width || 360, H = height || 260, L = 44, T = 10, Rr = 10, Bt = 26;
    var x0 = 6.6, x1 = 10.6, y0 = 5.5, y1 = 11;
    function X(v) { return L + (Math.log10(v) - x0) / (x1 - x0) * (W - L - Rr); }
    function Y(v) { return T + (1 - (Math.log10(v) - y0) / (y1 - y0)) * (H - T - Bt); }
    var s = '<g class="grid">';
    [1e7, 1e8, 1e9, 1e10].forEach(function (v) { s += '<line x1="' + X(v) + '" x2="' + X(v) + '" y1="' + T + '" y2="' + (H - Bt) + '"/><text x="' + X(v) + '" y="' + (H - 8) + '" text-anchor="middle">' + tick(v) + '</text>'; });
    [1e6, 1e7, 1e8, 1e9, 1e10].forEach(function (v) { s += '<line x1="' + L + '" x2="' + (W - Rr) + '" y1="' + Y(v) + '" y2="' + Y(v) + '"/><text x="' + (L - 6) + '" y="' + (Y(v) + 3) + '" text-anchor="end">' + tick(v) + '</text>'; });
    s += '</g>';
    var la = Math.pow(10, x0), lb = Math.pow(10, x1);
    function F(v, k) { return Math.pow(10, fit.a + fit.b * Math.log10(v) + k * fit.sd); }
    s += '<path class="band" d="M' + X(la) + ' ' + Y(F(la, 1)) + 'L' + X(lb) + ' ' + Y(F(lb, 1)) + 'L' + X(lb) + ' ' + Y(F(lb, -1)) + 'L' + X(la) + ' ' + Y(F(la, -1)) + 'Z"/>';
    s += '<path class="fit" d="M' + X(la) + ' ' + Y(F(la, 0)) + 'L' + X(lb) + ' ' + Y(F(lb, 0)) + '"/>';
    function inside(x, y) { return Math.log10(x) >= x0 && Math.log10(x) <= x1 && Math.log10(y) >= y0 && Math.log10(y) <= y1; }
    fit.live.forEach(function (p) { if (inside(p.tvl_usd, p.mcap_usd)) s += '<circle class="traded" r="4" cx="' + X(p.tvl_usd) + '" cy="' + Y(p.mcap_usd) + '"/><circle class="hit" r="7" cx="' + X(p.tvl_usd) + '" cy="' + Y(p.mcap_usd) + '" data-t="' + esc(p.name + (p.symbol ? ' (' + p.symbol + ')' : '')) + '" data-d="trades · mcap ' + usd(p.mcap_usd) + ' · TVL ' + usd(p.tvl_usd) + '"/>'; });
    rows.forEach(function (r) { if (inside(r.tvl_usd, r.implied)) s += '<circle class="pre' + (shown && !shown[r.slug] ? ' dim' : '') + '" r="3.5" cx="' + X(r.tvl_usd) + '" cy="' + Y(r.implied) + '"/><circle class="hit" r="6" cx="' + X(r.tvl_usd) + '" cy="' + Y(r.implied) + '" data-s="' + r.slug + '" data-t="#' + r.rank + ' ' + esc(r.name) + '" data-d="pre-token · implied ' + usd(r.implied) + ' · TVL ' + usd(r.tvl_usd) + '"/>'; });
    if (sel) { s += '<circle class="me" r="6" cx="' + X(sel.tvl_usd) + '" cy="' + Y(sel.implied) + '"/><text class="melabel" text-anchor="' + (X(sel.tvl_usd) > W * 0.65 ? 'end' : 'start') + '" x="' + (X(sel.tvl_usd) + (X(sel.tvl_usd) > W * 0.65 ? -10 : 10)) + '" y="' + (Y(sel.implied) - 10) + '">' + esc(sel.name) + '</text>'; }
    var box = h('div', { html: '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Market cap against TVL: traded tokens, the fitted line and the pre-token board">' + s + '</svg>' });
    var svg = box.firstChild;
    svg.addEventListener('mousemove', function (e) {
      var t = e.target; if (!t.getAttribute || !t.getAttribute('data-t')) { tip.hidden = true; return; }
      tip.innerHTML = '<b>' + t.getAttribute('data-t') + '</b>' + t.getAttribute('data-d'); tip.hidden = false;
      tip.style.left = (e.clientX + 14) + 'px'; tip.style.top = (e.clientY + 12) + 'px';
    });
    svg.addEventListener('mouseleave', function () { tip.hidden = true; });
    svg.addEventListener('click', function (e) { var s2 = e.target.getAttribute && e.target.getAttribute('data-s'); if (s2) go({ view: 'detail', p: s2 }); });
    return h('div', {}, [box, h('div', { class: 'legend' }, [h('span', {}, [h('i', { class: 'l-t' }), 'Traded (mcap)']), h('span', {}, [h('i', { class: 'l-p' }), 'Pre-token (implied)']), h('span', {}, [h('i', { class: 'l-f' }), 'Fit ±1 sd'])])]);
  }

  function equation() {
    return h('div', { class: 'eq', html: 'implied = 10^(<em>' + fit.a.toFixed(2) + '</em> + <em>' + fit.b.toFixed(3) + '</em>·log TVL<sub>eff</sub> + class)<br>' +
      '&nbsp;&nbsp;× retention(days without token)<br>TVL<sub>eff</sub> = TVL × (1 + 7d, ±' + R.params.trend_clamp + '%)<sup>' + R.params.trend_weeks + '</sup>' });
  }

  // ---- board view ----
  function board() {
    var list = visible(), shown = {};
    list.forEach(function (r) { shown[r.slug] = true; });
    if (list.length && !shown[state.p]) state.p = list[0].slug; // the side panel follows the filter
    var sel = bySlug[state.p];
    var f = h('div', { class: 'filters' }, [
      h('input', { type: 'search', placeholder: 'Search…', value: state.q, 'aria-label': 'Search', oninput: function (e) { state.q = e.target.value; go({}); var i = app.querySelector('input'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Set' }, [['all', 'All'], ['watchlist', 'Watchlist'], ['early', 'Below floor'], ['off-list', 'Off-list']].map(function (o) {
        return h('button', { 'aria-pressed': String(state.set === o[0]), onclick: function () { go({ set: o[0] }); } }, [o[1]]);
      })),
      select('cat', 'All categories', cats), select('chain', 'All chains', chains),
      select('win', 'Any launch window', ['Points season', 'Prime window', 'Long wait', 'Age unknown']),
      h('select', { 'aria-label': 'Minimum TVL', onchange: function (e) { go({ min: Number(e.target.value) }); } }, [0, 1e7, 5e7, 1e8, 5e8].map(function (v) { return h('option', { value: v, selected: state.min === v ? 'selected' : null }, [v ? 'TVL ≥ ' + usd(v) : 'Any TVL']); })),
      h('span', { class: 'shown', text: list.length + ' of ' + rows.length + ' shown' }),
    ]);
    var act = [];
    if (state.set !== 'all') act.push('Set: ' + state.set); if (state.cat !== 'all') act.push('Category: ' + state.cat);
    if (state.chain !== 'all') act.push('Chain: ' + state.chain); if (state.win !== 'all') act.push('Window: ' + state.win);
    if (state.min) act.push('TVL ≥ ' + usd(state.min)); if (state.q) act.push('“' + state.q + '”');
    if (state.sort !== 'rank') act.push('Sorted by ' + COLS.filter(function (c) { return c.k === state.sort; })[0].l + (state.dir < 0 ? ' ↓' : ' ↑'));
    var maxV = list.length ? Math.max.apply(null, list.map(function (r) { return r.implied; })) : 1;
    var thead = h('tr', {}, COLS.map(function (c) {
      return h('th', { class: c.n ? 'n' : null, 'aria-sort': state.sort === c.k ? (state.dir < 0 ? 'descending' : 'ascending') : null,
        onclick: function () { go({ sort: c.k, dir: state.sort === c.k ? -state.dir : (c.k === 'rank' || c.k === 'name' ? 1 : -1) }); } }, [c.l]);
    }));
    var tb = h('tbody', {}, list.map(function (r) {
      return h('tr', { class: r.slug === state.p ? 'sel' : null, onclick: function () { go({ view: 'detail', p: r.slug }); } }, [
        h('td', { class: 'rank' }, [String(r.rank)]),
        h('td', {}, [h('div', { class: 'pname' }, [r.name + ' ', h('span', { class: 'tag ' + r.set, text: r.set === 'early' ? 'below floor' : r.set })]),
          h('div', { class: 'psub', text: (r.category || 'Uncategorised') + ' · ' + r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') })]),
        h('td', { class: 'n' }, [usd(r.tvl_usd)]), h('td', { class: 'n' }, [trend(r.change_7d)]), h('td', { class: 'n' }, [age(r.v.age_days)]),
        h('td', { class: 'n' }, [h('div', { class: 'bar' }, [h('i', { style: 'width:' + Math.max(2, 64 * r.implied / maxV).toFixed(1) + 'px' }), h('b', { text: usd(r.implied) })])]),
        h('td', { class: 'n' }, [(r.implied / r.tvl_usd).toFixed(3)]), h('td', { class: 'n' }, [usd(r.plan.per_1k)]),
        h('td', { class: 'n' }, [usd(r.plan.cash_cost + r.plan.opp_cost)]), h('td', { class: 'n' }, [edge(r.plan.edge)]),
      ]);
    }));
    var left = h('div', {}, [f, act.length ? h('div', { class: 'active-f' }, act.map(function (a) { return h('span', { class: 'chip', text: a }); }).concat([h('button', { class: 'back', onclick: function () { go({ set: 'all', cat: 'all', chain: 'all', win: 'all', min: 0, q: '', sort: 'rank', dir: 1 }); } }, ['Clear'])])) : null,
      h('div', { class: 'panel scroll' }, [h('table', {}, [h('thead', {}, [thead]), tb])])]);
    var side = h('div', { class: 'panel' }, [
      h('div', { class: 'hd' }, [h('h2', { text: 'What TVL is worth' }), h('span', { class: 'note', text: 'fitted on ' + fit.n + ' traded tokens' })]),
      h('div', { class: 'bd' }, [scatter(sel, 250, 360, shown), equation(),
        h('dl', { class: 'kv' }, [h('dt', { text: 'Selected' }), h('dd', { text: '#' + sel.rank + ' ' + sel.name }), h('dt', { text: 'Implied value' }), h('dd', { text: usd(sel.implied) }),
          h('dt', { text: 'Farm on' }), h('dd', { text: sel.plan.chain + ', ' + usd(sel.plan.capital) + ', ' + sel.plan.days + ' d' }), h('dt', { text: 'Modelled drop' }), h('dd', {}, [usd(sel.plan.drop_usd) + ' · ', edge(sel.plan.edge)])]),
        h('p', { class: 'note', text: 'Drop = ' + (R.params.airdrop_share * 100) + '% of implied value, shared pro rata to capital ÷ TVL × hold days ÷ ' + R.params.season_days + '. Edge = drop ÷ (gas + fees + forgone T-bill yield). Click a row or a ring for its plan.' })]),
    ]);
    return h('div', { class: 'grid' }, [left, side]);
  }
  function select(key, all, opts) {
    return h('select', { 'aria-label': all, onchange: function (e) { var p = {}; p[key] = e.target.value; go(p); } }, [h('option', { value: 'all' }, [all])].concat(opts.map(function (o) { return h('option', { value: o, selected: state[key] === o ? 'selected' : null }, [o]); })));
  }

  // ---- detail view ----
  function detail() {
    var r = bySlug[state.p], v = r.v, p = r.plan, i = rows.indexOf(r);
    var steps = [
      ['Market fit at its TVL', usd(r.tvl_usd) + ' TVL on the fitted line', v.base],
      ['7-day trend', pct(r.change_7d) + ' → ×' + v.trend.toFixed(3) + ' TVL over ' + R.params.trend_weeks + ' weeks', v.trended],
      ['Category class', (r.category || 'Uncategorised') + ': ' + (v.class_n ? v.class_n + ' traded, ' : 'none traded, ') + '×' + Math.pow(10, v.class_adj).toFixed(2), v.classed],
      ['Time without token', (v.age_days === null ? 'unknown, median ' + R.unknown_age + ' d used' : v.age_days + ' days') + ' → retention ×' + v.retention.toFixed(2), r.implied],
    ];
    var top = Math.max.apply(null, steps.map(function (s) { return s[2]; }));
    var wf = h('div', { class: 'wf' }, [].concat.apply([], steps.map(function (s, k) {
      var d = k ? s[2] / steps[k - 1][2] - 1 : null;
      return [h('div', { class: 'lab' }, [s[0], h('small', { text: s[1] })]), h('div', { class: 'track' + (k === 3 ? ' last' : '') }, [h('i', { style: 'width:' + (100 * s[2] / top).toFixed(1) + '%' })]),
        h('div', { class: 'v' }, [usd(s[2]), h('small', { class: d === null ? 'note' : d >= 0 ? 'up' : 'down', text: d === null ? 'start' : (d >= 0 ? '+' : '') + (100 * d).toFixed(1) + '%' })])];
    })));
    var plan = h('ol', { class: 'plan' }, [h('li', { class: 'h' }, [h('span', { class: 'hd2', text: 'Step' }), h('span', { class: 'hd2', text: 'Cost' }), h('span', { class: 'hd2', text: 'Time' })])].concat(p.steps.map(function (s) {
      return h('li', {}, [h('span', { text: s.act }), h('span', { class: 'c', text: s.cost }), h('span', { class: 't', text: s.time })]);
    })));
    var cautions = [];
    if (p.edge < 1) cautions.push('At ' + usd(r.tvl_usd) + ' of TVL the modelled drop (' + usd(p.drop_usd) + ') does not cover the plan\'s costs: farm it only with capital you would park here anyway, or pick a smaller protocol from the Edge column.');
    var caution = r.set === 'off-list' ? 'Above the floor but left off the house watchlist, which drops products whose parent protocol is recorded: check whether a parent token already trades before farming.' :
      r.window === 'Long wait' ? 'Over two years with no recorded token: the value holds if a token comes, but the chance it ever comes is lower. The plan keeps the hold short.' :
      r.window === 'Points season' ? 'Young TVL is partly points capital that may leave at launch; retention cuts its value to ×' + v.retention.toFixed(2) + '.' : null;
    return h('div', {}, [
      h('div', { class: 'dhead' }, [h('div', {}, [h('h2', {}, ['#' + r.rank + ' ' + r.name + ' ', h('span', { class: 'tag ' + r.set, text: r.set === 'early' ? 'below floor' : r.set })]),
        h('div', { class: 'psub', text: (r.category || 'Uncategorised') + ' · ' + r.chains.join(', ') + ' · listed ' + (r.listed_at || 'n/a') + ' · ' + r.window + ' · records no token' })]),
        h('div', {}, [h('button', { class: 'back', onclick: function () { go({ view: 'detail', p: rows[Math.max(0, i - 1)].slug }); } }, ['← #' + Math.max(1, r.rank - 1)]), ' ',
          h('button', { class: 'back', onclick: function () { go({ view: 'detail', p: rows[Math.min(rows.length - 1, i + 1)].slug }); } }, ['#' + Math.min(rows.length, r.rank + 1) + ' →']), ' ',
          h('button', { class: 'back', onclick: function () { go({ view: 'board' }); } }, ['Board'])])]),
      h('div', { class: 'stats' }, [['TVL', usd(r.tvl_usd)], ['7-day change', pct(r.change_7d)], ['Without a token', age(v.age_days)], ['Implied ×TVL', (r.implied / r.tvl_usd).toFixed(3)], ['Implied value', usd(r.implied)]].map(function (s, k) {
        return h('div', { class: 'stat' + (k === 4 ? ' hero' : '') }, [h('b', { text: s[1] }), h('span', { text: s[0] })]);
      })),
      h('div', { class: 'detail' }, [
        h('div', {}, [h('div', { class: 'panel' }, [h('div', { class: 'hd' }, [h('h2', { text: 'How the value is built' }), h('span', { class: 'note', text: 'each bar is the running value' })]), h('div', { class: 'bd' }, [wf])]),
          h('div', { class: 'panel', style: 'margin-top:16px' }, [h('div', { class: 'hd' }, [h('h2', { text: 'Where it sits' }), h('span', { class: 'note', text: 'against ' + fit.n + ' traded tokens' })]), h('div', { class: 'bd' }, [scatter(r, 250, 600)])])]),
        h('div', { class: 'panel' }, [h('div', { class: 'hd' }, [h('h2', { text: 'Farm plan' }), h('span', { class: 'note', text: usd(p.capital) + ' on ' + p.chain + ' for ' + p.days + ' days' })]),
          h('div', { class: 'bd' }, [plan, h('div', { class: 'totals' }, [['Cash cost', usd(p.cash_cost)], ['Forgone yield', usd(p.opp_cost)], ['Hands-on time', mins(p.hands_on_min)], ['Calendar time', p.days + ' days'], ['Modelled drop', usd(p.drop_usd)], ['Edge over costs', null]].map(function (s, k) {
            return h('div', { class: 'stat' + (k === 5 ? ' edgecard ' + (p.edge >= 1.5 ? 'good' : p.edge >= 1 ? 'ok' : 'weak') : '') }, [s[1] === null ? h('b', {}, [edge(p.edge)]) : h('b', { text: s[1] }), h('span', { text: s[0] })]);
          })), caution ? h('div', { class: 'caution', text: caution }) : null].concat(cautions.map(function (c) { return h('div', { class: 'caution', text: c }); })))]),
      ]),
    ]);
  }

  // ---- traded view: the calibration set, never ranked ----
  function traded() {
    var live = fit.live.slice().sort(function (a, b) { return b.mcap_usd - a.mcap_usd; });
    return h('div', { class: 'grid' }, [h('div', { class: 'panel scroll' }, [h('table', {}, [
      h('thead', {}, [h('tr', {}, ['Protocol', 'Token', 'TVL', 'Market cap', 'Fit at TVL', 'mcap ÷ fit'].map(function (l, k) { return h('th', { class: k > 1 ? 'n' : null, text: l }); }))]),
      h('tbody', {}, live.map(function (p) {
        return h('tr', {}, [h('td', {}, [h('div', { class: 'pname', text: p.name }), h('div', { class: 'psub', text: (p.category || 'Uncategorised') + ' · ' + p.chains.slice(0, 3).join(', ') + (p.members > 1 ? ' · ' + p.members + ' records pooled' : '') })]),
          h('td', { class: 'mono', text: p.symbol || '—' }), h('td', { class: 'n', text: usd(p.tvl_usd) }), h('td', { class: 'n', text: usd(p.mcap_usd) }), h('td', { class: 'n', text: usd(p.fitted_usd) }),
          h('td', { class: 'n' }, [h('span', { class: p.resid >= 0 ? 'up' : 'down', text: Math.pow(10, p.resid).toFixed(2) + '×' })])]);
      }))])]),
      h('div', { class: 'panel' }, [h('div', { class: 'hd' }, [h('h2', { text: 'Already trading' })]), h('div', { class: 'bd' }, [
        h('p', { class: 'note', text: 'These ' + fit.n + ' tokens have a market cap (records sharing one token pool their TVL). The market already prices them, so the radar never ranks them: it uses them to learn what a dollar of TVL is worth.' }),
        scatter(null, 250), equation()])])]);
  }

  // ---- method view ----
  function method() {
    var cl = Object.keys(fit.classes).map(function (c) { return [c, fit.classes[c]]; }).sort(function (a, b) { return b[1].n - a[1].n; });
    var ex = Object.keys(R.excluded).sort(function (a, b) { return R.excluded[b] - R.excluded[a]; });
    return h('div', { class: 'grid' }, [h('div', { class: 'panel' }, [h('div', { class: 'hd' }, [h('h2', { text: 'Category classes' }), h('span', { class: 'note', text: 'median residual, shrunk by n/(n+' + R.params.shrink_k + ')' })]),
      h('div', { class: 'scroll' }, [h('table', {}, [h('thead', {}, [h('tr', {}, ['Category', 'Traded', 'Median', 'Applied'].map(function (l, k) { return h('th', { class: k ? 'n' : null, text: l }); }))]),
        h('tbody', {}, cl.map(function (c) { return h('tr', {}, [h('td', { text: c[0] }), h('td', { class: 'n', text: String(c[1].n) }), h('td', { class: 'n', text: '×' + Math.pow(10, c[1].median).toFixed(2) }), h('td', { class: 'n', text: '×' + Math.pow(10, c[1].adj).toFixed(2) })]); }))])])]),
      h('div', { class: 'panel' }, [h('div', { class: 'hd' }, [h('h2', { text: 'The model' })]), h('div', { class: 'bd' }, [equation(),
        h('dl', { class: 'kv' }, [['Fit n', fit.n], ['Slope b', fit.b.toFixed(3)], ['R²', fit.r2.toFixed(3)], ['Residual sd', '×' + Math.pow(10, fit.sd).toFixed(2)], ['Retention floor', R.params.retention_floor], ['Unknown age uses', R.unknown_age + ' d']].reduce(function (a, kv) { return a.concat([h('dt', { text: kv[0] }), h('dd', { text: String(kv[1]) })]); }, [])),
        h('p', { class: 'note', text: 'Set aside, never ranked: ' + ex.map(function (k) { return k + ' ' + R.excluded[k]; }).join(', ') + '. Every watchlist slug is ranked whatever its category.' }),
        h('p', { class: 'note', text: 'A board value is this model\'s claim of what a token would be worth if the record stayed as it is; it does not say a token will launch. "Records no token" means DefiLlama carries none.' })])])]);
  }

  function render() {
    chrome(); app.innerHTML = '';
    app.appendChild(state.view === 'detail' ? detail() : state.view === 'traded' ? traded() : state.view === 'method' ? method() : board());
  }
  readHash(); render();
  window.addEventListener('hashchange', function () { readHash(); render(); });
})();
