// Stability soak for the relay: many clients doing ops + cursors + selection,
// periodic base upload/download, and reconnects. Checks for errors and for
// unbounded memory growth. Self-contained (spawns its own relay).
//
//   node tools/soak-system.mjs [minutes] [clients] [port]

import { WebSocket } from 'ws';
import { spawn } from 'node:child_process';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const minutes = Number(process.argv[2] ?? 2);
const clientCount = Number(process.argv[3] ?? 4);
const PORT = Number(process.argv[4] ?? 8798);
const BASE = `http://127.0.0.1:${PORT}`;
const WS = `ws://127.0.0.1:${PORT}/ws`;
const room = 'SOAK' + Math.floor(Math.random() * 900 + 100);
const tmp = path.join(os.tmpdir(), 'opencode', 'soak-system');

const stats = { opsSent: 0, opsRecv: 0, cursors: 0, errors: [], reconnects: 0, baseUp: 0, baseDn: 0, health: [] };

const relay = spawn(process.execPath, ['server/dist/index.js'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: path.join(tmp, 'rooms'), BASE_DIR: path.join(tmp, 'bases') },
  stdio: 'ignore',
});
await new Promise((r) => setTimeout(r, 1500));

function req(method, p, body, headers) {
  return new Promise((resolve) => {
    const r = http.request(BASE + p, { method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    r.on('error', () => resolve({ status: 0 }));
    if (body) r.write(body);
    r.end();
  });
}

function cryptoRandomHex(n) {
  let s = '';
  const chars = '0123456789abcdef';
  for (let i = 0; i < n; i++) s += chars[(Math.random() * 16) | 0];
  return s;
}

function makeClient(index) {
  const ws = new WebSocket(WS);
  let id = null;
  let token = null;
  const send = (o) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(o)); };

  ws.on('open', () => send({ t: 'hello', proto: 1, room, name: 'soak' + index, aeVersion: '25.4 soak' }));
  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch { stats.errors.push('bad json'); return; }
    if (m.t === 'welcome') { id = m.selfId; token = m.token; }
    if (m.t === 'op') stats.opsRecv++;
    if (m.t === 'cursors') stats.cursors += m.batch.length;
    if (m.t === 'error') stats.errors.push(m.code + ':' + m.message + ':' + index);
  });
  ws.on('error', (e) => stats.errors.push('socket' + index + ':' + e.message));

  let n = index * 13;
  const tCursor = setInterval(() => { n++; send({ t: 'cursor', x: (n % 100) / 100, y: (n % 70) / 70, compId: '1|C' }); }, 50);
  const tOp = setInterval(() => {
    n++;
    const kind = n % 9 === 0 ? 'addKey' : n % 5 === 0 ? 'setKey' : 'set';
    const op = { opId: `soak${index}-${n}`, kind, target: { comp: '1|C', layer: 'id' + (1 + (n % 6)) }, path: 'transform.opacity', value: 10 + (n % 80) };
    if (kind !== 'set') { op.time = 1 + (n % 10) * 0.5; op.interp = { inType: 1, outType: 1 }; }
    send({ t: 'op', op });
    stats.opsSent++;
  }, 900 + index * 40);
  const tSel = setInterval(() => { send({ t: 'selection', compId: '1|C', layers: ['id' + (1 + (n % 6))], hash: 'h' + (n % 3) }); }, 1500);

  return { ws, get token() { return token; }, close() { clearInterval(tCursor); clearInterval(tOp); clearInterval(tSel); ws.close(); } };
}

let clients = [];
for (let i = 0; i < clientCount; i++) clients.push(makeClient(i));

let baseBuf = null;
async function baseRound() {
  const host = clients[0];
  if (!host || !host.token) return;
  baseBuf = Buffer.from(`AEP-${Date.now()}` + 'x'.repeat(64 * 1024));
  const put = await req('PUT', `/base?token=${host.token}&name=soak.aep&by=host`, baseBuf, { 'content-type': 'application/octet-stream', 'content-length': String(baseBuf.length) });
  if (put.status !== 200) { stats.errors.push('base put ' + put.status); return; }
  stats.baseUp++;
  for (let i = 1; i < clients.length; i++) {
    const c = clients[i];
    if (!c || !c.token) continue;
    const get = await req('GET', `/base?token=${c.token}`);
    if (get.status !== 200 || !get.body.equals(baseBuf)) { stats.errors.push('base get mismatch ' + get.status); }
    else stats.baseDn++;
  }
}

function reconnectRandom() {
  // Never start a reconnect in the last few seconds: it would race the shutdown
  // and report a bogus "closed before the connection was established".
  if (Date.now() > endsAt - 3000) return;
  const i = (Math.random() * clients.length) | 0;
  clients[i].close();
  clients[i] = makeClient(i);
  stats.reconnects++;
}

const tBase = setInterval(() => { baseRound().catch((e) => stats.errors.push('base round:' + e.message)); }, 15000);
const tRecon = setInterval(reconnectRandom, Math.max(5000, Math.min(30000, (minutes * 60000) / 3)));
const report = setInterval(async () => {
  const h = await req('GET', '/health');
  if (h.status === 200) {
    const j = JSON.parse(h.body.toString());
    stats.health.push(j.memory.rss);
  } else {
    stats.errors.push('health ' + h.status);
  }
  const mem = stats.health;
  console.log(`[soak-system] t=${Math.round((Date.now() - start) / 1000)}s opsSent=${stats.opsSent} opsRecv=${stats.opsRecv} cursors=${stats.cursors} base up/dn=${stats.baseUp}/${stats.baseDn} reconnects=${stats.reconnects} rss=${mem.length ? mem[mem.length - 1] + 'MB' : '?'} errors=${stats.errors.length}`);
  if (stats.errors.length) console.log('  last errors: ' + stats.errors.slice(-4).join(' | '));
}, 15000);

const start = Date.now();
const endsAt = start + minutes * 60 * 1000;
setTimeout(async () => {
  clearInterval(tBase);
  clearInterval(tRecon);
  clearInterval(report);
  for (const c of clients) c.close();
  const h = await req('GET', '/health');
  const end = h.status === 200 ? JSON.parse(h.body.toString()) : null;
  const memStart = stats.health[0] ?? 0;
  const memEnd = end ? end.memory.rss : 0;
  const grew = memEnd - memStart;
  console.log(`\n[soak-system] done: opsSent=${stats.opsSent} opsRecv=${stats.opsRecv} cursors=${stats.cursors} baseUp=${stats.baseUp} baseDn=${stats.baseDn} reconnects=${stats.reconnects}`);
  console.log(`[soak-system] rss start=${memStart}MB end=${memEnd}MB delta=${grew}MB`);
  const ok = stats.errors.length === 0 && grew < 100;
  if (!ok) console.log('[soak-system] errors:\n  ' + stats.errors.slice(0, 20).join('\n  '));
  console.log(ok ? 'PASS' : 'FAIL');
  relay.kill();
  process.exit(ok ? 0 : 1);
}, minutes * 60 * 1000);

console.log(`[soak-system] room ${room}, ${clientCount} clients, ${minutes}m, relay :${PORT}`);
