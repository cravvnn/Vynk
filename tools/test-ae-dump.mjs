import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const source = fs.readFileSync(new URL('./ae-pair/lib.jsx', import.meta.url), 'utf8');
const valueKey = 'L:Layer/ADBE Rotate Z';

function snapshot({ time = 0, base = 33, expression = 'time * 90', enabled = true, keys = [] } = {}) {
  const calls = [];
  let valueReads = 0;
  function CompItem() {}
  const comp = Object.assign(new CompItem(), {
    name: 'Main', typeName: 'Composition', width: 1920, height: 1080,
    duration: 10, frameRate: 30, pixelAspect: 1, bgColor: 0,
    motionBlur: false, shutterAngle: 180, shutterPhase: -90,
    workAreaStart: 0, workAreaDuration: 10, numLayers: 1, time
  });
  const prop = {
    matchName: 'ADBE Rotate Z', canSetExpression: true,
    expression, expressionEnabled: enabled, numKeys: keys.length,
    valueAtTime(at, preExpression) {
      calls.push({ at, preExpression });
      return preExpression || !expression || !enabled ? base : at * 90;
    },
    keyTime(index) { return keys[index - 1].t; },
    keyValue(index) { return keys[index - 1].v; },
    keyInInterpolationType() { return 'linear'; },
    keyOutInterpolationType() { return 'linear'; }
  };
  Object.defineProperty(prop, 'value', {
    get() {
      valueReads++;
      return expression && enabled ? comp.time * 90 : base;
    }
  });
  const layer = {
    name: 'Layer', comment: '', parent: null, numProperties: 1,
    property(index) { assert.equal(index, 1); return prop; }
  };
  comp.layer = index => { assert.equal(index, 1); return layer; };
  const context = {
    $: { global: {} }, CompItem,
    app: { project: { numItems: 1, item(index) { assert.equal(index, 1); return comp; } } }
  };
  vm.runInNewContext(source, context);
  const dump = JSON.parse(context.$.global.vynkPair.dump('Main'));
  return { dump, calls, valueReads, time: comp.time };
}

test('AE project comparison reads expression input without moving independent playheads', () => {
  const a = snapshot({ time: 0 });
  const b = snapshot({ time: 3.25 });
  assert.deepEqual(a.dump, b.dump);
  assert.equal(a.dump[valueKey], 33);
  assert.equal(a.dump[valueKey + '@expr'], 'time * 90');
  for (const result of [a, b]) {
    assert.equal(result.calls.length, 1);
    assert.equal(result.calls[0].preExpression, true);
    assert.equal(result.valueReads, 0);
  }
  assert.equal(a.time, 0);
  assert.equal(b.time, 3.25);
});

test('AE project comparison still detects expression input, source and enable-state drift', () => {
  const base = snapshot().dump;
  const changedInput = snapshot({ base: 34 }).dump;
  assert.equal(changedInput[valueKey], 34);
  assert.notDeepEqual(base, changedInput);
  assert.notDeepEqual(base, snapshot({ expression: 'time * 45' }).dump);
  assert.notDeepEqual(base, snapshot({ enabled: false }).dump);
});

test('ordinary and disabled-expression values retain their direct scalar reads', () => {
  for (const options of [{ expression: '' }, { enabled: false }]) {
    const result = snapshot(options);
    assert.equal(result.dump[valueKey], 33);
    assert.equal(result.valueReads, 1);
    assert.deepEqual(result.calls, []);
  }
  assert.equal(snapshot({ enabled: false }).dump[valueKey + '@expr'], 'time * 90 [off]');
});

test('keyed expression inputs retain their authored key values and times', () => {
  const keys = [{ t: 0, v: 33 }, { t: 1.5, v: 90 }];
  const a = snapshot({ time: 0, keys });
  const b = snapshot({ time: 3.25, keys });
  assert.deepEqual(a.dump, b.dump);
  assert.deepEqual(a.dump[valueKey + '@keys'], [[0, 33, 'linear/linear'], [1.5, 90, 'linear/linear']]);
  assert.notDeepEqual(a.dump, snapshot({ keys: [{ t: 0, v: 34 }, keys[1]] }).dump);
  assert.equal(a.valueReads, 0);
  assert.deepEqual(a.calls, []);
});
