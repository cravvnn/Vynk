import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { runHostScript, reopenProjectScript } from './ae-pair/run-script.mjs';

test('a missing panel leaves only a read-only probe for the fallback-opened panel', async () => {
  const pending = [];
  let launches = 0;
  await runHostScript({
    probe: async () => { pending.push('ready'); throw new Error('no panel'); },
    execute: async () => { pending.push('toggle panel'); },
    launch: async () => { launches++; }
  }, 'app.executeCommand(openPanel);');
  assert.equal(launches, 1);
  assert.deepEqual(pending, ['ready']);
});

test('a ready panel receives exactly one mutation through its serialized channel', async () => {
  const executions = [];
  await runHostScript({
    probe: async () => 'ready',
    execute: async code => { executions.push(code); return 'done'; },
    launch: async () => assert.fail('unexpected fallback')
  }, 'app.project.save();');
  assert.deepEqual(executions, ["(function(){app.project.save();\nreturn 'done';})()"]);
});

test('a timed-out mutation is not retried through the command line', async () => {
  await assert.rejects(runHostScript({
    probe: async () => 'ready',
    execute: async () => { throw new Error('unknown completion'); },
    launch: async () => assert.fail('mutation must not be retried')
  }, 'app.project.close();'), /unknown completion/);
});

test('script failures remain failures without another execution attempt', async () => {
  await assert.rejects(runHostScript({
    probe: async () => 'ready',
    execute: async () => 'EvalScript error.',
    launch: async () => assert.fail('mutation must not be retried')
  }, 'throw new Error();'), /host script failed/);
});

const projectPath = 'C:\\Temp\\vynk-pair\\b\\pair.aep';
function reopenFixture(project) {
  const calls = [];
  const app = {
    project,
    beginSuppressDialogs() { calls.push('begin'); },
    endSuppressDialogs() { calls.push('end'); },
    open(file) {
      calls.push(['open', file.fsName]);
      this.project = { numItems: 0, file: null, save(file) { calls.push(['save', file.fsName]); this.file = file; } };
    }
  };
  const File = function (name) { this.fsName = name; };
  return { app, calls, run: () => vm.runInNewContext(reopenProjectScript(projectPath).join('\n'), { app, File, CompItem: function () {}, CloseOptions: { DO_NOT_SAVE_CHANGES: 0 } }) };
}

test('a converted fixture is saved to the exact opened disposable path', () => {
  const f = reopenFixture({ numItems: 0, close() { f.calls.push('close'); } });
  f.run();
  assert.deepEqual(f.calls, ['begin', 'close', ['open', 'C:/Temp/vynk-pair/b/pair.aep'], ['save', 'C:/Temp/vynk-pair/b/pair.aep'], 'end']);
});

test('reopen refuses unrelated saved and unsaved projects before closing or opening', () => {
  for (const file of [null, { fsName: 'C:/work/Andrew.aep' }]) {
    const f = reopenFixture({ numItems: 10, file, close() { assert.fail('unrelated project closed'); } });
    assert.throws(f.run, /not the disposable test project/);
    assert.deepEqual(f.calls, ['begin', 'end']);
  }
});

test('failed project open ends dialog suppression without saving another project', () => {
  const f = reopenFixture(null);
  f.app.open = () => { throw new Error('open failed'); };
  assert.throws(f.run, /open failed/);
  assert.deepEqual(f.calls, ['begin', 'end']);
});
