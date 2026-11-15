// Two-instance convergence harness: runs two real After Effects versions
// against a private local relay, makes scripted edits in one, and checks that
// the other ends up with an identical comp (generic full-property dump).
//
//   node tools/ae-pair/run.mjs                 # launch both, run, quit both
//   node tools/ae-pair/run.mjs --keep          # leave both instances running
//   node tools/ae-pair/run.mjs --attach        # reuse instances left by --keep
//   node tools/ae-pair/run.mjs --only "add"    # scenarios whose name matches
//   node tools/ae-pair/run.mjs --stop          # quit instances left by --keep
//
// Refuses to start (without --attach) while any After Effects is running.

import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { scenarios } from './scenarios.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : null);

const INST = {
  A: {
    exe: process.env.AE_A || 'C:\\Program Files\\Adobe\\Adobe After Effects (Beta)\\Support Files\\AfterFX (Beta).exe',
    ver: process.env.AE_A_VER || '25.4'
  },
  B: {
    exe: process.env.AE_B || 'C:\\Program Files\\Adobe\\Adobe After Effects 2025\\Support Files\\AfterFX.exe',
    ver: process.env.AE_B_VER || '25.6'
  }
};
const PORT = 8797;
const WORK = path.join(os.tmpdir(), 'vynk-pair');
const CMD = path.join(WORK, 'cmd');
const HARNESS_JSON = path.join(process.env.LOCALAPPDATA, 'Vynk', 'harness.json');
const STATE = path.join(WORK, 'state.json');
const fwd = (p) => p.replace(/\\/g, '/');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (s) => console.log(`[pair ${new Date().toTimeString().slice(0, 8)}] ${s}`);

const PROC = { A: path.basename(INST.A.exe, '.exe'), B: path.basename(INST.B.exe, '.exe') };

// '' = not running, 'starting' = no main window yet, otherwise the window title.
function windowOf(who) {
  try {
    const out = execSync(
      `powershell -NoProfile -Command "$p = Get-Process -Name '${PROC[who]}' -ErrorAction SilentlyContinue | Select-Object -First 1; if ($p) { if ($p.MainWindowTitle) { $p.MainWindowTitle } else { 'starting' } }"`,
      { encoding: 'utf8' }
    ).trim();
    return out;
  } catch {
    return '';
  }
}
const isRunning = (who) => windowOf(who) !== '';

let cmdSeq = Date.now() % 100000;
async function cmd(who, payload, timeout = 240000) {
  const id = ++cmdSeq;
  const file = path.join(CMD, who + '.cmd');
  const res = path.join(CMD, who + '.res');
  try { fs.unlinkSync(res); } catch {}
  fs.writeFileSync(file + '.w', JSON.stringify({ id, ...payload }));
  fs.renameSync(file + '.w', file);
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    await sleep(40);
    let txt;
    try { txt = fs.readFileSync(res, 'utf8'); } catch { continue; }
    let parsed;
    try { parsed = JSON.parse(txt); } catch { continue; }
    if (parsed.id !== id) continue;
    try { fs.unlinkSync(res); } catch {}
    return parsed.result;
  }
  throw new Error(`${who}: no reply within ${timeout} ms`);
}
const jsx = (who, code, timeout) => cmd(who, { jsx: code }, timeout);
const js = (who, code, timeout) => cmd(who, { js: code }, timeout);

// Like a person, a scenario selects the layer it edits (select: false opts out,
// which is how a script or plug-in would touch a layer).
function wrap(body, select) {
  return (
    "(function(){try{var comp=vynkPair.comp('Main');" +
    "var L=function(n){var l=vynkPair.layer(comp,n);if(!l)throw new Error('no layer '+n);" +
    (select === false ? '' : "for(var q=1;q<=comp.numLayers;q++){try{comp.layer(q).selected=(comp.layer(q)===l);}catch(eq){}}") +
    "return l;};" +
    body +
    ";return 'ok';}catch(e){return 'ERR '+e.toString()+' @'+e.line;}})()"
  );
}

async function dump(who) {
  const raw = await jsx(who, "(function(){try{return vynkPair.dump('Main');}catch(e){return 'ERR '+e.toString();}})()");
  if (!raw || raw[0] !== '{') throw new Error(`${who} dump failed: ${String(raw).slice(0, 200)}`);
  return JSON.parse(raw);
}

function diff(a, b) {
  const out = new Map();
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const x = JSON.stringify(a[k]);
    const y = JSON.stringify(b[k]);
    if (x !== y) out.set(k, [x, y]);
  }
  return out;
}

function writeSetup(file, lines) {
  fs.writeFileSync(file, lines.join('\n'));
  return file;
}

function setupA(projPath) {
  return [
    'app.beginSuppressDialogs();',
    'try {',
    '  app.newProject();',
    "  var comp = app.project.items.addComp('Main', 1920, 1080, 1, 10, 30);",
    "  var other = app.project.items.addComp('Other', 1920, 1080, 1, 10, 30);",
    "  other.layers.addSolid([0.5, 0.5, 0.5], 'Inner', 1920, 1080, 1, 10);",
    "  var red = comp.layers.addSolid([1, 0, 0], 'Red', 1920, 1080, 1, 10);",
    "  comp.layers.addSolid([0, 1, 0], 'Green', 1920, 1080, 1, 10);",
    "  comp.layers.addSolid([0, 0, 1], 'Blue', 1920, 1080, 1, 10);",
    "  var nested = comp.layers.add(other); nested.name = 'Nested';",
    "  red.property('ADBE Effect Parade').addProperty('ADBE Gaussian Blur 2');",
    `  app.project.save(new File(${JSON.stringify(fwd(projPath))}));`,
    '  comp.openInViewer();',
    '} catch (e) {}',
    'app.endSuppressDialogs(false);'
  ];
}

function reopen(projPath) {
  return [
    'app.beginSuppressDialogs();',
    'try {',
    '  if (app.project) app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);',
    `  app.open(new File(${JSON.stringify(fwd(projPath))}));`,
    '  for (var i = 1; i <= app.project.numItems; i++) {',
    "    if (app.project.item(i) instanceof CompItem && app.project.item(i).name === 'Main') app.project.item(i).openInViewer();",
    '  }',
    '} catch (e) {}',
    'app.endSuppressDialogs(false);'
  ];
}

// AE Beta quits after the script when cold-started with -r, so instances are
// always started bare and scripts are sent to the running instance.
function launch(who) {
  spawn(INST[who].exe, [], { detached: true, stdio: 'ignore' }).unref();
}

// AE refuses a -r script while a panel script is running, so prefer the
// panel's own (serialized) channel and fall back to -r when no panel answers.
async function runScript(who, script) {
  const body = fs.readFileSync(script, 'utf8');
  try {
    await jsx(who, '(function(){' + body + String.fromCharCode(10) + "return 'done';})()", 45000);
    return;
  } catch {}
  spawn(INST[who].exe, ['-r', script], { detached: true, stdio: 'ignore' }).unref();
}

function startRelay() {
  const dataDir = path.join(WORK, 'relay', 'rooms');
  const baseDir = path.join(WORK, 'relay', 'bases');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(baseDir, { recursive: true });
  const child = spawn(process.execPath, [path.join(root, 'server', 'dist', 'index.js')], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, BASE_DIR: baseDir },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('relay did not start')), 10000);
    child.stdout.on('data', (d) => {
      if (String(d).includes('listening')) { clearTimeout(t); resolve(child); }
    });
    child.stderr.on('data', (d) => process.stderr.write('[relay] ' + d));
    child.on('exit', () => reject(new Error('relay exited')));
  });
}

function observe(room, logFile) {
  const obs = { members: new Map(), ops: [], ws: null };
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  obs.ws = ws;
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });
  ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', proto: 2, room, name: 'harness', aeVersion: 'observer' })));
  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    const ts = new Date().toTimeString().slice(0, 8);
    if (m.t === 'welcome') for (const x of m.members) obs.members.set(x.id, x.name);
    else if (m.t === 'presence') {
      if (m.event === 'join') obs.members.set(m.member.id, m.member.name);
      else obs.members.delete(m.member.id);
      logStream.write(`${ts} presence ${m.event} ${m.member.name}\n`);
    } else if (m.t === 'op') {
      obs.ops.push({ at: Date.now(), by: obs.members.get(m.author) || m.author, op: m.op });
      logStream.write(`${ts} OP #${m.seq} by=${obs.members.get(m.author) || m.author} ${m.op.kind} ${m.op.path || ''} layer=${m.op.target && m.op.target.layer} ${JSON.stringify(m.op.value === undefined ? '' : m.op.value).slice(0, 160)}\n`);
    } else if (m.t === 'log') logStream.write(`${ts} PANEL ${m.name}: ${m.line}\n`);
  });
  ws.on('error', () => {});
  obs.has = (name) => [...obs.members.values()].includes(name);
  return obs;
}

async function waitFor(fn, timeout, label) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(500);
  }
  if (label) say('timed out waiting for ' + label);
  return false;
}

async function quitInstances() {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch {}
  const ours = saved.launched || [];
  for (const who of ours) {
    try {
      await jsx(who, "(function(){try{app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);}catch(e){} app.quit(); return 'bye';})()", 8000);
    } catch {}
  }
  await waitFor(() => ours.every((w) => !isRunning(w)), 25000);
  for (const who of ours) {
    if (!isRunning(who)) continue;
    try { execSync(`taskkill /IM "${PROC[who]}.exe" /F`, { stdio: 'ignore' }); } catch {}
  }
  try { fs.unlinkSync(HARNESS_JSON); } catch {}
  try { fs.unlinkSync(STATE); } catch {}
}

async function main() {
  fs.mkdirSync(CMD, { recursive: true });
  fs.mkdirSync(path.dirname(HARNESS_JSON), { recursive: true });

  if (flag('--stop')) {
    await quitInstances();
    say('stopped');
    return 0;
  }

  const attach = flag('--attach');
  const room = 'PAIR' + Math.random().toString(36).slice(2, 6).toUpperCase().replace(/[^A-Z0-9]/g, 'X');
  const projA = path.join(WORK, 'a', 'pair.aep');
  const projB = path.join(WORK, 'b', 'pair.aep');
  const logFile = path.join(WORK, 'session.log');
  try { fs.unlinkSync(logFile); } catch {}

  if (!attach && (isRunning('A') || isRunning('B'))) {
    say('After Effects is already running - close it first (or use --attach for instances left by --keep).');
    return 4;
  }
  if (attach && !(isRunning('A') && isRunning('B'))) {
    say('--attach needs both instances running');
    return 4;
  }

  const relay = await startRelay();
  say(`relay on :${PORT}, room ${room}, log ${logFile}`);
  const cfg = (name) => ({ name, room, server: `ws://127.0.0.1:${PORT}/ws`, dir: CMD });
  fs.writeFileSync(HARNESS_JSON, JSON.stringify({ [INST.A.ver]: cfg('A'), [INST.B.ver]: cfg('B') }));
  const obs = observe(room, logFile);
  let code = 1;

  try {
    if (attach) {
      for (const who of ['A', 'B']) {
        try { await js(who, "wantConnected = false; disconnect(); 'ok'", 3000); } catch {}
      }
    } else {
      for (const d of ['a', 'b']) {
        fs.rmSync(path.join(WORK, d), { recursive: true, force: true });
        fs.mkdirSync(path.join(WORK, d), { recursive: true });
      }
      fs.writeFileSync(STATE, JSON.stringify({ launched: ['A', 'B'] }));
      say('launching A: ' + INST.A.exe);
      launch('A');
      say('launching B: ' + INST.B.exe);
      launch('B');
      for (const who of ['A', 'B']) {
        let ticks = 0;
        const up = await waitFor(() => {
          const w = windowOf(who);
          if (w && w !== 'starting') return true;
          if (++ticks % 20 === 0) {
            try {
              const out = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${path.join(here, 'continue-dialog.ps1')}" -ProcessName "${PROC[who]}"`, { encoding: 'utf8' });
              if (out.includes('dismissed')) say(who + ': dismissed the crash-repair dialog');
            } catch {}
          }
          return false;
        }, 300000, who + ' main window');
        if (!up) return 3;
      }
      await sleep(8000);
    }

    if (!attach || !fs.existsSync(projA)) {
      await runScript('A', writeSetup(path.join(WORK, 'setupA.jsx'), setupA(projA)));
      if (!(await waitFor(() => fs.existsSync(projA) && fs.statSync(projA).size > 0, 120000, 'A to save the base project'))) return 3;
      await sleep(1500);
      fs.copyFileSync(projA, projB);
      say('base project saved');
    } else {
      await runScript('A', writeSetup(path.join(WORK, 'reopenA.jsx'), reopen(projA)));
    }
    await runScript('B', writeSetup(path.join(WORK, 'reopenB.jsx'), reopen(projB)));
    await sleep(6000);
    if (attach) {
      for (const who of ['A', 'B']) {
        try { await js(who, "setTimeout(function(){ location.reload(); }, 50); 'reloading'", 3000); } catch {}
      }
    }

    const openPanel = writeSetup(path.join(WORK, 'openpanel.jsx'), [
      "try { app.executeCommand(app.findMenuCommandId('Vynk')); } catch (e) {}"
    ]);
    for (const who of ['A', 'B']) {
      if (await waitFor(() => obs.has(who), 20000)) continue;
      say(`${who}: panel not in the room yet - opening it from the Window menu`);
      await runScript(who, openPanel);
      if (!(await waitFor(() => obs.has(who), 60000, `${who} panel to join`))) return 3;
    }
    say('both panels joined');

    const lib = `(function(){try{return $.evalFile(${JSON.stringify(fwd(path.join(here, 'lib.jsx')))});}catch(e){return 'ERR '+e.toString();}})()`;
    for (const who of ['A', 'B']) say(`${who} lib: ${await jsx(who, lib)}  build=${await js(who, 'PANEL_BUILD + " AE " + hostVersion + " native=" + state.nativeMode')}`);
    await sleep(4000);

    let outstanding = diff(await dump('A'), await dump('B'));
    say(`baseline: ${outstanding.size} differing key(s) before any edit`);
    for (const [k, v] of [...outstanding].slice(0, 6)) say(`   ${k}: A=${v[0]} B=${v[1]}`);

    const only = opt('--only');
    const list = only ? scenarios.filter((s) => s.name.includes(only)) : scenarios;
    const results = [];
    for (const sc of list) {
      const t0 = Date.now();
      const opsBefore = obs.ops.length;
      const pre = await dump(sc.who);
      let note = '';
      const runs = [jsx(sc.who, wrap(sc.jsx, sc.select))];
      if (sc.also) runs.push(jsx(sc.also.who, wrap(sc.also.jsx, sc.select)));
      const outs = await Promise.all(runs);
      if (outs.some((o) => o !== 'ok')) note = 'edit: ' + outs.join(' / ');
      if (sc.then) {
        await sleep(1500);
        await jsx(sc.then.who, sc.then.raw);
      }
      const timeout = sc.timeout || 10000;
      let fresh = new Map();
      let okStreak = 0;
      let convergedAt = 0;
      let changed = false;
      while (Date.now() - t0 < timeout) {
        await sleep(450);
        const a = await dump('A');
        const b = await dump('B');
        if (!changed && diff(pre, sc.who === 'A' ? a : b).size > 0) changed = true;
        const d = diff(a, b);
        fresh = new Map([...d].filter(([k]) => !outstanding.has(k)));
        if (fresh.size === 0) {
          if (!convergedAt) convergedAt = Date.now() - t0;
          if (++okStreak >= 2) break;
        } else {
          okStreak = 0;
          convergedAt = 0;
        }
      }
      const opsDuring = obs.ops.length - opsBefore;
      await sleep(1200);
      const chatter = obs.ops.length - opsBefore - opsDuring;
      const pass = fresh.size === 0 && !note.startsWith('edit: ERR');
      if (!changed && !sc.then) note += (note ? '; ' : '') + 'edit changed nothing locally';
      if (chatter > 0) note += (note ? '; ' : '') + `${chatter} op(s) still flowing after settle`;
      const row = { name: sc.name, who: sc.who, pass, known: !!sc.known, ms: convergedAt, ops: opsDuring, note, diffs: [...fresh].slice(0, 12).map(([k, v]) => ({ key: k, A: v[0], B: v[1] })), diffCount: fresh.size };
      results.push(row);
      console.log(`${pass ? 'ok  ' : sc.known ? 'gap ' : 'FAIL'} ${sc.name.padEnd(38)} ${sc.who}  ${pass ? String(convergedAt).padStart(5) + ' ms' : '   -    '}  ops=${String(opsDuring).padStart(3)}  ${note}`);
      if (!pass) {
        for (const d of row.diffs.slice(0, 5)) console.log(`       ${d.key}\n         A=${String(d.A).slice(0, 110)}\n         B=${String(d.B).slice(0, 110)}`);
        if (fresh.size > 5) console.log(`       ... ${fresh.size - 5} more`);
        for (const [k, v] of fresh) outstanding.set(k, v);
      }
    }

    const health = {};
    for (const who of ['A', 'B']) {
      try { health[who] = JSON.parse(await js(who, 'JSON.stringify(window.vynkHealth())')); } catch {}
    }
    const passed = results.filter((r) => r.pass).length;
    const gaps = results.filter((r) => !r.pass && r.known).length;
    const report = { room, at: new Date().toISOString(), passed, total: results.length, health, results };
    fs.writeFileSync(path.join(WORK, 'report.json'), JSON.stringify(report, null, 2));
    console.log(`\n${passed}/${results.length} scenarios converged` + (gaps ? ` (${gaps} known gap)` : ''));
    console.log('health A: ' + JSON.stringify(health.A));
    console.log('health B: ' + JSON.stringify(health.B));
    console.log('report: ' + path.join(WORK, 'report.json'));
    code = passed + gaps === results.length ? 0 : 1;
  } finally {
    try { obs.ws.close(); } catch {}
    if (!flag('--keep') && !attach) await quitInstances();
    relay.kill();
  }
  return code;
}

main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(2); });
