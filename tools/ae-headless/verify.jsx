(function () {
  var report = { ok: false, steps: [], notes: [] };
  var finalFile = new File(Folder.temp.fsName + "/ae-verify-result.json");
  var tmpFile = new File(Folder.temp.fsName + "/ae-verify-result.tmp");

  function record(name, ok, detail) {
    report.steps.push({ name: name, ok: !!ok, detail: String(detail) });
  }

  function snapshot() {
    var raw = collab.getActiveCompState();
    if (!raw || raw === "null") return null;
    return JSON.parse(raw);
  }

  function finish() {
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

  try {
    var here = new File($.fileName).parent;
    var root = here.parent.parent;
    var jsx = root.fsName.replace(/\\/g, "/") + "/panel/jsx/hostscript.jsx";
    report.hostscriptPath = jsx;

    $.evalFile(jsx);
    record("evalFile hostscript", typeof collab !== "undefined", "typeof collab = " + (typeof collab));

    if (app.project === null) app.newProject();
    var comp = app.project.items.addComp("CollabVerify", 1920, 1080, 1, 10, 30);
    comp.layers.addSolid([1, 0, 0], "Layer A", 500, 500, 1);
    comp.layers.addSolid([0, 1, 0], "Layer B", 500, 500, 1);
    record("created test comp", comp.numLayers === 2, "layers=" + comp.numLayers);

    try { comp.openInViewer(); } catch (e3) { report.notes.push("openInViewer threw: " + e3.toString()); }
    var guard = 0;
    while (app.project.activeItem === null && guard < 3000) { $.sleep(2); guard++; }

    var snap1 = snapshot();
    record("activeItem is comp", snap1 !== null, snap1 ? snap1.comp.name : "getActiveCompState returned null");
    if (!snap1) { finish(); return; }

    var sidA = null;
    var sidB = null;
    var i;
    for (i = 0; i < snap1.layers.length; i++) {
      if (snap1.layers[i].name === "Layer A") sidA = snap1.layers[i].sid;
      if (snap1.layers[i].name === "Layer B") sidB = snap1.layers[i].sid;
    }
    record("layer sids resolved", !!sidA && !!sidB, sidA + " / " + sidB);

    var snap1b = snapshot();
    var sidA2 = null;
    var j;
    for (j = 0; j < snap1b.layers.length; j++) if (snap1b.layers[j].name === "Layer A") sidA2 = snap1b.layers[j].sid;
    record("sid stable across polls", sidA === sidA2, sidA + " == " + sidA2);

    function apply(op) {
      return JSON.parse(collab.applyOp(JSON.stringify(op)));
    }

    function findLayer(list, sid) {
      for (var z = 0; z < list.length; z++) if (list[z].sid === sid) return list[z];
      return null;
    }

    var compId = snap1.comp.id;

    var r1 = apply({ opId: "v1", kind: "set", target: { comp: compId, layer: sidA }, path: "transform.position", value: [123, 456] });
    var p1 = findLayer(snapshot().layers, sidA);
    var posA = p1 ? p1.transform.position.value : null;
    record("set transform.position", r1.ok === true && posA && Math.abs(posA[0] - 123) < 1e-3 && Math.abs(posA[1] - 456) < 1e-3, JSON.stringify(posA));

    var r2 = apply({ opId: "v2", kind: "set", target: { comp: compId, layer: sidA }, path: "enabled", value: false });
    var p2 = findLayer(snapshot().layers, sidA);
    record("set enabled false", r2.ok === true && p2 && p2.enabled === false, "enabled=" + (p2 ? p2.enabled : "n/a"));

    var r3 = apply({ opId: "v3", kind: "set", target: { comp: compId, layer: sidA }, path: "name", value: "Layer A2" });
    var p3 = findLayer(snapshot().layers, sidA);
    record("set name", r3.ok === true && p3 && p3.name === "Layer A2", "name=" + (p3 ? p3.name : "n/a"));

    var r4 = apply({ opId: "k1", kind: "addKey", target: { comp: compId, layer: sidA }, path: "transform.position", value: [0, 0], time: 0 });
    var r5 = apply({ opId: "k2", kind: "addKey", target: { comp: compId, layer: sidA }, path: "transform.position", value: [100, 100], time: 2 });
    var kp = findLayer(snapshot().layers, sidA).transform.position;
    record("addKey x2", r4.ok === true && r5.ok === true && kp.numKeys === 2 && kp.keys && kp.keys.length === 2, "numKeys=" + kp.numKeys);

    var r6 = apply({ opId: "k3", kind: "setKey", target: { comp: compId, layer: sidA }, path: "transform.position", value: [50, 60], time: 2 });
    var kp2 = findLayer(snapshot().layers, sidA).transform.position;
    var val2 = null;
    if (kp2.keys) for (var q = 0; q < kp2.keys.length; q++) if (Math.abs(kp2.keys[q].t - 2) < 1e-4) val2 = kp2.keys[q].v;
    record("setKey at t=2", r6.ok === true && val2 && Math.abs(val2[0] - 50) < 1e-3, JSON.stringify(val2));

    var r7 = apply({ opId: "k4", kind: "removeKey", target: { comp: compId, layer: sidA }, path: "transform.position", time: 2 });
    var kp3 = findLayer(snapshot().layers, sidA).transform.position;
    record("removeKey at t=2", r7.ok === true && kp3.numKeys === 1, "numKeys=" + kp3.numKeys);

    var r8 = apply({ opId: "o1", kind: "set", target: { comp: compId, layer: sidB }, path: "transform.opacity", value: 42 });
    var p8 = findLayer(snapshot().layers, sidB);
    record("set opacity", r8.ok === true && p8 && p8.transform.opacity.value === 42, "opacity=" + (p8 ? p8.transform.opacity.value : "n/a"));

    var r9 = apply({ opId: "x1", kind: "set", target: { comp: "999999|NoSuchComp", layer: sidA }, path: "transform.opacity", value: 50 });
    record("unknown comp rejected", r9.ok === false, JSON.stringify(r9));

    var r10 = apply({ opId: "x2", kind: "set", target: { comp: compId, layer: "nope" }, path: "transform.opacity", value: 50 });
    record("unknown layer rejected", r10.ok === false, JSON.stringify(r10));

    report.compId = compId;
    report.ok = true;
  } catch (e) {
    report.error = e.toString();
    report.line = e.line;
    report.ok = false;
  }
  finish();
})();
