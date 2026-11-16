import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { waitForPng } from './ae-pair/png.mjs';

function image() {
  const chunk = (type, data) => {
    const out = Buffer.alloc(data.length + 12);
    out.writeUInt32BE(data.length); out.write(type, 4); data.copy(out, 8);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0, 100, 150, 200]))), chunk('IEND', Buffer.alloc(0))]);
}

test('render comparison waits for a missing then partially written PNG', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vynk-render-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'attempt.png'), png = image();
  let polls = 0;
  const result = await waitForPng(file, async predicate => {
    assert.equal(predicate(), false, 'missing output is not ready'); polls++;
    fs.writeFileSync(file, png.subarray(0, 20));
    assert.equal(predicate(), false, 'partial output is not ready'); polls++;
    fs.writeFileSync(file, png);
    return predicate();
  });
  assert.equal(polls, 2);
  assert.equal(result.width, 1); assert.equal(result.height, 1);
  assert.deepEqual([...result.pixels], [100, 150, 200]);
});

test('missing current render cannot accept another attempt file', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vynk-render-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'old-attempt.png'), image());
  await assert.rejects(waitForPng(path.join(dir, 'new-attempt.png'), async predicate => predicate()), /rendered PNG not ready/);
});
