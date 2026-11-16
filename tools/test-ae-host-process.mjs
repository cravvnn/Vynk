import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { selectHostProcess, ownedHostProcess, validateHosts, listAEProcesses } from './ae-pair/host-process.mjs';

const a = 'C:\\Program Files\\Adobe\\Adobe After Effects 2026\\Support Files\\AfterFX.exe';
const b = 'C:\\Program Files\\Adobe\\Adobe After Effects 2025\\Support Files\\AfterFX.exe';
const processA = { pid: 31, executable: a, windowTitle: 'Adobe After Effects 2026' };
const processB = { pid: 42, executable: b, windowTitle: 'Adobe After Effects 2025' };

test('two stable AE releases with the same basename resolve to their own executable and PID', () => {
  for (const rows of [[processA, processB], [processB, processA]]) {
    assert.equal(selectHostProcess(rows, a), processA);
    assert.equal(selectHostProcess(rows, b), processB);
  }
});

test('Windows path case and slash differences preserve host identity', () => {
  assert.equal(selectHostProcess([processA, processB], a.toUpperCase().replace(/\\/g, '/')), processA);
});

test('a missing host never binds to the other stable release', () => {
  assert.equal(selectHostProcess([processB], a), null);
  assert.equal(selectHostProcess([], a), null);
});

test('ambiguous instances and unreadable metadata refuse attribution', () => {
  assert.throws(() => selectHostProcess([processA, { ...processA, pid: 55 }], a), /More than one/);
  assert.throws(() => selectHostProcess([processA, { pid: 66, executable: null }], a), /Cannot identify/);
  assert.throws(() => selectHostProcess([{ ...processA, pid: 0 }], a), /Cannot identify/);
  assert.throws(() => selectHostProcess([processA], 'AfterFX.exe'), /absolute Windows path/);
});

test('a replacement or a disappeared process is resolved from each new inventory', () => {
  assert.equal(selectHostProcess([processA], a).pid, 31);
  assert.equal(selectHostProcess([{ ...processA, pid: 99 }], a).pid, 99);
  assert.equal(selectHostProcess([], a), null);
});

test('host commands refuse a replacement process or a missing launch record', () => {
  assert.equal(ownedHostProcess([processA, processB], a, 31), processA);
  assert.throws(() => ownedHostProcess([{ ...processA, pid: 99 }], a, 31), /saved ownership/);
  assert.throws(() => ownedHostProcess([processA], a, undefined), /saved ownership/);
  assert.throws(() => ownedHostProcess([processB], a, 42), /saved ownership/);
});

test('pair configuration requires two executable paths and two version keys', () => {
  assert.doesNotThrow(() => validateHosts({ A: { exe: a, ver: '26.3' }, B: { exe: b, ver: '25.6' } }));
  assert.throws(() => validateHosts({ A: { exe: a, ver: '26.3' }, B: { exe: a.toUpperCase(), ver: '25.6' } }), /different After Effects executables/);
  assert.throws(() => validateHosts({ A: { exe: a, ver: '25.6' }, B: { exe: b, ver: '25.6' } }), /different AE version keys/);
});

test('Windows process inventory and host-control PowerShell scripts are parseable', { skip: process.platform !== 'win32' }, () => {
  assert(Array.isArray(listAEProcesses()));
  const files = ['host-process.ps1', 'focus.ps1', 'continue-dialog.ps1'].map(name => fileURLToPath(new URL('./ae-pair/' + name, import.meta.url)));
  const script = files.map(file => {
    const literal = "'" + file.replace(/'/g, "''") + "'";
    return '$parseErrors=$null;$tokens=$null;[void][System.Management.Automation.Language.Parser]::ParseFile(' + literal + ',[ref]$tokens,[ref]$parseErrors);if($parseErrors.Count){$parseErrors | Out-String | Write-Output;exit 1}';
  }).join(';');
  assert.doesNotThrow(() => execFileSync('powershell.exe', ['-NoProfile', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true }));
});

test('Windows focus and dialog helpers reject a PID whose executable belongs to another app', { skip: process.platform !== 'win32' }, () => {
  for (const name of ['focus.ps1', 'continue-dialog.ps1']) {
    const file = fileURLToPath(new URL('./ae-pair/' + name, import.meta.url));
    assert.throws(() => execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file, '-ProcessId', String(process.pid), '-Executable', a], { encoding: 'utf8', windowsHide: true }), error => error.status === 1);
  }
});
