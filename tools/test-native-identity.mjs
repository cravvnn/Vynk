import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import fixture from './panel-test-fixture.cjs';

const engine = fs.readFileSync(new URL('../panel/jsx/sync.jsx', import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const attr = (sid, value = 'Changed') => ({ kind: 'attr', target: { comp: 'id1|Main', layer: sid }, path: 'name', value });

function host(modern = false) {
  function CompItem() {}
  function AVLayer() {}
  const comp = new CompItem();
  const layers = [];
  let nextId = 10;
  let commentWrites = 0;
  function add(name, comment = '') {
    const layer = new AVLayer();
    const nativeId = nextId++;
    Object.assign(layer, { name, nativeId, selected: false, locked: false, nullLayer: true, containingComp: comp, numProperties: 0,
      property() { return null; }, moveToBeginning() { layers.splice(layers.indexOf(this), 1); layers.unshift(this); },
      remove() { layers.splice(layers.indexOf(this), 1); } });
    Object.defineProperty(layer, 'index', { get: () => layers.indexOf(layer) + 1 });
    Object.defineProperty(layer, 'id', { get() { if (modern) return nativeId; throw Error('Layer.id absent'); } });
    Object.defineProperty(layer, 'comment', { get: () => comment, set(value) { commentWrites++; comment = value; } });
    layers.push(layer);
    return layer;
  }
  Object.assign(comp, { id: 1, name: 'Main', comment: '', duration: 10, time: 4, layer(i) { return layers[i - 1]; }, layers: { addNull() { return add('New'); } } });
  Object.defineProperty(comp, 'numLayers', { get: () => layers.length });
  const app = { version: modern ? '25.6' : '17.0', project: { numItems: 1, revision: 1, activeItem: comp, item() { return comp; } }, beginUndoGroup() {}, endUndoGroup() {} };
  const shared = {};
  vm.runInNewContext(engine, { app, CompItem, AVLayer, LightLayer: function () {}, PropertyType: {}, PropertyValueType: {}, JSON, $: { global: shared } });
  const api = shared.vynkSync;
  const table = () => [[comp.id, layers.map(l => l.nativeId)]];
  const request = ops => JSON.stringify({ ops: ops || [], must: 1, active: { all: 1 } });
  return { add, layers, comp, api, table, request, get commentWrites() { return commentWrites; },
    cycle(ops = []) { return JSON.parse(api.cycleNative(request(ops), table())); } };
}

test('AE2020 shared-base layers keep native SIDs without writing comments', () => {
  const a = host(), b = host();
  a.add('Base', 'Andrew comment'); b.add('Base', 'Andrew comment');
  for (const h of [a, b]) {
    const out = h.cycle();
    assert.equal(out.error, undefined);
    assert.equal(out.snaps[0].layers[0].sid, 'id10');
    assert.equal(out.snaps[0].layers[0].lid, 10);
    assert.equal(h.commentWrites, 0);
    assert.equal(h.comp.time, 4);
  }
});

test('SIDs, stamps and native bindings survive reorder, deletion and project replacement without a cache', () => {
  const h = host();
  const base = h.add('Base');
  const stamped = h.add('Stamped', '#c:012345abcdef');
  assert.equal(h.cycle([attr('st012345abcdef')]).r[0], '');
  assert.equal(stamped.name, 'Changed');
  h.layers.reverse();
  h.cycle([attr('id10', 'Base edited')]);
  assert.equal(base.name, 'Base edited');
  stamped.remove();
  const replacement = h.add('Replacement', '#c:012345abcdef');
  const out = h.cycle([attr('st012345abcdef', 'Replacement edited')]);
  assert.equal(out.snaps[0].layers.find(l => l.sid === 'st012345abcdef').lid, replacement.nativeId);
  assert.equal(replacement.name, 'Replacement edited');
  assert.equal(stamped.name, 'Changed');
  h.layers.splice(0);
  h.add('Other project');
  assert.equal(h.cycle([attr('id10')]).r[0], 'layer not found');
  assert.equal(h.layers[0].name, 'Other project');
  assert.equal(h.commentWrites, 0);
});

test('native legacy cycles preserve base aliases and strip a duplicate stamp from the newer native ID', () => {
  const h = host();
  const original = h.add('Original', '#c:=id42.......');
  const copy = h.add('Copy', '#c:=id42.......');
  h.layers.reverse();
  const out = h.cycle();
  assert.equal(out.snaps[0].layers.find(l => l.a.name === 'Original').sid, 'id42');
  assert.equal(out.snaps[0].layers.find(l => l.a.name === 'Copy').sid, 'id11');
  assert.equal(original.comment, '#c:=id42.......');
  assert.equal(copy.comment, '');
});

test('remote creates refresh their fresh native IDs before custom-data addressing', () => {
  const h = host();
  h.add('Base');
  const out = h.cycle([{ kind: 'add', target: { comp: 'id1|Main', layer: 'stabcdef012345' }, value: { layer: { kind: 'null', a: { name: 'Received' }, p: {}, g: {} } } }]);
  assert.deepEqual(out.r, ['']);
  const created = out.snaps[0].layers.find(l => l.sid === 'stabcdef012345');
  assert.equal(created.lid, undefined);
  const refreshed = JSON.parse(h.api.refreshNativeIds(JSON.stringify(out), h.table()));
  assert.equal(refreshed.snaps[0].layers.find(l => l.sid === created.sid).lid, 11);
  assert.equal(h.comp.time, 4);
});

test('invalid native tables reject before a setter or stamp and bindings are cleared after exceptions', () => {
  const h = host();
  const layer = h.add('Base');
  const req = h.request([attr('id10')]);
  for (const table of [[], [[1, []]], [[1, [0]]], [[1, [1.5]]], [[1, [2147483648]]], [[1, [10]], [1, [10]]], [[2, [10]]]]) {
    assert.throws(() => h.api.cycleNative(req, table));
    assert.equal(layer.name, 'Base');
    assert.equal(h.commentWrites, 0);
  }
  assert.throws(() => h.api.refreshNativeIds('{', h.table()));
  assert.equal(h.cycle().snaps[0].layers[0].lid, 10);
  const direct = JSON.parse(h.api.cycle(req));
  assert.match(direct.error, /native layer identity unavailable/);
  assert.deepEqual(direct.r, []);
  assert.equal(layer.name, 'Base');
  assert.equal(h.commentWrites, 0);
});

test('refresh rejects ambiguous or missing SIDs instead of binding a different layer', () => {
  const h = host();
  h.add('Base', '#c:012345abcdef');
  const out = h.cycle();
  h.add('Duplicate', '#c:012345abcdef');
  assert.throws(() => h.api.refreshNativeIds(JSON.stringify(out), h.table()), /ambiguous/);
  h.layers.splice(0);
  h.add('Different');
  assert.throws(() => h.api.refreshNativeIds(JSON.stringify(out), h.table()), /identity changed/);
  assert.equal(h.commentWrites, 0);
});

test('modern direct cycles and forced native cycles expose the same SID and native ID', () => {
  const h = host(true); h.add('Base');
  const req = h.request([]);
  const direct = JSON.parse(h.api.cycle(req)), native = h.cycle();
  delete direct.ms; delete native.ms;
  assert.deepEqual(direct, native);
});

test('legacy panel requests use native main-thread cycles, preserving JSON and the host timeout', () => {
  const panel = fixture.panelFixture();
  const req = { ops: [attr('id10', 'Name\t"雪\n\u2028')], active: { all: 1 } };
  panel.set('__req', req);
  panel.set('__native', (lines, cb, timeout) => {
    assert.deepEqual(plain(lines), [['ARBCYCLE', JSON.stringify(req)]]);
    assert.equal(timeout, 120000);
    cb([['ARBCYCLE', '1', 'ok', '{"r":[""],"snaps":[]}']]);
  });
  let result;
  panel.set('__cb', value => { result = value; });
  panel.run('hostVersion="17.0";cs={evalScript:function(){throw Error("unexpected direct cycle");}};nativeCalls=__native;hostCycle(__req,__cb);');
  assert.equal(result, '{"r":[""],"snaps":[]}');
});

test('a missing or older companion never falls back to legacy direct mutations', () => {
  const panel = fixture.panelFixture();
  let result;
  panel.set('__cb', value => { result = value; });
  panel.run('hostVersion="17.0";cs={evalScript:function(){throw Error("unexpected direct cycle");}};hostCycle({ops:[]},__cb);');
  assert.match(result, /native identity unavailable/);
  panel.run('nativeCalls=function(lines,cb){cb([["ARBCYCLE","1","err:unknown"]]);};hostCycle({ops:[]},__cb);');
  assert.match(result, /native identity unavailable/);
});

test('identity failures requeue the unapplied operations without diffing an empty project', () => {
  const panel = fixture.panelFixture();
  const op = attr('id10');
  Object.assign(panel.state, { inbox: [[op]], everConnected: true });
  panel.set('__host', (_script, cb) => cb('{"r":[],"snaps":[],"items":[],"identityError":1,"error":"native identity unavailable"}'));
  panel.run('inAE=true;cs={evalScript:__host};pickReads=function(){return {active:{},read:[],must:true};};handleCycle=function(){throw Error("must not diff an identity failure");};kickCycle=function(){};runCycle();');
  assert.deepEqual(plain(panel.state.inbox), [[op]]);
  assert.equal(panel.state.cycleBusy, false);
});

test('lite snapshots keep fresh native IDs instead of restoring a shadow binding', () => {
  for (const freshId of [undefined, 11]) {
    const panel = fixture.panelFixture();
    const item = { sid: 'id1', type: 'comp', name: 'Main', parent: '', label: 0 };
    const held = { sid: 'id10', lid: 10, kind: 'null', a: { name: 'Base' }, p: {}, g: {} };
    const snap = { id: 'id1|Main', iid: 1, s: {}, layers: [{ sid: 'id10', lite: 1 }], sel: [] };
    if (freshId !== undefined) snap.layers[0].lid = freshId;
    Object.assign(panel.state, { everConnected: true, deliveryReady: true, shadowItems: [item] });
    panel.state.shadows.id1 = { ...snap, layers: [held] };
    panel.set('__out', { items: [item], snaps: [snap], active: 'id1', host: {} });
    panel.run('sendOps=function(){};handleCycle(__out,[],{});');
    assert.equal(snap.layers[0].lid, freshId);
  }
});
