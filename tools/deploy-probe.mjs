// Deployment probe: base-project round trip against a remote relay.
import { createHash } from 'node:crypto';
import WebSocket from 'ws';

const base = process.env.BASE || 'http://147.135.78.1:8787';
const wsUrl = base.replace(/^http/, 'ws') + '/ws';
const room = 'DEPCHK' + Math.floor(Math.random() * 90 + 10);

const ws = new WebSocket(wsUrl);
const fail = (m) => { console.error('FAIL:', m); process.exit(1); };
const timer = setTimeout(() => fail('timeout'), 20000);

ws.on('open', () => {
  ws.send(JSON.stringify({ t: 'hello', proto: 1, room, name: 'probe', aeVersion: 'deploy' }));
});

ws.on('message', async (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.t !== 'welcome') return;
  clearTimeout(timer);
  const token = msg.token;
  const bad = await fetch(`${base}/base?token=nope`);
  console.log('bad token ->', bad.status);

  const bytes = Buffer.alloc(64 * 1024);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
  const put = await fetch(`${base}/base?token=${token}&name=probe.aep&by=probe&ae=deploy`, {
    method: 'PUT',
    body: bytes,
  });
  console.log('put ->', put.status);
  if (put.status !== 200) fail('put failed');

  const got = Buffer.from(await (await fetch(`${base}/base?token=${token}`)).arrayBuffer());
  const sha = createHash('sha256').update(got).digest('hex').slice(0, 16);
  console.log('get ->', got.length, 'bytes, hash', sha, 'match:', got.equals(bytes));

  const meta = await (await fetch(`${base}/base/meta?token=${token}`)).json();
  console.log('meta ->', JSON.stringify(meta));

  console.log(got.equals(bytes) ? 'PASS' : 'FAIL');
  ws.close();
  process.exit(got.equals(bytes) ? 0 : 1);
});

ws.on('error', (e) => fail(e.message));
