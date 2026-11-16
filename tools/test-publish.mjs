import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vynk-publish-test-'));
  t.after(() => {
    assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep + 'vynk-publish-test-'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(dir, 'tools')); fs.mkdirSync(path.join(dir, 'dist'));
  fs.copyFileSync(new URL('./publish.mjs', import.meta.url), path.join(dir, 'tools/publish.mjs'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '0.8.0' }));
  fs.writeFileSync(path.join(dir, 'RELEASE_NOTES.md'), '## [0.8.0]\n\nAnimated controls and independent playheads.\n');
  const files = ['panel', 'server'].map(kind => {
    const name = 'Vynk-0.8.0-' + kind + '.zip', bytes = Buffer.from('package ' + kind);
    fs.writeFileSync(path.join(dir, 'dist', name), bytes);
    return { name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex').toUpperCase() };
  });
  const manifest = { version: '0.8.0', sourceCommit: '1a'.repeat(20), files };
  const writeManifest = () => fs.writeFileSync(path.join(dir, 'dist/manifest-0.8.0.json'), JSON.stringify(manifest));
  const run = () => {
    writeManifest();
    return spawnSync(process.execPath, [path.join(dir, 'tools/publish.mjs'), '--no-build', '--json', '--tag', 'v0.8.0-m3.11'], { encoding: 'utf8', windowsHide: true });
  };
  return { dir, manifest, run, notes: path.join(dir, 'dist/release-notes-0.8.0.md') };
}

test('publish preparation targets the packaged commit and prints one complete upload command', t => {
  const f = fixture(t), result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.sourceCommit, f.manifest.sourceCommit);
  assert(summary.ghCommand.includes('--target ' + f.manifest.sourceCommit));
  assert(!summary.ghCommand.includes('--target main'));
  assert(!summary.ghCommand.includes('\n'));
  for (const artifact of f.manifest.files) assert(summary.ghCommand.includes(artifact.name));
  assert.match(fs.readFileSync(f.notes, 'utf8'), /Animated controls and independent playheads/);
  assert(summary.ghCommand.includes('--prerelease'));
});

test('publish preparation refuses missing source receipts and mismatched package versions', t => {
  const f = fixture(t);
  delete f.manifest.sourceCommit;
  assert.equal(f.run().status, 1);
  f.manifest.sourceCommit = '1a'.repeat(20); f.manifest.version = '0.7.7';
  assert.equal(f.run().status, 1);
  assert(!fs.existsSync(f.notes));
});

test('publish preparation refuses stale artifact bytes before writing release notes', t => {
  const f = fixture(t);
  fs.appendFileSync(path.join(f.dir, 'dist', f.manifest.files[0].name), 'changed');
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /differs from its manifest/);
  assert(!fs.existsSync(f.notes));
});

test('publish preparation refuses artifact paths outside dist', t => {
  const f = fixture(t);
  f.manifest.files[0].name = '../private.zip';
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid artifact path/);
  assert(!fs.existsSync(f.notes));
});
