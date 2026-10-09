// Verifies the relay's base-project HTTP endpoints. Self-contained.
import { WebSocket } from 'ws';
import { spawn } from 'node:child_process';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.argv[2] ?? 8797);
const BASE = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const ok = (l, c) => { console.log((c ? 'ok: ' : 'FAIL: ') + l); c ? pass++ : fail++; };

const tmp = path.join(os.tmpdir(), 'opencode', 'base-test');
const relay = spawn(process.execPath, ['server/dist/index.js'], {
  env: { ...process.env, PORT: String(PORT), MAX_BASE_BYTES: '4096', DATA_DIR: path.join(tmp, 'rooms'), BASE_DIR: path.join(tmp, 'bases') },
  stdio: 'ignore',
});
await new Promise((r) => setTimeout(r, 1500));

function req(method, p, body) {
  const headers = {};
  if (body) headers['content-length'] = String(body.length);
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

const room = 'BASET' + Math.floor(Math.random() * 900 + 100);
const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', proto: 1, room, name: 'Host', aeVersion: '25.4' })));
ws.on('message', async (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.t !== 'welcome') return;
  const token = m.token;
  ok('welcome carries token', typeof token === 'string' && token.length > 8);
  ok('meta forbidden without token', (await req('GET', '/base/meta')).status === 403);
  const payload = Buffer.from('A'.repeat(100));
  ok('PUT base succeeds', (await req('PUT', `/base?token=${token}&name=My%20Project.aep&by=Host`, payload)).status === 200);
  const meta = JSON.parse((await req('GET', `/base/meta?token=${token}`)).body.toString()).base;
  ok('meta name sanitized', meta.name === 'My Project.aep');
  const get = await req('GET', `/base?token=${token}`);
  ok('GET base bytes match', get.status === 200 && get.body.equals(payload));
  ok('oversize rejected (413)', (await req('PUT', `/base?token=${token}`, Buffer.from('B'.repeat(9000)))).status === 413);
  ok('rapid repost limited (429)', (await req('PUT', `/base?token=${token}`, Buffer.from('C'.repeat(50)))).status === 429);
  ok('wrong token forbidden (403)', (await req('GET', '/base?token=nope')).status === 403);
  console.log(fail === 0 ? `PASS (room ${room})` : `FAILED (${fail})`);
  relay.kill();
  process.exit(fail === 0 ? 0 : 1);
});
setTimeout(() => { console.log('timeout'); relay.kill(); process.exit(1); }, 10000);
