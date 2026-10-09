import { WebSocket } from 'ws';

const [room = 'DEMO2026', name = 'Bot', ae = '25.0'] = process.argv.slice(2);
const ws = new WebSocket(process.env.URL || 'ws://127.0.0.1:8787/ws');

ws.on('open', () => {
  ws.send(JSON.stringify({ t: 'hello', proto: 1, room, name, aeVersion: ae }));
  console.log(`[bot ${name}] connecting to room ${room} as AE ${ae}`);
});

ws.on('message', (raw) => {
  let msg;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    return;
  }
  if (msg.t === 'welcome') console.log(`[bot ${name}] joined ${msg.room}, ${msg.members.length} member(s) present`);
  if (msg.t === 'presence' && msg.event === 'join') console.log(`[bot ${name}] ${msg.member.name} joined`);
  if (msg.t === 'error') console.log(`[bot ${name}] error ${msg.code}: ${msg.message}`);
});

let t = 0;
setInterval(() => {
  t += 0.15;
  const x = Math.max(0.02, Math.min(0.98, 0.5 + 0.35 * Math.cos(t)));
  const y = Math.max(0.02, Math.min(0.98, 0.5 + 0.3 * Math.sin(t * 1.3)));
  ws.send(JSON.stringify({ t: 'cursor', x, y, compId: '123|Main Comp' }));
}, 50);

setTimeout(() => {
  ws.send(JSON.stringify({ t: 'selection', compId: '123|Main Comp', layers: ['id42', 'id43'] }));
}, 1000);

let opCount = 0;
setInterval(() => {
  opCount++;
  const op =
    opCount % 4 === 0
      ? {
          opId: 'op-' + opCount,
          kind: 'setKey',
          target: { comp: '123|Main Comp', layer: 'id42' },
          path: 'transform.position',
          value: [200 + opCount, 300],
          time: 1.0,
          interp: { inType: 1, outType: 1 },
        }
      : opCount % 3 === 0
        ? {
            opId: 'op-' + opCount,
            kind: 'addKey',
            target: { comp: '123|Main Comp', layer: 'id42' },
            path: 'transform.position',
            value: [100 + opCount, 250],
            time: 2.0,
            interp: { inType: 1, outType: 1 },
          }
        : {
            opId: 'op-' + opCount,
            kind: 'set',
            target: { comp: '123|Main Comp', layer: 'id42' },
            path: 'transform.opacity',
            value: 40 + (opCount % 60),
          };
  ws.send(JSON.stringify({ t: 'op', op }));
}, 1500);
