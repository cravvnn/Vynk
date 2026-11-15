import assert from 'node:assert/strict';
import { test } from 'node:test';
import fixture from './panel-test-fixture.cjs';

const { panelFixture } = fixture;
const clone = (v) => JSON.parse(JSON.stringify(v));
const item = { sid: 'id1', type: 'comp', name: 'Main', parent: '', label: 0, w: 800, h: 600, dur: 6, fr: 30, pa: 1 };
const layer = (sid, opacity) => ({ sid, kind: 'solid', a: { name: sid }, p: { 'ADBE Transform Group/ADBE Opacity': { v: opacity, m: 1 } }, g: {} });
const comp = (layers) => ({ id: 'id1|Main', s: {}, layers, sel: [], full: 1 });
const upsert = { opId: 'item-repair', kind: 'iadd', target: { comp: 'id1' }, value: item };

function setup() {
  const panel = panelFixture();
  Object.assign(panel.state, { everConnected: true, deliveryReady: true, shadowItems: [clone(item)] });
  panel.state.shadows.id1 = comp([layer('id2', 100)]);
  panel.set('__emitted', []);
  panel.set('__requested', []);
  panel.run('sendOps=function(ops){__emitted=__emitted.concat(ops);};sendNeed=function(comp,to,layers){__requested.push({comp:comp,to:to,layers:layers});};');
  return panel;
}

for (const withRead of [false, true]) {
  test('an existing comp item upsert preserves unobserved local values (' + (withRead ? 'same' : 'next') + ' read)', () => {
    const panel = setup();
    panel.set('__upsert', clone(upsert));
    panel.set('__out', { items: [clone(item)], r: [''], snaps: withRead ? [comp([layer('id2', 67)])] : [] });
    panel.run('handleCycle(__out,[__upsert],{})');
    if (!withRead) {
      panel.set('__out', { items: [clone(item)], r: [], snaps: [comp([layer('id2', 67)])] });
      panel.run('handleCycle(__out,[],{})');
    }
    assert(panel.run("__emitted.some(function(op){return op.kind==='prop'&&op.value.v===67;})"));
  });
}

test('an existing comp item upsert cannot absorb an unstamped local layer', () => {
  const panel = setup();
  panel.set('__upsert', clone(upsert));
  panel.set('__out', { items: [clone(item)], r: [''], snaps: [comp([layer('id3', 73), layer('id2', 100)])] });
  panel.run('handleCycle(__out,[__upsert],{})');
  assert.equal(panel.state.stampJob.layers[0][1], 'id3');
});

test('a remote comp creation is read in its apply call before local edits can follow', () => {
  const panel = setup();
  const op = clone(upsert);
  op.target.comp = op.value.sid = 'staaaaaaaaaaaa';
  panel.set('__upsert', op);
  assert(panel.run("pickReads([__upsert]).read.some(function(read){return read.c==='staaaaaaaaaaaa'&&read.all===1;})"));
});

test('repair requests a peer-only layer even when the peer never agreed', () => {
  const panel = setup();
  panel.set('__need', { author: 'peer', op: { target: { comp: 'id1|Main' }, value: { to: 'self', full: 1, fresh: 1, layers: { id2: 'different', id3: 'peer-only' } } } });
  assert.equal(panel.run('answerNeed(__need)'), true);
  assert.equal(panel.run("__emitted.some(function(op){return op.kind==='remove';})"), false);
  assert.equal(panel.run("__requested.some(function(need){return need.layers.id3==='';})"), true);
});

test('full repair answers order and comp-setting drift when layer values already match', () => {
  const panel = setup();
  panel.state.shadows.id1.layers.push(layer('id3', 73));
  panel.state.shadows.id1.s.duration = 6;
  panel.run("answerNeed({author:'peer',op:{target:{comp:'id1|Main'},value:{full:1,layers:Sync.digest(state.shadows.id1).layers}}})");
  assert.equal(panel.run("__emitted.filter(function(op){return op.kind==='reorder';}).length"), 2);
  assert.equal(panel.run("__emitted.some(function(op){return op.kind==='comp'&&op.path==='duration'&&op.value===6;})"), true);
});
