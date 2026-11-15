// Runs without dependencies on the Node 8.6 runtime embedded in early AE 2020.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const fixture = require('./panel-test-fixture.cjs');

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vynk-runtime-'));
  const src = path.join(dir, 'source.aep');
  const dest = path.join(dir, 'download.aep');
  const data = Buffer.from('project\0' + 'bytes'.repeat(32768));
  fs.writeFileSync(src, data);
  let uploaded = null;
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    if (req.method === 'PUT') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => { uploaded = Buffer.concat(chunks); res.end('shared'); });
    } else if (req.url === '/abort') {
      res.writeHead(200, { 'content-length': '65536' });
      res.write('incomplete');
      setTimeout(() => res.destroy(), 20);
    } else if (req.url === '/history') res.end('{"seq":1}\n');
    else res.end(data);
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const panel = fixture.panelFixture({ processInfo: { env: { TEMP: dir } } });
    panel.get('serverInput').value = 'ws://127.0.0.1:' + server.address().port + '/ws';
    panel.set('__src', src);
    panel.set('__dest', dest);
    const call = (code) => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('callback timed out')), 5000);
      panel.set('__cb', function (err) {
        clearTimeout(timeout);
        if (err) reject(err);
        else resolve(Array.prototype.slice.call(arguments, 1));
      });
      try { panel.run(code); } catch (err) { clearTimeout(timeout); reject(err); }
    });
    const upload = await call("httpPutFile('/base', __src, __cb)");
    assert.strictEqual(upload[0], 200);
    assert(uploaded.equals(data));
    console.log('ok: panel upload on ' + process.version);
    const history = await call("httpGetText('/history', __cb)");
    assert.strictEqual(history[1], '{"seq":1}\n');
    console.log('ok: panel history on ' + process.version);
    const download = await call("httpGetToFile('/base', __dest, __cb)");
    assert(fs.readFileSync(dest).equals(data));
    assert.strictEqual(download[0], crypto.createHash('sha256').update(data).digest('hex').slice(0, 16));
    console.log('ok: panel download on ' + process.version);
    for (const code of ["httpGetText('/abort', __cb)", "httpGetToFile('/abort', __dest, __cb)"]) {
      let failure;
      try { await call(code); } catch (err) { failure = err; }
      assert(failure && /abort|closed|reset|incomplete/i.test(failure.message), String(failure));
    }
    console.log('ok: interrupted responses on ' + process.version);
    const paths = [];
    panel.set('__download', (url, file, cb) => { paths.push(file); });
    panel.run("inAE=true;cs={};state.connected=true;state.roomToken='token';state.baseCheckpoint=true;state.baseInfo={name:'../base.aep',seq:0};window.confirm=function(){return true;};httpGetToFile=__download;getBase();cancelBaseJob();getBase();");
    assert.strictEqual(paths.length, 2);
    assert.notStrictEqual(paths[0], paths[1]);
    for (const file of paths) {
      assert.strictEqual(path.basename(file), 'base.aep');
      assert.strictEqual(path.dirname(path.dirname(file)), path.join(dir, 'Vynk'));
    }
    console.log('ok: private download directories without new fs APIs on ' + process.version);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
    assert(path.resolve(dir).indexOf(path.resolve(os.tmpdir()) + path.sep + 'vynk-runtime-') === 0);
    // Only known files and empty directories created by this test.
    for (const file of [src, dest]) { try { fs.unlinkSync(file); } catch (err) { if (err.code !== 'ENOENT') throw err; } }
    const cache = path.join(dir, 'Vynk');
    if (fs.existsSync(cache)) {
      for (const sub of fs.readdirSync(cache)) fs.rmdirSync(path.join(cache, sub));
      fs.rmdirSync(cache);
    }
    fs.rmdirSync(dir);
  }
}
main().then(() => console.log('PASS'), (err) => { console.error(err.stack || err); process.exitCode = 1; });
