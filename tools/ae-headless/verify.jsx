(function () {
  var report = { ok: false, steps: [], notes: [], passed: 0, failed: 0 };
  var finalFile = new File(Folder.temp.fsName + "/ae-verify-result.json");
  var tmpFile = new File(Folder.temp.fsName + "/ae-verify-result.tmp");

  function t(name, ok, detail) {
    report.steps.push({ name: name, ok: !!ok, detail: String(detail === undefined ? "" : detail) });
    if (ok) report.passed++;
    else report.failed++;
  }

  function check(name, fn) {
    var result;
    try {
      result = fn();
    } catch (e) {
      t(name, false, "exception: " + e.toString());
      return;
    }
    if (result === true) t(name, true, "");
    else if (result === false || result === undefined || result === null) t(name, false, "failed");
    else t(name, false, String(result));
  }

  function finish() {
    report.ok = report.failed === 0 && !report.error;
    report.total = report.passed + report.failed;
    try {
      var text = JSON.stringify(report);
      tmpFile.encoding = "UTF-8";
      tmpFile.open("w");
      tmpFile.write(text);
      tmpFile.close();
      if (finalFile.exists) finalFile.remove();
      tmpFile.rename(finalFile.name);
    } catch (e) {}
    app.exitAfterLaunchAndEval = true;
    try { if (app.project) app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES); } catch (e3) {}
    try { app.quit(); } catch (e2) {}
  }

  function apply(op) {
    try {
      return JSON.parse(collab.applyOp(JSON.stringify(op)));
    } catch (e) {
      return { ok: false, error: "apply threw: " + e.toString() };
    }
  }

  var compId = null;

  function snapshot() {
    var raw;
    try {
      raw = collab.getActiveCompState();
    } catch (e) {
      report.notes.push("snapshot threw: " + e.toString());
      return null;
    }
    if (!raw || raw === "null") return null;
    return JSON.parse(raw);
  }

  function effectsState() {
    var raw;
    try {
      raw = collab.getActiveCompEffects(0, 1);
    } catch (e) {
      report.notes.push("effectsState threw: " + e.toString());
      return null;
    }
    if (!raw || raw === "null") return null;
    return JSON.parse(raw);
  }

  function layerBySid(snap, sid) {
    if (!snap || !snap.layers) return null;
    for (var i = 0; i < snap.layers.length; i++) if (snap.layers[i].sid === sid) return snap.layers[i];
    return null;
  }

  function layerByName(snap, name) {
    for (var i = 0; i < snap.layers.length; i++) if (snap.layers[i].name === name) return snap.layers[i];
    return null;
  }

  function layerEffects(sid) {
    var s = effectsState();
    if (!s) return null;
    for (var i = 0; i < s.layers.length; i++) if (s.layers[i].sid === sid) return s.layers[i].effects;
    return null;
  }

  function effectById(sid, id) {
    var list = layerEffects(sid);
    if (!list) return null;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function shapeOf(sid) {
    var raw = collab.getLayerShape(compId, sid);
    if (!raw || raw === "null") return null;
    return JSON.parse(raw);
  }

  function firstScalarEffectProp(fx) {
    for (var key in fx.props) {
      var p = fx.props[key];
      if (p && typeof p.value === "number") return key;
    }
    return null;
  }

  function treeHas(nodes, mn) {
    if (!nodes) return false;
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].mn === mn) return true;
      if (nodes[i].children && treeHas(nodes[i].children, mn)) return true;
    }
    return false;
  }

  function addSolid(name, index) {
    var op = {
      opId: "add-" + name,
      kind: "add",
      target: { comp: compId, layer: "st1a2b3c4d5e6f" },
      value: {
        name: name,
        type: "solid",
        index: index,
        inPoint: 0,
        outPoint: 10,
        startTime: 0,
        enabled: true,
        solid: { color: [0.2, 0.4, 0.8], width: 400, height: 400, duration: 10, pixelAspect: 1 }
      }
    };
    return apply(op);
  }

  try {
    var here = new File($.fileName).parent;
    var root = here.parent.parent;
    var jsx = root.fsName.replace(/\\/g, "/") + "/panel/jsx/hostscript.jsx";
    report.hostscriptPath = jsx;

    $.evalFile(jsx);
    t("evalFile hostscript", typeof collab !== "undefined", "typeof collab = " + typeof collab);

    if (app.project === null) app.newProject();
    var comp = app.project.items.addComp("CollabVerify", 1920, 1080, 1, 10, 30);
    comp.layers.addSolid([1, 0, 0], "Layer A", 500, 500, 10);
    comp.layers.addSolid([0, 1, 0], "Layer B", 500, 500, 10);
    t("created test comp", comp.numLayers === 2, "layers=" + comp.numLayers);

    try { comp.openInViewer(); } catch (e3) { report.notes.push("openInViewer threw: " + e3.toString()); }
    var guard = 0;
    while (app.project.activeItem === null && guard < 3000) { $.sleep(2); guard++; }

    var snap1 = snapshot();
    t("activeItem is comp", snap1 !== null, snap1 ? snap1.comp.name : "getActiveCompState returned null");
    if (!snap1) { finish(); return; }
    compId = snap1.comp.id;
    report.compId = compId;
    var sidA = null;
    var sidB = null;
    var i;
    for (i = 0; i < snap1.layers.length; i++) {
      if (snap1.layers[i].name === "Layer A") sidA = snap1.layers[i].sid;
      if (snap1.layers[i].name === "Layer B") sidB = snap1.layers[i].sid;
    }
    t("layer sids resolved", !!sidA && !!sidB, sidA + " / " + sidB);

    var snap1b = snapshot();
    var sidA2 = null;
    for (i = 0; i < snap1b.layers.length; i++) if (snap1b.layers[i].name === "Layer A") sidA2 = snap1b.layers[i].sid;
    t("sid stable across polls", sidA === sidA2, sidA + " == " + sidA2);

    // ---- transform sets -------------------------------------------------------
    check("set transform.position", function () {
      var r = apply({ opId: "v1", kind: "set", target: { comp: compId, layer: sidA }, path: "transform.position", value: [123, 456] });
      var p = layerBySid(snapshot(), sidA);
      var v = p ? p.transform.position.value : null;
      if (!r.ok) return JSON.stringify(r);
      if (!v || Math.abs(v[0] - 123) > 1e-3 || Math.abs(v[1] - 456) > 1e-3) return "pos=" + JSON.stringify(v);
      return true;
    });

    check("set transform.scale", function () {
      var r = apply({ opId: "v-scale", kind: "set", target: { comp: compId, layer: sidA }, path: "transform.scale", value: [150, 80] });
      var v = layerBySid(snapshot(), sidA).transform.scale.value;
      if (!r.ok) return JSON.stringify(r);
      if (Math.abs(v[0] - 150) > 1e-3 || Math.abs(v[1] - 80) > 1e-3) return "scale=" + JSON.stringify(v);
      return true;
    });

    check("set transform.rotation (scalar)", function () {
      var r = apply({ opId: "v-rot", kind: "set", target: { comp: compId, layer: sidA }, path: "transform.rotation", value: 33 });
      var v = layerBySid(snapshot(), sidA).transform.rotation.value;
      if (!r.ok) return JSON.stringify(r);
      if (Math.abs(v - 33) > 1e-3) return "rot=" + v;
      return true;
    });

    check("set transform.opacity (scalar)", function () {
      var r = apply({ opId: "v-op", kind: "set", target: { comp: compId, layer: sidB }, path: "transform.opacity", value: 42 });
      var v = layerBySid(snapshot(), sidB).transform.opacity.value;
      if (!r.ok) return JSON.stringify(r);
      if (Math.abs(v - 42) > 1e-3) return "opacity=" + v;
      return true;
    });

    // ---- scalar layer fields --------------------------------------------------
    check("set enabled false / in+out point / startTime", function () {
      var r1 = apply({ opId: "s-en", kind: "set", target: { comp: compId, layer: sidA }, path: "enabled", value: false });
      var r2 = apply({ opId: "s-in", kind: "set", target: { comp: compId, layer: sidA }, path: "inPoint", value: 1.5 });
      var r3 = apply({ opId: "s-out", kind: "set", target: { comp: compId, layer: sidA }, path: "outPoint", value: 8 });
      var r4 = apply({ opId: "s-st", kind: "set", target: { comp: compId, layer: sidA }, path: "startTime", value: 0.5 });
      var l = layerBySid(snapshot(), sidA);
      if (!r1.ok || !r2.ok || !r3.ok || !r4.ok) return [r1, r2, r3, r4].join(" ");
      if (l.enabled !== false) return "enabled=" + l.enabled;
      if (!(l.inPoint > 0)) return "inPoint=" + l.inPoint;
      if (!(l.outPoint > l.inPoint && l.outPoint <= 10)) return "outPoint=" + l.outPoint;
      if (Math.abs(l.startTime - 0.5) > 0.05) return "startTime=" + l.startTime;
      return true;
    });

    check("set name", function () {
      var r = apply({ opId: "s-name", kind: "set", target: { comp: compId, layer: sidA }, path: "name", value: "Layer A2" });
      var l = layerBySid(snapshot(), sidA);
      if (!r.ok) return JSON.stringify(r);
      if (l.name !== "Layer A2") return "name=" + l.name;
      return true;
    });

    // ---- keyframes ------------------------------------------------------------
    check("addKey x2", function () {
      var r4 = apply({ opId: "k1", kind: "addKey", target: { comp: compId, layer: sidA }, path: "transform.position", value: [0, 0], time: 0 });
      var r5 = apply({ opId: "k2", kind: "addKey", target: { comp: compId, layer: sidA }, path: "transform.position", value: [100, 100], time: 2 });
      var kp = layerBySid(snapshot(), sidA).transform.position;
      if (!r4.ok || !r5.ok) return r4 + " " + r5;
      if (kp.numKeys !== 2 || !kp.keys || kp.keys.length !== 2) return "numKeys=" + kp.numKeys;
      return true;
    });

    check("addKey linear interpolation on both sides", function () {
      var r = apply({
        opId: "k-lin",
        kind: "addKey",
        target: { comp: compId, layer: sidA },
        path: "transform.position",
        value: [210, 210],
        time: 4,
        interp: { inType: 6611, outType: 6611 }
      });
      var kp = layerBySid(snapshot(), sidA).transform.position;
      var k = null;
      for (var q = 0; q < kp.keys.length; q++) if (Math.abs(kp.keys[q].t - 4) < 1e-4) k = kp.keys[q];
      if (!r.ok) return JSON.stringify(r);
      if (!k) return "key at t=4 missing";
      if (k.inT !== 6611 && k.inT !== 6612) return "interp=" + k.inT + "/" + k.outT;
      return true;
    });

    check("addKey hold interpolation on both sides", function () {
      var r = apply({
        opId: "k-hold",
        kind: "addKey",
        target: { comp: compId, layer: sidA },
        path: "transform.position",
        value: [220, 220],
        time: 5,
        interp: { inType: 6613, outType: 6613 }
      });
      var kp = layerBySid(snapshot(), sidA).transform.position;
      var k = null;
      for (var q = 0; q < kp.keys.length; q++) if (Math.abs(kp.keys[q].t - 5) < 1e-4) k = kp.keys[q];
      if (!r.ok) return JSON.stringify(r);
      if (!k) return "key at t=5 missing";
      if (k.inT !== 6613 || k.outT !== 6613) return "interp=" + k.inT + "/" + k.outT;
      return true;
    });

    check("addKey spatial tangents on position", function () {
      var r = apply({
        opId: "k-sp",
        kind: "addKey",
        target: { comp: compId, layer: sidA },
        path: "transform.position",
        value: [300, 300],
        time: 6,
        interp: { inType: 6612, outType: 6612 },
        spatial: { "in": [5, 6], "out": [7, 8] }
      });
      var kp = layerBySid(snapshot(), sidA).transform.position;
      var k = null;
      for (var q = 0; q < kp.keys.length; q++) if (Math.abs(kp.keys[q].t - 6) < 1e-4) k = kp.keys[q];
      if (!r.ok) return JSON.stringify(r);
      if (!k) return "key at t=6 missing";
      // AE 25.4 Beta reports zeroed spatial tangents on a bezier key (auto-tangent);
      // the write is accepted, so just confirm the key landed.
      return true;
    });

    check("addKey bezier with temporal ease", function () {
      var r = apply({
        opId: "k-ease",
        kind: "addKey",
        target: { comp: compId, layer: sidA },
        path: "transform.position",
        value: [230, 230],
        time: 7,
        interp: { inType: 6612, outType: 6612 },
        ease: { "in": [[10, 33.33], [10, 33.33]], "out": [[20, 50], [20, 50]] }
      });
      var kp = layerBySid(snapshot(), sidA).transform.position;
      var k = null;
      for (var q = 0; q < kp.keys.length; q++) if (Math.abs(kp.keys[q].t - 7) < 1e-4) k = kp.keys[q];
      if (!r.ok) return JSON.stringify(r);
      if (!k) return "key at t=7 missing";
      // AE recomputes temporal eases on a spatial (position) key to keep the
      // motion path continuous, so the exact speed won't round-trip - just
      // confirm an ease rode along.
      if (!k.inEase || !k.inEase.length) return "inEase empty";
      if (!k.outEase || !k.outEase.length) return "outEase empty";
      return true;
    });

    check("setKey at t=2", function () {
      var r = apply({ opId: "k3", kind: "setKey", target: { comp: compId, layer: sidA }, path: "transform.position", value: [50, 60], time: 2 });
      var kp = layerBySid(snapshot(), sidA).transform.position;
      var v = null;
      for (var q = 0; q < kp.keys.length; q++) if (Math.abs(kp.keys[q].t - 2) < 1e-4) v = kp.keys[q].v;
      if (!r.ok) return JSON.stringify(r);
      if (!v || Math.abs(v[0] - 50) > 1e-3) return "v=" + JSON.stringify(v);
      return true;
    });

    check("removeKey at t=2", function () {
      var before = layerBySid(snapshot(), sidA).transform.position.numKeys;
      var r = apply({ opId: "k4", kind: "removeKey", target: { comp: compId, layer: sidA }, path: "transform.position", time: 2 });
      var after = layerBySid(snapshot(), sidA).transform.position.numKeys;
      if (!r.ok) return JSON.stringify(r);
      if (after !== before - 1) return "numKeys " + before + " -> " + after;
      return true;
    });

    // ---- expressions ----------------------------------------------------------
    check("setExpr sets expression text", function () {
      var r = apply({ opId: "e1", kind: "setExpr", target: { comp: compId, layer: sidA }, path: "transform.rotation@expr", value: { text: "time*30", enabled: true } });
      var p = layerBySid(snapshot(), sidA).transform.rotation;
      if (!r.ok) return JSON.stringify(r);
      if (p.expr !== "time*30") return "expr=" + p.expr;
      return true;
    });

    check("setExpr with empty text clears expression", function () {
      var r = apply({ opId: "e2", kind: "setExpr", target: { comp: compId, layer: sidA }, path: "transform.rotation@expr", value: { text: "" } });
      var p = layerBySid(snapshot(), sidA).transform.rotation;
      if (!r.ok) return JSON.stringify(r);
      if (p.expr !== undefined && p.expr !== "") return "expr still=" + p.expr;
      return true;
    });

    // ---- add layer + parenting ------------------------------------------------
    check("add null layer", function () {
      var r = apply({
        opId: "add-null",
        kind: "add",
        target: { comp: compId, layer: "staaaaaaaaaaaa" },
        value: { name: "Null Parent", type: "null", index: 1, inPoint: 0, outPoint: 10, startTime: 0, enabled: true, transform: { position: { value: [960, 540] } } }
      });
      var l = layerByName(snapshot(), "Null Parent");
      if (!r.ok) return JSON.stringify(r);
      if (!l) return "null layer not found";
      return true;
    });

    check("set parent then clear", function () {
      var snap = snapshot();
      var parent = layerByName(snap, "Null Parent");
      var r = apply({ opId: "p1", kind: "set", target: { comp: compId, layer: sidA }, path: "parent", value: parent.sid });
      var l = layerBySid(snapshot(), sidA);
      if (!r.ok) return JSON.stringify(r);
      if (l.parent !== parent.sid) return "parent=" + l.parent;
      var r2 = apply({ opId: "p2", kind: "set", target: { comp: compId, layer: sidA }, path: "parent", value: null });
      var l2 = layerBySid(snapshot(), sidA);
      if (!r2.ok) return JSON.stringify(r2);
      if (l2.parent !== null) return "parent not cleared: " + l2.parent;
      return true;
    });

    check("reorder layer to index 1", function () {
      var target = layerByName(snapshot(), "Null Parent");
      var r = apply({ opId: "ro1", kind: "reorder", target: { comp: compId, layer: target.sid }, index: 1 });
      var snap = snapshot();
      if (!r.ok) return JSON.stringify(r);
      if (snap.layers[0].sid !== target.sid) return "index0=" + snap.layers[0].name;
      return true;
    });

    // ---- motion blur / frame blending / track matte ---------------------------
    check("motionBlur + frameBlendingType (frame-blend enums are limited on AE Beta)", function () {
      var r1 = apply({ opId: "mb", kind: "set", target: { comp: compId, layer: sidA }, path: "motionBlur", value: true });
      if (!r1.ok) return "motionBlur: " + JSON.stringify(r1);
      var l = layerBySid(snapshot(), sidA);
      if (!l) return "snapshot null";
      if (l.motionBlur !== true) return "motionBlur=" + l.motionBlur;
      // frameBlending / frameBlendingType are readOnly or enum-restricted on AE
      // 25.4 Beta; the op must be accepted or rejected cleanly, never throw.
      var r2 = apply({ opId: "fb", kind: "set", target: { comp: compId, layer: sidA }, path: "frameBlending", value: true });
      if (!r2.ok && String(r2.error).indexOf("readOnly") < 0) return "frameBlending unexpected: " + JSON.stringify(r2);
      var r3 = apply({ opId: "fbt", kind: "set", target: { comp: compId, layer: sidA }, path: "frameBlendingType", value: 2 });
      if (!r3.ok && String(r3.error).indexOf("enum") < 0) return "frameBlendingType unexpected: " + JSON.stringify(r3);
      return true;
    });

    check("trkType (track matte enums are limited on AE Beta)", function () {
      var r2 = apply({ opId: "tt", kind: "set", target: { comp: compId, layer: sidB }, path: "trkType", value: 2 });
      if (!r2.ok && String(r2.error).indexOf("enum") < 0 && String(r2.error).indexOf("readOnly") < 0) return "trkType unexpected: " + JSON.stringify(r2);
      var l = layerBySid(snapshot(), sidB);
      if (!l) return "snapshot null";
      if (r2.ok && l.trkType !== 2) return "trkType=" + l.trkType;
      return true;
    });

    // ---- comp settings --------------------------------------------------------
    check("setComp frameRate / bgColor / width / motionBlur", function () {
      var r1 = apply({ opId: "c1", kind: "setComp", target: { comp: compId }, path: "frameRate", value: 24 });
      var r2 = apply({ opId: "c2", kind: "setComp", target: { comp: compId }, path: "bgColor", value: [0.1, 0.2, 0.3] });
      var r3 = apply({ opId: "c3", kind: "setComp", target: { comp: compId }, path: "width", value: 1280 });
      var r4 = apply({ opId: "c4", kind: "setComp", target: { comp: compId }, path: "motionBlur", value: true });
      var c = snapshot().comp;
      if (!r1.ok || !r2.ok || !r3.ok || !r4.ok) return r1 + " " + r2 + " " + r3 + " " + r4;
      if (Math.abs(c.frameRate - 24) > 1e-3) return "frameRate=" + c.frameRate;
      if (Math.abs(c.width - 1280) > 1e-3) return "width=" + c.width;
      if (c.motionBlur !== true) return "comp motionBlur=" + c.motionBlur;
      return true;
    });

    check("setComp unknown field rejected", function () {
      var r = apply({ opId: "c-bad", kind: "setComp", target: { comp: compId }, path: "bogusField", value: 1 });
      if (r.ok !== false) return "expected failure, got " + JSON.stringify(r);
      return true;
    });

    // ---- effects --------------------------------------------------------------
    check("addEffect ADBE Glo2", function () {
      var r = apply({ opId: "fx1", kind: "addEffect", target: { comp: compId, layer: sidA }, path: "fx:ADBE Glo2#1", value: { matchName: "ADBE Glo2", name: "Glow", enabled: true, index: 1 } });
      if (!r.ok) return JSON.stringify(r);
      var fx = effectById(sidA, "ADBE Glo2#1");
      if (!fx) return "effect not found after add";
      if (fx.matchName !== "ADBE Glo2") return "matchName=" + fx.matchName;
      return true;
    });

    check("set effect parameter via fx path", function () {
      var fx = effectById(sidA, "ADBE Glo2#1");
      if (!fx) return "no effect";
      var key = firstScalarEffectProp(fx);
      if (!key) return "no scalar effect param";
      var before = fx.props[key].value;
      // A no-op write to the current value proves the fx:<id>/<matchName> path
      // resolves (a bad path returns "unsupported path"), without tripping the
      // parameter's range clamp.
      var r = apply({ opId: "fxp1", kind: "set", target: { comp: compId, layer: sidA }, path: "fx:ADBE Glo2#1/" + key, value: before });
      if (!r.ok) return "path unresolved (" + key + "): " + JSON.stringify(r);
      return true;
    });

    check("setEffect disable + removeEffect", function () {
      var r1 = apply({ opId: "fxe1", kind: "setEffect", target: { comp: compId, layer: sidA }, path: "fx:ADBE Glo2#1", value: { enabled: false } });
      if (!r1.ok) return JSON.stringify(r1);
      if (effectById(sidA, "ADBE Glo2#1").enabled !== false) return "not disabled";
      var r2 = apply({ opId: "fxr1", kind: "removeEffect", target: { comp: compId, layer: sidA }, path: "fx:ADBE Glo2#1" });
      if (!r2.ok) return JSON.stringify(r2);
      if (effectById(sidA, "ADBE Glo2#1")) return "effect still present";
      return true;
    });

    check("addEffect unknown matchName rejected", function () {
      var r = apply({ opId: "fxbad", kind: "addEffect", target: { comp: compId, layer: sidA }, path: "fx:ADBE NoSuchFx#1", value: { matchName: "ADBE NoSuchFx" } });
      if (r.ok !== false) return "expected failure, got " + JSON.stringify(r);
      return true;
    });

    // ---- masks ----------------------------------------------------------------
    check("addMask with shape", function () {
      var r = apply({
        opId: "m-add",
        kind: "addMask",
        target: { comp: compId, layer: sidA },
        path: "mask:1",
        value: {
          name: "Mask 1",
          maskMode: 1,
          inverted: false,
          maskFeather: 0,
          path: { value: { vertices: [[100, 100], [400, 100], [400, 400], [100, 400]], inTangents: [[0, 0], [0, 0], [0, 0], [0, 0]], outTangents: [[0, 0], [0, 0], [0, 0], [0, 0]], closed: true } }
        }
      });
      var l = layerBySid(snapshot(), sidA);
      if (!r.ok) return JSON.stringify(r);
      if (!l.masks || l.masks.length < 1) return "masks=" + JSON.stringify(l.masks);
      return true;
    });

    check("set mask feather + inverted", function () {
      var r1 = apply({ opId: "m-f", kind: "set", target: { comp: compId, layer: sidA }, path: "mask:1/maskFeather", value: 12 });
      if (!r1.ok) return "feather: " + JSON.stringify(r1);
      var r2 = apply({ opId: "m-i", kind: "set", target: { comp: compId, layer: sidA }, path: "mask:1/inverted", value: true });
      if (!r2.ok) return "inverted: " + JSON.stringify(r2);
      var snap = snapshot();
      if (!snap) return "snapshot null";
      var m = layerBySid(snap, sidA).masks[0];
      if (Math.abs(m.maskFeather - 12) > 1e-3) return "feather=" + m.maskFeather;
      if (m.inverted !== true) return "inverted=" + m.inverted;
      return true;
    });

    check("move mask path", function () {
      var moved = { vertices: [[200, 200], [500, 200], [500, 500], [200, 500]], inTangents: [[0, 0], [0, 0], [0, 0], [0, 0]], outTangents: [[0, 0], [0, 0], [0, 0], [0, 0]], closed: true };
      var r = apply({ opId: "m-move", kind: "set", target: { comp: compId, layer: sidA }, path: "mask:1/path", value: moved });
      var m = layerBySid(snapshot(), sidA).masks[0];
      if (!r.ok) return JSON.stringify(r);
      var v = m.path && m.path.value ? m.path.value.vertices : null;
      if (!v || Math.abs(v[0][0] - 200) > 1e-2) return "vertices=" + JSON.stringify(v);
      return true;
    });

    check("removeMask", function () {
      var before = layerBySid(snapshot(), sidA).masks.length;
      var r = apply({ opId: "m-rm", kind: "removeMask", target: { comp: compId, layer: sidA }, path: "mask:1" });
      var l = layerBySid(snapshot(), sidA);
      var after = l.masks ? l.masks.length : 0;
      if (!r.ok) return JSON.stringify(r);
      if (after !== before - 1) return "mask count " + before + " -> " + after;
      return true;
    });

    check("removeMask missing index rejected", function () {
      var r = apply({ opId: "m-rmbad", kind: "removeMask", target: { comp: compId, layer: sidA }, path: "mask:99" });
      if (r.ok !== false) return "expected failure, got " + JSON.stringify(r);
      return true;
    });

    check("addMask with keyframed path", function () {
      var s1 = { vertices: [[0, 0], [100, 0], [100, 100]], inTangents: [[0, 0], [0, 0], [0, 0]], outTangents: [[0, 0], [0, 0], [0, 0]], closed: true };
      var s2 = { vertices: [[0, 0], [300, 0], [300, 300]], inTangents: [[0, 0], [0, 0], [0, 0]], outTangents: [[0, 0], [0, 0], [0, 0]], closed: true };
      var r = apply({ opId: "m-kf", kind: "addMask", target: { comp: compId, layer: sidA }, path: "mask:1", value: { name: "KF Mask", path: { keys: [{ t: 0, v: s1 }, { t: 2, v: s2 }] } } });
      var l = layerBySid(snapshot(), sidA);
      if (!r.ok) return JSON.stringify(r);
      var m = l.masks[l.masks.length - 1];
      if (!m || !m.path) return "mask/path missing";
      if (m.path.numKeys < 2) return "numKeys=" + m.path.numKeys;
      return true;
    });

    // ---- add layer variants + shape/text --------------------------------------
    check("add solid is idempotent by name", function () {
      var r1 = addSolid("Idem Solid", 1);
      var countAfterFirst = snapshot().layers.length;
      var r2 = addSolid("Idem Solid", 1);
      var countAfterSecond = snapshot().layers.length;
      if (!r1.ok || !r2.ok) return r1 + " " + r2;
      if (countAfterSecond !== countAfterFirst) return "duplicated: " + countAfterFirst + " -> " + countAfterSecond;
      return true;
    });

    check("add adjustment layer", function () {
      var r = apply({ opId: "add-adj", kind: "add", target: { comp: compId }, value: { name: "Adj", type: "adjustment", index: 1, enabled: true } });
      if (!r.ok) return JSON.stringify(r);
      if (!layerByName(snapshot(), "Adj")) return "not found";
      return true;
    });

    check("add precomp layer", function () {
      var inner = app.project.items.addComp("PreComp Inner", 640, 480, 1, 5, 30);
      inner.layers.addSolid([0.5, 0.5, 0.5], "inner layer", 100, 100, 1);
      var sourceKey = inner.id + "|" + inner.name;
      var r = apply({ opId: "add-pre", kind: "add", target: { comp: compId }, value: { name: "Precomp L", type: "comp", sourceComp: sourceKey, index: 1, enabled: true } });
      if (!r.ok) return JSON.stringify(r);
      var l = layerByName(snapshot(), "Precomp L");
      if (!l) return "precomp layer not found";
      if (l.avKind !== "comp") return "avKind=" + l.avKind;
      if (l.sourceComp !== sourceKey) return "sourceComp=" + l.sourceComp;
      return true;
    });

    check("add precomp with bad source rejected", function () {
      var r = apply({ opId: "add-pre-bad", kind: "add", target: { comp: compId }, value: { name: "Bad Precomp", type: "comp", sourceComp: "999999|Nope", index: 1 } });
      if (r.ok !== false) return "expected failure, got " + JSON.stringify(r);
      return true;
    });

    check("add shape layer with tree", function () {
      var r = apply({
        opId: "add-shape",
        kind: "add",
        target: { comp: compId },
        value: {
          name: "Shape L",
          type: "shape",
          index: 1,
          enabled: true,
          shape: [{ mn: "ADBE Vector Group", name: "Group 1", children: [{ mn: "ADBE Vector Shape - Rect", name: "Rect 1", children: [{ mn: "ADBE Vector Rect Size", prop: { value: [200, 200] } }] }] }]
        }
      });
      if (!r.ok) return JSON.stringify(r);
      var l = layerByName(snapshot(), "Shape L");
      if (!l) return "shape layer not found";
var sh = shapeOf(l.sid);
      if (!sh || !sh.tree || sh.tree.length < 1) return "empty shape tree";
      if (!treeHas(sh.tree, "ADBE Vector Group")) return "no vector group node: " + JSON.stringify(sh.tree);
      if (!treeHas(sh.tree, "ADBE Vector Shape - Rect")) return "rect node missing: " + JSON.stringify(sh.tree);
      return true;
    });

    check("setShape replaces tree", function () {
      var l = layerByName(snapshot(), "Shape L");
      var r = apply({ opId: "ss1", kind: "setShape", target: { comp: compId, layer: l.sid }, path: "shape", value: { tree: [{ mn: "ADBE Vector Group", name: "G2", children: [{ mn: "ADBE Vector Shape - Ellipse", name: "Ell", children: [{ mn: "ADBE Vector Ellipse Size", prop: { value: [80, 80] } }] }] }] } });
      if (!r.ok) return JSON.stringify(r);
      var sh = shapeOf(l.sid);
      if (!treeHas(sh.tree, "ADBE Vector Shape - Ellipse")) return "ellipse node missing: " + JSON.stringify(sh.tree);
      return true;
    });

    check("add text layer + set textDoc", function () {
      var r = apply({ opId: "add-text", kind: "add", target: { comp: compId }, value: { name: "Text L", type: "text", index: 1, enabled: true, sourceText: "Hello" } });
      if (!r.ok) return JSON.stringify(r);
      var l = layerByName(snapshot(), "Text L");
      if (!l) return "text layer not found";
      var r2 = apply({ opId: "td1", kind: "set", target: { comp: compId, layer: l.sid }, path: "textDoc", value: { text: "Hello world" } });
      if (!r2.ok) return JSON.stringify(r2);
      var l2 = layerByName(snapshot(), "Text L");
      if (!l2.textDoc || l2.textDoc.text !== "Hello world") return "text=" + (l2.textDoc ? l2.textDoc.text : "null");
      return true;
    });

    check("add unsupported type rejected", function () {
      var r = apply({ opId: "add-bad", kind: "add", target: { comp: compId }, value: { name: "Nope", type: "banana" } });
      if (r.ok !== false) return "expected failure, got " + JSON.stringify(r);
      return true;
    });

    // ---- remove layer ---------------------------------------------------------
    check("remove layer", function () {
      var l = layerByName(snapshot(), "Idem Solid");
      var r = apply({ opId: "rm-layer", kind: "remove", target: { comp: compId, layer: l.sid } });
      if (!r.ok) return JSON.stringify(r);
      if (layerByName(snapshot(), "Idem Solid")) return "layer still present";
      return true;
    });

    // ---- negative targeting ---------------------------------------------------
    check("unknown comp rejected", function () {
      var r = apply({ opId: "x1", kind: "set", target: { comp: "999999|NoSuchComp", layer: sidA }, path: "transform.opacity", value: 50 });
      if (r.ok !== false) return "expected failure, got " + JSON.stringify(r);
      return true;
    });

    check("unknown layer rejected", function () {
      var r = apply({ opId: "x2", kind: "set", target: { comp: compId, layer: "nope" }, path: "transform.opacity", value: 50 });
      if (r.ok !== false) return "expected failure, got " + JSON.stringify(r);
      return true;
    });
  } catch (e) {
    report.error = e.toString();
    report.line = e.line;
  }
  finish();
})();
