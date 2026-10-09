import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const hours = Number(process.argv[2] ?? 8);
const room = process.argv[3] ?? 'NIGHT1';
const wsUrl = process.env.URL ?? 'ws://127.0.0.1:8787/ws';
const healthUrl = process.env.HEALTH_URL ?? 'http://127.0.0.1:8787/health';
const reportDir = process.env.REPORT_DIR ?? path.join(process.env.TEMP ?? '.', 'opencode');
const reportPath = path.join(reportDir, 'overnight-report.txt');

fs.mkdirSync(reportDir, { recursive: true });

function stamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function log(line) {
  const text = `[${stamp()}] ${line}`;
  console.log(text);
  try {
    fs.appendFileSync(reportPath, text + '\n');
  } catch {}
}

function runOnce(cmd, args, env, timeoutMs, label) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: root,
      env: { ...process.env, ...env },
      shell: false,
    });
    let out = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve({ code: -1, out: out + `\n[timeout after ${timeoutMs}ms]` });
    }, timeoutMs);
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (out += d.toString()));
    child.on('close', (code) => {
      clearTimeout(timer);
      if (label) {
        const tail = out.trim().split('\n').slice(-3).join(' | ');
        log(`${label}: exit=${code} ${tail}`);
      }
      resolve({ code, out });
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      log(`${label || cmd}: spawn error ${e.message}`);
      resolve({ code: -1, out: e.message });
    });
  });
}

async function health(label) {
  try {
    const res = await fetch(healthUrl, { signal: AbortSignal.timeout(10000) });
    const body = await res.json();
    log(`${label}: health ok rooms=${body.rooms} uptime=${body.uptimeSec}s`);
    return true;
  } catch (e) {
    log(`${label}: HEALTH FAILED ${e.message}`);
    return false;
  }
}

log(`=== overnight run start: ${hours}h, room ${room}, relay ${wsUrl} ===`);
log('note: this process is self-contained; nothing needs the agent to be online');

let soak = null;
function startSoak() {
  soak = spawn(process.execPath, ['tools/soak.mjs', room, String(hours * 60), '3'], {
    cwd: root,
    env: { ...process.env, URL: wsUrl },
    shell: false,
  });
  soak.stdout.on('data', (d) => {
    for (const line of d.toString().split('\n')) {
      if (line.trim()) log(line.trim());
    }
  });
  soak.stderr.on('data', (d) => {
    for (const line of d.toString().split('\n')) {
      if (line.trim()) log('soak stderr: ' + line.trim());
    }
  });
  soak.on('close', (code) => {
    log(`soak exited with code ${code}`);
    if (!finished) setTimeout(() => startSoak(), 15000);
  });
}

let finished = false;
let fuzzRounds = 0;

async function runFuzzRound() {
  fuzzRounds++;
  const seed = Math.floor(Math.random() * 1e9);
  const res = await runOnce(process.execPath, ['tools/fuzz-diff.mjs', String(seed), '1000'], {}, 300000, `fuzz #${fuzzRounds} seed=${seed}`);
  if (res.code !== 0) {
    log(`FUZZ FAILURE (seed=${seed}) - reproduce with: node tools/fuzz-diff.mjs ${seed} 1000 --verbose`);
  }
}

await runOnce(process.execPath, ['server/scripts/smoke.mjs'], { URL: wsUrl, HEALTH_URL: healthUrl }, 90000, 'smoke (cloud relay)');
startSoak();
log('soak started for the full window; periodic checks every 5 minutes, smoke every 30 minutes, fuzz every 10 minutes');

let minute = 0;
const interval = setInterval(async () => {
  minute++;
  if (minute % 5 === 0) await health(`t+${minute}m`);
  if (minute % 10 === 0) await runFuzzRound();
  if (minute % 30 === 0) {
    await runOnce(process.execPath, ['server/scripts/smoke.mjs'], { URL: wsUrl, HEALTH_URL: healthUrl }, 90000, `smoke t+${minute}m`);
  }
  if (minute >= hours * 60) {
    finished = true;
    clearInterval(interval);
    log(`=== overnight run complete (${hours}h) ===`);
    if (soak) soak.kill();
    process.exit(0);
  }
}, 60000);

process.on('SIGINT', () => {
  finished = true;
  log('interrupted (SIGINT)');
  if (soak) soak.kill();
  process.exit(0);
});
