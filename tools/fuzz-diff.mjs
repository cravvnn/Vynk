import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
require(path.join(__dirname, '..', 'panel', 'src', 'diff.js'));
const D = globalThis.CollabDiff;

let seed = Number(process.argv[2] ?? Math.floor(Math.random() * 1e9));
const iterations = Number(process.argv[3] ?? 500);
const verbose = process.argv.includes('--verbose');

function rnd() {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
function ri(n) {
  return Math.floor(rnd() * n);
}
function pick(arr) {
  return arr[ri(arr.length)];
}
function chance(p) {
  return rnd() < p;
}
function deepCopy(o) {
  return JSON.parse(JSON.stringify(o));
}

const noSuppress = { suppress: () => false };
const TRANSFORM_PROPS = ['position', 'anchor', 'scale', 'rotation', 'opacity'];
const MASK_FIELDS = ['name', 'maskMode', 'inverted', 'maskFeather', 'maskOpacity', 'maskExpansion', 'maskMotionBlur'];
const COMP_FIELDS = ['width', 'height', 'duration', 'frameRate', 'pixelAspect', 'bgColor', 'motionBlur', 'shutterAngle', 'shutterPhase'];
const LAYER_FLAGS = ['enabled', 'motionBlur', 'frameBlending', 'trkMatte', 'startTime', 'inPoint', 'outPoint'];

function randNum(scale) {
  return Math.round((rnd() * 2 - 1) * scale * 1000) / 1000;
}

function randValue(kind) {
  if (kind === 'scalar') return Math.round(rnd() * 100 * 1000) / 1000;
  const dims = kind === 'three' ? 3 : 2;
  const out = [];
  for (let i = 0; i < dims; i++) out.push(randNum(2000));
  return out;
}

function randEase(dims) {
  const out = [];
  for (let i = 0; i < dims; i++) out.push([Math.round(rnd() * 100), Math.round(rnd() * 100)]);
  return out;
}

function randProp(kind, withKeys) {
  const prop = { value: randValue(kind), numKeys: 0 };
  if (withKeys && chance(0.6)) {
    const count = 1 + ri(4);
    const keys = [];
    for (let i = 0; i < count; i++) {
      const key = {
        t: Math.round((i * (0.5 + rnd())) * 10000) / 10000,
        v: randValue(kind),
        inT: 1 + ri(3),
        outT: 1 + ri(3),
      };
      const dims = Array.isArray(key.v) ? key.v.length : 1;
      key.inEase = chance(0.7) ? randEase(dims) : [];
      key.outEase = chance(0.7) ? randEase(dims) : [];
      key.inSp = Array.isArray(key.v) && chance(0.5) ? randValue(kind) : [];
      key.outSp = Array.isArray(key.v) && chance(0.5) ? randValue(kind) : [];
      keys.push(key);
    }
    keys.sort((a, b) => a.t - b.t);
    prop.keys = keys;
    prop.numKeys = keys.length;
  }
  return prop;
}

function randMask(index) {
  const mask = {
    index,
    name: 'mask' + index,
    maskMode: ri(5),
    inverted: chance(0.3),
    maskFeather: [randNum(50), randNum(50)],
    maskOpacity: Math.round(rnd() * 100),
    maskExpansion: randNum(50),
    maskMotionBlur: ri(3),
    path: randProp('many', chance(0.4)),
  };
  return mask;
}

function nextEffectId(layer, matchName) {
  let occ = 0;
  for (const f of layer.effects) {
    if (f.matchName === matchName) occ++;
  }
  return matchName + '#' + (occ + 1);
}

function reindexEffectIds(layer) {
  const counts = {};
  layer.effects.forEach((f, i) => {
    counts[f.matchName] = (counts[f.matchName] || 0) + 1;
    f.id = f.matchName + '#' + counts[f.matchName];
    f.index = i + 1;
  });
}

function randEffect(id) {
  const props = {};
  const count = 1 + ri(4);
  for (let i = 0; i < count; i++) {
    props['ADBE Test-' + i] = randProp(rnd() < 0.4 ? 'scalar' : 'two', chance(0.4));
  }
  return { id, matchName: id.split('#')[0], name: id, enabled: chance(0.8), index: 1, props };
}

function randLayer(sid, index) {
  const layer = {
    sid,
    index,
    name: 'layer' + index,
    type: 'av',
    enabled: chance(0.8),
    motionBlur: chance(0.3),
    frameBlending: chance(0.3),
    frameBlendingType: ri(3),
    trkMatte: false,
    trkType: 0,
    parent: null,
    inPoint: Math.round(rnd() * 20),
    outPoint: 20 + Math.round(rnd() * 60),
    startTime: randNum(5),
    transform: {},
    masks: [],
    effects: [],
  };
  for (const name of TRANSFORM_PROPS) {
    layer.transform[name] = randProp(name === 'rotation' || name === 'opacity' ? 'scalar' : rnd() < 0.5 ? 'two' : 'three', chance(0.5));
  }
  const maskCount = ri(3);
  for (let m = 1; m <= maskCount; m++) layer.masks.push(randMask(m));
  const fxCount = ri(3);
  for (let f = 1; f <= fxCount; f++) {
    const mn = pick(['ADBE Glo2', 'ADBE Exposure2', 'ADBE Geometry2']);
    layer.effects.push(randEffect(nextEffectId(layer, mn)));
  }
  reindexEffectIds(layer);
  if (chance(0.3)) layer.textDoc = { text: 'text' + index, fontSize: 12 + ri(80), tracking: ri(100) };
  return layer;
}

function randSnapshot() {
  const layers = [];
  const count = 1 + ri(4);
  for (let i = 1; i <= count; i++) layers.push(randLayer('id' + (10 + i), i));
  const comp = { id: '1|Comp 1', name: 'Comp 1', numLayers: count };
  for (const field of COMP_FIELDS) {
    if (field === 'bgColor') comp[field] = [randNum(1), randNum(1), randNum(1)];
    else if (field === 'motionBlur') comp[field] = chance(0.3);
    else if (field === 'width') comp[field] = 1920;
    else if (field === 'height') comp[field] = 1080;
    else if (field === 'duration') comp[field] = 60;
    else comp[field] = Math.round(rnd() * 1000) / 10;
  }
  return { comp, layers, selection: [], hasOmittedKeys: false };
}

function modelGet(layer, path) {
  if (!path) return null;
  if (path.indexOf('fx:') === 0) {
    const rest = path.substring(3);
    const slash = rest.indexOf('/');
    const fxId = slash >= 0 ? rest.substring(0, slash) : rest;
    const key = slash >= 0 ? rest.substring(slash + 1) : '';
    const fx = (layer.effects || []).find((f) => f.id === fxId);
    if (!fx) return null;
    if (!key) return { type: 'effect', fx };
    const prop = (fx.props || {})[key];
    return prop ? { type: 'prop', prop } : null;
  }
  if (path.indexOf('mask:') === 0) {
    const rest = path.substring(5);
    const slash = rest.indexOf('/');
    const idx = parseInt(slash >= 0 ? rest.substring(0, slash) : rest, 10) - 1;
    const field = slash >= 0 ? rest.substring(slash + 1) : '';
    const mask = (layer.masks || [])[idx];
    if (!mask) return null;
    if (!field) return { type: 'mask', mask };
    if (field === 'path') return { type: 'prop', prop: mask.path };
    return { type: 'maskField', mask, field };
  }
  if (path.indexOf('transform.') === 0) {
    const name = path.substring(10);
    const prop = layer.transform && layer.transform[name];
    return prop ? { type: 'prop', prop } : null;
  }
  return null;
}

function applyOps(snapshot, ops) {
  for (const op of ops) {
    if (op.kind === 'setComp') {
      snapshot.comp[op.path] = deepCopy(op.value);
      continue;
    }
    const layer = snapshot.layers.find((l) => l.sid === op.target.layer);
    if (!layer) return 'missing layer ' + op.target.layer;
    const path = op.path || '';
    if (op.kind === 'set' && LAYER_FLAGS.concat(['name', 'parent', 'frameBlendingType']).indexOf(path) >= 0) {
      layer[path] = deepCopy(op.value);
      continue;
    }
    if (op.kind === 'set' && path === 'textDoc') {
      layer.textDoc = deepCopy(op.value);
      continue;
    }
    if (op.kind === 'set') {
      const target = modelGet(layer, path);
      if (!target) return 'missing target ' + path;
      if (target.type === 'prop') {
        if (target.prop.keys && target.prop.keys.length) return 'set on keyed prop ' + path;
        target.prop.value = deepCopy(op.value);
        continue;
      }
      if (target.type === 'maskField') {
        target.mask[target.field] = deepCopy(op.value);
        continue;
      }
      return 'set on non-settable ' + path;
    }
    if (op.kind === 'setExpr') {
      const base = path.endsWith('@expr') ? path.substring(0, path.length - 5) : path;
      const target = modelGet(layer, base);
      if (!target || target.type !== 'prop') return 'missing expr target ' + path;
      if (op.value && op.value.text) {
        target.prop.expr = op.value.text;
        target.prop.exprOn = op.value.enabled === true;
        target.prop.hasExpr = true;
      } else {
        delete target.prop.expr;
        delete target.prop.exprOn;
        delete target.prop.hasExpr;
      }
      continue;
    }
    if (op.kind === 'addKey' || op.kind === 'setKey') {
      const target = modelGet(layer, path);
      if (!target || target.type !== 'prop') return 'missing key target ' + path;
      const prop = target.prop;
      prop.keys = prop.keys || [];
      const id = Math.round(op.time * 10000);
      let key = prop.keys.find((k) => Math.round(k.t * 10000) === id);
      if (!key) {
        key = { t: op.time };
        prop.keys.push(key);
      }
      key.v = deepCopy(op.value);
      if (op.interp) {
        key.inT = op.interp.inType;
        key.outT = op.interp.outType;
      }
      if (op.ease) {
        key.inEase = deepCopy(op.ease.in);
        key.outEase = deepCopy(op.ease.out);
      }
      if (op.spatial) {
        key.inSp = deepCopy(op.spatial.in);
        key.outSp = deepCopy(op.spatial.out);
      }
      prop.keys.sort((a, b) => a.t - b.t);
      prop.numKeys = prop.keys.length;
      continue;
    }
    if (op.kind === 'removeKey') {
      const target = modelGet(layer, path);
      if (!target || target.type !== 'prop') return 'missing removeKey target ' + path;
      const prop = target.prop;
      const id = Math.round(op.time * 10000);
      prop.keys = (prop.keys || []).filter((k) => Math.round(k.t * 10000) !== id);
      prop.numKeys = prop.keys.length;
      continue;
    }
    if (op.kind === 'setEffect') {
      const fx = (layer.effects || []).find((f) => f.id === path.substring(3));
      if (!fx) return 'missing effect ' + path;
      const value = op.value || {};
      if (value.enabled !== undefined) fx.enabled = value.enabled;
      if (value.name !== undefined) fx.name = value.name;
      if (op.index !== undefined) {
        fx.index = op.index;
        layer.effects.sort((a, b) => a.index - b.index);
      }
      continue;
    }
    if (op.kind === 'addEffect') {
      const fx = deepCopy(op.value);
      fx.id = path.substring(3);
      fx.index = (op.value && op.value.index) || layer.effects.length + 1;
      layer.effects.push(fx);
      layer.effects.sort((a, b) => a.index - b.index);
      continue;
    }
    if (op.kind === 'removeEffect') {
      layer.effects = (layer.effects || []).filter((f) => f.id !== path.substring(3));
      continue;
    }
    if (op.kind === 'addMask') {
      const mask = deepCopy(op.value);
      const idx = parseInt(path.substring(5), 10) - 1;
      layer.masks.splice(idx, 0, mask);
      layer.masks.forEach((m, i) => (m.index = i + 1));
      continue;
    }
    if (op.kind === 'removeMask') {
      const idx = parseInt(path.substring(5), 10) - 1;
      layer.masks.splice(idx, 1);
      layer.masks.forEach((m, i) => (m.index = i + 1));
      continue;
    }
    return 'unhandled kind ' + op.kind;
  }
  return null;
}

function mutate(snapshot) {
  const rounds = 1 + ri(4);
  for (let r = 0; r < rounds; r++) {
    const layer = pick(snapshot.layers);
    const roll = ri(10);
    if (roll <= 2) {
      const name = pick(TRANSFORM_PROPS);
      layer.transform[name] = randProp(name === 'rotation' || name === 'opacity' ? 'scalar' : rnd() < 0.5 ? 'two' : 'three', chance(0.6));
    } else if (roll === 3) {
      const flag = pick(LAYER_FLAGS);
      layer[flag] = flag === 'enabled' || flag === 'motionBlur' || flag === 'frameBlending' || flag === 'trkMatte' ? chance(0.5) : randNum(20);
      if (flag === 'enabled') layer.frameBlendingType = ri(3);
    } else if (roll === 4) {
      layer.textDoc = { text: 'text' + ri(1000), fontSize: 12 + ri(80), tracking: ri(100) };
    } else if (roll === 5) {
      const field = pick(COMP_FIELDS);
      if (field === 'bgColor') snapshot.comp[field] = [randNum(1), randNum(1), randNum(1)];
      else if (field === 'motionBlur') snapshot.comp[field] = chance(0.5);
      else if (field === 'width' || field === 'height') snapshot.comp[field] = 720 + ri(1600);
      else if (field === 'duration') snapshot.comp[field] = 10 + ri(200);
      else snapshot.comp[field] = Math.round(rnd() * 1000) / 10;
    } else if (roll === 6) {
      if (layer.effects.length && chance(0.5)) layer.effects.splice(ri(layer.effects.length), 1);
      else {
        const mn = pick(['ADBE Glo2', 'ADBE Exposure2']);
        layer.effects.push(randEffect(nextEffectId(layer, mn)));
      }
      reindexEffectIds(layer);
    } else if (roll === 7) {
      if (layer.masks.length && chance(0.5)) {
        layer.masks.splice(ri(layer.masks.length), 1);
        layer.masks.forEach((m, i) => (m.index = i + 1));
      } else {
        layer.masks.push(randMask(layer.masks.length + 1));
      }
    } else if (roll === 8) {
      const name = pick(TRANSFORM_PROPS);
      const prop = layer.transform[name];
      if (!prop.keys) prop.keys = [];
      prop.keys.push({ t: Math.round(rnd() * 20 * 10000) / 10000, v: randValue(Array.isArray(prop.value) ? prop.value.length : 'scalar') });
      prop.keys.sort((a, b) => a.t - b.t);
      prop.numKeys = prop.keys.length;
    } else if (roll === 9) {
      const name = pick(TRANSFORM_PROPS);
      const prop = layer.transform[name];
      if (prop.keys && prop.keys.length) prop.keys.splice(ri(prop.keys.length), 1);
      prop.numKeys = (prop.keys || []).length;
    } else {
      const effect = layer.effects.length ? pick(layer.effects) : null;
      if (effect) {
        const key = pick(Object.keys(effect.props));
        effect.props[key] = randProp(rnd() < 0.4 ? 'scalar' : 'two', chance(0.5));
      }
    }
  }
}

function randShapeNode(depth) {
  const node = {
    mn: pick([
      'ADBE Vector Shape - Rect',
      'ADBE Vector Shape - Ellipse',
      'ADBE Vector Shape - Group',
      'ADBE Vector Graphic - Fill',
      'ADBE Vector Graphic - Stroke',
      'ADBE Vector Filter - Trim',
      'ADBE Vector Group',
    ]),
    name: 'node' + ri(1000),
    prop: randProp(rnd() < 0.5 ? 'scalar' : 'two', false),
  };
  if (depth < 2 && chance(0.6)) {
    node.children = [];
    const kids = 1 + ri(3);
    for (let i = 0; i < kids; i++) node.children.push(randShapeNode(depth + 1));
    delete node.prop;
  }
  return node;
}

function randShapeSnapshot() {
  const layers = [];
  const count = 1 + ri(3);
  for (let i = 1; i <= count; i++) {
    const tree = [];
    const nodes = 1 + ri(3);
    for (let n = 0; n < nodes; n++) tree.push(randShapeNode(0));
    layers.push({ sid: 'st' + (1000 + i), tree });
  }
  return { comp: { id: '1|Comp 1' }, layers };
}

function mutateShapes(snap) {
  const layer = pick(snap.layers);
  const roll = ri(5);
  if (roll === 0 && layer.tree.length) {
    layer.tree.splice(ri(layer.tree.length), 1);
  } else if (roll === 1) {
    layer.tree.push(randShapeNode(0));
  } else if (roll === 2 && layer.tree.length) {
    const node = pick(layer.tree);
    node.prop = randProp(rnd() < 0.5 ? 'scalar' : 'two', false);
  } else if (roll === 3 && layer.tree.length) {
    pick(layer.tree).name = 'renamed' + ri(1000);
  } else if (layer.tree.length) {
    const node = pick(layer.tree);
    if (node.children) node.children.push(randShapeNode(2));
    else node.prop = randProp('two', false);
  }
}

let failures = 0;
let runSeed = seed;
function keyAt(model, op) {
  const layer = model.layers.find((l) => l.sid === op.target.layer);
  const target = layer ? modelGet(layer, op.path) : null;
  if (!target || target.type !== 'prop' || !target.prop.keys) return null;
  const id = Math.round(op.time * 10000);
  return target.prop.keys.find((k) => Math.round(k.t * 10000) === id) || null;
}
function fail(message, iter, ops, model, next) {
  failures++;
  console.log(`FAIL seed=${runSeed} iter=${iter}: ${message}`);
  if (ops && verbose) {
    console.log('  ops: ' + JSON.stringify(ops).slice(0, 600));
    for (const op of ops.slice(0, 3)) {
      const k1 = keyAt(model, op);
      const k2 = keyAt(next, op);
      console.log('  op ' + op.kind + ' ' + op.path + ' t=' + op.time);
      console.log('    model key: ' + JSON.stringify(k1));
      console.log('    next  key: ' + JSON.stringify(k2));
      if (op.kind === 'setEffect' || op.kind === 'addEffect' || op.kind === 'removeEffect') {
        console.log('    op value: ' + JSON.stringify(op.value).slice(0, 300));
        const l1 = model.layers.find((l) => l.sid === op.target.layer);
        const l2 = next.layers.find((l) => l.sid === op.target.layer);
        console.log('    model fx: ' + JSON.stringify((l1.effects || []).map((f) => f.id + ':' + f.enabled + ':' + f.index)));
        console.log('    next  fx: ' + JSON.stringify((l2.effects || []).map((f) => f.id + ':' + f.enabled + ':' + f.index)));
      }
      if (op.kind === 'addMask' || op.kind === 'removeMask' || (op.path || '').indexOf('mask:') === 0) {
        const l1 = model.layers.find((l) => l.sid === op.target.layer);
        const l2 = next.layers.find((l) => l.sid === op.target.layer);
        const summarize = (l) => (l.masks || []).map((m) => m.index + ':' + m.name + ':' + m.maskMode + ':' + JSON.stringify(m.maskFeather));
        console.log('    model masks: ' + JSON.stringify(summarize(l1)));
        console.log('    next  masks: ' + JSON.stringify(summarize(l2)));
        console.log('    op: ' + JSON.stringify(op).slice(0, 300));
      }
    }
  }
}

for (let iter = 0; iter < iterations; iter++) {
  const base = randSnapshot();
  const selfOps = D.diffComp(base, deepCopy(base), noSuppress).concat(D.diffEffects(base, deepCopy(base), noSuppress));
  if (selfOps.length) {
    fail('identical snapshots produced ops', iter, selfOps, base, base);
  }

  const next = deepCopy(base);
  mutate(next);
  const ops = D.diffComp(base, next, noSuppress).concat(D.diffEffects(base, next, noSuppress));
  const model = deepCopy(base);
  const err = applyOps(model, ops);
  if (err) {
    fail('model apply: ' + err, iter, ops, model, next);
  } else {
    const residual = D.diffComp(model, next, noSuppress).concat(D.diffEffects(model, next, noSuppress));
    if (residual.length) {
      fail(
        'residual ' + residual.length + ' ops: ' + residual.slice(0, 4).map((o) => o.kind + '|' + o.path).join(','),
        iter,
        residual,
        model,
        next
      );
    }
  }
  const shapeBase = randShapeSnapshot();
  const shapeSelf = D.diffShapeStates(shapeBase, deepCopy(shapeBase), noSuppress);
  if (shapeSelf.length) {
    fail('identical shape snapshots produced ops', iter, shapeSelf, shapeBase, shapeBase);
  } else {
    const shapeNext = deepCopy(shapeBase);
    mutateShapes(shapeNext);
    const shapeOps = D.diffShapeStates(shapeBase, shapeNext, noSuppress);
    const shapeModel = deepCopy(shapeBase);
    let shapeErr = null;
    for (const op of shapeOps) {
      if (op.kind !== 'setShape') {
        shapeErr = 'unexpected shape op ' + op.kind;
        break;
      }
      const target = shapeModel.layers.find((x) => x.sid === op.target.layer);
      if (!target) {
        shapeErr = 'shape target missing ' + op.target.layer;
        break;
      }
      target.tree = deepCopy(op.value.tree);
    }
    if (shapeErr) {
      fail('shape model: ' + shapeErr, iter, shapeOps, shapeModel, shapeNext);
    } else {
      const shapeResidual = D.diffShapeStates(shapeModel, shapeNext, noSuppress);
      if (shapeResidual.length) {
        fail('shape residual ' + shapeResidual.length, iter, shapeResidual, shapeModel, shapeNext);
      }
    }
  }

  if (failures >= 10) break;
}

console.log(`fuzz done: seed=${runSeed} iterations=${iterations} failures=${failures}`);
process.exit(failures === 0 ? 0 : 1);
