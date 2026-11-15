// Unit tests for the v2 sync model (panel/src/sync.js).
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import fs from 'node:fs';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(join(here, '..', 'panel', 'src', 'sync.js'), 'utf8'), ctx);
const S = ctx.window.VynkSync;

let failed = 0;
function check(name, cond, detail) {
  if (cond) console.log('ok: ' + name);
  else {
    failed++;
    console.log('FAIL: ' + name + (detail ? '  ' + detail : ''));
  }
}

const clone = (x) => JSON.parse(JSON.stringify(x));
const POS = 'ADBE Transform Group/ADBE Position';
const OPA = 'ADBE Transform Group/ADBE Opacity';
const FX = 'ADBE Effect Parade';

function layer(sid, extra) {
  return Object.assign(
    {
      sid,
      kind: 'solid',
      a: { name: sid, enabled: 1, parent: '', inPoint: 0, outPoint: 10 },
      p: { [POS]: { v: [960, 540, 0], m: 0 }, [OPA]: { v: 100, m: 0 } },
      g: { [FX]: [] }
    },
    extra || {}
  );
}
function comp(layers) {
  return { id: 'id1|Main', s: { name: 'Main', width: 1920, markers: [] }, layers, sel: [] };
}
const kinds = (ops) => ops.map((o) => o.kind + (o.path ? ':' + o.path : '')).join(',');

// Applies ops to a snapshot the way AE would, so diff -> apply can be checked
// for convergence without After Effects.
function applyOps(snap, ops) {
  const by = () => Object.fromEntries(snap.layers.map((l) => [l.sid, l]));
  const place = (sid, after) => {
    const i = snap.layers.findIndex((l) => l.sid === sid);
    const [e] = snap.layers.splice(i, 1);
    const at = after ? snap.layers.findIndex((l) => l.sid === after) + 1 : 0;
    snap.layers.splice(at, 0, e);
  };
  for (const op of ops) {
    const l = by()[op.target.layer];
    if (op.kind === 'comp') snap.s[op.path] = clone(op.value);
    else if (op.kind === 'add') {
      if (!l) snap.layers.unshift(clone(op.value.layer));
      place(op.target.layer, op.value.after);
    } else if (!l) continue;
    else if (op.kind === 'remove') snap.layers = snap.layers.filter((x) => x.sid !== op.target.layer);
    else if (op.kind === 'reorder') place(op.target.layer, op.value.after);
    else if (op.kind === 'attr') l.a[op.path] = clone(op.value);
    else if (op.kind === 'prop') l.p[op.path] = clone(op.value);
    else if (op.kind === 'grm') {
      const parent = op.path.slice(0, op.path.lastIndexOf('/'));
      const key = op.path.slice(op.path.lastIndexOf('/') + 1);
      l.g[parent] = l.g[parent].filter((k) => k !== key);
      for (const p of Object.keys(l.p)) if (p === op.path || p.startsWith(op.path + '/') || p.startsWith(op.path + '@')) delete l.p[p];
      for (const g of Object.keys(l.g)) if (g === op.path || g.startsWith(op.path + '/')) delete l.g[g];
    } else if (op.kind === 'gadd') {
      const list = l.g[op.path] || (l.g[op.path] = []);
      list.splice(op.value.at - 1, 0, op.value.key);
      const base = op.path + '/' + op.value.key;
      for (const [rel, rec] of Object.entries(op.value.p)) l.p[rel[0] === '@' ? base + rel : base + '/' + rel] = clone(rec);
      for (const [rel, kids] of Object.entries(op.value.g)) l.g[rel ? base + '/' + rel : base] = clone(kids);
    } else if (op.kind === 'gmv') {
      const parent = op.path.slice(0, op.path.lastIndexOf('/'));
      const key = op.path.slice(op.path.lastIndexOf('/') + 1);
      const list = l.g[parent];
      list.splice(list.indexOf(key), 1);
      list.splice(op.index - 1, 0, key);
    }
  }
  return snap;
}

function converges(name, prev, next) {
  const d = S.diff(clone(prev), clone(next));
  const got = applyOps(clone(prev), clone(d.ops));
  const left = S.diff(got, clone(next)).ops;
  check(name, left.length === 0, 'left: ' + kinds(left) + '  sent: ' + kinds(d.ops));
  return d.ops;
}

// --- no change
{
  const a = comp([layer('id1'), layer('id2')]);
  check('identical snapshots emit nothing', S.diff(clone(a), clone(a)).ops.length === 0);
}

// --- values
{
  const a = comp([layer('id1')]);
  const b = clone(a);
  b.layers[0].p[POS] = { v: [100, 200, 0], m: 1 };
  const ops = converges('value change converges', a, b);
  check('value change is one prop op', kinds(ops) === 'prop:' + POS);
  const c = clone(a);
  c.layers[0].p[POS].v = [960.00001, 540, 0];
  check('float noise is ignored', S.diff(clone(a), c).ops.length === 0);
}

// --- keys
{
  const a = comp([layer('id1')]);
  const b = clone(a);
  b.layers[0].p[OPA] = { k: [{ t: 0, v: 0, i: [6612, 6612], f: [0, 0, 0, 0, 0] }, { t: 2, v: 100, i: [6612, 6612], f: [0, 0, 0, 0, 0] }], m: 1 };
  converges('value -> keyframes converges', a, b);
  const c = clone(b);
  c.layers[0].p[OPA].k[1].i = [6613, 6613];
  check('interpolation change is detected', S.diff(clone(b), c).ops.length === 1);
  const d = clone(b);
  d.layers[0].p[OPA].k.pop();
  converges('key removal converges', b, d);
}

// --- expressions, separated dimensions
{
  const a = comp([layer('id1')]);
  const b = clone(a);
  b.layers[0].p[OPA] = { v: 100, x: 'time*10', xo: 1, m: 1 };
  check('expression change is detected', S.diff(clone(a), b).ops.length === 1);
  const c = clone(b);
  c.layers[0].p[OPA].xo = 0;
  check('expression disable is detected', S.diff(clone(b), c).ops.length === 1);
  const d = clone(a);
  d.layers[0].p[POS] = { sep: 1, m: 1 };
  check('separate dimensions is detected', S.diff(clone(a), d).ops.length === 1);
}

// --- attributes
{
  const a = comp([layer('id1'), layer('id2')]);
  const b = clone(a);
  b.layers[0].a.name = 'Renamed';
  b.layers[0].a.parent = 'id2';
  b.layers[0].a.blendingMode = 5220;
  const ops = converges('attribute changes converge', a, b);
  check('one op per attribute', ops.length === 3 && ops.every((o) => o.kind === 'attr'));
}

// --- layer structure
{
  const a = comp([layer('id1'), layer('id2'), layer('id3')]);
  const b = clone(a);
  b.layers.splice(1, 0, layer('stnew'));
  const ops = converges('layer add converges', a, b);
  check('add carries position anchor', ops.length === 1 && ops[0].value.after === 'id1');
  const c = clone(a);
  c.layers.splice(1, 1);
  check('layer remove', kinds(converges('layer remove converges', a, c)) === 'remove');
  const d = clone(a);
  d.layers.push(d.layers.shift());
  converges('reorder converges', a, d);
  const e = clone(a);
  e.layers.reverse();
  converges('full reverse converges', a, e);
  const f = clone(a);
  f.layers = [layer('stx'), f.layers[2], layer('sty'), f.layers[0]];
  converges('add + remove + reorder together converge', a, f);
  const g = clone(a);
  const child = layer('stchild');
  child.a.parent = 'stparent';
  g.layers.unshift(child, layer('stparent'));
  const gops = converges('child + parent added together converge', a, g);
  const firstAdd = gops.find((o) => o.kind === 'add');
  check('parent is created before its child', firstAdd.target.layer === 'stparent');
}

// --- indexed groups (effects, masks, shape contents)
{
  const a = comp([layer('id1')]);
  const b = clone(a);
  b.layers[0].g[FX] = ['ADBE Gaussian Blur 2'];
  b.layers[0].p[FX + '/ADBE Gaussian Blur 2@name'] = { v: 'Gaussian Blur', m: 1 };
  b.layers[0].p[FX + '/ADBE Gaussian Blur 2@on'] = { v: 1, m: 1 };
  b.layers[0].p[FX + '/ADBE Gaussian Blur 2/ADBE Gaussian Blur 2-0001'] = { v: 25, m: 1 };
  const ops = converges('effect add converges', a, b);
  check('effect add is a single gadd with its params', ops.length === 1 && ops[0].kind === 'gadd' && ops[0].value.p['ADBE Gaussian Blur 2-0001'].v === 25 && ops[0].value.p['@on'].v === 1);
  const c = clone(b);
  c.layers[0].p[FX + '/ADBE Gaussian Blur 2/ADBE Gaussian Blur 2-0001'].v = 60;
  check('effect param change is one prop op', kinds(S.diff(clone(b), c).ops) === 'prop:' + FX + '/ADBE Gaussian Blur 2/ADBE Gaussian Blur 2-0001');
  const d = clone(b);
  d.layers[0].p[FX + '/ADBE Gaussian Blur 2@on'].v = 0;
  check('effect disable is one prop op', S.diff(clone(b), d).ops.length === 1);
  check('effect remove is a single grm', kinds(converges('effect remove converges', b, a)) === 'grm:' + FX + '/ADBE Gaussian Blur 2');
  const e = clone(b);
  e.layers[0].g[FX] = ['ADBE Glo2', 'ADBE Gaussian Blur 2'];
  e.layers[0].p[FX + '/ADBE Glo2/ADBE Glo2-0001'] = { v: 3, m: 1 };
  converges('effect inserted above converges', b, e);
  const f = clone(e);
  f.layers[0].g[FX] = ['ADBE Gaussian Blur 2', 'ADBE Glo2'];
  check('effect reorder is a gmv', kinds(converges('effect reorder converges', e, f)).startsWith('gmv:'));
  const g = clone(b);
  g.layers[0].g[FX] = ['ADBE Gaussian Blur 2', 'ADBE Gaussian Blur 2#2'];
  g.layers[0].p[FX + '/ADBE Gaussian Blur 2#2/ADBE Gaussian Blur 2-0001'] = { v: 9, m: 1 };
  const gops = converges('second instance of an effect converges', b, g);
  check('sibling #2 does not disturb #1', gops.length === 1 && gops[0].value.key === 'ADBE Gaussian Blur 2#2');
}

// --- pruned groups
{
  const MAT = 'ADBE Material Options Group/ADBE Light Transmission';
  const a = comp([layer('id1')]);
  const b = clone(a);
  b.layers[0].p[MAT] = { v: 50, m: 1 };
  check('newly read modified leaf is sent', S.diff(clone(a), clone(b)).ops.length === 1);
  const c = clone(a);
  c.layers[0].p[MAT] = { v: 0, m: 0 };
  check('newly read default leaf is not sent', S.diff(clone(a), c).ops.length === 0);
  const d = S.diff(clone(b), clone(a));
  check('vanished modified leaf asks for an unpruned read', d.ops.length === 0 && d.force.id1 === 1 && d.keep.id1[MAT].v === 50);
  check('...but only once', Object.keys(S.diff(clone(b), clone(a), { forced: { id1: 1 } }).force).length === 0);
}

// --- comp settings
{
  const a = comp([layer('id1')]);
  const b = clone(a);
  b.s.width = 1280;
  b.s.markers = [{ t: 2, v: { comment: 'drop' } }];
  check('comp settings + markers', kinds(converges('comp settings converge', a, b)) === 'comp:width,comp:markers');
}

// --- adopt
{
  const shadow = comp([layer('id1'), layer('id2')]);
  const snap = clone(shadow);
  snap.layers[0].p[POS] = { v: [5, 5, 0], m: 1 }; // applied from a teammate
  snap.layers[1].p[OPA] = { v: 40, m: 1 }; // the local user's own edit
  const remote = { opId: 'r1', kind: 'prop', target: { comp: 'id1|Main', layer: 'id1' }, path: POS, value: { v: [5, 5, 0] } };
  S.adopt(shadow, snap, [remote]);
  const ops = S.diff(shadow, snap).ops;
  check('adopted remote edit is not sent back, local edit is', ops.length === 1 && ops[0].target.layer === 'id2');

  const shadow2 = comp([layer('id1'), layer('id2')]);
  const snap2 = clone(shadow2);
  snap2.layers.splice(1, 0, layer('stremote'));
  S.adopt(shadow2, snap2, [{ opId: 'r2', kind: 'add', target: { comp: 'id1|Main', layer: 'stremote' }, value: { after: 'id1', layer: layer('stremote') } }]);
  check('adopted remote layer add emits nothing', S.diff(shadow2, snap2).ops.length === 0);

  const shadow3 = comp([layer('id1'), layer('id2')]);
  const snap3 = clone(shadow3); // AE refused the op, so nothing changed
  S.adopt(shadow3, snap3, [{ opId: 'r3', kind: 'remove', target: { comp: 'id1|Main', layer: 'id2' } }]);
  check('failed remote remove does not echo an add', S.diff(shadow3, snap3).ops.length === 0);

  const shadow4 = comp([layer('id1')]);
  const snap4 = clone(shadow4);
  S.adopt(shadow4, snap4, [{ opId: 'r4', kind: 'prop', target: { comp: 'id9|Other', layer: 'id1' }, path: POS, value: { v: [1, 1, 0] } }]);
  check('ops for another comp are ignored by adopt', S.diff(shadow4, snap4).ops.length === 0);
}

// --- identity helpers
{
  const shadow = comp([layer('id1')]);
  const snap = comp([layer('id1'), layer('id77'), layer('stabc')]);
  check('unstamped finds only new machine-local ids', S.unstamped(shadow, snap).join(',') === 'id77');
  const p = { kind: 'prop', target: { comp: 'id1|Main', layer: 'id1' }, path: POS };
  check('targetKey ignores the comp name', S.targetKey(p) === S.targetKey({ ...p, target: { comp: 'id1|Renamed', layer: 'id1' } }));
  check('structure ops have no LWW key', S.targetKey({ kind: 'add', target: { comp: 'id1|Main', layer: 'x' } }) === '');
}

// --- fingerprints (self-repair)
{
  const MAT = 'ADBE Material Options Group/ADBE Light Transmission';
  const a = comp([layer('id1'), layer('id2')]);
  const b = clone(a);
  check('equal comps share a fingerprint', S.digest(a).hash === S.digest(b).hash);
  b.layers[1].p[OPA] = { v: 99.9999999, m: 1 };
  b.layers[1].p[OPA].v = 100.00001;
  check('float noise and the modified flag do not change it', S.digest(a).hash === S.digest(b).hash);
  b.layers[1].p[MAT] = { v: 0, m: 0 };
  check('a default value only one machine read does not change it', S.digest(a).hash === S.digest(b).hash);
  const c = clone(a);
  c.layers[1].p[OPA] = { v: 40, m: 1 };
  const da = S.digest(a);
  const dc = S.digest(c);
  check('a changed value changes the comp fingerprint', da.hash !== dc.hash);
  check('...and only that layer\'s', da.layers.id1 === dc.layers.id1 && da.layers.id2 !== dc.layers.id2);
  const d = clone(a);
  d.layers.reverse();
  check('layer order is part of it', S.digest(a).hash !== S.digest(d).hash);
  const k1 = clone(a);
  const k2 = clone(a);
  k1.layers[0].p[OPA] = { k: [{ t: 0, v: 0, i: [6613, 6613], e: [[[0, 33]], [[0, 33]]] }], m: 1 };
  k2.layers[0].p[OPA] = { k: [{ t: 0, v: 0, i: [6613, 6613], e: [[[0, 34]], [[0, 34]]] }], m: 1 };
  check('recomputed eases do not change it', S.digest(k1).hash === S.digest(k2).hash);
  const e = clone(a);
  e.layers[0].a.blendingMode = 5220;
  check('attributes are part of it', S.digest(a).hash !== S.digest(e).hash);
}

console.log(failed === 0 ? '\nPASS' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
