// Edit scenarios for the two-instance harness. `jsx` is an ES3 function body
// run inside After Effects with `comp` (the Main comp), `L(name)` (layer by
// name) and `vynkPair` in scope. `who` is the instance that makes the edit.
export const scenarios = [
  { name: 'set position', who: 'A', jsx: `L('Red').property('ADBE Transform Group').property('ADBE Position').setValue([400, 300]);` },
  // activeItem is empty or a non-comp whenever focus is outside a comp viewer.
  { name: 'edit while the Project panel has focus', who: 'A', jsx: `for (var f = 1; f <= app.project.numItems; f++) { var it = app.project.item(f); it.selected = (it instanceof FolderItem && it.name === 'Solids'); } L('Blue').property('ADBE Transform Group').property('ADBE Rotate Z').setValue(12);` },
  { name: 'set opacity/rotation/scale', who: 'A', jsx: `var t = L('Green').property('ADBE Transform Group'); t.property('ADBE Opacity').setValue(42); t.property('ADBE Rotate Z').setValue(33); t.property('ADBE Scale').setValue([50, 60]);` },
  { name: 'B edits position', who: 'B', jsx: `L('Blue').property('ADBE Transform Group').property('ADBE Position').setValue([111, 222]);` },
  { name: 'add 3 position keys', who: 'A', jsx: `var p = L('Blue').property('ADBE Transform Group').property('ADBE Position'); p.setValueAtTime(0, [100, 100]); p.setValueAtTime(1, [900, 500]); p.setValueAtTime(2, [300, 800]);` },
  { name: 'change key value + remove key', who: 'A', jsx: `var p = L('Blue').property('ADBE Transform Group').property('ADBE Position'); p.setValueAtKey(2, [1000, 600]); p.removeKey(3);` },
  { name: 'key interpolation hold', who: 'A', jsx: `var p = L('Blue').property('ADBE Transform Group').property('ADBE Position'); p.setInterpolationTypeAtKey(1, KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD);` },
  { name: 'opacity keys with easy ease', who: 'A', jsx: `var p = L('Red').property('ADBE Transform Group').property('ADBE Opacity'); p.setValueAtTime(0, 0); p.setValueAtTime(2, 100); var e = new KeyframeEase(0, 75); p.setTemporalEaseAtKey(1, [e], [e]); p.setTemporalEaseAtKey(2, [e], [e]);` },
  { name: 'rename layer', who: 'A', jsx: `L('Green').name = 'Emerald';` },
  { name: 'enable off + trim in/out', who: 'A', jsx: `var l = L('Emerald'); l.enabled = false; l.inPoint = 1; l.outPoint = 6;` },
  { name: 'move layer in time', who: 'A', jsx: `L('Red').startTime = 1.5;` },
  { name: 'add solid', who: 'A', jsx: `comp.layers.addSolid([1, 1, 0], 'Yellow', 1920, 1080, 1, 10);` },
  { name: 'B adds solid', who: 'B', jsx: `comp.layers.addSolid([0, 1, 1], 'Cyan', 1920, 1080, 1, 10);` },
  { name: 'edit layer added by peer', who: 'B', jsx: `L('Yellow').property('ADBE Transform Group').property('ADBE Opacity').setValue(55);` },
  { name: 'add null + parent to it', who: 'A', jsx: `var n = comp.layers.addNull(10); n.name = 'Rig'; L('Red').parent = n;` },
  { name: 'unparent', who: 'A', jsx: `L('Red').parent = null;` },
  { name: 'add text layer', who: 'A', jsx: `var t = comp.layers.addText('hello'); t.name = 'Caption';` },
  { name: 'edit text', who: 'A', jsx: `var p = L('Caption').property('ADBE Text Properties').property('ADBE Text Document'); var d = p.value; d.text = 'hello world'; p.setValue(d);` },
  { name: 'text font size', who: 'A', jsx: `var p = L('Caption').property('ADBE Text Properties').property('ADBE Text Document'); var d = p.value; d.fontSize = 120; p.setValue(d);` },
  { name: 'add shape layer', who: 'A', jsx: `var s = comp.layers.addShape(); s.name = 'Box'; var g = s.property('ADBE Root Vectors Group'); var r = g.addProperty('ADBE Vector Shape - Rect'); r.property('ADBE Vector Rect Size').setValue([300, 200]); var f = g.addProperty('ADBE Vector Graphic - Fill'); f.property('ADBE Vector Fill Color').setValue([1, 0, 0, 1]);` },
  { name: 'edit shape size', who: 'A', jsx: `L('Box').property('ADBE Root Vectors Group').property('ADBE Vector Shape - Rect').property('ADBE Vector Rect Size').setValue([640, 120]);`, timeout: 20000 },
  { name: 'add effect (gaussian blur)', who: 'A', jsx: `var fx = L('Blue').property('ADBE Effect Parade').addProperty('ADBE Gaussian Blur 2'); fx.property('ADBE Gaussian Blur 2-0001').setValue(25);`, timeout: 20000 },
  { name: 'change effect param', who: 'A', jsx: `L('Red').property('ADBE Effect Parade').property(1).property('ADBE Gaussian Blur 2-0001').setValue(77);`, timeout: 20000 },
  { name: 'keyframe effect param', who: 'A', jsx: `var p = L('Red').property('ADBE Effect Parade').property(1).property('ADBE Gaussian Blur 2-0001'); p.setValueAtTime(0, 0); p.setValueAtTime(3, 90);`, timeout: 20000 },
  { name: 'disable effect', who: 'A', jsx: `L('Red').property('ADBE Effect Parade').property(1).enabled = false;`, timeout: 20000 },
  { name: 'remove effect', who: 'A', jsx: `L('Blue').property('ADBE Effect Parade').property(1).remove();`, timeout: 20000 },
  { name: 'add mask', who: 'A', jsx: `var m = L('Red').property('ADBE Mask Parade').addProperty('ADBE Mask Atom'); var sh = new Shape(); sh.vertices = [[100, 100], [800, 100], [800, 600], [100, 600]]; sh.closed = true; m.property('ADBE Mask Shape').setValue(sh);` },
  { name: 'move mask + feather', who: 'A', jsx: `var m = L('Red').property('ADBE Mask Parade').property(1); var sh = new Shape(); sh.vertices = [[200, 150], [900, 150], [900, 700], [200, 700]]; sh.closed = true; m.property('ADBE Mask Shape').setValue(sh); m.property('ADBE Mask Feather').setValue([30, 30]);` },
  { name: 'reorder layer to top', who: 'A', jsx: `L('Red').moveToBeginning();` },
  { name: 'reorder layer to bottom', who: 'B', jsx: `L('Blue').moveToEnd();` },
  { name: 'expression on rotation', who: 'A', jsx: `L('Emerald').property('ADBE Transform Group').property('ADBE Rotate Z').expression = 'time * 90';` },
  { name: 'comp duration + bg color', who: 'A', jsx: `comp.duration = 12; comp.bgColor = [0.1, 0.2, 0.3];` },
  { name: 'duplicate plain layer', who: 'A', jsx: `L('Blue').duplicate();` },
  { name: 'duplicate peer-created layer', who: 'A', jsx: `L('Cyan').duplicate();` },
  { name: 'edit the duplicate', who: 'A', jsx: `comp.layer(L('Cyan').index - 1).property('ADBE Transform Group').property('ADBE Opacity').setValue(20);` },
  { name: 'duplicate layer with effect+keys', who: 'A', jsx: `var d = L('Red').duplicate(); d.name = 'Red Copy';` , timeout: 20000 },
  { name: 'blending mode', who: 'A', jsx: `L('Yellow').blendingMode = BlendingMode.ADD;` },
  { name: '3D layer + z position', who: 'A', jsx: `var l = L('Yellow'); l.threeDLayer = true; l.property('ADBE Transform Group').property('ADBE Position').setValue([960, 540, -300]);` },
  { name: 'label colour', who: 'A', jsx: `L('Yellow').label = 9;` },
  { name: 'peer locks a layer locally', who: 'B', jsx: `L('Cyan').locked = true;` },
  { name: 'edit a layer the peer has locked', who: 'A', jsx: `L('Cyan').property('ADBE Transform Group').property('ADBE Opacity').setValue(64);` },
  { name: 'peer unlocks', who: 'B', jsx: `L('Cyan').locked = false;` },
  { name: 'time stretch', who: 'A', jsx: `L('Yellow').stretch = 50;` },
  { name: 'track matte', who: 'A', jsx: `L('Emerald').enabled = true; L('Emerald').trackMatteType = TrackMatteType.ALPHA;` },
  { name: 'layer marker', who: 'A', jsx: `L('Yellow').property('ADBE Marker').setValueAtTime(1, new MarkerValue('beat'));` },
  { name: 'comp marker', who: 'A', jsx: `comp.markerProperty.setValueAtTime(2, new MarkerValue('drop'));` },
  { name: 'time remap on precomp', who: 'A', jsx: `L('Nested').timeRemapEnabled = true;` },
  { name: 'layer style: add drop shadow', who: 'A', timeout: 20000, jsx: `L('Red').selected = true; app.executeCommand(9000);` },
  { name: 'layer style: change its values', who: 'A', timeout: 20000, jsx: `var d = L('Red').property('ADBE Layer Styles').property('dropShadow/enabled'); d.property(2).setValue([1, 0, 0, 1]); d.property(5).setValue(40);` },
  { name: 'layer style: add stroke too', who: 'A', timeout: 20000, jsx: `L('Red').selected = true; app.executeCommand(9008); L('Red').property('ADBE Layer Styles').property('frameFX/enabled').property('frameFX/size').setValue(12);` },
  { name: 'layer style: hide one', who: 'A', timeout: 20000, jsx: `L('Red').property('ADBE Layer Styles').property('dropShadow/enabled').enabled = false;` },
  { name: 'layer style: peer edits it', who: 'B', timeout: 20000, jsx: `L('Red').property('ADBE Layer Styles').property('frameFX/enabled').property('frameFX/size').setValue(3);` },
  { name: 'layer style: remove all', who: 'A', timeout: 20000, jsx: `L('Red').selected = true; app.executeCommand(2072);` },
  { name: 'add camera', who: 'A', jsx: `var c = comp.layers.addCamera('Cam', [960, 540]);` },
  { name: 'add light', who: 'A', jsx: `comp.layers.addLight('Sun', [960, 540]);` },
  { name: 'burst: 40 edits at once', who: 'A', jsx: `for (var i = 1; i <= comp.numLayers; i++) { var l = comp.layer(i); if (l.locked) continue; var t = l.property('ADBE Transform Group'); try { t.property('ADBE Opacity').setValue(10 + i); t.property('ADBE Rotate Z').setValue(i * 3); t.property('ADBE Anchor Point').setValue(t.property('ADBE Anchor Point').value.length > 2 ? [i, i, 0] : [i, i]); } catch (e) {} }`, timeout: 20000 },
  { name: 'both edit different layers at once', who: 'A', also: { who: 'B', jsx: `L('Cyan').property('ADBE Transform Group').property('ADBE Scale').setValue([33, 33]);` }, jsx: `L('Yellow').property('ADBE Transform Group').property('ADBE Scale').setValue([77, 77]);` },
  { name: 'both edit the same property at once', who: 'A', also: { who: 'B', jsx: `L('Rig').property('ADBE Transform Group').property('ADBE Rotate Z').setValue(-45);` }, jsx: `L('Rig').property('ADBE Transform Group').property('ADBE Rotate Z').setValue(45);`, timeout: 15000 },
  { name: 'undo last edit', who: 'A', jsx: `L('Rig').property('ADBE Transform Group').property('ADBE Opacity').setValue(5);`, then: { who: 'A', raw: `app.executeCommand(16); 'ok'` } },
  { name: 'script edits an unselected layer', who: 'A', select: false, timeout: 30000, jsx: `L('Blue').property('ADBE Transform Group').property('ADBE Opacity').setValue(71);` },
  { name: 'remove layer', who: 'A', jsx: `L('Rig').remove();` },
  { name: 'B removes layer', who: 'B', jsx: `L('Caption').remove();` },
  { name: 'edit in background comp', who: 'A', jsx: `vynkPair.layer(vynkPair.comp('Other'), 'Inner').property('ADBE Transform Group').property('ADBE Opacity').setValue(30);` },
  { name: 'add layer in background comp', who: 'A', jsx: `vynkPair.comp('Other').layers.addSolid([1, 0, 1], 'Magenta', 1920, 1080, 1, 10);` },
  { name: 'create new comp', who: 'A', jsx: `app.project.items.addComp('Fresh', 1280, 720, 1, 5, 24);` },
  { name: 'create folder + move comp', who: 'A', jsx: `var f = app.project.items.addFolder('Bin'); vynkPair.comp('Other').parentFolder = f;` },
  { name: 'precompose two layers', who: 'A', jsx: `comp.layers.precompose([L('Yellow').index, L('Cyan').index], 'Pre', true);`, timeout: 20000 },
  // Self-repair. `before` edits the panel's own idea of the shared state so the
  // following change is invisible to it: the two projects drift apart silently.
  { name: 'repair: silent drift on one value', who: 'B', select: false, timeout: 60000, before: { who: 'B', js: "(function(){var c=state.shadows[state.lastActiveSid];if(!c)return 'no shadow';for(var i=0;i<c.layers.length;i++){if(c.layers[i].a.name==='Blue'){c.layers[i].p['ADBE Transform Group/ADBE Opacity']={v:5,m:1};return 'ok';}}return 'no layer';})()" }, jsx: `L('Blue').property('ADBE Transform Group').property('ADBE Opacity').setValue(5);` },
  { name: 'repair: peer silently lost a layer, then it is edited', who: 'A', timeout: 60000, before: { who: 'B', js: "(function(){var c=state.shadows[state.lastActiveSid];if(!c)return 'no shadow';for(var i=0;i<c.layers.length;i++){if(c.layers[i].a.name==='Emerald'){c.layers.splice(i,1);cs.evalScript(\"(function(){var c=vynkPair.comp('Main');vynkPair.layer(c,'Emerald').remove();})()\");return 'ok';}}return 'no layer';})()" }, jsx: `L('Emerald').property('ADBE Transform Group').property('ADBE Opacity').setValue(81);` },
  // B leaves, A keeps working, B comes back as a brand-new session on its now
  // stale project. Nothing is replayed: self-repair has to bring B up to date.
  {
    name: 'late joiner catches up with the room', who: 'A', timeout: 90000,
    run: async (h) => {
      await h.js('B', "wantConnected = false; disconnect(); 'ok'");
      await h.sleep(1500);
      const edit = "L('Blue').property('ADBE Transform Group').property('ADBE Scale').setValue([44, 44]); comp.layers.addSolid([0.3, 0.3, 0.9], 'WhileAway', 1920, 1080, 1, 10); L('Sun').remove(); app.project.items.addComp('MadeWhileAway', 800, 600, 1, 4, 25)";
      const out = await h.jsx('A', h.wrap(edit));
      await h.sleep(4000);
      await h.js('B', "later(function () { location.reload(); }, 50); 'ok'");
      await h.sleep(2500);
      await h.waitFor(() => h.obs.has('B'), 30000, 'B to rejoin');
      return out;
    }
  },
  // ---- Repair of comps nobody has open (B joined last, so A is the reference)
  {
    name: 'background comp: silent drift is repaired', who: 'B', timeout: 90000,
    before: { who: 'B', js: "(function(){var c=null;for(var k in state.shadows){if(state.shadows[k].id.split('|')[1]==='Other')c=state.shadows[k];}if(!c)return 'no shadow for Other';for(var i=0;i<c.layers.length;i++){if(c.layers[i].a.name==='Inner'){c.layers[i].p['ADBE Transform Group/ADBE Opacity']={v:12,m:1};cs.evalScript(\"vynkPair.layer(vynkPair.comp('Other'),'Inner').property('ADBE Transform Group').property('ADBE Opacity').setValue(12)\");return 'ok';}}return 'no layer Inner';})()" },
    jsx: `var unused = 1;`
  },
  {
    name: 'background comp: lost layer, then edited', who: 'A', timeout: 90000,
    before: { who: 'B', js: "(function(){var c=null;for(var k in state.shadows){if(state.shadows[k].id.split('|')[1]==='Other')c=state.shadows[k];}if(!c)return 'no shadow for Other';for(var i=0;i<c.layers.length;i++){if(c.layers[i].a.name==='Inner'){c.layers.splice(i,1);cs.evalScript(\"vynkPair.layer(vynkPair.comp('Other'),'Inner').remove()\");return 'ok';}}return 'no layer Inner';})()" },
    jsx: `vynkPair.layer(vynkPair.comp('Other'), 'Inner').property('ADBE Transform Group').property('ADBE Rotate Z').setValue(15);`
  },
  {
    name: 'layer style in a comp the peer does not have open', who: 'A', timeout: 90000,
    run: async (h) => {
      const out = await h.jsx('A', "(function(){try{var o=vynkPair.comp('Other');o.openInViewer();var l=vynkPair.layer(o,'Inner');for(var i=1;i<=o.numLayers;i++)o.layer(i).selected=(o.layer(i)===l);app.executeCommand(9006);return 'ok';}catch(e){return 'ERR '+e;}})()");
      await h.sleep(6000);
      await h.jsx('B', "(function(){vynkPair.comp('Other').openInViewer();return 'ok';})()");
      return out;
    }
  },
  {
    name: 'both go back to Main', who: 'A',
    run: async (h) => {
      for (const w of ['A', 'B']) await h.jsx(w, "(function(){vynkPair.comp('Main').openInViewer();return 'ok';})()");
      return 'ok';
    }
  },
  // ---- Stability: both people edit at random across two comps for a minute.
  {
    name: 'soak: 60 s of random edits by both in two comps', who: 'A', timeout: 150000,
    run: async (h) => {
      let seed = 1234567;
      const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
      const props = ['ADBE Opacity', 'ADBE Rotate Z', 'ADBE Scale', 'ADBE Position'];
      const end = Date.now() + 60000;
      let n = 0;
      let errors = 0;
      while (Date.now() < end) {
        const who = rnd() < 0.5 ? 'A' : 'B';
        const comp = rnd() < 0.6 ? 'Main' : 'Other';
        const prop = props[Math.floor(rnd() * props.length)];
        const pick = rnd();
        const v = Math.round(rnd() * 90);
        const value = prop === 'ADBE Opacity' || prop === 'ADBE Rotate Z' ? String(v) : prop === 'ADBE Scale' ? '[' + (20 + v) + ',' + (20 + v) + ']' : '[' + v * 10 + ',' + v * 6 + ']';
        const code = "(function(){try{var c=vynkPair.comp('" + comp + "');var cand=[];for(var i=1;i<=c.numLayers;i++){var l=c.layer(i);if(!l.locked&&(l instanceof AVLayer))cand.push(l);}" +
          "if(!cand.length)return 'none';var l=cand[Math.floor(" + pick + "*cand.length)];var p=l.property('ADBE Transform Group').property('" + prop + "');if(p.numKeys>0||p.expression)return 'skip';" +
          "var cur=p.value;var v=" + value + ";if(cur instanceof Array&&v instanceof Array){while(v.length<cur.length)v.push(cur[v.length]);}p.setValue(v);return 'ok';}catch(e){return 'ERR '+e;}})()";
        const r = await h.jsx(who, code);
        if (String(r).indexOf('ERR') === 0) errors++;
        n++;
        await h.sleep(250 + Math.floor(rnd() * 500));
      }
      return errors ? 'ERR ' + errors + ' of ' + n + ' edits failed' : 'ok';
    }
  },
  { name: 'stress: 100 layers with keys and effects', who: 'A', timeout: 120000, jsx: `for (var i = 0; i < 100; i++) { var s = comp.layers.addSolid([0.2, 0.4, 0.6], 'S' + i, 1920, 1080, 1, 10); var p = s.property('ADBE Transform Group').property('ADBE Position'); for (var k = 0; k < 20; k++) p.setValueAtTime(k * 0.4, [k * 50, i * 10]); s.property('ADBE Effect Parade').addProperty('ADBE Gaussian Blur 2').property('ADBE Gaussian Blur 2-0001').setValue(i); }` },
  { name: 'edit inside the 100-layer comp', who: 'A', jsx: `L('S50').property('ADBE Transform Group').property('ADBE Opacity').setValue(12);` },
  { name: 'peer edits inside the 100-layer comp', who: 'B', jsx: `L('S20').property('ADBE Transform Group').property('ADBE Rotate Z').setValue(77);` },
];
