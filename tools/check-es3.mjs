import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const file = process.argv[2] ?? path.join(__dirname, '..', 'panel', 'jsx', 'hostscript.jsx');
const src = fs.readFileSync(file, 'utf8');
const lines = src.split('\n');

const hazards = [
  ['arrow function', /=>/],
  ['const', /\bconst\b/],
  ['let', /\blet\b/],
  ['template literal', /`/],
  ['String.trim', /\.trim\(/],
  ['Array.map', /\.map\(/],
  ['Array.forEach', /\.forEach\(/],
  ['Array.filter', /\.filter\(/],
  ['Array.reduce', /\.reduce\(/],
  ['Object.keys/values/entries', /Object\.(keys|values|entries)/],
  ['Array.isArray', /Array\.isArray/],
  ['Date.now', /Date\.now/],
  ['Array.indexOf (verify receiver is a string)', /\.indexOf\(/],
  ['trailing comma', /,\s*[}\]]/],
  ['keyword property name', /(^|\n)\s*(in|for|if|new|var|default|class|delete|typeof|instanceof|return)\s*:/],
  ['strict mode', /['"]use strict['"]/],
];

let issues = 0;
for (const [name, re] of hazards) {
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) hits.push(i + 1);
  }
  if (hits.length === 0) continue;
  issues += hits.length;
  console.log(`${name}: ${hits.length} hit(s) at line(s) ${hits.slice(0, 12).join(', ')}`);
  for (const ln of hits.slice(0, 5)) {
    console.log(`    ${ln}: ${lines[ln - 1].trim().slice(0, 100)}`);
  }
}

if (issues === 0) {
  console.log(`${path.basename(file)}: no ES5+ hazards found (ES3-safe)`);
} else {
  console.log(`\n${path.basename(file)}: ${issues} hazard hit(s) to review`);
}
