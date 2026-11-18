import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { WebSocket } from 'ws';
import fixture from './panel-test-fixture.cjs';

const { panelFixture } = fixture;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const edit = (id, value = 5) => ({ opId: id, kind: 'attr', target: { comp: 'id1|Main', layer: 'id2' }, path: 'label', value });
const batch = (id) => ({ opId: id, kind: 'batch', target: { comp: 'id1|Main' }, value: { ops: [edit(id + '-a'), { ...edit(id + '-b'), kind: 'remove' }] } });

async function until(check, label) {
  const end = Date.now() + 5000;
  while (Date.now() < end) {
    if (await check()) return;
    await sleep(10);
  }
  throw new Error('timed out: ' + label);
}

function getHealth(port) {
  return new Promise((resolve) => {
    http.get('http://127.0.0.1:' + port + '/health', (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

async function relayFixture(t, welcomeLimit = 2) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vynk-delivery-'));
  const rooms = path.join(dir, 'rooms');
  const bases = path.join(dir, 'bases');
  await fs.mkdir(rooms);
  await fs.mkdir(bases);
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  let child;
  const sockets = [];
  const stop = async () => {
    for (const socket of sockets) socket.terminate();
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill();
    await exited;
  };
  const start = async () => {
    child = spawn(process.execPath, ['server/dist/index.js'], {
      env: { ...process.env, PORT: String(port), DATA_DIR: rooms, BASE_DIR: bases, MAX_OPS_IN_WELCOME: String(welcomeLimit) },
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
    });
    let errors = '';
    child.stderr.on('data', (c) => { errors += c; });
    await until(async () => {
      if (child.exitCode !== null) throw new Error('relay exited: ' + errors);
      return Boolean(await getHealth(port));
    }, 'relay startup');
  };
  t.after(async () => {
    await stop();
    const resolved = path.resolve(dir);
    assert(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep + 'vynk-delivery-'));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  const url = 'ws://127.0.0.1:' + port + '/ws';
  const join = async (room, pending, extra = {}) => {
    const socket = new WebSocket(url);
    sockets.push(socket);
    const messages = [];
    socket.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
    socket.on('open', () => socket.send(JSON.stringify({ t: 'hello', proto: 2, room, name: 'probe', aeVersion: 'test', ...(pending === undefined ? {} : { pending }), ...extra })));
    await until(() => messages.some((m) => m.t === 'welcome' || m.t === 'error'), 'welcome or explicit refusal');
    return { socket, messages, welcome: messages.find((m) => m.t === 'welcome'), send: (op) => socket.send(JSON.stringify({ t: 'op', op })) };
  };
  const panel = (room, storage = new Map(), loss = {}) => {
    const wire = [];
    class Socket {
      constructor(endpoint) {
        this.url = endpoint;
        this.socket = new WebSocket(endpoint);
        sockets.push(this.socket);
        this.socket.on('open', () => { if (this.onopen) this.onopen(); });
        this.socket.on('close', () => { if (this.onclose) this.onclose(); });
        this.socket.on('error', () => { if (this.onerror) this.onerror(); });
        this.socket.on('message', (raw) => {
          const data = raw.toString();
          const message = JSON.parse(data);
          if (message.t === 'op' && message.op.opId === loss.echo) {
            loss.dropped = true;
            this.socket.terminate();
            return;
          }
          if (loss.deliveryDelayMs) setTimeout(() => { if (this.onmessage) this.onmessage({ data }); }, loss.deliveryDelayMs);
          else if (this.onmessage) this.onmessage({ data });
        });
      }
      get readyState() { return this.socket.readyState; }
      send(data) {
        const message = JSON.parse(data);
        wire.push(message);
        if (message.t === 'op' && message.op.opId === loss.frame) {
          loss.dropped = true;
          this.socket.terminate();
          return;
        }
        this.socket.send(data);
      }
      close() { this.socket.close(); }
    }
    const instance = panelFixture({ storage, WebSocket: Socket });
    instance.get('serverInput').value = url;
    instance.get('roomInput').value = room;
    instance.get('nameInput').value = 'panel test';
    instance.wire = wire;
    instance.run('connect()');
    return instance;
  };
  return { dir, rooms, bases, url, port, start, stop, join, panel };
}

test('relay receipt and panel recovery across dropped frames, echoes and restarts', async (t) => {
  const relay = await relayFixture(t);
  await relay.start();

  await t.test('a duplicate atomic batch is logged and broadcast once', async () => {
    const author = await relay.join('ONCE1', []);
    const peer = await relay.join('ONCE1');
    const op = batch('one-gesture');
    author.send(op);
    author.send(op);
    await until(() => author.messages.filter((m) => m.t === 'op').length === 2, 'two receipts');
    const received = peer.messages.filter((m) => m.t === 'op');
    assert.equal(received.length, 1);
    assert.equal(received[0].seq, 1);
    assert.deepEqual(received[0].op, op);
    const lines = (await fs.readFile(path.join(relay.rooms, 'ONCE1.jsonl'), 'utf8')).trim().split('\n');
    assert.equal(lines.length, 1);
    assert.deepEqual(JSON.parse(lines[0]).op, op);
  });

  await t.test('a frame lost before acceptance is retried after panel reload', async () => {
    const observer = await relay.join('DROP1', []);
    const loss = { frame: 'lost-frame' };
    const panel = relay.panel('DROP1', new Map(), loss);
    await until(() => panel.state.deliveryReady, 'first panel welcome');
    panel.set('__edits', [edit('lost-frame')]);
    panel.run('sendOps(__edits)');
    await until(() => loss.dropped && !panel.state.connected, 'lost frame disconnect');
    assert.equal(observer.messages.filter((m) => m.t === 'op').length, 0);
    assert.equal(panel.state.outbox.length, 1);
    const reloaded = relay.panel('DROP1', panel.storage);
    await until(() => reloaded.state.deliveryReady && reloaded.state.outbox.length === 0, 'retry acknowledgment');
    assert.equal(observer.messages.filter((m) => m.t === 'op' && m.op.opId === 'lost-frame').length, 1);
    assert.deepEqual(reloaded.wire.find((m) => m.t === 'hello').pending, ['lost-frame']);
  });

  await t.test('a lost echo is reconciled after relay restart without resending a batch', async () => {
    const loss = { echo: 'lost-echo' };
    const panel = relay.panel('DROP2', new Map(), loss);
    await until(() => panel.state.deliveryReady, 'panel welcome');
    panel.set('__edits', batch('lost-echo').value.ops);
    // The wire ID for a multi-op diff is the first inner ID + b.
    loss.echo = 'lost-echo-ab';
    panel.run('sendOps(__edits)');
    await until(() => loss.dropped && !panel.state.connected, 'lost echo disconnect');
    assert.equal(panel.state.outbox.length, 1);
    await relay.stop();
    await relay.start();
    const reloaded = relay.panel('DROP2', panel.storage);
    await until(() => reloaded.state.deliveryReady && reloaded.state.outbox.length === 0, 'committed receipt after restart');
    assert.equal(reloaded.wire.filter((m) => m.t === 'op').length, 0);
    const log = (await fs.readFile(path.join(relay.rooms, 'DROP2.jsonl'), 'utf8')).trim().split('\n');
    assert.equal(log.length, 1);
    assert.equal(JSON.parse(log[0]).op.kind, 'batch');
  });

  await t.test('a failed log append never acknowledges the edit and a retry recovers it', async () => {
    const logPath = path.join(relay.rooms, 'WRITE1.jsonl');
    const panel = relay.panel('WRITE1');
    await until(() => panel.state.deliveryReady, 'write-failure panel welcome');
    await fs.mkdir(logPath);
    panel.set('__edits', [edit('not-written')]);
    panel.run('sendOps(__edits)');
    await until(() => !panel.state.connected, 'write failure closes the connection');
    assert.equal(panel.state.outbox.length, 1);
    assert([...panel.storage.values()].some((v) => v.includes('not-written')));
    await fs.rmdir(logPath);
    const recovered = relay.panel('WRITE1', panel.storage);
    await until(() => recovered.state.deliveryReady && recovered.state.outbox.length === 0, 'successful retry after storage is repaired');
    const entries = (await fs.readFile(logPath, 'utf8')).trim().split('\n');
    assert.equal(entries.length, 1);
    assert.equal(JSON.parse(entries[0]).op.opId, 'not-written');
  });

  await t.test('closing the last peer drains outstanding appends before the next join', async () => {
    const original = await relay.join('DRAIN1', []);
    const pending = Array.from({ length: 80 }, (_, i) => 'draining-' + i);
    for (const id of pending) original.send(edit(id));
    const closed = new Promise((resolve) => original.socket.once('close', resolve));
    original.socket.close();
    await closed;
    const recovered = await relay.join('DRAIN1', pending);
    assert.equal(recovered.welcome.seq, 80);
    assert.deepEqual(new Set(recovered.welcome.accepted), new Set(pending));
    assert.equal(recovered.welcome.token, original.welcome.token);
    const entries = (await fs.readFile(path.join(relay.rooms, 'DRAIN1.jsonl'), 'utf8')).trim().split('\n');
    assert.equal(entries.length, 80);
    assert.deepEqual(entries.map((line) => JSON.parse(line).seq), Array.from({ length: 80 }, (_, i) => i + 1));
  });

  await t.test('a large offline queue drains without exceeding the relay message rate', async () => {
    const observer = await relay.join('BURST1', []);
    const storage = new Map();
    const ops = Array.from({ length: 450 }, (_, i) => edit('offline-' + i));
    storage.set('collab.outbox.' + relay.url + '|BURST1', JSON.stringify({ ops, token: observer.welcome.token, project: '', stopped: 0 }));
    const panel = relay.panel('BURST1', storage);
    const pump = setInterval(() => {
      for (const [id, timer] of panel.timers) {
        if (timer.dueAt > Date.now()) continue;
        panel.timers.delete(id);
        timer.fn();
      }
    }, 10);
    try {
      await until(() => panel.state.deliveryReady && panel.state.outbox.length === 0, 'large offline queue acknowledgment');
    } finally { clearInterval(pump); }
    assert.equal(panel.state.reconnects, 0);
    assert.equal(observer.messages.filter((m) => m.t === 'op').length, 450);
    assert.equal(new Set(observer.messages.filter((m) => m.t === 'op').map((m) => m.op.opId)).size, 450);
  });
});

test('pending receipts cover history older than memory and refuse incomplete evidence', async (t) => {
  const relay = await relayFixture(t);
  const entries = Array.from({ length: 5010 }, (_, i) => ({ seq: i + 1, author: 'old', ts: i, op: edit('history-' + i) }));
  await fs.writeFile(path.join(relay.rooms, 'LONG1.jsonl'), entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await fs.writeFile(path.join(relay.rooms, 'BROKEN1.jsonl'), entries.slice(1).map((e) => JSON.stringify(e)).join('\n') + '\n');
  await relay.start();

  await t.test('welcome confirms an old accepted ID and rejects no unknown ID', async () => {
    const recovered = await relay.join('LONG1', ['history-0', 'never-accepted']);
    assert.deepEqual(recovered.welcome.accepted, ['history-0']);
    assert.equal(recovered.welcome.truncated, true);
    assert.equal(recovered.welcome.ops.length, 2);
    const observer = await relay.join('LONG1', []);
    recovered.send(entries[0].op);
    await until(() => recovered.messages.some((m) => m.t === 'op'), 'old receipt echo');
    const receipt = recovered.messages.find((m) => m.t === 'op');
    assert.equal(receipt.seq, 1);
    assert.equal(receipt.author, recovered.welcome.selfId);
    assert.equal(observer.messages.filter((m) => m.t === 'op').length, 0);
    recovered.send(edit('never-accepted'));
    await until(() => observer.messages.some((m) => m.t === 'op'), 'previously unknown edit');
    assert.equal(observer.messages.find((m) => m.t === 'op').seq, 5011);
  });

  await t.test('a missing log prefix refuses recovery instead of claiming no IDs were accepted', async () => {
    const recovered = await relay.join('BROKEN1', ['history-0']);
    assert.equal(recovered.welcome, undefined);
    assert.equal(recovered.messages.find((m) => m.t === 'error').code, 'recovery_unavailable');
  });
});

test('a lost own echo cannot replay an older conflicting value after reload', async (t) => {
  const relay = await relayFixture(t);
  await relay.start();
  const author = await relay.join('ORDER1', []);
  const bytes = Buffer.from('private ordered base');
  const upload = baseRequest(relay, author.welcome.token, 0, bytes);
  upload.request.end(bytes);
  assert.equal((await upload.response).status, 200);
  const loss = { echo: 'accepted-own-88' };
  const panel = relay.panel('ORDER1', new Map(), loss);
  await until(() => panel.state.deliveryReady, 'initial panel welcome');
  panel.state.ws.socket.terminate();
  await until(() => !panel.state.connected, 'panel offline');
  author.send(edit('missed-older-11', 11));
  await until(() => author.messages.some((m) => m.t === 'op'), 'older edit accepted');
  panel.set('__edits', [edit('accepted-own-88', 88)]);
  panel.run('sendOps(__edits); connect()');
  await until(() => loss.dropped && !panel.state.connected, 'own echo lost after acceptance');
  const reloaded = relay.panel('ORDER1', panel.storage);
  await until(() => reloaded.state.deliveryReady, 'accepted receipt after reload');
  reloaded.state.projectName = 'base.aep';
  reloaded.run('inAE=true; cs={}; tryApplyReplay()');
  assert.equal(reloaded.state.outbox.length, 0);
  assert.equal(reloaded.state.replayApplied, true);
  assert.equal(reloaded.state.inbox.length, 0, 'physical own value 88 must survive older relay value 11');
  author.send(edit('later-wins-99', 99));
  await until(() => reloaded.state.inbox.length > 0, 'later remote edit');
  assert.deepEqual(Array.from(reloaded.state.inbox, (group) => group[0].value), [99]);
  const log = (await fs.readFile(path.join(relay.rooms, 'ORDER1.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(log.map((entry) => entry.op.value), [11, 88, 99]);
});

test('a live relay edit stays after the real HTTP replay prefix it overtakes', async (t) => {
  const relay = await relayFixture(t);
  await relay.start();
  const author = await relay.join('ORDER2', []);
  const bytes = Buffer.from('private history base');
  const upload = baseRequest(relay, author.welcome.token, 0, bytes);
  upload.request.end(bytes);
  assert.equal((await upload.response).status, 200);
  for (let n = 1; n <= 3; n++) author.send(edit('prefix-' + n, n * 11));
  await until(() => author.messages.filter((m) => m.t === 'op').length === 3, 'ordered prefix');
  const panel = relay.panel('ORDER2');
  await until(() => panel.state.deliveryReady, 'truncated panel welcome');
  let release;
  panel.set('__hold', (cb, err, status, body) => { release = () => cb(err, status, body); });
  panel.state.projectName = 'base.aep';
  panel.run('inAE=true; cs={}; var realHistoryGet=httpGetText; httpGetText=function(q,cb){realHistoryGet(q,function(e,s,b){__hold(cb,e,s,b);});}; tryApplyReplay()');
  await until(() => Boolean(release), 'HTTP prefix received but callback delayed');
  author.send(edit('live-last-99', 99));
  await until(() => panel.state.relaySeq === 4, 'live relay frame during fetch');
  assert.equal(panel.state.inbox.length, 0);
  release();
  assert.equal(panel.state.replayApplied, true);
  assert.deepEqual(Array.from(panel.state.inbox, (group) => group[0].value), [11, 22, 33, 99]);
});

test('reconnect preserves missed edits across a newer base and retains disjoint offline intent', async (t) => {
  const relay = await relayFixture(t);
  await relay.start();
  const author = await relay.join('RESUME1', []);
  const panel = relay.panel('RESUME1');
  panel.state.projectName = 'working-copy.aep';
  await until(() => panel.state.deliveryReady, 'original session');
  panel.state.ws.socket.terminate();
  await until(() => !panel.state.connected, 'offline panel');
  const own = { ...edit('offline-right-9', 9), target: { comp: 'id1|Main', layer: 'id3' } };
  panel.set('__edits', [own]);
  panel.run('sendOps(__edits)');
  author.send({ ...edit('missed-left-remove'), kind: 'remove' });
  await until(() => author.messages.some((m) => m.t === 'op'), 'missed delete committed');
  const bytes = Buffer.from('new base already contains the left deletion');
  const upload = baseRequest(relay, author.welcome.token, 1, bytes);
  upload.request.end(bytes);
  assert.equal((await upload.response).status, 200);
  panel.run('connect()');
  await until(() => panel.state.deliveryReady && panel.state.outbox.length === 0, 'original project resumed');
  panel.run('inAE=true; cs={}; tryApplyReplay()');
  assert(panel.state.inbox.some((group) => group.some((op) => op.opId === 'missed-left-remove')),
    'the new base checkpoint cannot hide a removal still needed by the existing project');
  assert(!panel.state.inbox.some((group) => group.some((op) => op.opId === own.opId)), 'the already-present offline value is not replayed twice');
  assert.equal(author.messages.filter((m) => m.t === 'op' && m.op.opId === own.opId).length, 1);
});

test('relay resume anchors require the matching generation and a valid sequence', async (t) => {
  const relay = await relayFixture(t);
  await relay.start();
  const author = await relay.join('RESUME2', []);
  for (const extra of [{ after: 0, token: 'another-generation' }, { after: -1, token: author.welcome.token },
    { after: 1, token: author.welcome.token }, { after: '0', token: author.welcome.token }]) {
    const refused = await relay.join('RESUME2', [], extra);
    assert.equal(refused.welcome, undefined);
    assert.equal(refused.messages.find((m) => m.t === 'error').code, 'recovery_unavailable');
  }
  const valid = await relay.join('RESUME2', [], { after: 0, token: author.welcome.token });
  assert.equal(valid.welcome.after, 0);
});

test('four panel clients preserve scalar intents through mixed loss, reload, restart and a new base', async (t) => {
  const rounds = Number(process.env.VYNK_RECOVERY_ROUNDS || 120);
  assert(Number.isInteger(rounds) && rounds >= 120 && rounds <= 2000);
  const relay = await relayFixture(t);
  await relay.start();
  let author = await relay.join('VALUES1', []);
  let upload = baseRequest(relay, author.welcome.token, 0, Buffer.from('initial scalar fixture'));
  upload.request.end('initial scalar fixture');
  assert.equal((await upload.response).status, 200);
  const clients = [];
  const issued = new Set();
  let drops = 0;
  const make = (id, storage = new Map(), values = new Map()) => {
    const loss = { deliveryDelayMs: 100 };
    const panel = relay.panel('VALUES1', storage, loss);
    const project = 'C:/private-client-' + id + '/base.aep';
    panel.state.projectPath = project;
    panel.state.projectName = 'base.aep';
    panel.set('__host', (code, cb) => cb(JSON.stringify({ projectPath: project, projectName: 'base.aep' })));
    panel.run('inAE=true;cs={evalScript:__host}');
    return { id, panel, loss, values };
  };
  for (let i = 0; i < 4; i++) clients.push(make(i));
  const key = (op) => op.target.layer + '|' + op.path;
  const pump = () => {
    for (const client of clients) {
      if (client.loss.dropped) {
        drops++;
        delete client.loss.frame;
        delete client.loss.echo;
        delete client.loss.dropped;
      }
      client.panel.run('if(!state.ws)connect(state.session);flushOutbox();tryApplyReplay()');
      for (const group of client.panel.state.inbox.splice(0)) {
        for (const op of group) {
          assert.equal(op.kind, 'prop', 'host simulation covers scalar property writes only');
          client.values.set(key(op), op.value.v);
        }
      }
    }
  };
  const settle = async () => {
    try {
      await until(() => {
        pump();
        for (const client of clients) assert.equal(client.panel.state.deliveryError, '');
        return clients.every(({ panel }) => panel.state.deliveryReady && panel.state.outbox.length === 0 &&
          !panel.state.pendingReplay && !panel.state.fetchingHistory && panel.state.inbox.length === 0);
      }, 'all scalar clients caught up');
    } catch (error) {
      const details = clients.map(({ id, panel }) => ({ id, connected: panel.state.connected, ready: panel.state.deliveryReady,
        outbox: panel.state.outbox.length, replay: panel.state.pendingReplay && panel.state.pendingReplay.length,
        firstReplay: panel.state.pendingReplay && panel.state.pendingReplay[0], after: panel.state.replayAfter,
        through: panel.state.replaySeq, relaySeq: panel.state.relaySeq, baseSeq: panel.state.baseSeq,
        fetching: panel.state.fetchingHistory, tried: panel.state.historyFetchTried, catchup: panel.state.catchupState,
        hold: panel.state.baseHold, error: panel.state.deliveryError }));
      throw new Error(error.message + ': ' + JSON.stringify(details));
    }
  };
  await settle();
  for (let i = 0; i < rounds; i++) {
    const index = i % clients.length;
    let client = clients[index];
    // A new frontend cannot emit host diffs before its first room welcome.
    if (!client.panel.state.everConnected) await until(() => { pump(); return client.panel.state.everConnected; }, 'reloaded scalar client first welcome');
    const op = { ...edit('intent-' + i), kind: 'prop', target: { comp: 'id1|Main', layer: 'id' + (10 + i % 7) },
      path: 'ADBE Transform Group/ADBE Opacity', value: { v: (i * 37) % 97 + 1 } };
    issued.add(op.opId);
    if (i % 17 === 0) client.loss.frame = op.opId;
    else if (i % 13 === 0) client.loss.echo = op.opId;
    client.values.set(key(op), op.value.v);
    client.panel.set('__edits', [op]);
    client.panel.run('sendOps(__edits)');
    if (i % 23 === 11) {
      client.panel.run('wantConnected=false;disconnect()');
      client = clients[index] = make(index, client.panel.storage, client.values);
    }
    pump();
    await sleep(3);
    if (i === 39) {
      await settle();
      await relay.stop();
      await relay.start();
      await settle();
    } else if (i === 79) {
      await settle();
      author = await relay.join('VALUES1', []);
      const bytes = Buffer.from('all four scalar hosts contain checkpoint ' + author.welcome.seq);
      upload = baseRequest(relay, author.welcome.token, author.welcome.seq, bytes);
      upload.request.end(bytes);
      assert.equal((await upload.response).status, 200);
    }
  }
  await settle();
  const log = (await fs.readFile(path.join(relay.rooms, 'VALUES1.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(log.length, issued.size);
  assert.deepEqual(new Set(log.map((entry) => entry.op.opId)), issued);
  const expected = new Map();
  for (const entry of log) expected.set(key(entry.op), entry.op.value.v);
  for (const client of clients) assert.deepEqual(client.values, expected, 'client ' + client.id + ' must hold the last relay value for every target');
  assert(drops >= 8, 'the fault schedules must actually drop frames and echoes');
  t.diagnostic(issued.size + ' intended scalar edits, ' + drops + ' dropped frames/echoes, ' + Math.floor((rounds + 11) / 23) + ' reloads, one relay restart and one advanced base; 100ms incoming delay; four simulated scalar hosts match relay order');
});

function baseRequest(relay, token, seq, bytes) {
  let request;
  let continued;
  const response = new Promise((resolve, reject) => {
    request = http.request({ hostname: '127.0.0.1', port: relay.port, method: 'PUT',
      path: '/base?token=' + token + '&name=base.aep&seq=' + seq,
      headers: { 'content-length': bytes.length, expect: '100-continue' } }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }));
    });
    request.on('error', reject);
    continued = new Promise((resolve) => request.once('continue', resolve));
  });
  return { request, response, continued };
}

test('base snapshots retain their captured checkpoint during upload and restart', async (t) => {
  const relay = await relayFixture(t);
  await relay.start();
  const author = await relay.join('CAPTURE1', []);
  assert.equal(author.welcome.checkpoint, true);
  const bytes = Buffer.from('project captured before the next edit');
  const upload = baseRequest(relay, author.welcome.token, 0, bytes);
  upload.request.write(bytes.subarray(0, 5));
  await upload.continued;
  author.send(edit('after-snapshot'));
  await until(() => author.messages.some((m) => m.t === 'op'), 'edit during base upload');
  upload.request.end(bytes.subarray(5));
  const result = await upload.response;
  assert.equal(result.status, 200);
  assert.equal(result.body.base.seq, 0);
  const late = await relay.join('CAPTURE1', []);
  assert.equal(late.welcome.baseSeq, 0);
  assert.deepEqual(late.welcome.ops.map((e) => e.op.opId), ['after-snapshot']);
  assert.deepEqual(await fs.readFile(path.join(relay.bases, 'CAPTURE1.aep')), bytes);
  await relay.stop();
  // A stale legacy sidecar cannot override the checkpoint committed with metadata.
  await fs.writeFile(path.join(relay.bases, 'CAPTURE1.seq'), '1');
  await relay.start();
  const restarted = await relay.join('CAPTURE1', []);
  assert.equal(restarted.welcome.baseSeq, 0);
  assert.deepEqual(restarted.welcome.ops.map((e) => e.op.opId), ['after-snapshot']);
});

test('a retained base keeps new relay sequences above its expired log', async (t) => {
  const relay = await relayFixture(t);
  await relay.start();
  const author = await relay.join('EXPIRE1', []);
  author.send(edit('in-retained-base', 11));
  await until(() => author.messages.some((m) => m.t === 'op'), 'base prefix committed');
  const bytes = Buffer.from('snapshot contains sequence one');
  const upload = baseRequest(relay, author.welcome.token, 1, bytes);
  upload.request.end(bytes);
  assert.equal((await upload.response).status, 200);
  await relay.stop();
  const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  await fs.utimes(path.join(relay.rooms, 'EXPIRE1.jsonl'), old, old);
  await relay.start();
  const resumed = await relay.join('EXPIRE1', []);
  assert.equal(resumed.welcome.baseSeq, 1);
  assert.equal(resumed.welcome.seq, 1, 'a retained checkpoint is a lower bound for the room sequence');
  resumed.send(edit('after-expiry', 99));
  await until(() => resumed.messages.some((m) => m.t === 'op'), 'new edit after expiry');
  assert.equal(resumed.messages.find((m) => m.t === 'op').seq, 2);
  const late = await relay.join('EXPIRE1', []);
  assert.deepEqual(late.welcome.ops.map((entry) => entry.op.opId), ['after-expiry']);
  const confirmed = await relay.join('EXPIRE1', ['after-expiry']);
  assert(confirmed.welcome, 'the surviving committed record itself proves this exact ID was accepted');
  assert.deepEqual(confirmed.welcome.accepted, ['after-expiry']);
  const unknown = await relay.join('EXPIRE1', ['unknown-before-expiry']);
  assert.equal(unknown.welcome, undefined, 'missing old records cannot prove an unknown ID was never accepted');
  assert.equal(unknown.messages.find((m) => m.t === 'error').code, 'recovery_unavailable');
});

test('a room is unavailable until its generation token is successfully stored', async (t) => {
  const relay = await relayFixture(t);
  const tokenPath = path.join(relay.bases, 'TOKEN1.token');
  await fs.mkdir(tokenPath);
  await relay.start();
  const refused = await relay.join('TOKEN1', []);
  assert.equal(refused.welcome, undefined, 'a failed token write must not publish an ephemeral room generation');
  assert.equal(refused.messages.find((m) => m.t === 'error').code, 'recovery_unavailable');
  await fs.rmdir(tokenPath);
  const accepted = await relay.join('TOKEN1', []);
  assert(accepted.welcome);
  assert.equal(await fs.readFile(tokenPath, 'utf8'), accepted.welcome.token);
  await relay.stop();
  await relay.start();
  const restarted = await relay.join('TOKEN1', []);
  assert.equal(restarted.welcome.token, accepted.welcome.token);
  assert(!(await fs.readdir(relay.bases)).some((name) => name.includes('.tmp-')), 'failed token attempts leave no owned temp files');
});

test('an old token survives restart while the room log is still fresh', async (t) => {
  const relay = await relayFixture(t);
  await relay.start();
  const author = await relay.join('TOKEN2', []);
  author.send(edit('active-room-edit', 44));
  await until(() => author.messages.some((m) => m.t === 'op'), 'fresh room log');
  await relay.stop();
  const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  await fs.utimes(path.join(relay.bases, 'TOKEN2.token'), old, old);
  await relay.start();
  const resumed = await relay.join('TOKEN2', ['active-room-edit']);
  assert.equal(resumed.welcome.token, author.welcome.token, 'token age alone cannot replace a retained room generation');
  assert.deepEqual(resumed.welcome.accepted, ['active-room-edit']);
});

test('a corrupt or unreadable log cannot accept new edits into an unrecoverable file', async (t) => {
  const relay = await relayFixture(t);
  const first = { seq: 1, author: 'old', ts: 1, op: edit('intact-prefix', 11) };
  const valid = JSON.stringify(first) + '\n';
  for (const [room, text] of [['BADLOG1', valid + '{"seq":2'], ['BADLOG2', valid + 'broken\n'],
    ['BADLOG3', valid + JSON.stringify({ ...first, op: edit('duplicate-sequence', 22) }) + '\n'], ['BADLOG4', JSON.stringify(first)]]) {
    await fs.writeFile(path.join(relay.rooms, room + '.jsonl'), text);
  }
  await fs.mkdir(path.join(relay.rooms, 'BADIO1.jsonl'));
  await relay.start();
  for (const room of ['BADLOG1', 'BADLOG2', 'BADLOG3', 'BADLOG4', 'BADIO1']) {
    const refused = await relay.join(room, []);
    assert.equal(refused.welcome, undefined, room + ' must be refused before a write can be acknowledged');
    assert.equal(refused.messages.find((m) => m.t === 'error').code, 'recovery_unavailable');
  }
  // Only this owned fixture is repaired; production logs are never truncated.
  await fs.writeFile(path.join(relay.rooms, 'BADLOG1.jsonl'), valid);
  const recovered = await relay.join('BADLOG1', []);
  assert.equal(recovered.welcome.seq, 1);
  recovered.send(edit('after-fixture-repair', 99));
  await until(() => recovered.messages.some((m) => m.t === 'op'), 'append after fixture repair');
  await relay.stop();
  await relay.start();
  const restarted = await relay.join('BADLOG1', []);
  assert.deepEqual(restarted.welcome.ops.map((entry) => entry.op.opId), ['intact-prefix', 'after-fixture-repair']);
});

test('a large valid log still loads from a partial first tail line', async (t) => {
  const relay = await relayFixture(t);
  const file = await fs.open(path.join(relay.rooms, 'BIGLOG1.jsonl'), 'w');
  const padding = 'x'.repeat(1024 * 1024);
  try {
    for (let seq = 1; seq <= 55; seq++) await file.write(JSON.stringify({ seq, author: 'old', ts: seq, op: edit('large-' + seq, padding) }) + '\n');
  } finally { await file.close(); }
  await relay.start();
  const author = await relay.join('BIGLOG1', ['large-55']);
  assert.equal(author.welcome.seq, 55);
  assert.equal(author.welcome.truncated, true);
  assert.deepEqual(author.welcome.accepted, ['large-55']);
  author.send(edit('after-large-tail', 99));
  await until(() => author.messages.some((m) => m.t === 'op'), 'append after large tail read');
  assert.equal(author.messages.find((m) => m.t === 'op').seq, 56);
});

test('a base upload keeps its room alive across last-peer close and rejoin', async (t) => {
  const relay = await relayFixture(t);
  await relay.start();
  const original = await relay.join('UPLOAD1', []);
  const bytes = Buffer.from('a base whose owner disconnected during upload');
  const upload = baseRequest(relay, original.welcome.token, 0, bytes);
  upload.request.write(bytes.subarray(0, 5));
  await upload.continued;
  const closed = new Promise((resolve) => original.socket.once('close', resolve));
  original.socket.close();
  await closed;
  const returned = await relay.join('UPLOAD1', []);
  upload.request.end(bytes.subarray(5));
  const result = await upload.response;
  assert.equal(result.status, 200);
  await until(() => returned.messages.some((m) => m.t === 'base'), 'new member sees the completed upload');
  const late = await relay.join('UPLOAD1', []);
  assert.equal(late.welcome.base.hash, result.body.base.hash);
  assert.equal(late.welcome.baseSeq, 0);
});

test('base checkpoints reject invalid order and overlapping commits, and survive disk failure', async (t) => {
  const relay = await relayFixture(t);
  await relay.start();
  const bytes = Buffer.from('captured project');
  const author = await relay.join('VALID1', []);
  for (const seq of ['-1', '1.5', 'nope', '']) {
    const upload = baseRequest(relay, author.welcome.token, seq, bytes);
    upload.request.end(bytes);
    assert.equal((await upload.response).status, 400);
  }
  const future = baseRequest(relay, author.welcome.token, 1, bytes);
  future.request.end(bytes);
  assert.equal((await future.response).status, 409);
  author.send(edit('advance-to-one'));
  await until(() => author.messages.some((m) => m.t === 'op'), 'seq one');
  const valid = baseRequest(relay, author.welcome.token, 1, bytes);
  valid.request.end(bytes);
  assert.equal((await valid.response).status, 200);
  const stale = baseRequest(relay, author.welcome.token, 0, bytes);
  stale.request.end(bytes);
  assert.equal((await stale.response).status, 409);

  const overlapPeer = await relay.join('OVERLAP1', []);
  const first = baseRequest(relay, overlapPeer.welcome.token, 0, bytes);
  first.request.write(bytes.subarray(0, 3));
  await sleep(1600);
  const second = baseRequest(relay, overlapPeer.welcome.token, 0, bytes);
  second.request.end(bytes);
  const rejected = await second.response;
  assert.equal(rejected.status, 409);
  assert.equal(rejected.body.error, 'base_upload_in_progress');
  first.request.end(bytes.subarray(3));
  assert.equal((await first.response).status, 200);

  const failurePeer = await relay.join('BFAIL1', []);
  const metaPath = path.join(relay.bases, 'BFAIL1.json');
  await fs.mkdir(metaPath);
  const failed = baseRequest(relay, failurePeer.welcome.token, 0, bytes);
  failed.request.end(bytes);
  assert.equal((await failed.response).status, 500);
  assert((await getHealth(relay.port)).ok);
  assert(!failurePeer.messages.some((m) => m.t === 'base'));
  await fs.rmdir(metaPath);
  await sleep(1600);
  const retry = baseRequest(relay, failurePeer.welcome.token, 0, bytes);
  retry.request.end(bytes);
  assert.equal((await retry.response).status, 200);
  assert(!(await fs.readdir(relay.bases)).some((name) => name.includes('.tmp-')));
});

test('aborting a base upload releases its reservation and writer slot', async (t) => {
  const relay = await relayFixture(t);
  await relay.start();
  const author = await relay.join('ABORT1', []);
  const bytes = Buffer.from('the full project upload');
  const aborted = baseRequest(relay, author.welcome.token, 0, bytes);
  aborted.request.write(bytes.subarray(0, 3));
  await aborted.continued;
  aborted.request.destroy(new Error('intentional upload abort'));
  await assert.rejects(aborted.response, /intentional upload abort/);
  await sleep(1600);
  const retry = baseRequest(relay, author.welcome.token, 0, bytes);
  retry.request.end(bytes);
  assert.equal((await retry.response).status, 200);
  assert((await getHealth(relay.port)).ok);
  assert.deepEqual(await fs.readFile(path.join(relay.bases, 'ABORT1.aep')), bytes);
});

test('eight active editors per room receive the exact persisted edits across eight rooms', async (t) => {
  const relay = await relayFixture(t);
  await relay.start();
  const rooms = await Promise.all(Array.from({ length: 8 }, async (_, index) => {
    const code = 'TEAM' + index;
    const peers = await Promise.all(Array.from({ length: 8 }, () => relay.join(code)));
    assert(peers.every(peer => peer.welcome?.room === code));
    return { code, peers, expected: new Map() };
  }));

  for (let round = 0; round < 12; round++) {
    for (const { code, peers, expected } of rooms) {
      for (const [index, peer] of peers.entries()) {
        const op = edit([code, index, round].join('-'), round);
        expected.set(op.opId, { op, author: peer.welcome.selfId });
        peer.send(op);
      }
    }
  }

  await Promise.all(rooms.map(async ({ code, peers, expected }) => {
    const received = peer => peer.messages.filter(message => message.t === 'op');
    await until(() => peers.every(peer => received(peer).length >= expected.size), code + ' delivery');
    const journal = (await fs.readFile(path.join(relay.rooms, code + '.jsonl'), 'utf8'))
      .trim().split('\n').map(line => JSON.parse(line));
    assert.equal(journal.length, expected.size);
    const seen = new Set();
    for (const [index, entry] of journal.entries()) {
      assert.equal(entry.seq, index + 1);
      assert.deepEqual({ op: entry.op, author: entry.author }, expected.get(entry.op.opId));
      seen.add(entry.op.opId);
    }
    assert.equal(seen.size, expected.size);
    for (const peer of peers) {
      assert.deepEqual(received(peer).map(({ t, ...entry }) => entry), journal);
      assert(!peer.messages.some(message => message.t === 'error'));
    }
  }));
});

test('an eight-editor room keeps its edit order through a disconnect and delayed history replay', async (t) => {
  const rounds = Number(process.env.VYNK_TEAM_ROUNDS ?? 20);
  assert(Number.isSafeInteger(rounds) && rounds >= 1 && rounds <= 600);
  const relay = await relayFixture(t, Math.min(3000, rounds * 6));
  await relay.start();
  const room = 'TEAMSYNC';
  const writers = await Promise.all(Array.from({ length: 7 }, () => relay.join(room)));
  const bytes = Buffer.from('team project');
  const upload = baseRequest(relay, writers[0].welcome.token, 0, bytes);
  upload.request.end(bytes);
  assert.equal((await upload.response).status, 200);
  const panel = relay.panel(room);
  await until(() => panel.state.deliveryReady, 'eighth editor joined');
  panel.state.projectName = 'base.aep';
  panel.run('inAE=true; cs={}; tryApplyReplay()');
  panel.state.ws.socket.close();
  await until(() => !panel.state.connected, 'eighth editor offline');

  const expected = new Map();
  async function writeRounds(first, count) {
    for (let round = first; round < first + count; round++) {
      for (const [index, peer] of writers.entries()) {
        const op = edit('team-' + round + '-' + index, round % 16);
        op.target.layer = 'id' + (index + 2);
        expected.set(op.opId, op);
        peer.send(op);
      }
      await sleep(50);
    }
    await until(() => writers.every(peer => peer.messages.filter(m => m.t === 'op').length === expected.size), 'all active editors caught up');
  }

  await writeRounds(0, rounds);
  let releaseHistory;
  panel.set('__delayHistory', (cb, ...args) => { releaseHistory = () => cb(...args); });
  panel.run('var originalGet=httpGetText; httpGetText=function(q,cb){originalGet(q,function(e,s,b){__delayHistory(cb,e,s,b);});}; connect()');
  await until(() => panel.state.connected && panel.state.deliveryReady, 'eighth editor reconnected');
  panel.run('tryApplyReplay()');
  await until(() => Boolean(releaseHistory), 'history fetched for returning editor');
  await writeRounds(rounds, rounds);
  await until(() => panel.state.relaySeq === expected.size, 'live edits reached returning editor');
  releaseHistory();
  await until(() => panel.state.replayApplied, 'replay finished');
  const journal = (await fs.readFile(path.join(relay.rooms, room + '.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(journal.length, expected.size);
  assert.equal(new Set(journal.map(entry => entry.op.opId)).size, expected.size);
  journal.forEach((entry, i) => {
    assert.equal(entry.seq, i + 1);
    assert.deepEqual(entry.op, expected.get(entry.op.opId));
  });
  const orderedIds = journal.map(entry => entry.op.opId);
  for (const writer of writers) {
    assert.deepEqual(writer.messages.filter(m => m.t === 'op').map(m => m.op.opId), orderedIds);
  }
  assert.deepEqual(Array.from(panel.state.inbox, group => group[0].opId), orderedIds);
});
