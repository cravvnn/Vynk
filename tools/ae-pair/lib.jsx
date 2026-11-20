// Loaded into each After Effects instance by tools/ae-pair/run.mjs.
// ES3 only. Provides an independent, generic dump of a comp (every layer
// attribute and every property in the tree) so two instances can be compared
// without relying on the product's own readers.
$.global.vynkPair = (function () {
  var STAMP = '#c:';

  function r(n) {
    return Math.round(n * 1000) / 1000;
  }

  function norm(v) {
    var i;
    var o;
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return r(v);
    if (typeof v === 'boolean' || typeof v === 'string') return v;
    if (v instanceof Array) {
      o = [];
      for (i = 0; i < v.length; i++) o.push(norm(v[i]));
      return o;
    }
    try {
      if (v instanceof Shape) {
        return { c: v.closed, v: norm(v.vertices), i: norm(v.inTangents), o: norm(v.outTangents) };
      }
    } catch (e1) {}
    try {
      if (v instanceof TextDocument) {
        o = { text: v.text };
        try { o.font = v.font; } catch (e2) {}
        try { o.size = r(v.fontSize); } catch (e3) {}
        try { o.fill = norm(v.fillColor); } catch (e4) {}
        try { o.just = String(v.justification); } catch (e5) {}
        try { o.tracking = r(v.tracking); } catch (e6) {}
        return o;
      }
    } catch (e7) {}
    try {
      if (v instanceof MarkerValue) return { marker: v.comment, dur: r(v.duration) };
    } catch (e8) {}
    return String(v);
  }

  function stripStamp(c) {
    var out = c || '';
    var idx = out.indexOf(STAMP);
    while (idx >= 0) {
      out = out.substring(0, idx) + out.substring(idx + STAMP.length + 12);
      idx = out.indexOf(STAMP);
    }
    return out.replace(/^\s+|\s+$/g, '');
  }

  function leaf(p, key, out) {
    var k;
    var expressionActive = false;
    try {
      if (p.canSetExpression && p.expression) {
        expressionActive = p.expressionEnabled;
        out[key + '@expr'] = p.expression + (expressionActive ? '' : ' [off]');
      }
    } catch (e0) {}
    try {
      if (p.numKeys > 0) {
        var keys = [];
        for (k = 1; k <= p.numKeys; k++) {
          var entry = [r(p.keyTime(k))];
          try { entry.push(norm(p.keyValue(k))); } catch (e1) { entry.push('?'); }
          try { entry.push(String(p.keyInInterpolationType(k)) + '/' + String(p.keyOutInterpolationType(k))); } catch (e2) {}
          keys.push(entry);
        }
        out[key + '@keys'] = keys;
      } else {
        out[key] = norm(expressionActive ? p.valueAtTime(0, true) : p.value);
      }
    } catch (e3) {}
  }

  function walk(group, path, out) {
    var n = 0;
    try { n = group.numProperties; } catch (e) { n = 0; }
    var seen = {};
    for (var i = 1; i <= n; i++) {
      var p;
      try { p = group.property(i); } catch (e1) { continue; }
      if (!p) continue;
      var mn = p.matchName;
      seen[mn] = (seen[mn] || 0) + 1;
      var key = path + '/' + mn + (seen[mn] > 1 ? '#' + seen[mn] : '');
      var isGroup = false;
      try { isGroup = p.numProperties !== undefined; } catch (e2) { isGroup = false; }
      if (isGroup) {
        try { if (p.canSetEnabled) out[key + '@on'] = p.enabled; } catch (e3) {}
        try { if (p.name && p.parentProperty && p.parentProperty.matchName !== p.matchName && p.propertyDepth <= 3) out[key + '@name'] = p.name; } catch (e4) {}
        walk(p, key, out);
      } else {
        leaf(p, key, out);
      }
    }
  }

  var LAYER_ATTRS = [
    'enabled', 'inPoint', 'outPoint', 'startTime', 'stretch', 'label',
    'threeDLayer', 'adjustmentLayer', 'guideLayer', 'motionBlur', 'collapseTransformation',
    'audioEnabled', 'effectsActive', 'frameBlending', 'timeRemapEnabled', 'preserveTransparency',
    'isTrackMatte', 'hasTrackMatte'
  ];
  var LAYER_ENUMS = ['blendingMode', 'quality', 'trackMatteType', 'frameBlendingType', 'autoOrient', 'samplingQuality'];

  function findComp(name) {
    for (var i = 1; i <= app.project.numItems; i++) {
      var it = app.project.item(i);
      if (it instanceof CompItem && it.name === name) return it;
    }
    return null;
  }

  function findLayer(comp, name) {
    for (var i = 1; i <= comp.numLayers; i++) {
      if (comp.layer(i).name === name) return comp.layer(i);
    }
    return null;
  }

  function dumpComp(comp, prefix, out) {
    var a;
    out[prefix + 'C:size'] = [comp.width, comp.height, r(comp.duration), r(comp.frameRate), r(comp.pixelAspect)];
    out[prefix + 'C:bg'] = norm(comp.bgColor);
    out[prefix + 'C:blur'] = [comp.motionBlur, r(comp.shutterAngle), r(comp.shutterPhase)];
    out[prefix + 'C:work'] = [r(comp.workAreaStart), r(comp.workAreaDuration)];
    out[prefix + 'C:numLayers'] = comp.numLayers;
    try {
      var mk = comp.markerProperty;
      var ms = [];
      for (var m = 1; m <= mk.numKeys; m++) ms.push([r(mk.keyTime(m)), mk.keyValue(m).comment]);
      out[prefix + 'C:markers'] = ms;
    } catch (em) {}
    var names = {};
    for (var i = 1; i <= comp.numLayers; i++) {
      var layer = comp.layer(i);
      names[layer.name] = (names[layer.name] || 0) + 1;
      var lk = prefix + 'L:' + layer.name + (names[layer.name] > 1 ? '~' + names[layer.name] : '');
      out[lk + ':index'] = i;
      for (a = 0; a < LAYER_ATTRS.length; a++) {
        try {
          var v = layer[LAYER_ATTRS[a]];
          if (v !== undefined) out[lk + ':' + LAYER_ATTRS[a]] = norm(v);
        } catch (e1) {}
      }
      for (a = 0; a < LAYER_ENUMS.length; a++) {
        try {
          var ev = layer[LAYER_ENUMS[a]];
          if (ev !== undefined) out[lk + ':' + LAYER_ENUMS[a]] = String(ev);
        } catch (e2) {}
      }
      try { out[lk + ':parent'] = layer.parent ? layer.parent.name : null; } catch (e3) {}
      try { out[lk + ':comment'] = stripStamp(layer.comment); } catch (e4) {}
      try { out[lk + ':source'] = layer.source ? layer.source.name : null; } catch (e5) {}
      walk(layer, lk, out);
    }
  }

  // compName: the comp to dump in full. Every other comp is dumped too, under
  // an "X:<name>/" prefix, so edits to background comps are visible.
  function dump(compName) {
    var out = {};
    if (!app.project) return '{}';
    for (var i = 1; i <= app.project.numItems; i++) {
      var it = app.project.item(i);
      var parent = '';
      try { parent = it.parentFolder ? it.parentFolder.name : ''; } catch (e) {}
      out['P:' + it.name] = it.typeName + '|' + parent + '|' + (it.label !== undefined ? it.label : '');
      if (it instanceof CompItem) dumpComp(it, it.name === compName ? '' : 'X:' + it.name + '/', out);
    }
    return JSON.stringify(out);
  }

  return { dump: dump, comp: findComp, layer: findLayer };
})();
'vynkPair loaded';
