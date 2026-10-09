(function (root) {
  'use strict';

  var SYNCED_PROPS = ['position', 'anchor', 'scale', 'rotation', 'opacity'];
  var LAYER_SCALARS = ['name', 'inPoint', 'outPoint', 'startTime', 'enabled', 'parent', 'trkMatte', 'trkType', 'textDoc', 'motionBlur', 'frameBlending', 'frameBlendingType'];
  var COMP_FIELDS = ['width', 'height', 'duration', 'frameRate', 'pixelAspect', 'bgColor', 'motionBlur', 'shutterAngle', 'shutterPhase'];
  var KEY_ID_SCALE = 10000;
  var ECHO_TTL_MS = 5000;
  var REL_TOL = 1e-4;

  function rid() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  }

  function keyId(t) {
    return Math.round(t * KEY_ID_SCALE);
  }

  function near(a, b) {
    return Math.abs(a - b) <= REL_TOL * Math.max(1, Math.abs(a), Math.abs(b));
  }

  function valuesNear(a, b) {
    if (typeof a === 'number' || typeof b === 'number') {
      if (typeof a !== 'number' || typeof b !== 'number') return false;
      return near(a, b);
    }
    if (a === null || a === undefined || b === null || b === undefined) return a === b;
    if (typeof a === 'string' || typeof b === 'string') return a === b;
    if (typeof a === 'boolean' || typeof b === 'boolean') return a === b;
    var aArr = a.length !== undefined;
    var bArr = b.length !== undefined;
    if (aArr || bArr) {
      if (!aArr || !bArr || a.length !== b.length) return false;
      for (var i = 0; i < a.length; i++) {
        if (!valuesNear(a[i], b[i])) return false;
      }
      return true;
    }
    if (typeof a === 'object' && typeof b === 'object') {
      var k;
      for (k in a) {
        if (!valuesNear(a[k], b[k])) return false;
      }
      for (k in b) {
        if (!(k in a)) return false;
      }
      return true;
    }
    return a === b;
  }

  function scalarEqual(a, b) {
    var aEmpty = a === null || a === undefined;
    var bEmpty = b === null || b === undefined;
    if (aEmpty || bEmpty) return aEmpty && bEmpty;
    if (typeof a === 'string' || typeof b === 'string') return a === b;
    if (typeof a === 'boolean' || typeof b === 'boolean') return a === b;
    return valuesNear(a, b);
  }

  function interpOf(k) {
    return [(k && k.inT) || 0, (k && k.outT) || 0];
  }

  function interpDiffers(a, b) {
    var pa = interpOf(a);
    var pb = interpOf(b);
    return pa[0] !== pb[0] || pa[1] !== pb[1];
  }

  function easeSpec(k) {
    return { in: (k && k.inEase) || [], out: (k && k.outEase) || [] };
  }

  function spatialSpec(k) {
    return { in: (k && k.inSp) || [], out: (k && k.outSp) || [] };
  }

  function makeOp(kind, compId, sid, path, value, extra) {
    var op = { opId: rid(), kind: kind, target: { comp: compId, layer: sid }, path: path };
    if (value !== undefined) op.value = value;
    if (extra) {
      if (extra.time !== undefined) op.time = extra.time;
      if (extra.interp) op.interp = extra.interp;
      if (extra.ease) op.ease = extra.ease;
      if (extra.spatial) op.spatial = extra.spatial;
      if (extra.index !== undefined) op.index = extra.index;
    }
    return op;
  }

  function propSkippable(p) {
    return !p || p.unsupported === true || p.hasExpr === true || p.keysOmitted === true;
  }

  function diffScalar(compId, sid, prev, next, field, hooks, ops) {
    if (scalarEqual(prev[field], next[field])) return;
    if (hooks.suppress(sid, field, next[field])) return;
    ops.push(makeOp('set', compId, sid, field, next[field]));
  }

  function diffExpr(compId, sid, path, prevP, nextP, hooks, ops) {
    var prevText = typeof prevP.expr === 'string' ? prevP.expr : '';
    var nextText = typeof nextP.expr === 'string' ? nextP.expr : '';
    var prevOn = prevP.exprOn === true;
    var nextOn = nextP.exprOn === true;
    if (prevText === nextText && prevOn === nextOn) return;
    if (hooks.suppress(sid, path + '@expr', undefined)) return;
    ops.push(makeOp('setExpr', compId, sid, path + '@expr', { text: nextText, enabled: nextOn }));
  }

  function diffProp(compId, sid, path, prevP, nextP, hooks, ops) {
    if (!prevP || !nextP) return;
    if (prevP.unsupported === true || nextP.unsupported === true) return;
    diffExpr(compId, sid, path, prevP, nextP, hooks, ops);
    if (propSkippable(prevP) || propSkippable(nextP)) return;
    var prevKeys = prevP.keys || null;
    var nextKeys = nextP.keys || null;

    if (!prevKeys && !nextKeys) {
      if (valuesNear(prevP.value, nextP.value)) return;
      if (hooks.suppress(sid, path, nextP.value)) return;
      ops.push(makeOp('set', compId, sid, path, nextP.value));
      return;
    }

    var prevMap = {};
    var nextMap = {};
    var i;
    var id;
    for (i = 0; prevKeys && i < prevKeys.length; i++) prevMap[String(keyId(prevKeys[i].t))] = prevKeys[i];
    for (i = 0; nextKeys && i < nextKeys.length; i++) nextMap[String(keyId(nextKeys[i].t))] = nextKeys[i];

    var adds = [];
    var sets = [];
    var removes = [];
    for (id in nextMap) {
      if (!(id in prevMap)) adds.push(nextMap[id]);
    }
    for (id in prevMap) {
      if (!(id in nextMap)) removes.push(prevMap[id]);
    }
    for (id in nextMap) {
      if (!(id in prevMap)) continue;
      var pk = prevMap[id];
      var nk = nextMap[id];
      if (
        !valuesNear(pk.v, nk.v) ||
        interpDiffers(pk, nk) ||
        !valuesNear(pk.inEase || [], nk.inEase || []) ||
        !valuesNear(pk.outEase || [], nk.outEase || []) ||
        !valuesNear(pk.inSp || [], nk.inSp || []) ||
        !valuesNear(pk.outSp || [], nk.outSp || [])
      ) {
        sets.push(nk);
      }
    }
    if (adds.length === 0 && sets.length === 0 && removes.length === 0) return;

    for (i = 0; i < removes.length; i++) {
      if (hooks.suppress(sid, path, undefined, removes[i].t)) continue;
      ops.push(makeOp('removeKey', compId, sid, path, undefined, { time: removes[i].t }));
    }
    for (i = 0; i < adds.length; i++) {
      if (hooks.suppress(sid, path, undefined, adds[i].t)) continue;
      ops.push(
        makeOp('addKey', compId, sid, path, adds[i].v, {
          time: adds[i].t,
          interp: { inType: interpOf(adds[i])[0], outType: interpOf(adds[i])[1] },
          ease: easeSpec(adds[i]),
          spatial: spatialSpec(adds[i])
        })
      );
    }
    for (i = 0; i < sets.length; i++) {
      if (hooks.suppress(sid, path, undefined, sets[i].t)) continue;
      ops.push(
        makeOp('setKey', compId, sid, path, sets[i].v, {
          time: sets[i].t,
          interp: { inType: interpOf(sets[i])[0], outType: interpOf(sets[i])[1] },
          ease: easeSpec(sets[i]),
          spatial: spatialSpec(sets[i])
        })
      );
    }
  }

  function diffStructure(compId, prev, next, prevBySid, hooks, ops) {
    var i;
    var nextBySid = {};
    for (i = 0; i < next.layers.length; i++) nextBySid[next.layers[i].sid] = next.layers[i];

    for (i = 0; i < prev.layers.length; i++) {
      var pl = prev.layers[i];
      if (nextBySid[pl.sid]) continue;
      if (hooks.suppress(pl.sid, '', undefined)) continue;
      ops.push(makeOp('remove', compId, pl.sid));
    }

    var prevOrder = [];
    for (i = 0; i < prev.layers.length; i++) {
      if (nextBySid[prev.layers[i].sid]) prevOrder.push(prev.layers[i].sid);
    }
    var nextOrder = [];
    for (i = 0; i < next.layers.length; i++) {
      if (prevBySid[next.layers[i].sid]) nextOrder.push(next.layers[i].sid);
    }
    if (prevOrder.length !== nextOrder.length) return;

    for (i = 0; i < nextOrder.length; i++) {
      if (prevOrder[i] === nextOrder[i]) continue;
      var moved = nextBySid[nextOrder[i]];
      if (hooks.suppress(moved.sid, '', undefined)) return;
      ops.push(makeOp('reorder', compId, moved.sid, undefined, undefined, { index: moved.index }));
      return;
    }
  }

  function findAdditions(prev, next, hooks) {
    var out = [];
    if (!prev || !next || !prev.comp || !next.comp) return out;
    if (prev.comp.id !== next.comp.id) return out;
    var prevBySid = {};
    var i;
    for (i = 0; i < prev.layers.length; i++) prevBySid[prev.layers[i].sid] = prev.layers[i];
    for (i = 0; i < next.layers.length; i++) {
      var layer = next.layers[i];
      if (prevBySid[layer.sid]) continue;
      if (hooks && hooks.suppress(layer.sid, '', undefined)) continue;
      out.push(layer);
    }
    return out;
  }

  function diffPropMap(compId, sid, prefix, prevMap, nextMap, hooks, ops) {
    for (var key in nextMap) {
      if (!(key in prevMap)) continue;
      diffProp(compId, sid, prefix + key, prevMap[key], nextMap[key], hooks, ops);
    }
  }

  function makeEffectOp(kind, compId, sid, fxId, value, index) {
    var op = { opId: rid(), kind: kind, target: { comp: compId, layer: sid }, path: 'fx:' + fxId };
    if (value !== undefined) op.value = value;
    if (index !== undefined) op.index = index;
    return op;
  }

  function diffEffects(prev, next, hooks) {
    var ops = [];
    if (!prev || !next || !prev.comp || !next.comp) return ops;
    if (prev.comp.id !== next.comp.id) return ops;

    var compId = next.comp.id;
    var prevBySid = {};
    var i;
    var j;
    var id;
    for (i = 0; i < prev.layers.length; i++) prevBySid[prev.layers[i].sid] = prev.layers[i];

    for (j = 0; j < next.layers.length; j++) {
      var nl = next.layers[j];
      var pl = prevBySid[nl.sid];
      if (!pl) continue;
      var pe = pl.effects || [];
      var ne = nl.effects || [];
      var pMap = {};
      var nMap = {};
      for (i = 0; i < pe.length; i++) pMap[pe[i].id] = pe[i];
      for (i = 0; i < ne.length; i++) nMap[ne[i].id] = ne[i];

      for (id in nMap) {
        if (pMap[id]) continue;
        if (hooks.suppress(nl.sid, 'fx:' + id, undefined)) continue;
        ops.push(
          makeEffectOp('addEffect', compId, nl.sid, id, {
            matchName: nMap[id].matchName,
            name: nMap[id].name,
            enabled: nMap[id].enabled,
            index: nMap[id].index,
            props: nMap[id].props
          })
        );
      }

      for (id in pMap) {
        if (nMap[id]) continue;
        if (hooks.suppress(nl.sid, 'fx:' + id, undefined)) continue;
        ops.push(makeEffectOp('removeEffect', compId, nl.sid, id));
      }

      for (id in nMap) {
        if (!pMap[id]) continue;
        var pf = pMap[id];
        var nf = nMap[id];
        var metaChanged = pf.enabled !== nf.enabled || pf.name !== nf.name;
        if (metaChanged) {
          if (!hooks.suppress(nl.sid, 'fx:' + id, undefined)) {
            ops.push(makeEffectOp('setEffect', compId, nl.sid, id, { enabled: nf.enabled, name: nf.name }));
          }
        }
        if (pf.index !== nf.index) {
          if (!hooks.suppress(nl.sid, 'fx:' + id, undefined)) {
            ops.push(makeEffectOp('setEffect', compId, nl.sid, id, {}, nf.index));
          }
        }
        diffPropMap(compId, nl.sid, 'fx:' + id + '/', pf.props || {}, nf.props || {}, hooks, ops);
      }
    }
    return ops;
  }

  var MASK_FIELDS = ['name', 'maskMode', 'inverted', 'maskFeather', 'maskOpacity', 'maskExpansion', 'maskMotionBlur'];

  function diffMasks(compId, sid, prevMasks, nextMasks, hooks, ops) {
    var pm = prevMasks || [];
    var nm = nextMasks || [];
    var i;
    var f;
    for (i = 0; i < nm.length; i++) {
      if (pm[i]) continue;
      var addPath = 'mask:' + (i + 1);
      if (hooks.suppress(sid, addPath, undefined)) continue;
      ops.push(makeOp('addMask', compId, sid, addPath, nm[i]));
    }
    for (i = pm.length - 1; i >= 0; i--) {
      if (nm[i]) continue;
      var delPath = 'mask:' + (i + 1);
      if (hooks.suppress(sid, delPath, undefined)) continue;
      ops.push(makeOp('removeMask', compId, sid, delPath));
    }
    var both = Math.min(pm.length, nm.length);
    for (i = 0; i < both; i++) {
      var a = pm[i];
      var b = nm[i];
      for (f = 0; f < MASK_FIELDS.length; f++) {
        var field = MASK_FIELDS[f];
        if (scalarEqual(a[field], b[field])) continue;
        var path = 'mask:' + (i + 1) + '/' + field;
        if (hooks.suppress(sid, path, b[field])) continue;
        ops.push(makeOp('set', compId, sid, path, b[field]));
      }
      diffProp(compId, sid, 'mask:' + (i + 1) + '/path', a.path, b.path, hooks, ops);
    }
  }

  function diffCompSettings(prev, next, hooks, ops) {
    if (!prev || !next || !prev.comp || !next.comp) return;
    if (prev.comp.id !== next.comp.id) return;
    for (var i = 0; i < COMP_FIELDS.length; i++) {
      var field = COMP_FIELDS[i];
      if (scalarEqual(prev.comp[field], next.comp[field])) continue;
      if (hooks.suppress('', field, next.comp[field])) continue;
      ops.push({ opId: rid(), kind: 'setComp', target: { comp: next.comp.id }, path: field, value: next.comp[field] });
    }
  }

  function diffTextState(prev, next, hooks) {
    var ops = [];
    if (!prev || !next || !prev.comp || !next.comp) return ops;
    if (prev.comp.id !== next.comp.id) return ops;
    var prevBySid = {};
    var i;
    for (i = 0; i < prev.layers.length; i++) prevBySid[prev.layers[i].sid] = prev.layers[i];
    for (i = 0; i < next.layers.length; i++) {
      var nl = next.layers[i];
      var pl = prevBySid[nl.sid];
      if (!pl) continue;
      if (valuesNear(pl.textDoc, nl.textDoc)) continue;
      if (hooks.suppress(nl.sid, 'textDoc', undefined)) continue;
      ops.push(makeOp('set', next.comp.id, nl.sid, 'textDoc', nl.textDoc));
    }
    return ops;
  }

  function diffShapeStates(prev, next, hooks) {
    var ops = [];
    if (!prev || !next || !prev.comp || !next.comp) return ops;
    if (prev.comp.id !== next.comp.id) return ops;
    var prevBySid = {};
    var i;
    for (i = 0; i < prev.layers.length; i++) prevBySid[prev.layers[i].sid] = prev.layers[i];
    for (i = 0; i < next.layers.length; i++) {
      var nl = next.layers[i];
      var pl = prevBySid[nl.sid];
      if (!pl) continue;
      if (valuesNear(pl.tree, nl.tree)) continue;
      if (hooks.suppress(nl.sid, 'shape', undefined)) continue;
      ops.push(makeOp('setShape', next.comp.id, nl.sid, 'shape', { tree: nl.tree }));
    }
    return ops;
  }

  function diffComp(prev, next, hooks) {
    var ops = [];
    if (!prev || !next || !prev.comp || !next.comp) return ops;
    if (prev.comp.id !== next.comp.id) return ops;

    var compId = next.comp.id;
    var prevBySid = {};
    var i;
    var j;
    for (i = 0; i < prev.layers.length; i++) prevBySid[prev.layers[i].sid] = prev.layers[i];

    for (j = 0; j < next.layers.length; j++) {
      var nl = next.layers[j];
      var pl = prevBySid[nl.sid];
      if (!pl) continue;

      for (i = 0; i < LAYER_SCALARS.length; i++) {
        diffScalar(compId, nl.sid, pl, nl, LAYER_SCALARS[i], hooks, ops);
      }

      var prevTransform = pl.transform || {};
      var nextTransform = nl.transform || {};
      for (i = 0; i < SYNCED_PROPS.length; i++) {
        var propName = SYNCED_PROPS[i];
        diffProp(compId, nl.sid, 'transform.' + propName, prevTransform[propName], nextTransform[propName], hooks, ops);
      }

      diffMasks(compId, nl.sid, pl.masks, nl.masks, hooks, ops);
    }

    diffStructure(compId, prev, next, prevBySid, hooks, ops);
    diffCompSettings(prev, next, hooks, ops);
    return ops;
  }

  function createEcho() {
    var map = {};
    function echoKey(sid, path, time) {
      var k = sid + '|' + path;
      if (time !== undefined && time !== null) k += '|' + Math.round(time * 10000);
      return k;
    }
    return {
      mark: function (sid, path, value, time) {
        map[echoKey(sid, path, time)] = { expire: Date.now() + ECHO_TTL_MS, hasValue: value !== undefined, value: value };
      },
      suppress: function (sid, path, value, time) {
        var k = echoKey(sid, path, time);
        var entry = map[k];
        if (!entry) return false;
        if (Date.now() > entry.expire) {
          delete map[k];
          return false;
        }
        if (!entry.hasValue) {
          delete map[k];
          return true;
        }
        if (value !== undefined && valuesNear(entry.value, value)) {
          delete map[k];
          return true;
        }
        delete map[k];
        return false;
      }
    };
  }

  root.CollabDiff = {
    SYNCED_PROPS: SYNCED_PROPS,
    LAYER_SCALARS: LAYER_SCALARS,
    keyId: keyId,
    valuesNear: valuesNear,
    diffComp: diffComp,
    findAdditions: findAdditions,
    diffEffects: diffEffects,
    diffTextState: diffTextState,
    diffShapeStates: diffShapeStates,
    diffCompSettings: diffCompSettings,
    createEcho: createEcho,
    makeOp: makeOp
  };
})(typeof window !== 'undefined' ? window : globalThis);
