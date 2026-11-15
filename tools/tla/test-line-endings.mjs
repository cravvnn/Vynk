import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vynk-tla-lines-'));
const files = ['Session.tla', 'Session.cfg', 'Session.mutants.json'];
try {
  for (const newline of ['\n', '\r\n']) {
    for (const name of files) {
      const source = fs.readFileSync(path.join(root, 'panel/src', name), 'utf8').replace(/\r\n?/g, '\n');
      fs.writeFileSync(path.join(dir, name), source.replace(/\n/g, newline));
    }
    for (const target of [path.join(dir, 'Session.tla'), path.relative(root, path.join(dir, 'Session.tla'))]) {
      const result = spawnSync(process.execPath, [path.join(here, 'check.mjs'), target], { cwd: root, encoding: 'utf8', windowsHide: true });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /pass\s+757 states/);
      assert.equal((result.stdout.match(/^kill /gm) || []).length, 4);
    }
  }
  console.log('ok: state checker accepts LF/CRLF models and absolute/relative paths');
} finally {
  assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep + 'vynk-tla-lines-'));
  for (const name of files) fs.unlinkSync(path.join(dir, name));
  fs.rmdirSync(dir);
}
