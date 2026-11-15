// Vynk sync engine v2 (ExtendScript, ES3). Loaded by the panel after
// hostscript.jsx (which installs the JSON polyfill when AE has none).
//
// Generic model: a layer is its attributes plus its whole property tree,
// addressed by matchName paths ("ADBE Transform Group/ADBE Position",
// "ADBE Effect Parade/ADBE Gaussian Blur 2#2/..."). Nothing is special-cased
// per effect or property, so new AE features sync without new code.
$.global.vynkSync = (function () {
  var STAMP = '#c:';
  var STAMP_LEN = 12;
  var MAX_KEYS = 600;
  var BEZIER = 6613;

  // Top-level layer groups that are never synced.
  var SKIP_TOP = {
    'ADBE MTrackers': 1,
    'ADBE Data Group': 1,
    'ADBE Layer Overrides': 1,
    'ADBE Layer Sets': 1,
    'ADBE Layer Styles': 1
  };

  var BUILT_IN = {
    'ADBE Transform Group': 1, 'ADBE Material Options Group': 1, 'ADBE Audio Group': 1, 'ADBE Plane Options Group': 1,
    'ADBE Extrsn Options Group': 1, 'ADBE Camera Options Group': 1, 'ADBE Light Options Group': 1
  };
  var NO_PRUNE = { 'ADBE Text Properties': 1, 'ADBE Transform Group': 1, 'ADBE Camera Options Group': 1, 'ADBE Light Options Group': 1 };

  var BOOL_ATTRS = [
    'enabled', 'threeDLayer', 'adjustmentLayer', 'guideLayer', 'motionBlur', 'collapseTransformation',
    'audioEnabled', 'effectsActive', 'timeRemapEnabled', 'preserveTransparency'
  ];
  var NUM_ATTRS = ['inPoint', 'outPoint', 'startTime', 'stretch', 'label'];
  var ENUM_ATTRS = ['blendingMode', 'quality', 'samplingQuality', 'frameBlendingType', 'autoOrient', 'lightType'];
  var TEXT_FIELDS = [
    'text', 'font', 'fontSize', 'fillColor', 'strokeColor', 'applyFill', 'applyStroke', 'strokeWidth',
    'strokeOverFill', 'tracking', 'leading', 'justification', 'baselineShift', 'tsume',
    'horizontalScale', 'verticalScale', 'fauxBold', 'fauxItalic', 'allCaps', 'smallCaps', 'superscript', 'subscript'
  ];
  var MARKER_FIELDS = ['comment', 'duration', 'chapter', 'url', 'frameTarget', 'cuePointName', 'label'];
  var COMP_FIELDS = [
    'width', 'height', 'duration', 'frameRate', 'pixelAspect', 'motionBlur', 'shutterAngle',
    'shutterPhase', 'displayStartTime', 'frameBlending'
  ];

  var PT_PROPERTY = PropertyType.PROPERTY;
  var PT_INDEXED = PropertyType.INDEXED_GROUP;
  var PVT_NONE = PropertyValueType.NO_VALUE;
  var PVT_CUSTOM = PropertyValueType.CUSTOM_VALUE;
  var PVT_SHAPE = PropertyValueType.SHAPE;
  var PVT_TEXT = PropertyValueType.TEXT_DOCUMENT;
  var PVT_MARKER = PropertyValueType.MARKER;
  var PVT_2DS = PropertyValueType.TwoD_SPATIAL;
  var PVT_3DS = PropertyValueType.ThreeD_SPATIAL;

  // ---------------------------------------------------------------- identity

  function randHex(len) {
    var chars = '0123456789abcdef';
    var s = '';
    for (var i = 0; i < len; i++) s += chars.charAt(Math.floor(Math.random() * 16));
    return s;
  }

  function readStamp(comment) {
    if (!comment) return null;
    var idx = comment.indexOf(STAMP);
    if (idx < 0) return null;
    var out = comment.substr(idx + STAMP.length, STAMP_LEN);
    return out.length === STAMP_LEN ? out : null;
  }

  function stripStamps(comment) {
    var out = comment || '';
    var idx = out.indexOf(STAMP);
    while (idx >= 0) {
      out = out.substring(0, idx) + out.substring(idx + STAMP.length + STAMP_LEN);
      idx = out.indexOf(STAMP);
    }
    return out.replace(/^\s+|\s+$/g, '');
  }

  function writeStamp(obj, hex) {
    var base = stripStamps(obj.comment);
    obj.comment = (base ? base + ' ' : '') + STAMP + String(hex).substr(0, STAMP_LEN);
  }

  function sidOf(obj) {
    var stamp = null;
    try { stamp = readStamp(obj.comment); } catch (e0) {}
    if (stamp) {
      // "=id30......." re-creates an object that is id30 on the machines that
      // still have the original (see stampFor).
      if (stamp.charAt(0) === '=') return stamp.substring(1).replace(/\.+$/, '');
      return 'st' + stamp;
    }
    var id;
    try { id = obj.id; } catch (e) { id = null; }
    if (typeof id === 'number') return 'id' + id;
    var fresh = randHex(STAMP_LEN);
    try { writeStamp(obj, fresh); } catch (e2) {}
    return 'st' + fresh;
  }

  // The stamp that makes a newly created object answer to this sid.
  function stampFor(sid) {
    if (sid.indexOf('st') === 0) return sid.substring(2);
    var out = '=' + sid;
    while (out.length < STAMP_LEN) out += '.';
    return out;
  }

  function sidPart(key) {
    var s = String(key || '');
    var idx = s.indexOf('|');
    return idx < 0 ? s : s.substring(0, idx);
  }

  function compKey(item) {
    return sidOf(item) + '|' + item.name;
  }

  // sid -> item, rebuilt once per cycle and whenever items are added/removed.
  var itemCache = null;

  function findItem(key) {
    if (!app.project) return null;
    if (!itemCache) {
      itemCache = {};
      for (var i = 1; i <= app.project.numItems; i++) {
        var item = app.project.item(i);
        if (item instanceof CompItem || item instanceof FolderItem) itemCache[sidOf(item)] = item;
      }
    }
    return itemCache[sidPart(key)] || null;
  }

  function folderSid(item) {
    try {
      var parent = item.parentFolder;
      if (!parent || parent === app.project.rootFolder) return '';
      return sidOf(parent);
    } catch (e) {
      return '';
    }
  }

  function readItems() {
    var out = [];
    if (!app.project) return out;
    for (var i = 1; i <= app.project.numItems; i++) {
      var item = app.project.item(i);
      var isComp = item instanceof CompItem;
      if (!isComp && !(item instanceof FolderItem)) continue;
      var entry = { sid: sidOf(item), type: isComp ? 'comp' : 'folder', name: item.name, parent: folderSid(item), label: item.label };
      if (isComp) {
        entry.w = item.width;
        entry.h = item.height;
        entry.dur = item.duration;
        entry.fr = item.frameRate;
        entry.pa = item.pixelAspect;
      }
      out.push(entry);
    }
    return out;
  }

  function setItemParent(item, parentSid) {
    if (!parentSid) {
      if (item.parentFolder !== app.project.rootFolder) item.parentFolder = app.project.rootFolder;
      return '';
    }
    var folder = findItem(parentSid);
    if (!(folder instanceof FolderItem)) return 'folder not found';
    if (item.parentFolder !== folder) item.parentFolder = folder;
    return '';
  }

  function applyItemOp(op) {
    var sid = sidPart(op.target.comp);
    var item = findItem(sid);
    if (op.kind === 'irm') {
      if (item) {
        item.remove();
        itemCache = null;
      }
      return '';
    }
    if (op.kind === 'iset') {
      if (!item) return 'item not found';
      if (op.path === 'name') { if (item.name !== op.value) item.name = String(op.value); return ''; }
      if (op.path === 'label') { item.label = Number(op.value); return ''; }
      if (op.path === 'parent') return setItemParent(item, String(op.value || ''));
      return 'unknown item field ' + op.path;
    }
    var v = op.value || {};
    if (!item) {
      if (v.type === 'comp') {
        item = app.project.items.addComp(String(v.name || 'Comp'), Math.max(1, Math.round(Number(v.w) || 1920)), Math.max(1, Math.round(Number(v.h) || 1080)), Number(v.pa) || 1, Number(v.dur) || 10, Number(v.fr) || 30);
      } else {
        // AE makes its own "Solids" folder on every machine; reuse a matching
        // local one instead of creating a twin.
        for (var i = 1; i <= app.project.numItems && !item; i++) {
          var cand = app.project.item(i);
          if (cand instanceof FolderItem && cand.name === v.name && !readStamp(cand.comment) && folderSid(cand) === String(v.parent || '') && sidOf(cand) !== sid) item = cand;
        }
        if (!item) item = app.project.items.addFolder(String(v.name || 'Folder'));
      }
      writeStamp(item, stampFor(sid));
      itemCache = null;
    }
    try { if (v.name && item.name !== v.name) item.name = String(v.name); } catch (e0) {}
    try { setItemParent(item, String(v.parent || '')); } catch (e) {}
    try { if (v.label !== undefined) item.label = Number(v.label); } catch (e2) {}
    return '';
  }

  function findComp(key) {
    var item = findItem(key);
    return item instanceof CompItem ? item : null;
  }

  function findLayer(comp, sid) {
    if (!sid) return null;
    for (var i = 1; i <= comp.numLayers; i++) {
      var layer = comp.layer(i);
      if (sidOf(layer) === sid) return layer;
    }
    return null;
  }

  // ------------------------------------------------------------------ values

  function arr(v) {
    var out = [];
    for (var i = 0; i < v.length; i++) out.push(v[i] instanceof Array ? arr(v[i]) : v[i]);
    return out;
  }

  function normValue(v, pvt) {
    var i;
    var o;
    if (v === null || v === undefined) return null;
    if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return v;
    if (pvt === PVT_SHAPE) {
      return { c: v.closed ? 1 : 0, v: arr(v.vertices), i: arr(v.inTangents), o: arr(v.outTangents) };
    }
    if (pvt === PVT_TEXT) {
      o = {};
      for (i = 0; i < TEXT_FIELDS.length; i++) {
        var tv;
        try { tv = v[TEXT_FIELDS[i]]; } catch (e) { continue; }
        if (tv === undefined || tv === null) continue;
        o[TEXT_FIELDS[i]] = (tv instanceof Array) ? arr(tv) : (typeof tv === 'object' ? Number(tv) : tv);
      }
      try { if (v.boxText) o.boxTextSize = arr(v.boxTextSize); } catch (e2) {}
      return o;
    }
    if (pvt === PVT_MARKER) {
      o = {};
      for (i = 0; i < MARKER_FIELDS.length; i++) {
        try {
          var mv = v[MARKER_FIELDS[i]];
          if (mv !== undefined && mv !== null && mv !== '' && mv !== 0) o[MARKER_FIELDS[i]] = mv;
        } catch (e3) {}
      }
      return o;
    }
    if (v instanceof Array) return arr(v);
    return null;
  }

  function easeList(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) out.push([list[i].speed, list[i].influence]);
    return out;
  }

  function readLeaf(p) {
    var pvt = p.propertyValueType;
    if (pvt === PVT_NONE || pvt === PVT_CUSTOM) return null;
    var rec = {};
    try {
      if (p.isSeparationLeader && p.dimensionsSeparated) return { sep: 1, m: 1 };
      if (p.isSeparationFollower && !p.separationLeader.dimensionsSeparated) return null;
    } catch (e0) {}
    try { rec.m = p.isModified ? 1 : 0; } catch (e1) { rec.m = 1; }
    var expr = '';
    try { if (p.canSetExpression) expr = p.expression; } catch (e2) { expr = ''; }
    if (expr) {
      rec.x = String(expr);
      rec.xo = p.expressionEnabled ? 1 : 0;
    }
    var nk = p.numKeys;
    if (pvt === PVT_MARKER && nk === 0) {
      rec.k = [];
      return rec;
    }
    if (nk > 0) {
      if (nk > MAX_KEYS) {
        rec.big = nk;
        return rec;
      }
      var spatial = pvt === PVT_2DS || pvt === PVT_3DS;
      var keys = [];
      for (var k = 1; k <= nk; k++) {
        var key = { t: p.keyTime(k), v: normValue(p.keyValue(k), pvt) };
        if (pvt !== PVT_MARKER) {
          var inT = 0;
          var outT = 0;
          try {
            inT = Number(p.keyInInterpolationType(k));
            outT = Number(p.keyOutInterpolationType(k));
            key.i = [inT, outT];
          } catch (e3) {}
          var f = [0, 0, 0, 0, 0];
          try {
            f[0] = p.keyTemporalAutoBezier(k) ? 1 : 0;
            f[1] = p.keyTemporalContinuous(k) ? 1 : 0;
          } catch (e4) {}
          if (inT === BEZIER || outT === BEZIER) {
            try { key.e = [easeList(p.keyInTemporalEase(k)), easeList(p.keyOutTemporalEase(k))]; } catch (e5) {}
          }
          if (spatial) {
            try {
              f[2] = p.keySpatialAutoBezier(k) ? 1 : 0;
              f[3] = p.keySpatialContinuous(k) ? 1 : 0;
              f[4] = p.keyRoving(k) ? 1 : 0;
              if (!f[2]) key.s = [arr(p.keyInSpatialTangent(k)), arr(p.keyOutSpatialTangent(k))];
            } catch (e6) {}
          }
          key.f = f;
        }
        keys.push(key);
      }
      rec.k = keys;
    } else {
      var val;
      try {
        val = (expr && rec.xo) ? p.valueAtTime(0, true) : p.value;
      } catch (e7) {
        return null;
      }
      rec.v = normValue(val, pvt);
      if (rec.v === null) return null;
    }
    return rec;
  }

  // -------------------------------------------------------------------- walk

  function childKeys(group) {
    var n = group.numProperties;
    var seen = {};
    var out = [];
    for (var i = 1; i <= n; i++) {
      var mn = group.property(i).matchName;
      seen[mn] = (seen[mn] || 0) + 1;
      out.push(mn + (seen[mn] > 1 ? '#' + seen[mn] : ''));
    }
    return out;
  }

  function walk(group, prefix, depth, force, out, groups) {
    var n = 0;
    try { n = group.numProperties; } catch (e) { return; }
    var indexed = false;
    try { indexed = group.propertyType === PT_INDEXED; } catch (e0) {}
    var seen = {};
    var kids = [];
    for (var i = 1; i <= n; i++) {
      var p;
      try { p = group.property(i); } catch (e1) { continue; }
      if (!p) continue;
      var mn = p.matchName;
      if (depth === 0 && SKIP_TOP[mn]) continue;
      seen[mn] = (seen[mn] || 0) + 1;
      var key = mn + (seen[mn] > 1 ? '#' + seen[mn] : '');
      var path = prefix ? prefix + '/' + key : key;
      var isLeaf = true;
      try { isLeaf = p.propertyType === PT_PROPERTY; } catch (e2) {}
      if (isLeaf) {
        var rec = null;
        try { rec = readLeaf(p); } catch (e3) { rec = null; }
        if (rec) out[path] = rec;
        continue;
      }
      if (indexed) kids.push(key);
      // Untouched named groups (material, geometry, audio...) hold only
      // defaults on every machine, so they are not read at all.
      if (depth === 0 && !force && !NO_PRUNE[mn]) {
        var prune = false;
        try { prune = p.propertyType !== PT_INDEXED && !p.isModified; } catch (e4) {}
        if (prune) continue;
      }
      if (mn === 'ADBE Mask Atom') {
        try {
          out[path + '@mask'] = { v: [Number(p.maskMode), p.inverted ? 1 : 0, Number(p.maskMotionBlur), p.rotoBezier ? 1 : 0], m: 1 };
        } catch (e5) {}
      }
      if (indexed) {
        try { out[path + '@name'] = { v: p.name, m: 1 }; } catch (e6) {}
      }
      try {
        if (p.canSetEnabled) out[path + '@on'] = { v: p.enabled ? 1 : 0, m: 1 };
      } catch (e7) {}
      walk(p, path, depth + 1, force, out, groups);
    }
    if (indexed) groups[prefix] = kids;
  }

  function layerKind(layer) {
    var info = { kind: 'other' };
    try {
      if (layer instanceof TextLayer) {
        info.kind = 'text';
        try { info.box = layer.property('ADBE Text Properties').property('ADBE Text Document').value.boxText ? 1 : 0; } catch (eb) {}
        return info;
      }
      if (layer instanceof ShapeLayer) { info.kind = 'shape'; return info; }
      if (layer instanceof CameraLayer) { info.kind = 'camera'; return info; }
      if (layer instanceof LightLayer) { info.kind = 'light'; return info; }
      if (!(layer instanceof AVLayer)) return info;
      if (layer.nullLayer) {
        info.kind = 'null';
        try { info.src = { name: layer.source.name }; } catch (en) {}
        return info;
      }
      var src = layer.source;
      if (!src) return info;
      if (src instanceof CompItem) {
        info.kind = 'comp';
        info.src = { comp: compKey(src) };
        return info;
      }
      if (src.mainSource instanceof SolidSource) {
        var c = src.mainSource.color;
        info.kind = 'solid';
        info.src = { color: [c[0], c[1], c[2]], w: src.width, h: src.height, pa: src.pixelAspect, name: src.name };
        return info;
      }
      if (src instanceof FootageItem) {
        info.kind = src.mainSource instanceof PlaceholderSource ? 'placeholder' : 'footage';
        info.src = { name: src.name, path: src.file ? src.file.fsName : '', w: src.width, h: src.height, dur: src.duration, fr: src.frameRate };
        return info;
      }
    } catch (e) {}
    return info;
  }

  // Reading an attribute a layer type does not have throws, and a throw costs
  // about as much as a hundred successful reads - so never ask.
  var AV_ONLY = {
    threeDLayer: 1, adjustmentLayer: 1, guideLayer: 1, motionBlur: 1, collapseTransformation: 1, audioEnabled: 1,
    effectsActive: 1, timeRemapEnabled: 1, preserveTransparency: 1, blendingMode: 1, quality: 1, samplingQuality: 1,
    frameBlendingType: 1
  };

  function layerAttrs(layer) {
    var a = {};
    var i;
    var v;
    var isAV = layer instanceof AVLayer;
    var isLight = !isAV && layer instanceof LightLayer;
    a.name = layer.name;
    for (i = 0; i < BOOL_ATTRS.length; i++) {
      if (AV_ONLY[BOOL_ATTRS[i]] && !isAV) continue;
      try {
        v = layer[BOOL_ATTRS[i]];
        if (v !== undefined) a[BOOL_ATTRS[i]] = v ? 1 : 0;
      } catch (e) {}
    }
    for (i = 0; i < NUM_ATTRS.length; i++) {
      try {
        v = layer[NUM_ATTRS[i]];
        if (v !== undefined) a[NUM_ATTRS[i]] = v;
      } catch (e2) {}
    }
    for (i = 0; i < ENUM_ATTRS.length; i++) {
      if (AV_ONLY[ENUM_ATTRS[i]] && !isAV) continue;
      if (ENUM_ATTRS[i] === 'lightType' && !isLight) continue;
      try {
        v = layer[ENUM_ATTRS[i]];
        if (v !== undefined) a[ENUM_ATTRS[i]] = Number(v);
      } catch (e3) {}
    }
    try { a.parent = layer.parent ? sidOf(layer.parent) : ''; } catch (e4) { a.parent = ''; }
    try { a.comment = stripStamps(layer.comment); } catch (e5) {}
    if (isAV) {
      try {
        if (layer.trackMatteLayer !== undefined) {
          a.matte = layer.trackMatteLayer ? sidOf(layer.trackMatteLayer) + ':' + Number(layer.trackMatteType) : '';
        } else if (layer.trackMatteType !== undefined) {
          a.matte = String(Number(layer.trackMatteType));
        }
      } catch (e6) {}
    }
    return a;
  }

  // Attributes are read for every layer on every look, but only sent to the
  // panel when they differ from what was last sent.
  var liteCache = {};

  function attrSig(a) {
    var parts = [];
    for (var k in a) {
      if (a.hasOwnProperty(k)) parts.push(a[k]);
    }
    return parts.join('\u0001');
  }

  function readLayer(layer, sid, force) {
    var info = layerKind(layer);
    var entry = { sid: sid, kind: info.kind, a: layerAttrs(layer), p: {}, g: {} };
    if (info.src) entry.src = info.src;
    if (info.box) entry.box = 1;
    walk(layer, '', 0, force, entry.p, entry.g);
    return entry;
  }

  function readMarkers(comp) {
    var out = [];
    try {
      var mk = comp.markerProperty;
      for (var i = 1; i <= mk.numKeys; i++) {
        out.push({ t: mk.keyTime(i), v: normValue(mk.keyValue(i), PVT_MARKER) });
      }
    } catch (e) {}
    return out;
  }

  // Every layer is listed with its attributes (cheap). The full property tree
  // is read only where asked: selected layers, layers named in opts.deep, a
  // rotating slice (opts.sweep = [after index, count]) or everything (opts.all).
  function readComp(comp, opts) {
    opts = opts || {};
    var force = opts.force || null;
    var deep = opts.deep || null;
    var all = opts.all ? true : false;
    var cacheKey = sidOf(comp) + '|';
    var from = opts.sweep ? Number(opts.sweep[0]) : 0;
    var count = opts.sweep ? Number(opts.sweep[1]) : 0;
    var s = {};
    var i;
    for (i = 0; i < COMP_FIELDS.length; i++) {
      try {
        var v = comp[COMP_FIELDS[i]];
        if (v !== undefined) s[COMP_FIELDS[i]] = typeof v === 'boolean' ? (v ? 1 : 0) : v;
      } catch (e) {}
    }
    try { s.bgColor = arr(comp.bgColor); } catch (e2) {}
    s.markers = readMarkers(comp);
    var layers = [];
    var sel = [];
    var seen = {};
    for (i = 1; i <= comp.numLayers; i++) {
      var layer = comp.layer(i);
      var sid = sidOf(layer);
      if (seen[sid]) {
        // A duplicated layer copies its stamp. The copy is the one with the
        // newer layer id (or, before AE 22, the one above the original).
        var other = seen[sid];
        var copy = layer;
        try {
          if (typeof layer.id === 'number' && typeof other.id === 'number' && other.id > layer.id) copy = other;
        } catch (e3) {}
        try { copy.comment = stripStamps(copy.comment); } catch (e4) {}
        if (copy !== layer) {
          for (var j = 0; j < layers.length; j++) {
            if (layers[j].sid === sid) {
              layers[j] = readLayer(other, sidOf(other), force && force[sid]);
              break;
            }
          }
        } else {
          sid = sidOf(layer);
        }
      }
      seen[sid] = layer;
      var isSel = layer.selected;
      if (all || isSel || (deep && deep[sid]) || (count > 0 && i > from && i <= from + count)) {
        var full = readLayer(layer, sid, force && (force[sid] || force['*']));
        liteCache[cacheKey + sid] = attrSig(full.a);
        layers.push(full);
      } else {
        var la = layerAttrs(layer);
        var sig = attrSig(la);
        if (!opts.resend && liteCache[cacheKey + sid] === sig) {
          layers.push({ sid: sid, lite: 1 });
        } else {
          liteCache[cacheKey + sid] = sig;
          layers.push({ sid: sid, lite: 1, a: la });
        }
      }
      if (isSel) sel.push(sid);
    }
    return { id: compKey(comp), s: s, layers: layers, sel: sel, full: all ? 1 : 0 };
  }

  // ------------------------------------------------------------------- apply

  function splitKey(key) {
    var hash = key.lastIndexOf('#');
    if (hash < 0) return { mn: key, n: 1 };
    var n = parseInt(key.substring(hash + 1), 10);
    if (!(n > 0)) return { mn: key, n: 1 };
    return { mn: key.substring(0, hash), n: n };
  }

  function childByKey(group, key, create) {
    var want = splitKey(key);
    var count = 0;
    var n = group.numProperties;
    for (var i = 1; i <= n; i++) {
      var p = group.property(i);
      if (p.matchName !== want.mn) continue;
      count++;
      if (count === want.n) return p;
    }
    if (!create) return null;
    var added = null;
    while (count < want.n) {
      if (!group.canAddProperty(want.mn)) return null;
      added = group.addProperty(want.mn);
      count++;
    }
    return added;
  }

  function resolve(layer, path, create) {
    var parts = String(path).split('/');
    var node = layer;
    for (var i = 0; i < parts.length; i++) {
      node = childByKey(node, parts[i], create);
      if (!node) return null;
    }
    return node;
  }

  function fitDims(cur, value) {
    if (typeof cur === 'number') {
      if (typeof value === 'number') return value;
      if (value instanceof Array) return value[0];
      return Number(value);
    }
    if (cur instanceof Array) {
      if (!(value instanceof Array)) {
        var fill = [];
        for (var j = 0; j < cur.length; j++) fill.push(Number(value));
        return fill;
      }
      var out = [];
      for (var i = 0; i < cur.length; i++) out.push(i < value.length ? value[i] : cur[i]);
      return out;
    }
    return value;
  }

  function toValue(p, v, pvt) {
    var i;
    if (pvt === PVT_SHAPE) {
      var sh = new Shape();
      sh.vertices = v.v || [];
      sh.inTangents = v.i || [];
      sh.outTangents = v.o || [];
      sh.closed = v.c ? true : false;
      return sh;
    }
    if (pvt === PVT_TEXT) {
      var doc = p.value;
      for (i = 0; i < TEXT_FIELDS.length; i++) {
        var f = TEXT_FIELDS[i];
        if (v[f] === undefined) continue;
        try { doc[f] = v[f]; } catch (e) {}
      }
      try { if (v.boxTextSize && doc.boxText) doc.boxTextSize = v.boxTextSize; } catch (e2) {}
      return doc;
    }
    if (pvt === PVT_MARKER) {
      var mk = new MarkerValue(v.comment || '');
      for (i = 1; i < MARKER_FIELDS.length; i++) {
        if (v[MARKER_FIELDS[i]] === undefined) continue;
        try { mk[MARKER_FIELDS[i]] = v[MARKER_FIELDS[i]]; } catch (e3) {}
      }
      return mk;
    }
    var cur;
    try { cur = p.value; } catch (e4) { return v; }
    return fitDims(cur, v);
  }

  function buildEase(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) out.push(new KeyframeEase(Number(list[i][0]) || 0, Math.max(0.1, Number(list[i][1]) || 0.1)));
    return out;
  }

  function hasKeyAt(keys, t) {
    for (var i = 0; i < keys.length; i++) {
      if (Math.abs(keys[i].t - t) < 1e-4) return true;
    }
    return false;
  }

  function applyRec(p, rec) {
    var pvt = p.propertyValueType;
    var i;
    try {
      if (p.isSeparationLeader) {
        if (rec.sep) {
          if (!p.dimensionsSeparated) p.dimensionsSeparated = true;
          return;
        }
        if (p.dimensionsSeparated) p.dimensionsSeparated = false;
      }
    } catch (e0) {}
    if (rec.big) return;
    try {
      if (p.canSetExpression) {
        var want = rec.x || '';
        if (p.expression !== want) p.expression = want;
        if (want) p.expressionEnabled = rec.xo ? true : false;
      }
    } catch (e1) {}
    if (rec.k) {
      for (i = p.numKeys; i >= 1; i--) {
        if (!hasKeyAt(rec.k, p.keyTime(i))) p.removeKey(i);
      }
      for (i = 0; i < rec.k.length; i++) p.setValueAtTime(rec.k[i].t, toValue(p, rec.k[i].v, pvt));
      if (pvt === PVT_MARKER) return;
      for (i = 0; i < rec.k.length; i++) {
        var key = rec.k[i];
        var idx = p.nearestKeyIndex(key.t);
        var f = key.f || [0, 0, 0, 0, 0];
        if (key.i) {
          try { p.setInterpolationTypeAtKey(idx, key.i[0], key.i[1]); } catch (e2) {}
        }
        if (key.e) {
          try { p.setTemporalEaseAtKey(idx, buildEase(key.e[0]), buildEase(key.e[1])); } catch (e3) {}
        }
        try {
          p.setTemporalContinuousAtKey(idx, f[1] ? true : false);
          p.setTemporalAutoBezierAtKey(idx, f[0] ? true : false);
        } catch (e4) {}
        if (pvt === PVT_2DS || pvt === PVT_3DS) {
          try {
            if (key.s) p.setSpatialTangentsAtKey(idx, key.s[0], key.s[1]);
            p.setSpatialContinuousAtKey(idx, f[3] ? true : false);
            p.setSpatialAutoBezierAtKey(idx, f[2] ? true : false);
            p.setRovingAtKey(idx, f[4] ? true : false);
          } catch (e5) {}
        }
      }
      return;
    }
    if (rec.v !== undefined) {
      for (i = p.numKeys; i >= 1; i--) p.removeKey(i);
      p.setValue(toValue(p, rec.v, pvt));
    }
  }

  function applyPath(layer, path, rec) {
    var at = path.lastIndexOf('@');
    var suffix = at > 0 ? path.substring(at) : '';
    if (suffix === '@on' || suffix === '@name' || suffix === '@mask') {
      var group = resolve(layer, path.substring(0, at), false);
      if (!group) return 'group not found: ' + path;
      if (suffix === '@on') {
        if (group.enabled !== (rec.v ? true : false)) group.enabled = rec.v ? true : false;
      } else if (suffix === '@name') {
        if (group.name !== rec.v) group.name = String(rec.v);
      } else {
        group.maskMode = Number(rec.v[0]);
        group.inverted = rec.v[1] ? true : false;
        group.maskMotionBlur = Number(rec.v[2]);
        try { group.rotoBezier = rec.v[3] ? true : false; } catch (eR) {}
      }
      return '';
    }
    var p = resolve(layer, path, true);
    if (!p) return 'property not found: ' + path;
    applyRec(p, rec);
    return '';
  }

  // Make an indexed group hold exactly the wanted children, in order.
  function ensureChildren(group, want) {
    var have = childKeys(group);
    var i;
    var same = have.length === want.length;
    for (i = 0; same && i < want.length; i++) same = have[i] === want[i];
    if (same) return;
    for (i = group.numProperties; i >= 1; i--) {
      try { group.property(i).remove(); } catch (e) {}
    }
    for (i = 0; i < want.length; i++) {
      var mn = splitKey(want[i]).mn;
      if (group.canAddProperty(mn)) group.addProperty(mn);
    }
  }

  function depthOf(path) {
    return path === '' ? 0 : path.split('/').length;
  }

  // Apply a subtree (leaf records + indexed-group child lists). The prefix is
  // prepended to every relative path.
  function applyTree(layer, prefix, p, g, fresh) {
    var fails = 0;
    var paths = [];
    var path;
    for (path in g) {
      if (g.hasOwnProperty(path)) paths.push(path);
    }
    paths.sort(function (a, b) { return depthOf(a) - depthOf(b); });
    for (var i = 0; i < paths.length; i++) {
      var full = prefix ? (paths[i] ? prefix + '/' + paths[i] : prefix) : paths[i];
      try {
        var group = full ? resolve(layer, full, true) : layer;
        if (group && group.propertyType === PT_INDEXED) ensureChildren(group, g[paths[i]]);
      } catch (e) { fails++; }
    }
    for (path in p) {
      if (!p.hasOwnProperty(path)) continue;
      // A layer just created already holds the defaults of its built-in groups
      // (effect defaults are not skipped: they can differ between machines).
      if (fresh && p[path].m === 0 && BUILT_IN[path.substring(0, path.indexOf('/'))]) continue;
      var target = prefix ? (path.charAt(0) === '@' ? prefix + path : prefix + '/' + path) : path;
      try {
        if (applyPath(layer, target, p[path])) fails++;
      } catch (e2) { fails++; }
    }
    return fails;
  }

  function setAttr(comp, layer, name, value) {
    var i;
    if (name === 'name') { if (layer.name !== value) layer.name = String(value); return ''; }
    if (name === 'comment') { var st = readStamp(layer.comment); layer.comment = String(value || '') + (st ? (value ? ' ' : '') + STAMP + st : ''); return ''; }
    if (name === 'parent') {
      if (!value) { layer.parent = null; return ''; }
      var parentLayer = findLayer(comp, String(value));
      if (!parentLayer) return 'parent not found';
      layer.parent = parentLayer;
      return '';
    }
    if (name === 'matte') {
      var s = String(value || '');
      var colon = s.indexOf(':');
      if (colon > 0) {
        var matteLayer = findLayer(comp, s.substring(0, colon));
        if (!matteLayer) return 'matte layer not found';
        layer.setTrackMatte(matteLayer, Number(s.substring(colon + 1)));
      } else if (s === '') {
        try { layer.removeTrackMatte(); } catch (e) {}
      } else {
        layer.trackMatteType = Number(s);
      }
      return '';
    }
    for (i = 0; i < BOOL_ATTRS.length; i++) {
      if (BOOL_ATTRS[i] === name) { layer[name] = value ? true : false; return ''; }
    }
    for (i = 0; i < NUM_ATTRS.length; i++) {
      if (NUM_ATTRS[i] === name) { layer[name] = Number(value); return ''; }
    }
    for (i = 0; i < ENUM_ATTRS.length; i++) {
      if (ENUM_ATTRS[i] === name) { layer[name] = Number(value); return ''; }
    }
    return 'unknown attribute ' + name;
  }

  var ATTR_ORDER = [
    'name', 'comment', 'threeDLayer', 'adjustmentLayer', 'guideLayer', 'lightType', 'startTime', 'stretch',
    'inPoint', 'outPoint', 'enabled', 'audioEnabled', 'motionBlur', 'collapseTransformation', 'effectsActive',
    'timeRemapEnabled', 'preserveTransparency', 'label', 'blendingMode', 'quality', 'samplingQuality',
    'frameBlendingType', 'autoOrient'
  ];

  function findFootage(src) {
    var i;
    var item;
    if (src.path) {
      for (i = 1; i <= app.project.numItems; i++) {
        item = app.project.item(i);
        if (item instanceof FootageItem && item.file && item.file.fsName === src.path) return item;
      }
    }
    if (src.name) {
      for (i = 1; i <= app.project.numItems; i++) {
        item = app.project.item(i);
        if (item instanceof FootageItem && item.name === src.name && !(item.mainSource instanceof SolidSource)) return item;
      }
    }
    if (src.path) {
      try {
        var f = new File(src.path);
        if (f.exists) return app.project.importFile(new ImportOptions(f));
      } catch (e) {}
    }
    return null;
  }

  function placeAfter(comp, layer, afterSid) {
    if (!afterSid) {
      if (layer.index !== 1) layer.moveToBeginning();
      return;
    }
    var anchor = findLayer(comp, afterSid);
    if (!anchor || anchor === layer) return;
    if (layer.index !== anchor.index + 1) layer.moveAfter(anchor);
  }

  function addLayer(comp, op) {
    var d = op.value ? op.value.layer : null;
    if (!d) return 'missing layer data';
    var sid = op.target.layer;
    var layer = findLayer(comp, sid);
    var a = d.a || {};
    var name = a.name ? String(a.name) : 'Layer';
    var src = d.src || {};
    var isNew = !layer;
    if (!layer) {
      if (d.kind === 'solid') {
        var color = src.color && src.color.length === 3 ? src.color : [1, 1, 1];
        layer = comp.layers.addSolid(color, src.name || name, Number(src.w) || comp.width, Number(src.h) || comp.height, Number(src.pa) || 1, comp.duration);
      } else if (d.kind === 'null') {
        layer = comp.layers.addNull(comp.duration);
        try { if (src.name) layer.source.name = String(src.name); } catch (eN) {}
      } else if (d.kind === 'text') {
        layer = d.box ? comp.layers.addBoxText([400, 200]) : comp.layers.addText('');
      } else if (d.kind === 'shape') {
        layer = comp.layers.addShape();
      } else if (d.kind === 'camera') {
        layer = comp.layers.addCamera(name, [comp.width / 2, comp.height / 2]);
      } else if (d.kind === 'light') {
        layer = comp.layers.addLight(name, [comp.width / 2, comp.height / 2]);
      } else if (d.kind === 'comp') {
        var srcComp = findComp(src.comp);
        if (!srcComp) return 'precomp not found: ' + src.comp;
        layer = comp.layers.add(srcComp);
      } else if (d.kind === 'footage') {
        var footage = findFootage(src);
        if (!footage) return 'media not found: ' + (src.name || '?');
        layer = comp.layers.add(footage);
      } else {
        return 'unsupported layer kind ' + d.kind;
      }
      writeStamp(layer, stampFor(sid));
    }
    var i;
    for (i = 0; i < ATTR_ORDER.length; i++) {
      if (a[ATTR_ORDER[i]] === undefined) continue;
      try { setAttr(comp, layer, ATTR_ORDER[i], a[ATTR_ORDER[i]]); } catch (e) {}
    }
    applyTree(layer, '', d.p || {}, d.g || {}, isNew);
    try { if (a.parent !== undefined) setAttr(comp, layer, 'parent', a.parent); } catch (e2) {}
    try { if (a.matte !== undefined) setAttr(comp, layer, 'matte', a.matte); } catch (e3) {}
    // Parenting re-bases the transform, so re-apply it afterwards.
    if (a.parent) {
      var tp = {};
      for (var path in d.p) {
        if (d.p.hasOwnProperty(path) && path.indexOf('ADBE Transform Group/') === 0) tp[path] = d.p[path];
      }
      applyTree(layer, '', tp, {});
    }
    placeAfter(comp, layer, op.value.after);
    return '';
  }

  function setCompField(comp, name, value) {
    var i;
    if (name === 'bgColor') { comp.bgColor = value; return ''; }
    if (name === 'markers') {
      var mk = comp.markerProperty;
      for (i = mk.numKeys; i >= 1; i--) mk.removeKey(i);
      for (i = 0; i < value.length; i++) mk.setValueAtTime(value[i].t, toValue(mk, value[i].v, PVT_MARKER));
      return '';
    }
    if (name === 'width' || name === 'height') { comp[name] = Math.max(1, Math.round(Number(value))); return ''; }
    if (name === 'motionBlur' || name === 'frameBlending') { comp[name] = value ? true : false; return ''; }
    if (name === 'name') { comp.name = String(value); return ''; }
    for (i = 0; i < COMP_FIELDS.length; i++) {
      if (COMP_FIELDS[i] === name) { comp[name] = Number(value); return ''; }
    }
    return 'unknown comp field ' + name;
  }

  function applyOne(op) {
    if (!op || !op.target || !op.kind) return 'malformed op';
    if (op.kind === 'iadd' || op.kind === 'irm' || op.kind === 'iset') return applyItemOp(op);
    var comp = findComp(op.target.comp);
    if (!comp) return 'comp not found';
    if (op.kind === 'comp') return setCompField(comp, String(op.path), op.value);
    if (op.kind === 'add') return addLayer(comp, op);
    var layer = findLayer(comp, op.target.layer);
    if (!layer) return op.kind === 'remove' ? '' : 'layer not found';
    var wasLocked = false;
    try { wasLocked = layer.locked; } catch (e0) {}
    if (wasLocked) layer.locked = false;
    var err = '';
    try {
      if (op.kind === 'remove') {
        layer.remove();
        return '';
      } else if (op.kind === 'reorder') {
        placeAfter(comp, layer, op.value ? op.value.after : '');
      } else if (op.kind === 'attr') {
        err = setAttr(comp, layer, String(op.path), op.value);
      } else if (op.kind === 'prop') {
        err = applyPath(layer, String(op.path), op.value || {});
      } else if (op.kind === 'grm') {
        var doomed = resolve(layer, String(op.path), false);
        if (doomed) doomed.remove();
      } else if (op.kind === 'gadd') {
        var parent = op.path ? resolve(layer, String(op.path), true) : layer;
        if (!parent) {
          err = 'group not found: ' + op.path;
        } else {
          var v = op.value || {};
          var childPath = (op.path ? op.path + '/' : '') + v.key;
          var child = resolve(layer, childPath, false);
          if (!child) {
            var mn = splitKey(String(v.key)).mn;
            if (!parent.canAddProperty(mn)) {
              err = 'unavailable: ' + mn;
            } else {
              child = parent.addProperty(mn);
              var at = Number(v.at);
              if (at >= 1 && at < parent.numProperties) {
                try { child.moveTo(at); } catch (e1) {}
              }
            }
          }
          if (!err) applyTree(layer, childPath, v.p || {}, v.g || {}, false);
        }
      } else if (op.kind === 'gmv') {
        var mover = resolve(layer, String(op.path), false);
        if (!mover) err = 'not found: ' + op.path;
        else if (mover.propertyIndex !== Number(op.index)) mover.moveTo(Number(op.index));
      } else {
        err = 'unsupported op ' + op.kind;
      }
    } finally {
      if (wasLocked) {
        try { layer.locked = true; } catch (e2) {}
      }
    }
    return err;
  }

  function applyAll(ops) {
    var results = [];
    if (!ops || !ops.length) return results;
    var restore = [];
    var active = null;
    var i;
    try {
      active = app.project.activeItem;
      if (active instanceof CompItem) {
        for (i = 1; i <= active.numLayers; i++) {
          if (active.layer(i).selected) restore.push(sidOf(active.layer(i)));
        }
      }
    } catch (e0) {}
    app.beginUndoGroup('Vynk: teammate edit');
    try {
      for (i = 0; i < ops.length; i++) {
        var err;
        try {
          err = applyOne(ops[i]);
        } catch (e) {
          err = 'exception: ' + e.toString() + (e.line !== undefined ? ' @' + e.line : '');
        }
        results.push(err || '');
      }
    } finally {
      app.endUndoGroup();
    }
    try {
      if (active instanceof CompItem) {
        for (i = 1; i <= active.numLayers; i++) {
          var l = active.layer(i);
          var want = false;
          var sid = sidOf(l);
          for (var j = 0; j < restore.length; j++) {
            if (restore[j] === sid) { want = true; break; }
          }
          if (l.selected !== want) {
            var locked = l.locked;
            if (locked) l.locked = false;
            l.selected = want;
            if (locked) l.locked = true;
          }
        }
      }
    } catch (e3) {}
    return results;
  }

  // ------------------------------------------------------------------ public

  function hostInfo() {
    var info = { app: app.version, projectName: null, projectPath: null };
    try {
      if (app.project && app.project.file) {
        info.projectName = app.project.file.name;
        info.projectPath = app.project.file.fsName;
      }
    } catch (e) {}
    return info;
  }

  // One round trip: apply remote ops, stamp newly created local layers, then
  // snapshot. Doing all three in a single call makes the snapshot reflect the
  // applied ops exactly, which is what lets the panel adopt it as the baseline.
  function cycle(reqStr) {
    var t0 = new Date().getTime();
    var req;
    try {
      req = JSON.parse(reqStr);
    } catch (e) {
      return JSON.stringify({ error: 'bad request' });
    }
    var out = { r: [], snaps: [], active: null, items: [], host: hostInfo() };
    itemCache = null;
    // The project revision counts every edit and undo (not selection or time
    // changes). If it has not moved and there is nothing to apply, nothing
    // needs reading at all.
    var revBefore = -1;
    try { revBefore = app.project.revision; } catch (eRev) { revBefore = -1; }
    out.revBefore = revBefore;
    if ((!req.ops || !req.ops.length) && !req.stamp && !req.must && revBefore >= 0 && revBefore === req.rev) {
      out.same = 1;
      out.rev = revBefore;
      try {
        var quiet = app.project.activeItem;
        if (!(quiet instanceof CompItem) && req.active && req.active.c) quiet = findComp(req.active.c);
        if (quiet instanceof CompItem) {
          out.active = sidOf(quiet);
          out.aid = compKey(quiet);
          out.sel = [];
          for (var qi = 1; qi <= quiet.numLayers; qi++) {
            if (quiet.layer(qi).selected) out.sel.push(sidOf(quiet.layer(qi)));
          }
        }
      } catch (eQuiet) {}
      out.ms = new Date().getTime() - t0;
      return JSON.stringify(out);
    }
    try {
      var i;
      if (req.stamp) {
        var si = req.stamp.items || [];
        for (i = 0; i < si.length; i++) {
          var stampItem = findItem(si[i][0]);
          if (stampItem) writeStamp(stampItem, si[i][1]);
        }
        if (si.length) itemCache = null;
        var sl = req.stamp.layers || [];
        for (i = 0; i < sl.length; i++) {
          var stampComp = findComp(sl[i][0]);
          var stampLayer = stampComp ? findLayer(stampComp, sl[i][1]) : null;
          if (stampLayer) writeStamp(stampLayer, sl[i][2]);
        }
      }
      out.r = applyAll(req.ops);
      itemCache = null;
      out.items = readItems();
      var done = {};
      var item = null;
      try { item = app.project ? app.project.activeItem : null; } catch (e2) {}
      var activeOpts = req.active || {};
      activeOpts.force = req.force || null;
      if (item instanceof CompItem) {
        out.active = sidOf(item);
        done[out.active] = 1;
        out.snaps.push(readComp(item, activeOpts));
      } else if (activeOpts.c) {
        // activeItem is empty whenever focus is in a panel that is not a comp
        // (Project, Effect Controls, this panel...). The user is still working
        // in the comp they were last in, so keep reading it the same way.
        var lastComp = findComp(activeOpts.c);
        if (lastComp) {
          out.active = activeOpts.c;
          done[activeOpts.c] = 1;
          out.snaps.push(readComp(lastComp, activeOpts));
        }
      }
      var read = req.read || [];
      for (i = 0; i < read.length; i++) {
        if (!read[i] || done[read[i].c]) continue;
        done[read[i].c] = 1;
        var extra = findComp(read[i].c);
        if (!extra) continue;
        read[i].force = req.force || null;
        out.snaps.push(readComp(extra, read[i]));
      }
    } catch (e3) {
      out.error = e3.toString() + (e3.line !== undefined ? ' @' + e3.line : '');
    }
    try { out.rev = app.project.revision; } catch (eRev2) { out.rev = -1; }
    out.ms = new Date().getTime() - t0;
    return JSON.stringify(out);
  }

  return { cycle: cycle, version: 2 };
})();
'vynkSync ' + $.global.vynkSync.version;
