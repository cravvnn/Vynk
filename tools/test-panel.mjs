import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import fixture from './panel-test-fixture.cjs';
const { panelFixture, TestSocket } = fixture;

test('panel streams base upload/download and reads history using real Node HTTP', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vynk-panel-'));
  const bytes = Buffer.from('Vynk base\0' + 'project bytes\n'.repeat(8192));
  const src = path.join(dir, 'source.aep');
  const dest = path.join(dir, 'download.aep');
  fs.writeFileSync(src, bytes);
  let uploaded = null;
  const history = JSON.stringify({ seq: 1, op: { opId: 'p1' } }) + '\n';
  const server = http.createServer((req, res) => {
    if (req.method === 'PUT') {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => { uploaded = Buffer.concat(chunks); res.end('{"ok":true}'); });
    } else if (req.url === '/aborted-base' || req.url === '/aborted-history') {
      res.writeHead(200, { 'content-length': '65536' });
      res.write('partial');
      setTimeout(() => res.destroy(), 20);
    } else if (req.url === '/history') res.end(history);
    else if (req.url === '/base') res.end(bytes);
    else { res.writeHead(404); res.end('missing'); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep + 'vynk-panel-'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const panel = panelFixture();
  panel.get('serverInput').value = 'ws://127.0.0.1:' + server.address().port + '/ws';
  panel.set('__src', src);
  panel.set('__dest', dest);
  let callbackCount = 0;
  const call = (code) => new Promise((resolve, reject) => {
    callbackCount = 0;
    const deadline = setTimeout(() => reject(new Error('request did not complete')), 3000);
    panel.set('__cb', (err, ...args) => { callbackCount++; clearTimeout(deadline); err ? reject(err) : resolve(args); });
    try { panel.run(code); } catch (err) { clearTimeout(deadline); reject(err); }
  });

  await t.test('share base sends the file and returns the relay response', async () => {
    const [status, body] = await call("httpPutFile('/base', __src, __cb)");
    assert.equal(status, 200);
    assert.equal(body.toString(), '{"ok":true}');
    assert.deepEqual(uploaded, bytes);
  });
  await t.test('history fetch receives the complete text', async () => {
    const [status, body] = await call("httpGetText('/history', __cb)");
    assert.equal(status, 200);
    assert.equal(body, history);
  });
  await t.test('get base writes identical bytes and computes the expected digest', async () => {
    const [digest] = await call("httpGetToFile('/base', __dest, __cb)");
    assert.deepEqual(fs.readFileSync(dest), bytes);
    assert.equal(digest, createHash('sha256').update(bytes).digest('hex').slice(0, 16));
  });
  await t.test('a failed download reports the HTTP status', async () => {
    await assert.rejects(call("httpGetToFile('/missing', __dest, __cb)"), /HTTP 404/);
  });
  await t.test('an interrupted download reports an error instead of completing or hanging', async () => {
    await assert.rejects(call("httpGetToFile('/aborted-base', __dest, __cb)"), /aborted|closed|reset|incomplete/i);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(callbackCount, 1);
  });
  await t.test('an interrupted history response cannot return a partial log', async () => {
    await assert.rejects(call("httpGetText('/aborted-history', __cb)"), /aborted|closed|reset|incomplete/i);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(callbackCount, 1);
  });
});

test('a truncated replay fetches missing post-base history even when baseSeq is zero', () => {
  const panel = panelFixture();
  const op = (n) => ({ opId: 'history-' + n, kind: 'attr', target: { comp: 'id1|Main', layer: 'id2' }, path: 'label', value: n });
  const entries = [1, 2, 3].map((n) => ({ seq: n, op: op(n) }));
  Object.assign(panel.state, {
    projectName: 'base.aep', baseInfo: { name: 'base.aep' }, baseSeq: 0,
    fromSeq: 3, roomToken: 'room-token', replayTruncated: true,
    pendingReplay: [entries[2]]
  });
  let request = '';
  panel.set('__fetch', (url, cb) => {
    request = url;
    cb(null, 200, entries.slice(0, 2).map((e) => JSON.stringify(e)).join('\n'));
  });
  panel.run('inAE=true; cs={}; httpGetText=__fetch; tryApplyReplay();');
  assert.match(request, /after=0&before=3/);
  assert.equal(panel.state.replayTruncated, false);
  assert.equal(panel.state.catchupState, 'applied');
  assert.deepEqual(Array.from(panel.state.inbox, (group) => group[0].opId), ['history-1', 'history-2', 'history-3']);
});

test('a partial or malformed history response cannot release catch-up', async (t) => {
  const entries = [1, 2, 3].map((seq) => ({ seq, op: labelEdit('history-' + seq, seq) }));
  for (const [name, body] of [
    ['missing entry', JSON.stringify(entries[0])],
    ['duplicate entry', [entries[0], entries[0], entries[1]].map(JSON.stringify).join('\n')],
    ['malformed line', [JSON.stringify(entries[0]), 'broken', JSON.stringify(entries[1])].join('\n')]
  ]) {
    await t.test(name, () => {
      const panel = panelFixture();
      Object.assign(panel.state, { projectName: 'base.aep', baseInfo: { name: 'base.aep' }, baseSeq: 0, replaySeq: 3,
        fromSeq: 3, roomToken: 'room-token', replayTruncated: true, pendingReplay: [entries[2]] });
      panel.set('__fetch', (url, cb) => cb(null, 200, body));
      panel.run('inAE=true; cs={}; httpGetText=__fetch; tryApplyReplay()');
      assert.equal(panel.state.replayTruncated, true);
      assert.equal(panel.state.replayApplied, false);
      assert.equal(panel.state.inbox.length, 0);
    });
  }
});

test('an internal welcome gap is held before any operation is applied', () => {
  const panel = panelFixture();
  Object.assign(panel.state, { projectName: 'base.aep', baseInfo: { name: 'base.aep' }, baseSeq: 0, replaySeq: 3,
    pendingReplay: [{ seq: 1, op: labelEdit('first', 1) }, { seq: 3, op: labelEdit('third', 3) }] });
  panel.run('inAE=true; cs={}; tryApplyReplay()');
  assert.equal(panel.state.catchupState, 'held-incomplete');
  assert.equal(panel.state.replayApplied, false);
  assert.equal(panel.state.inbox.length, 0);
});

function connectionPanel(options) {
  TestSocket.sockets = [];
  const panel = panelFixture({ ...options, WebSocket: TestSocket });
  panel.get('serverInput').value = 'ws://127.0.0.1:8787/ws';
  panel.get('nameInput').value = 'test editor';
  panel.get('roomInput').value = 'ROOMA';
  return panel;
}

const labelEdit = (id, value) => ({ opId: id, kind: 'attr', target: { comp: 'id1|Main', layer: 'id2' }, path: 'label', value });

test('an edit waits for welcome when a replacement socket is open', () => {
  const panel = connectionPanel();
  panel.run('connect()');
  TestSocket.sockets[0].welcome('ROOMA', 'old');
  panel.run('connect()');
  const socket = TestSocket.sockets[1];
  socket.readyState = 1;
  panel.set('__ops', [labelEdit('before-welcome', 4)]);
  panel.run('sendOps(__ops)');
  assert.equal(socket.sent.filter((m) => m.t === 'op').length, 0);
  assert.equal(panel.state.outbox.length, 1);
  socket.welcome('ROOMA', 'replacement');
  assert.deepEqual(socket.sent.filter((m) => m.t === 'op').map((m) => m.op.opId), ['before-welcome']);
});

test('a transmitted edit remains durable until its relay echo', () => {
  const panel = connectionPanel();
  panel.run('connect()');
  const socket = TestSocket.sockets[0];
  socket.welcome('ROOMA', 'self');
  panel.set('__ops', [labelEdit('lost-before-relay', 7)]);
  panel.run('sendOps(__ops)');
  assert.deepEqual(socket.sent.filter((m) => m.t === 'op').map((m) => m.op.opId), ['lost-before-relay']);
  assert([...panel.storage.values()].some((v) => v.includes('lost-before-relay')));
  // Drop the frame before the relay receives it, then reload the panel.
  socket.onclose();
  const reloaded = connectionPanel({ storage: panel.storage });
  reloaded.run('connect()');
  const replacement = TestSocket.sockets[0];
  replacement.welcome('ROOMA', 'new-self');
  assert.deepEqual(replacement.sent.filter((m) => m.t === 'op').map((m) => m.op.opId), ['lost-before-relay']);
  replacement.onmessage({ data: JSON.stringify({ t: 'op', author: 'new-self', op: labelEdit('lost-before-relay', 7) }) });
  assert.equal(reloaded.state.outbox.length, 0);
  assert(![...reloaded.storage.values()].some((v) => v.includes('lost-before-relay')));
});

test('a duplicate own echo cannot acknowledge a newer edit to the same target', () => {
  const panel = connectionPanel();
  panel.run('connect()');
  const socket = TestSocket.sockets[0];
  socket.welcome('ROOMA', 'self');
  const first = labelEdit('first', 1);
  const second = labelEdit('second', 2);
  const echo = (op) => socket.onmessage({ data: JSON.stringify({ t: 'op', author: 'self', op }) });
  panel.set('__ops', [first]);
  panel.run('sendOps(__ops)');
  echo(first);
  panel.set('__ops', [second]);
  panel.run('sendOps(__ops)');
  const pending = Object.values(panel.state.pending).reduce((n, count) => n + count, 0);
  assert.equal(pending, 1);
  echo(first);
  assert.equal(Object.values(panel.state.pending).reduce((n, count) => n + count, 0), 1);
  echo(second);
  assert.equal(Object.keys(panel.state.pending).length, 0);
});

test('welcome acknowledges accepted edits before replay and preserves pending offline conflicts', () => {
  const panel = connectionPanel();
  panel.run('connect()');
  const first = TestSocket.sockets[0];
  first.welcome('ROOMA', 'self');
  panel.set('__ops', [labelEdit('accepted', 3)]);
  panel.run('sendOps(__ops)');
  panel.run('connect()');
  const current = TestSocket.sockets[1];
  current.welcome('ROOMA', 'new-self', { accepted: ['accepted'] });
  assert.equal(current.sent.filter((m) => m.t === 'op').length, 0);
  assert.equal(panel.state.outbox.length, 0);
  panel.run('inAE=true; cs={};');
  current.readyState = 3;
  panel.set('__ops', [labelEdit('offline-conflict', 8)]);
  panel.run('sendOps(__ops)');
  panel.run('connect()');
  const returned = TestSocket.sockets[2];
  returned.welcome('ROOMA', 'back', {
    base: { name: 'base.aep' },
    ops: [{ seq: 1, op: labelEdit('accepted', 3) }, { seq: 2, op: labelEdit('older-remote', 4) }]
  });
  panel.state.projectName = 'base.aep';
  panel.run('tryApplyReplay()');
  assert.equal(panel.state.inbox.length, 0);
  assert(panel.state.lwwSkips > 0);
  assert.deepEqual(returned.sent.filter((m) => m.t === 'op').map((m) => m.op.opId), ['offline-conflict']);
});

test('accepted edits protect against older replay while later relay edits still win', async (t) => {
  for (const [name, later] of [['accepted is last', false], ['remote is later', true]]) {
    await t.test(name, () => {
      const panel = connectionPanel();
      panel.run('connect()');
      TestSocket.sockets[0].welcome('ROOMA', 'self');
      const own = labelEdit('accepted-own-88', 88);
      panel.set('__ops', [own]);
      panel.run('sendOps(__ops); connect()');
      panel.state.projectName = 'base.aep';
      panel.run('inAE=true; cs={};');
      const ops = [{ seq: 1, op: labelEdit('older-missed-11', 11) }, { seq: 2, op: own }];
      if (later) ops.push({ seq: 3, op: labelEdit('later-remote-99', 99) });
      TestSocket.sockets[1].welcome('ROOMA', 'returned', { accepted: [own.opId], base: { name: 'base.aep' }, ops });
      let value = 88;
      for (const group of panel.state.inbox) for (const op of group) value = op.value;
      assert.equal(value, later ? 99 : 88);
      assert(!panel.state.inbox.some((group) => group.some((op) => op.opId === 'older-missed-11')));
      assert.equal(panel.state.outbox.length, 0);
    });
  }
});

test('accepted scalar protection survives reload and a fetched history prefix', () => {
  const panel = connectionPanel();
  panel.run('connect()');
  TestSocket.sockets[0].welcome('ROOMA', 'self');
  const own = labelEdit('accepted-before-reload', 88);
  panel.set('__ops', [own]);
  panel.run('sendOps(__ops)');
  const reloaded = connectionPanel({ storage: panel.storage });
  reloaded.run('inAE=true; cs={}; connect()');
  reloaded.state.projectName = 'base.aep';
  const older = { seq: 1, op: labelEdit('missing-prefix-11', 11) };
  reloaded.set('__fetch', (url, cb) => cb(null, 200, JSON.stringify(older) + '\n'));
  reloaded.run('httpGetText=__fetch');
  TestSocket.sockets[0].welcome('ROOMA', 'new-self', { accepted: [own.opId], base: { name: 'base.aep' },
    ops: [{ seq: 2, op: own }], truncated: true, fromSeq: 2 });
  assert.equal(reloaded.state.replayApplied, true);
  assert.equal(reloaded.state.inbox.length, 0);
  assert.equal(reloaded.state.outbox.length, 0);
});

test('replay retains disjoint fields in a batch and never repeats an accepted group removal', () => {
  const panel = connectionPanel();
  panel.run('connect()');
  TestSocket.sockets[0].welcome('ROOMA', 'self');
  const scalar = labelEdit('own-label', 88);
  const removal = { ...labelEdit('own-removal', null), kind: 'grm', path: 'ADBE Effect Parade/ADBE Slider Control#1' };
  panel.set('__ops', [scalar, removal]);
  panel.run('sendOps(__ops); connect()');
  const own = panel.state.outbox[0];
  panel.state.projectName = 'base.aep';
  panel.run('inAE=true; cs={};');
  const disjoint = { ...labelEdit('missed-name', 'remote name'), path: 'name' };
  const remote = { opId: 'older-batch', kind: 'batch', target: { comp: 'id1|Main' },
    value: { ops: [labelEdit('older-label', 11), disjoint] } };
  TestSocket.sockets[1].welcome('ROOMA', 'returned', { accepted: [own.opId], base: { name: 'base.aep' },
    ops: [{ seq: 1, op: remote }, { seq: 2, op: own }] });
  assert.deepEqual(Array.from(panel.state.inbox, (group) => Array.from(group, (op) => op.opId)), [['missed-name']]);
});

test('an accepted edit before the replay anchor cannot hide a later remote value', () => {
  const panel = connectionPanel();
  panel.run('connect()');
  TestSocket.sockets[0].welcome('ROOMA', 'self');
  const own = labelEdit('pre-base-own', 88);
  panel.set('__ops', [own]);
  panel.run('sendOps(__ops); connect()');
  panel.state.projectName = 'base.aep';
  panel.run('inAE=true; cs={};');
  TestSocket.sockets[1].welcome('ROOMA', 'returned', { accepted: [own.opId], base: { name: 'base.aep' }, baseSeq: 2,
    ops: [{ seq: 3, op: labelEdit('after-base-99', 99) }] });
  assert.deepEqual(Array.from(panel.state.inbox, (group) => group[0].value), [99]);
});

test('live edits wait behind a fetched replay prefix and retain relay order', () => {
  const panel = connectionPanel();
  panel.run('connect()');
  TestSocket.sockets[0].welcome('ROOMA', 'self');
  const own = labelEdit('own-before-fetch', 88);
  panel.set('__ops', [own]);
  panel.run('sendOps(__ops); connect()');
  panel.state.projectName = 'base.aep';
  let finishFetch;
  panel.set('__fetch', (url, cb) => { finishFetch = cb; });
  panel.run('inAE=true; cs={}; httpGetText=__fetch');
  const socket = TestSocket.sockets[1];
  socket.welcome('ROOMA', 'returned', { accepted: [own.opId], base: { name: 'base.aep' }, seq: 3,
    ops: [{ seq: 2, op: own }, { seq: 3, op: labelEdit('replay-33', 33) }], truncated: true, fromSeq: 2 });
  panel.state.lastChangeAt = 0;
  panel.state.lastSyncAt = 0;
  assert.equal(panel.run('caughtUp()'), false, 'repair cannot use a project missing its replay prefix');
  socket.onmessage({ data: JSON.stringify({ t: 'op', seq: 4, author: 'peer', op: labelEdit('live-99', 99) }) });
  assert.equal(panel.state.inbox.length, 0, 'native apply cannot overtake the missing history');
  finishFetch(null, 200, JSON.stringify({ seq: 1, op: labelEdit('prefix-11', 11) }) + '\n');
  let value = 88;
  for (const group of panel.state.inbox) for (const op of group) value = op.value;
  assert.equal(value, 99);
  assert.deepEqual(Array.from(panel.state.inbox, (group) => group[0].opId), ['replay-33', 'live-99']);
});

test('an own echo received during history fetch protects against the entire older prefix', () => {
  const panel = connectionPanel();
  panel.run('connect()');
  TestSocket.sockets[0].welcome('ROOMA', 'self');
  const own = labelEdit('own-accepted-during-fetch', 123);
  panel.set('__ops', [own]);
  panel.run('sendOps(__ops); connect()');
  panel.state.projectName = 'base.aep';
  let finishFetch;
  panel.set('__fetch', (url, cb) => { finishFetch = cb; });
  panel.run('inAE=true; cs={}; httpGetText=__fetch');
  const socket = TestSocket.sockets[1];
  socket.welcome('ROOMA', 'returned', { base: { name: 'base.aep' }, seq: 2,
    ops: [{ seq: 2, op: labelEdit('replay-before-own', 22) }], truncated: true, fromSeq: 2 });
  socket.onmessage({ data: JSON.stringify({ t: 'op', seq: 3, author: 'returned', op: own }) });
  assert.equal(panel.state.outbox.length, 0);
  finishFetch(null, 200, JSON.stringify({ seq: 1, op: labelEdit('prefix-before-own', 11) }) + '\n');
  assert.equal(panel.state.replayApplied, true);
  assert.equal(panel.state.inbox.length, 0, 'the accepted own edit already present in AE is the latest value');
});

function resumedPanel() {
  const panel = connectionPanel();
  panel.state.projectPath = 'C:/working-copy.aep';
  panel.state.projectName = 'working-copy.aep';
  panel.run('connect()');
  TestSocket.sockets[0].welcome('ROOMA', 'self', { base: { name: 'base.aep', hash: 'old', seq: 0 } });
  panel.run('connect()');
  const socket = TestSocket.sockets[1];
  socket.readyState = 1;
  socket.onopen();
  return { panel, socket, hello: socket.sent.find((m) => m.t === 'hello') };
}

test('an existing project resumes its original prefix across a newer base', () => {
  const { panel, socket, hello } = resumedPanel();
  assert.equal(hello.after, 0);
  assert.equal(hello.token, 'token-ROOMA');
  panel.run('inAE=true;cs={};');
  socket.welcome('ROOMA', 'returned', { after: 0, baseSeq: 1, base: { name: 'base.aep', hash: 'new', seq: 1 },
    ops: [{ seq: 1, op: { ...labelEdit('missed-delete'), kind: 'remove' } }] });
  assert.equal(panel.state.continuingReplay, true);
  assert.equal(panel.state.replayAfter, 0);
  assert.equal(panel.state.baseSeq, 1);
  assert.deepEqual(Array.from(panel.state.inbox, (group) => group[0].opId), ['missed-delete']);
});

test('a base announced during resumed history cannot replace its original anchor', () => {
  const { panel, socket } = resumedPanel();
  let complete;
  panel.set('__fetch', (url, cb) => { assert.match(url, /after=0&before=2/); complete = cb; });
  panel.run('inAE=true;cs={};httpGetText=__fetch');
  socket.welcome('ROOMA', 'returned', { after: 0, baseSeq: 1, base: { name: 'base.aep', hash: 'first', seq: 1 },
    seq: 2, ops: [{ seq: 2, op: labelEdit('tail-22', 22) }], truncated: true, fromSeq: 2 });
  socket.onmessage({ data: JSON.stringify({ t: 'base', base: { name: 'base.aep', hash: 'second', seq: 2 } }) });
  assert.equal(panel.state.baseSeq, 2);
  assert.equal(panel.state.replayAfter, 0);
  assert.equal(panel.state.baseHold, '');
  assert.equal(panel.state.fetchingHistory, true);
  complete(null, 200, JSON.stringify({ seq: 1, op: { ...labelEdit('missed-delete'), kind: 'remove' } }));
  assert.deepEqual(Array.from(panel.state.inbox, (group) => group[0].opId), ['missed-delete', 'tail-22']);
});

test('resume holds when the project, token or relay proof changes during reconnect', async (t) => {
  for (const change of ['project', 'token', 'old relay']) {
    await t.test(change, () => {
      const { panel, socket } = resumedPanel();
      if (change === 'project') panel.run("resetBaselines();state.projectPath='C:/another/base.aep';state.projectName='base.aep';");
      panel.run('inAE=true;cs={};');
      socket.welcome('ROOMA', 'returned', { after: change === 'old relay' ? undefined : 0,
        token: change === 'token' ? 'new-room-token' : 'token-ROOMA', baseSeq: 1, base: { name: 'base.aep', hash: 'new', seq: 1 },
        seq: 1, ops: change === 'old relay' ? [] : [{ seq: 1, op: labelEdit('unsafe-old-replay', 11) }] });
      assert(panel.state.baseHold);
      assert.equal(panel.state.inbox.length, 0);
      assert.equal(panel.state.continuingReplay, false);
    });
  }
});

test('a different project with the same filename cannot inherit a held replay', () => {
  const { panel, socket } = resumedPanel();
  let complete;
  panel.set('__fetch', (url, cb) => { complete = cb; });
  panel.run('inAE=true;cs={};httpGetText=__fetch');
  socket.welcome('ROOMA', 'returned', { after: 0, baseSeq: 1, base: { name: 'base.aep', seq: 1 },
    seq: 2, ops: [{ seq: 2, op: labelEdit('tail', 22) }], truncated: true, fromSeq: 2 });
  panel.run("resetBaselines();state.projectPath='C:/different/base.aep';state.projectName='base.aep';tryApplyReplay();");
  complete(null, 200, JSON.stringify({ seq: 1, op: labelEdit('prefix', 11) }));
  assert.match(panel.state.baseHold, /project changed/);
  assert.equal(panel.state.inbox.length, 0);
});

test('an old socket replay cannot falsely mark an unchanged project as changed', () => {
  const { panel, socket } = resumedPanel();
  const requests = [];
  panel.set('__fetch', (url, cb) => { requests.push(cb); });
  panel.run('inAE=true;cs={};httpGetText=__fetch');
  const welcome = { after: 0, baseSeq: 1, base: { name: 'base.aep', seq: 1 },
    seq: 2, ops: [{ seq: 2, op: labelEdit('tail', 22) }], truncated: true, fromSeq: 2 };
  socket.welcome('ROOMA', 'returned', welcome);
  panel.run('connect();tryApplyReplay()');
  assert.equal(panel.state.baseHold, '', 'replacement welcome has not arrived yet');
  const replacement = TestSocket.sockets[2];
  replacement.readyState = 1;
  replacement.onopen();
  replacement.welcome('ROOMA', 'replacement', welcome);
  assert.equal(panel.state.baseHold, '');
  requests[0](null, 200, JSON.stringify({ seq: 1, op: labelEdit('stale-prefix', 11) }));
  assert.equal(panel.state.inbox.length, 0);
  requests[1](null, 200, JSON.stringify({ seq: 1, op: labelEdit('current-prefix', 11) }));
  assert.deepEqual(Array.from(panel.state.inbox, (group) => group[0].opId), ['current-prefix', 'tail']);
});

test('a project changed between sockets stays held even when the new filename matches the base', () => {
  const { panel, socket } = resumedPanel();
  panel.set('__fetch', () => {});
  panel.run('inAE=true;cs={};httpGetText=__fetch');
  socket.welcome('ROOMA', 'returned', { after: 0, baseSeq: 1, base: { name: 'base.aep', seq: 1 },
    seq: 2, ops: [{ seq: 2, op: labelEdit('tail-old-project', 22) }], truncated: true, fromSeq: 2 });
  panel.run("connect();resetBaselines();state.projectPath='C:/other/base.aep';state.projectName='base.aep';");
  const replacement = TestSocket.sockets[2];
  replacement.readyState = 1;
  replacement.onopen();
  assert.equal(replacement.sent.find((m) => m.t === 'hello').after, undefined);
  replacement.welcome('ROOMA', 'replacement', { baseSeq: 1, base: { name: 'base.aep', seq: 1 },
    seq: 2, ops: [{ seq: 2, op: labelEdit('unsafe-other-project', 22) }] });
  assert(panel.state.baseHold, 'a new welcome cannot erase the detected project replacement');
  assert.equal(panel.state.inbox.length, 0);
});

test('resume context is never restored from localStorage after frontend reload', () => {
  const { panel } = resumedPanel();
  const reloaded = connectionPanel({ storage: panel.storage });
  reloaded.run('connect()');
  const socket = TestSocket.sockets[0];
  socket.readyState = 1;
  socket.onopen();
  const hello = socket.sent.find((m) => m.t === 'hello');
  assert.equal(hello.after, undefined);
  assert.equal(hello.token, undefined);
});

test('recovery refuses a replaced room or a different project without sending saved edits', async (t) => {
  for (const scope of ['room', 'project', 'legacy relay']) {
    await t.test(scope, () => {
      const panel = connectionPanel();
      panel.state.projectPath = 'C:/original.aep';
      panel.run('connect()');
      TestSocket.sockets[0].welcome('ROOMA', 'self');
      panel.set('__ops', [labelEdit('scoped-edit', 6)]);
      panel.run('sendOps(__ops); connect()');
      const returned = TestSocket.sockets[1];
      if (scope === 'project') panel.state.projectPath = 'C:/another.aep';
      returned.welcome('ROOMA', 'new-self', scope === 'room' ? { token: 'replacement-room-token' } : scope === 'legacy relay' ? { accepted: undefined } : {});
      assert.equal(returned.sent.filter((m) => m.t === 'op').length, 0);
      assert.equal(panel.state.outbox.length, 1);
      assert(panel.state.deliveryError);
      assert.equal(panel.run('caughtUp()'), false);
      assert([...panel.storage.values()].some((v) => v.includes('scoped-edit')));
    });
  }
});

test('storage exhaustion keeps the old queue and pauses recovery across reload', () => {
  class LimitedStorage extends Map {
    set(key, value) {
      if (key.startsWith('collab.outbox.') && JSON.parse(value).ops.length > 1) throw new Error('quota exceeded');
      return super.set(key, value);
    }
  }
  const storage = new LimitedStorage();
  const panel = connectionPanel({ storage });
  panel.run('connect()');
  const socket = TestSocket.sockets[0];
  socket.welcome('ROOMA', 'self');
  socket.readyState = 3;
  for (const id of ['first-kept', 'second-local']) {
    panel.set('__ops', [labelEdit(id, 6)]);
    panel.run('sendOps(__ops)');
  }
  assert.equal(panel.state.outbox.length, 2);
  assert.match(panel.state.deliveryError, /storage/);
  const saved = JSON.parse(storage.get(panel.state.outboxKey));
  assert.deepEqual(saved.ops.map((op) => op.opId), ['first-kept']);
  assert.equal(saved.stopped, 1);
  const reloaded = connectionPanel({ storage });
  reloaded.run('connect()');
  const returned = TestSocket.sockets[0];
  returned.welcome('ROOMA', 'replacement');
  assert(reloaded.state.deliveryError);
  assert.equal(returned.sent.filter((m) => m.t === 'op').length, 0);
});

test('a full recovery queue pauses without trimming older edits', () => {
  const panel = connectionPanel();
  panel.run('MAX_OUTBOX=2; connect()');
  const socket = TestSocket.sockets[0];
  socket.welcome('ROOMA', 'self');
  socket.readyState = 3;
  for (const id of ['kept-a', 'kept-b', 'new-local']) {
    panel.set('__ops', [labelEdit(id, 6)]);
    panel.run('sendOps(__ops)');
  }
  assert.deepEqual(Array.from(panel.state.outbox, (op) => op.opId), ['kept-a', 'kept-b']);
  assert.match(panel.state.deliveryError, /full/);
  assert.equal(JSON.parse(panel.storage.get(panel.state.outboxKey)).stopped, 1);
});

test('base actions wait while a local edit remains unacknowledged', () => {
  const panel = connectionPanel();
  panel.run('connect()');
  TestSocket.sockets[0].welcome('ROOMA', 'self');
  panel.state.projectPath = 'C:/saved.aep';
  panel.state.baseInfo = { name: 'saved.aep' };
  panel.set('__ops', [labelEdit('not-acknowledged', 4)]);
  panel.run('sendOps(__ops)');
  let requests = 0;
  panel.set('__request', () => { requests++; });
  panel.run('inAE=true; cs={}; httpPutFile=__request; httpGetToFile=__request; shareBase(); getBase();');
  assert.equal(requests, 0);
  assert.equal(panel.state.outbox.length, 1);
});

test('leaving a room stops capturing further edits for that room', () => {
  const panel = connectionPanel();
  panel.run('connect()');
  TestSocket.sockets[0].welcome('ROOMA', 'self');
  panel.set('__ops', [labelEdit('before-leave', 1)]);
  panel.run('sendOps(__ops); leaveRoom()');
  panel.set('__ops', [labelEdit('after-leave', 2)]);
  panel.run('sendOps(__ops)');
  assert.equal(panel.state.outbox.length, 0);
  assert.equal(panel.state.everConnected, false);
  assert.equal(panel.state.connected, false);
  assert.equal(Object.keys(panel.state.pending).length, 0);
});

test('a late host-info reply cannot restore the previous project path', () => {
  const panel = panelFixture();
  let callback;
  panel.set('__capture', (code, cb) => { callback = cb; });
  panel.run('inAE=true; cs={evalScript:__capture}; fetchHostInfo(null)');
  panel.state.projectPath = 'C:/new-project.aep';
  panel.run('resetBaselines()');
  callback(JSON.stringify({ projectName: 'old-project.aep', projectPath: 'C:/old-project.aep' }));
  assert.equal(panel.state.projectPath, 'C:/new-project.aep');
  assert.equal(panel.state.deliveryError, '');
});

test('a delayed close from an old socket cannot disconnect the replacement', () => {
  const panel = connectionPanel();
  panel.run('connect()');
  const old = TestSocket.sockets[0];
  old.welcome('ROOMA', 'old');
  panel.get('roomInput').value = 'ROOMB';
  panel.run('connect()');
  const current = TestSocket.sockets[1];
  current.welcome('ROOMB', 'new');
  old.onclose();
  assert.equal(panel.state.connected, true);
  assert.equal(panel.state.selfId, 'new');
  assert.equal(panel.state.room, 'ROOMB');
});

test('automatic reconnect uses its original session while connection inputs are edited', () => {
  const panel = connectionPanel();
  panel.run('connect()');
  TestSocket.sockets[0].welcome('ROOMA', 'self');
  panel.set('__ops', [labelEdit('resume-original-room', 4)]);
  panel.run('sendOps(__ops)');
  TestSocket.sockets[0].onclose();
  panel.get('serverInput').value = 'ws://127.0.0.1:9999/ws';
  panel.get('roomInput').value = 'ROOMB';
  const retry = [...panel.timers.entries()].find(([, timer]) => timer.ms === 3000);
  assert(retry);
  panel.timers.delete(retry[0]);
  retry[1].fn();
  const socket = TestSocket.sockets[1];
  assert.equal(socket.url, 'ws://127.0.0.1:8787/ws');
  socket.welcome('ROOMA', 'returned');
  assert.deepEqual(socket.sent.filter((m) => m.t === 'op').map((m) => m.op.opId), ['resume-original-room']);
  assert.equal(panel.state.room, 'ROOMA');
});

test('offline edits stay with their original room when switching rooms', () => {
  const panel = connectionPanel();
  panel.run('connect()');
  const old = TestSocket.sockets[0];
  old.welcome('ROOMA', 'old');
  old.readyState = 3;
  panel.run("send({t:'op',op:{opId:'offline-a',kind:'attr',target:{comp:'id1|Main',layer:'id2'},path:'label',value:6}})");
  assert.equal(panel.state.outbox.length, 1);
  panel.get('roomInput').value = 'ROOMB';
  panel.run('connect()');
  const current = TestSocket.sockets[1];
  current.welcome('ROOMB', 'new');
  assert.equal(current.sent.filter((m) => m.t === 'op').length, 0);
  assert([...panel.storage.values()].some((v) => v.includes('offline-a')));
  panel.get('roomInput').value = 'ROOMA';
  panel.run('connect()');
  const returned = TestSocket.sockets[2];
  returned.welcome('ROOMA', 'back');
  assert.deepEqual(returned.sent.filter((m) => m.t === 'op').map((m) => m.op.opId), ['offline-a']);
});

test('old hello callbacks and messages cannot reach the replacement room', () => {
  const panel = connectionPanel();
  const hostCallbacks = [];
  panel.set('__hostCallbacks', hostCallbacks);
  panel.run('inAE=true; cs={evalScript:function(code,cb){__hostCallbacks.push(cb);}}; connect();');
  const old = TestSocket.sockets[0];
  old.readyState = 1;
  old.onopen();
  panel.get('roomInput').value = 'ROOMB';
  panel.run('connect()');
  const current = TestSocket.sockets[1];
  current.readyState = 1;
  current.onopen();
  hostCallbacks[0]('{"projectName":"pair.aep","projectPath":""}');
  assert.equal(current.sent.filter((m) => m.t === 'hello').length, 0);
  hostCallbacks[1]('{"projectName":"pair.aep","projectPath":""}');
  assert.deepEqual(current.sent.filter((m) => m.t === 'hello').map((m) => m.room), ['ROOMB']);
  current.welcome('ROOMB', 'new');
  old.welcome('ROOMA', 'stale');
  old.onmessage({ data: JSON.stringify({ t: 'op', author: 'peer-a', op: { opId: 'stale-op', kind: 'attr', target: { comp: 'id1|Main', layer: 'id2' }, path: 'label', value: 9 } }) });
  assert.equal(panel.state.selfId, 'new');
  assert.equal(panel.state.room, 'ROOMB');
  assert.equal(panel.state.inbox.length, 0);
  assert.equal(panel.state.seenOps['stale-op'], undefined);
});

test('an old AE reply cannot clear the new room cycle while it is busy', () => {
  const panel = panelFixture();
  const replies = [];
  panel.set('__replies', replies);
  panel.run('inAE=true;cs={evalScript:function(code,cb){__replies.push(cb);}};runCycle();');
  assert.equal(panel.state.cycleBusy, true);
  panel.run('switchRoom();runCycle();');
  assert.equal(panel.state.cycleBusy, true);
  replies[0]('{}');
  assert.equal(panel.state.cycleBusy, true);
});

function historyRequest(panel) {
  Object.assign(panel.state, {
    projectName: 'base.aep', baseInfo: { name: 'base.aep' }, baseSeq: 0,
    fromSeq: 2, roomToken: 'token-a', replayTruncated: true,
    pendingReplay: [{ seq: 2, op: { opId: 'tail', kind: 'attr', target: { comp: 'id1|Main', layer: 'id2' }, path: 'label', value: 4 } }]
  });
  let complete;
  panel.set('__fetchHistory', (url, cb) => { complete = cb; });
  panel.run('inAE=true;cs={};httpGetText=__fetchHistory;tryApplyReplay();');
  assert.equal(typeof complete, 'function');
  return () => complete(null, 200, JSON.stringify({ seq: 1, op: { opId: 'old-history', kind: 'attr', target: { comp: 'id1|Main', layer: 'id2' }, path: 'label', value: 3 } }));
}

test('a late history response cannot enter the replacement room or clear its fetch', () => {
  const panel = connectionPanel();
  panel.run('connect()');
  TestSocket.sockets[0].welcome('ROOMA', 'first');
  const complete = historyRequest(panel);
  panel.get('roomInput').value = 'ROOMB';
  panel.run('connect()');
  TestSocket.sockets[1].welcome('ROOMB', 'second');
  panel.state.fetchingHistory = true;
  complete();
  assert.equal(panel.state.pendingReplay, null);
  assert.equal(panel.state.inbox.length, 0);
  assert.equal(panel.state.fetchingHistory, true);
});

test('changing project baselines invalidates a pending history request', () => {
  const panel = connectionPanel();
  panel.run('connect()');
  TestSocket.sockets[0].welcome('ROOMA', 'first');
  const complete = historyRequest(panel);
  const pending = panel.state.pendingReplay;
  panel.run("resetBaselines();state.projectName='other.aep';");
  assert.equal(panel.state.fetchingHistory, false);
  complete();
  assert.equal(panel.state.pendingReplay, pending);
  assert.equal(panel.state.replayTruncated, true);
  assert.equal(panel.state.inbox.length, 0);
});

test('a late share response cannot replace the new room base metadata', () => {
  const panel = connectionPanel();
  panel.run('connect()');
  TestSocket.sockets[0].welcome('ROOMA', 'first');
  panel.state.roomToken = 'token-a';
  panel.state.projectPath = 'C:/throwaway/base.aep';
  let complete;
  panel.set('__upload', (url, src, cb) => { complete = cb; });
  panel.run("httpPutFile=__upload;var uploadJob=newBaseJob('share');uploadJob.phase='upload';uploadJob.dest='unused-test-copy';uploadJob.name='base.aep';uploadJob.seq=0;uploadJob.keep=true;state.baseJob=uploadJob;uploadBase(uploadJob);");
  panel.get('roomInput').value = 'ROOMB';
  panel.run('connect()');
  TestSocket.sockets[1].welcome('ROOMB', 'second');
  complete(null, 200, JSON.stringify({ base: { name: 'old-room.aep' } }));
  assert.equal(panel.state.baseInfo, null);
});

test('a completed old-room download cannot open a project in the new room', () => {
  const panel = panelFixture({ WebSocket: TestSocket, requireModule: (name) => name === 'fs' ? { mkdirSync() {} } : ({ path, url: { URL } })[name] });
  panel.get('serverInput').value = 'ws://127.0.0.1:8787/ws';
  panel.get('roomInput').value = 'ROOMA';
  panel.get('nameInput').value = 'editor';
  panel.run('connect()');
  TestSocket.sockets.at(-1).welcome('ROOMA', 'first');
  Object.assign(panel.state, { roomToken: 'token-a', baseInfo: { name: 'base.aep', hash: 'abc', seq: 0 } });
  const scripts = [];
  panel.set('__scripts', scripts);
  let complete;
  panel.set('__download', (url, dest, cb) => { complete = cb; });
  panel.run('inAE=true;cs={evalScript:function(code,cb){__scripts.push(code);}};window.confirm=function(){return true;};httpGetToFile=__download;getBase();');
  panel.get('roomInput').value = 'ROOMB';
  panel.run('connect()');
  TestSocket.sockets.at(-1).welcome('ROOMB', 'second');
  complete(null, 'abc');
  assert.deepEqual(scripts, []);
});

test('base requests use the connected relay while its editable URL field changes', () => {
  const panel = connectionPanel();
  panel.run('connect()');
  TestSocket.sockets[0].welcome('ROOMA', 'first');
  panel.get('serverInput').value = 'ws://127.0.0.1:9999/ws';
  assert.equal(panel.run('relayHttpBase()'), 'http://127.0.0.1:8787');
});

function nativeReadPanel() {
  const panel = panelFixture();
  const replies = [];
  panel.set('__replies', replies);
  panel.run("inAE=true;cs={evalScript:function(code,cb){__replies.push(cb);}};state.aegp={connected:true,sock:{write:function(){}}};runCycle();");
  replies[0](JSON.stringify({
    r: [], revBefore: 0, rev: 0, active: 'id1', items: [], host: { projectPath: 'C:/old.aep' },
    snaps: [{ id: 'id1|Old', iid: 1, full: 1, s: {}, sel: [], layers: [{ sid: 'id2', lid: 2, kind: 'solid', a: { name: 'Old' }, g: {}, p: { curves: { cx: 1, fx: 1, pi: 1, m: 1 } } }] }]
  }));
  assert.equal(panel.state.cycleBusy, true);
  return { panel, replies, complete: () => panel.run("nativeWaiting['1'](['ARBGET','1','ok','1:1:2:abcd'])") };
}

test('an old native read callback cannot clear a replacement room cycle', () => {
  const { panel, replies, complete } = nativeReadPanel();
  panel.run('switchRoom();runCycle();');
  assert.equal(replies.length, 2);
  assert.equal(panel.state.cycleBusy, true);
  complete();
  assert.equal(panel.state.cycleBusy, true);
});

test('a project reset invalidates old native snapshots and schedules a fresh cycle', () => {
  const { panel, complete } = nativeReadPanel();
  panel.state.everConnected = true;
  panel.run('resetBaselines()');
  complete();
  assert.deepEqual(Object.keys(panel.state.shadows), []);
  assert.equal(panel.state.compId, null);
  assert.notEqual(panel.state.cycleTimer, null);
});

test('a current native snapshot is adopted and the next cycle remains scheduled', () => {
  const { panel, complete } = nativeReadPanel();
  panel.state.everConnected = true;
  complete();
  assert.equal(panel.state.shadows.id1.layers[0].p.curves.v.arb, 'abcd');
  assert.equal(panel.state.cycleBusy, false);
  assert.notEqual(panel.state.cycleTimer, null);
});
