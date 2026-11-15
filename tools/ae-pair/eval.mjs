// Ad-hoc command into an instance left running by `run.mjs --keep`.
//   node tools/ae-pair/eval.mjs A jsx "app.project.numItems"
//   node tools/ae-pair/eval.mjs B js "JSON.stringify(window.vynkHealth())"
//   node tools/ae-pair/eval.mjs A jsxfile path/to/script.jsx
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [who, kind, arg] = process.argv.slice(2);
const CMD = path.join(os.tmpdir(), 'vynk-pair', 'cmd');
const id = Date.now() % 1000000;
const code = kind === 'jsxfile' ? fs.readFileSync(arg, 'utf8') : arg;
const file = path.join(CMD, who + '.cmd');
const res = path.join(CMD, who + '.res');
try { fs.unlinkSync(res); } catch {}
fs.writeFileSync(file + '.w', JSON.stringify(kind === 'js' ? { id, js: code } : { id, jsx: code }));
fs.renameSync(file + '.w', file);
const end = Date.now() + Number(process.env.TIMEOUT || 30000);
const timer = setInterval(() => {
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(res, 'utf8')); } catch { parsed = null; }
  if (parsed && parsed.id === id) {
    clearInterval(timer);
    console.log(parsed.result);
  } else if (Date.now() > end) {
    clearInterval(timer);
    console.error('no reply');
    process.exit(1);
  }
}, 40);
