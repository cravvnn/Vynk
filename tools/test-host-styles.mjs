import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const engine = fs.readFileSync(new URL('../panel/jsx/sync.jsx', import.meta.url), 'utf8');

function host(initial, removeWorks = true) {
  let applied = initial.slice();
  let effects = 1;
  let registered = false;
  const commands = [];
  const names = ['dropShadow/enabled', 'innerShadow/enabled', 'frameFX/enabled', 'patternFill/enabled'];
  const slots = names.map((matchName) => ({ matchName, get canSetEnabled() { return applied.includes(matchName); } }));
  const styles = { numProperties: slots.length, get canSetEnabled() { return applied.length > 0; }, property(i) { return typeof i === 'number' ? slots[i - 1] : slots.find((s) => s.matchName === i); } };
  function CompItem() {}
  const comp = new CompItem();
  const layer = { id: 2, name: 'Red', comment: '', selected: true, numProperties: 0, containingComp: comp, property(name) { return name === 'ADBE Layer Styles' ? styles : null; } };
  Object.assign(comp, { id: 1, name: 'Main', comment: '', numLayers: 1, layer() { return layer; }, openInViewer() {} });
  const app = { project: { numItems: 1, revision: 1, activeItem: comp, item() { return comp; } }, activeViewer: { setActive() {} }, beginUndoGroup() {}, endUndoGroup() {},
    executeCommand(id) {
      commands.push(id);
      if (id === 3739) { registered = true; return; }
      if (!registered) return;
      if (id === 2072) effects = 0;
      else if (id === 3744 && removeWorks) applied = [];
      else if (id === 9000) applied.push(names[0]);
      else if (id === 9001) applied.push(names[1]);
      else if (id === 9008) applied.push(names[2]);
    }
  };
  const shared = {};
  vm.runInNewContext(engine, { app, CompItem, PropertyType: { PROPERTY: 1, INDEXED_GROUP: 2 }, PropertyValueType: {}, JSON, $: { global: shared } });
  return { commands, get effects() { return effects; }, get applied() { return applied; },
    apply(want, focused = 1, kind = 'prop', sid = 'id2') {
      const op = { kind, target: { comp: 'id1|Main', layer: sid }, path: 'ADBE Layer Styles@styles', value: kind === 'add' ? { layer: { kind: 'solid', p: { 'ADBE Layer Styles@styles': { v: want } } } } : { v: want } };
      const result = JSON.parse(shared.vynkSync.cycle(JSON.stringify({ ops: [op], focused })));
      assert.equal(result.r.length, 1);
      return result.r[0];
    }
  };
}

test('style replacement removes styles with 3744 and keeps unrelated effects', () => {
  const h = host(['dropShadow/enabled', 'frameFX/enabled']);
  assert.equal(h.apply(['innerShadow/enabled']), '');
  assert.deepEqual(h.commands, [3739, 3744, 9001]);
  assert.deepEqual(h.applied, ['innerShadow/enabled']);
  assert.equal(h.effects, 1);
});

test('a style removal ignored by AE remains pending', () => {
  const h = host(['dropShadow/enabled'], false);
  assert.equal(h.apply([]), 'needs the comp open');
  assert.deepEqual(h.applied, ['dropShadow/enabled']);
});

test('styles wait for foreground and a repeated successful set is idempotent', () => {
  const h = host([]);
  assert.equal(h.apply(['dropShadow/enabled'], 0), 'needs the comp open');
  assert.deepEqual(h.commands, []);
  assert.equal(h.apply(['dropShadow/enabled']), '');
  assert.equal(h.apply(['dropShadow/enabled']), '');
  assert.deepEqual(h.commands, [3739, 9000]);
});

test('an existing Pattern Overlay is recognized without menu commands or foreground focus', () => {
  const h = host(['patternFill/enabled']);
  assert.equal(h.apply(['patternFill/enabled'], 0), '');
  assert.deepEqual(h.commands, []);
});

test('a missing pattern requires artwork from the shared base before changing other styles', () => {
  const h = host(['dropShadow/enabled']);
  assert.match(h.apply(['patternFill/enabled'], 0), /artwork.*shared base/);
  assert.deepEqual(h.applied, ['dropShadow/enabled']);
  assert.deepEqual(h.commands, []);
});

test('rebuilding mixed styles never discards an existing pattern to remove another style', () => {
  const h = host(['dropShadow/enabled', 'patternFill/enabled']);
  assert.match(h.apply(['patternFill/enabled']), /losing Pattern Overlay artwork/);
  assert.deepEqual(h.applied, ['dropShadow/enabled', 'patternFill/enabled']);
  assert.deepEqual(h.commands, []);
});

test('a layer upsert cannot silently create a blank replacement for missing pattern artwork', () => {
  const h = host(['dropShadow/enabled']);
  assert.match(h.apply(['patternFill/enabled'], 0, 'add'), /artwork.*shared base/);
  assert.match(h.apply(['patternFill/enabled'], 0, 'add', 'stnew'), /artwork.*shared base/);
  assert.deepEqual(h.applied, ['dropShadow/enabled']);
  assert.deepEqual(h.commands, []);
});
