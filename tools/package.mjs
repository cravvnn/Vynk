import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  cpSync,
  existsSync,
  statSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, basename } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const distDir = join(root, 'dist');

const args = process.argv.slice(2);
const skipTests = args.includes('--skip-tests');
const aexIndex = args.indexOf('--aex');
const aexPath = resolve(aexIndex >= 0 ? args[aexIndex + 1] : join(root, 'aegp', 'build', 'Release', 'vynk.aex'));

const panelZip = join(distDir, `Vynk-${version}-panel.zip`);
const serverZip = join(distDir, `Vynk-${version}-server.zip`);
const stagePanel = join(distDir, '.stage-panel');
const stageServer = join(distDir, '.stage-server');

function fail(message) {
  console.error('\nERROR: ' + message);
  process.exit(1);
}

function run(command) {
  console.log('> ' + command);
  execSync(command, { cwd: root, stdio: 'inherit' });
}

function ignoreForPackage(src) {
  const base = basename(src);
  return !(
    base === 'node_modules' ||
    base === 'dist' ||
    base === 'data' ||
    base.endsWith('.tsbuildinfo')
  );
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex').toUpperCase();
}

function zipDir(srcDir, destZip) {
  rmSync(destZip, { force: true });
  const q = (p) => p.replace(/'/g, "''");
  const script =
    "Add-Type -AssemblyName System.IO.Compression.FileSystem; " +
    `[System.IO.Compression.ZipFile]::CreateFromDirectory('${q(srcDir)}','${q(destZip)}',` +
    '[System.IO.Compression.CompressionLevel]::Optimal,$false)';
  execFileSync('powershell', ['-NoProfile', '-Command', script], { stdio: 'inherit' });
}

const cepReg = [
  'Windows Registry Editor Version 5.00',
  '',
  ...['9', '10', '11', '12'].flatMap((v) => [
    `[HKEY_CURRENT_USER\\Software\\Adobe\\CSXS.${v}]`,
    '"PlayerDebugMode"="1"',
    '',
  ]),
].join('\r\n');

const panelReadme = `Vynk ${version} - real-time collaboration for Adobe After Effects

Vynk (Visual Link) lets several editors work in the same After Effects project at
once: layers, properties, keyframes, masks, effects and shape layers stay in sync,
peer cursors are drawn over the composition, and a shared base project can be handed
out so everyone starts from identical bytes. Media never leaves your machine.

This package contains:
  panel\\               the Vynk panel (installed into your CEP extensions folder)
  vynk.aex             the native companion (cursor overlay + change detection)
  install.bat / .ps1   install it
  uninstall.bat / .ps1 remove it
  diagnose.ps1         read-only install report (send the output if something fails)
  LICENSE              MIT

See INSTALL.txt for step-by-step instructions.
`;

const panelInstall = `Vynk ${version} - install

Requirements
  - Windows 10 or 11
  - Adobe After Effects 2020 or newer
  - Administrator rights (the native overlay installs into AE's Plug-ins folder)

Install
  1. Fully close After Effects.
  2. Run install.bat (double-click), or install.ps1 in PowerShell.
     Accept the admin prompt when it appears for the native overlay.
  3. Start After Effects.
  4. Window > Extensions > Vynk.
  5. Enter your name and the room code, then click join.

The panel log should start with:
  panel v${version} starting ... text=off

Troubleshooting
  - Panel missing from the Extensions menu: run diagnose.ps1 and send the output
    to the maintainer.
  - Windows "blocked" the scripts: right-click the downloaded .zip > Properties >
    check Unblock > Apply, then extract again.

Uninstall
  - Run uninstall.bat (accept the admin prompt to remove the native overlay).
`;

console.log(`\nPackaging Vynk ${version}\n`);

if (!existsSync(aexPath)) {
  fail(
    `native AEGP not found at ${aexPath}\n` +
      '  Build it first:  cmake --build aegp/build --config Release\n' +
      '  Or pass an existing one:  npm run package -- --aex <path to vynk.aex>'
  );
}

if (!skipTests) {
  run('npm run build');
  run('npm test');
}

mkdirSync(distDir, { recursive: true });
rmSync(stagePanel, { recursive: true, force: true });
rmSync(stageServer, { recursive: true, force: true });
mkdirSync(stagePanel, { recursive: true });
mkdirSync(stageServer, { recursive: true });

console.log('\nAssembling the panel package...');
cpSync(join(root, 'panel'), join(stagePanel, 'panel'), { recursive: true, filter: ignoreForPackage });
cpSync(aexPath, join(stagePanel, 'vynk.aex'));
cpSync(join(root, 'LICENSE'), join(stagePanel, 'LICENSE'));
cpSync(join(root, 'tools', 'install-teammate.bat'), join(stagePanel, 'install.bat'));
cpSync(join(root, 'tools', 'install-teammate.ps1'), join(stagePanel, 'install.ps1'));
cpSync(join(root, 'tools', 'uninstall-teammate.bat'), join(stagePanel, 'uninstall.bat'));
cpSync(join(root, 'tools', 'uninstall-teammate.ps1'), join(stagePanel, 'uninstall.ps1'));
cpSync(join(root, 'tools', 'diagnose-install.ps1'), join(stagePanel, 'diagnose.ps1'));
writeFileSync(join(stagePanel, 'enable-cep-debug-mode.reg'), cepReg);
writeFileSync(join(stagePanel, 'README.txt'), panelReadme);
writeFileSync(join(stagePanel, 'INSTALL.txt'), panelInstall);
writeFileSync(join(stagePanel, 'VERSION'), version + '\n');

console.log('Assembling the server package...');
for (const file of ['.dockerignore', 'docker-compose.yml', 'package.json', 'package-lock.json', 'LICENSE']) {
  cpSync(join(root, file), join(stageServer, file));
}
cpSync(join(root, 'deploy'), join(stageServer, 'deploy'), { recursive: true, filter: ignoreForPackage });
cpSync(join(root, 'server'), join(stageServer, 'server'), { recursive: true, filter: ignoreForPackage });
cpSync(join(root, 'shared'), join(stageServer, 'shared'), { recursive: true, filter: ignoreForPackage });
writeFileSync(join(stageServer, 'VERSION'), version + '\n');

console.log('Compressing...');
zipDir(stagePanel, panelZip);
zipDir(stageServer, serverZip);

rmSync(stagePanel, { recursive: true, force: true });
rmSync(stageServer, { recursive: true, force: true });

const artifacts = [panelZip, serverZip].map((path) => ({
  name: basename(path),
  bytes: statSync(path).size,
  sha256: sha256(path),
}));

const manifest = { name: 'Vynk', version, built: new Date().toISOString(), files: artifacts };
writeFileSync(join(distDir, `manifest-${version}.json`), JSON.stringify(manifest, null, 2) + '\n');

console.log('\nBuilt artifacts:');
for (const a of artifacts) {
  console.log(`  ${a.name}  ${a.bytes} B  SHA-256 ${a.sha256}`);
}
console.log(`  manifest-${version}.json`);
console.log('\nLocal only - hand these paths + hashes to Andrew; never upload them.\n');
