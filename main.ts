// Token radar entry for make.fun's token-radar-01 (Node 22, standard library only).
//
// Reads the sealed DefiLlama snapshot (/input/snapshot.json, or --input <file|dir>), ranks the pre-token
// protocols with dashboard/model.js (the same file the page uses to explain each value), and writes to
// /output (or MAKEFUN_OUTPUT_DIR): board.json, data.js for the page, dashboard/, screenshots/ and
// dossier.json built with the vendored make.fun library. Output is a pure function of the snapshot,
// so two runs write the same bytes.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../_kit/token-radar-01-kit/input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const model = createRequire(import.meta.url)('./dashboard/model.js');

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && at + 1 < process.argv.length ? process.argv[at + 1]! : fallback;
}
function fail(msg: string): never {
  process.stderr.write(`token radar: ${msg}\n`);
  process.exit(1);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) fail(`no snapshot at ${inputFile}`);
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = JSON.parse(readFileSync(inputFile, 'utf8'));
if (!Array.isArray(snapshot.protocols) || !Array.isArray(snapshot.watchlist)) fail('snapshot has no protocols or watchlist');

const { board, live, peers } = model.buildBoard(snapshot);

// The gate's own shape, checked before anything is written.
const slugs = new Set(snapshot.protocols.map((p: { slug: string }) => p.slug));
if (board.length < 100 || board.length > 4000) fail(`board has ${board.length} rows`);
for (const [i, r] of board.entries()) {
  if (r.rank !== i + 1) fail(`rank ${r.rank} at position ${i}`);
  if (!slugs.has(r.slug)) fail(`unknown slug ${r.slug}`);
  if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd < 1) fail(`bad implied value for ${r.slug}`);
  if (i > 0 && r.implied_value_usd > board[i - 1].implied_value_usd) fail(`value rises at rank ${r.rank}`);
  if (r.farm_steps.length < 3 || r.farm_steps.length > 12) fail(`${r.slug} has ${r.farm_steps.length} farm steps`);
  for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) fail(`${r.slug}: step of ${s.length} chars`);
}
const onBoard = new Set(board.map((r: { slug: string }) => r.slug));
const missing = snapshot.watchlist.filter((s: string) => !onBoard.has(s));
if (missing.length) fail(`watchlist not covered: ${missing.join(', ')}`);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ as_of: snapshot.as_of, model: 'peer-multiple x momentum x runway', rows: board })}\n`);

const categories = Object.entries(peers.cat as Record<string, { log: number; n: number }>)
  .map(([category, c]) => ({ category, n: c.n, multiple: +Math.exp(c.log).toFixed(4) }))
  .sort((a, b) => b.n - a.n || (a.category < b.category ? -1 : 1));
const data = {
  as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd,
  protocols: snapshot.protocols.length, watchlist: snapshot.watchlist.length,
  traded: peers.peers, categories, rows: board, live,
};
writeFileSync(join(out, 'data.js'), `window.RADAR = ${JSON.stringify(data)};\n`);

function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.') || !statSync(join(from, name)).isFile()) continue;
    copyFileSync(join(from, name), join(to, name));
    names.push(name);
  }
  return names;
}
copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3 && !process.argv.includes('--no-shots')) fail(`screenshots/ holds ${shots.length} images, need 3`);

if (shots.length >= 3) {
  writeFileSync(join(out, 'dossier.json'), buildDossier(out, {
    text_max_bytes: 65_536, screenshots: { max: 4, max_bytes: 524_288 }, dashboard: { max_files: 400, max_bytes: 4_194_304 },
  }));
}
process.stdout.write(`token radar: ${board.length} rows (${snapshot.watchlist.length} watchlist), ${peers.peers} traded peers, ${shots.length} screenshots -> ${out}\n`);
