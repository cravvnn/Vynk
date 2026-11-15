const fs = require('fs');
const vm = require('vm');
const path = require('path');
const main = fs.readFileSync(path.join(__dirname, '..', 'panel', 'src', 'main.js'), 'utf8');
const sync = fs.readFileSync(path.join(__dirname, '..', 'panel', 'src', 'sync.js'), 'utf8');

function element() {
  return {
    value: '', style: {}, childNodes: [], textContent: '',
    addEventListener() {},
    appendChild(child) { this.childNodes.push(child); },
    removeChild(child) { this.childNodes.splice(this.childNodes.indexOf(child), 1); },
    get firstChild() { return this.childNodes[0]; }
  };
}

// Executes the actual panel functions, replacing only final app startup with
// a lexical test channel. Timers are controlled; HTTP and fs remain real.
function panelFixture({ storage = new Map(), WebSocket, requireModule = require, processInfo = process } = {}) {
  const elements = new Map();
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  };
  let timerId = 0;
  const timers = new Map();
  const context = vm.createContext({
    window: { addEventListener() {} },
    document: { getElementById: get, createElement: element },
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key)
    },
    require: requireModule, process: processInfo, Buffer, console, WebSocket,
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms, dueAt: Date.now() + ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval() { return ++timerId; },
    clearInterval() {}
  });
  vm.runInContext(sync, context);
  const anchor = '  loadSettings();';
  if (main.indexOf(anchor) < 0 || main.indexOf(anchor) !== main.lastIndexOf(anchor)) throw new Error('Panel startup anchor is missing or ambiguous');
  vm.runInContext(main.replace(anchor, '  window.__test = function (code) { return eval(code); }; return;\n' + anchor), context);
  return {
    run: (code) => context.window.__test(code),
    set: (key, value) => { context[key] = value; },
    get, storage, timers,
    state: context.window.__test('state')
  };
}

class TestSocket {
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; TestSocket.sockets.push(this); }
  send(data) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 3; }
  welcome(room, id, extra) {
    this.readyState = 1;
    const seq = extra && extra.ops && extra.ops.length ? extra.ops[extra.ops.length - 1].seq : 0;
    this.onmessage({ data: JSON.stringify(Object.assign({ t: 'welcome', room, selfId: id, members: [], ops: [], seq, token: 'token-' + room, accepted: [], checkpoint: true }, extra)) });
  }
}
TestSocket.sockets = [];
module.exports = { panelFixture, TestSocket };
