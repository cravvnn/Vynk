// Source/API contract audit. Optional SDK headers check declarations only;
// neither mode compiles the companion or verifies an AE host.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contract = JSON.parse(fs.readFileSync(path.join(root, 'aegp/api-compatibility.json'), 'utf8'));
const source = ['AeHost.cpp', 'PluginMain.cpp'].map(name => fs.readFileSync(path.join(root, 'aegp/src', name), 'utf8')).join('\n');
const used = new Set([...source.matchAll(/\b(\w+Suite\d+)\(\)/g)].map(m => m[1]));
for (const suite of used) assert(suite in contract.suites, 'suite outside AE2020 contract: ' + suite);
for (const suite of ['LayerSuite8', 'CompSuite10', 'EffectSuite4', 'StreamSuite5']) assert(used.has(suite), 'missing baseline suite: ' + suite);
assert.match(source, /kAEGPRenderSuiteVersion5/);

const aliases = { keys: 'KeyframeSuite4', g_renderSuite: 'RenderSuite5' };
for (const match of source.matchAll(/(?:(\w+Suite\d+)\(\)|(\w+))->(AEGP_\w+)\(/g)) {
  const suite = match[1] || aliases[match[2]];
  if (!suite) continue;
  assert(contract.suites[suite]?.[match[3]], suite + ' member outside contract: ' + match[3]);
}
console.log('PASS: native suite acquisitions and used members match the AE2020 source contract');

if (process.argv.length > 2) {
  const headers = process.argv.slice(2).map(file => fs.readFileSync(file, 'utf8')).join('\n');
  const clean = text => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\r\n]*/g, '');
  const types = text => clean(text).split(',').map(p => p.trim()).map(p => p === 'void' ? 'void' : p.replace(/\b\w+\s*$/, '').replace(/\s+/g, ''));
  for (const [suite, members] of Object.entries(contract.suites)) {
    if (!Object.keys(members).length) continue;
    const type = 'AEGP_' + suite;
    const end = headers.indexOf('} ' + type + ';');
    assert(end >= 0, 'SDK type missing: ' + type);
    const block = headers.slice(headers.lastIndexOf('typedef struct', end), end);
    const declarations = new Map([...block.matchAll(/\(\s*\*\s*(AEGP_\w+)\s*\)\s*\(([\s\S]*?)\)\s*;/g)].map(m => [m[1], types(m[2])]));
    for (const [name, params] of Object.entries(members)) assert.deepEqual(declarations.get(name), params, suite + ' signature: ' + name);
  }
  console.log('PASS: supplied SDK declarations match all contracted parameter types (no compilation)');
}
