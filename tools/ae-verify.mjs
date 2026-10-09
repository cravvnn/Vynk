// Runs the headless After Effects apply harness (tools/ae-headless/verify.jsx)
// through run-verify.ps1 and prints a pass/fail summary.
//
//   npm run verify:ae                 # headless (AE must be closed)
//   npm run verify:ae -- --showui     # show the AE window while it runs
//   npm run verify:ae -- --force      # quit an already-running AE instance
//   npm run verify:ae -- --timeout 600
//   npm run verify:ae -- --ae "C:\Program Files\Adobe\...\AfterFX.exe"
//
// This drives real After Effects; it is the closest thing to a two-client
// apply test that runs without a second person.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const runner = join(root, 'tools', 'ae-headless', 'run-verify.ps1');
const args = process.argv.slice(2);

const psArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', runner];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--force') psArgs.push('-Force');
  else if (a === '--showui') psArgs.push('-ShowUi');
  else if (a === '--timeout') psArgs.push('-TimeoutSec', args[++i]);
  else if (a === '--ae') psArgs.push('-Ae', args[++i]);
  else {
    console.error('unknown argument: ' + a);
    process.exit(2);
  }
}

const res = spawnSync('powershell', psArgs, { encoding: 'utf8' });
process.stdout.write(res.stdout || '');
process.stderr.write(res.stderr || '');

const marker = '---RESULT---';
const stdout = res.stdout || '';
const idx = stdout.indexOf(marker);
if (idx < 0) {
  console.error('\nNo result produced. After Effects may be running (close it), or the run timed out.');
  process.exit(res.status || 1);
}

let report;
try {
  report = JSON.parse(stdout.slice(idx + marker.length).trim());
} catch (e) {
  console.error('\nCould not parse the harness result: ' + e.message);
  process.exit(1);
}

console.log('\n=== Vynk AE apply harness ===');
for (const step of report.steps || []) {
  console.log((step.ok ? 'ok:   ' : 'FAIL: ') + step.name + (step.detail ? '  [' + step.detail + ']' : ''));
}
const total = report.total || (report.steps || []).length;
console.log('\n' + (report.passed || 0) + '/' + total + ' passed');
if (report.error) console.error('harness error: ' + report.error + (report.line ? ' (line ' + report.line + ')' : ''));

process.exit(report.ok ? 0 : 1);
