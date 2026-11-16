// Run on both installed modern hosts too: this forces the production legacy
// identity path. It does not replace a real AE2020 compatibility run.
async function idle(h, who) {
  if (!await h.waitFor(async () => await h.js(who, 'state.cycleBusy ? "busy" : "idle"') === 'idle', 20000)) throw Error(who + ': cycle never became idle');
}

export const identityScenarios = [
  {
    name: 'legacy identity: native cycles preserve shared-base comments and independent playheads', who: 'A', timeout: 45000, allowUnchanged: true,
    async run(h) {
      for (const who of ['A', 'B']) {
        await idle(h, who);
        const comments = "(function(){var c=vynkPair.comp('Main'),a=[];for(var i=1;i<=c.numLayers;i++)a.push(c.layer(i).comment);return JSON.stringify(a);})()";
        const before = await h.jsx(who, comments);
        const result = await h.native(who, 'ARBCYCLE', [JSON.stringify({ ops: [], must: 1, active: { all: 1 } })]);
        if (!result.startsWith('ok\t')) throw Error(who + ': ' + result.slice(0, 150));
        const out = JSON.parse(result.slice(3));
        if (out.error || !out.snaps.length || !out.snaps[0].layers.every(l => typeof l.lid === 'number')) throw Error(who + ': incomplete native snapshot');
        if (await h.jsx(who, comments) !== before) throw Error(who + ': native identity read changed comments');
      }
      await h.jsx('A', "vynkPair.comp('Main').time=1; 'ok'");
      await h.jsx('B', "vynkPair.comp('Main').time=4; 'ok'");
      for (const who of ['A', 'B']) {
        await idle(h, who);
        await h.js(who, 'state.nativeIdentity=true;state.fullNext[state.lastActiveSid]=1;kickCycle(0);"ok"');
      }
      return 'ok';
    },
    async check(h) {
      for (const [who, time] of [['A', 1], ['B', 4]]) {
        const actual = Number(await h.jsx(who, "String(vynkPair.comp('Main').time)"));
        if (actual !== time) return who + ': native cycle changed an independent playhead';
      }
      return '';
    }
  },
  {
    name: 'legacy identity: remote add refreshes its native binding', who: 'A', timeout: 45000,
    jsx: "var l=comp.layers.addNull(10);l.name='LegacyIdentity';l.comment='legacy identity fixture';l.property('ADBE Transform Group').property('ADBE Opacity').setValue(37);"
  },
  {
    name: 'legacy identity: reorder keeps SID targets', who: 'B', timeout: 45000,
    jsx: "var l=L('LegacyIdentity');l.moveToBeginning();l.property('ADBE Transform Group').property('ADBE Opacity').setValue(61);"
  },
  {
    name: 'legacy identity: remove the created layer and restore modern cycle routing', who: 'A', timeout: 45000,
    jsx: "L('LegacyIdentity').remove();",
    async check(h) {
      for (const who of ['A', 'B']) {
        const missing = await h.jsx(who, "vynkPair.layer(vynkPair.comp('Main'),'LegacyIdentity') ? 'present' : 'missing'");
        if (missing !== 'missing') return who + ': removed layer remains';
      }
      for (const who of ['A', 'B']) await h.js(who, 'state.nativeIdentity=false;"ok"');
      return '';
    }
  }
];
