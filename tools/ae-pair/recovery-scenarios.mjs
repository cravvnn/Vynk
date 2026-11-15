const OPACITY = 'ADBE Opacity';
const ROTATION = 'ADBE Rotate Z';
const literal = JSON.stringify;
const body = (code) => "(function(){try{" + code + ";return 'ok';}catch(e){return 'ERR '+e;}})()";
const comp = (name) => 'vynkPair.comp(' + literal(name) + ')';
const layer = (name, which) => 'vynkPair.layer(' + comp(name) + ',' + literal(which) + ')';
const property = (name, which, prop) => layer(name, which) + ".property('ADBE Transform Group').property(" + literal(prop) + ')';

function requireOk(result) {
  if (result !== 'ok') throw new Error(String(result));
}

async function fixture(h, tag, share) {
  const name = 'Recovery ' + tag;
  requireOk(await h.jsx('A', body("var c=app.project.items.addComp(" + literal(name) + ",800,600,1,6,30);c.layers.addNull(6).name='Left';c.layers.addNull(6).name='Right'")));
  if (!(await h.waitFor(async () => (await h.jsx('B', "(function(){var c=" + comp(name) + ";return c&&vynkPair.layer(c,'Left')&&vynkPair.layer(c,'Right')?'ready':'waiting';})()")) === 'ready', 45000, name + ' setup'))) throw new Error('fixture did not reach B');
  await h.sleep(1500);
  if (share) await shareFixture(h);
  return name;
}

async function shareFixture(h) {
  if (!(await h.waitFor(async () => (await h.js('A', "state.deliveryReady&&!state.outbox.length&&!state.baseJob&&!state.pendingReplay&&!state.baseHold?'ready':'waiting'")) === 'ready', 30000, 'base source ready'))) throw new Error('base source did not settle');
  const previous = Number(await h.js('A', 'String(state.baseInfo&&state.baseInfo.seq||0)'));
  requireOk(await h.js('A', "shareBase();'ok'"));
  if (!(await h.waitFor(async () => (await h.js('A', "!state.baseJob&&state.baseInfo&&state.baseInfo.seq>" + previous + "?'ready':'waiting'")) === 'ready', 120000, 'fresh base captured for recovery'))) throw new Error('recovery fixture has no fresh base checkpoint');
}

async function set(h, who, name, which, prop, value) {
  requireOk(await h.jsx(who, body(property(name, which, prop) + '.setValue(' + literal(value) + ')')));
}

async function value(h, who, name, which, prop) {
  return h.jsx(who, "(function(){try{return JSON.stringify(" + property(name, which, prop) + ".value);}catch(e){return 'ERR '+e;}})()");
}

async function both(h, name, which, prop, expected) {
  const wanted = literal(expected);
  const equal = await h.waitFor(async () => {
    const values = await Promise.all(['A', 'B'].map((who) => value(h, who, name, which, prop)));
    return values.every((v) => v === wanted);
  }, 45000, name + '/' + which + '/' + prop + '=' + wanted);
  if (!equal) throw new Error(which + '/' + prop + ' did not preserve ' + wanted + ' on both peers');
}

async function offline(h) {
  requireOk(await h.js('B', "wantConnected=false;disconnect();'ok'"));
  if (!(await h.waitFor(() => !h.obs.has('B'), 10000, 'B to leave the wire'))) throw new Error('B stayed connected');
}

async function reconnect(h, reload) {
  if (reload) {
    requireOk(await h.js('B', "later(function(){location.reload();},50);'ok'"));
    await h.sleep(1500);
  } else requireOk(await h.js('B', "connect();'ok'"));
  if (!(await h.waitFor(() => h.obs.has('B'), 30000, 'B to reconnect'))) throw new Error('B did not rejoin');
}

async function queued(h, kind) {
  const code = kind
    ? "(function(){for(var i=0;i<state.outbox.length;i++){var ops=innerOps(state.outbox[i]);for(var j=0;j<ops.length;j++)if(ops[j].kind===" + literal(kind) + ")return 'queued';}return 'waiting';})()"
    : "state.outbox.length?'queued':'waiting'";
  if (!(await h.waitFor(async () => (await h.js('B', code)) === 'queued', 15000, 'offline edits to be queued'))) throw new Error('offline edit was not captured');
}

async function dropOnce(h, name, echo) {
  const code = "(function(){var ws=state.ws,send=ws.send,receive=ws.onmessage;window.__vynkLoss={id:''};" +
    "function match(op){return op&&op.kind!=='need'&&op.kind!=='sum'&&op.target&&op.target.comp.split('|')[1]===" + literal(name) + ";}" +
    "window.__vynkLossRestore=function(){ws.send=send;ws.onmessage=receive;};" +
    (echo
      ? "ws.onmessage=function(ev){var m=JSON.parse(ev.data);if(!window.__vynkLoss.id&&m.t==='op'&&m.author===state.selfId&&match(m.op)){window.__vynkLoss.id=m.op.opId;wantConnected=false;ws.close();return;}receive.call(ws,ev);};"
      : "ws.send=function(data){var m=JSON.parse(data);if(!window.__vynkLoss.id&&m.t==='op'&&match(m.op)){window.__vynkLoss.id=m.op.opId;wantConnected=false;ws.close();return;}send.call(ws,data);};") +
    "return 'ok';})()";
  requireOk(await h.js('B', code));
}

async function droppedId(h) {
  let id = '';
  if (!(await h.waitFor(async () => {
    id = await h.js('B', "window.__vynkLoss&&window.__vynkLoss.id||''");
    return Boolean(id) && !h.obs.has('B');
  }, 15000, 'the selected frame or echo to be lost'))) throw new Error('fault injection did not run');
  return id;
}

function scenario(name, run) {
  return {
    name: 'recovery: ' + name, who: 'A', timeout: 90000,
    run: async (h) => {
      try { await run(h); return 'ok'; }
      catch (err) { return 'ERR ' + err.message; }
      finally {
        try { await h.js('B', "if(window.__vynkLossRestore){window.__vynkLossRestore();delete window.__vynkLossRestore;}'ok'"); } catch {}
        try { await h.js('B', "if(window.__vynkMissRestore){window.__vynkMissRestore();delete window.__vynkMissRestore;}'ok'"); } catch {}
        try { await h.js('B', "if(!state.connected)connect();'ok'"); } catch {}
      }
    }
  };
}

export const recoveryScenarios = [
  scenario('a lost frame survives reload and is relayed once', async (h) => {
    const name = await fixture(h, 'Lost Frame', true);
    await dropOnce(h, name, false);
    await set(h, 'B', name, 'Left', OPACITY, 83);
    const id = await droppedId(h);
    if (h.obs.ops.some((entry) => entry.op.opId === id)) throw new Error('the supposedly lost frame reached the relay');
    await queued(h);
    await reconnect(h, true);
    await both(h, name, 'Left', OPACITY, 83);
    if (h.obs.ops.filter((entry) => entry.op.opId === id).length !== 1) throw new Error('the recovered edit was not relayed exactly once');
  }),
  scenario('a lost echo does not duplicate a created layer after reload', async (h) => {
    const name = await fixture(h, 'Lost Echo', true);
    await dropOnce(h, name, true);
    requireOk(await h.jsx('B', body("var l=" + comp(name) + ".layers.addNull(6);l.name='One Echo';l.property('ADBE Transform Group').property('ADBE Opacity').setValue(57)")));
    const id = await droppedId(h);
    await queued(h);
    await reconnect(h, true);
    await both(h, name, 'One Echo', OPACITY, 57);
    if (h.obs.ops.filter((entry) => entry.op.opId === id).length !== 1) throw new Error('a committed gesture was relayed twice');
    for (const who of ['A', 'B']) {
      const count = await h.jsx(who, 'String(' + comp(name) + '.numLayers)');
      if (count !== '3') throw new Error(who + ' lost or duplicated the created layer (' + count + ')');
    }
  }),
  scenario('an accepted own edit survives older missed replay after a lost echo', async (h) => {
    const name = await fixture(h, 'Accepted Replay', true);
    requireOk(await h.js('B', "(function(){var ws=state.ws,receive=ws.onmessage;window.__vynkMissRestore=function(){ws.onmessage=receive;};window.__vynkMissed=false;ws.onmessage=function(ev){var m=JSON.parse(ev.data);if(!window.__vynkMissed&&m.t==='op'&&m.author!==state.selfId&&m.op&&m.op.kind!=='need'&&m.op.kind!=='sum'&&m.op.target&&m.op.target.comp.split('|')[1]===" + literal(name) + "){window.__vynkMissed=true;return;}receive.call(ws,ev);};return 'ok';})()"));
    await dropOnce(h, name, true);
    await set(h, 'A', name, 'Left', OPACITY, 11);
    if (!(await h.waitFor(async () => (await h.js('B', "window.__vynkMissed?'missed':'waiting'")) === 'missed', 15000, 'older edit deliberately missed'))) throw new Error('older edit was not dropped');
    await set(h, 'B', name, 'Left', OPACITY, 88);
    const id = await droppedId(h);
    await queued(h);
    await reconnect(h, true);
    await both(h, name, 'Left', OPACITY, 88);
    if (h.obs.ops.filter((entry) => entry.op.opId === id).length !== 1) throw new Error('accepted own edit was relayed twice');
    await set(h, 'A', name, 'Left', OPACITY, 99);
    await both(h, name, 'Left', OPACITY, 99);
  }),
  scenario('disjoint offline edits survive reconnect', async (h) => {
    const name = await fixture(h, 'Offline');
    await offline(h);
    await set(h, 'A', name, 'Left', OPACITY, 31);
    await set(h, 'B', name, 'Right', OPACITY, 67);
    await queued(h);
    await reconnect(h, false);
    await both(h, name, 'Left', OPACITY, 31);
    await both(h, name, 'Right', OPACITY, 67);
    if ((await h.js('B', 'String(state.outbox.length)')) !== '0') throw new Error('offline queue did not drain');
  }),
  scenario('offline layer creation survives panel reload', async (h) => {
    const name = await fixture(h, 'Reload', true);
    await offline(h);
    await set(h, 'A', name, 'Left', ROTATION, 24);
    requireOk(await h.jsx('B', body("var l=" + comp(name) + ".layers.addNull(6);l.name='Offline';l.property('ADBE Transform Group').property('ADBE Opacity').setValue(45)")));
    await queued(h, 'add');
    await reconnect(h, true);
    await both(h, name, 'Left', ROTATION, 24);
    await both(h, name, 'Offline', OPACITY, 45);
    const stamps = await Promise.all(['A', 'B'].map((who) => h.jsx(who, "(function(){var m=" + layer(name, 'Offline') + ".comment.match(/#c:([a-f0-9]{12})/);return m?m[1]:'missing';})()")));
    if (stamps[0] === 'missing' || stamps[0] !== stamps[1]) throw new Error('offline layer identity changed across reload');
  }),
  scenario('later relay edit wins after offline conflict', async (h) => {
    const name = await fixture(h, 'Conflict');
    await offline(h);
    await set(h, 'A', name, 'Left', OPACITY, 11);
    await set(h, 'B', name, 'Left', OPACITY, 88);
    await queued(h);
    await reconnect(h, false);
    await both(h, name, 'Left', OPACITY, 88);
  }),
  scenario('a newer base retains missed deletion and disjoint offline edit on reconnect', async (h) => {
    const name = await fixture(h, 'Newer Base');
    await offline(h);
    requireOk(await h.jsx('A', body(layer(name, 'Left') + '.remove()')));
    await set(h, 'B', name, 'Right', OPACITY, 67);
    await queued(h);
    await shareFixture(h);
    await reconnect(h, false);
    if (!(await h.waitFor(async () => (await h.jsx('B', "vynkPair.layer(" + comp(name) + ",'Left')?'present':'removed'")) === 'removed', 45000, 'missed deletion after newer base'))) throw new Error('new base hid the missed deletion');
    await both(h, name, 'Right', OPACITY, 67);
  }),
  scenario('both concurrent layer creations survive', async (h) => {
    const name = await fixture(h, 'Structure');
    const edits = ['A', 'B'].map((who) => h.jsx(who, body("var l=" + comp(name) + ".layers.addNull(6);l.name='From" + who + "';l.property('ADBE Transform Group').property('ADBE Opacity').setValue(" + (who === 'A' ? 29 : 73) + ')')));
    for (const result of await Promise.all(edits)) requireOk(result);
    await both(h, name, 'FromA', OPACITY, 29);
    await both(h, name, 'FromB', OPACITY, 73);
    for (const who of ['A', 'B']) {
      const count = await h.jsx(who, 'String(' + comp(name) + '.numLayers)');
      if (count !== '4') throw new Error(who + ' lost or duplicated a concurrent layer (' + count + ')');
    }
  }),
  scenario('undo a teammate batch restores both values', async (h) => {
    const name = await fixture(h, 'Undo');
    const start = h.obs.ops.length;
    requireOk(await h.jsx('A', body("var l=" + layer(name, 'Left') + ";l.selected=true;app.beginUndoGroup('Recovery gesture');try{l.property('ADBE Transform Group').property('ADBE Rotate Z').setValue(22);l.property('ADBE Transform Group').property('ADBE Opacity').setValue(43);}finally{app.endUndoGroup();}")));
    await both(h, name, 'Left', ROTATION, 22);
    await both(h, name, 'Left', OPACITY, 43);
    const gestures = h.obs.ops.slice(start).filter((e) => e.by === 'A' && (e.op.kind === 'batch' ? e.op.value.ops : [e.op]).some((op) => op.target.comp.split('|')[1] === name && op.kind === 'prop'));
    if (gestures.length !== 1 || gestures[0].op.kind !== 'batch') throw new Error('one gesture was not one relay batch');
    h.focus('B');
    requireOk(await h.jsx('B', body('app.executeCommand(16)')));
    await both(h, name, 'Left', ROTATION, 0);
    await both(h, name, 'Left', OPACITY, 100);
  }),
  scenario('playheads remain independent while edits sync', async (h) => {
    const name = await fixture(h, 'Playheads');
    try {
      requireOk(await h.jsx('A', body(comp(name) + '.time=1')));
      requireOk(await h.jsx('B', body(comp(name) + '.time=4')));
      await set(h, 'A', name, 'Left', OPACITY, 19);
      await both(h, name, 'Left', OPACITY, 19);
      const times = await Promise.all(['A', 'B'].map((who) => h.jsx(who, 'String(' + comp(name) + '.time)')));
      if (times[0] !== '1' || times[1] !== '4') throw new Error('playheads moved: ' + times.join('/'));
    } finally {
      for (const who of ['A', 'B']) {
        try { await h.jsx(who, body('var c=' + comp(name) + ';if(c)c.time=0')); } catch {}
      }
    }
  }),
  scenario('saved base checkpoint retains edits made during upload and replays after reopen', async (h) => {
    const name = await fixture(h, 'Base Checkpoint');
    const originalB = JSON.parse(await h.jsx('B', 'JSON.stringify(app.project.file.fsName)'));
    requireOk(await h.jsx('A', body(comp(name) + '.time=1')));
    requireOk(await h.jsx('B', body(comp(name) + '.time=4')));
    requireOk(await h.js('A', "window.__vynkBasePut=httpPutFile;window.__vynkBaseCapture=null;httpPutFile=function(q,file,cb){httpPutFile=window.__vynkBasePut;window.__vynkBaseCapture={q:q,file:file,cb:cb,seq:state.baseJob.seq,hash:require('crypto').createHash('sha256').update(require('fs').readFileSync(file)).digest('hex').slice(0,16)};};shareBase();'ok'"));
    try {
      if (!(await h.waitFor(async () => (await h.js('A', "window.__vynkBaseCapture?'ready':'waiting'")) === 'ready', 60000, 'immutable base capture'))) throw new Error('base capture did not reach upload');
      const checkpoint = Number(await h.js('A', 'String(window.__vynkBaseCapture.seq)'));
      const expectedHash = await h.js('A', 'window.__vynkBaseCapture.hash');
      await set(h, 'B', name, 'Left', OPACITY, 63);
      await both(h, name, 'Left', OPACITY, 63);
      requireOk(await h.js('A', "var upload=window.__vynkBaseCapture;window.__vynkBaseCapture=null;window.__vynkBasePut(upload.q,upload.file,upload.cb);'ok'"));
      if (!(await h.waitFor(async () => (await h.js('A', "!state.baseJob&&state.baseInfo&&state.baseInfo.hash===" + literal(expectedHash) + "?'ready':'waiting'")) === 'ready', 45000, 'base upload'))) throw new Error('base upload did not complete');
      const actualSeq = Number(await h.js('A', 'String(state.baseInfo.seq)'));
      if (actualSeq !== checkpoint) throw new Error('upload checkpoint moved while another peer edited');
      if (!(await h.waitFor(async () => (await h.js('B', "state.outbox.length?'waiting':'ready'")) === 'ready', 15000, 'edit acknowledgment before base open'))) throw new Error('edit remained unacknowledged');
      // This is the harness's disposable file, saved before its scripted open.
      requireOk(await h.jsx('B', body('app.project.save()')));
      requireOk(await h.js('B', "window.__vynkOldConfirm=window.confirm;window.confirm=function(){return true;};getBase();'ok'"));
      if (!(await h.waitFor(async () => (await h.js('B', "state.connected&&!state.baseJob&&!state.baseHold&&state.baseOpened?'ready':'waiting'")) === 'ready', 60000, 'base reopen and fresh welcome'))) throw new Error('base reopen did not rebuild its history');
      await both(h, name, 'Left', OPACITY, 63);
      const times = await Promise.all(['A', 'B'].map((who) => h.jsx(who, 'String(' + comp(name) + '.time)')));
      if (times[0] !== '1' || times[1] !== '4') throw new Error('base reopen moved local playheads: ' + times.join('/'));
    } finally {
      try { await h.js('A', "httpPutFile=window.__vynkBasePut;if(window.__vynkBaseCapture){var upload=window.__vynkBaseCapture;window.__vynkBaseCapture=null;upload.cb(new Error('test cancelled'));}'ok'"); } catch {}
      try { await h.js('B', "if(window.__vynkOldConfirm)window.confirm=window.__vynkOldConfirm;'ok'"); } catch {}
      for (const who of ['A', 'B']) {
        try { await h.jsx(who, body('var c=' + comp(name) + ';if(c)c.time=0')); } catch {}
      }
      // Return B to the exact disposable path recorded by safe harness shutdown.
      try { await h.jsx('B', body('app.project.save(new File(' + literal(originalB) + '))')); } catch {}
    }
  })
];
