// Capture the three dossier screenshots from a built out/ with headless Chrome (or Edge).
//   node tools/shoot.mjs [out-dir]
// 1-board: the cover as it loads; 2-detail: the board scrolled in, one protocol's detail open;
// 3-filtered: the board filtered by verdict and category.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const out = resolve(process.argv[2] ?? 'out');
const browsers = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
];
const bin = browsers.find((b) => existsSync(b));
if (!bin) throw new Error('no Chrome or Edge found');
const page = pathToFileURL(join(out, 'dashboard', 'index.html')).href;
const dir = resolve('screenshots');
mkdirSync(dir, { recursive: true });

const shots = [
  ['1-board.png', '', 1200],
  ['2-detail.png', '#view=board&slug=' + (process.env.DETAIL ?? 'infinifi'), 1400],
  ['3-filtered.png', '#view=board&verdict=FARM&sort=value', 1200],
];
for (const [name, hash, h] of shots) {
  const file = join(dir, name);
  execFileSync(bin, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--allow-file-access-from-files',
    `--window-size=1440,${h}`, '--virtual-time-budget=4000', `--screenshot=${file}`, page + hash], { stdio: 'ignore' });
  console.log(name, statSync(file).size, 'bytes');
}
