// Vynk sync engine v2 - pure model code (no AE, no DOM), unit-tested in
// tools/test-sync.mjs. Snapshots come from panel/jsx/sync.jsx:
//
//   comp  = { id: "<sid>|<name>", s: {settings}, layers: [layer], sel: [sid] }
//   layer = { sid, kind, src, a: {attrs}, p: {path: rec}, g: {groupPath: [childKey]} }
//   rec   = { v } | { k: [key] } plus x/xo (expression), sep, m (modified flag)
//
// The panel keeps a "shadow" snapshot per comp: the state everyone in the room
// is known to share. diff(shadow, snapshot) is exactly the local user's edits.
(function (root) {
  'use strict';

  var REL_TOL = 1e-4;

  function rid() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  }

  function near(a, b) {
    return Math.abs(a - b) <= REL_TOL * Math.max(1, Math.abs(a), Math.abs(b));
  }

  function valuesNear(a, b) {
    if (a === b) return true;
    if (typeof a === 'number' || typeof b === 'number') {
      if (typeof a !== 'number' || typeof b !== 'number') return false;
      return near(a, b);
    }
    if (a === null || a === undefined || b === null || b === undefined) return false;
    if (typeof a !== 'object' || typeof b !== 'object') return false;
    var aArr = Object.prototype.toString.call(a) === '[object Array]';
    var bArr = Object.prototype.toString.call(b) === '[object Array]';
    if (aArr !== bArr) return false;
    if (aArr) {
      if (a.length !== b.length) return false;
      for (var i = 0; i < a.length; i++) {
        if (!valuesNear(a[i], b[i])) return false;
      }
      return true;
    }
    var k;
    for (k in a) {
      if (!valuesNear(a[k], b[k])) return false;
    }
    for (k in b) {
      if (!(k in a)) return false;
    }
    return true;
  }

  function keyEq(a, b) {
    if (Math.abs(a.t - b.t) > 1e-4) return false;
    if (!valuesNear(a.v, b.v)) return false;
    if (!valuesNear(a.i || [], b.i || [])) return false;
    if (!valuesNear(a.f || [], b.f || [])) return false;
    if (!valuesNear(a.e || [], b.e || [])) return false;
    if (!valuesNear(a.s || [], b.s || [])) return false;
    return true;
  }

  function recEq(a, b) {
    if (!a || !b) return a === b;
    if ((a.sep || 0) !== (b.sep || 0)) return false;
    if ((a.x || '') !== (b.x || '')) return false;
    if (a.x && (a.xo || 0) !== (b.xo || 0)) return false;
    if (a.big || b.big) return true;
    if (!a.k !== !b.k) return false;
    if (a.k) {
      if (a.k.length !== b.k.length) return false;
      for (var i = 0; i < a.k.length; i++) {
        if (!keyEq(a.k[i], b.k[i])) return false;
      }
      return true;
    }
    return valuesNear(a.v, b.v);
  }

  function sidPart(key) {
    var s = String(key || '');
    var idx = s.indexOf('|');
    return idx < 0 ? s : s.substring(0, idx);
  }

  function join(group, key) {
    return group ? group + '/' + key : key;
  }

  function parentOf(path) {
    var idx = path.lastIndexOf('/');
    return idx < 0 ? '' : path.substring(0, idx);
  }

  function depthOf(path) {
    return path === '' ? 0 : path.split('/').length;
  }

  // True when `path` is `prefix` itself, a pseudo-leaf of it ("@on") or below it.
  function within(path, prefix) {
    if (path.length < prefix.length) return false;
    if (path.lastIndexOf(prefix, 0) !== 0) return false;
    if (path.length === prefix.length) return true;
    var c = path.charAt(prefix.length);
    return c === '/' || c === '@';
  }

  function withinAny(path, prefixes) {
    for (var i = 0; i < prefixes.length; i++) {
      if (within(path, prefixes[i])) return true;
    }
    return false;
  }

  // Everything under one child of an indexed group, with paths made relative.
  function subtree(layer, childPath) {
    var out = { p: {}, g: {} };
    var path;
    for (path in layer.p) {
      if (!within(path, childPath) || path.length === childPath.length) continue;
      out.p[path.charAt(childPath.length) === '@' ? path.substring(childPath.length) : path.substring(childPath.length + 1)] = layer.p[path];
    }
    for (path in layer.g) {
      if (!within(path, childPath)) continue;
      out.g[path.length === childPath.length ? '' : path.substring(childPath.length + 1)] = layer.g[path];
    }
    return out;
  }

  var ATTR_ORDER = [
    'name', 'comment', 'threeDLayer', 'adjustmentLayer', 'guideLayer', 'lightType', 'timeRemapEnabled',
    'startTime', 'stretch', 'inPoint', 'outPoint', 'parent', 'matte'
  ];
  var ITEM_FIELDS = ['name', 'parent', 'label'];

  function makeOp(kind, compId, sid, path, value, index) {
    var op = { opId: rid(), kind: kind, target: { comp: compId } };
    if (sid) op.target.layer = sid;
    if (path !== undefined) op.path = path;
    if (value !== undefined) op.value = value;
    if (index !== undefined) op.index = index;
    return op;
  }

  function bySid(comp) {
    var map = {};
    for (var i = 0; i < comp.layers.length; i++) map[comp.layers[i].sid] = comp.layers[i];
    return map;
  }

  function diffLayer(compId, prev, next, forced, ops) {
    var sid = next.sid;
    var k;
    var i;
    // Some attributes move others when set (in point shifts the out point,
    // stretch rescales both), so they are always sent in a fixed order.
    var done = {};
    for (i = 0; i < ATTR_ORDER.length; i++) {
      k = ATTR_ORDER[i];
      done[k] = 1;
      if (k in next.a && !valuesNear(prev.a[k], next.a[k])) ops.push(makeOp('attr', compId, sid, k, next.a[k]));
    }
    for (k in next.a) {
      if (!done[k] && !valuesNear(prev.a[k], next.a[k])) ops.push(makeOp('attr', compId, sid, k, next.a[k]));
    }

    var added = [];
    var removed = [];
    var groupPaths = [];
    var seen = {};
    for (k in prev.g) { seen[k] = 1; groupPaths.push(k); }
    for (k in next.g) { if (!seen[k]) groupPaths.push(k); }
    groupPaths.sort(function (a, b) { return depthOf(a) - depthOf(b); });
    for (var gi = 0; gi < groupPaths.length; gi++) {
      var G = groupPaths[gi];
      if (withinAny(G, added) || withinAny(G, removed)) continue;
      var O = prev.g[G] || [];
      var N = next.g[G] || [];
      for (i = O.length - 1; i >= 0; i--) {
        if (N.indexOf(O[i]) >= 0) continue;
        ops.push(makeOp('grm', compId, sid, join(G, O[i])));
        removed.push(join(G, O[i]));
      }
      var sim = [];
      for (i = 0; i < O.length; i++) {
        if (N.indexOf(O[i]) >= 0) sim.push(O[i]);
      }
      for (i = 0; i < N.length; i++) {
        if (O.indexOf(N[i]) >= 0) continue;
        var childPath = join(G, N[i]);
        var sub = subtree(next, childPath);
        ops.push(makeOp('gadd', compId, sid, G, { key: N[i], at: i + 1, p: sub.p, g: sub.g }));
        added.push(childPath);
        sim.splice(Math.min(i, sim.length), 0, N[i]);
      }
      for (i = 0; i < N.length; i++) {
        if (sim[i] === N[i]) continue;
        ops.push(makeOp('gmv', compId, sid, join(G, N[i]), undefined, i + 1));
        sim.splice(sim.indexOf(N[i]), 1);
        sim.splice(i, 0, N[i]);
      }
    }

    var keep = null;
    var path;
    for (path in next.p) {
      if (added.length && withinAny(path, added)) continue;
      var a = prev.p[path];
      var b = next.p[path];
      if (a) {
        if (!recEq(a, b)) ops.push(makeOp('prop', compId, sid, path, b));
      } else if (b.m) {
        ops.push(makeOp('prop', compId, sid, path, b));
      }
    }
    for (path in prev.p) {
      if (path in next.p) continue;
      if (removed.length && withinAny(path, removed)) continue;
      // A modified value vanished without its group being removed: the group
      // was reset to defaults and is no longer read. Ask for an unpruned read
      // so the default values are diffed and sent.
      if (prev.p[path].m && !forced) {
        keep = keep || {};
        keep[path] = prev.p[path];
      }
    }
    return keep;
  }

  // opts.forced: { sid: 1 } layers that were read without pruning this cycle.
  // Returns { ops, force: {sid:1}, keep: {sid: {path: rec}} }.
  function diff(prev, next, opts) {
    var forced = (opts && opts.forced) || {};
    var out = { ops: [], force: {}, keep: {} };
    var ops = out.ops;
    var compId = next.id;
    var prevBy = bySid(prev);
    var nextBy = bySid(next);
    var i;
    var k;

    for (i = 0; i < prev.layers.length; i++) {
      if (!nextBy[prev.layers[i].sid]) ops.push(makeOp('remove', compId, prev.layers[i].sid));
    }

    var target = [];
    var adds = [];
    for (i = 0; i < next.layers.length; i++) {
      target.push(next.layers[i].sid);
      if (!prevBy[next.layers[i].sid]) adds.push(next.layers[i]);
    }
    // Layers that other new layers point at (parent / matte) are created first.
    adds.sort(function (x, y) {
      return (refersTo(x, y.sid) ? 1 : 0) - (refersTo(y, x.sid) ? 1 : 0);
    });
    var cur = [];
    for (i = 0; i < prev.layers.length; i++) {
      if (nextBy[prev.layers[i].sid]) cur.push(prev.layers[i].sid);
    }
    for (i = 0; i < adds.length; i++) {
      var at = target.indexOf(adds[i].sid);
      var after = at > 0 ? target[at - 1] : '';
      ops.push(makeOp('add', compId, adds[i].sid, undefined, { after: after, layer: adds[i] }));
      var pos = after ? cur.indexOf(after) : -1;
      if (after && pos < 0) cur.unshift(adds[i].sid);
      else cur.splice(pos + 1, 0, adds[i].sid);
    }
    for (i = 0; i < target.length; i++) {
      if (cur[i] === target[i]) continue;
      ops.push(makeOp('reorder', compId, target[i], undefined, { after: i > 0 ? target[i - 1] : '' }));
      cur.splice(cur.indexOf(target[i]), 1);
      cur.splice(i, 0, target[i]);
    }

    for (i = 0; i < next.layers.length; i++) {
      var nl = next.layers[i];
      var pl = prevBy[nl.sid];
      if (!pl) continue;
      var keep = diffLayer(compId, pl, nl, forced[nl.sid] || forced['*'], ops);
      if (keep) {
        out.force[nl.sid] = 1;
        out.keep[nl.sid] = keep;
      }
    }

    for (k in next.s) {
      if (!valuesNear(prev.s[k], next.s[k])) ops.push(makeOp('comp', compId, '', k, next.s[k]));
    }
    return out;
  }

  function refersTo(layer, sid) {
    var a = layer.a || {};
    if (a.parent === sid) return true;
    return typeof a.matte === 'string' && a.matte.lastIndexOf(sid + ':', 0) === 0;
  }

  function moveLike(shadow, snap, sid) {
    var order = [];
    var i;
    for (i = 0; i < shadow.layers.length; i++) order.push(shadow.layers[i].sid);
    var from = order.indexOf(sid);
    if (from < 0) return;
    var entry = shadow.layers.splice(from, 1)[0];
    order.splice(from, 1);
    var at = 0;
    for (i = 0; i < snap.layers.length; i++) {
      if (snap.layers[i].sid === sid) break;
      var idx = order.indexOf(snap.layers[i].sid);
      if (idx >= 0) at = idx + 1;
    }
    shadow.layers.splice(at, 0, entry);
  }

  function adoptGroup(sl, nl, G) {
    var path;
    for (path in sl.p) {
      if (within(path, G) && path.length > G.length) delete sl.p[path];
    }
    for (path in sl.g) {
      if (within(path, G)) delete sl.g[path];
    }
    for (path in nl.p) {
      if (within(path, G) && path.length > G.length) sl.p[path] = nl.p[path];
    }
    for (path in nl.g) {
      if (within(path, G)) sl.g[path] = nl.g[path];
    }
  }

  // After remote ops were applied in AE, whatever AE now holds for those
  // targets IS the shared state: copy it from the fresh snapshot into the
  // shadow so the next diff does not send it back.
  function adopt(shadow, snap, ops) {
    var want = sidPart(snap.id);
    var snapBy = bySid(snap);
    for (var i = 0; i < ops.length; i++) {
      var op = ops[i];
      if (!op || !op.target || sidPart(op.target.comp) !== want) continue;
      if (op.kind === 'comp') {
        if (op.path in snap.s) shadow.s[op.path] = snap.s[op.path];
        continue;
      }
      var sid = op.target.layer;
      var nl = snapBy[sid];
      var idx = -1;
      for (var j = 0; j < shadow.layers.length; j++) {
        if (shadow.layers[j].sid === sid) { idx = j; break; }
      }
      var sl = idx >= 0 ? shadow.layers[idx] : null;
      if (op.kind === 'remove') {
        if (!nl && sl) shadow.layers.splice(idx, 1);
      } else if (op.kind === 'add') {
        if (!nl) continue;
        if (sl) shadow.layers[idx] = nl;
        else shadow.layers.push(nl);
        moveLike(shadow, snap, sid);
      } else if (!sl || !nl) {
        continue;
      } else if (op.kind === 'reorder') {
        moveLike(shadow, snap, sid);
      } else if (op.kind === 'attr') {
        if (op.path in nl.a) sl.a[op.path] = nl.a[op.path];
      } else if (op.kind === 'prop') {
        if (op.path in nl.p) sl.p[op.path] = nl.p[op.path];
        else delete sl.p[op.path];
      } else if (op.kind === 'gadd') {
        adoptGroup(sl, nl, op.path);
      } else if (op.kind === 'grm' || op.kind === 'gmv') {
        adoptGroup(sl, nl, parentOf(op.path));
      }
    }
  }

  // Layers present in the snapshot but unknown to the shadow that still carry a
  // machine-local id: they must be stamped before they can be announced.
  function unstamped(shadow, snap) {
    var have = bySid(shadow);
    var out = [];
    for (var i = 0; i < snap.layers.length; i++) {
      var sid = snap.layers[i].sid;
      if (!have[sid] && sid.lastIndexOf('id', 0) === 0) out.push(sid);
    }
    return out;
  }

  function itemIndex(items) {
    var map = {};
    for (var i = 0; i < items.length; i++) map[items[i].sid] = items[i];
    return map;
  }

  function itemDepth(by, item) {
    var d = 0;
    var cur = item;
    while (cur && cur.parent && by[cur.parent] && d < 64) {
      cur = by[cur.parent];
      d++;
    }
    return d;
  }

  // Project panel structure: comps and folders created, removed, renamed, moved.
  function diffItems(prev, next) {
    var ops = [];
    var prevBy = itemIndex(prev);
    var nextBy = itemIndex(next);
    var i;
    var adds = [];
    for (i = 0; i < next.length; i++) {
      if (!prevBy[next[i].sid]) adds.push(next[i]);
    }
    adds.sort(function (a, b) { return itemDepth(nextBy, a) - itemDepth(nextBy, b); });
    for (i = 0; i < adds.length; i++) ops.push(makeOp('iadd', adds[i].sid, '', undefined, adds[i]));
    for (i = 0; i < next.length; i++) {
      var p = prevBy[next[i].sid];
      if (!p) continue;
      for (var f = 0; f < ITEM_FIELDS.length; f++) {
        var field = ITEM_FIELDS[f];
        if (p[field] !== next[i][field]) ops.push(makeOp('iset', next[i].sid, '', field, next[i][field]));
      }
    }
    var gone = [];
    for (i = 0; i < prev.length; i++) {
      if (!nextBy[prev[i].sid]) gone.push(prev[i]);
    }
    gone.sort(function (a, b) { return itemDepth(prevBy, b) - itemDepth(prevBy, a); });
    for (i = 0; i < gone.length; i++) ops.push(makeOp('irm', gone[i].sid, ''));
    return ops;
  }

  function adoptItems(shadow, items, ops) {
    var by = itemIndex(items);
    for (var i = 0; i < ops.length; i++) {
      var op = ops[i];
      if (!op || !op.target || (op.kind !== 'iadd' && op.kind !== 'irm' && op.kind !== 'iset')) continue;
      var sid = op.target.comp;
      var idx = -1;
      for (var j = 0; j < shadow.length; j++) {
        if (shadow[j].sid === sid) { idx = j; break; }
      }
      if (op.kind === 'irm') {
        if (!by[sid] && idx >= 0) shadow.splice(idx, 1);
      } else if (!by[sid]) {
        continue;
      } else if (op.kind === 'iadd') {
        if (idx >= 0) shadow[idx] = by[sid];
        else shadow.push(by[sid]);
      } else if (idx >= 0) {
        shadow[idx][op.path] = by[sid][op.path];
      }
    }
  }

  function unstampedItems(shadow, items) {
    var have = itemIndex(shadow);
    var out = [];
    for (var i = 0; i < items.length; i++) {
      if (!have[items[i].sid] && items[i].sid.lastIndexOf('id', 0) === 0) out.push(items[i].sid);
    }
    return out;
  }

  function emptyComp(sid) {
    return { id: sid + '|', s: {}, layers: [], sel: [] };
  }

  // Edits to the same key are last-writer-wins in relay order.
  function targetKey(op) {
    if (!op || !op.target) return '';
    if (op.kind === 'prop') return op.target.layer + '|p|' + op.path;
    if (op.kind === 'attr') return op.target.layer + '|a|' + op.path;
    if (op.kind === 'comp') return sidPart(op.target.comp) + '|c|' + op.path;
    if (op.kind === 'iset') return sidPart(op.target.comp) + '|i|' + op.path;
    return '';
  }

  var KINDS = { attr: 1, prop: 1, gadd: 1, grm: 1, gmv: 1, add: 1, remove: 1, reorder: 1, comp: 1, iadd: 1, irm: 1, iset: 1 };

  root.VynkSync = {
    diff: diff,
    adopt: adopt,
    unstamped: unstamped,
    diffItems: diffItems,
    adoptItems: adoptItems,
    unstampedItems: unstampedItems,
    emptyComp: emptyComp,
    targetKey: targetKey,
    sidPart: sidPart,
    recEq: recEq,
    valuesNear: valuesNear,
    subtree: subtree,
    isKind: function (kind) { return KINDS[kind] === 1; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
