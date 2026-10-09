(function () {
  var out = new File(Folder.temp.fsName + "/ae-probe.txt");
  var lines = [];
  function w(s) { lines.push(String(s)); }
  function flush() {
    try {
      out.encoding = "UTF-8";
      out.open("w");
      for (var i = 0; i < lines.length; i++) out.writeln(lines[i]);
      out.close();
    } catch (e) {}
  }

  try {
    w("engine=" + $.engineName);
    w("version=" + app.version);
    w("buildName=" + app.buildName);
    w("hasProject=" + (app.project !== null));
    if (app.project === null) app.newProject();
    var c = app.project.items.addComp("ProbeComp", 1920, 1080, 1, 5, 30);
    c.layers.addSolid([1, 0, 0], "ProbeLayer", 100, 100, 1);
    w("compLayers=" + c.numLayers);
    try { c.openInViewer(); } catch (e1) { w("openInViewer_error=" + e1.toString()); }
    var guard = 0;
    while (app.project.activeItem === null && guard < 3000) { $.sleep(2); guard++; }
    w("activeItemIsComp=" + (app.project.activeItem !== null && app.project.activeItem instanceof CompItem));
    w("done=1");
  } catch (e) {
    w("error=" + e.toString());
  }

  flush();
  app.exitAfterLaunchAndEval = true;
  try { if (app.project) app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES); } catch (e2) {}
  try { app.quit(); } catch (e3) {}
})();
