// Dev tool: render the built dashboard (out/) in headless Edge or Chrome and save the three screenshots
// the gate asks for into screenshots/. Run after `MAKEFUN_OUTPUT_DIR=out node main.ts --no-shots`.
//   node tools/shoot.mjs [browser path]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const page = pathToFileURL(join(root, 'out', 'dashboard', 'index.html')).href;
const browser = process.argv[2] ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(existsSync);
if (!browser) throw new Error('no headless browser found: pass its path');

const views = [
  ['1-board.png', ''],
  ['2-detail.png', '#p=veda'],
  ['3-filtered.png', '#cat=RWA&trend=up&sort=implied_value_usd&dir=-1'],
];
mkdirSync(join(root, 'screenshots'), { recursive: true });
for (const [name, hash] of views) {
  const file = join(root, 'screenshots', name);
  execFileSync(browser, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--window-size=1440,900', '--virtual-time-budget=3000', `--screenshot=${file}`, page + hash], { stdio: 'ignore' });
  console.log(name, statSync(file).size, 'bytes');
}
