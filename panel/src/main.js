(function () {
  'use strict';

  var PROTO = 1;
  var PANEL_BUILD = (window.VYNK_VERSION ? 'v' + window.VYNK_VERSION : 'dev');
  var CURSOR_FLUSH_MS = 33;
  var POLL_FAST_MS = 200;
  var POLL_SLOW_MS = 500;
  var POLL_BURST_MS = 2500;
  var FX_POLL_MS = 1200;
  var FX_CHUNKS = 4;
  var TEXT_POLL_MS = 600;
  var SHAPE_POLL_MS = 2500;
  var STRUCTURE_LIMIT = 20;
  var STRUCTURE_WINDOW_MS = 4000;
  var STRUCTURE_COOLDOWN_MS = 15000;
  var TEXT_DEBOUNCE_MS = 500;
  var LOCAL_TEXT_HOLD_MS = 3000;
  var MAX_OPS_PER_POLL = 60;
  var CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var RECONNECT_DELAY_MS = 3000;
  var PING_INTERVAL_MS = 5000;
  var MAX_LOG_LINES = 200;
  var MAX_LOG_BUFFER = 80;
  var MAX_REMOTE_QUEUE = 200;
  var MAX_OUTBOX = 500;
  var WATCHDOG_POLL_MS = 5000;
  var WATCHDOG_STAMP_MS = 4000;
  var FOCUS_QUEUE_DELAY_MS = 1500;
// Remote edits to a target you are actively dragging wait this long after your
// last local op, so a simultaneous drag cannot rubber-band mid-gesture.
var GESTURE_HOLD_MS = 700;
  var MAX_COMP_STATES = 12;
  var BACKPRESSURE_LOW = 50000;
  var BACKPRESSURE_MEDIUM = 200000;
  var BACKPRESSURE_HIGH = 500000;
  var BP_SLOW_POLL_MS = 500;
  var BP_MEDIUM_POLL_MS = 1000;
  var BP_HIGH_POLL_MS = 2000;
  var AEGP_PORT = 8990;
  var AEGP_RECONNECT_MS = 3000;
  var NATIVE_IDLE_POLL_MS = 1500;
  var NATIVE_FX_POLL_MS = 2500;
  var NATIVE_TEXT_POLL_MS = 2000;
  var NATIVE_SHAPE_POLL_MS = 4000;

  function $(id) { return document.getElementById(id); }

  var CollabDiff = window.CollabDiff || null;
  var echo = CollabDiff ? CollabDiff.createEcho() : null;

  var inAE = typeof window.__adobe_cep__ !== 'undefined';
  var cs = null;
  var hostVersion = '';
  var wantConnected = false;
  var retryCount = 0;
  try {
    cs = new window.CSInterface();
    if (inAE) {
      var env = cs.getHostEnvironment();
      if (env && env.appVersion) hostVersion = env.appVersion;
    }
  } catch (e) { cs = null; }

  var state = {
    ws: null,
    connected: false,
    selfId: null,
    room: null,
    members: {},
    order: [],
    myCursor: { x: 0.5, y: 0.5, known: false },
    pendingCursor: null,
    compId: null,
    compName: null,
    selection: [],
    lastComp: null,
    polling: false,
    pollTimer: null,
    pollScheduledDelay: 0,
    lastChangeAt: 0,
    lastTxLogAt: 0,
    lastRxLogAt: 0,
    keysOmittedWarned: false,
    missingPolls: 0,
    pollStartedAt: 0,
    pollCount: 0,
    lastPollResult: '',
    stamping: false,
    stampStartedAt: 0,
    unsupportedAddWarned: false,
    missingFx: {},
    effectsTruncatedWarned: false,
    compStates: {},
    fxStates: {},
    textStates: {},
    shapeStates: {},
    shapeWarned: false,
    structureTimes: [],
    structurePausedUntil: 0,
    structurePauseLogged: false,
    focusKnown: false,
    aeFocused: true,
    remoteQueue: [],
    textDebounce: {},
    lastLocalTextAt: 0,
    queueFlushTimer: null,
    helper: { sock: null, connected: false, node: typeof require === 'function' },
    aegp: { sock: null, connected: false },
    nativeMode: false,
    pollGeneration: 0,
    opsSent: 0,
    opsReceived: 0,
    lastPingAt: 0,
    latencyMs: 0,
    projectHash: '',
    projectName: '',
    projectPath: '',
    compHash: '',
    divergedWith: {},
    divergenceLogged: false,
    roomToken: '',
    baseInfo: null,
    seenOps: {},
    seenOpCount: 0,
    everConnected: false,
    outbox: [],
    outboxKey: '',
    pollMs: 0,
    applyFails: 0,
    reconnects: 0,
    localEditAt: {},
    lastRxAt: 0,
    catchupState: 'none',
    pendingReplay: null,
    baseOpened: false,
    replayApplied: false,
    replayTruncated: false,
    baseSeq: 0,
    fromSeq: 0,
    fetchingHistory: false,
    historyFetchTried: false,
    catchupLogged: false
  };

  var logBuffer = [];

  function shipLog(text) {
    if (state.connected && state.ws && state.ws.readyState === 1) {
      try {
        state.ws.send(JSON.stringify({ t: 'log', line: String(text).slice(0, 300) }));
        return true;
      } catch (e) {}
    }
    return false;
  }

  function flushLogBuffer() {
    for (var i = 0; i < logBuffer.length; i++) {
      var entry = logBuffer[i];
      if (entry.shipped) continue;
      if (shipLog(entry.text)) entry.shipped = true;
    }
  }

  function log(text) {
    var el = $('logEl');
    var line = document.createElement('div');
    var stamp = new Date().toTimeString().slice(0, 8);
    line.textContent = stamp + '  ' + text;
    el.appendChild(line);
    while (el.childNodes.length > MAX_LOG_LINES) el.removeChild(el.firstChild);
    el.scrollTop = el.scrollHeight;
    logBuffer.push({ text: text, shipped: shipLog(text) });
    if (logBuffer.length > MAX_LOG_BUFFER) logBuffer.shift();
  }

  function setStatus(kind, text) {
    var dot = $('statusDot');
    dot.className = 'dot' + (kind === 'on' ? ' on' : kind === 'warn' ? ' warn' : kind === 'err' ? ' err' : '');
    $('statusText').textContent = text;
  }

  function randomCode() {
    var s = '';
    for (var i = 0; i < 6; i++) s += CODE_CHARS.charAt(Math.floor(Math.random() * CODE_CHARS.length));
    return s;
  }

  function logThrottled(key, text, minMs) {
    var now = Date.now();
    state.logThrottle = state.logThrottle || {};
    var last = state.logThrottle[key] || 0;
    if (now - last < (minMs || 3000)) return;
    state.logThrottle[key] = now;
    log(text);
  }

  function memberBuild(member) {
    if (!member) return '';
    if (member.build) return member.build;
    var match = /m\d+\.\d+/.exec(String(member.aeVersion || ''));
    return match ? match[0] : '';
  }

  function checkMemberBuild(member) {
    var build = memberBuild(member);
    if (!build || build === PANEL_BUILD) return;
    state.buildWarned = state.buildWarned || {};
    if (state.buildWarned[member.id]) return;
    state.buildWarned[member.id] = true;
    log('note: ' + member.name + ' runs build ' + build + ' (you run ' + PANEL_BUILD + ') - some features will not match until both update');
  }

  function memberAeMajor(member) {
    var m = /(\d+)/.exec(String((member && member.aeVersion) || ''));
    return m ? m[1] : '';
  }

  function checkMemberVersion(member) {
    var major = memberAeMajor(member);
    var mine = memberAeMajor({ aeVersion: hostVersion || '' });
    if (!major || !mine || major === mine) return;
    state.versionWarned = state.versionWarned || {};
    if (state.versionWarned[member.id]) return;
    state.versionWarned[member.id] = true;
    log('note: ' + member.name + ' runs AE ' + major + ' (you run AE ' + mine + ') - open a project saved in the older version; layer IDs can differ across versions');
  }

  function checkMemberProject(member) {
    if (!member || !member.project) return;
    if (!state.projectName) return;
    if (member.project === state.projectName) return;
    state.projectWarned = state.projectWarned || {};
    if (state.projectWarned[member.id]) return;
    state.projectWarned[member.id] = true;
    log('WARNING: ' + member.name + ' has a different project file (' + member.project + ' vs your ' + state.projectName + ') - open the SAME project file or edits will diverge');
  }

  function defaultServer() {
    return window.VYNK_DEFAULT_SERVER || '';
  }

  function loadSettings() {
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem('collab.settings') || '{}'); } catch (e) { saved = {}; }
    $('serverInput').value = saved.server || defaultServer();
    $('roomInput').value = saved.room || '';
    $('nameInput').value = saved.name || '';
  }

  function saveSettings() {
    try {
      localStorage.setItem('collab.settings', JSON.stringify({
        server: $('serverInput').value.trim(),
        room: $('roomInput').value.trim().toUpperCase(),
        name: $('nameInput').value.trim()
      }));
    } catch (e) {}
  }

  function send(msg) {
    if (state.ws && state.ws.readyState === 1) {
      if (msg.t === 'op') {
        state.opsSent++;
        noteLocalGesture(msg.op);
      }
      state.ws.send(JSON.stringify(msg));
      return;
    }
    if (msg.t === 'op' && state.everConnected) {
      if (state.outbox.length >= MAX_OUTBOX) state.outbox.shift();
      state.outbox.push(msg.op);
      persistOutbox();
    }
  }

  function outboxKey(server, room) {
    return 'collab.outbox.' + (server || '') + '|' + (room || '');
  }

  // The offline queue survives a panel reload / AE restart. Ops are written
  // through on every change and removed the moment they are sent, so a crash
  // can lose an unsent edit but can never deliver one twice.
  function persistOutbox() {
    var key = state.outboxKey;
    if (!key) return;
    try {
      if (state.outbox.length === 0) {
        localStorage.removeItem(key);
        return;
      }
      try {
        localStorage.setItem(key, JSON.stringify({ ops: state.outbox }));
      } catch (e) {
        state.outbox = state.outbox.slice(-Math.max(1, Math.floor(state.outbox.length / 2)));
        localStorage.setItem(key, JSON.stringify({ ops: state.outbox }));
        log('note: offline queue trimmed to the newest ' + state.outbox.length + ' edit(s) to fit storage');
      }
    } catch (e) {}
  }

  function loadOutbox(key) {
    try {
      var saved = JSON.parse(localStorage.getItem(key) || 'null');
      if (!saved || !saved.ops || !saved.ops.length) return [];
      var ops = [];
      for (var i = 0; i < saved.ops.length; i++) {
        if (saved.ops[i] && saved.ops[i].opId) ops.push(saved.ops[i]);
      }
      return ops.slice(-MAX_OUTBOX);
    } catch (e) {
      return [];
    }
  }

  function flushOutbox() {
    if (state.outbox.length === 0) return;
    var queued = state.outbox;
    state.outbox = [];
    persistOutbox();
    for (var i = 0; i < queued.length; i++) send({ t: 'op', op: queued[i] });
    log('flushed ' + queued.length + ' edit(s) made while offline');
  }

  function connect() {
    disconnect();
    wantConnected = true;
    var url = $('serverInput').value.trim() || defaultServer();
    var room = $('roomInput').value.trim().toUpperCase();
    if (!room) {
      room = randomCode();
      $('roomInput').value = room;
    }
    var name = $('nameInput').value.trim() || 'anon';
    saveSettings();
    state.outboxKey = outboxKey(url, room);
    if (state.outbox.length === 0) {
      var restored = loadOutbox(state.outboxKey);
      if (restored.length > 0) {
        state.outbox = restored;
        log('restored ' + restored.length + ' unsent edit(s) from the last session');
      }
    }
    setStatus('warn', 'connecting');
    log('connecting to ' + url + ' as ' + name + ' into room ' + room);
    var ws;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      setStatus('err', 'bad url');
      log('invalid server url');
      return;
    }
    state.ws = ws;
    ws.onopen = function () {
      var sent = false;
      var sendHello = function () {
        if (sent) return;
        sent = true;
        send({ t: 'hello', proto: PROTO, room: room, name: name, aeVersion: (hostVersion || 'unknown') + ' ' + PANEL_BUILD, build: PANEL_BUILD, project: state.projectName || '' });
      };
      var timer = setTimeout(sendHello, 600);
      fetchHostInfo(function () { clearTimeout(timer); sendHello(); });
    };
    ws.onmessage = function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      onMessage(msg);
    };
    ws.onclose = function () {
      if (state.connected) log('disconnected');
      state.connected = false;
      state.selfId = null;
      state.members = {};
      state.order = [];
      state.remoteQueue = [];
      state.textDebounce = {};
      state.roomToken = '';
      state.baseInfo = null;
      state.baseOpened = false;
      renderBase();
      setStatus('', 'offline');
      $('connectBtn').textContent = 'join';
      renderMembers();
      pushPeersToNative();
      if (wantConnected) {
        retryCount++;
        state.reconnects = (state.reconnects || 0) + 1;
        var backoff = Math.min(RECONNECT_DELAY_MS * Math.min(retryCount, 5), 15000);
        log('reconnecting in ' + Math.round(backoff / 1000) + 's (attempt ' + retryCount + ')');
        setTimeout(function () { if (wantConnected) connect(); }, backoff);
      }
    };
    ws.onerror = function () {
      setStatus('err', 'socket error');
    };
  }

  function disconnect() {
    if (state.ws) {
      try { state.ws.close(); } catch (e) {}
      state.ws = null;
    }
  }

  function onMessage(msg) {
    state.lastRxAt = Date.now();
    switch (msg.t) {
      case 'welcome': {
        state.connected = true;
        state.everConnected = true;
        state.selfId = msg.selfId;
        state.room = msg.room;
        state.roomToken = msg.token || '';
        state.baseSeq = typeof msg.baseSeq === 'number' ? msg.baseSeq : 0;
        state.historyFetchTried = false;
        state.fetchingHistory = false;
        state.baseInfo = sanitizeBase(msg.base);
        retryCount = 0;
        state.members = {};
        state.order = [];
        for (var i = 0; i < msg.members.length; i++) {
          var m = msg.members[i];
          state.members[m.id] = m;
          state.order.push(m.id);
          checkMemberBuild(m);
          checkMemberVersion(m);
          checkMemberProject(m);
          checkCompDivergence(m);
        }
        setStatus('on', 'room ' + msg.room);
        log('joined room ' + msg.room + ' with ' + msg.members.length + ' member(s), ' + msg.ops.length + ' op(s) in log');
        state.replayTruncated = msg.truncated === true;
        state.fromSeq = typeof msg.fromSeq === 'number' ? msg.fromSeq : 0;
        if (state.replayTruncated) {
          state.catchupLogged = true;
          state.catchupState = 'held-truncated';
          log('note: welcome replay is partial (' + msg.ops.length + ' recent edit(s)) - the rest will be fetched from the relay log');
        }
        if (msg.ops.length > 0 || msg.truncated) {
          state.pendingReplay = msg.ops || [];
          state.replayApplied = false;
          state.catchupLogged = false;
          log('note: room already has ' + msg.ops.length + ' edit(s) from before you joined');
          tryApplyReplay();
        } else {
          state.pendingReplay = null;
          state.replayApplied = false;
        }
        flushLogBuffer();
        flushOutbox();
        if (state.compId) send({ t: 'selection', compId: state.compId, layers: state.selection, hash: state.compHash });
        renderMembers();
        renderBase();
        pushPeersToNative();
        return;
      }
      case 'base': {
        state.baseInfo = sanitizeBase(msg.base);
        renderBase();
        log(msg.base ? 'room base project: ' + msg.base.name + ' (by ' + msg.base.uploadedBy + ')' : 'room base project cleared');
        tryApplyReplay();
        return;
      }
      case 'presence': {
        var member = msg.member;
        if (msg.event === 'join') {
          state.members[member.id] = member;
          if (state.order.indexOf(member.id) < 0) state.order.push(member.id);
          log(member.name + ' joined (AE ' + member.aeVersion + ')');
          checkMemberBuild(member);
          checkMemberVersion(member);
          checkMemberProject(member);
          checkCompDivergence(member);
        } else {
          delete state.members[member.id];
          var idx = state.order.indexOf(member.id);
          if (idx >= 0) state.order.splice(idx, 1);
          log(member.name + ' left');
        }
        renderMembers();
        pushPeersToNative();
        return;
      }
      case 'cursors': {
        for (var j = 0; j < msg.batch.length; j++) {
          var c = msg.batch[j];
          var target = state.members[c.id];
          if (!target) continue;
          if (c.active === false) {
            delete target.cursor;
          } else {
            target.cursor = { x: c.x, y: c.y };
            if (c.compId) target.compId = c.compId;
          }
        }
        renderCanvas();
        pushPeersToNative();
        return;
      }
      case 'selection': {
        var sel = state.members[msg.id];
        if (sel) {
          sel.selection = msg.layers;
          if (msg.compId) sel.compId = msg.compId;
          sel.compHash = msg.hash || '';
          checkCompDivergence(sel);
        }
        renderMembers();
        return;
      }
      case 'op': {
        if (msg.author === state.selfId) return;
        if (msg.op && msg.op.opId) {
          if (state.seenOps[msg.op.opId]) return;
          state.seenOps[msg.op.opId] = 1;
          if (++state.seenOpCount > 1000) {
            state.seenOps = {};
            state.seenOpCount = 0;
          }
        }
        state.opsReceived++;
        maybeLogRx(msg.op.kind, msg.op.path);
        if (echo) {
          var opLayer = msg.op.target ? msg.op.target.layer || '' : '';
          var echoValue = msg.op.kind === 'set' && msg.op.path !== 'textDoc' ? msg.op.value : undefined;
          var echoTime = (msg.op.kind === 'addKey' || msg.op.kind === 'setKey' || msg.op.kind === 'removeKey') ? msg.op.time : undefined;
          echo.mark(opLayer, msg.op.path || '', echoValue, echoTime);
        }
        if (inAE) applyRemoteOp(msg.op);
        return;
      }
      case 'lock': {
        log('lock ' + msg.target + ' -> ' + (msg.owner ? shortId(msg.owner) : 'free'));
        return;
      }
      case 'error': {
        log('server error: ' + msg.code + ' ' + msg.message);
        return;
      }
      case 'pong':
        state.latencyMs = Date.now() - state.lastPingAt;
        return;
    }
  }

  function shortId(id) {
    return typeof id === 'string' ? id.slice(0, 4) : '?';
  }

  function textSyncEnabled() {
    return window.VYNK_TEXT_SYNC === true;
  }

  function scheduleTextOp(op) {
    var key = (op.target ? op.target.layer : '') + '|textDoc';
    var existing = state.textDebounce[key];
    if (existing && existing.timer) clearTimeout(existing.timer);
    var timer = setTimeout(function () { flushTextOp(key); }, TEXT_DEBOUNCE_MS);
    state.textDebounce[key] = { op: op, timer: timer };
  }

  function flushTextOp(key) {
    var entry = state.textDebounce[key];
    if (!entry) return;
    delete state.textDebounce[key];
    state.lastLocalTextAt = Date.now();
    if (!state.connected) return;
    send({ t: 'op', op: entry.op });
    txLog([entry.op]);
  }

  function debounceTextOps(ops) {
    if (!textSyncEnabled()) {
      var nonText = [];
      for (var i = 0; i < ops.length; i++) {
        if (ops[i].kind === 'set' && ops[i].path === 'textDoc') continue;
        nonText.push(ops[i]);
      }
      return nonText;
    }
    var out = [];
    for (var j = 0; j < ops.length; j++) {
      if (ops[j].kind === 'set' && ops[j].path === 'textDoc') {
        scheduleTextOp(ops[j]);
        continue;
      }
      out.push(ops[j]);
    }
    return out;
  }

  function scheduleQueueFlush() {
    if (state.queueFlushTimer) return;
    state.queueFlushTimer = setTimeout(function () {
      state.queueFlushTimer = null;
      if (state.remoteQueue.length === 0) return;
      if (!aeIsFocused()) return;
      if (Date.now() - state.lastLocalTextAt < LOCAL_TEXT_HOLD_MS) {
        scheduleQueueFlush();
        return;
      }
      // Do not yank a value out from under a live drag: wait for the gesture to
      // settle, then apply the newest remote value per target.
      var now = Date.now();
      for (var i = 0; i < state.remoteQueue.length; i++) {
        var k = opKey(state.remoteQueue[i]);
        if (k && now - (state.localEditAt[k] || 0) < GESTURE_HOLD_MS) {
          scheduleQueueFlush();
          return;
        }
      }
      flushRemoteQueue();
    }, FOCUS_QUEUE_DELAY_MS);
  }

  // Per-target key shared by the queue and the gesture hold. Structure/effect
  // ops return '' and are never held.
  function opKey(op) {
    if (!op || !op.target) return '';
    if (op.kind === 'set' || op.kind === 'setExpr') return op.target.layer + '|' + (op.path || '');
    if (op.kind === 'addKey' || op.kind === 'setKey' || op.kind === 'removeKey') {
      return op.target.layer + '|' + (op.path || '') + '|' + (op.time !== undefined ? Math.round(op.time * 10000) : '');
    }
    return '';
  }

  function noteLocalGesture(op) {
    var k = opKey(op);
    if (k) state.localEditAt[k] = Date.now();
  }

  function aeIsFocused() {
    if (!state.focusKnown) return true;
    return state.aeFocused;
  }

  function queueRemoteOp(op) {
    if (state.remoteQueue.length === 0) log('AE not focused - holding remote edits until focus returns');
    if (state.remoteQueue.length > MAX_REMOTE_QUEUE) state.remoteQueue.shift();
    state.remoteQueue.push(op);
  }

  function flushRemoteQueue() {
    if (state.remoteQueue.length === 0) return;
    var queue = state.remoteQueue;
    state.remoteQueue = [];
    var lastIndex = {};
    var i;
    for (i = 0; i < queue.length; i++) {
      var op = queue[i];
      if (!op.target) continue;
      var key;
      if (op.kind === 'set' || op.kind === 'setExpr') {
        key = op.target.layer + '|' + (op.path || '');
      } else if (op.kind === 'addKey' || op.kind === 'setKey' || op.kind === 'removeKey') {
        key = op.target.layer + '|' + (op.path || '') + '|' + (op.time !== undefined ? Math.round(op.time * 10000) : '');
      } else {
        continue;
      }
      lastIndex[key] = i;
    }
    var applied = 0;
    for (i = 0; i < queue.length; i++) {
      var op2 = queue[i];
      if (!op2.target) {
        applyRemoteOp(op2);
        applied++;
        continue;
      }
      var key2;
      if (op2.kind === 'set' || op2.kind === 'setExpr') {
        key2 = op2.target.layer + '|' + (op2.path || '');
      } else if (op2.kind === 'addKey' || op2.kind === 'setKey' || op2.kind === 'removeKey') {
        key2 = op2.target.layer + '|' + (op2.path || '') + '|' + (op2.time !== undefined ? Math.round(op2.time * 10000) : '');
      } else {
        applyRemoteOp(op2);
        applied++;
        continue;
      }
      if (lastIndex[key2] !== i) continue;
      applyRemoteOp(op2);
      applied++;
    }
    log('applied ' + applied + ' queued op(s) after focus returned');
  }

  function effectMatchNameOf(op) {
    if (!op) return '';
    if (op.kind === 'addEffect' && op.value && op.value.matchName) return String(op.value.matchName);
    var path = op.path || '';
    if (path.indexOf('fx:') !== 0) return '';
    var rest = path.substring(3);
    var hash = rest.indexOf('#');
    var slash = rest.indexOf('/');
    var end = rest.length;
    if (hash >= 0 && hash < end) end = hash;
    if (slash >= 0 && slash < end) end = slash;
    return rest.substring(0, end);
  }

  function invalidateCompBaselines(compId) {
    if (!compId) return;
    delete state.compStates[compId];
    delete state.fxStates[compId];
    delete state.textStates[compId];
    delete state.shapeStates[compId];
  }

  function localProjectOnBase() {
    if (!state.baseInfo || !state.baseInfo.name) return false;
    if (state.baseOpened) return true;
    return state.projectName === state.baseInfo.name;
  }

  function hasDivergenceForComp(compId) {
    for (var id in state.members) {
      if (id === state.selfId) continue;
      var m = state.members[id];
      if (m.compId && compId && m.compId === compId && state.divergedWith[id]) return true;
    }
    return false;
  }

  function tryApplyReplay() {
    if (!state.pendingReplay) return;
    if (state.pendingReplay.length === 0 && !state.replayTruncated) return;
    if (state.replayApplied) return;
    if (!inAE || !cs) return;
    if (state.stamping || state.polling) return;
    if (state.replayTruncated) {
      state.catchupState = 'held-truncated';
      return;
    }
    if (hasDivergence()) {
      state.catchupState = 'held-diverged';
      if (!state.catchupLogged) {
        state.catchupLogged = true;
        log('catch-up held: your project structure differs from a teammate - open the same project file');
      }
      return;
    }
    if (!localProjectOnBase()) {
      state.catchupState = 'held-base';
      if (!state.catchupLogged) {
        state.catchupLogged = true;
        log('catch-up held: click "get base" (or open the shared base) to receive the ' + state.pendingReplay.length + ' earlier edit(s) safely');
      }
      return;
    }
    if (state.replayTruncated) {
      state.catchupState = 'gap';
      fetchMissingHistory();
      return;
    }
    state.replayApplied = true;
    state.catchupState = 'applied';
    var logged = state.pendingReplay;
    state.pendingReplay = null;
    log('catching up: applying ' + logged.length + ' earlier edit(s)');
    var applied = 0;
    var failed = 0;
    for (var i = 0; i < logged.length; i++) {
      var entry = logged[i];
      var op = entry && entry.op ? entry.op : entry;
      if (!op || !op.opId) continue;
      if (state.seenOps[op.opId]) continue;
      state.seenOps[op.opId] = 1;
      if (op.target && op.target.comp) invalidateCompBaselines(op.target.comp);
      if (op.kind === 'set' && op.path === 'textDoc' && !textSyncEnabled()) continue;
      applied++;
      cs.evalScript('collab.applyOp(' + JSON.stringify(JSON.stringify(op)) + ')', function (res) {
        if (res && res.indexOf('"ok":false') >= 0) {
          failed++;
          state.applyFails = (state.applyFails || 0) + 1;
          if (failed <= 3) log('catch-up apply failed: ' + String(res).slice(0, 80));
        }
      });
    }
    state.lastChangeAt = Date.now();
    log('catch-up: ' + applied + ' edit(s) applied');
  }

  function applyRemoteOp(op) {
    if (!cs || !inAE) return;
    var opComp = op.target ? op.target.comp : null;
    if (opComp && state.compId && opComp !== state.compId) {
      invalidateCompBaselines(opComp);
    }
    var fxName = effectMatchNameOf(op);
    if (fxName && state.missingFx[fxName]) return;
    if (op.kind === 'set' && op.path === 'textDoc') {
      if (!textSyncEnabled()) return;
      if (Date.now() - state.lastLocalTextAt < LOCAL_TEXT_HOLD_MS) {
        queueRemoteOp(op);
        scheduleQueueFlush();
        return;
      }
    }
    if (!aeIsFocused()) {
      queueRemoteOp(op);
      return;
    }
    var gestureKey = opKey(op);
    if (gestureKey && Date.now() - (state.localEditAt[gestureKey] || 0) < GESTURE_HOLD_MS) {
      queueRemoteOp(op);
      scheduleQueueFlush();
      return;
    }
    try {
      cs.evalScript('collab.applyOp(' + JSON.stringify(JSON.stringify(op)) + ')', function (res) {
        if (res && res.indexOf('"ok":false') >= 0) {
          if (res.indexOf('effect unavailable') >= 0) {
            if (fxName && !state.missingFx[fxName]) {
              state.missingFx[fxName] = true;
              log('effect not installed here - skipping: ' + fxName);
            }
          } else {
            state.applyFails = (state.applyFails || 0) + 1;
            logThrottled('applyfail:' + String(res).slice(0, 60), 'apply failed: ' + res, 3000);
          }
        } else if (!res && (state.applyLogCount || 0) < 5) {
          state.applyLogCount = (state.applyLogCount || 0) + 1;
          log('apply returned empty (typeof=' + (typeof res) + ')');
        } else if (res && (state.applyOkCount || 0) < 10) {
          state.applyOkCount = (state.applyOkCount || 0) + 1;
          log('apply ok: ' + String(res).slice(0, 80));
        }
      });
    } catch (e) {}
  }

  function compLabel(compId) {
    if (!compId) return '';
    var idx = compId.indexOf('|');
    return idx >= 0 ? compId.substring(idx + 1) : compId;
  }

  function renderMembers() {
    var el = $('membersEl');
    el.innerHTML = '';
    $('memberCount').textContent = String(state.order.length);
    for (var i = 0; i < state.order.length; i++) {
      var id = state.order[i];
      var m = state.members[id];
      if (!m) continue;
      var row = document.createElement('div');
      row.className = 'member';

      var swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.background = m.color;
      row.appendChild(swatch);

      var name = document.createElement('span');
      name.textContent = m.name + (id === state.selfId ? ' (you)' : '');
      row.appendChild(name);

      var ver = document.createElement('span');
      ver.className = 'ver';
      ver.textContent = 'AE ' + m.aeVersion;
      row.appendChild(ver);

      if (m.project) {
        var proj = document.createElement('span');
        proj.className = 'ver';
        proj.style.maxWidth = '96px';
        proj.style.overflow = 'hidden';
        proj.style.textOverflow = 'ellipsis';
        proj.style.whiteSpace = 'nowrap';
        proj.textContent = m.project;
        if (state.projectName && m.project !== state.projectName) {
          proj.style.color = '#ff5c5c';
          proj.title = 'different project file: ' + m.project + ' (you have ' + state.projectName + ')';
          checkMemberProject(m);
        } else {
          proj.style.color = '#c9a227';
          proj.title = m.project;
        }
        row.appendChild(proj);
      }

      var comp = document.createElement('span');
      comp.className = 'comp';
      var label = compLabel(m.compId);
      if (label && m.selection && m.selection.length > 0) label += ' · ' + m.selection.length + ' sel';
      comp.textContent = label;
      row.appendChild(comp);

      el.appendChild(row);
    }
  }

  function sanitizeBase(b) {
    if (!b || typeof b !== 'object' || typeof b.name !== 'string' || !b.name) return null;
    return {
      name: String(b.name).slice(0, 80),
      size: Number(b.size) || 0,
      hash: typeof b.hash === 'string' ? b.hash : '',
      uploadedBy: typeof b.uploadedBy === 'string' ? b.uploadedBy : 'unknown',
      uploadedAt: Number(b.uploadedAt) || 0,
      aeVersion: typeof b.aeVersion === 'string' ? b.aeVersion : ''
    };
  }

  function renderBase() {
    var el = $('baseText');
    if (!el) return;
    if (state.baseInfo && state.baseInfo.name) {
      el.textContent = 'base: ' + state.baseInfo.name + ' (' + Math.round((state.baseInfo.size || 0) / 1024) + ' KB, by ' + (state.baseInfo.uploadedBy || '?') + ')';
    } else {
      el.textContent = 'base: none shared';
    }
  }

  // One-line live view of the sync pipeline. Kept deliberately compact so it can
  // sit above the log without stealing space; window.vynkHealth() has the detail.
  function renderHealth() {
    var el = $('healthEl');
    if (!el) return;
    if (!state.connected) {
      el.textContent = 'sync: offline' + (state.outbox.length ? ' - ' + state.outbox.length + ' unsent' : '');
      return;
    }
    var age = state.lastRxAt ? Math.round((Date.now() - state.lastRxAt) / 1000) : 0;
    var parts = [
      'poll ' + (state.pollMs || 0) + 'ms',
      'tx ' + state.opsSent,
      'rx ' + state.opsReceived,
      'fail ' + (state.applyFails || 0),
      'q ' + state.remoteQueue.length,
      're ' + (state.reconnects || 0),
      'stop ' + state.pollScheduledDelay + 'ms',
      'age ' + age + 's'
    ];
    if (state.catchupState !== 'none') parts.push('catchup ' + state.catchupState);
    el.textContent = 'sync: ' + parts.join('  ');
  }

  window.vynkHealth = function () {
    return {
      connected: state.connected,
      room: state.room,
      pollMs: state.pollMs,
      pollDelayMs: state.pollScheduledDelay,
      opsSent: state.opsSent,
      opsReceived: state.opsReceived,
      applyFails: state.applyFails,
      queued: state.remoteQueue.length,
      outbox: state.outbox.length,
      reconnects: state.reconnects,
      catchup: state.catchupState,
      base: state.baseInfo ? state.baseInfo.name : null
    };
  };

  function relayHttpBase() {
    var s = ($('serverInput').value || '').trim();
    s = s.replace(/^ws:/i, 'http:').replace(/^wss:/i, 'https:');
    s = s.replace(/\/+$/, '').replace(/\/ws$/i, '');
    return s;
  }

  // Stream the local project file to the relay (no full-file buffering).
  function httpPutFile(pathAndQuery, srcPath, cb) {
    var u;
    try { u = new (require('url').URL)(relayHttpBase() + pathAndQuery); }
    catch (e) { cb(new Error('bad server url')); return; }
    var mod = u.protocol === 'https:' ? require('https') : require('http');
    var fs = require('fs');
    var stat;
    try { stat = fs.statSync(srcPath); } catch (e2) { cb(e2); return; }
    var finished = false;
    function done(err, status, buf) { if (finished) return; finished = true; cb(err, status, buf); }
    var req = mod.request(u, { method: 'PUT', headers: { 'content-type': 'application/octet-stream', 'content-length': String(stat.size) } }, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () { done(null, res.statusCode, Buffer.concat(chunks)); });
    });
    req.on('error', function (e3) { done(e3); });
    req.setTimeout(120000, function () { req.destroy(new Error('upload timed out')); });
    var rs = fs.createReadStream(srcPath);
    rs.on('error', function (e4) { done(e4); });
    rs.pipe(req);
  }

  function httpGetText(pathAndQuery, cb) {
    var u;
    try { u = new (require('url').URL)(relayHttpBase() + pathAndQuery); }
    catch (e) { cb(new Error('bad server url')); return; }
    var mod = u.protocol === 'https:' ? require('https') : require('http');
    var finished = false;
    function done(err, status, text) { if (finished) return; finished = true; cb(err, status, text); }
    var req = mod.request(u, { method: 'GET' }, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () { done(null, res.statusCode, Buffer.concat(chunks).toString('utf8')); });
    });
    req.on('error', function (e2) { done(e2); });
    req.setTimeout(60000, function () { req.destroy(new Error('history request timed out')); });
    req.end();
  }

  // The relay caps `welcome.ops`; pull the rest from the persisted log before
  // giving up on catch-up. Only runs when the local project is provably on the
  // shared base, so the ops are safe to apply.
  var HISTORY_FETCH_LIMIT = 2000;
  function fetchMissingHistory() {
    if (state.fetchingHistory || state.historyFetchTried) return;
    if (!state.roomToken || !state.baseSeq || !state.fromSeq) {
      log('cannot recover the missing history - ask the host to "share base" again');
      return;
    }
    var before = state.fromSeq;
    state.fetchingHistory = true;
    state.historyFetchTried = true;
    log('history gap: fetching edits ' + (state.baseSeq + 1) + '-' + (before - 1) + ' from the relay...');
    var q = '/ops?token=' + encodeURIComponent(state.roomToken) +
      '&after=' + state.baseSeq + '&before=' + before + '&limit=' + (HISTORY_FETCH_LIMIT + 1);
    httpGetText(q, function (err, status, text) {
      state.fetchingHistory = false;
      if (err || status !== 200) {
        log('history fetch failed: ' + (err ? err.message : 'HTTP ' + status) + ' - ask the host to "share base" again');
        return;
      }
      var lines = String(text || '').split('\n');
      var ops = [];
      for (var i = 0; i < lines.length; i++) {
        if (!lines[i]) continue;
        var entry;
        try { entry = JSON.parse(lines[i]); } catch (e) { continue; }
        if (entry && entry.seq && entry.op) ops.push(entry);
      }
      if (ops.length === 0) {
        log('history fetch returned nothing - ask the host to "share base" again');
        return;
      }
      if (ops.length > HISTORY_FETCH_LIMIT) {
        log('history gap is too large to replay (' + ops.length + '+) - ask the host to "share base" again');
        return;
      }
      state.replayTruncated = false;
      state.catchupLogged = false;
      state.pendingReplay = ops.concat(state.pendingReplay || []);
      log('history gap filled: recovered ' + ops.length + ' edit(s)');
      tryApplyReplay();
    });
  }

  // Stream the relay's base file to disk (no full-file buffering).
  function httpGetToFile(pathAndQuery, destPath, cb) {    var u;
    try { u = new (require('url').URL)(relayHttpBase() + pathAndQuery); }
    catch (e) { cb(new Error('bad server url')); return; }
    var mod = u.protocol === 'https:' ? require('https') : require('http');
    var fs = require('fs');
    var crypto = require('crypto');
    var hash = crypto.createHash('sha256');
    var finished = false;
    function done(err, digest) { if (finished) return; finished = true; cb(err, digest); }
    var req = mod.request(u, { method: 'GET' }, function (res) {
      if (res.statusCode !== 200) { res.resume(); done(new Error('HTTP ' + res.statusCode)); return; }
      res.on('data', function (c) { hash.update(c); });
      var ws = fs.createWriteStream(destPath);
      res.pipe(ws);
      ws.on('finish', function () { done(null, hash.digest('hex').slice(0, 16)); });
      ws.on('error', function (e) { done(e); });
    });
    req.on('error', function (e2) { done(e2); });
    req.setTimeout(120000, function () { req.destroy(new Error('download timed out')); });
    req.end();
  }

  function shareBase() {
    if (!state.connected || !state.roomToken) { log('join a room first'); return; }
    if (!state.projectPath) { log('save your project first (no file path yet)'); return; }
    var pathmod;
    try { pathmod = require('path'); } catch (e) { log('node path unavailable'); return; }
    var name = pathmod.basename(state.projectPath);
    var by = ($('nameInput').value || '').trim() || 'anon';
    var q = '/base?token=' + encodeURIComponent(state.roomToken) + '&name=' + encodeURIComponent(name) + '&by=' + encodeURIComponent(by) + '&ae=' + encodeURIComponent(hostVersion || '');
    log('sharing base project (' + name + ')...');
    httpPutFile(q, state.projectPath, function (err, status, body) {
      if (err) { log('share failed: ' + err.message); return; }
      if (status !== 200) { log('share failed: HTTP ' + status + ' ' + String(body).slice(0, 120)); return; }
      try { state.baseInfo = sanitizeBase(JSON.parse(String(body)).base); } catch (e3) {}
      renderBase();
      log('base shared: ' + name);
    });
  }

  function getBase() {
    if (!state.connected || !state.roomToken) { log('join a room first'); return; }
    if (!state.baseInfo) { log('no base shared yet - ask the host to share it'); return; }
    if (!inAE || !cs) { log('base download only works inside After Effects'); return; }
    var baseVer = state.baseInfo.aeVersion ? String(state.baseInfo.aeVersion) : '';
    var myMajor = /(\d+)/.exec(hostVersion || '');
    var baseMajor = /(\d+)/.exec(baseVer);
    var verWarn = '';
    if (myMajor && baseMajor && Number(myMajor[1]) < Number(baseMajor[1])) {
      verWarn = '\n\nWARNING: this base was saved by a NEWER After Effects (' + baseVer + '); your AE ' + hostVersion + ' may not open it.';
    }
    if (typeof window.confirm === 'function' && !window.confirm('Open the shared base project "' + state.baseInfo.name + '"?' + verWarn + '\n\nYour current (unsaved) project will be replaced.')) return;
    var fs, pathmod;
    try { fs = require('fs'); pathmod = require('path'); } catch (e) { log('node fs unavailable'); return; }
    var dir = (process.env.TEMP || '.') + '\\Vynk';
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e2) {}
    var name = (state.baseInfo && state.baseInfo.name) || 'base.aep';
    var dest = pathmod.join(dir, name);
    log('downloading base project...');
    httpGetToFile('/base?token=' + encodeURIComponent(state.roomToken), dest, function (err, digest) {
      if (err) { log('download failed: ' + err.message); return; }
      if (state.baseInfo && state.baseInfo.hash && digest && digest !== state.baseInfo.hash) {
        log('WARNING: base project hash mismatch (download may be corrupt) - not opening');
        return;
      }
      var jsx = 'new File(' + JSON.stringify(String(dest).replace(/\\/g, '/')) + ')';
      cs.evalScript('(function(){try{app.open(' + jsx + ');return "opened";}catch(e){return "ERR "+e.toString();}})()', function (res) {
        if (res === 'opened') {
          resetBaselines();
          state.baseOpened = true;
          log('base opened - sync baseline reset');
          tryApplyReplay();
        }
        log('open base: ' + res + ' (' + dest + ')');
      });
    });
  }

  function renderCanvas() {
    var canvas = $('canvas');
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.clientWidth;
    var h = canvas.clientHeight;
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#141414';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1;
    for (var gx = 0; gx < w; gx += w / 8) {
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke();
    }
    for (var gy = 0; gy < h; gy += h / 4) {
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke();
    }

    if (!inAE && state.myCursor.known) {
      drawCursorDot(ctx, w, h, state.myCursor.x, state.myCursor.y, '#ffffff', 'you');
    }
    for (var i = 0; i < state.order.length; i++) {
      var m = state.members[state.order[i]];
      if (!m || !m.cursor) continue;
      drawCursorDot(ctx, w, h, m.cursor.x, m.cursor.y, m.color, m.name);
    }
  }

  function drawCursorDot(ctx, w, h, x, y, color, label) {
    var px = x * w;
    var py = y * h;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(px, py, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.stroke();
    ctx.font = '10px "Segoe UI", sans-serif';
    var tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(px + 6, py + 4, tw + 8, 14);
    ctx.fillStyle = color;
    ctx.fillText(label, px + 10, py + 15);
  }

  function setHelperText() {
    var t;
    if (!state.helper.node) t = 'cursors: browser mode';
    else if (state.aegp.connected) t = 'cursors: native';
    else t = 'cursors: waiting';
    $('helperText').textContent = t;
  }

  // Peer cursors are drawn by the native AEGP overlay; we just hand it the list.
  function pushPeersToNative() {
    var sock = state.aegp.sock;
    if (!sock || sock.destroyed) return;
    var parts = [];
    for (var i = 0; i < state.order.length; i++) {
      var id = state.order[i];
      var m = state.members[id];
      if (!m || id === state.selfId) continue;
      var cur = m.cursor;
      parts.push([
        id.replace(/[\t;\n]/g, ''),
        String(m.name).replace(/[\t;\n]/g, ' '),
        m.color,
        (cur ? cur.x : 0).toFixed(5),
        (cur ? cur.y : 0).toFixed(5),
        cur ? '1' : '0'
      ].join('\t'));
    }
    try { sock.write('PEERS\t' + parts.join(';') + '\n'); } catch (e) {}
  }

  function idleIntervalMs(normalMs, nativeMs) {
    if (state.nativeMode && (Date.now() - state.lastChangeAt) >= POLL_BURST_MS) return nativeMs;
    return normalMs;
  }

  function onAegpLine(line) {
    // The native companion tells us the project was touched (CHANGED) or the
    // active comp / selection changed (COMP/SEL). Any of those is the cue to do
    // one evalScript snapshot instead of polling constantly. We don't take the
    // native values directly (layer-id format differs pre-AE22), we just use the
    // signal to poll now and let the existing diff produce the ops.
    if (line.indexOf('CHANGED') === 0 || line.indexOf('SEL\t') === 0 || line.indexOf('COMP\t') === 0) {
      state.lastChangeAt = Date.now();
      nudgeAePoll();
      return;
    }
    if (line.indexOf('CURSOR\t') === 0) {
      var f = line.split('\t');
      var x = parseFloat(f[1]);
      var y = parseFloat(f[2]);
      if (!isFinite(x) || !isFinite(y)) return;
      state.myCursor = { x: x, y: y, known: true };
      state.pendingCursor = { x: x, y: y };
      renderCanvas();
      return;
    }
    if (line.indexOf('FOCUS\t') === 0) {
      var nowFocused = line.charAt(6) === '1';
      var wasFocused = aeIsFocused();
      state.focusKnown = true;
      state.aeFocused = nowFocused;
      if (!nowFocused && state.myCursor.known) {
        send({ t: 'cursor', x: state.myCursor.x, y: state.myCursor.y, active: false });
      } else if (nowFocused && state.myCursor.known) {
        state.pendingCursor = { x: state.myCursor.x, y: state.myCursor.y };
      }
      if (nowFocused && !wasFocused) flushRemoteQueue();
      return;
    }
  }

  // If we are sitting on a slow (idle) poll timer and a native change arrives,
  // pull the next snapshot forward. Once the loop is already fast, further
  // CHANGEDs just keep lastChangeAt fresh (no timer churn).
  function nudgeAePoll() {
    if (!inAE || !cs) return;
    if (state.polling) return;
    if (state.pollTimer && state.pollScheduledDelay > POLL_FAST_MS) {
      clearTimeout(state.pollTimer);
      state.pollTimer = null;
      scheduleAePoll(POLL_FAST_MS);
    }
  }

  // The AEGP binds an ephemeral port and writes it here; re-read on every
  // attempt so we pick up a fresh port if AE restarted.
  function aegpBridgePort() {
    try {
      var fs = require('fs');
      var file = (process.env.LOCALAPPDATA || '') + '\\Vynk\\bridge.port';
      var n = parseInt(fs.readFileSync(file, 'utf8').trim(), 10);
      if (n > 0 && n < 65536) return n;
    } catch (e) {}
    return AEGP_PORT;
  }

  function initAegpBridge() {
    if (!state.helper.node) return;
    var net;
    try { net = require('net'); } catch (e) { return; }
    function connect() {
      var sock;
      try { sock = net.connect(aegpBridgePort(), '127.0.0.1'); } catch (e) {
        setTimeout(connect, AEGP_RECONNECT_MS);
        return;
      }
      state.aegp.sock = sock;
      sock.setNoDelay(true);
      var buf = '';
      sock.on('connect', function () {
        state.aegp.connected = true;
        state.nativeMode = true;
        log('native AEGP bridge connected - background evalScript polling reduced');
        try { sock.write('HELLO\n'); } catch (e) {}
        setHelperText();
        pushPeersToNative();
      });
      sock.on('data', function (chunk) {
        buf += chunk.toString('utf8');
        var idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          var line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          onAegpLine(line);
        }
      });
      sock.on('close', function () {
        if (state.nativeMode) log('native AEGP bridge lost - full polling resumes');
        state.aegp.connected = false;
        state.nativeMode = false;
        state.aegp.sock = null;
        setHelperText();
        setTimeout(connect, AEGP_RECONNECT_MS);
      });
      sock.on('error', function () {});
    }
    connect();
  }

  function maybeLogRx(kind, path) {
    var now = Date.now();
    if (kind !== 'set' || now - state.lastRxLogAt > 500) {
      state.lastRxLogAt = now;
      log('rx ' + kind + ' ' + (path || ''));
    }
  }

  function txLog(ops) {
    var now = Date.now();
    if (now - state.lastTxLogAt <= 500) return;
    state.lastTxLogAt = now;
    var first = ops[0];
    var suffix = ops.length > 1 ? ' +' + (ops.length - 1) : '';
    log('tx ' + ops.length + ' op(s) ' + first.kind + ' ' + (first.path || '') + suffix);
  }

  function fetchHostInfo(cb) {
    if (!inAE || !cs) {
      if (cb) cb(false);
      return;
    }
    try {
      cs.evalScript('(typeof collab === "undefined") ? "null" : collab.getHostInfo()', function (res) {
        var ok = false;
        if (res && res !== 'null' && res.indexOf('EvalScript error') !== 0) {
          try {
            var info = JSON.parse(res);
            var newPath = info.projectPath || '';
            if (state.projectPath && newPath && newPath !== state.projectPath) {
              log('project changed: ' + (info.projectName || '?') + ' - resetting sync baseline');
              resetBaselines();
            }
            state.projectName = info.projectName || state.projectName || '';
            state.projectPath = newPath || state.projectPath || '';
            tryApplyReplay();
            ok = true;
          } catch (e) {}
        }
        if (cb) cb(ok);
      });
    } catch (e) {
      if (cb) cb(false);
    }
  }

  function initAeBridge() {
    if (!inAE || !cs) {
      $('hostText').textContent = 'browser (test mode)';
      $('compText').textContent = '';
      return;
    }
    state.pollGeneration = (state.pollGeneration || 0) + 1;
    $('hostText').textContent = 'AE ' + hostVersion;
    log('panel ' + PANEL_BUILD + ' starting (AE ' + hostVersion + ') text=' + (textSyncEnabled() ? 'on' : 'off'));
    if (!CollabDiff) log('diff module missing - property sync disabled');
    try {
      var extPath = cs.getSystemPath(window.SystemPath.EXTENSION);
      if (extPath) {
        var jsxPath = String(extPath).replace(/\\/g, '/') + '/jsx/hostscript.jsx';
        log('loading hostscript: ' + jsxPath);
        cs.evalScript(
          '(function(){try{$.evalFile(' + JSON.stringify(jsxPath) + ');return "ok, collab=" + (typeof collab) + ", polyfill=" + ((typeof collab === "object") ? collab.jsonPolyfilled : "n/a");}catch(e){return "ERROR " + e.toString();}})()',
          function (res) { log('hostscript load: ' + res); }
        );
      } else {
        log('extension path unavailable - relying on manifest ScriptPath');
      }
    } catch (e) {
      log('hostscript load error: ' + e.message);
    }
    setTimeout(function () {
      cs.evalScript('typeof collab', function (res) {
        log('hostscript status: ' + res);
      });
    }, 2500);
    setInterval(function () {
      if (state.compId) return;
      log('diag: no comp (polls=' + state.pollCount + ', missing=' + state.missingPolls + ', last=' + (state.lastPollResult || 'none') + ')');
    }, 30000);
    fetchHostInfo(function (ok) {
      if (ok) log('project: ' + (state.projectName || '(unsaved)'));
    });
    setInterval(function () { fetchHostInfo(null); }, 10000);
    scheduleAePoll(POLL_FAST_MS);
    scheduleFxPoll(idleIntervalMs(FX_POLL_MS, NATIVE_FX_POLL_MS));
    scheduleTextPoll(idleIntervalMs(TEXT_POLL_MS, NATIVE_TEXT_POLL_MS));
    scheduleShapePoll(idleIntervalMs(SHAPE_POLL_MS, NATIVE_SHAPE_POLL_MS));
  }

  function wsBackpressure() {
    if (!state.ws || state.ws.readyState !== 1) return 0;
    var buf = state.ws.bufferedAmount || 0;
    if (buf > BACKPRESSURE_HIGH) return 3;
    if (buf > BACKPRESSURE_MEDIUM) return 2;
    if (buf > BACKPRESSURE_LOW) return 1;
    return 0;
  }

  function scheduleAePoll(delay) {
    if (!inAE || !cs) return;
    var gen = state.pollGeneration;
    var bp = wsBackpressure();
    var eff = delay;
    if (bp === 3) eff = BP_HIGH_POLL_MS;
    else if (bp === 2) eff = Math.max(delay, BP_MEDIUM_POLL_MS);
    else if (bp === 1) eff = Math.max(delay, BP_SLOW_POLL_MS);
    state.pollScheduledDelay = eff;
    state.pollTimer = setTimeout(function () { if (state.pollGeneration === gen) pollAe(); }, eff);
  }

  function pollAe() {
    if (state.stamping) {
      if (Date.now() - state.stampStartedAt > WATCHDOG_STAMP_MS) {
        state.stamping = false;
        log('add: stamp watchdog fired');
      } else {
        scheduleAePoll(POLL_FAST_MS);
        return;
      }
    }
    if (!aeIsFocused()) {
      scheduleAePoll(2000);
      return;
    }
    if (state.polling) {
      if (Date.now() - (state.pollStartedAt || 0) > WATCHDOG_POLL_MS) {
        state.polling = false;
        log('poll watchdog: no evalScript callback for ' + WATCHDOG_POLL_MS / 1000 + 's, recovering');
      } else {
        scheduleAePoll(POLL_FAST_MS);
        return;
      }
    }
    state.polling = true;
    state.pollStartedAt = Date.now();
    try {
      cs.evalScript(
        '(function(){try{' +
          'if(typeof collab==="undefined")return "jsx-missing";' +
          'if(typeof collab.getActiveCompState!=="function")return "fn-missing";' +
          'var s=collab.getActiveCompState(false);' +
          'return (typeof s==="string"&&s.charAt(0)==="{")?s:("state-null:"+String(s).slice(0,60));' +
          '}catch(e){return "call-EXC:"+e.toString();}})()',
        function (res) {
        try {
        state.polling = false;
        state.pollCount = (state.pollCount || 0) + 1;
        var tookMs = Date.now() - (state.pollStartedAt || Date.now());
        state.pollMs = state.pollMs ? Math.round(state.pollMs * 0.8 + tookMs * 0.2) : tookMs;
        state.lastPollResult = String(res || '').slice(0, 140);
        if (state.pollCount <= 2) log('poll#' + state.pollCount + ' ' + String(res).slice(0, 90));
        var next = null;
        if (res === 'jsx-missing') {
          state.missingPolls = (state.missingPolls || 0) + 1;
          if (state.missingPolls === 8) log('hostscript not loaded during poll - check jsx/hostscript.jsx');
        } else {
          state.missingPolls = 0;
          if (typeof res === 'string' && res.charAt(0) === '{') {
            try { next = JSON.parse(res); } catch (e) { next = null; }
          }
        }
        handleCompState(next);
        } catch (e2) {
          state.pollLoopError = (state.pollLoopError || 0) + 1;
          if (state.pollLoopError <= 3) log('poll loop error: ' + (e2 && e2.message ? e2.message : String(e2)));
        }
        var idleMs = state.nativeMode ? NATIVE_IDLE_POLL_MS : POLL_SLOW_MS;
        var delay = Date.now() - state.lastChangeAt < POLL_BURST_MS ? POLL_FAST_MS : idleMs;
        scheduleAePoll(delay);
      });
    } catch (e) {
      state.polling = false;
      scheduleAePoll(POLL_SLOW_MS);
    }
  }

  function scheduleFxPoll(delay) {
    if (!inAE || !cs) return;
    var gen = state.pollGeneration;
    setTimeout(function () { if (state.pollGeneration === gen) pollFx(); }, delay);
  }

  function pollFx() {
    if (!inAE || !cs || state.stamping) {
      scheduleFxPoll(idleIntervalMs(FX_POLL_MS, NATIVE_FX_POLL_MS));
      return;
    }
    if (!aeIsFocused()) {
      scheduleFxPoll(2000);
      return;
    }
    try {
      state.fxChunk = (state.fxChunk || 0) % FX_CHUNKS;
      var chunkIndex = state.fxChunk;
      state.fxChunk = (chunkIndex + 1) % FX_CHUNKS;
      cs.evalScript(
        '(typeof collab === "undefined") ? "undefined" : collab.getActiveCompEffects(' + chunkIndex + ', ' + FX_CHUNKS + ')',
        function (res) {
        try {
          state.fxPollCount = (state.fxPollCount || 0) + 1;
          if (res && res.indexOf('EvalScript error') === 0) {
            state.fxErrorCount = (state.fxErrorCount || 0) + 1;
            if (state.fxErrorCount <= 5) log('fx poll error: ' + String(res).slice(0, 180));
          }
          var next = null;
          if (res && res !== 'null' && res !== 'undefined' && res.indexOf('EvalScript error') !== 0) {
            try { next = JSON.parse(res); } catch (e) { next = null; }
          }
          if (state.fxPollCount <= 3 || state.fxPollCount % 30 === 0) {
            log('fx#' + state.fxPollCount + summarizeFx(next));
          }
          handleFxState(next);
        } catch (e) {
          state.fxLoopError = (state.fxLoopError || 0) + 1;
          if (state.fxLoopError <= 3) log('fx loop error: ' + (e && e.message ? e.message : String(e)));
        }
        scheduleFxPoll(idleIntervalMs(FX_POLL_MS, NATIVE_FX_POLL_MS));
      });
    } catch (e) {
      scheduleFxPoll(idleIntervalMs(FX_POLL_MS, NATIVE_FX_POLL_MS));
    }
  }

  function summarizeFx(snapshot) {
    if (!snapshot || !snapshot.layers) return ' no snapshot';
    var fxCount = 0;
    var paramCount = 0;
    var sample = '';
    for (var li = 0; li < snapshot.layers.length; li++) {
      var fxs = snapshot.layers[li].effects || [];
      fxCount += fxs.length;
      for (var fi = 0; fi < fxs.length; fi++) {
        var props = fxs[fi].props || {};
        for (var pk in props) {
          paramCount++;
          if (!sample) sample = fxs[fi].id + '/' + pk + '=' + JSON.stringify(props[pk]).slice(0, 40);
        }
      }
    }
    return ' effects=' + fxCount + ' params=' + paramCount + (sample ? ' sample=' + sample : '');
  }

  function carryForwardEffectParams(prior, next) {
    if (!prior || !prior.layers || !next || !next.layers) return;
    var priorBySid = {};
    var i;
    var j;
    var k;
    for (i = 0; i < prior.layers.length; i++) priorBySid[prior.layers[i].sid] = prior.layers[i];
    for (i = 0; i < next.layers.length; i++) {
      var nl = next.layers[i];
      var pl = priorBySid[nl.sid];
      if (!pl) continue;
      var priorFx = {};
      for (j = 0; j < (pl.effects || []).length; j++) priorFx[pl.effects[j].id] = pl.effects[j];
      for (k = 0; k < (nl.effects || []).length; k++) {
        var ne = nl.effects[k];
        if (!ne.paramsSkipped) continue;
        var pe = priorFx[ne.id];
        if (pe && pe.props) ne.props = pe.props;
      }
    }
  }

  function fetchEffectParamsAndSend(ops, index) {
    var op = ops[index];
    var compId = state.compId;
    var layerSid = op.target.layer;
    var fxId = String(op.path || '').substring(3);
    cs.evalScript(
      'collab.getLayerEffectParams(' + JSON.stringify(compId) + ',' + JSON.stringify(layerSid) + ',' + JSON.stringify(fxId) + ')',
      function (res) {
        var payload = null;
        if (res && res !== 'null' && res.indexOf('EvalScript error') !== 0) {
          try { payload = JSON.parse(res); } catch (e) { payload = null; }
        }
        if (payload && payload.props) op.value.props = payload.props;
        for (var i = 0; i < ops.length; i++) send({ t: 'op', op: ops[i] });
        txLog(ops);
      }
    );
  }

  function sendEffectOps(ops) {
    for (var i = 0; i < ops.length; i++) {
      if (ops[i].kind !== 'addEffect') continue;
      var props = ops[i].value ? ops[i].value.props : null;
      if (props && Object.keys(props).length > 0) continue;
      fetchEffectParamsAndSend(ops, i);
      return;
    }
    for (var j = 0; j < ops.length; j++) send({ t: 'op', op: ops[j] });
    txLog(ops);
  }

  function handleFxState(next) {
    if (!next || !state.connected || !CollabDiff || !CollabDiff.diffEffects) {
      return;
    }
    if (next.comp.id !== state.compId) {
      rememberFxState(next.comp.id, next);
      return;
    }
    var prior = state.fxStates[next.comp.id];
    carryForwardEffectParams(prior, next);
    rememberFxState(next.comp.id, next);
    if (!prior) return;
    var ops = CollabDiff.diffEffects(prior, next, echo);
    if (next.truncated && !state.effectsTruncatedWarned) {
      state.effectsTruncatedWarned = true;
      log('note: effects exceed sync budget - not all effects are synced');
    }
    if (ops.length === 0) return;
    state.lastChangeAt = Date.now();
    sendEffectOps(ops);
  }

  function rememberCompState(compKeyStr, snapshot) {
    if (!compKeyStr) return;
    state.compStates[compKeyStr] = snapshot;
    var keys = [];
    for (var k in state.compStates) keys.push(k);
    while (keys.length > MAX_COMP_STATES) delete state.compStates[keys.shift()];
  }

  function rememberFxState(compKeyStr, snapshot) {
    if (!compKeyStr) return;
    state.fxStates[compKeyStr] = snapshot;
    var keys = [];
    for (var k in state.fxStates) keys.push(k);
    while (keys.length > MAX_COMP_STATES) delete state.fxStates[keys.shift()];
  }

  function isStructureKind(kind) {
    return kind === 'add' || kind === 'remove' || kind === 'reorder' || kind === 'addMask' || kind === 'removeMask';
  }

  function guardStructureOps(ops) {
    var now = Date.now();
    // Hold structure ops while a teammate in this comp has a different project
    // structure - applying them would target divergent layers.
    if (hasDivergence()) {
      var keptDiv = [];
      for (var d = 0; d < ops.length; d++) {
        if (!isStructureKind(ops[d].kind)) keptDiv.push(ops[d]);
      }
      if (keptDiv.length !== ops.length && !state.divergenceLogged) {
        state.divergenceLogged = true;
        log('structure sync held: your project structure differs from a teammate - open the same project file');
      }
      return keptDiv;
    }
    if (state.structurePausedUntil > now) {
      var keptWhilePaused = [];
      for (var i = 0; i < ops.length; i++) {
        if (!isStructureKind(ops[i].kind)) keptWhilePaused.push(ops[i]);
      }
      if (keptWhilePaused.length !== ops.length && !state.structurePauseLogged) {
        state.structurePauseLogged = true;
        log('structure sync paused - check that everyone has the same project file');
      }
      return keptWhilePaused;
    }
    state.structurePausedUntil = 0;
    state.structurePauseLogged = false;
    var times = state.structureTimes;
    while (times.length > 0 && now - times[0] > STRUCTURE_WINDOW_MS) times.shift();
    var structureCount = 0;
    var j;
    for (j = 0; j < ops.length; j++) {
      if (isStructureKind(ops[j].kind)) structureCount++;
    }
    if (times.length + structureCount > STRUCTURE_LIMIT) {
      state.structurePausedUntil = now + STRUCTURE_COOLDOWN_MS;
      state.structurePauseLogged = true;
      log('structure sync paused: too many add/remove ops in a burst (diverged projects?) - resuming in ' + STRUCTURE_COOLDOWN_MS / 1000 + 's');
      var kept = [];
      for (j = 0; j < ops.length; j++) {
        if (!isStructureKind(ops[j].kind)) kept.push(ops[j]);
      }
      return kept;
    }
    for (j = 0; j < structureCount; j++) times.push(now);
    return ops;
  }

  function rememberTextState(compKeyStr, snapshot) {
    if (!compKeyStr) return;
    state.textStates[compKeyStr] = snapshot;
    var keys = [];
    for (var k in state.textStates) keys.push(k);
    while (keys.length > MAX_COMP_STATES) delete state.textStates[keys.shift()];
  }

  function scheduleTextPoll(delay) {
    if (!inAE || !cs || !textSyncEnabled()) return;
    var gen = state.pollGeneration;
    setTimeout(function () { if (state.pollGeneration === gen) pollText(); }, delay);
  }

  function pollText() {
    if (!inAE || !cs || !textSyncEnabled()) return;
    if (state.stamping || !aeIsFocused()) {
      scheduleTextPoll(idleIntervalMs(TEXT_POLL_MS, NATIVE_TEXT_POLL_MS));
      return;
    }
    try {
      cs.evalScript('(typeof collab === "undefined") ? "undefined" : collab.getTextState()', function (res) {
        try {
          var next = null;
          if (res && res !== 'null' && res !== 'undefined' && res.indexOf('EvalScript error') !== 0) {
            try { next = JSON.parse(res); } catch (e) { next = null; }
          }
          handleTextState(next);
        } catch (e2) {
          state.textLoopError = (state.textLoopError || 0) + 1;
          if (state.textLoopError <= 3) log('text loop error: ' + (e2 && e2.message ? e2.message : String(e2)));
        }
        scheduleTextPoll(idleIntervalMs(TEXT_POLL_MS, NATIVE_TEXT_POLL_MS));
      });
    } catch (e) {
      scheduleTextPoll(idleIntervalMs(TEXT_POLL_MS, NATIVE_TEXT_POLL_MS));
    }
  }

  function handleTextState(next) {
    if (!next || !state.connected || !CollabDiff || !CollabDiff.diffTextState) {
      return;
    }
    if (next.comp.id !== state.compId) {
      rememberTextState(next.comp.id, next);
      return;
    }
    var prior = state.textStates[next.comp.id];
    rememberTextState(next.comp.id, next);
    if (!prior) return;
    var ops = CollabDiff.diffTextState(prior, next, echo);
    if (ops.length === 0) return;
    state.lastChangeAt = Date.now();
    for (var i = 0; i < ops.length; i++) send({ t: 'op', op: ops[i] });
    txLog(ops);
  }

  function rememberShapeState(compKeyStr, snapshot) {
    if (!compKeyStr) return;
    state.shapeStates[compKeyStr] = snapshot;
    var keys = [];
    for (var k in state.shapeStates) keys.push(k);
    while (keys.length > MAX_COMP_STATES) delete state.shapeStates[keys.shift()];
  }

  function scheduleShapePoll(delay) {
    if (!inAE || !cs) return;
    var gen = state.pollGeneration;
    setTimeout(function () { if (state.pollGeneration === gen) pollShapes(); }, delay);
  }

  function pollShapes() {
    if (!inAE || !cs) return;
    if (state.stamping || !aeIsFocused()) {
      scheduleShapePoll(idleIntervalMs(SHAPE_POLL_MS, NATIVE_SHAPE_POLL_MS));
      return;
    }
    try {
      cs.evalScript('(typeof collab === "undefined") ? "undefined" : collab.getShapeStates()', function (res) {
        try {
          var next = null;
          if (res && res !== 'null' && res !== 'undefined' && res.indexOf('EvalScript error') !== 0) {
            try { next = JSON.parse(res); } catch (e) { next = null; }
          }
          handleShapeState(next);
        } catch (e2) {
          state.shapeLoopError = (state.shapeLoopError || 0) + 1;
          if (state.shapeLoopError <= 3) log('shape loop error: ' + (e2 && e2.message ? e2.message : String(e2)));
        }
        scheduleShapePoll(idleIntervalMs(SHAPE_POLL_MS, NATIVE_SHAPE_POLL_MS));
      });
    } catch (e) {
      scheduleShapePoll(idleIntervalMs(SHAPE_POLL_MS, NATIVE_SHAPE_POLL_MS));
    }
  }

  function handleShapeState(next) {
    if (!next || !state.connected || !CollabDiff || !CollabDiff.diffShapeStates) {
      return;
    }
    if (next.comp.id !== state.compId) {
      rememberShapeState(next.comp.id, next);
      return;
    }
    var prior = state.shapeStates[next.comp.id];
    rememberShapeState(next.comp.id, next);
    if (!prior) return;
    var ops = CollabDiff.diffShapeStates(prior, next, echo);
    if (ops.length === 0) return;
    state.lastChangeAt = Date.now();
    for (var i = 0; i < ops.length; i++) send({ t: 'op', op: ops[i] });
    txLog(ops);
  }

  // Structural fingerprint of the active comp: comp id + ordered layer SIDs.
  // Two clients on the SAME file produce the same value; different files don't.
  function computeCompHash(comp, layers) {
    if (!comp || !layers) return '';
    var s = comp.id + ':' + layers.length;
    for (var i = 0; i < layers.length; i++) s += ',' + layers[i].sid;
    var h = 0;
    for (var j = 0; j < s.length; j++) h = ((h << 5) - h + s.charCodeAt(j)) | 0;
    return (h >>> 0).toString(16);
  }

  function hasDivergence() {
    for (var k in state.divergedWith) {
      if (state.divergedWith[k]) return true;
    }
    return false;
  }

  function checkCompDivergence(member) {
    if (!member || !member.compId || !member.compHash) return;
    if (!state.compId || member.compId !== state.compId) return;
    if (!state.compHash) return;
    if (member.compHash === state.compHash) {
      if (state.divergedWith[member.id]) {
        delete state.divergedWith[member.id];
        if (!hasDivergence()) state.divergenceLogged = false;
        log(member.name + ' now matches the project structure');
      }
      return;
    }
    if (state.divergedWith[member.id]) return;
    state.divergedWith[member.id] = true;
    log('WARNING: ' + member.name + ' has a DIFFERENT project structure in ' + compLabel(member.compId) + ' - not the same file. Structure sync held for this comp; both re-open the host\'s .aep.');
  }

  // Drop every per-comp baseline. Must be called whenever the open project
  // changes (e.g. after opening the shared base), or the next poll would diff
  // the new project against stale state and emit bogus ops.
  function resetBaselines() {
    state.compId = null;
    state.compName = null;
    state.selection = [];
    state.lastComp = null;
    state.compStates = {};
    state.fxStates = {};
    state.textStates = {};
    state.shapeStates = {};
    state.compHash = '';
    state.divergedWith = {};
    state.divergenceLogged = false;
    state.baseOpened = false;
    state.keysOmittedWarned = false;
    state.lastChangeAt = Date.now();
  }

  function computeProjectHash(comp) {
    if (!comp) return '';
    var h = 0;
    var s = comp.id + '|' + comp.width + 'x' + comp.height + '|' + comp.frameRate + '|' + comp.numLayers;
    for (var i = 0; i < s.length; i++) {
      h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    }
    return (h >>> 0).toString(16);
  }

  function handleCompState(next) {
    var newCompId = next ? next.comp.id : null;
    var switched = newCompId !== state.compId;
    var nextHash = next ? computeCompHash(next.comp, next.layers) : '';
    if (switched) {
      state.compId = newCompId;
      state.compName = next ? next.comp.name : null;
      $('compText').textContent = state.compName ? 'comp: ' + state.compName : '';
      state.selection = next ? next.selection : [];
      state.keysOmittedWarned = false;
      if (next) {
        var newHash = computeProjectHash(next.comp);
        if (state.projectHash && state.projectHash !== newHash) {
          log('note: project hash changed (' + state.projectHash + ' -> ' + newHash + ') - save and share the latest file');
        }
        state.projectHash = newHash;
      }
      state.compHash = nextHash;
      state.divergedWith = {};
      state.divergenceLogged = false;
      log('active comp: ' + (state.compName || 'none'));
      if (state.connected) send({ t: 'selection', compId: state.compId, layers: state.selection, hash: state.compHash });
      for (var mi = 0; mi < state.order.length; mi++) checkCompDivergence(state.members[state.order[mi]]);
      if (!next) {
        state.lastComp = null;
        state.compId = null;
        state.compName = null;
        state.selection = [];
        return;
      }
      var priorVisit = state.compStates[newCompId];
      if (!priorVisit) {
        state.lastComp = next;
        rememberCompState(newCompId, next);
        return;
      }
      state.lastComp = priorVisit;
    } else {
      if (!next || !state.lastComp) {
        state.lastComp = next;
        return;
      }
      var selChanged = next.selection.join(',') !== state.selection.join(',');
      var hashChanged = nextHash !== state.compHash;
      if (selChanged) state.selection = next.selection;
      state.compHash = nextHash;
      if ((selChanged || hashChanged) && state.connected) {
        send({ t: 'selection', compId: state.compId, layers: state.selection, hash: state.compHash });
      }
      if (!CollabDiff || !echo) {
        state.lastComp = next;
        rememberCompState(newCompId, next);
        return;
      }
    }

    var priorState = state.lastComp;
    var additions = CollabDiff.findAdditions(priorState, next, echo);
    var ops = CollabDiff.diffComp(priorState, next, echo);
    state.lastComp = next;
    rememberCompState(newCompId, next);
    if (next.hasOmittedKeys && !state.keysOmittedWarned) {
      state.keysOmittedWarned = true;
      log('note: some keyframed properties exceed sync budget and are skipped');
    }
    if (ops.length > 0) {
      state.lastChangeAt = Date.now();
      ops = guardStructureOps(ops);
      ops = debounceTextOps(ops);
    }
    if (ops.length > 0) {
      if (ops.length > MAX_OPS_PER_POLL) {
        log('warning: dropping ' + (ops.length - MAX_OPS_PER_POLL) + ' op(s) this tick');
        ops = ops.slice(0, MAX_OPS_PER_POLL);
      }
      for (var i = 0; i < ops.length; i++) send({ t: 'op', op: ops[i] });
      txLog(ops);
    }
    if (additions.length > 0) syncAdditions(additions);
  }

  function randomHex(len) {
    var chars = '0123456789abcdef';
    var out = '';
    for (var i = 0; i < len; i++) out += chars.charAt(Math.floor(Math.random() * 16));
    return out;
  }

  function patchLastCompSid(oldSid, newSid) {
    var comp = state.lastComp;
    if (!comp) return;
    var i;
    for (i = 0; i < comp.layers.length; i++) {
      if (comp.layers[i].sid === oldSid) comp.layers[i].sid = newSid;
    }
    for (i = 0; i < comp.selection.length; i++) {
      if (comp.selection[i] === oldSid) comp.selection[i] = newSid;
    }
    for (i = 0; i < state.selection.length; i++) {
      if (state.selection[i] === oldSid) state.selection[i] = newSid;
    }
  }

  function baseDescriptor(layer) {
    var d = {
      name: layer.name,
      index: layer.index,
      inPoint: layer.inPoint,
      outPoint: layer.outPoint,
      startTime: layer.startTime,
      enabled: layer.enabled,
      transform: {}
    };
    for (var i = 0; i < CollabDiff.SYNCED_PROPS.length; i++) {
      var name = CollabDiff.SYNCED_PROPS[i];
      var src = layer.transform ? layer.transform[name] : null;
      if (!src) continue;
      var entry = {};
      if (src.value !== undefined) entry.value = src.value;
      if (src.keys) entry.keys = src.keys;
      if (src.expr) {
        entry.expr = src.expr;
        entry.exprOn = src.exprOn;
      }
      d.transform[name] = entry;
    }
    return d;
  }

  function describeLayer(layer) {
    if (layer.type === 'shape') return null;
    var d = baseDescriptor(layer);
    if (layer.type === 'text') {
      d.type = 'text';
      d.sourceText = (layer.textDoc && layer.textDoc.text) || '';
      return d;
    }
    if (layer.avKind === 'adjustment') {
      d.type = 'adjustment';
      return d;
    }
    if (layer.avKind === 'null') {
      d.type = 'null';
      return d;
    }
    if (layer.avKind === 'solid' && layer.solid) {
      d.type = 'solid';
      d.solid = layer.solid;
      return d;
    }
    if (layer.avKind === 'footage' && layer.source) {
      d.type = 'footage';
      d.source = layer.source;
      return d;
    }
    if (layer.avKind === 'comp' && layer.sourceComp) {
      d.type = 'comp';
      d.sourceComp = layer.sourceComp;
      return d;
    }
    return null;
  }

  function emitAdd(sid, descriptor, layer, rest) {
    var op = {
      opId: Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4),
      kind: 'add',
      target: { comp: state.compId, layer: sid },
      value: descriptor,
      index: layer.index
    };
    send({ t: 'op', op: op });
    state.structureTimes.push(Date.now());
    log('tx add ' + descriptor.type + ' "' + descriptor.name + '"');
    syncAdditions(rest);
  }

  function syncAdditions(additions) {
    if (additions.length === 0 || state.stamping) return;
    if (!cs || !inAE || !state.compId) return;
    var layer = additions[0];
    var rest = additions.slice(1);
    var descriptor = describeLayer(layer);
    if (!descriptor && layer.type === 'shape') {
      fetchShapeDescriptor(layer, rest);
      return;
    }
    if (!descriptor) {
      if (!state.unsupportedAddWarned) {
        state.unsupportedAddWarned = true;
        log('note: added layer type not synced yet (' + (layer.type || '?') + '/' + (layer.avKind || '?') + ')');
      }
      syncAdditions(rest);
      return;
    }
    proceedAdd(descriptor, layer, rest);
  }

  function fetchShapeDescriptor(layer, rest) {
    if (!cs || !inAE || !state.compId) return;
    var compId = state.compId;
    cs.evalScript(
      'collab.getLayerShape(' + JSON.stringify(compId) + ',' + JSON.stringify(layer.sid) + ')',
      function (res) {
        var payload = null;
        if (res && res !== 'null' && res.indexOf('EvalScript error') !== 0) {
          try { payload = JSON.parse(res); } catch (e) { payload = null; }
        }
        if (!payload || !payload.tree) {
          if (!state.shapeWarned) {
            state.shapeWarned = true;
            log('note: could not read shape contents - shape layer not synced');
          }
          syncAdditions(rest);
          return;
        }
        var descriptor = baseDescriptor(layer);
        descriptor.type = 'shape';
        descriptor.shape = payload.tree;
        proceedAdd(descriptor, layer, rest);
      }
    );
  }

  function proceedAdd(descriptor, layer, rest) {
    var nowAdd = Date.now();
    while (state.structureTimes.length > 0 && nowAdd - state.structureTimes[0] > STRUCTURE_WINDOW_MS) {
      state.structureTimes.shift();
    }
    if (state.structureTimes.length >= STRUCTURE_LIMIT) {
      state.structurePausedUntil = nowAdd + STRUCTURE_COOLDOWN_MS;
      if (!state.structurePauseLogged) {
        state.structurePauseLogged = true;
        log('structure sync paused after a burst - not syncing new layers for ' + STRUCTURE_COOLDOWN_MS / 1000 + 's');
      }
      return;
    }
    var oldSid = layer.sid;
    if (oldSid && oldSid.indexOf('st') === 0) {
      emitAdd(oldSid, descriptor, layer, rest);
      return;
    }
    var hex = randomHex(12);
    var newSid = 'st' + hex;
    var compId = state.compId;
    state.stamping = true;
    state.stampStartedAt = Date.now();
    patchLastCompSid(oldSid, newSid);
    cs.evalScript(
      'collab.stampLayer(' + JSON.stringify(compId) + ',' + JSON.stringify(oldSid) + ',' + JSON.stringify(hex) + ')',
      function (res) {
        state.stamping = false;
        if (!res || res.indexOf('"ok":true') < 0) {
          log('add: stamp failed (' + String(res).slice(0, 80) + ')');
          patchLastCompSid(newSid, oldSid);
          return;
        }
        emitAdd(newSid, descriptor, layer, rest);
      }
    );
  }

  function initStyles() {
    var canvas = $('canvas');
    canvas.addEventListener('mousemove', function (ev) {
      if (inAE) return;
      var rect = canvas.getBoundingClientRect();
      var x = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
      var y = Math.min(1, Math.max(0, (ev.clientY - rect.top) / rect.height));
      state.myCursor = { x: x, y: y, known: true };
      state.pendingCursor = { x: x, y: y };
      renderCanvas();
    });
  }

  setInterval(function () {
    if (!state.connected) return;
    var c = state.pendingCursor;
    if (!c) return;
    state.pendingCursor = null;
    var msg = { t: 'cursor', x: c.x, y: c.y };
    if (state.compId) msg.compId = state.compId;
    send(msg);
  }, CURSOR_FLUSH_MS);

  setInterval(function () {
    if (!state.connected) return;
    state.lastPingAt = Date.now();
    send({ t: 'ping', ts: state.lastPingAt });
  }, PING_INTERVAL_MS);

  setInterval(function () {
    if (!state.connected) return;
    log('stats: ping=' + state.latencyMs + 'ms tx=' + state.opsSent + ' rx=' + state.opsReceived + ' queued=' + state.remoteQueue.length + ' native=' + (state.nativeMode ? 'on' : 'off') + ' hash=' + (state.projectHash || '-'));
  }, 30000);

  setInterval(renderHealth, 1000);

  $('connectBtn').addEventListener('click', function () {
    if (state.connected) {
      wantConnected = false;
      state.outbox = [];
      persistOutbox();
      disconnect();
      $('connectBtn').textContent = 'join';
    } else {
      connect();
      $('connectBtn').textContent = 'leave';
    }
  });

  $('genBtn').addEventListener('click', function () {
    $('roomInput').value = randomCode();
    saveSettings();
  });

  $('copyBtn').addEventListener('click', function () {
    var text = 'Vynk room ' + ($('roomInput').value.trim().toUpperCase() || '?') + ' on ' + $('serverInput').value.trim();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text);
    } else {
      var ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
    }
    log('invite copied: ' + text);
  });

  if ($('shareBaseBtn')) $('shareBaseBtn').addEventListener('click', function () { shareBase(); });
  if ($('getBaseBtn')) $('getBaseBtn').addEventListener('click', function () { getBase(); });

  window.addEventListener('resize', renderCanvas);

  loadSettings();
  initStyles();
  renderMembers();
  renderBase();
  renderCanvas();
  initAegpBridge();
  initAeBridge();
  setStatus('', 'offline');
  log(state.helper.node ? 'panel ready (CEP node available)' : 'panel ready (browser test mode)');
  if ($('roomInput').value.trim() && $('nameInput').value.trim()) {
    log('auto-joining saved room ' + $('roomInput').value.trim().toUpperCase());
    connect();
    $('connectBtn').textContent = 'leave';
  }
})();
