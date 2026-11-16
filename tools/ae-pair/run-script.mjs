// A timed-out probe can still reach a newly opened panel. It must be read-only.
export async function runHostScript({ probe, execute, launch }, body) {
  let ready = false;
  try { ready = await probe() === 'ready'; } catch {}
  if (!ready) {
    await launch();
    return;
  }
  const result = await execute('(function(){' + body + '\n' + "return 'done';})()");
  if (result !== 'done') throw new Error('host script failed: ' + String(result));
}

export function reopenProjectScript(projPath) {
  const file = JSON.stringify(projPath.replace(/\\/g, '/'));
  return [
    'app.beginSuppressDialogs();',
    'try {',
    '  if(app.project&&app.project.numItems>0&&(!app.project.file||app.project.file.fsName.replace(/\\\\/g,\'/\').toLowerCase()!==' + file + '.toLowerCase()))throw new Error(\'not the disposable test project\');',
    '  if (app.project) app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);',
    '  app.open(new File(' + file + '));',
    // A newer AE major version opens a converted, unsaved project. Save the
    // just-opened fixture at its exact disposable path before attach/shutdown.
    '  app.project.save(new File(' + file + '));',
    '  for (var i = 1; i <= app.project.numItems; i++) {',
    "    if (app.project.item(i) instanceof CompItem && app.project.item(i).name === 'Main') app.project.item(i).openInViewer();",
    '  }',
    '} finally { app.endSuppressDialogs(false); }'
  ];
}
