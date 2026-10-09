import { WebSocket } from 'ws';

const room = process.argv[2] ?? 'VG5E8S';
const targetComp = process.argv[3] ?? '999999|Probe Comp';
const targetLayer = process.argv[4] ?? 'id1';
const value = process.argv[5] !== undefined ? Number(process.argv[5]) : 50;
const kind = process.argv[6] ?? 'set';
const time = process.argv[7] !== undefined ? Number(process.argv[7]) : undefined;
const ws = new WebSocket(process.env.URL || 'ws://127.0.0.1:8787/ws');

ws.on('open', () => {
  ws.send(JSON.stringify({ t: 'hello', proto: 1, room, name: 'Probe', aeVersion: 'probe' }));
  console.log(
    `[probe] joined ${room}, sending ${kind} opacity=${value} to ${targetComp} / ${targetLayer}` +
      (time !== undefined ? ` at t=${time}` : '')
  );
  setTimeout(() => {
    const op = {
      opId: 'probe-' + Date.now().toString(36),
      kind,
      target: { comp: targetComp, layer: targetLayer },
      path: 'transform.opacity',
      value,
    };
    if (kind === 'add') {
      const addType = process.argv[8] ?? 'solid';
      const stamp = Array.from({ length: 12 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
      op.target = { comp: targetComp, layer: 'st' + stamp };
      op.path = undefined;
      op.index = 1;
      op.value = {
        type: addType,
        name: 'Collab Test ' + addType,
        index: 1,
        inPoint: 0,
        outPoint: 5,
        startTime: 0,
        enabled: true,
        transform: {
          position: { value: [960, 405] },
          anchor: { value: [960, 405] },
          scale: { value: [100, 100] },
          rotation: { value: 0 },
          opacity: { value: 100 },
        },
      };
      if (addType === 'solid') {
        op.value.solid = { color: [0.2, 0.6, 1], width: 400, height: 400, duration: 10, pixelAspect: 1 };
      }
      if (addType === 'text') op.value.sourceText = 'Collab test';
      if (addType === 'footage') {
        op.value.name = process.argv[9] ?? 'clip.mp4';
        op.value.source = { name: process.argv[9] ?? 'clip.mp4', path: process.argv[10] ?? '' };
      }
      console.log(`[probe] add op: ${addType} -> ${op.target.layer}`);
    }
    if (kind === 'addEffect') {
      const matchName = process.argv[8] ?? 'ADBE Glo2';
      op.path = 'fx:' + matchName + '#1';
      op.index = 1;
      op.value = { matchName, name: matchName, enabled: true, index: 1, props: {} };
      console.log(`[probe] addEffect: ${matchName}`);
    } else if (time !== undefined && kind !== 'add') {
      op.time = time;
    }
    if (kind === 'addKey' || kind === 'setKey') op.interp = { inType: 1, outType: 1 };
    ws.send(JSON.stringify({ t: 'op', op }));
    console.log('[probe] op sent');
  }, 700);
  setTimeout(() => {
    console.log('[probe] done');
    process.exit(0);
  }, 3500);
});

ws.on('message', (raw) => {
  let m;
  try {
    m = JSON.parse(raw.toString());
  } catch {
    return;
  }
  if (m.t === 'welcome') console.log(`[probe] welcome, ${m.members.length} member(s) present`);
  if (m.t === 'op') console.log(`[probe] op broadcast seq=${m.seq}`);
});

ws.on('error', (e) => {
  console.error('[probe] error: ' + e.message);
  process.exit(1);
});
