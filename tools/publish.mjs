// Generates a ready-to-paste GitHub release description (and the exact `gh`
// command) from the packaged artifacts. It NEVER uploads anything - publishing
// is done by hand.
//
//   npm run publish                 # build + write dist/release-notes-<v>.md
//   npm run publish -- --no-build   # use existing dist/ artifacts
//   npm run publish -- --latest     # suggest a normal (non-prerelease) release
//   npm run publish -- --tag v0.7.3
//   npm run publish -- --json       # print a machine-readable summary

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const noBuild = args.includes('--no-build');
const asJson = args.includes('--json');
const prerelease = !args.includes('--latest');
const tagIndex = args.indexOf('--tag');

const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const tag = tagIndex >= 0 ? args[tagIndex + 1] : `v${version}`;
const repo = 'cravvnn/Vynk';

if (!noBuild) {
  console.log('> npm run package');
  execSync('npm run package', { cwd: root, stdio: 'inherit' });
}

const manifestPath = join(root, 'dist', `manifest-${version}.json`);
if (!existsSync(manifestPath)) {
  console.error(`No manifest at ${manifestPath}. Run "npm run package" first (or drop --no-build).`);
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const panel = manifest.files.find((f) => f.name.includes('panel'));
const server = manifest.files.find((f) => f.name.includes('server'));
if (!panel || !server) {
  console.error('Manifest is missing a panel or server artifact.');
  process.exit(1);
}

function kb(bytes) {
  return Math.round(bytes / 1024) + ' KB';
}

function sectionFrom(file, ver) {
  const path = join(root, file);
  if (!existsSync(path)) return '';
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith(`## [${ver}]`));
  if (start < 0) return '';
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## [')) break;
    out.push(lines[i]);
  }
  return out.join('\n').trim();
}

// Prefer the curated, user-facing bullets in RELEASE_NOTES.md; fall back to the
// technical changelog section if a version has no entry there.
const highlights = sectionFrom('RELEASE_NOTES.md', version) || sectionFrom('CHANGELOG.md', version);

const notes = `# Vynk ${version}

Real-time collaboration for Adobe After Effects. Vynk (Visual Link) syncs layers,
properties, keyframes, masks, effects and shape layers across editors, with live
cursors and a shared base project - media never leaves your machine.

${highlights ? `## What's new\n\n${highlights}\n\n` : ''}## Downloads

| File | Size | SHA-256 |
|---|---|---|
| \`${panel.name}\` | ${kb(panel.bytes)} | \`${panel.sha256}\` |
| \`${server.name}\` | ${kb(server.bytes)} | \`${server.sha256}\` |

**Editors** download the **panel** zip. **Relay hosts** download the **server** zip.

## Install (editors)

1. Unblock the zip (right-click > Properties > Unblock), then extract it.
2. Fully close After Effects, then run \`install.bat\` (accept the admin prompt for the
   native cursor overlay).
3. Start After Effects and open **Window > Extensions > Vynk**.
4. Enter your name and the room code, then click **join**.

The relay is preconfigured (\`wss://vynk.allevilmc.com/ws\`); change the server field
only if you run your own. Text sync is on by default in this build.

## Run the relay

\`\`\`bash
cp deploy/.env.example .env      # set DOMAIN to a DNS name pointing at the host
docker compose up -d --build
\`\`\`

See \`deploy/README.md\` in the server zip.
`;

const notesPath = join(root, 'dist', `release-notes-${version}.md`);
writeFileSync(notesPath, notes);

const flags = [prerelease ? '--prerelease' : '--latest', `--title "Vynk ${version}"`, `--notes-file "${notesPath}"`, '--target main'];
const ghCommand =
  `gh release create ${tag} --repo ${repo} ${flags.join(' ')}\n` +
  `  "${join(root, 'dist', panel.name)}" "${join(root, 'dist', server.name)}"`;

if (asJson) {
  console.log(
    JSON.stringify(
      { version, tag, prerelease, notesPath, artifacts: manifest.files, ghCommand },
      null,
      2
    )
  );
  process.exit(0);
}

console.log('\n============================================================');
console.log('  Release notes written (NOT published by this script)');
console.log('============================================================\n');
console.log(notes);
console.log('------------------------------------------------------------');
console.log(`Notes file: ${notesPath}\n`);
console.log('When you are ready, publish it yourself with:\n');
console.log('  ' + ghCommand + '\n');