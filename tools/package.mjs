import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  cpSync,
  existsSync,
  statSync,
  readdirSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { execSync } from 'node:child_process';
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

function copyFile(src, dest) {
  cpSync(src, dest, { preserveTimestamps: true });
}

function copyTree(src, dest) {
  cpSync(src, dest, { recursive: true, filter: ignoreForPackage, preserveTimestamps: true });
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex').toUpperCase();
}

// Minimal zip writer. Names must use forward slashes (APPNOTE), otherwise the
// archive extracts as flat files with literal backslashes on Linux - which is
// exactly where the server package gets unpacked.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zipDir(srcDir, destZip) {
  rmSync(destZip, { force: true });
  const files = [];
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(abs, rel);
      else if (entry.isFile()) files.push({ abs, rel });
    }
  };
  walk(srcDir, '');

  const now = new Date();
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;

  const parts = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const data = readFileSync(file.abs);
    const crc = crc32(data);
    const packed = deflateRawSync(data, { level: 9 });
    const name = Buffer.from(file.rel, 'utf8');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, packed);

    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(20, 6);
    head.writeUInt16LE(0x0800, 8);
    head.writeUInt16LE(8, 10);
    head.writeUInt16LE(dosTime, 12);
    head.writeUInt16LE(dosDate, 14);
    head.writeUInt32LE(crc, 16);
    head.writeUInt32LE(packed.length, 20);
    head.writeUInt32LE(data.length, 24);
    head.writeUInt16LE(name.length, 28);
    head.writeUInt16LE(0, 30);
    head.writeUInt16LE(0, 32);
    head.writeUInt16LE(0, 34);
    head.writeUInt16LE(0, 36);
    head.writeUInt32LE(0, 38);
    head.writeUInt32LE(offset, 42);
    central.push(head, name);

    offset += local.length + name.length + packed.length;
  }

  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  writeFileSync(destZip, Buffer.concat([...parts, dir, end]));
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
     The relay is preconfigured; change the server field only to use another one.

The panel log should start with:
  panel v${version} starting ... text=on

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
copyTree(join(root, 'panel'), join(stagePanel, 'panel'));
copyFile(aexPath, join(stagePanel, 'vynk.aex'));
copyFile(join(root, 'LICENSE'), join(stagePanel, 'LICENSE'));
copyFile(join(root, 'tools', 'install-teammate.bat'), join(stagePanel, 'install.bat'));
copyFile(join(root, 'tools', 'install-teammate.ps1'), join(stagePanel, 'install.ps1'));
copyFile(join(root, 'tools', 'uninstall-teammate.bat'), join(stagePanel, 'uninstall.bat'));
copyFile(join(root, 'tools', 'uninstall-teammate.ps1'), join(stagePanel, 'uninstall.ps1'));
copyFile(join(root, 'tools', 'diagnose-install.ps1'), join(stagePanel, 'diagnose.ps1'));
writeFileSync(join(stagePanel, 'enable-cep-debug-mode.reg'), cepReg);
writeFileSync(join(stagePanel, 'README.txt'), panelReadme);
writeFileSync(join(stagePanel, 'INSTALL.txt'), panelInstall);
writeFileSync(join(stagePanel, 'VERSION'), version + '\n');

console.log('Assembling the server package...');
for (const file of ['.dockerignore', 'docker-compose.yml', 'package.json', 'package-lock.json', 'LICENSE']) {
  copyFile(join(root, file), join(stageServer, file));
}
copyTree(join(root, 'deploy'), join(stageServer, 'deploy'));
copyTree(join(root, 'server'), join(stageServer, 'server'));
copyTree(join(root, 'shared'), join(stageServer, 'shared'));
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
