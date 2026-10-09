if (typeof COLLAB_JSON_POLYFILLED === 'undefined') { COLLAB_JSON_POLYFILLED = false; }

if (typeof JSON === 'undefined' || typeof JSON.stringify === 'undefined' || typeof JSON.parse === 'undefined') {
  COLLAB_JSON_POLYFILLED = true;
  if (typeof JSON === 'undefined') { JSON = {}; }

  var collabQuote = function (s) {
    var out = '"';
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      var code = s.charCodeAt(i);
      if (c === '"') out += '\\"';
      else if (c === '\\') out += '\\\\';
      else if (c === '\n') out += '\\n';
      else if (c === '\r') out += '\\r';
      else if (c === '\t') out += '\\t';
      else if (code < 32) {
        var hex = code.toString(16);
        out += '\\u0000'.substring(0, 6 - hex.length) + hex;
      } else {
        out += c;
      }
    }
    return out + '"';
  };

  var collabIsArray = function (value) {
    return Object.prototype.toString.call(value) === '[object Array]';
  };

  var collabStringify = function (value) {
    if (value === null) return 'null';
    var t = typeof value;
    if (t === 'number') return isFinite(value) ? String(value) : 'null';
    if (t === 'boolean') return value ? 'true' : 'false';
    if (t === 'string') return collabQuote(value);
    if (t === 'undefined' || t === 'function') return undefined;
    var i;
    if (collabIsArray(value)) {
      var parts = [];
      for (i = 0; i < value.length; i++) {
        var item = collabStringify(value[i]);
        parts.push(item === undefined ? 'null' : item);
      }
      return '[' + parts.join(',') + ']';
    }
    if (t === 'object') {
      var out = [];
      for (var key in value) {
        if (!value.hasOwnProperty(key)) continue;
        var member = value[key];
        var mt = typeof member;
        if (mt === 'undefined' || mt === 'function') continue;
        var encoded = collabStringify(member);
        if (encoded === undefined) continue;
        out.push(collabQuote(key) + ':' + encoded);
      }
      return '{' + out.join(',') + '}';
    }
    return undefined;
  };

  var collabParse = function (text) {
    var pos = 0;
    var len = text.length;

    function fail(msg) { throw new Error(msg + ' at ' + pos); }

    function skipWsT() {
      while (pos < len) {
        var c = text.charAt(pos);
        if (c === ' ' || c === '\t' || c === '\n' || c === '\r') pos++;
        else break;
      }
    }

    function parseString() {
      var out = '';
      pos++;
      while (pos < len) {
        var c = text.charAt(pos);
        if (c === '"') { pos++; return out; }
        if (c === '\\') {
          pos++;
          var esc = text.charAt(pos);
          if (esc === '"') out += '"';
          else if (esc === '\\') out += '\\';
          else if (esc === '/') out += '/';
          else if (esc === 'b') out += '\b';
          else if (esc === 'f') out += '\f';
          else if (esc === 'n') out += '\n';
          else if (esc === 'r') out += '\r';
          else if (esc === 't') out += '\t';
          else if (esc === 'u') {
            out += String.fromCharCode(parseInt(text.substr(pos + 1, 4), 16));
            pos += 4;
          } else {
            fail('bad escape');
          }
          pos++;
        } else {
          out += c;
          pos++;
        }
      }
      fail('unterminated string');
    }

    function parseNumber() {
      var start = pos;
      if (text.charAt(pos) === '-') pos++;
      while (pos < len && text.charAt(pos) >= '0' && text.charAt(pos) <= '9') pos++;
      if (text.charAt(pos) === '.') {
        pos++;
        while (pos < len && text.charAt(pos) >= '0' && text.charAt(pos) <= '9') pos++;
      }
      if (text.charAt(pos) === 'e' || text.charAt(pos) === 'E') {
        pos++;
        if (text.charAt(pos) === '+' || text.charAt(pos) === '-') pos++;
        while (pos < len && text.charAt(pos) >= '0' && text.charAt(pos) <= '9') pos++;
      }
      return parseFloat(text.substring(start, pos));
    }

    function parseObject() {
      var obj = {};
      pos++;
      skipWsT();
      if (text.charAt(pos) === '}') { pos++; return obj; }
      for (;;) {
        skipWsT();
        var key = parseString();
        skipWsT();
        if (text.charAt(pos) !== ':') fail('expected colon');
        pos++;
        obj[key] = parseValue();
        skipWsT();
        var c = text.charAt(pos);
        if (c === ',') { pos++; continue; }
        if (c === '}') { pos++; return obj; }
        fail('expected comma or brace');
      }
    }

    function parseArray() {
      var arr = [];
      pos++;
      skipWsT();
      if (text.charAt(pos) === ']') { pos++; return arr; }
      for (;;) {
        arr.push(parseValue());
        skipWsT();
        var c = text.charAt(pos);
        if (c === ',') { pos++; continue; }
        if (c === ']') { pos++; return arr; }
        fail('expected comma or bracket');
      }
    }

    function parseValue() {
      skipWsT();
      var c = text.charAt(pos);
      if (c === '"') return parseString();
      if (c === '{') return parseObject();
      if (c === '[') return parseArray();
      if (c === '-' || (c >= '0' && c <= '9')) return parseNumber();
      if (text.substr(pos, 4) === 'true') { pos += 4; return true; }
      if (text.substr(pos, 5) === 'false') { pos += 5; return false; }
      if (text.substr(pos, 4) === 'null') { pos += 4; return null; }
      return fail('unexpected token');
    }

    var result = parseValue();
    skipWsT();
    if (pos < len) fail('trailing characters');
    return result;
  };

  if (typeof JSON.stringify !== 'function') JSON.stringify = collabStringify;
  if (typeof JSON.parse !== 'function') JSON.parse = collabParse;
}

var collab = (function () {
  var STAMP_PREFIX = '#c:';
  var STAMP_LEN = 12;
  var MAX_KEYS_PER_PROP = 400;
  var MAX_LAYERS_FOR_KEYS = 150;
  var MAX_TOTAL_KEYS = 4000;

  var PATH_SPECS = {
    'transform.position': ['ADBE Transform Group', 'ADBE Position'],
    'transform.anchor': ['ADBE Transform Group', 'ADBE Anchor Point'],
    'transform.scale': ['ADBE Transform Group', 'ADBE Scale'],
    'transform.rotation': ['ADBE Transform Group', 'ADBE Rotate Z'],
    'transform.opacity': ['ADBE Transform Group', 'ADBE Opacity']
  };

  function randHex(len) {
    var chars = '0123456789abcdef';
    var s = '';
    for (var i = 0; i < len; i++) s += chars.charAt(Math.floor(Math.random() * 16));
    return s;
  }

  function readStamp(comment) {
    if (!comment) return null;
    var idx = comment.indexOf(STAMP_PREFIX);
    if (idx < 0) return null;
    var out = comment.substr(idx + STAMP_PREFIX.length, STAMP_LEN);
    return out.length === STAMP_LEN ? out : null;
  }

  function layerSid(layer) {
    var stamp = readStamp(layer.comment);
    if (stamp) return 'st' + stamp;
    var id;
    try { id = layer.id; } catch (e) { id = null; }
    if (typeof id === 'number') return 'id' + id;
    var fresh = randHex(STAMP_LEN);
    try {
      layer.comment = (layer.comment ? layer.comment + ' ' : '') + STAMP_PREFIX + fresh;
    } catch (e2) {}
    return 'st' + fresh;
  }

  function avKind(layer) {
    try {
      if (!(layer instanceof AVLayer)) return '';
      var src = layer.source;
      if (!src) return '';
      if (src.mainSource instanceof SolidSource) {
        if (layer.adjustmentLayer) return 'adjustment';
        if (!layer.hasVideo) return 'null';
        return 'solid';
      }
      if (src instanceof CompItem) return 'comp';
      if (src instanceof FootageItem) {
        if (src.mainSource instanceof PlaceholderSource) return 'placeholder';
        return 'footage';
      }
      return 'other';
    } catch (e) {
      return '';
    }
  }

  function solidInfoOf(layer) {
    try {
      var src = layer.source;
      if (!src || !(src.mainSource instanceof SolidSource)) return null;
      var c = src.mainSource.color;
      return {
        color: [c[0], c[1], c[2]],
        width: src.width,
        height: src.height,
        duration: src.duration,
        pixelAspect: src.pixelAspect
      };
    } catch (e) {
      return null;
    }
  }

  function splitKey(key) {
    var idx = key.indexOf('|');
    if (idx < 0) return { id: '', name: key };
    return { id: key.substring(0, idx), name: key.substring(idx + 1) };
  }

  function compKey(item) {
    var id = '';
    try { id = String(item.id); } catch (e) { id = ''; }
    return id + '|' + item.name;
  }

  function findComp(key) {
    if (!app.project) return null;
    var want = splitKey(key);
    for (var i = 1; i <= app.project.numItems; i++) {
      var item = app.project.item(i);
      if (!(item instanceof CompItem)) continue;
      var id = '';
      try { id = String(item.id); } catch (e) {}
      if (want.id && id === want.id) return item;
      if (!want.id && item.name === want.name) return item;
    }
    return null;
  }

  function findLayer(comp, sid) {
    for (var i = 1; i <= comp.numLayers; i++) {
      var layer = comp.layer(i);
      if (layerSid(layer) === sid) return layer;
    }
    return null;
  }

  function layerType(layer) {
    try {
      if (layer instanceof TextLayer) return 'text';
      if (layer instanceof ShapeLayer) return 'shape';
      if (layer instanceof CameraLayer) return 'camera';
      if (layer instanceof LightLayer) return 'light';
      if (layer instanceof AVLayer) return 'av';
      if (layer instanceof Layer) return 'other';
    } catch (e) {}
    return 'unknown';
  }

  function normPoints(points) {
    var out = [];
    if (!points) return out;
    for (var i = 0; i < points.length; i++) {
      var pt = points[i];
      out.push([pt[0], pt[1]]);
    }
    return out;
  }

  function normShape(value) {
    return {
      vertices: normPoints(value.vertices),
      inTangents: normPoints(value.inTangents),
      outTangents: normPoints(value.outTangents),
      closed: value.closed === true
    };
  }

  function normVal(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return value;
    if (typeof value === 'string' || typeof value === 'boolean') return value;
    if (value.vertices !== undefined) return normShape(value);
    var out = [];
    for (var i = 0; i < value.length; i++) out.push(value[i]);
    return out;
  }

  function normNums(arr) {
    var out = [];
    if (!arr) return out;
    for (var i = 0; i < arr.length; i++) out.push(arr[i]);
    return out;
  }

  function normEase(easeList) {
    var out = [];
    if (!easeList) return out;
    for (var i = 0; i < easeList.length; i++) {
      var e = easeList[i];
      out.push([e.speed, e.influence]);
    }
    return out;
  }

  function buildEase(list) {
    if (!list || !list.length) return null;
    var out = [];
    for (var i = 0; i < list.length; i++) {
      out.push(new KeyframeEase(Number(list[i][0]) || 0, Number(list[i][1]) || 0));
    }
    return out;
  }

  function readProp(prop, budget) {
    var out = { numKeys: 0 };
    if (!prop) {
      out.unsupported = true;
      return out;
    }
    try {
      out.value = normVal(prop.value);
    } catch (e) {
      out.unsupported = true;
      return out;
    }
    try {
      var exprText = prop.expression;
      if (exprText && exprText.length > 0) {
        out.expr = String(exprText);
        out.exprOn = prop.expressionEnabled === true;
        out.hasExpr = true;
      }
    } catch (e2) {}
    try {
      out.numKeys = prop.numKeys;
      if (prop.numKeys > 0) {
        if (!budget.allowKeys || prop.numKeys > MAX_KEYS_PER_PROP || budget.used + prop.numKeys > MAX_TOTAL_KEYS) {
          out.keysOmitted = true;
          budget.omitted = true;
        } else {
          var keys = [];
          for (var i = 1; i <= prop.numKeys; i++) {
            var key = { t: prop.keyTime(i), v: normVal(prop.keyValue(i)) };
            try {
              key.inT = prop.keyInInterpolationType(i);
              key.outT = prop.keyOutInterpolationType(i);
            } catch (e3) {}
            var inEase = [];
            var outEase = [];
            var inSp = [];
            var outSp = [];
            try { inEase = normEase(prop.keyInTemporalEase(i)); } catch (e3b) {}
            try { outEase = normEase(prop.keyOutTemporalEase(i)); } catch (e3c) {}
            try { inSp = normNums(prop.keyInSpatialTangent(i)); } catch (e3d) {}
            try { outSp = normNums(prop.keyOutSpatialTangent(i)); } catch (e3e) {}
            key.inEase = inEase;
            key.outEase = outEase;
            key.inSp = inSp;
            key.outSp = outSp;
            keys.push(key);
          }
          budget.used += prop.numKeys;
          out.keys = keys;
        }
      }
    } catch (e4) {}
    return out;
  }

  function sourceInfoOf(layer) {
    try {
      var src = layer.source;
      if (!src || !(src instanceof FootageItem)) return null;
      return {
        name: src.name,
        path: src.file ? src.file.fsName : '',
        width: src.width,
        height: src.height,
        duration: src.duration,
        frameRate: src.frameRate,
        pixelAspect: src.pixelAspect
      };
    } catch (e) {
      return null;
    }
  }

  function findFootageByPath(path) {
    if (!path || !app.project) return null;
    for (var i = 1; i <= app.project.numItems; i++) {
      var item = app.project.item(i);
      if (item instanceof FootageItem && item.file && item.file.fsName === path) return item;
    }
    return null;
  }

  function findFootageByName(name) {
    if (!name || !app.project) return null;
    for (var i = 1; i <= app.project.numItems; i++) {
      var item = app.project.item(i);
      if (item instanceof FootageItem && item.name === name) return item;
    }
    return null;
  }

  var MASK_FIELDS = ['name', 'maskMode', 'inverted', 'maskFeather', 'maskOpacity', 'maskExpansion', 'maskMotionBlur'];

  function maskParade(layer) {
    try { return layer.property('ADBE Mask Parade'); } catch (e) { return null; }
  }

  function readMasks(layer, budget) {
    var parade = maskParade(layer);
    if (!parade) return null;
    var num = 0;
    try { num = parade.numProperties; } catch (e2) { return null; }
    if (num === 0) return [];
    var out = [];
    for (var i = 1; i <= num; i++) {
      var mask = null;
      try { mask = parade.property(i); } catch (e3) { continue; }
      if (!mask) continue;
      var entry = { index: i };
      for (var f = 0; f < MASK_FIELDS.length; f++) {
        var field = MASK_FIELDS[f];
        var val = null;
        try {
          val = mask[field];
          if (val && typeof val === 'object' && typeof val.value !== 'undefined') val = val.value;
        } catch (e4) {
          val = null;
        }
        if (val === null || val === undefined) continue;
        entry[field] = val;
      }
      try {
        var pathProp = mask.property('ADBE Mask Shape');
        if (pathProp) entry.path = readProp(pathProp, budget);
      } catch (e5) {}
      out.push(entry);
    }
    return out;
  }

  var TEXT_DOC_FIELDS = ['text', 'font', 'fontSize', 'fillColor', 'strokeColor', 'applyFill', 'applyStroke', 'strokeWidth', 'tracking', 'leading', 'justification', 'baselineShift'];

  function readTextDoc(layer) {
    try {
      if (!(layer instanceof TextLayer)) return null;
      var docProp = layer.property('ADBE Text Properties').property('ADBE Text Document');
      if (!docProp) return null;
      var doc = docProp.value;
      var out = {};
      for (var i = 0; i < TEXT_DOC_FIELDS.length; i++) {
        var field = TEXT_DOC_FIELDS[i];
        var val = null;
        try { val = doc[field]; } catch (e) { continue; }
        if (val === undefined || val === null) continue;
        out[field] = normVal(val);
      }
      return out;
    } catch (e2) {
      return null;
    }
  }

  var MAX_SHAPE_NODES = 400;
  var MAX_SHAPE_PROPS = 1500;

  function shapeRoot(layer) {
    try {
      if (!(layer instanceof ShapeLayer)) return null;
      return layer.property('ADBE Root Vectors Group');
    } catch (e) {
      return null;
    }
  }

  function readShapeTree(group, budget) {
    var nodes = [];
    var n = 0;
    try { n = group.numProperties; } catch (e) { return nodes; }
    for (var i = 1; i <= n; i++) {
      if (budget.nodes <= 0) {
        budget.truncated = true;
        break;
      }
      var prop = null;
      try { prop = group.property(i); } catch (e2) { continue; }
      if (!prop) continue;
      budget.nodes--;
      var node = { mn: '', name: '' };
      try { node.mn = prop.matchName; } catch (e3) {}
      try { node.name = prop.name; } catch (e4) {}
      if (!node.mn) continue;
      var childCount = 0;
      try { childCount = prop.numProperties; } catch (e5) { childCount = 0; }
      if (childCount > 0) {
        node.children = readShapeTree(prop, budget);
      } else {
        node.prop = readProp(prop, budget.keys);
      }
      nodes.push(node);
    }
    return nodes;
  }

  function applySinglePropSpec(prop, spec) {
    if (!prop || !spec) return;
    try {
      if (spec.keys && spec.keys.length > 0) {
        for (var k = 0; k < spec.keys.length; k++) {
          var kv = coerceValue(prop, spec.keys[k].v);
          if (kv !== null) prop.setValueAtTime(spec.keys[k].t, kv);
        }
      } else if (spec.value !== undefined) {
        var v = coerceValue(prop, spec.value);
        if (v !== null) prop.setValue(v);
      }
      if (spec.expr) {
        prop.expression = String(spec.expr);
        if (spec.exprOn !== false) prop.expressionEnabled = true;
      }
    } catch (e) {}
  }

  function buildShapeTree(group, nodes, budget) {
    if (!nodes) return;
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (!node || !node.mn) continue;
      if (budget.remaining <= 0) {
        budget.truncated = true;
        return;
      }
      var prop = null;
      try { prop = group.addProperty(node.mn); } catch (e) { prop = null; }
      if (!prop) {
        budget.failed++;
        continue;
      }
      budget.remaining--;
      if (node.name) {
        try { prop.name = String(node.name); } catch (e2) {}
      }
      if (node.children && node.children.length > 0) {
        buildShapeTree(prop, node.children, budget);
      } else if (node.prop) {
        applySinglePropSpec(prop, node.prop);
      }
    }
  }

  function clearShapeContents(group) {
    if (!group) return;
    var n = 0;
    try { n = group.numProperties; } catch (e) { return; }
    for (var i = n; i >= 1; i--) {
      var prop = null;
      try { prop = group.property(i); } catch (e2) { prop = null; }
      if (!prop) continue;
      try { prop.remove(); } catch (e3) {}
    }
  }

  function readLayerShape(layer) {
    var root = shapeRoot(layer);
    if (!root) return null;
    var budget = {
      nodes: MAX_SHAPE_NODES,
      props: MAX_SHAPE_PROPS,
      keys: { allowKeys: false, used: 0, omitted: false },
      truncated: false
    };
    return { tree: readShapeTree(root, budget), truncated: budget.truncated };
  }

  function getLayerShape(compKeyStr, sid) {
    var comp = findComp(compKeyStr);
    if (!comp) return 'null';
    var layer = findLayer(comp, sid);
    if (!layer) return 'null';
    var shape = readLayerShape(layer);
    if (!shape) return 'null';
    return JSON.stringify(shape);
  }

  function getShapeStates() {
    var item = null;
    try { item = app.project ? app.project.activeItem : null; } catch (e) { item = null; }
    if (!item || !(item instanceof CompItem)) return 'null';
    var layers = [];
    for (var i = 1; i <= item.numLayers; i++) {
      var layer = item.layer(i);
      var selected = false;
      try { selected = layer.selected === true; } catch (e2) {}
      if (!selected) continue;
      if (!(layer instanceof ShapeLayer)) continue;
      var shape = readLayerShape(layer);
      if (!shape) continue;
      layers.push({ sid: layerSid(layer), tree: shape.tree, truncated: shape.truncated });
    }
    return JSON.stringify({ comp: { id: compKey(item) }, layers: layers });
  }

  function readTransform(layer, budget) {
    var out = {};
    try {
      var group = layer.property('ADBE Transform Group');
      if (!group) return out;
      out.position = readProp(group.property('ADBE Position'), budget);
      out.anchor = readProp(group.property('ADBE Anchor Point'), budget);
      out.scale = readProp(group.property('ADBE Scale'), budget);
      out.rotation = readProp(group.property('ADBE Rotate Z'), budget);
      out.opacity = readProp(group.property('ADBE Opacity'), budget);
    } catch (e) {}
    return out;
  }

  function getHostInfo() {
    var info = {
      app: app.version,
      buildName: app.buildName,
      projectName: null,
      projectPath: null,
      numItems: 0
    };
    try {
      if (app.project) {
        info.projectName = app.project.file ? app.project.file.name : null;
        info.projectPath = app.project.file ? app.project.file.fsName : null;
        info.numItems = app.project.numItems;
      }
    } catch (e) {}
    return JSON.stringify(info);
  }

  function getActiveCompState(includeText) {
    var wantText = includeText !== false;
    var item = null;
    try { item = app.project ? app.project.activeItem : null; } catch (e) { item = null; }
    if (!item || !(item instanceof CompItem)) return 'null';
    var budget = { allowKeys: item.numLayers <= MAX_LAYERS_FOR_KEYS, used: 0, omitted: false };
    var layers = [];
    var selection = [];
    for (var i = 1; i <= item.numLayers; i++) {
      var layer = item.layer(i);
      var sid = layerSid(layer);
      var entry = {
        sid: sid,
        index: i,
        name: layer.name,
        type: layerType(layer),
        enabled: layer.enabled,
        solo: layer.solo,
        selected: layer.selected,
        locked: layer.locked,
        inPoint: layer.inPoint,
        outPoint: layer.outPoint,
        startTime: layer.startTime,
        comment: layer.comment || ''
      };
      entry.transform = readTransform(layer, budget);
      entry.masks = readMasks(layer, budget);
      entry.avKind = avKind(layer);
      try { entry.parent = layer.parent ? layerSid(layer.parent) : null; } catch (e6) { entry.parent = null; }
      try {
        entry.trkMatte = layer.isTrackMatte === true;
        entry.trkType = Number(layer.trackMatteType) || 0;
      } catch (e8) {
        entry.trkMatte = false;
        entry.trkType = 0;
      }
      try { entry.motionBlur = layer.motionBlur === true; } catch (e9) { entry.motionBlur = false; }
      try { entry.frameBlending = layer.frameBlending === true; } catch (e10) { entry.frameBlending = false; }
      try { entry.frameBlendingType = Number(layer.frameBlendingType) || 0; } catch (e11) { entry.frameBlendingType = 0; }
      var solidInfo = solidInfoOf(layer);
      if (solidInfo) entry.solid = solidInfo;
      if (entry.avKind === 'footage' || entry.avKind === 'placeholder') {
        var sourceInfo = sourceInfoOf(layer);
        if (sourceInfo) entry.source = sourceInfo;
      }
      if (entry.avKind === 'comp') {
        try { entry.sourceComp = compKey(layer.source); } catch (e7) {}
      }
      if (entry.type === 'text') {
        if (wantText) entry.textDoc = readTextDoc(layer);
      }
      layers.push(entry);
      if (layer.selected) selection.push(sid);
    }
    var comp = {
      id: compKey(item),
      name: item.name,
      width: item.width,
      height: item.height,
      duration: item.duration,
      numLayers: item.numLayers,
      frameRate: item.frameRate,
      pixelAspect: item.pixelAspect,
      bgColor: normVal(item.bgColor),
      motionBlur: item.motionBlur === true,
      shutterAngle: item.shutterAngle,
      shutterPhase: item.shutterPhase
    };
    return JSON.stringify({
      comp: comp,
      layers: layers,
      selection: selection,
      hasOmittedKeys: budget.omitted
    });
  }

  function respond(ok, error) {
    return JSON.stringify({ ok: ok, error: error });
  }

  function resolveProp(layer, path) {
    if (path && path.indexOf('mask:') === 0) {
      var maskRest = path.substring(5);
      var maskSlash = maskRest.indexOf('/');
      var maskIdx = parseInt(maskSlash >= 0 ? maskRest.substring(0, maskSlash) : maskRest, 10);
      var maskField = maskSlash >= 0 ? maskRest.substring(maskSlash + 1) : '';
      var parade = maskParade(layer);
      if (!parade) return null;
      var mask = null;
      try { mask = parade.property(maskIdx); } catch (eM) { return null; }
      if (!mask) return null;
      if (maskField === 'path') return mask.property('ADBE Mask Shape');
      if (!maskField) return mask;
      return null;
    }
    if (path && path.indexOf('fx:') === 0) {
      var rest = path.substring(3);
      var slash = rest.indexOf('/');
      var fx = findEffect(layer, slash >= 0 ? rest.substring(0, slash) : rest);
      if (!fx) return null;
      if (slash < 0) return fx;
      return resolvePropPath(fx, rest.substring(slash + 1));
    }
    var spec = PATH_SPECS[path];
    if (!spec) return null;
    var group = layer.property(spec[0]);
    if (!group) return null;
    return group.property(spec[1]);
  }

  function coerceValue(prop, value) {
    var cur;
    try { cur = prop.value; } catch (e) { return value; }
    if (typeof cur === 'number') {
      if (typeof value === 'number') return value;
      if (value && value.length !== undefined) return value[0];
      return Number(value);
    }
    if (!value || value.length === undefined) return null;
    var out = [];
    for (var i = 0; i < cur.length; i++) out.push(i < value.length ? value[i] : cur[i]);
    return out;
  }

  function keyIndexAtTime(prop, time) {
    for (var i = 1; i <= prop.numKeys; i++) {
      if (Math.abs(prop.keyTime(i) - time) < 1e-4) return i;
    }
    return 0;
  }

  function maskInfoFromPath(pathStr) {
    var rest = String(pathStr || '').substring(5);
    var slash = rest.indexOf('/');
    var idx = parseInt(slash >= 0 ? rest.substring(0, slash) : rest, 10);
    var field = slash >= 0 ? rest.substring(slash + 1) : '';
    return { index: idx, field: field };
  }

  function applyMaskSet(layer, op) {
    var info = maskInfoFromPath(op.path);
    var parade = maskParade(layer);
    if (!parade) return respond(false, 'no mask parade');
    var mask = null;
    try { mask = parade.property(info.index); } catch (e) { mask = null; }
    if (!mask) return respond(false, 'mask not found');
    if (info.field === 'path') {
      var shapeProp = mask.property('ADBE Mask Shape');
      if (!shapeProp) return respond(false, 'mask shape missing');
      shapeProp.setValue(op.value);
      return respond(true, null);
    }
    if (info.field === 'maskMode') { try { mask.maskMode = Number(op.value) || 0; } catch (e2) {} return respond(true, null); }
    if (info.field === 'inverted') { try { mask.inverted = Boolean(op.value); } catch (e3) {} return respond(true, null); }
    if (info.field === 'maskMotionBlur') { try { mask.maskMotionBlur = Number(op.value) || 0; } catch (e4) {} return respond(true, null); }
    if (info.field === 'name') { try { mask.name = String(op.value); } catch (e5) {} return respond(true, null); }
    var target = null;
    try { target = mask[info.field]; } catch (e6) { target = null; }
    if (!target || typeof target.setValue !== 'function') return respond(false, 'mask field not settable: ' + info.field);
    var coerced = coerceValue(target, op.value);
    if (coerced === null) return respond(false, 'mask value mismatch');
    target.setValue(coerced);
    return respond(true, null);
  }

  function applyAddMask(layer, op) {
    var d = op.value || {};
    var parade = maskParade(layer);
    if (!parade) return respond(false, 'no mask parade');
    var mask = null;
    try { mask = parade.addProperty('ADBE Mask Atom'); } catch (e) { mask = null; }
    if (!mask) return respond(false, 'mask add failed');
    if (d.name) { try { mask.name = String(d.name); } catch (e2) {} }
    if (d.maskMode !== undefined) { try { mask.maskMode = Number(d.maskMode) || 0; } catch (e3) {} }
    if (d.inverted !== undefined) { try { mask.inverted = Boolean(d.inverted); } catch (e4) {} }
    if (d.maskMotionBlur !== undefined) { try { mask.maskMotionBlur = Number(d.maskMotionBlur) || 0; } catch (e5) {} }
    var simple = ['maskFeather', 'maskOpacity', 'maskExpansion'];
    for (var i = 0; i < simple.length; i++) {
      if (d[simple[i]] === undefined) continue;
      var prop = null;
      try { prop = mask[simple[i]]; } catch (e6) { prop = null; }
      if (!prop || typeof prop.setValue !== 'function') continue;
      var val = coerceValue(prop, d[simple[i]]);
      if (val !== null) {
        try { prop.setValue(val); } catch (e7) {}
      }
    }
    if (d.path) {
      var shapeProp = mask.property('ADBE Mask Shape');
      if (shapeProp) {
        try {
          if (d.path.keys && d.path.keys.length > 0) {
            for (var k = 0; k < d.path.keys.length; k++) shapeProp.setValueAtTime(d.path.keys[k].t, d.path.keys[k].v);
          } else if (d.path.value !== undefined) {
            shapeProp.setValue(d.path.value);
          }
        } catch (e8) {}
      }
    }
    return respond(true, null);
  }

  function applyRemoveMask(layer, op) {
    var info = maskInfoFromPath(op.path);
    var parade = maskParade(layer);
    if (!parade) return respond(false, 'no mask parade');
    var mask = null;
    try { mask = parade.property(info.index); } catch (e) { mask = null; }
    if (!mask) return respond(false, 'mask not found');
    mask.remove();
    return respond(true, null);
  }

  function applySet(comp, layer, op) {
    if (op.path && op.path.indexOf('mask:') === 0) return applyMaskSet(layer, op);
    if (op.path === 'parent') {
      if (!op.value) {
        try { layer.parent = null; } catch (e0) {}
        return respond(true, null);
      }
      var parentLayer = findLayer(comp, String(op.value));
      if (!parentLayer) return respond(false, 'parent layer not found');
      try { layer.parent = parentLayer; } catch (e1) { return respond(false, 'parent set failed'); }
      return respond(true, null);
    }
    if (op.path === 'textDoc') {
      try {
        var textDocProp = layer.property('ADBE Text Properties').property('ADBE Text Document');
        if (!textDocProp) return respond(false, 'no text document');
        var textDoc = textDocProp.value;
        var incoming = op.value || {};
        for (var tf = 0; tf < TEXT_DOC_FIELDS.length; tf++) {
          var textField = TEXT_DOC_FIELDS[tf];
          if (incoming[textField] === undefined) continue;
          try { textDoc[textField] = incoming[textField]; } catch (e) {}
        }
        textDocProp.setValue(textDoc);
      } catch (e2) {
        return respond(false, 'text doc set failed');
      }
      return respond(true, null);
    }
    if (op.path === 'motionBlur') {
      try { layer.motionBlur = Boolean(op.value); } catch (eMB) { return respond(false, 'motionBlur set failed'); }
      return respond(true, null);
    }
    if (op.path === 'frameBlending') {
      try { layer.frameBlending = Boolean(op.value); } catch (eFB) { return respond(false, 'frameBlending set failed'); }
      return respond(true, null);
    }
    if (op.path === 'frameBlendingType') {
      try { layer.frameBlendingType = Number(op.value) || 0; } catch (eFBT) { return respond(false, 'frameBlendingType set failed'); }
      return respond(true, null);
    }
    if (op.path === 'trkMatte') {
      try { layer.isTrackMatte = Boolean(op.value); } catch (e2) { return respond(false, 'trkMatte set failed'); }
      return respond(true, null);
    }
    if (op.path === 'trkType') {
      try { layer.trackMatteType = Number(op.value) || 0; } catch (e3) { return respond(false, 'trkType set failed'); }
      return respond(true, null);
    }
    if (op.path === 'name') { layer.name = String(op.value); return respond(true, null); }
    if (op.path === 'inPoint') { layer.inPoint = Number(op.value); return respond(true, null); }
    if (op.path === 'outPoint') { layer.outPoint = Number(op.value); return respond(true, null); }
    if (op.path === 'startTime') { layer.startTime = Number(op.value); return respond(true, null); }
    if (op.path === 'enabled') { layer.enabled = Boolean(op.value); return respond(true, null); }
    var prop = resolveProp(layer, op.path);
    if (!prop) return respond(false, 'unsupported path ' + op.path);
    var value = coerceValue(prop, op.value);
    if (value === null) return respond(false, 'value dimension mismatch for ' + op.path);
    prop.setValue(value);
    return respond(true, null);
  }

  function applyKeyOp(layer, op) {
    var prop = resolveProp(layer, op.path);
    if (!prop) return respond(false, 'unsupported path ' + op.path);
    var time = Number(op.time);
    if (!isFinite(time)) return respond(false, 'missing time');
    if (op.kind === 'removeKey') {
      var idx = keyIndexAtTime(prop, time);
      if (idx > 0) prop.removeKey(idx);
      return respond(true, null);
    }
    var value = coerceValue(prop, op.value);
    if (value === null) return respond(false, 'value dimension mismatch for ' + op.path);
    prop.setValueAtTime(time, value);
    var newIdx = keyIndexAtTime(prop, time);
    if (newIdx > 0 && op.interp) {
      try { prop.setInterpolationTypeAtKey(newIdx, op.interp.inType, op.interp.outType); } catch (e) {}
    }
    if (newIdx > 0 && op.ease) {
      try {
        var inEase = buildEase(op.ease.in);
        var outEase = buildEase(op.ease.out);
        if (inEase && outEase) prop.setTemporalEaseAtKey(newIdx, inEase, outEase);
      } catch (e2) {}
    }
    if (newIdx > 0 && op.spatial) {
      try { prop.setSpatialTangentsAtKey(newIdx, op.spatial.in || [], op.spatial.out || []); } catch (e3) {}
    }
    return respond(true, null);
  }

  var ADD_PROPS = ['position', 'anchor', 'scale', 'rotation', 'opacity'];
  var MAX_EFFECT_PARAMS = 2000;
  var MAX_LAYERS_FOR_EFFECTS = 120;

  function effectParade(layer) {
    try { return layer.property('ADBE Effect Parade'); } catch (e) { return null; }
  }

  function effectCount(layer) {
    var parade = effectParade(layer);
    if (!parade) return 0;
    try { return parade.numProperties; } catch (e) { return 0; }
  }

  function effectAt(layer, index) {
    var parade = effectParade(layer);
    if (!parade) return null;
    try { return parade.property(index); } catch (e) { return null; }
  }

  function findEffect(layer, fxId) {
    var hash = fxId.indexOf('#');
    var mn = hash >= 0 ? fxId.substring(0, hash) : fxId;
    var occ = hash >= 0 ? Number(fxId.substring(hash + 1)) : 1;
    var seen = 0;
    var num = effectCount(layer);
    for (var i = 1; i <= num; i++) {
      var fx = effectAt(layer, i);
      if (!fx) continue;
      if (fx.matchName !== mn) continue;
      seen++;
      if (seen === occ) return fx;
    }
    return null;
  }

  function effectIdFromPath(path) {
    var rest = String(path || '').substring(3);
    var slash = rest.indexOf('/');
    return slash >= 0 ? rest.substring(0, slash) : rest;
  }

  function findChildByMatchName(group, matchName) {
    var n = 0;
    try { n = group.numProperties; } catch (e) { return null; }
    for (var i = 1; i <= n; i++) {
      var child = null;
      try { child = group.property(i); } catch (e2) { continue; }
      if (!child) continue;
      var mn = '';
      try { mn = child.matchName; } catch (e3) {}
      if (mn === matchName) return child;
    }
    return null;
  }

  function resolvePropPath(root, pathStr) {
    var parts = String(pathStr || '').split('/');
    var cur = root;
    for (var i = 0; i < parts.length; i++) {
      var key = parts[i];
      if (!key) return null;
      var next = null;
      try {
        if (key.charAt(0) === '#') next = cur.property(Number(key.substring(1)));
        else next = cur.property(key);
      } catch (e) {
        next = null;
      }
      if (!next) next = findChildByMatchName(cur, key);
      if (!next) return null;
      cur = next;
    }
    return cur;
  }

  function readEffectProps(group, prefix, out, keysBudget, paramsLeft) {
    var n = 0;
    try { n = group.numProperties; } catch (e) { return paramsLeft; }
    for (var i = 1; i <= n && paramsLeft > 0; i++) {
      var prop = null;
      try { prop = group.property(i); } catch (e2) { continue; }
      if (!prop) continue;
      var mn = '';
      try { mn = prop.matchName; } catch (e4) {}
      var key = prefix + (mn ? mn : '#' + i);
      var childCount = 0;
      try { childCount = prop.numProperties; } catch (e5) { childCount = 0; }
      if (childCount > 0) {
        paramsLeft = readEffectProps(prop, key + '/', out, keysBudget, paramsLeft);
      } else {
        out[key] = readProp(prop, keysBudget);
        paramsLeft--;
      }
    }
    return paramsLeft;
  }

  function getTextState() {
    var item = null;
    try { item = app.project ? app.project.activeItem : null; } catch (e) { item = null; }
    if (!item || !(item instanceof CompItem)) return 'null';
    var layers = [];
    for (var i = 1; i <= item.numLayers; i++) {
      var layer = item.layer(i);
      var selected = false;
      try { selected = layer.selected === true; } catch (e2) {}
      if (!selected) continue;
      if (!(layer instanceof TextLayer)) continue;
      layers.push({ sid: layerSid(layer), textDoc: readTextDoc(layer) });
    }
    return JSON.stringify({ comp: { id: compKey(item) }, layers: layers });
  }

  function getActiveCompEffects(chunkIndex, chunkCount) {
    var chunk = Number(chunkIndex);
    if (!isFinite(chunk) || chunk < 0) chunk = 0;
    var chunks = Number(chunkCount);
    if (!isFinite(chunks) || chunks < 1) chunks = 1;
    var item = null;
    try { item = app.project ? app.project.activeItem : null; } catch (e) { item = null; }
    if (!item || !(item instanceof CompItem)) return 'null';
    var allowEffects = item.numLayers <= MAX_LAYERS_FOR_EFFECTS;
    var keysBudget = { allowKeys: item.numLayers <= MAX_LAYERS_FOR_KEYS, used: 0, omitted: false };
    var paramsLeft = allowEffects ? MAX_EFFECT_PARAMS : 0;
    var layers = [];
    var fxOrdinal = 0;
    for (var i = 1; i <= item.numLayers; i++) {
      var layer = item.layer(i);
      var fxList = [];
      var occurrences = {};
      var numFx = effectCount(layer);
      for (var e = 1; e <= numFx && paramsLeft > 0; e++) {
        var fx = effectAt(layer, e);
        if (!fx) continue;
        var mn = '';
        try { mn = fx.matchName; } catch (e3) {}
        var occ = (occurrences[mn] || 0) + 1;
        occurrences[mn] = occ;
        var includeParams = fxOrdinal % chunks === chunk;
        fxOrdinal++;
        var props = {};
        if (includeParams) {
          paramsLeft = readEffectProps(fx, '', props, keysBudget, paramsLeft);
        }
        fxList.push({
          id: mn + '#' + occ,
          matchName: mn,
          name: fx.name,
          enabled: fx.enabled,
          index: e,
          props: props,
          paramsSkipped: !includeParams
        });
      }
      layers.push({ sid: layerSid(layer), effects: fxList });
    }
    return JSON.stringify({
      comp: { id: compKey(item) },
      layers: layers,
      truncated: paramsLeft <= 0,
      keysOmitted: keysBudget.omitted
    });
  }

  function getLayerEffectParams(compKeyStr, sid, fxId) {
    var comp = findComp(compKeyStr);
    if (!comp) return 'null';
    var layer = findLayer(comp, sid);
    if (!layer) return 'null';
    var fx = findEffect(layer, fxId);
    if (!fx) return 'null';
    var props = {};
    var keysBudget = { allowKeys: true, used: 0, omitted: false };
    readEffectProps(fx, '', props, keysBudget, MAX_EFFECT_PARAMS);
    return JSON.stringify({ props: props });
  }

  function applyPropMap(root, propsMap) {
    if (!propsMap) return;
    for (var key in propsMap) {
      var spec = propsMap[key];
      if (!spec || typeof spec !== 'object') continue;
      var prop = resolvePropPath(root, key);
      if (!prop) continue;
      try {
        if (spec.keys && spec.keys.length > 0) {
          for (var k = 0; k < spec.keys.length; k++) {
            var kv = coerceValue(prop, spec.keys[k].v);
            if (kv !== null) prop.setValueAtTime(spec.keys[k].t, kv);
          }
        } else if (spec.value !== undefined) {
          var v = coerceValue(prop, spec.value);
          if (v !== null) prop.setValue(v);
        }
        if (spec.expr) {
          prop.expression = String(spec.expr);
          if (spec.exprOn !== false) prop.expressionEnabled = true;
        }
      } catch (e) {}
    }
  }

  function moveEffect(fx, layer, index) {
    var want = Number(index);
    if (!isFinite(want)) return;
    want = Math.max(1, Math.min(effectCount(layer), Math.round(want)));
    try { fx.moveTo(want); } catch (e2) {}
  }

  function applyAddEffect(layer, op) {
    var d = op.value || {};
    var mn = String(d.matchName || '');
    if (!mn) return respond(false, 'missing matchName');
    var fx = null;
    var parade = effectParade(layer);
    if (parade) {
      try { fx = parade.addProperty(mn); } catch (e) { fx = null; }
    }
    if (!fx) {
      try { fx = layer.effect.addProperty(mn); } catch (e4) { fx = null; }
    }
    if (!fx) return respond(false, 'effect unavailable: ' + mn);
    if (d.name) { try { fx.name = String(d.name); } catch (e2) {} }
    if (d.enabled === false) { try { fx.enabled = false; } catch (e3) {} }
    applyPropMap(fx, d.props);
    if (d.index !== undefined) moveEffect(fx, layer, d.index);
    return respond(true, null);
  }

  function applyRemoveEffect(layer, op) {
    var fx = findEffect(layer, effectIdFromPath(op.path));
    if (!fx) return respond(false, 'effect not found');
    fx.remove();
    return respond(true, null);
  }

  function applySetEffect(layer, op) {
    var fx = findEffect(layer, effectIdFromPath(op.path));
    if (!fx) return respond(false, 'effect not found');
    var v = op.value || {};
    if (v.enabled !== undefined) { try { fx.enabled = Boolean(v.enabled); } catch (e) {} }
    if (v.name !== undefined) { try { fx.name = String(v.name); } catch (e2) {} }
    if (op.index !== undefined) moveEffect(fx, layer, op.index);
    return respond(true, null);
  }

  function stripStamps(comment) {
    var out = comment || '';
    var idx = out.indexOf(STAMP_PREFIX);
    while (idx >= 0) {
      out = out.substring(0, idx) + out.substring(idx + STAMP_PREFIX.length + STAMP_LEN);
      idx = out.indexOf(STAMP_PREFIX);
    }
    return out;
  }

  function stampLayer(compKeyStr, sid, hex) {
    var comp = findComp(compKeyStr);
    if (!comp) return respond(false, 'comp not found');
    var layer = findLayer(comp, sid);
    if (!layer) return respond(false, 'layer not found');
    try {
      var base = stripStamps(layer.comment);
      layer.comment = (base ? base + ' ' : '') + STAMP_PREFIX + String(hex).slice(0, STAMP_LEN);
    } catch (e) {
      return respond(false, 'comment write failed');
    }
    return respond(true, null);
  }

  function applyAddDetails(layer, d, comp) {
    var i;
    if (d.inPoint !== undefined) { try { layer.inPoint = Number(d.inPoint); } catch (e) {} }
    if (d.outPoint !== undefined) { try { layer.outPoint = Number(d.outPoint); } catch (e) {} }
    if (d.startTime !== undefined) { try { layer.startTime = Number(d.startTime); } catch (e) {} }
    if (d.enabled !== undefined) { try { layer.enabled = Boolean(d.enabled); } catch (e) {} }
    var tr = d.transform || {};
    for (i = 0; i < ADD_PROPS.length; i++) {
      var spec = tr[ADD_PROPS[i]];
      var prop = resolveProp(layer, 'transform.' + ADD_PROPS[i]);
      if (!spec || !prop) continue;
      try {
        if (spec.keys && spec.keys.length > 0) {
          for (var k = 0; k < spec.keys.length; k++) {
            var kv = coerceValue(prop, spec.keys[k].v);
            if (kv !== null) prop.setValueAtTime(spec.keys[k].t, kv);
          }
        } else if (spec.value !== undefined) {
          var v = coerceValue(prop, spec.value);
          if (v !== null) prop.setValue(v);
        }
        if (spec.expr) {
          prop.expression = String(spec.expr);
          if (spec.exprOn !== false) prop.expressionEnabled = true;
        }
      } catch (e3) {}
    }
    if (d.masks && d.masks.length) {
      for (var m = 0; m < d.masks.length; m++) {
        applyAddMask(layer, { value: d.masks[m] });
      }
    }
    if (d.index !== undefined) {
      var want = Number(d.index);
      if (isFinite(want)) {
        want = Math.max(1, Math.min(comp.numLayers, Math.round(want)));
        layer.moveToEnd();
        if (want < comp.numLayers) layer.moveBefore(comp.layer(want));
      }
    }
  }

  function applyAdd(comp, op) {
    var d = op.value;
    if (!d || typeof d !== 'object') return respond(false, 'missing descriptor');
    if (op.target.layer && findLayer(comp, op.target.layer)) return respond(true, null);
    var name = d.name ? String(d.name) : 'Layer';
    var conflict = null;
    for (var ci = 1; ci <= comp.numLayers; ci++) {
      var cand = comp.layer(ci);
      if (cand.name !== name) continue;
      conflict = cand;
      break;
    }
    if (conflict && op.target.layer && layerSid(conflict) !== op.target.layer) {
      return respond(false, 'name conflict: ' + name);
    }
    var created = null;
    if (d.type === 'solid') {
      var s = d.solid || {};
      var color = s.color && s.color.length === 3 ? s.color : [1, 1, 1];
      created = comp.layers.addSolid(
        color,
        name,
        Number(s.width) || comp.width,
        Number(s.height) || comp.height,
        Number(s.pixelAspect) || 1,
        Number(s.duration) || comp.duration
      );
    } else if (d.type === 'footage') {
      var src = null;
      if (d.source && d.source.path) src = findFootageByPath(d.source.path);
      if (!src && d.source && d.source.name) src = findFootageByName(d.source.name);
      if (!src && d.source && d.source.path) {
        try {
          var f = new File(d.source.path);
          if (f.exists) src = app.project.importFile(new ImportOptions(f));
        } catch (e5) {
          src = null;
        }
      }
      if (!src) return respond(false, 'media not found: ' + (d.source && d.source.name ? d.source.name : '?'));
      created = comp.layers.add(src);
      created.name = name;
    } else if (d.type === 'comp') {
      var compItem = findComp(String(d.sourceComp || ''));
      if (!compItem) return respond(false, 'precomp not found: ' + d.sourceComp);
      created = comp.layers.add(compItem);
      created.name = name;
    } else if (d.type === 'adjustment') {
      created = comp.layers.addSolid([1, 1, 1], name, comp.width, comp.height, 1, comp.duration);
      created.adjustmentLayer = true;
    } else if (d.type === 'null') {
      created = comp.layers.addNull(comp.duration);
      created.name = name;
    } else if (d.type === 'shape') {
      created = comp.layers.addShape();
      created.name = name;
      var shapeRootGroup = shapeRoot(created);
      if (shapeRootGroup && d.shape) {
        buildShapeTree(shapeRootGroup, d.shape, { remaining: MAX_SHAPE_NODES, failed: 0, truncated: false });
      }
    } else if (d.type === 'text') {
      created = comp.layers.addText(String(d.sourceText || ''));
      created.name = name;
    } else {
      return respond(false, 'unsupported add type ' + d.type);
    }
    if (op.target.layer && op.target.layer.indexOf('st') === 0) {
      try {
        created.comment =
          (created.comment ? created.comment + ' ' : '') + STAMP_PREFIX + op.target.layer.substring(2, 2 + STAMP_LEN);
      } catch (e2) {}
    }
    applyAddDetails(created, d, comp);
    return respond(true, null);
  }

  function applyCompSetting(comp, op) {
    var field = String(op.path || '');
    try {
      if (field === 'width') comp.width = Math.max(1, Math.round(Number(op.value)));
      else if (field === 'height') comp.height = Math.max(1, Math.round(Number(op.value)));
      else if (field === 'duration') comp.duration = Math.max(0.01, Number(op.value));
      else if (field === 'frameRate') comp.frameRate = Number(op.value);
      else if (field === 'pixelAspect') comp.pixelAspect = Number(op.value);
      else if (field === 'bgColor') comp.bgColor = normVal(op.value);
      else if (field === 'motionBlur') comp.motionBlur = Boolean(op.value);
      else if (field === 'shutterAngle') comp.shutterAngle = Number(op.value);
      else if (field === 'shutterPhase') comp.shutterPhase = Number(op.value);
      else return respond(false, 'unknown comp field ' + field);
    } catch (e) {
      return respond(false, 'comp field set failed: ' + field);
    }
    return respond(true, null);
  }

  function applyOp(opStr) {
    var op;
    try {
      op = JSON.parse(opStr);
      if (!op || typeof op !== 'object') return respond(false, 'malformed op');
      if (!op.target || typeof op.target !== 'object') return respond(false, 'missing target');
      if (typeof op.target.comp !== 'string' || !op.target.comp) return respond(false, 'missing target.comp');
      if (typeof op.kind !== 'string' || !op.kind) return respond(false, 'missing kind');
      var targetComp = findComp(op.target.comp);
      if (!targetComp) return respond(false, 'comp not found');
      if (op.kind === 'set') {
        if (!op.target.layer) return respond(false, 'missing layer target');
        var layer = findLayer(targetComp, op.target.layer);
        if (!layer) return respond(false, 'layer not found');
        return applySet(targetComp, layer, op);
      }
      if (op.kind === 'setExpr') {
        if (!op.target.layer) return respond(false, 'missing layer target');
        var exprLayer = findLayer(targetComp, op.target.layer);
        if (!exprLayer) return respond(false, 'layer not found');
        var exprPath = String(op.path || '');
        if (exprPath.length > 5 && exprPath.substring(exprPath.length - 5) === '@expr') {
          exprPath = exprPath.substring(0, exprPath.length - 5);
        }
        var exprProp = resolveProp(exprLayer, exprPath);
        if (!exprProp) return respond(false, 'expr prop not found');
        var exprData = op.value || {};
        try {
          exprProp.expression = String(exprData.text || '');
          if (exprData.enabled !== undefined && String(exprData.text || '').length > 0) {
            exprProp.expressionEnabled = exprData.enabled === true;
          }
        } catch (e) {
          return respond(false, 'expr set failed');
        }
        return respond(true, null);
      }
      if (op.kind === 'addKey' || op.kind === 'setKey' || op.kind === 'removeKey') {
        if (!op.target.layer) return respond(false, 'missing layer target');
        var keyLayer = findLayer(targetComp, op.target.layer);
        if (!keyLayer) return respond(false, 'layer not found');
        return applyKeyOp(keyLayer, op);
      }
      if (op.kind === 'remove') {
        if (!op.target.layer) return respond(false, 'missing layer target');
        var doomed = findLayer(targetComp, op.target.layer);
        if (!doomed) return respond(false, 'layer not found');
        doomed.remove();
        return respond(true, null);
      }
      if (op.kind === 'reorder') {
        if (!op.target.layer) return respond(false, 'missing layer target');
        var moving = findLayer(targetComp, op.target.layer);
        if (!moving) return respond(false, 'layer not found');
        var idx = Number(op.index);
        if (!isFinite(idx)) return respond(false, 'bad index');
        var want = Math.max(1, Math.min(targetComp.numLayers, Math.round(idx)));
        moving.moveToEnd();
        if (want < targetComp.numLayers) moving.moveBefore(targetComp.layer(want));
        return respond(true, null);
      }
      if (op.kind === 'addMask' || op.kind === 'removeMask') {
        if (!op.target.layer) return respond(false, 'missing layer target');
        var maskLayer = findLayer(targetComp, op.target.layer);
        if (!maskLayer) return respond(false, 'layer not found');
        if (op.kind === 'addMask') return applyAddMask(maskLayer, op);
        return applyRemoveMask(maskLayer, op);
      }
      if (op.kind === 'addEffect' || op.kind === 'removeEffect' || op.kind === 'setEffect') {
        if (!op.target.layer) return respond(false, 'missing layer target');
        var fxLayer = findLayer(targetComp, op.target.layer);
        if (!fxLayer) return respond(false, 'layer not found');
        if (op.kind === 'addEffect') return applyAddEffect(fxLayer, op);
        if (op.kind === 'removeEffect') return applyRemoveEffect(fxLayer, op);
        return applySetEffect(fxLayer, op);
      }
      if (op.kind === 'setShape') {
        if (!op.target.layer) return respond(false, 'missing layer target');
        var shapeLayer = findLayer(targetComp, op.target.layer);
        if (!shapeLayer) return respond(false, 'layer not found');
        var shapeRootGroup = shapeRoot(shapeLayer);
        if (!shapeRootGroup) return respond(false, 'not a shape layer');
        clearShapeContents(shapeRootGroup);
        if (op.value && op.value.tree) {
          buildShapeTree(shapeRootGroup, op.value.tree, { remaining: MAX_SHAPE_NODES, failed: 0, truncated: false });
        }
        return respond(true, null);
      }
      if (op.kind === 'setComp') return applyCompSetting(targetComp, op);
      if (op.kind === 'add') return applyAdd(targetComp, op);
      return respond(false, 'unsupported op ' + op.kind);
    } catch (e) {
      return respond(false, 'exception: ' + e.toString());
    }
  }

  return {
    jsonPolyfilled: COLLAB_JSON_POLYFILLED,
    ping: function () { return 'pong'; },
    getHostInfo: getHostInfo,
    getActiveCompState: getActiveCompState,
    getActiveCompEffects: getActiveCompEffects,
    getTextState: getTextState,
    getShapeStates: getShapeStates,
    getLayerShape: getLayerShape,
    stampLayer: stampLayer,
    applyOp: applyOp
  };
})();
