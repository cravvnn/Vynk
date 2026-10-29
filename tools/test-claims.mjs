// Verifies per-target edit claims: a conflicting value edit is rejected with the
// winning op (so the sender can converge), structure is never blocked, and the
// claim expires. Self-contained (spawns its own relay).
import { WebSocket } from 'ws';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.argv[2] ?? 8795);
const TTL = 1500;
let pass = 0, fail = 0;
const ok = (l, c) => { console.log((c ? 'ok: ' : 'FAIL: ') + l); c ? pass++ : fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tmp = path.join(os.tmpdir(), 'opencode', 'claims-test');
const relay = spawn(process.execPath, ['server/dist/index.js'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    CLAIM_TTL_MS: String(TTL),
    MAX_TRACKED_TARGETS: '3',
    DATA_DIR: path.join(tmp, 'rooms'),
    BASE_DIR: path.join(tmp, 'bases'),
  },
  stdio: 'ignore',
});
await new Promise((r) => setTimeout(r, 1500));

const room = 'CLAM' + Math.floor(Math.random() * 900 + 100);

function client(name, roomCode = room) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    const c = { ws, name, errors: [], welcome: null };
    let ready = false;
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', proto: 1, room: roomCode, name, aeVersion: 'test' })));
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.t === 'welcome') {
        c.welcome = m;
        if (!ready) { ready = true; resolve(c); }
      }
      if (m.t === 'error') c.errors.push(m);
    });
  });
}

const op = (opId, pathName, value, kind = 'set') => ({
  opId, kind, target: { comp: '1|C', layer: 'id1' }, path: pathName, value,
});

const a = await client('A');
const b = await client('B');

a.ws.send(JSON.stringify({ t: 'op', op: op('a1', 'transform.opacity', 10) }));
await sleep(150);
b.ws.send(JSON.stringify({ t: 'op', op: op('b1', 'transform.opacity', 20) }));
await sleep(200);

const locked = b.errors.find((e) => e.code === 'locked');
ok('conflicting edit is rejected', Boolean(locked));
ok('rejection names the owner', locked && locked.owner === a.welcome.selfId);
ok('rejection carries the winning op', Boolean(locked && locked.op && locked.op.op && locked.op.op.opId === 'a1'));

// A different property on the same layer is not blocked by the claim.
const before = b.errors.length;
b.ws.send(JSON.stringify({ t: 'op', op: op('b2', 'transform.position', [1, 2]) }));
await sleep(150);
ok('a different property is accepted', b.errors.length === before);

// The owner can keep editing its own claim.
const beforeA = a.errors.length;
a.ws.send(JSON.stringify({ t: 'op', op: op('a2', 'transform.opacity', 11) }));
await sleep(150);
ok('the owner can renew its claim', a.errors.length === beforeA);

// Structural ops are never claim-gated.
const beforeStruct = b.errors.length;
b.ws.send(JSON.stringify({ t: 'op', op: { opId: 'b3', kind: 'reorder', target: { comp: '1|C', layer: 'id1' }, index: 0 } }));
await sleep(150);
ok('structure is not blocked', b.errors.length === beforeStruct);

// After the lease expires the other peer may take over.
await sleep(TTL + 200);
b.ws.send(JSON.stringify({ t: 'op', op: op('b4', 'transform.opacity', 30) }));
await sleep(200);
ok('claim expires and can be taken over', !b.errors.some((e) => e.code === 'locked' && e.op && e.op.op.opId === 'b4'));

const late = await client('Late');
const ids = late.welcome.ops.map((o) => o.op && o.op.opId);
ok('rejected op never entered the log', !ids.includes('b1'));
ok('accepted ops did enter the log', ids.includes('a1') && ids.includes('a2') && ids.includes('b4'));

// A target with a live claim must never be evicted from the revert map, even
// when the room keeps more targets than MAX_TRACKED_TARGETS.
const evictRoom = 'EVIK' + Math.floor(Math.random() * 900 + 100);
const e1 = await client('E1', evictRoom);
const e2 = await client('E2', evictRoom);
for (let i = 0; i < 6; i++) e1.ws.send(JSON.stringify({ t: 'op', op: op('e' + i, 'transform.p' + i, i) }));
await sleep(250);
const beforeE = e2.errors.length;
e2.ws.send(JSON.stringify({ t: 'op', op: op('e-conflict', 'transform.p0', 99) }));
await sleep(250);
const evictErr = e2.errors.slice(beforeE).find((x) => x.code === 'locked');
ok('live claim survives the target cap', Boolean(evictErr && evictErr.op && evictErr.op.op.opId === 'e0'));

for (const c of [e1, e2]) c.ws.close();

for (const c of [a, b, late]) c.ws.close();
console.log(fail === 0 ? `PASS (room ${room})` : `FAILED (${fail})`);
relay.kill();
process.exit(fail === 0 ? 0 : 1);
