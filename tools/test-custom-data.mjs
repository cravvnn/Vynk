import assert from 'node:assert/strict';
import { test } from 'node:test';
import fixture from './panel-test-fixture.cjs';
const { panelFixture } = fixture;
const path = 'ADBE Effect Parade/ADBE CurvesCustom/ADBE CurvesCustom-0001';
const animation = 'K|-1/3,1,1,0,,aabb|7/3,3,3,0,,ccdd';
const prop = () => ({ opId: 'curve', kind: 'prop', target: { comp: 'id1|Main', layer: 'id9' }, path, value: { cx: 1, v: { arb: animation } } });
const snapshot = () => ({ id: 'id1|Main', iid: 1, s: {}, sel: [], layers: [{ sid: 'id9', lid: 9, a: { startTime: 1 }, g: {}, p: { [path]: { cx: 1, fx: 3, pi: 2, m: 0 } } }] });
const plain = value => JSON.parse(JSON.stringify(value));

test('custom keys are written after host timing/structure setters using fresh parameter positions', () => {
  const panel = panelFixture();
  const ops = [{ opId: 'timing', kind: 'attr', target: prop().target, path: 'startTime', value: 1 }, prop()];
  const snap = snapshot();
  const events = [];
  Object.assign(panel.state, { rev: 1, everConnected: true, inbox: [ops], aegp: { connected: true }, pollGeneration: 0 });
  const old = snapshot(); old.layers[0].p[path].fx = 1;
  panel.state.shadows.id1 = old;
  panel.set('__host', (_script, cb) => {
    events.push('host timing + structure');
    cb(JSON.stringify({ r: ['', ''], snaps: [snap], items: [], active: 'id1', revBefore: 1, rev: 2, ms: 0, host: {} }));
  });
  panel.set('__native', (lines, cb) => {
    if (!lines.length) return cb([]);
    if (lines[0][0] === 'ARBSET') {
      events.push('native keys');
      assert.deepEqual(plain(lines[0]), ['ARBSET', 1, 9, 3, 2, animation]);
      return cb([['ARBOK', '1', 'ok']]);
    }
    events.push('native read');
    cb([['ARB', '2', 'ok', '3:2:K:' + animation]]);
  });
  panel.set('__finish', out => {
    events.push('adopt + diff');
    panel.set('__record', out.snaps[0].layers[0].p[path]);
    assert.equal(panel.run('arbHex(__record)'), animation);
    assert.deepEqual(plain(out.r), ['', '']);
    return false;
  });
  panel.run('inAE=true; cs={evalScript:__host}; nativeCalls=__native; handleCycle=__finish; pickReads=function(){return {active:{},read:[],must:true};}; projectSwitched=function(){return false;}; kickCycle=function(){}; runCycle();');
  assert.deepEqual(events, ['host timing + structure', 'native keys', 'native read', 'adopt + diff']);
});

test('a rejected custom animation on a newly created layer is reported on its owning add', () => {
  const panel = panelFixture();
  panel.state.aegp.connected = true;
  const out = { r: [''], snaps: [snapshot()] };
  const op = { ...prop(), kind: 'add', value: { layer: { p: { [path]: prop().value } } } };
  panel.set('__out', out); panel.set('__ops', [op]);
  panel.set('__native', (lines, cb) => {
    if (!lines.length) return cb([]);
    cb(lines[0][0] === 'ARBSET' ? [['ARBOK', '1', 'err:size']] : [['ARB', '2', 'ok', '3:2:2:aabb']]);
  });
  panel.run('nativeCalls=__native; customDataPass(__out,__ops,function(){});');
  assert.match(out.r[0], /custom data: err:size/);
});

test('unknown native reads retain the entire last animation while refreshing local positions', () => {
  const panel = panelFixture();
  panel.state.aegp.connected = true;
  const held = snapshot(); held.layers[0].p[path].v = { arb: animation }; held.layers[0].p[path].fx = 1;
  panel.state.shadows.id1 = held;
  const out = { r: [], snaps: [snapshot()] };
  panel.set('__out', out);
  panel.run('nativeCalls=function(lines,cb){cb([]);}; customDataPass(__out,[],function(){});');
  assert.equal(out.snaps[0].layers[0].p[path].v.arb, animation);
  assert.equal(out.snaps[0].layers[0].p[path].fx, 3);
});

test('missing native companion reports custom-data failure for existing and newly added controls', () => {
  const panel = panelFixture();
  panel.state.aegp.connected = false;
  const out = { r: [''], snaps: [snapshot()] };
  panel.set('__out', out); panel.set('__ops', [prop()]);
  assert.equal(panel.run('customDataNeeded(__out,__ops)'), true);
  panel.run('customDataPass(__out,__ops,function(){});');
  assert.match(out.r[0], /needs the Vynk plug-in/);
});

test('native timeout is an apply failure and leaves the prior animation available', () => {
  const panel = panelFixture();
  panel.state.aegp.connected = true;
  const held = snapshot(); held.layers[0].p[path].v = { arb: animation };
  panel.state.shadows.id1 = held;
  const out = { r: [''], snaps: [snapshot()] };
  panel.set('__out', out); panel.set('__ops', [prop()]);
  panel.run('nativeCalls=function(lines,cb){cb([]);}; customDataPass(__out,__ops,function(){});');
  assert.match(out.r[0], /no answer/);
  assert.equal(out.snaps[0].layers[0].p[path].v.arb, animation);
});

test('a truncated native value cannot overwrite the known animation', () => {
  const panel = panelFixture();
  panel.state.aegp.connected = true;
  const held = snapshot(); held.layers[0].p[path].v = { arb: animation };
  panel.state.shadows.id1 = held;
  const out = { r: [], snaps: [snapshot()] };
  panel.set('__out', out);
  panel.run('nativeCalls=function(lines,cb){cb(lines.length?[["ARB","1","ok","3:2:4:abcd"]]:[]);};customDataPass(__out,[],function(){});');
  assert.equal(out.snaps[0].layers[0].p[path].v.arb, animation);
});
