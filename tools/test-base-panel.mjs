import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import fixture from './panel-test-fixture.cjs';

const { panelFixture, TestSocket } = fixture;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, 16);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vynk-base-panel-'));
  const source = path.join(dir, 'source.aep');
  fs.writeFileSync(source, 'old disk contents');
  const host = { revision: 17, body: 'current shared project', saves: 0, opens: [] };
  function File(name) { this.fsName = path.resolve(name); }
  File.prototype.copy = function (dest) { fs.copyFileSync(this.fsName, dest); return true; };
  host.file = new File(source);
  host.save = () => { host.saves++; fs.writeFileSync(host.file.fsName, host.body); };
  const app = { project: host, open(file) { host.opens.push(file.fsName); host.file = file; host.revision++; } };
  const scripts = [];
  const runScript = (script) => vm.runInNewContext(script, { app, File, JSON });
  TestSocket.sockets = [];
  const panel = panelFixture({ WebSocket: TestSocket, processInfo: { env: { ...process.env, TEMP: dir } } });
  panel.get('serverInput').value = 'ws://127.0.0.1:8787/ws';
  panel.get('roomInput').value = 'ROOMA';
  panel.get('nameInput').value = 'original editor';
  panel.run('connect()');
  TestSocket.sockets[0].welcome('ROOMA', 'self');
  Object.assign(panel.state, { projectPath: source, projectName: 'source.aep', cyclePath: source, rev: 17, relaySeq: 7 });
  panel.set('__eval', (script, cb) => { scripts.push(script); cb(runScript(script)); });
  panel.run('inAE=true;cs={evalScript:__eval};window.confirm=function(){return true;}');
  const oldSocket = TestSocket.sockets[0];
  t.after(async () => {
    panel.run('cancelBaseJob()');
    await sleep(20);
    assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep + 'vynk-base-panel-'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const readyShare = () => {
    Object.assign(panel.state, { sweeping: false, trailOn: false, chase: false, readQueue: [], fullNext: {}, deepQueue: {}, force: {},
      cycleBusy: false, lastChangeAt: Date.now() - 5000, lastSyncAt: Date.now() - 5000 });
    const job = panel.state.baseJob;
    const timer = panel.timers.get(job.timer);
    assert(timer, 'share waited for a full read round');
    panel.timers.delete(job.timer);
    timer.fn();
    return job;
  };
  const baseBytes = Buffer.from('base at sequence zero');
  const base = { name: 'base.aep', seq: 0, hash: hash(baseBytes), size: baseBytes.length };
  return { panel, host, dir, source, scripts, runScript, readyShare, oldSocket, base, baseBytes };
}

test('share saves and uploads an immutable copy at the captured relay prefix', async (t) => {
  const { panel, host, source, readyShare } = setup(t);
  let request;
  panel.set('__upload', (url, file, cb) => { request = { url, file, cb }; });
  panel.run('httpPutFile=__upload;shareBase()');
  assert.equal(request, undefined);
  const job = readyShare();
  assert.equal(host.saves, 1);
  assert.notEqual(request.file, source);
  assert.equal(fs.readFileSync(request.file, 'utf8'), 'current shared project');
  assert.match(request.url, /[?&]seq=7(?:&|$)/);
  fs.writeFileSync(source, 'a newer user save during upload');
  panel.state.relaySeq = 8;
  assert.equal(fs.readFileSync(request.file, 'utf8'), 'current shared project');
  request.cb(null, 200, JSON.stringify({ base: { name: 'source.aep', seq: 7, hash: 'server-hash' } }));
  assert.equal(panel.state.baseInfo.seq, 7);
  assert.equal(panel.state.baseJob, null);
  await sleep(20);
  assert.equal(fs.existsSync(job.dest), false);
  assert.equal(fs.readFileSync(source, 'utf8'), 'a newer user save during upload');
});

test('a changed AE revision retries capture without saving an unknown edit', (t) => {
  const { panel, host, scripts, runScript, readyShare } = setup(t);
  let complete;
  panel.set('__delay', (script, cb) => { scripts.push(script); complete = () => cb(runScript(script)); });
  panel.run('cs.evalScript=__delay;shareBase()');
  const job = readyShare();
  assert.equal(job.phase, 'save');
  panel.run('runCycle()');
  assert.equal(scripts.length, 1);
  host.revision++;
  complete();
  assert.equal(host.saves, 0);
  assert.equal(job.phase, 'wait');
  assert.equal(fs.existsSync(job.dest), false);
});

test('an unavailable host releases the base job rather than leaving sync frozen', (t) => {
  const { panel, readyShare } = setup(t);
  panel.set('__throw', () => { throw new Error('AE closed'); });
  panel.run('cs.evalScript=__throw;shareBase()');
  readyShare();
  assert.equal(panel.state.baseJob, null);
  assert.equal(Boolean(panel.run('baseActionBusy()')), false);
  assert.equal(panel.get('connectBtn').disabled, false);
});

test('capture does not save a different AE project with the same revision', (t) => {
  const { panel, host, dir, runScript, readyShare } = setup(t);
  let complete;
  panel.set('__delay', (script, cb) => { complete = () => cb(runScript(script)); });
  panel.run('cs.evalScript=__delay;shareBase()');
  readyShare();
  const other = path.join(dir, 'different.aep');
  host.file = { fsName: other };
  complete();
  assert.equal(host.saves, 0);
  assert.equal(fs.existsSync(other), false);
  assert.equal(panel.state.baseJob, null);
});

test('an old share response cleans up its copy without changing the new room', async (t) => {
  const { panel, readyShare } = setup(t);
  let complete;
  panel.set('__upload', (url, file, cb) => { complete = cb; });
  panel.run('httpPutFile=__upload;shareBase()');
  const job = readyShare();
  panel.get('roomInput').value = 'ROOMB';
  panel.run('connect()');
  TestSocket.sockets[1].welcome('ROOMB', 'replacement');
  complete(null, 200, JSON.stringify({ base: { name: 'old.aep', seq: 7 } }));
  assert.equal(panel.state.baseInfo, null);
  await sleep(20);
  assert.equal(fs.existsSync(job.dest), false);
});

test('reopening a base requests fresh history on the actual original session', (t) => {
  const { panel, host, base, baseBytes } = setup(t);
  const op = { opId: 'already-applied', kind: 'attr', target: { comp: 'id1|Main', layer: 'id2' }, path: 'label', value: 7 };
  Object.assign(panel.state, { baseInfo: base, replayApplied: true, pendingReplay: null, seenOps: { 'already-applied': 1, 'old-only': 1 } });
  panel.get('serverInput').value = 'ws://127.0.0.1:9999/ws';
  panel.get('roomInput').value = 'ROOMB';
  panel.set('__download', (url, file, cb) => { fs.writeFileSync(file, baseBytes); cb(null, base.hash); });
  panel.run('httpGetToFile=__download;getBase()');
  assert.equal(host.opens.length, 1);
  assert.equal(TestSocket.sockets.length, 2);
  const fresh = TestSocket.sockets[1];
  assert.equal(fresh.url, 'ws://127.0.0.1:8787/ws');
  assert.equal(panel.state.baseHold, 'loading fresh room history');
  assert.equal(panel.state.seenOps['old-only'], undefined);
  fresh.welcome('ROOMA', 'fresh-self', { base, baseSeq: 0, seq: 1, ops: [{ seq: 1, op }] });
  assert.equal(panel.state.baseHold, '');
  assert.equal(panel.state.room, 'ROOMA');
  assert.deepEqual(Array.from(panel.state.inbox, (group) => group[0].opId), ['already-applied']);
  assert.equal(panel.state.cyclePath, host.file.fsName);
  assert.deepEqual(fs.readFileSync(host.file.fsName), baseBytes);
});

test('a base change before fresh welcome holds applies until the latest base is opened', (t) => {
  const { panel, host, base, baseBytes, scripts } = setup(t);
  panel.state.baseInfo = base;
  panel.set('__download', (url, file, cb) => { fs.writeFileSync(file, baseBytes); cb(null, base.hash); });
  panel.run('httpGetToFile=__download;getBase()');
  const newer = { ...base, seq: 1, hash: 'a-different-base' };
  TestSocket.sockets[1].welcome('ROOMA', 'fresh-self', { base: newer, baseSeq: 1, seq: 1 });
  assert.match(panel.state.baseHold, /base changed/);
  const calls = scripts.length;
  panel.run('runCycle();repairTick()');
  assert.equal(scripts.length, calls);
  assert.equal(host.opens.length, 1);
});

test('a new base announcement cannot release history belonging to the old snapshot', (t) => {
  const { panel, base, oldSocket } = setup(t);
  Object.assign(panel.state, { projectName: 'base.aep', baseInfo: null, pendingReplay: [{ seq: 1, op: { opId: 'old-history', kind: 'remove', target: { comp: 'id1|Main', layer: 'id2' } } }], replaySeq: 1 });
  oldSocket.onmessage({ data: JSON.stringify({ t: 'base', base: { ...base, seq: 1 } }) });
  assert.equal(panel.state.inbox.length, 0);
  assert.equal(panel.state.pendingReplay, null);
  assert.match(panel.state.baseHold, /newer base/);
});

test('a new base announcement preserves a posted open until its fresh-welcome check', (t) => {
  const { panel, base, baseBytes, runScript, oldSocket } = setup(t);
  Object.assign(panel.state, { baseInfo: base, pendingReplay: [{ seq: 1, op: { opId: 'held', kind: 'remove', target: { comp: 'id1|Main', layer: 'id2' } } }] });
  let pending;
  panel.set('__host', (script, cb) => {
    if (script.includes('app.open(dest)')) pending = () => cb(runScript(script));
    else cb(runScript(script));
  });
  panel.set('__download', (url, file, cb) => { fs.writeFileSync(file, baseBytes); cb(null, base.hash); });
  panel.run('cs.evalScript=__host;httpGetToFile=__download;getBase()');
  const job = panel.state.baseJob;
  assert.equal(job.phase, 'open');
  const newer = { ...base, seq: 1, hash: 'newer-hash' };
  oldSocket.onmessage({ data: JSON.stringify({ t: 'base', base: newer }) });
  assert.equal(panel.state.baseJob, job);
  pending();
  TestSocket.sockets[1].welcome('ROOMA', 'fresh', { base: newer, baseSeq: 1, seq: 1 });
  assert.match(panel.state.baseHold, /base changed/);
  assert.equal(panel.state.inbox.length, 0);
});

test('new edits made after confirmation abort the guarded AE open', async (t) => {
  const { panel, host, base, baseBytes } = setup(t);
  panel.state.baseInfo = base;
  panel.set('__download', (url, file, cb) => { fs.writeFileSync(file, baseBytes); cb(null, base.hash); });
  panel.set('__changed', () => { host.revision++; return true; });
  panel.run('httpGetToFile=__download;window.confirm=__changed;getBase()');
  assert.equal(host.opens.length, 0);
  assert.equal(panel.state.baseJob, null);
  assert.equal(TestSocket.sockets.length, 1);
});

test('a project switch after confirmation aborts the guarded AE open', (t) => {
  const { panel, host, dir, base, baseBytes } = setup(t);
  panel.state.baseInfo = base;
  panel.set('__download', (url, file, cb) => { fs.writeFileSync(file, baseBytes); cb(null, base.hash); });
  panel.set('__changed', () => { host.file = { fsName: path.join(dir, 'another.aep') }; return true; });
  panel.run('httpGetToFile=__download;window.confirm=__changed;getBase()');
  assert.equal(host.opens.length, 0);
  assert.equal(panel.state.baseJob, null);
});

test('a base never opens when replacement confirmation is unavailable or fails', async (t) => {
  for (const prompt of ['undefined', 'function(){throw new Error("dialog unavailable");}']) {
    await t.test(prompt === 'undefined' ? 'unavailable' : 'failed dialog', (t) => {
      const { panel, host, base, baseBytes } = setup(t);
      panel.state.baseInfo = base;
      panel.set('__download', (url, file, cb) => { fs.writeFileSync(file, baseBytes); cb(null, base.hash); });
      panel.run('httpGetToFile=__download;window.confirm=' + prompt + ';getBase()');
      assert.equal(host.opens.length, 0);
      assert.equal(panel.state.baseJob, null);
      assert.equal(panel.get('connectBtn').disabled, false);
    });
  }
});

test('a dropped socket during a posted open still rebuilds the new project safely', (t) => {
  const { panel, host, base, baseBytes, runScript, oldSocket } = setup(t);
  panel.state.baseInfo = base;
  let pending;
  panel.set('__host', (script, cb) => {
    if (script.includes('app.open(dest)')) pending = () => cb(runScript(script));
    else cb(runScript(script));
  });
  panel.set('__download', (url, file, cb) => { fs.writeFileSync(file, baseBytes); cb(null, base.hash); });
  panel.run('cs.evalScript=__host;httpGetToFile=__download;getBase()');
  assert.equal(panel.state.baseJob.phase, 'open');
  assert.equal(panel.get('connectBtn').disabled, true);
  oldSocket.onclose();
  assert.equal(panel.state.connected, false);
  panel.get('roomInput').value = 'ROOMB';
  panel.run('connect()');
  assert.equal(TestSocket.sockets.length, 1);
  pending();
  assert.equal(host.opens.length, 1);
  assert.equal(TestSocket.sockets.length, 2);
  TestSocket.sockets[1].welcome('ROOMA', 'restored', { base, baseSeq: 0 });
  assert.equal(panel.state.baseHold, '');
  assert.equal(panel.state.room, 'ROOMA');
  assert.equal(panel.get('connectBtn').disabled, false);
});
