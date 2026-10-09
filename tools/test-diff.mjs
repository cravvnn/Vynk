import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
require(path.join(__dirname, '..', 'panel', 'src', 'diff.js'));
const D = globalThis.CollabDiff;

let failures = 0;
function assert(cond, label) {
  if (cond) {
    console.log('ok: ' + label);
  } else {
    failures++;
    console.error('FAIL: ' + label);
  }
}

const noSuppress = { suppress: () => false };

function prop(value, keys) {
  const p = { value, numKeys: keys ? keys.length : 0 };
  if (keys) p.keys = keys;
  return p;
}

function key(t, v, inT = 1, outT = 1) {
  return { t, v, inT, outT };
}

function baseTransform() {
  return {
    position: prop([0, 0]),
    anchor: prop([0, 0]),
    scale: prop([100, 100]),
    rotation: prop(0),
    opacity: prop(100),
  };
}

function layer(sid, over = {}) {
  return Object.assign(
    {
      sid,
      name: sid,
      type: 'av',
      enabled: true,
      solo: false,
      selected: false,
      locked: false,
      inPoint: 0,
      outPoint: 2,
      startTime: 0,
      comment: '',
      transform: baseTransform(),
    },
    over
  );
}

function comp(id, layers, extra = {}) {
  return Object.assign(
    {
      comp: { id, name: 'Main', width: 1920, height: 1080, duration: 2, numLayers: layers.length },
      layers,
      selection: [],
      hasOmittedKeys: false,
    },
    extra
  );
}

function withTransform(l, changes) {
  return Object.assign({}, l, { transform: Object.assign(baseTransform(), changes) });
}

const A = '100|Main';

{
  const prev = comp(A, [layer('id1')]);
  const next = comp(A, [layer('id1')]);
  assert(D.diffComp(prev, next, noSuppress).length === 0, 'identical snapshots produce no ops');
}

{
  const prev = comp(A, [layer('id1')]);
  const next = comp(A, [withTransform(layer('id1'), { position: prop([10, 20]) })]);
  const ops = D.diffComp(prev, next, noSuppress);
  assert(ops.length === 1 && ops[0].kind === 'set', 'position change emits one set op');
  assert(ops[0].path === 'transform.position', 'position op path correct');
  assert(JSON.stringify(ops[0].value) === '[10,20]', 'position op value correct');
  assert(ops[0].target.layer === 'id1' && ops[0].target.comp === A, 'op target correct');
}

{
  const prev = comp(A, [layer('id1')]);
  const next = comp(A, [withTransform(layer('id1'), { opacity: prop(42) })]);
  const ops = D.diffComp(prev, next, noSuppress);
  assert(ops.length === 1 && ops[0].path === 'transform.opacity' && ops[0].value === 42, 'opacity change syncs scalar');
}

{
  const prev = comp(A, [layer('id1')]);
  const next = comp(A, [withTransform(layer('id1'), { scale: prop([80, 120]) })]);
  const ops = D.diffComp(prev, next, noSuppress);
  assert(ops.length === 1 && ops[0].path === 'transform.scale', 'scale change syncs array');
}

{
  const prev = comp(A, [layer('id1')]);
  const next = comp(A, [layer('id1', { name: 'Renamed' })]);
  const ops = D.diffComp(prev, next, noSuppress);
  assert(ops.length === 1 && ops[0].path === 'name' && ops[0].value === 'Renamed', 'layer rename syncs');
}

{
  const prev = comp(A, [layer('id1')]);
  const next = comp(A, [layer('id1', { enabled: false, inPoint: 0.5 })]);
  const ops = D.diffComp(prev, next, noSuppress);
  assert(ops.length === 2, 'enabled and inPoint both sync');
  assert(ops.some((o) => o.path === 'enabled' && o.value === false), 'enabled false value carried');
  assert(ops.some((o) => o.path === 'inPoint' && o.value === 0.5), 'inPoint value carried');
}

{
  const prev = comp(A, [layer('id1')]);
  const next = comp(A, [layer('id1'), layer('id2')]);
  assert(D.diffComp(prev, next, noSuppress).length === 0, 'added layers wait for structure ops');
}

{
  const prev = comp(A, [layer('id1')]);
  const next = comp(A, [withTransform(layer('id1'), { position: prop([0, 0], [key(0, [0, 0]), key(1, [50, 50])]) })]);
  const ops = D.diffComp(prev, next, noSuppress);
  assert(ops.length === 2 && ops.every((o) => o.kind === 'addKey'), 'two keyframes added produce two addKey ops');
  assert(ops[0].time === 0 && ops[1].time === 1, 'addKey times carried');
  assert(JSON.stringify(ops[1].value) === '[50,50]', 'addKey value carried');
  assert(ops[0].interp && ops[0].interp.inType === 1, 'addKey interpolation carried');
}

{
  const k1 = [key(0, [0, 0]), key(1, [50, 50])];
  const k2 = [key(0, [0, 0]), key(1, [99, 50])];
  const prev = comp(A, [withTransform(layer('id1'), { position: prop([0, 0], k1) })]);
  const next = comp(A, [withTransform(layer('id1'), { position: prop([0, 0], k2) })]);
  const ops = D.diffComp(prev, next, noSuppress);
  assert(ops.length === 1 && ops[0].kind === 'setKey' && ops[0].time === 1, 'key value change emits setKey');
  assert(JSON.stringify(ops[0].value) === '[99,50]', 'setKey value carried');
}

{
  const k1 = [key(0, [0, 0]), key(1, [50, 50])];
  const k2 = [key(0, [0, 0])];
  const prev = comp(A, [withTransform(layer('id1'), { position: prop([0, 0], k1) })]);
  const next = comp(A, [withTransform(layer('id1'), { position: prop([0, 0], k2) })]);
  const ops = D.diffComp(prev, next, noSuppress);
  assert(ops.length === 1 && ops[0].kind === 'removeKey' && ops[0].time === 1, 'key removal emits removeKey');
}

{
  const k1 = [key(0, [0, 0], 1, 1), key(1, [50, 50], 1, 1)];
  const k2 = [key(0, [0, 0], 1, 1), key(1, [50, 50], 2, 3)];
  const prev = comp(A, [withTransform(layer('id1'), { position: prop([0, 0], k1) })]);
  const next = comp(A, [withTransform(layer('id1'), { position: prop([0, 0], k2) })]);
  const ops = D.diffComp(prev, next, noSuppress);
  assert(ops.length === 1 && ops[0].kind === 'setKey', 'interpolation-only change emits setKey');
  assert(ops[0].interp.inType === 2 && ops[0].interp.outType === 3, 'interpolation values carried');
}

{
  const prev = comp(A, [layer('id1')]);
  const next = comp(A, [layer('id1')]);
  next.layers[0].transform.position = Object.assign(prop([10, 10]), { hasExpr: true, value: [10, 10] });
  prev.layers[0].transform.position = Object.assign(prop([0, 0]), { hasExpr: true });
  assert(D.diffComp(prev, next, noSuppress).length === 0, 'expression-driven props are skipped');
}

{
  const prev = comp(A, [layer('id1')]);
  const next = comp(A, [layer('id1')]);
  prev.layers[0].transform.opacity = Object.assign(prop(100), { keysOmitted: true });
  next.layers[0].transform.opacity = Object.assign(prop(50), { keysOmitted: true });
  assert(D.diffComp(prev, next, noSuppress).length === 0, 'props over key budget are skipped');
}

{
  const prev = comp(A, [layer('id1')]);
  const next = comp(A, [layer('id1')]);
  next.layers[0].transform.rotation = Object.assign(prop(45), { unsupported: true });
  assert(D.diffComp(prev, next, noSuppress).length === 0, 'unsupported props are skipped');
}

{
  const prev = comp(A, [layer('id1')]);
  const next = comp(A, [withTransform(layer('id1'), { position: prop([10, 20]) })]);
  const suppressAll = { suppress: () => true };
  assert(D.diffComp(prev, next, suppressAll).length === 0, 'suppress hook blocks emission');
}

{
  const prev = comp('200|Other', [layer('id1')]);
  const next = comp(A, [withTransform(layer('id1'), { position: prop([10, 20]) })]);
  assert(D.diffComp(prev, next, noSuppress).length === 0, 'comp switch produces no ops');
}

{
  const prev = comp(A, [layer('id1')]);
  const next = comp(A, [withTransform(layer('id1'), { position: prop([10, 20]), opacity: prop(50) })]);
  next.layers[0].name = 'Moved';
  const ops = D.diffComp(prev, next, noSuppress);
  assert(ops.length === 3, 'combined changes emit all ops at once');
}

{
  assert(D.valuesNear([10, 20], [10.000001, 20]) === true, 'valuesNear tolerates tiny drift');
  assert(D.valuesNear([10, 20], [11, 20]) === false, 'valuesNear rejects real change');
  assert(D.valuesNear(5, 5.000001) === true, 'valuesNear tolerates scalar drift');
  assert(D.valuesNear(100, 100.5) === false, 'valuesNear rejects scalar change');
  assert(D.keyId(1.00001) === D.keyId(1.00002), 'key times quantized consistently');
}

{
  const echo = D.createEcho();
  echo.mark('id1', 'transform.position', [10, 20]);
  assert(echo.suppress('id1', 'transform.position', [10, 20]) === true, 'echo suppresses matching value');
  assert(echo.suppress('id1', 'transform.position', [10, 20]) === false, 'echo suppresses only once');
  echo.mark('id1', 'transform.position', undefined);
  assert(echo.suppress('id1', 'transform.position', [999, 999]) === true, 'key-level echo suppresses next poll');
  echo.mark('id1', 'transform.position', [1, 1]);
  assert(echo.suppress('id1', 'transform.position', [5, 5]) === false, 'echo mismatch passes through');
}

{
  const echo = D.createEcho();
  const prev = comp(A, [layer('id1')]);
  const next = comp(A, [withTransform(layer('id1'), { position: prop([10, 20]) })]);
  echo.mark('id1', 'transform.position', [10, 20]);
  assert(D.diffComp(prev, next, echo).length === 0, 'echo integration prevents re-emitting remote apply');
  assert(D.diffComp(prev, next, echo).length === 1, 'later identical edit still emits');
}

{
  const prev = comp(A, [layer('a', { index: 1 }), layer('b', { index: 2 })]);
  const next = comp(A, [layer('a', { index: 1 })]);
  const ops = D.diffComp(prev, next, noSuppress);
  assert(ops.length === 1 && ops[0].kind === 'remove' && ops[0].target.layer === 'b', 'layer removal emits remove op');
}

{
  const prev = comp(A, [layer('a', { index: 1 }), layer('b', { index: 2 }), layer('c', { index: 3 })]);
  const next = comp(A, [layer('a', { index: 1 }), layer('c', { index: 2 })]);
  const ops = D.diffComp(prev, next, noSuppress);
  assert(ops.length === 1 && ops[0].kind === 'remove', 'removal index shift does not emit spurious reorders');
}

{
  const prev = comp(A, [layer('a', { index: 1 }), layer('b', { index: 2 }), layer('c', { index: 3 })]);
  const next = comp(A, [layer('b', { index: 1 }), layer('a', { index: 2 }), layer('c', { index: 3 })]);
  const ops = D.diffComp(prev, next, noSuppress);
  assert(
    ops.length === 1 && ops[0].kind === 'reorder' && ops[0].target.layer === 'b' && ops[0].index === 1,
    'reorder emits for the first mismatching layer with its target index'
  );
}

{
  const prev = comp(A, [layer('a', { index: 1 }), layer('b', { index: 2 }), layer('c', { index: 3 })]);
  const next = comp(A, [layer('a', { index: 1 }), layer('c', { index: 2 }), layer('b', { index: 3 })]);
  const ops = D.diffComp(prev, next, noSuppress);
  assert(
    ops.length === 1 && ops[0].kind === 'reorder' && ops[0].target.layer === 'c' && ops[0].index === 2,
    'move-to-end reorder carries the target index'
  );
}

{
  const prev = comp(A, [layer('a', { index: 1 }), layer('b', { index: 2 })]);
  const next = comp(A, [layer('x', { index: 1 }), layer('a', { index: 2 }), layer('b', { index: 3 })]);
  assert(D.diffComp(prev, next, noSuppress).length === 0, 'added layers emit nothing yet (M3 step 2)');
}

{
  const prev = comp(A, [layer('a', { index: 1 }), layer('b', { index: 2 })]);
  const next = comp(A, [layer('a', { index: 1 })]);
  const suppressAll = { suppress: () => true };
  assert(D.diffComp(prev, next, suppressAll).length === 0, 'suppress hook blocks structure ops');
}

{
  const echo = D.createEcho();
  const prev = comp(A, [layer('a', { index: 1 }), layer('b', { index: 2 })]);
  const next = comp(A, [layer('a', { index: 1 })]);
  echo.mark('b', '', undefined);
  assert(D.diffComp(prev, next, echo).length === 0, 'echo suppresses a re-emitted removal');
}

{
  const prev = comp(A, [layer('a', { index: 1 })]);
  const next = comp(A, [layer('x', { index: 1 }), layer('a', { index: 2 })]);
  const adds = D.findAdditions(prev, next, noSuppress);
  assert(adds.length === 1 && adds[0].sid === 'x', 'findAdditions reports a new layer');
}

{
  const prev = comp(A, [layer('a', { index: 1 }), layer('b', { index: 2 })]);
  const next = comp(A, [layer('a', { index: 1 }), layer('b', { index: 2 })]);
  assert(D.findAdditions(prev, next, noSuppress).length === 0, 'findAdditions ignores unchanged layers');
}

{
  const prev = comp(A, [layer('a', { index: 1 })]);
  const next = comp(A, [layer('x', { index: 1 }), layer('a', { index: 2 })]);
  const suppressAll = { suppress: () => true };
  assert(D.findAdditions(prev, next, suppressAll).length === 0, 'findAdditions respects echo suppression');
}

{
  const prev = comp('200|Other', [layer('a', { index: 1 })]);
  const next = comp(A, [layer('x', { index: 1 })]);
  assert(D.findAdditions(prev, next, noSuppress).length === 0, 'findAdditions ignores comp switches');
}

function fx(id, matchName, over = {}) {
  return Object.assign({ id, matchName, name: matchName, enabled: true, index: 1, props: {} }, over);
}

function fxComp(id, layers) {
  return { comp: { id }, layers };
}

function fxProp(value, keys) {
  const p = { value, numKeys: keys ? keys.length : 0 };
  if (keys) p.keys = keys;
  return p;
}

{
  const prev = fxComp(A, [{ sid: 'id1', effects: [] }]);
  const next = fxComp(A, [
    {
      sid: 'id1',
      effects: [fx('ADBE Glo2#1', 'ADBE Glo2', { props: { 'ADBE Glo2-0001': fxProp(1) } })],
    },
  ]);
  const ops = D.diffEffects(prev, next, noSuppress);
  assert(ops.length === 1 && ops[0].kind === 'addEffect', 'adding an effect emits addEffect');
  assert(ops[0].path === 'fx:ADBE Glo2#1', 'addEffect path carries the effect id');
  assert(ops[0].value.matchName === 'ADBE Glo2' && ops[0].value.props['ADBE Glo2-0001'].value === 1, 'addEffect carries descriptor and props');
}

{
  const prev = fxComp(A, [{ sid: 'id1', effects: [fx('ADBE Glo2#1', 'ADBE Glo2')] }]);
  const next = fxComp(A, [{ sid: 'id1', effects: [] }]);
  const ops = D.diffEffects(prev, next, noSuppress);
  assert(ops.length === 1 && ops[0].kind === 'removeEffect' && ops[0].path === 'fx:ADBE Glo2#1', 'removing an effect emits removeEffect');
}

{
  const prev = fxComp(A, [{ sid: 'id1', effects: [fx('ADBE Glo2#1', 'ADBE Glo2')] }]);
  const next = fxComp(A, [{ sid: 'id1', effects: [fx('ADBE Glo2#1', 'ADBE Glo2', { enabled: false })] }]);
  const ops = D.diffEffects(prev, next, noSuppress);
  assert(ops.length === 1 && ops[0].kind === 'setEffect' && ops[0].value.enabled === false, 'effect enable toggle emits setEffect');
}

{
  const prev = fxComp(A, [{ sid: 'id1', effects: [fx('ADBE Glo2#1', 'ADBE Glo2', { index: 2 })] }]);
  const next = fxComp(A, [{ sid: 'id1', effects: [fx('ADBE Glo2#1', 'ADBE Glo2', { index: 1 })] }]);
  const ops = D.diffEffects(prev, next, noSuppress);
  assert(ops.length === 1 && ops[0].kind === 'setEffect' && ops[0].index === 1, 'effect reorder emits setEffect with index');
}

{
  const prev = fxComp(A, [{ sid: 'id1', effects: [fx('ADBE Glo2#1', 'ADBE Glo2', { props: { 'ADBE Glo2-0001': fxProp(1) } })] }]);
  const next = fxComp(A, [{ sid: 'id1', effects: [fx('ADBE Glo2#1', 'ADBE Glo2', { props: { 'ADBE Glo2-0001': fxProp(2.5) } })] }]);
  const ops = D.diffEffects(prev, next, noSuppress);
  assert(ops.length === 1 && ops[0].kind === 'set', 'effect param change emits set');
  assert(ops[0].path === 'fx:ADBE Glo2#1/ADBE Glo2-0001' && ops[0].value === 2.5, 'effect param path and value correct');
}

{
  const prev = fxComp(A, [{ sid: 'id1', effects: [fx('ADBE Glo2#1', 'ADBE Glo2', { props: { 'ADBE Glo2-0002': fxProp([1, 1, 1]) } })] }]);
  const next = fxComp(A, [
    {
      sid: 'id1',
      effects: [fx('ADBE Glo2#1', 'ADBE Glo2', { props: { 'ADBE Glo2-0002': fxProp([1, 1, 1], [key(0, [1, 1, 1]), key(1, [0, 0, 0])]) } })],
    },
  ]);
  const ops = D.diffEffects(prev, next, noSuppress);
  assert(ops.length === 2 && ops.every((o) => o.kind === 'addKey'), 'effect param keyframes emit addKey ops');
  assert(ops[0].path === 'fx:ADBE Glo2#1/ADBE Glo2-0002', 'effect keyframe path correct');
}

{
  const prev = fxComp(A, [{ sid: 'id1', effects: [fx('ADBE Glo2#1', 'ADBE Glo2')] }]);
  const next = fxComp(A, [{ sid: 'id1', effects: [fx('ADBE Glo2#1', 'ADBE Glo2')] }]);
  assert(D.diffEffects(prev, next, noSuppress).length === 0, 'unchanged effects emit nothing');
}

{
  const prev = fxComp(A, [{ sid: 'id1', effects: [] }]);
  const next = fxComp(A, [{ sid: 'id1', effects: [fx('ADBE Glo2#1', 'ADBE Glo2')] }]);
  const suppressAll = { suppress: () => true };
  assert(D.diffEffects(prev, next, suppressAll).length === 0, 'suppress hook blocks effect ops');
}

{
  const echo = D.createEcho();
  const prev = fxComp(A, [{ sid: 'id1', effects: [] }]);
  const next = fxComp(A, [{ sid: 'id1', effects: [fx('ADBE Glo2#1', 'ADBE Glo2')] }]);
  echo.mark('id1', 'fx:ADBE Glo2#1', undefined);
  assert(D.diffEffects(prev, next, echo).length === 0, 'echo suppresses a re-emitted effect add');
}

{
  const prev = comp(A, [layer('id1', { parent: null }), layer('id2', { parent: null })]);
  const next = comp(A, [layer('id1', { parent: null }), layer('id2', { parent: 'id1' })]);
  const ops = D.diffComp(prev, next, noSuppress);
  assert(ops.length === 1 && ops[0].path === 'parent' && ops[0].value === 'id1', 'layer parenting emits set parent');
}

{
  const prev = comp(A, [layer('id1', { parent: 'id2' }), layer('id2', { parent: null })]);
  const next = comp(A, [layer('id1', { parent: null }), layer('id2', { parent: null })]);
  const ops = D.diffComp(prev, next, noSuppress);
  assert(ops.length === 1 && ops[0].path === 'parent' && ops[0].value === null, 'unparenting emits set parent null');
}

{
  const prev = comp(A, [withTransform(layer('id1'), { position: prop([0, 0]) })]);
  prev.layers[0].transform.position.expr = 'wiggle(1,10)';
  prev.layers[0].transform.position.exprOn = true;
  prev.layers[0].transform.position.hasExpr = true;
  const next = comp(A, [withTransform(layer('id1'), { position: prop([0, 0]) })]);
  next.layers[0].transform.position.expr = 'wiggle(2,20)';
  next.layers[0].transform.position.exprOn = true;
  next.layers[0].transform.position.hasExpr = true;
  const ops = D.diffComp(prev, next, noSuppress);
  assert(ops.length === 1 && ops[0].kind === 'setExpr', 'expression edit emits setExpr');
  assert(ops[0].path === 'transform.position@expr' && ops[0].value.text === 'wiggle(2,20)', 'setExpr carries text');
}

{
  const prev = comp(A, [withTransform(layer('id1'), { position: prop([0, 0]) })]);
  prev.layers[0].transform.position.expr = 'wiggle(1,10)';
  prev.layers[0].transform.position.exprOn = true;
  prev.layers[0].transform.position.hasExpr = true;
  const next = comp(A, [withTransform(layer('id1'), { position: prop([0, 0]) })]);
  const ops = D.diffComp(prev, next, noSuppress);
  assert(ops.length === 1 && ops[0].kind === 'setExpr' && ops[0].value.text === '', 'expression removal emits setExpr with empty text');
}

{
  const prev = comp(A, [layer('id1', { trkMatte: false, trkType: 0 })]);
  const next = comp(A, [layer('id1', { trkMatte: true, trkType: 3 })]);
  const ops = D.diffComp(prev, next, noSuppress);
  assert(ops.length === 2, 'track matte flags emit set ops');
  assert(ops.some((o) => o.path === 'trkMatte' && o.value === true), 'trkMatte op carries value');
  assert(ops.some((o) => o.path === 'trkType' && o.value === 3), 'trkType op carries value');
}

function mask(index, over = {}) {
  return Object.assign({ index, maskMode: 1, inverted: false, maskFeather: [0, 0], maskOpacity: 100, maskExpansion: 0 }, over);
}

{
  const prev = comp(A, [layer('id1', { masks: [] })]);
  const next = comp(A, [
    layer('id1', { masks: [mask(1, { maskMode: 2, path: prop({ vertices: [[0, 0], [10, 0], [10, 10]], inTangents: [], outTangents: [], closed: true }) })] }),
  ]);
  const ops = D.diffComp(prev, next, noSuppress);
  assert(ops.length === 1 && ops[0].kind === 'addMask', 'adding a mask emits addMask');
  assert(ops[0].path === 'mask:1' && ops[0].value.maskMode === 2, 'addMask carries descriptor');
}

{
  const prev = comp(A, [layer('id1', { masks: [mask(1)] })]);
  const next = comp(A, [layer('id1', { masks: [] })]);
  const ops = D.diffComp(prev, next, noSuppress);
  assert(ops.length === 1 && ops[0].kind === 'removeMask' && ops[0].path === 'mask:1', 'removing a mask emits removeMask');
}

{
  const prev = comp(A, [layer('id1', { masks: [mask(1, { maskFeather: [10, 10] })] })]);
  const next = comp(A, [layer('id1', { masks: [mask(1, { maskFeather: [20, 20] })] })]);
  const ops = D.diffComp(prev, next, noSuppress);
  assert(ops.length === 1 && ops[0].kind === 'set' && ops[0].path === 'mask:1/maskFeather', 'mask feather change emits set');
  assert(JSON.stringify(ops[0].value) === '[20,20]', 'mask feather value carried');
}

{
  const p1 = prop({ vertices: [[0, 0], [10, 0], [10, 10]], inTangents: [], outTangents: [], closed: true });
  const p2 = prop({ vertices: [[0, 0], [50, 0], [50, 50]], inTangents: [], outTangents: [], closed: true });
  const prev = comp(A, [layer('id1', { masks: [mask(1, { path: p1 })] })]);
  const next = comp(A, [layer('id1', { masks: [mask(1, { path: p2 })] })]);
  const ops = D.diffComp(prev, next, noSuppress);
  assert(ops.length === 1 && ops[0].path === 'mask:1/path', 'mask path change emits set mask:1/path');
}

{
  const echo = D.createEcho();
  const prev = comp(A, [layer('id1', { masks: [] })]);
  const next = comp(A, [layer('id1', { masks: [mask(1)] })]);
  echo.mark('id1', 'mask:1', undefined);
  assert(D.diffComp(prev, next, echo).length === 0, 'echo suppresses a re-emitted mask add');
}

{
  const shape = {
    vertices: [[0, 0], [10, 0], [10, 10]],
    inTangents: [[0, 0], [0, 0], [0, 0]],
    outTangents: [[0, 0], [0, 0], [0, 0]],
    closed: true,
  };
  const shapeCopy = JSON.parse(JSON.stringify(shape));
  const prev = comp(A, [layer('id1', { masks: [mask(1, { path: prop(shape) })] })]);
  const next = comp(A, [layer('id1', { masks: [mask(1, { path: prop(shapeCopy) })] })]);
  assert(D.diffComp(prev, next, noSuppress).length === 0, 'identical mask shapes emit nothing');
}

{
  const shape1 = { vertices: [[0, 0], [10, 0], [10, 10]], inTangents: [], outTangents: [], closed: true };
  const shape2 = { vertices: [[5, 5], [10, 0], [10, 10]], inTangents: [], outTangents: [], closed: true };
  const prev = comp(A, [layer('id1', { masks: [mask(1, { path: prop(shape1) })] })]);
  const next = comp(A, [layer('id1', { masks: [mask(1, { path: prop(shape2) })] })]);
  const ops = D.diffComp(prev, next, noSuppress);
  assert(ops.length === 1 && ops[0].path === 'mask:1/path', 'moving a mask emits set mask:1/path');
  assert(JSON.stringify(ops[0].value.vertices[0]) === '[5,5]', 'moved mask carries new vertices');
}

{
  const prev = comp(A, [layer('t1', { type: 'text', textDoc: { text: 'hello', fontSize: 72, fillColor: [1, 1, 1, 1] } })]);
  const next = comp(A, [layer('t1', { type: 'text', textDoc: { text: 'hello world', fontSize: 72, fillColor: [1, 1, 1, 1] } })]);
  const ops = D.diffComp(prev, next, noSuppress);
  assert(ops.length === 1 && ops[0].path === 'textDoc' && ops[0].value.text === 'hello world', 'text document change emits set textDoc');
}

{
  const doc = { text: 'hello', fontSize: 72, fillColor: [1, 1, 1, 1] };
  const prev = comp(A, [layer('t1', { type: 'text', textDoc: doc })]);
  const next = comp(A, [layer('t1', { type: 'text', textDoc: JSON.parse(JSON.stringify(doc)) })]);
  assert(D.diffComp(prev, next, noSuppress).length === 0, 'identical text documents emit nothing');
}

{
  const prev = comp(A, [layer('id1', { motionBlur: false, frameBlending: false, frameBlendingType: 0 })]);
  const next = comp(A, [layer('id1', { motionBlur: true, frameBlending: true, frameBlendingType: 2 })]);
  const ops = D.diffComp(prev, next, noSuppress);
  assert(ops.length === 3, 'motion blur + frame blending emit three ops');
  assert(ops.some((o) => o.path === 'motionBlur' && o.value === true), 'motionBlur op carries value');
  assert(ops.some((o) => o.path === 'frameBlendingType' && o.value === 2), 'frameBlendingType op carries value');
}

{
  const prev = comp(A, [layer('id1')]);
  prev.comp.frameRate = 24;
  prev.comp.bgColor = [0, 0, 0];
  const next = comp(A, [layer('id1')]);
  next.comp.frameRate = 30;
  next.comp.bgColor = [0, 0, 0];
  const ops = D.diffComp(prev, next, noSuppress);
  assert(ops.length === 1 && ops[0].kind === 'setComp' && ops[0].path === 'frameRate' && ops[0].value === 30, 'comp frame rate change emits setComp');
}

{
  const prev = comp(A, [layer('id1')]);
  const next = comp(A, [layer('id1')]);
  assert(D.diffComp(prev, next, noSuppress).length === 0, 'identical comp settings emit nothing');
}

{
  const k1 = [{ t: 0, v: 100, inT: 2, outT: 2, inEase: [[0, 33]], outEase: [[0, 33]] }];
  const k2 = [{ t: 0, v: 100, inT: 2, outT: 2, inEase: [[0, 75]], outEase: [[0, 75]] }];
  const prev = comp(A, [withTransform(layer('id1'), { opacity: prop(100, k1) })]);
  const next = comp(A, [withTransform(layer('id1'), { opacity: prop(100, k2) })]);
  const ops = D.diffComp(prev, next, noSuppress);
  assert(ops.length === 1 && ops[0].kind === 'setKey' && ops[0].ease.in[0][1] === 75, 'keyframe ease change emits setKey with ease');
}

{
  const k1 = [{ t: 0, v: [0, 0], inSp: [10, 0], outSp: [10, 0] }];
  const k2 = [{ t: 0, v: [0, 0], inSp: [40, 0], outSp: [10, 0] }];
  const prev = comp(A, [withTransform(layer('id1'), { position: prop([0, 0], k1) })]);
  const next = comp(A, [withTransform(layer('id1'), { position: prop([0, 0], k2) })]);
  const ops = D.diffComp(prev, next, noSuppress);
  assert(ops.length === 1 && ops[0].kind === 'setKey' && ops[0].spatial.in[0] === 40, 'spatial tangent change emits setKey with spatial');
}

{
  const prev = { comp: { id: A }, layers: [{ sid: 't1', textDoc: { text: 'hi', fontSize: 72 } }] };
  const next = { comp: { id: A }, layers: [{ sid: 't1', textDoc: { text: 'hi!', fontSize: 72 } }] };
  const ops = D.diffTextState(prev, next, noSuppress);
  assert(ops.length === 1 && ops[0].path === 'textDoc' && ops[0].value.text === 'hi!', 'text state diff emits set textDoc');
}

{
  const prev = { comp: { id: A }, layers: [{ sid: 't1', textDoc: { text: 'hi', fontSize: 72 } }] };
  const next = { comp: { id: A }, layers: [{ sid: 't1', textDoc: { text: 'hi', fontSize: 72 } }] };
  assert(D.diffTextState(prev, next, noSuppress).length === 0, 'identical text state emits nothing');
}

{
  const tree = [
    {
      mn: 'ADBE Vector Group',
      name: 'Shape 1',
      children: [{ mn: 'ADBE Vector Shape - Rect', name: 'Rectangle Path 1', prop: { value: { vertices: [[0, 0], [10, 0], [10, 10], [0, 10]], closed: true }, numKeys: 0 } }],
    },
  ];
  const prev = { comp: { id: A }, layers: [{ sid: 'st1', tree: tree }] };
  const next = { comp: { id: A }, layers: [{ sid: 'st1', tree: JSON.parse(JSON.stringify(tree)) }] };
  assert(D.diffShapeStates(prev, next, noSuppress).length === 0, 'identical shape trees emit nothing');
}

{
  const tree = [{ mn: 'ADBE Vector Shape - Rect', name: 'Rectangle Path 1', prop: { value: { vertices: [[0, 0], [10, 0]], closed: true }, numKeys: 0 } }];
  const moved = JSON.parse(JSON.stringify(tree));
  moved[0].prop.value.vertices = [[0, 0], [50, 0]];
  const prev = { comp: { id: A }, layers: [{ sid: 'st1', tree: tree }] };
  const next = { comp: { id: A }, layers: [{ sid: 'st1', tree: moved }] };
  const ops = D.diffShapeStates(prev, next, noSuppress);
  assert(ops.length === 1 && ops[0].kind === 'setShape' && ops[0].path === 'shape', 'shape edit emits setShape');
  assert(ops[0].value.tree[0].prop.value.vertices[1][0] === 50, 'setShape carries the new tree');
}

{
  const tree = [{ mn: 'ADBE Vector Shape - Ellipse', name: 'Ellipse Path 1', prop: { value: { vertices: [[0, 0]], closed: true }, numKeys: 0 } }];
  const prev = { comp: { id: A }, layers: [{ sid: 'st1', tree: [] }] };
  const next = { comp: { id: A }, layers: [{ sid: 'st1', tree: tree }] };
  const echo = D.createEcho();
  echo.mark('st1', 'shape', undefined);
  assert(D.diffShapeStates(prev, next, echo).length === 0, 'echo suppresses a re-emitted shape update');
}

console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
