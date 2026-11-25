// Pre-token radar, token-radar-01 (Node 22, standard library only).
//
// One model, two runners: this program loads dashboard/model.js, the same file the page loads, runs it
// on the sealed snapshot and writes board.json from it. The page runs it again in the reader's browser
// on the raw snapshot carried in data.js and checks every row against board.json on its cover.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|dir>

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';

const root = fileURLToPath(new URL('.', import.meta.url));
const Radar = createRequire(import.meta.url)('./dashboard/model.js');

function flag(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1]! : fallback;
}

function fail(msg: string): never {
  process.stderr.write(`pre-token radar: ${msg}\n`);
  process.exit(1);
}

const input = flag('input', '/input');
const snapPath = input.endsWith('.json') ? input : join(input, 'snapshot.json');
if (!existsSync(snapPath)) fail(`no snapshot at ${snapPath}; pass --input or mount /input`);
const out = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
const snapshot = JSON.parse(readFileSync(snapPath, 'utf8'));

const result = Radar.run(snapshot);
const rows = Radar.boardRows(result);

// The gate's own rules, checked before anything is written.
const watch = new Set<string>(snapshot.watchlist);
const known = new Set<string>(snapshot.protocols.map((p: { slug: string }) => p.slug));
if (rows.length < 100 || rows.length > 4000) fail(`${rows.length} rows; the gate takes 100 to 4,000`);
rows.forEach((r: { slug: string; rank: number; implied_value_usd: number; farm_steps: string[] }, i: number) => {
  if (!known.has(r.slug)) fail(`${r.slug} is not a snapshot protocol`);
  if (r.rank !== i + 1) fail(`rank ${r.rank} at position ${i + 1}`);
  if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd < 1) fail(`${r.slug}: implied value ${r.implied_value_usd}`);
  if (i > 0 && r.implied_value_usd > rows[i - 1].implied_value_usd) fail(`${r.slug}: value rises with rank`);
  if (r.farm_steps.length < 3 || r.farm_steps.length > 12) fail(`${r.slug}: ${r.farm_steps.length} farm steps`);
  for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) fail(`${r.slug}: a step of ${s.trim().length} chars`);
  watch.delete(r.slug);
});
if (watch.size) fail(`watchlist not covered: ${[...watch].slice(0, 5).join(', ')}`);
const ledgerTotal = Object.values(result.groups as Record<string, number>).reduce((a, b) => a + b, 0);
if (ledgerTotal !== snapshot.protocols.length) fail(`ledger holds ${ledgerTotal} of ${snapshot.protocols.length}`);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ as_of: snapshot.as_of, model: 'TVL x fitted launch multiple x fitted 12-month token odds', rows })}\n`);
// The page gets the raw snapshot (to recompute) and the board (to compare against).
writeFileSync(join(out, 'data.js'), `window.RADAR_DATA = ${JSON.stringify({ snapshot, board: rows })};\n`);

function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  return readdirSync(from)
    .filter((n) => !n.startsWith('.') && statSync(join(from, n)).isFile())
    .sort()
    .map((n) => (copyFileSync(join(from, n), join(to, n)), n));
}

copyDir(join(root, 'dashboard'), join(out, 'dashboard'));
const shots = copyDir(join(root, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3 || shots.length > 4) fail(`screenshots/ holds ${shots.length} images; hand in 3 or 4`);

writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: 65_536, screenshots: { max: 4, max_bytes: 524_288 }, dashboard: { max_files: 400, max_bytes: 4_194_304 } }),
);

const v = result.value, o = result.odds;
process.stdout.write(
  `pre-token radar: ${rows.length} rows (${snapshot.watchlist.length} watchlist), ledger ${ledgerTotal}/${snapshot.protocols.length}; ` +
    `multiple LOO x${v.final[0].toFixed(2)} WF x${v.final[1].toFixed(2)} (flat x${v.flat[0].toFixed(2)}/x${v.flat[1].toFixed(2)}), ` +
    `80% range blind coverage ${(v.cover * 100).toFixed(0)}% of ${v.nTest}; odds terms ${o.kept.join('+')} (${o.shape} clock)\n`,
);
