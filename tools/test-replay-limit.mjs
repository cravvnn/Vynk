// Verifies that a late joiner is told when the relay cannot replay the whole
// post-base history. Self-contained (spawns its own relay).
import { WebSocket } from 'ws';
import { spawn } from 'node:child_process';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.argv[2] ?? 8796);
const CAP = 2;
let pass = 0, fail = 0;
const ok = (l, c) => { console.log((c ? 'ok: ' : 'FAIL: ') + l); c ? pass++ : fail++; };

const tmp = path.join(os.tmpdir(), 'opencode', 'replay-limit-test');
const relay = spawn(process.execPath, ['server/dist/index.js'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    MAX_OPS_IN_WELCOME: String(CAP),
    DATA_DIR: path.join(tmp, 'rooms'),
    BASE_DIR: path.join(tmp, 'bases'),
  },
  stdio: 'ignore',
});
await new Promise((r) => setTimeout(r, 1500));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getText(p) {
  return new Promise((resolve) => {
    http.get(`http://127.0.0.1:${PORT}${p}`, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    }).on('error', () => resolve({ status: 0, body: '' }));
  });
}

function join(room) {
  return new Promise((resolve) => {
    const w = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    w.on('open', () => w.send(JSON.stringify({ t: 'hello', proto: 1, room, name: 'probe', aeVersion: 'test' })));
    w.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.t === 'welcome') resolve({ ws: w, welcome: m });
    });
  });
}

const op = (n) => ({
  opId: 'op' + n,
  kind: 'set',
  target: { comp: '1|C', layer: 'id1' },
  path: 'transform.opacity',
  value: 10 + n,
});

const over = 'RLIM' + Math.floor(Math.random() * 900 + 100);
const a = await join(over);
for (let i = 1; i <= CAP + 2; i++) a.ws.send(JSON.stringify({ t: 'op', op: op(i) }));
await sleep(300);

const b = await join(over);
ok('truncated flag is set', b.welcome.truncated === true);
ok('only the newest ops are replayed', b.welcome.ops.length === CAP);
ok('replay starts at the right seq', b.welcome.fromSeq === CAP + 1);
ok('newest op is the last one sent', b.welcome.ops[b.welcome.ops.length - 1].op.opId === 'op' + (CAP + 2));

const token = a.welcome.token;
const all = await getText(`/ops?token=${token}&after=0`);
ok('op history is served in order', all.body.trim().split('\n').filter(Boolean).length === CAP + 2);
const first2 = await getText(`/ops?token=${token}&after=0&before=${CAP + 1}`);
ok('before/after window is honoured', first2.body.trim().split('\n').filter(Boolean).length === CAP);
ok('op history needs the room token', (await getText('/ops?token=nope')).status === 403);

// A room that fits under the cap must not be flagged.
const small = 'RLIM' + Math.floor(Math.random() * 900 + 100);
const c = await join(small);
c.ws.send(JSON.stringify({ t: 'op', op: op(1) }));
c.ws.send(JSON.stringify({ t: 'op', op: op(2) }));
await sleep(250);
const d = await join(small);
ok('short history is not flagged', d.welcome.truncated === undefined);
ok('short history replays everything', d.welcome.ops.length === 2);

for (const s of [a, b, c, d]) s.ws.close();
console.log(fail === 0 ? `PASS (room ${over})` : `FAILED (${fail})`);
relay.kill();
process.exit(fail === 0 ? 0 : 1);
