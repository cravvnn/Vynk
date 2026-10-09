import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2];

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('usage: npm run set-version -- <major.minor.patch>');
  process.exit(1);
}

const [maj, min, pat] = version.split('.').map(Number);
const pipl = (maj << 16) | (min << 8) | pat;

function edit(rel, transform) {
  const path = join(root, rel);
  const before = readFileSync(path, 'utf8');
  const after = transform(before);
  if (after === before) {
    console.log('  unchanged ' + rel);
    return;
  }
  writeFileSync(path, after);
  console.log('  updated   ' + rel);
}

const bumpPackage = (s) => s.replace(/"version": "[^"]+"/, `"version": "${version}"`);

edit('package.json', bumpPackage);
edit('server/package.json', bumpPackage);
edit('shared/protocol/package.json', bumpPackage);
edit('panel/src/version.js', () => `window.VYNK_VERSION = '${version}';\n`);
edit('panel/CSXS/manifest.xml', (s) =>
  s
    .replace(/ExtensionBundleVersion="[^"]+"/, `ExtensionBundleVersion="${version}"`)
    .replace(/(<Extension Id="com\.vynk\.panel" Version=")[^"]+(")/, `$1${version}$2`)
);
edit('aegp/res/vynk_PiPL.r', (s) =>
  s.replace(/(Version\s*\{\s*)\d+(\s*\})/, `$1${pipl}$2`)
);

try {
  execSync('npm install --package-lock-only', { cwd: root, stdio: 'ignore' });
  console.log('  synced    package-lock.json');
} catch {
  console.log('  NOTE      run "npm install" to sync package-lock.json');
}

console.log(`\nVynk version set to ${version} (AEGP PiPL ${pipl}).`);
