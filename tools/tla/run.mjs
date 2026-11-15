import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
if (!fs.existsSync(path.join(here, 'node_modules', 'tla-ts', 'package.json'))) {
  if (!process.env.npm_execpath) throw new Error('Run through npm run check:tla to install the pinned checker.');
  const install = spawnSync(process.execPath, [process.env.npm_execpath, 'ci', '--prefix', here, '--no-audit', '--no-fund'], { stdio: 'inherit' });
  if (install.status !== 0) process.exit(install.status || 1);
}
const args = process.argv.slice(2);
const lineEndings = spawnSync(process.execPath, [path.join(here, 'test-line-endings.mjs')], { stdio: 'inherit', windowsHide: true });
if (lineEndings.status !== 0) process.exit(lineEndings.status || 1);
const result = spawnSync(process.execPath, [path.join(here, 'check.mjs'), ...(args.length ? args : ['panel/src', 'panel/jsx', 'server/src', 'aegp/src', 'tools/ae-pair'])], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status || 0);
