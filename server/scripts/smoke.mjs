import { WebSocket } from 'ws';

const URL = process.env.URL || 'ws://127.0.0.1:8787/ws';
const ROOM = 'SMOKE' + Math.floor(Math.random() * 900 + 100);

function makeClient(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const seen = [];
    const listeners = [];
    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      seen.push(msg);
      for (const fn of listeners) fn(msg);
    });
    ws.on('error', reject);
    ws.on('open', () =>
      resolve({
        name,
        ws,
        send: (m) => ws.send(JSON.stringify(m)),
        close: () => ws.close(),
        wait: (pred, timeoutMs = 5000) =>
          new Promise((res, rej) => {
            for (const m of seen) {
              if (pred(m)) {
                res(m);
                return;
              }
            }
            const timer = setTimeout(() => {
              const idx = listeners.indexOf(fn);
              if (idx >= 0) listeners.splice(idx, 1);
              rej(new Error(`timeout waiting in ${name}`));
            }, timeoutMs);
            const fn = (m) => {
              if (!pred(m)) return;
              clearTimeout(timer);
              const idx = listeners.indexOf(fn);
              if (idx >= 0) listeners.splice(idx, 1);
              res(m);
            };
            listeners.push(fn);
          }),
      })
    );
  });
}

function assert(cond, label) {
  if (!cond) {
    console.error(`FAIL: ${label}`);
    process.exit(1);
  }
  console.log(`ok: ${label}`);
}

const a = await makeClient('Alice');
const b = await makeClient('Bob');
a.send({ t: 'hello', proto: 1, room: ROOM, name: 'Alice', aeVersion: '25.0' });
const welcomeA = await a.wait((m) => m.t === 'welcome');
assert(welcomeA.members.length === 0, 'first joiner sees empty room');
assert(welcomeA.seq === 0, 'fresh room starts at seq 0');

b.send({ t: 'hello', proto: 1, room: ROOM, name: 'Bob', aeVersion: '17.0' });
const welcomeB = await b.wait((m) => m.t === 'welcome');
assert(welcomeB.members.length === 1 && welcomeB.members[0].name === 'Alice', 'second joiner sees Alice');
await a.wait((m) => m.t === 'presence' && m.event === 'join' && m.member.name === 'Bob');
assert(true, 'Alice sees Bob join');

b.send({ t: 'cursor', x: 0.25, y: 0.75, compId: '123|Main' });
const cursors = await a.wait((m) => m.t === 'cursors' && m.batch.some((c) => c.id === welcomeB.selfId));
const mine = cursors.batch.find((c) => c.id === welcomeB.selfId);
assert(Math.abs(mine.x - 0.25) < 1e-6 && Math.abs(mine.y - 0.75) < 1e-6, 'cursor relayed with values intact');
assert(mine.compId === '123|Main', 'cursor carries compId');

b.send({ t: 'selection', compId: '123|Main', layers: ['id42', 'id43'] });
const sel = await a.wait((m) => m.t === 'selection' && m.id === welcomeB.selfId);
assert(sel.layers.length === 2, 'selection relayed');

const op = { opId: 'op-1', kind: 'set', target: { comp: '123|Main', layer: 'id42' }, path: 'transform.position', value: [10, 20] };
b.send({ t: 'op', op });
const opA = await a.wait((m) => m.t === 'op' && m.op.opId === 'op-1');
assert(opA.seq === 1, 'first op gets seq 1');
const opB = await b.wait((m) => m.t === 'op' && m.op.opId === 'op-1');
assert(opB.author === welcomeB.selfId, 'op echoes to author with author id');

b.send({ t: 'lock', target: '123|Main::id42', mode: 'acquire' });
await a.wait((m) => m.t === 'lock' && m.owner === welcomeB.selfId);
a.send({ t: 'lock', target: '123|Main::id42', mode: 'acquire' });
const err = await a.wait((m) => m.t === 'error' && m.code === 'locked');
assert(Boolean(err), 'lock conflict rejected');

const c = await makeClient('Carol');
c.send({ t: 'hello', proto: 1, room: ROOM, name: 'Carol', aeVersion: '26.0' });
const welcomeC = await c.wait((m) => m.t === 'welcome');
assert(welcomeC.ops.length === 1 && welcomeC.ops[0].op.opId === 'op-1', 'late joiner replays op log');

a.close();
b.close();
c.close();
await new Promise((r) => setTimeout(r, 300));

const health = await fetch(process.env.HEALTH_URL || 'http://127.0.0.1:8787/health').then((r) => r.json());
assert(health.ok === true, 'health endpoint responds');

console.log(`\nPASS (room ${ROOM})`);
process.exit(0);
