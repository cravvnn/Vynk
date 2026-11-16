const PRESETS = 'C:/Program Files/Adobe/Adobe After Effects 2025/Support Files/Presets/Image - Creative/';
let variants = [];
let expected = '';

async function address(h, who, name) {
  return JSON.parse(await h.jsx(who, `(function(){var c=vynkPair.comp('Main'),l=vynkPair.layer(c,${JSON.stringify(name)});return JSON.stringify([c.id,l.id]);})()`));
}

async function read(h, who, name = 'Blue') {
  const ids = await address(h, who, name);
  const response = await h.native(who, 'ARBGET', ids);
  if (!response.startsWith('ok\t')) throw Error(who + ': ' + response.slice(0, 100));
  const fields = response.split('\t')[1].split(';')[0].split(':');
  if (fields.length !== 4) throw Error('missing custom data on ' + name);
  return { ids, fx: fields[0], param: fields[1], body: fields[3] };
}

async function write(h, who, body, name = 'Blue') {
  const target = await read(h, who, name);
  const reply = await h.native(who, 'ARBSET', [...target.ids, target.fx, target.param, body]);
  if (reply !== 'ok') throw Error('ARBSET: ' + reply);
  if ((await read(h, who, name)).body !== body) throw Error('source native readback differs');
}

async function same(h, name = 'Blue', wanted = expected) {
  try {
    const a = await read(h, 'A', name);
    const b = await read(h, 'B', name);
    if (a.body !== wanted) return 'source custom data differs from the requested animation';
    return a.body === b.body ? '' : 'custom data / key times / interpolation differ';
  } catch (e) { return String(e); }
}

const sequence = rows => 'K' + rows.map(([time, index, interp = 1, ease = '', flags = 0]) =>
  '|' + [time, interp, interp, flags, ease, variants[index]].join(',')).join('');

async function hold(h, who, fn) {
  const held = await h.waitFor(async () => await h.js(who, '(function(){if(state.cycleBusy)return "busy";state.baseHold="custom-data-fixture";return "held";})()') === 'held', 15000);
  if (!held) throw Error('source never became idle');
  try { await fn(); }
  finally { await h.js(who, 'state.baseHold=""; kickCycle(0); "ok"'); }
}

export const customDataScenarios = [
  {
    name: 'curves: animate distinct values with linear and hold keys', who: 'A', timeout: 30000,
    async run(h) {
      await hold(h, 'A', async () => {
        variants = [];
        for (const preset of ['Contrast - luminance.ffx', 'Grayscale 4.ffx']) {
          const made = await h.jsx('A', `(function(){var c=vynkPair.comp('Main'),l=c.layers.addSolid([0.5,0.5,0.5],'KeyCurveSource',100,100,1,10);l.applyPreset(new File(${JSON.stringify(PRESETS + preset)}));return 'ok';})()`);
          if (made !== 'ok') throw Error(made);
          variants.push((await read(h, 'A', 'KeyCurveSource')).body);
          await h.jsx('A', "var l=vynkPair.layer(vynkPair.comp('Main'),'KeyCurveSource'),src=l.source;l.remove();if(src.usedIn.length===0)src.remove(); 'ok'");
        }
        if (variants[0] === variants[1]) throw Error('fixture curves must differ');
        expected = sequence([['0/1', 0], ['2/1', 1, 3]]);
        await write(h, 'A', expected);
      });
      await h.jsx('A', "vynkPair.comp('Main').time=1; 'ok'");
      await h.jsx('B', "vynkPair.comp('Main').time=4; 'ok'");
      return 'ok';
    }, check: h => same(h)
  },
  {
    name: 'curves: peer changes key values and fractional times', who: 'B', timeout: 30000, allowUnchanged: true,
    async run(h) {
      expected = sequence([['-1/3', 1], ['7/3', 0, 3], ['11/3', 1]]);
      await write(h, 'B', expected);
      return 'ok';
    }, check: h => same(h)
  },
  {
    name: 'curves: Bezier key interpolation and temporal ease', who: 'A', timeout: 30000, allowUnchanged: true,
    async run(h) {
      expected = sequence([['0/1', 0, 2, '0~0.66~0~0.77'], ['2/1', 1, 2, '0~0.6~0~0.7']]);
      await write(h, 'A', expected);
      return 'ok';
    }, check: h => same(h)
  },
  {
    name: 'curves: timing attributes and key values in the same batch', who: 'A', timeout: 30000,
    async run(h) {
      await hold(h, 'A', async () => {
        const got = await h.jsx('A', "vynkPair.layer(vynkPair.comp('Main'),'Blue').startTime=1.5; 'ok'");
        if (got !== 'ok') throw Error(got);
        expected = sequence([['2/1', 1], ['4/1', 0, 3]]);
        await write(h, 'A', expected);
      });
      return 'ok';
    }, check: h => same(h)
  },
  {
    name: 'curves: reversed layer stretch preserves animated keys', who: 'B', timeout: 30000,
    async run(h) {
      await hold(h, 'B', async () => {
        const got = await h.jsx('B', "var l=vynkPair.layer(vynkPair.comp('Main'),'Blue');l.stretch=-50;l.startTime=5; 'ok'");
        if (got !== 'ok') throw Error(got);
        expected = sequence([['1/3', 0], ['7/3', 1, 3]]);
        await write(h, 'B', expected);
      });
      return 'ok';
    }, check: h => same(h)
  },
  {
    name: 'curves: remove a custom-data key', who: 'A', timeout: 30000,
    async run(h) {
      const got = await h.jsx('A', "(function(){var l=vynkPair.layer(vynkPair.comp('Main'),'Blue'),fx=l.property('ADBE Effect Parade');for(var i=1;i<=fx.numProperties;i++){if(fx.property(i).matchName==='ADBE CurvesCustom'){fx.property(i).property('ADBE CurvesCustom-0001').removeKey(2);return 'ok';}}return 'no curve';})()");
      if (got !== 'ok') throw Error(got);
      expected = (await read(h, 'A')).body;
      if (expected.split('|').length !== 2) throw Error('expected exactly one remaining native key');
      return 'ok';
    }, check: h => same(h)
  },
  {
    name: 'curves: animated control returns to a static value', who: 'B', timeout: 30000,
    async run(h) { expected = variants[1]; await write(h, 'B', expected); return 'ok'; },
    check: h => same(h)
  },
  {
    name: 'curves: new layer arrives with an animated custom control', who: 'A', timeout: 30000,
    async run(h) {
      await hold(h, 'A', async () => {
        const got = await h.jsx('A', `(function(){var c=vynkPair.comp('Main'),l=c.layers.addSolid([0.3,0.4,0.7],'AnimatedCurve',320,180,1,10);l.applyPreset(new File(${JSON.stringify(PRESETS + 'Contrast - luminance.ffx')}));return 'ok';})()`);
        if (got !== 'ok') throw Error(got);
        expected = sequence([['0/1', 0], ['3/1', 1, 3]]);
        await write(h, 'A', expected, 'AnimatedCurve');
      });
      return 'ok';
    }, check: h => same(h, 'AnimatedCurve')
  },
  {
    name: 'curves: duplicate retains every animated custom value', who: 'A', timeout: 30000,
    jsx: "var d=L('AnimatedCurve').duplicate();d.name='AnimatedCurve Copy';",
    check: h => same(h, 'AnimatedCurve Copy')
  },
  {
    name: 'curves: animated edit reaches a locally locked peer layer', who: 'A', timeout: 30000, allowUnchanged: true,
    async run(h) {
      await h.jsx('B', "vynkPair.layer(vynkPair.comp('Main'),'AnimatedCurve').locked=true; 'ok'");
      expected = sequence([['0/1', 1], ['2/1', 0, 3]]);
      await write(h, 'A', expected, 'AnimatedCurve');
      return 'ok';
    },
    async check(h) {
      const error = await same(h, 'AnimatedCurve');
      if (error) return error;
      const locked = await h.jsx('B', "String(vynkPair.layer(vynkPair.comp('Main'),'AnimatedCurve').locked)");
      if (locked !== 'true') return 'native apply changed the peer local lock';
      await h.jsx('B', "vynkPair.layer(vynkPair.comp('Main'),'AnimatedCurve').locked=false; 'ok'");
      return '';
    }
  },
  {
    name: 'curves: undo restores the full custom animation', who: 'B', timeout: 30000, allowUnchanged: true,
    async run(h) {
      const original = (await read(h, 'B', 'AnimatedCurve')).body;
      const changed = sequence([['1/1', 1], ['4/1', 0]]);
      await write(h, 'B', changed, 'AnimatedCurve');
      if (!await h.waitFor(async () => (await read(h, 'A', 'AnimatedCurve')).body === changed, 20000)) throw Error('peer never saw the edit before undo');
      await h.jsx('B', "app.executeCommand(16); 'ok'");
      expected = original;
      return 'ok';
    },
    async check(h) {
      const error = await same(h, 'AnimatedCurve');
      if (error) return error;
      const times = [];
      for (const who of ['A', 'B']) times.push(Number(await h.jsx(who, "String(vynkPair.comp('Main').time)")));
      return times[0] === 1 && times[1] === 4 ? '' : 'custom animation changed an independent playhead';
    }
  },
  {
    name: 'curves: malformed animation is rejected without changing keys', who: 'B', allowUnchanged: true,
    async run(h) {
      const original = await read(h, 'B', 'AnimatedCurve');
      for (const bad of ['K|0/1,1,1,0,,aa', sequence([['2/1', 0], ['1/1', 1]])]) {
        const reply = await h.native('B', 'ARBSET', [...original.ids, original.fx, original.param, bad]);
        if (!reply.startsWith('err:') || (await read(h, 'B', 'AnimatedCurve')).body !== original.body) throw Error('invalid custom data mutated the layer');
      }
      expected = original.body;
      return 'ok';
    }, check: h => same(h, 'AnimatedCurve')
  }
];
