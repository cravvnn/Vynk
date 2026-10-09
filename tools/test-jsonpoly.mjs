import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(__dirname, '..', 'panel', 'jsx', 'hostscript.jsx'), 'utf8');
const start = src.indexOf('if (typeof COLLAB_JSON_POLYFILLED');
const end = src.indexOf('var collab = (function');
if (start < 0 || end < 0 || end <= start) {
  console.error('FAIL: could not extract polyfill block from hostscript.jsx');
  process.exit(1);
}
const block = src.slice(start, end);

const ctx = vm.createContext({});
vm.runInContext('delete this.JSON;', ctx);
vm.runInContext(block, ctx);

let failures = 0;
function assert(cond, label) {
  if (cond) console.log('ok: ' + label);
  else {
    failures++;
    console.error('FAIL: ' + label);
  }
}

assert(typeof JSON.stringify === 'function', 'host realm still has native JSON (control)');
assert(vm.runInContext('typeof JSON', ctx) === 'object', 'polyfill installs JSON in a JSON-less context');
assert(vm.runInContext('COLLAB_JSON_POLYFILLED', ctx) === true, 'polyfill flag reports true');
assert(
  vm.runInContext('typeof JSON.parse === "function" && typeof JSON.stringify === "function"', ctx) === true,
  'polyfill provides both parse and stringify'
);

const json = vm.runInContext('JSON', ctx);

const samples = [
  null,
  true,
  false,
  0,
  -1.5,
  42,
  1e21,
  'hello',
  'quote " backslash \\ slash /',
  'multi\nline\ttab and \u0001 control',
  [1, 2, [3, 'x']],
  { a: 1, b: [true, null], c: { d: 'e' } },
  { 'weird key "\\': 'value with \u0000 null char' },
];

for (const sample of samples) {
  const expected = JSON.stringify(sample);
  const actual = json.stringify(sample);
  assert(actual === expected, 'stringify matches native: ' + expected.slice(0, 48));
}

for (const sample of samples) {
  const text = JSON.stringify(sample);
  const parsed = json.parse(text);
  assert(JSON.stringify(parsed) === text, 'parse round-trips: ' + text.slice(0, 48));
}

const op = {
  opId: 'p1',
  kind: 'setKey',
  target: { comp: '123|Comp "quoted"', layer: 'id42' },
  path: 'transform.position',
  value: [10, 20],
  time: 1.5,
  interp: { inType: 1, outType: 1 },
};
const opParsed = json.parse(JSON.stringify(op));
assert(opParsed.target.comp === op.target.comp, 'parses realistic op comp key with quotes');
assert(opParsed.value[0] === 10 && opParsed.value[1] === 20, 'parses op value array');
assert(opParsed.time === 1.5 && opParsed.interp.inType === 1, 'parses op time and interp');

const compState = {
  comp: { id: '123|Main', name: 'Main', width: 1920, height: 1080, duration: 10, numLayers: 2 },
  layers: [
    { sid: 'id42', index: 1, name: 'Layer "one"', type: 'av', enabled: true, transform: { position: { value: [10, 20], numKeys: 0 } } },
  ],
  selection: ['id42'],
  hasOmittedKeys: false,
};
const stateParsed = json.parse(json.stringify(compState));
assert(stateParsed.layers[0].name === 'Layer "one"', 'parses compact comp-state JSON with quotes');
assert(stateParsed.layers[0].transform.position.value[1] === 20, 'parses nested value arrays');

let threw = false;
try {
  json.parse('{bad json');
} catch (e) {
  threw = true;
}
assert(threw, 'parse throws on malformed input');

assert(json.stringify(undefined) === undefined, 'stringify(undefined) returns undefined');

console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
