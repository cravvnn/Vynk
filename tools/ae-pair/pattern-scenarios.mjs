import os from 'node:os';
import path from 'node:path';
import { pngPixels } from './png.mjs';

const pattern = "var c=vynkPair.comp('PatternStyles'),l=vynkPair.layer(c,'Pattern'),p=l.property('ADBE Layer Styles').property('patternFill/enabled');";

async function render(h, who) {
  const file = path.join(os.tmpdir(), 'vynk-pair', 'pattern-' + who + '.png');
  const got = await h.jsx(who, `(function(){var c=vynkPair.comp('PatternStyles');c.saveFrameToPng(1,new File(${JSON.stringify(file.replace(/\\/g, '/'))}));return 'ok';})()`);
  if (got !== 'ok') throw Error('pattern render: ' + got);
  return pngPixels(file);
}

export const patternScenarios = [
  {
    name: 'pattern overlay: opacity scale and offset in an unopened comp', who: 'A', timeout: 30000,
    jsx: pattern + "p.property('patternFill/opacity').setValue(80);p.property('patternFill/scale').setValue(150);p.property('patternFill/phase').setValue([12,24]);"
  },
  {
    name: 'pattern overlay: peer toggles the embedded pattern', who: 'B', timeout: 30000,
    jsx: pattern + 'p.enabled=false;'
  },
  {
    name: 'pattern overlay: animate scale and offset', who: 'A', timeout: 30000,
    jsx: pattern + "p.enabled=true;var scale=p.property('patternFill/scale');scale.setValueAtTime(0,50);scale.setValueAtTime(2,125);var phase=p.property('patternFill/phase');phase.setValueAtTime(0,[0,0]);phase.setValueAtTime(2,[24,12]);"
  },
  {
    name: 'pattern overlay: full layer upsert preserves artwork', who: 'A', timeout: 30000, allowUnchanged: true,
    async run(h) {
      const raw = await h.jsx('A', "(function(){var c=vynkPair.comp('PatternStyles');var r=JSON.parse(vynkSync.cycle(JSON.stringify({read:[{c:'id'+c.id,all:1}],must:1})));for(var i=0;i<r.snaps.length;i++){if(r.snaps[i].id.indexOf('|PatternStyles')>0)return JSON.stringify(r.snaps[i]);}return 'no snapshot';})()");
      const snap = JSON.parse(raw), layer = snap.layers[0];
      const op = { opId: 'pattern-upsert', kind: 'add', target: { comp: snap.id, layer: layer.sid }, value: { layer, after: null } };
      const result = await h.jsx('B', 'vynkSync.cycle(' + JSON.stringify(JSON.stringify({ ops: [op], must: 1, read: [{ c: snap.id.split('|')[0], all: 1 }], focused: 0 })) + ')');
      const out = JSON.parse(result);
      if (out.r[0]) throw Error('pattern repair: ' + out.r[0]);
      return 'ok';
    }
  },
  {
    name: 'pattern overlay: rendered pattern pixels match across AE versions', who: 'A', allowUnchanged: true, timeout: 30000,
    async run(h) {
      const a = await render(h, 'A'), b = await render(h, 'B');
      if (a.width !== 256 || a.height !== 256 || a.hash !== b.hash) throw Error('pattern renders differ');
      const colors = new Set();
      for (let i = 0; i < a.pixels.length; i += a.channels) colors.add(a.pixels.subarray(i, i + 3).toString('hex'));
      if (colors.size < 2) throw Error('pattern artwork is missing');
      return 'ok';
    }
  }
];
