import { WebSocket } from 'ws';

const [room, name = 'Watcher'] = process.argv.slice(2);
if (!room) {
  console.error('usage: node tools/watch-room.mjs ROOM [name]');
  process.exit(1);
}

const ws = new WebSocket(process.env.URL || 'ws://127.0.0.1:8787/ws');
const stamp = () => new Date().toTimeString().slice(0, 8);
let lastCursorLog = 0;
let cursorCount = 0;

ws.on('open', () => {
  ws.send(JSON.stringify({ t: 'hello', proto: 1, room, name, aeVersion: 'observer' }));
  console.log(`[watch] joining ${room} as ${name}`);
});

ws.on('message', (raw) => {
  let m;
  try {
    m = JSON.parse(raw.toString());
  } catch {
    return;
  }
  switch (m.t) {
    case 'welcome':
      console.log(
        `[watch] welcome: self=${m.selfId} room=${m.room} seq=${m.seq} members=${JSON.stringify(
          m.members.map((x) => `${x.name}/AE ${x.aeVersion}`)
        )} opsInLog=${m.ops.length}`
      );
      break;
    case 'presence':
      console.log(`[watch] ${stamp()} presence ${m.event}: ${m.member.name} (AE ${m.member.aeVersion})`);
      break;
    case 'cursors': {
      cursorCount += m.batch.length;
      const inactive = m.batch.filter((e) => e.active === false);
      if (inactive.length) {
        console.log(`[watch] ${stamp()} cursor inactive: ${inactive.map((e) => e.id).join(', ')}`);
      }
      const now = Date.now();
      if (now - lastCursorLog > 1000) {
        lastCursorLog = now;
        const c = m.batch[0];
        console.log(
          `[watch] ${stamp()} cursors: ${cursorCount} total, latest ${c.id} ${c.x.toFixed(3)},${c.y.toFixed(3)} comp=${c.compId ?? '-'}`
        );
        cursorCount = 0;
      }
      break;
    }
    case 'selection':
      console.log(
        `[watch] ${stamp()} selection from ${m.id}: comp=${m.compId ?? '-'} layers=${JSON.stringify(m.layers)}`
      );
      break;
    case 'op':
      console.log(
        `[watch] ${stamp()} OP #${m.seq} ${m.op.kind} ${m.op.path} target=${JSON.stringify(m.op.target)}` +
          (m.op.time !== undefined ? ` time=${m.op.time}` : '') +
          (m.op.value !== undefined ? ` value=${JSON.stringify(m.op.value)}` : '')
      );
      break;
    case 'lock':
      console.log(`[watch] ${stamp()} lock ${m.target} -> ${m.owner ?? 'free'}`);
      break;
    case 'log':
      console.log(`[watch] ${stamp()} PANEL ${m.name}: ${m.line}`);
      break;
    case 'error':
      console.log(`[watch] ${stamp()} ERROR ${m.code}: ${m.message}`);
      break;
    case 'pong':
      break;
    default:
      console.log('[watch] ' + raw.toString());
  }
});

ws.on('error', (e) => console.error('[watch] socket error: ' + e.message));
ws.on('close', () => console.log('[watch] closed'));
