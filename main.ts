// Launch Radar: token-radar-01 entry (Node 22, standard library only).
//
// Reads the sealed snapshot (/input/snapshot.json, or --input <file|dir>), scores it with
// dashboard/model.js, the same file the page runs, and writes to /output (or MAKEFUN_OUTPUT_DIR):
//   board.json   every ranked pre-token row: rank, implied_value_usd, the model's factors, farm_steps
//   data.js      the snapshot itself plus a digest of board.json, so the page re-scores and cross-checks
//   dashboard/   and screenshots/ copied as they are, then dossier.json written by buildDossier.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../kit/input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

function fail(msg: string): never {
  process.stderr.write(`launch radar: ${msg}\n`);
  process.exit(1);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) fail(`no snapshot at ${inputFile}`);
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

// The snapshot, normalised to its ten fields (anything missing becomes null, never a guess).
interface Proto { slug: string; name: string; category: string | null; chains: string[]; tvl_usd: number; change_7d: number | null; mcap_usd: number | null; listed_at: string | null; gecko_id: string | null; symbol: string | null }
const raw = JSON.parse(readFileSync(inputFile, 'utf8'));
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const protocols: Proto[] = (raw.protocols as Record<string, unknown>[])
  .filter((p) => typeof p.slug === 'string' && typeof p.name === 'string' && num(p.tvl_usd) !== null)
  .map((p) => ({
    slug: p.slug as string, name: p.name as string, category: str(p.category),
    chains: Array.isArray(p.chains) ? (p.chains as unknown[]).filter((c): c is string => typeof c === 'string') : [],
    tvl_usd: p.tvl_usd as number, change_7d: num(p.change_7d), mcap_usd: num(p.mcap_usd),
    listed_at: str(p.listed_at), gecko_id: str(p.gecko_id), symbol: str(p.symbol),
  }));
const snap = { as_of: String(raw.as_of), source: String(raw.source), floor_usd: Number(raw.floor_usd), watchlist: raw.watchlist as string[], protocols };

// Run the page's own model file in a clean context: one model, two callers.
const modelSrc = readFileSync(join(here, 'dashboard', 'model.js'), 'utf8');
const ctx: { RadarModel?: any } = {};
runInNewContext(modelSrc, ctx, { filename: 'dashboard/model.js' });
const M = ctx.RadarModel;
if (!M) fail('dashboard/model.js did not define RadarModel');
const radar = M.build(snap);

const rows = radar.rows.map((r: any) => ({
  rank: r.rank,
  slug: r.slug,
  name: r.name,
  implied_value_usd: r.implied,
  token_status: 'pre-token',
  set: r.set,
  category: r.category,
  chains: r.chains,
  tvl_usd: r.tvl_usd,
  change_7d: r.change_7d,
  listed_at: r.listed_at,
  days_without_token: r.v.age_days,
  launch_window: r.window,
  model: {
    fitted_usd: Math.round(r.v.base), trend_multiplier: +r.v.trend.toFixed(4), class_adj_log10: +r.v.class_adj.toFixed(4),
    retention: +r.v.retention.toFixed(4), implied_to_tvl: +(r.implied / r.tvl_usd).toFixed(4),
  },
  farm: {
    chain: r.plan.chain, capital_usd: r.plan.capital, hold_days: r.plan.days, cash_cost_usd: +r.plan.cash_cost.toFixed(2),
    opportunity_cost_usd: +r.plan.opp_cost.toFixed(2), hands_on_minutes: r.plan.hands_on_min, modelled_drop_usd: Math.round(r.plan.drop_usd),
  },
  farm_steps: r.plan.steps.map((s: any) => String(M.stepText(s)).trim()),
}));

// The gate's own conditions, checked before anything is written.
const slugs = new Set(snap.protocols.map((p) => p.slug));
const seen = new Set<string>();
if (rows.length < 100 || rows.length > 4000) fail(`board has ${rows.length} rows`);
rows.forEach((r: any, i: number) => {
  if (!slugs.has(r.slug) || seen.has(r.slug)) fail(`bad or repeated slug ${r.slug}`);
  seen.add(r.slug);
  if (r.rank !== i + 1) fail(`rank ${r.rank} at ${i}`);
  if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) fail(`${r.slug} implied ${r.implied_value_usd}`);
  if (i > 0 && r.implied_value_usd > rows[i - 1].implied_value_usd) fail(`${r.slug} rises in value`);
  if (r.farm_steps.length < 3 || r.farm_steps.length > 12) fail(`${r.slug} has ${r.farm_steps.length} steps`);
  for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) fail(`${r.slug} step of ${s.length} chars`);
});
const missing = snap.watchlist.filter((s) => !seen.has(s));
if (missing.length) fail(`watchlist not covered: ${missing.join(', ')}`);
if (rows[0].implied_value_usd === rows[rows.length - 1].implied_value_usd) fail('all implied values equal');

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ as_of: snap.as_of, model: 'launch-radar fit v1', rows })}\n`);
const digest = rows.map((r: any) => [r.slug, r.rank, r.implied_value_usd]);
writeFileSync(join(out, 'data.js'), `window.SNAPSHOT=${JSON.stringify(snap)};\nwindow.BOARD=${JSON.stringify(digest)};\n`);

function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names = readdirSync(from).filter((n) => !n.startsWith('.') && statSync(join(from, n)).isFile()).sort();
  for (const n of names) copyFileSync(join(from, n), join(to, n));
  return names;
}
const dash = copyDir(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyDir(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) fail(`screenshots/ holds ${shots.length} images; 3 are needed`);

writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: 65_536, screenshots: { max: 4, max_bytes: 524_288 }, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

const watched = rows.filter((r: any) => r.set === 'watchlist').length;
process.stdout.write(
  `launch radar: fit n=${radar.fit.n} b=${radar.fit.b.toFixed(3)} R2=${radar.fit.r2.toFixed(3)}; ${rows.length} rows (${watched}/${snap.watchlist.length} watchlist); ` +
    `dashboard ${dash.length} files, ${shots.length} screenshots -> ${out}\n`,
);
