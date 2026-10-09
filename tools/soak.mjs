import { WebSocket } from 'ws';

const URL = process.env.URL || 'ws://127.0.0.1:8787/ws';
const room = process.argv[2] ?? 'SOAK' + Math.floor(Math.random() * 900 + 100);
const minutes = Number(process.argv[3] ?? 30);
const clientCount = Number(process.argv[4] ?? 3);

const stats = { opsSent: 0, opsRecv: 0, cursors: 0, presence: 0, errors: [], pings: [], started: Date.now() };

function makeClient(name, index) {
  const ws = new WebSocket(URL);
  const state = { id: null };
  const send = (obj) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  };
  ws.on('open', () => {
    send({ t: 'hello', proto: 1, room, name, aeVersion: 'bot-' + index });
  });
  ws.on('message', (raw) => {
    let m;
    try {
      m = JSON.parse(raw.toString());
    } catch {
      stats.errors.push('bad json');
      return;
    }
    if (m.t === 'welcome') state.id = m.selfId;
    if (m.t === 'op') stats.opsRecv++;
    if (m.t === 'cursors') stats.cursors += m.batch.length;
    if (m.t === 'presence') stats.presence++;
    if (m.t === 'pong') stats.pings.push(Date.now() - m.ts);
    if (m.t === 'error') stats.errors.push(m.code + ':' + m.message);
  });
  ws.on('error', (e) => stats.errors.push('socket:' + e.message));

  let t = index * 7;
  const cursorTimer = setInterval(() => {
    t += 0.12;
    const x = Math.max(0.02, Math.min(0.98, 0.5 + 0.4 * Math.cos(t)));
    const y = Math.max(0.02, Math.min(0.98, 0.5 + 0.35 * Math.sin(t * 1.4)));
    send({ t: 'cursor', x, y, compId: '1|Comp 1' });
  }, 60);

  let opCount = 0;
  const opTimer = setInterval(() => {
    opCount++;
    const kind = opCount % 7 === 0 ? 'setKey' : opCount % 5 === 0 ? 'addKey' : 'set';
    const op = {
      opId: `${name}-${opCount}`,
      kind,
      target: { comp: '1|Comp 1', layer: 'id' + (20 + (opCount % 8)) },
      path: opCount % 3 === 0 ? 'transform.position' : 'transform.opacity',
      value: opCount % 3 === 0 ? [900 + (opCount % 60), 405] : 60 + (opCount % 40),
    };
    if (kind !== 'set') {
      op.time = 1 + (opCount % 20) * 0.5;
      op.interp = { inType: 1, outType: 1 };
    }
    send({ t: 'op', op });
    stats.opsSent++;
  }, 2200);

  const pingTimer = setInterval(() => {
    send({ t: 'ping', ts: Date.now() });
  }, 15000);

  return {
    close: () => {
      clearInterval(cursorTimer);
      clearInterval(opTimer);
      clearInterval(pingTimer);
      ws.close();
    },
  };
}

const clients = [];
for (let i = 0; i < clientCount; i++) clients.push(makeClient('soak' + i, i));

const reportTimer = setInterval(() => {
  const elapsed = Math.round((Date.now() - stats.started) / 1000);
  const pings = stats.pings;
  const avgPing = pings.length ? Math.round(pings.reduce((a, b) => a + b, 0) / pings.length) : 0;
  console.log(
    `[soak] ${new Date().toTimeString().slice(0, 8)} t=${elapsed}s opsSent=${stats.opsSent} opsRecv=${stats.opsRecv} ` +
      `cursors=${stats.cursors} presence=${stats.presence} avgPing=${avgPing}ms errors=${stats.errors.length}`
  );
  if (stats.errors.length) console.log('[soak] errors: ' + stats.errors.slice(-5).join('; '));
}, 30000);

setTimeout(() => {
  clearInterval(reportTimer);
  for (const c of clients) c.close();
  console.log(`[soak] done after ${minutes}m in room ${room}`);
  process.exit(0);
}, minutes * 60 * 1000);

console.log(`[soak] ${clientCount} clients in room ${room} via ${URL} for ${minutes}m`);
