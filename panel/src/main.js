(function () {
  'use strict';

  var PROTO = 2;
  var PANEL_BUILD = (window.VYNK_VERSION ? 'v' + window.VYNK_VERSION : 'dev');
  var CURSOR_FLUSH_MS = 33;
  var POLL_FAST_MS = 200;
  var POLL_BURST_MS = 2500;
  var CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var RECONNECT_DELAY_MS = 3000;
  var PING_INTERVAL_MS = 5000;
  var MAX_LOG_LINES = 200;
  var MAX_LOG_BUFFER = 80;
  var MAX_OUTBOX = 500;
  var AEGP_PORT = 8990;
  var AEGP_RECONNECT_MS = 3000;
  var NATIVE_IDLE_POLL_MS = 500;

  function $(id) { return document.getElementById(id); }

  // A panel reload re-runs this script in the same window while the previous
  // copy's timers keep firing. Every timer checks that it still belongs to the
  // newest copy, so an old one goes quiet instead of syncing a second time.
  var LOAD_ID = String(Date.now()) + Math.random();
  window.__vynkLoad = LOAD_ID;

  function stale() {
    return window.__vynkLoad !== LOAD_ID;
  }

  function later(fn, ms) {
    return setTimeout(function () { if (!stale()) fn(); }, ms);
  }

  function every(fn, ms) {
    var id = setInterval(function () {
      if (stale()) {
        clearInterval(id);
        retire();
        return;
      }
      fn();
    }, ms);
    return id;
  }

  function retire() {
    if (state.retired) return;
    state.retired = true;
    wantConnected = false;
    try { if (state.ws) state.ws.close(); } catch (e) {}
    try { if (state.aegp.sock) state.aegp.sock.destroy(); } catch (e2) {}
  }


  var Sync = window.VynkSync || null;
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
    pollScheduledDelay: 0,
    lastChangeAt: 0,
    lastTxLogAt: 0,
    lastRxLogAt: 0,
    missingPolls: 0,
    pollCount: 0,
    lastPollResult: '',
    focusKnown: false,
    aeFocused: true,
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
    catchupLogged: false,
    shadows: {},
    needs: [],
    editedAt: 0,
    roundStartedAt: 0,
    parked: {},
    peerSums: {},
    verifiedAt: {},
    mismatchAt: {},
    needSent: {},
    needSentAt: {},
    lastSumAt: 0,
    lastSumSig: '',
    resend: {},
    trailOn: false,
    trailAt: 0,
    selfJoinedAt: 1,
    agreed: {},
    wantItems: false,
    awaiting: {},
    repairAsked: {},
    repairSent: {},
    myHash: '',
    hashComp: null,
    lastNeedPair: '',
    lastNeedAt: 0,
    lastSyncAt: 0,
    inbox: [],
    pending: {},
    force: {},
    stampJob: null,
    shadowItems: null,
    deepQueue: {},
    fullNext: {},
    sweepLayer: 0,
    sweepComp: null,
    rev: -1,
    sweeping: true,
    chase: false,
    escalateAt: 0,
    escalateGapMs: 3000,
    readQueue: [],
    compSids: [],
    sweepIdx: 0,
    lastActiveSid: null,
    cycleBusy: false,
    cycleStartedAt: 0,
    cycleTimer: null,
    cycleDueAt: 0,
    cycleMs: 0,
    compSid: null,
    lwwSkips: 0
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
    if (state.harness) return;
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
      if (msg.t === 'op') state.opsSent += (msg.op.kind === 'batch' ? msg.op.value.ops.length : 1);
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
      var timer = later(sendHello, 600);
      fetchHostInfo(function () { clearTimeout(timer); sendHello(); });
    };
    ws.onmessage = function (ev) {
      if (stale()) return;
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      onMessage(msg);
    };
    ws.onclose = function () {
      if (stale()) return;
      if (state.connected) log('disconnected');
      state.connected = false;
      state.selfId = null;
      state.members = {};
      state.order = [];
      state.pending = {};
      state.awaiting = {};
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
        later(function () { if (wantConnected) connect(); }, backoff);
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
        if (!state.everConnected) {
          // Sync starts from what the project holds at the moment of joining.
          state.shadows = {};
          state.shadowItems = null;
          state.agreed = {};
          state.wantItems = true;
        }
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
        // The welcome lists everyone who was here first; we joined just after.
        state.selfJoinedAt = 1;
        for (var i = 0; i < msg.members.length; i++) {
          var m = msg.members[i];
          if (m.joinedAt >= state.selfJoinedAt) state.selfJoinedAt = m.joinedAt + 1;
          state.members[m.id] = m;
          state.order.push(m.id);
          checkMemberBuild(m);
          checkMemberVersion(m);
          checkMemberProject(m);
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
        if (state.compId) send({ t: 'selection', compId: state.compId, layers: state.selection });
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
        } else {
          delete state.members[member.id];
          delete state.peerSums[member.id];
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
        }
        renderMembers();
        return;
      }
      case 'op': {
        onRemoteOp(msg);
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

  function localProjectOnBase() {
    if (!state.baseInfo || !state.baseInfo.name) return false;
    if (state.baseOpened) return true;
    return state.projectName === state.baseInfo.name;
  }

  function tryApplyReplay() {
    if (!state.pendingReplay) return;
    if (state.pendingReplay.length === 0 && !state.replayTruncated) return;
    if (state.replayApplied) return;
    if (!inAE || !cs) return;
    if (state.replayTruncated) {
      state.catchupState = 'held-truncated';
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
      if (!Sync) continue;
      applied += acceptRemote(op);
    }
    kickCycle(0);
    state.lastChangeAt = Date.now();
    log('catch-up: ' + applied + ' edit(s) applied');
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
      'q ' + state.inbox.length,
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
      cycleMs: state.cycleMs,
      superseded: state.lwwSkips,
      queued: state.inbox.length,
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
    req.later(120000, function () { req.destroy(new Error('upload timed out')); });
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
    req.later(60000, function () { req.destroy(new Error('history request timed out')); });
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
    req.later(120000, function () { req.destroy(new Error('download timed out')); });
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

  function onAegpLine(line) {
    // The native companion tells us the project was touched (CHANGED) or the
    // active comp / selection changed (COMP/SEL). Any of those is the cue to do
    // one evalScript snapshot instead of polling constantly. We don't take the
    // native values directly (layer-id format differs pre-AE22), we just use the
    // signal to poll now and let the existing diff produce the ops.
    if (stale()) return;
    if (line.indexOf('CHANGED') === 0 || line.indexOf('SEL\t') === 0 || line.indexOf('COMP\t') === 0) {
      state.lastChangeAt = Date.now();
      kickCycle(40);
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
      state.focusKnown = true;
      state.aeFocused = nowFocused;
      if (!nowFocused && state.myCursor.known) {
        send({ t: 'cursor', x: state.myCursor.x, y: state.myCursor.y, active: false });
      } else if (nowFocused && state.myCursor.known) {
        state.pendingCursor = { x: state.myCursor.x, y: state.myCursor.y };
      }
      return;
    }
  }

  // The AEGP binds an ephemeral port and writes it here; re-read on every
  // attempt so we pick up a fresh port if AE restarted.
  // Same key the native companion derives from its own AfterFX.exe: an FNV-1a
  // hash of the lower-cased "...\Support Files" folder of this AE install.
  function installKey() {
    try {
      var parts = String(process.execPath || '').split(/[\\\/]/);
      if (parts.length < 3) return '';
      var dir = parts.slice(0, parts.length - 2).join('\\').toLowerCase();
      var h = 2166136261;
      for (var i = 0; i < dir.length; i++) {
        h ^= dir.charCodeAt(i) & 255;
        h = Math.imul(h, 16777619) >>> 0;
      }
      var hex = h.toString(16);
      while (hex.length < 8) hex = '0' + hex;
      return hex;
    } catch (e) {
      return '';
    }
  }

  function aegpBridgePort() {
    try {
      var fs = require('fs');
      var dir = (process.env.LOCALAPPDATA || '') + '\\Vynk\\';
      var files = ['bridge.port'];
      var key = installKey();
      if (key) files.unshift('bridge-' + key + '.port');
      for (var i = 0; i < files.length; i++) {
        try {
          var n = parseInt(fs.readFileSync(dir + files[i], 'utf8').trim(), 10);
          if (n > 0 && n < 65536) return n;
        } catch (e1) {}
      }
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
        later(connect, AEGP_RECONNECT_MS);
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
        if (stale()) return;
        if (state.nativeMode) log('native AEGP bridge lost - full polling resumes');
        state.aegp.connected = false;
        state.nativeMode = false;
        state.aegp.sock = null;
        setHelperText();
        later(connect, AEGP_RECONNECT_MS);
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
    log('panel ' + PANEL_BUILD + ' starting (AE ' + hostVersion + ')');
    if (!Sync) log('sync module missing - edits will not sync');
    try {
      var extPath = cs.getSystemPath(window.SystemPath.EXTENSION);
      if (extPath) {
        var jsxPath = String(extPath).replace(/\\/g, '/') + '/jsx/hostscript.jsx';
        log('loading hostscript: ' + jsxPath);
        cs.evalScript(
          '(function(){try{$.evalFile(' + JSON.stringify(jsxPath) + ');return "ok, collab=" + (typeof collab) + ", polyfill=" + ((typeof collab === "object") ? collab.jsonPolyfilled : "n/a");}catch(e){return "ERROR " + e.toString();}})()',
          function (res) { log('hostscript load: ' + res); }
        );
        var syncPath = String(extPath).replace(/\\/g, '/') + '/jsx/sync.jsx';
        cs.evalScript(
          '(function(){try{return String($.evalFile(' + JSON.stringify(syncPath) + '));}catch(e){return "ERROR " + e.toString() + " @" + e.line;}})()',
          function (res) { log('sync engine load: ' + res); kickCycle(0); }
        );
      } else {
        log('extension path unavailable - relying on manifest ScriptPath');
      }
    } catch (e) {
      log('hostscript load error: ' + e.message);
    }
    later(function () {
      cs.evalScript('typeof collab', function (res) {
        log('hostscript status: ' + res);
      });
    }, 2500);
    every(function () {
      if (state.compId) return;
      log('diag: no comp (polls=' + state.pollCount + ', missing=' + state.missingPolls + ', last=' + (state.lastPollResult || 'none') + ')');
    }, 30000);
    fetchHostInfo(function (ok) {
      if (ok) log('project: ' + (state.projectName || '(unsaved)'));
    });
    every(function () { fetchHostInfo(null); }, 10000);
    kickCycle(POLL_FAST_MS);
  }

  // Drop every per-comp baseline. Must be called whenever the open project
  // changes (e.g. after opening the shared base), or the next poll would diff
  // the new project against stale state and emit bogus ops.
  function resetBaselines() {
    state.compId = null;
    state.compName = null;
    state.compSid = null;
    state.shadows = {};
    state.shadowItems = null;
    state.parked = {};
    state.mismatchAt = {};
    state.needSent = {};
    state.lastSumSig = '';
    state.resend = { '*': 1 };
    state.agreed = {};
    state.deepQueue = {};
    state.fullNext = {};
    state.sweepLayer = 0;
    state.sweepIdx = 0;
    state.sweeping = true;
    state.chase = false;
    state.readQueue = [];
    state.compSids = [];
    state.lastActiveSid = null;
    state.inbox = [];
    state.force = {};
    state.stampJob = null;
    state.selection = [];
    state.baseOpened = false;
    state.lastChangeAt = Date.now();
  }

  function randomHex(len) {
    var chars = '0123456789abcdef';
    var out = '';
    for (var i = 0; i < len; i++) out += chars.charAt(Math.floor(Math.random() * 16));
    return out;
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

  every(function () {
    if (!state.connected) return;
    var c = state.pendingCursor;
    if (!c) return;
    state.pendingCursor = null;
    var msg = { t: 'cursor', x: c.x, y: c.y };
    if (state.compId) msg.compId = state.compId;
    send(msg);
  }, CURSOR_FLUSH_MS);

  every(function () {
    if (!state.connected) return;
    state.lastPingAt = Date.now();
    send({ t: 'ping', ts: state.lastPingAt });
  }, PING_INTERVAL_MS);

  every(function () {
    if (!state.connected) return;
    log('stats: ping=' + state.latencyMs + 'ms tx=' + state.opsSent + ' rx=' + state.opsReceived + ' queued=' + state.inbox.length + ' native=' + (state.nativeMode ? 'on' : 'off') + ' hash=' + (state.projectHash || '-'));
  }, 30000);

  every(renderHealth, 1000);
  every(repairTick, REPAIR_TICK_MS);

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

  // ------------------------------------------------------------ sync engine v2
  // One loop: hand AE the remote ops that arrived, get back snapshots taken
  // right after they were applied, adopt what the ops touched as shared state,
  // and send whatever else differs from the shadow as the local user's edits.
  var CYCLE_ACTIVE_MS = 150;
  var CYCLE_IDLE_MS = 400;
  var CYCLE_WATCHDOG_MS = 120000;
  var MAX_OPS_PER_CYCLE = 400;
  var MAX_BATCH_OPS = 150;
  var MAX_BATCH_CHARS = 400000;
  var SWEEP_LAYERS = 6;
  var ESCALATE_MIN_MS = 3000;
  var ESCALATE_MAX_MS = 60000;

  function kickCycle(delay) {
    if (!inAE || !cs || !Sync) return;
    var due = Date.now() + delay;
    if (state.cycleTimer) {
      if (state.cycleDueAt <= due) return;
      clearTimeout(state.cycleTimer);
    }
    state.cycleDueAt = due;
    var gen = state.pollGeneration;
    state.cycleTimer = later(function () {
      state.cycleTimer = null;
      if (state.pollGeneration === gen) runCycle();
    }, Math.max(0, delay));
  }

  function innerOps(op) {
    if (op && op.kind === 'batch') return (op.value && op.value.ops) || [];
    return [op];
  }

  // Remote ops are queued as groups: one teammate gesture is applied in one
  // After Effects call, so its side effects never surface half-way.
  function acceptRemote(op, author) {
    var list = innerOps(op);
    var group = [];
    for (var i = 0; i < list.length; i++) {
      var inner = list[i];
      if (!inner || !inner.target || !Sync.isKind(inner.kind)) continue;
      if (author) inner._from = author;
      var key = Sync.targetKey(inner);
      // Our own unacknowledged edit to the same value is later in relay
      // order, so it wins everywhere; applying this one here would diverge.
      if (key && state.pending[key]) {
        state.lwwSkips++;
        continue;
      }
      group.push(inner);
    }
    if (group.length > 0) state.inbox.push(group);
    return group.length;
  }

  function onRemoteOp(msg) {
    var op = msg.op;
    if (!op || !Sync) return;
    if (msg.author === state.selfId) {
      delete state.awaiting[op.opId];
      var own = innerOps(op);
      for (var i = 0; i < own.length; i++) {
        var key = Sync.targetKey(own[i]);
        if (key && state.pending[key]) {
          if (--state.pending[key] <= 0) delete state.pending[key];
        }
      }
      return;
    }
    if (op.opId) {
      if (state.seenOps[op.opId]) return;
      state.seenOps[op.opId] = 1;
      if (++state.seenOpCount > 5000) {
        state.seenOps = {};
        state.seenOpCount = 0;
      }
    }
    if (op.kind === 'sum') {
      if (op.value && op.value.comps) state.peerSums[msg.author] = { at: Date.now(), comps: op.value.comps };
      return;
    }
    if (op.kind === 'need') {
      if (inAE && op.value && op.value.to === state.selfId && op.target) {
        state.needs.push({ op: op, author: msg.author, at: Date.now() });
        later(repairTick, 0);
      }
      return;
    }
    state.opsReceived += innerOps(op).length;
    if (!inAE) return;
    state.lastSyncAt = Date.now();
    if (acceptRemote(op, msg.author) > 0) {
      maybeLogRx(op.kind, op.kind === 'batch' ? innerOps(op).length + ' edit(s)' : op.path);
      kickCycle(0);
    }
  }

  function sendOps(ops) {
    state.lastSyncAt = Date.now();
    var live = state.ws && state.ws.readyState === 1;
    var keys = {};
    var any = false;
    var i;
    for (i = 0; i < ops.length; i++) {
      var key = Sync.targetKey(ops[i]);
      if (!key) continue;
      keys[key] = 1;
      any = true;
      if (live) state.pending[key] = (state.pending[key] || 0) + 1;
    }
    // Anything still queued for a value we are now sending is older in relay
    // order than our edit, so it must not be applied after it.
    if (any) {
      for (i = state.inbox.length - 1; i >= 0; i--) {
        var kept = [];
        for (var j = 0; j < state.inbox[i].length; j++) {
          var qk = Sync.targetKey(state.inbox[i][j]);
          if (qk && keys[qk]) state.lwwSkips++;
          else kept.push(state.inbox[i][j]);
        }
        if (kept.length === 0) state.inbox.splice(i, 1);
        else state.inbox[i] = kept;
      }
    }
    var chunk = [];
    var size = 0;
    function flush() {
      if (chunk.length === 0) return;
      var wire = chunk.length === 1 ? chunk[0] : { opId: chunk[0].opId + 'b', kind: 'batch', target: { comp: chunk[0].target.comp }, value: { ops: chunk } };
      if (live) state.awaiting[wire.opId] = 1;
      send({ t: 'op', op: wire });
      chunk = [];
      size = 0;
    }
    for (i = 0; i < ops.length; i++) {
      var len = JSON.stringify(ops[i]).length;
      if (chunk.length >= MAX_BATCH_OPS || (chunk.length > 0 && size + len > MAX_BATCH_CHARS)) flush();
      chunk.push(ops[i]);
      size += len;
    }
    flush();
    txLog(ops);
  }

  // What to read this cycle. The active comp always; every layer the incoming
  // ops touch (so the result can be adopted); whatever was selected a moment
  // ago (an edit followed by a click-away); comps created a moment ago; and a
  // small rotating slice of everything else as a safety net.
  function pickReads(ops) {
    var by = {};
    var order = [];
    var i;
    var sid;
    function entry(compSid, firm) {
      if (!by[compSid]) {
        by[compSid] = { c: compSid, deep: {}, firm: false };
        order.push(compSid);
      }
      if (firm) by[compSid].firm = true;
      return by[compSid];
    }
    for (i = 0; i < ops.length; i++) {
      var e = entry(Sync.sidPart(ops[i].target.comp), false);
      if (ops[i].target.layer) e.deep[ops[i].target.layer] = 1;
    }
    // Anything queued must be read even if the project has not changed since.
    var must = ops.length > 0 || state.readQueue.length > 0 || hasKeys(state.deepQueue) || hasKeys(state.fullNext) || state.sweeping || state.trailOn;
    for (i = 0; i < state.readQueue.length; i++) entry(state.readQueue[i], true);
    state.readQueue = [];
    for (sid in state.deepQueue) {
      var q = entry(sid, true);
      for (var layerSid in state.deepQueue[sid]) q.deep[layerSid] = 1;
    }
    state.deepQueue = {};
    var act = state.lastActiveSid;
    if (act) {
      var a = entry(act, true);
      for (i = 0; i < state.selection.length; i++) a.deep[state.selection[i]] = 1;
      // After any edit, walk the open comp once in small slices: an edit to a
      // layer that was deselected again before we looked is found this way.
      if (state.trailOn) a.sweep = [state.trailAt, SWEEP_LAYERS];
    }
    var comps = state.compSids;
    state.sweepComp = null;
    if (state.sweeping && comps.length > 0 && state.sweepIdx >= comps.length) {
      // Went all the way round. Done only if nothing was edited since the
      // round began: an edit behind the sweep needs another round.
      state.sweepIdx = 0;
      state.sweepLayer = 0;
      if (state.editedAt > state.roundStartedAt) state.roundStartedAt = Date.now();
      else state.sweeping = false;
    }
    if (state.sweeping && comps.length > 0) {
      state.sweepComp = comps[state.sweepIdx];
      entry(state.sweepComp, true).sweep = [state.sweepLayer, SWEEP_LAYERS];
    }
    var active = {};
    var read = [];
    for (i = 0; i < order.length; i++) {
      var r = by[order[i]];
      if (!state.shadows[r.c] || state.fullNext[r.c]) {
        // No baseline yet: read it whole, unless only a remote op named it
        // (then there is nothing to adopt into and the first visit will do).
        if (!r.firm) continue;
        r.all = 1;
      }
      delete r.firm;
      if (state.resend[r.c] || state.resend['*']) r.resend = 1;
      if (r.c === act) active = r;
      else read.push(r);
    }
    state.fullNext = {};
    state.resend = {};
    return { active: active, read: read, must: must };
  }

  function runCycle() {
    if (state.cycleBusy) {
      // After Effects answers scripts strictly in order, so asking again while
      // it is busy (a long render, a big paste) would only stack work up.
      if (Date.now() - state.cycleStartedAt < CYCLE_WATCHDOG_MS) {
        kickCycle(CYCLE_ACTIVE_MS);
        return;
      }
      log('sync watchdog: After Effects did not answer for ' + CYCLE_WATCHDOG_MS / 1000 + 's, asking again');
    }
    var ops = [];
    while (state.inbox.length > 0 && (ops.length === 0 || ops.length + state.inbox[0].length <= MAX_OPS_PER_CYCLE)) {
      ops = ops.concat(state.inbox.shift());
    }
    var forced = state.force;
    var plan = pickReads(ops);
    var req = { ops: ops, force: forced, active: plan.active, read: plan.read, rev: state.rev };
    if (plan.must || hasKeys(forced)) req.must = 1;
    state.force = {};
    if (state.stampJob) {
      req.stamp = state.stampJob;
      state.stampJob = null;
    }
    state.cycleBusy = true;
    state.cycleStartedAt = Date.now();
    var gen = state.pollGeneration;
    cs.evalScript(
      '(typeof vynkSync === "undefined") ? "nosync" : vynkSync.cycle(' + JSON.stringify(JSON.stringify(req)) + ')',
      function (res) {
        state.cycleBusy = false;
        if (stale() || state.pollGeneration !== gen) return;
        var out = null;
        if (typeof res === 'string' && res.charAt(0) === '{') {
          try { out = JSON.parse(res); } catch (e) { out = null; }
        }
        var done = out && out.r ? out.r.length : 0;
        if (done < ops.length) state.inbox.unshift(ops.slice(done));
        if (!out) {
          // AE refuses scripts while a modal dialog is open; just try again.
          logThrottled('cyclefail', 'sync paused: After Effects is busy (' + String(res).slice(0, 80) + ')', 10000);
          kickCycle(1000);
          return;
        }
        if (out.error) logThrottled('cycleerr', 'sync error: ' + out.error, 5000);
        var took = Date.now() - state.cycleStartedAt;
        state.cycleMs = out.ms || 0;
        state.pollMs = state.pollMs ? Math.round(state.pollMs * 0.8 + took * 0.2) : took;
        state.pollCount++;
        var changed = false;
        var edited = state.rev >= 0 && out.revBefore !== state.rev;
        try {
          if (projectSwitched(out)) {
            log('project changed - sync restarts from the project that is open now');
            resetBaselines();
            state.baseOpened = !!(state.baseInfo && out.host && out.host.projectName === state.baseInfo.name);
            changed = true;
          } else if (out.same) {
            noteActive(out.active || null, out.aid || null, out.sel || []);
          } else {
            changed = handleCycle(out, ops.slice(0, done), forced);
          }
        } catch (e2) {
          state.resend['*'] = 1;
          logThrottled('cyclethrow', 'sync loop error: ' + (e2 && e2.message ? e2.message : String(e2)), 5000);
        }
        if (state.harness && !out.same) {
          log('cycle ' + took + 'ms rev ' + state.rev + '>' + out.revBefore + '>' + out.rev + ' applied=' + done + ' snaps=' + (out.snaps ? out.snaps.length : 0) +
            ' all=' + (plan.active.all ? 1 : 0) + ' read=' + plan.read.length + ' changed=' + changed + ' stamp=' + (state.stampJob ? 1 : 0) +
            ' dq=' + (hasKeys(state.deepQueue) ? 1 : 0) + ' chase=' + state.chase + ' sweep=' + state.sweeping + ':' + state.sweepIdx + ':' + state.sweepLayer + ' act=' + state.lastActiveSid);
        }
        if (edited && !out.same && state.lastActiveSid) {
          state.trailOn = true;
          state.trailAt = 0;
        }
        // Edits in comps that are not open can only be found by looking, so
        // any edit keeps the background pass going until a quiet full round.
        if (edited && !out.same) {
          state.editedAt = Date.now();
          if (!state.sweeping) {
            state.sweeping = true;
            state.roundStartedAt = Date.now();
          }
        }
        if (typeof out.rev === 'number' && !state.resetPending) state.rev = out.rev;
        state.resetPending = false;
        if (changed) state.lastChangeAt = Date.now();
        // The project was edited but nothing that was read in depth explains
        // it. Read the whole active comp once (backing off while that keeps
        // finding nothing), then walk the rest of the project in small slices.
        if (state.chase && plan.active.all) {
          state.chase = false;
          state.escalateGapMs = changed ? ESCALATE_MIN_MS : Math.min(ESCALATE_MAX_MS, state.escalateGapMs * 2);
          if (!changed) state.sweeping = true;
        } else if (edited && !changed && !out.same && done === 0) {
          if (state.lastActiveSid && !plan.active.all && Date.now() - state.escalateAt > state.escalateGapMs) {
            state.escalateAt = Date.now();
            state.chase = true;
            state.fullNext[state.lastActiveSid] = 1;
            state.readQueue.push(state.lastActiveSid);
          } else {
            state.sweeping = true;
          }
        }
        var delay;
        if (state.inbox.length > 0 || state.stampJob || state.readQueue.length > 0 || hasKeys(state.deepQueue) || hasKeys(state.fullNext) || hasKeys(state.force)) delay = 0;
        else if (state.sweeping || state.trailOn) delay = CYCLE_ACTIVE_MS;
        else if (Date.now() - state.lastChangeAt < POLL_BURST_MS) delay = CYCLE_ACTIVE_MS;
        else delay = state.nativeMode ? NATIVE_IDLE_POLL_MS : CYCLE_IDLE_MS;
        // Never spend more than about a third of AE's time reading.
        if (delay > 0) delay = Math.max(delay, state.cycleMs * 2);
        state.pollScheduledDelay = delay;
        kickCycle(delay);
      }
    );
  }

  // Opening or creating another project is not an edit. The revision counter
  // only ever goes up inside one project, and the file path names it.
  function projectSwitched(out) {
    var path = (out.host && out.host.projectPath) || '';
    var switched = false;
    if (state.cyclePath !== undefined && path !== state.cyclePath) switched = true;
    if (state.rev >= 0 && typeof out.revBefore === 'number' && out.revBefore >= 0 && out.revBefore < state.rev) switched = true;
    state.cyclePath = path;
    if (switched) {
      state.resetPending = true;
      state.rev = -1;
    }
    return switched;
  }

  function noteActive(activeSid, activeId, sel) {
    if (activeId !== state.compId) {
      state.compSid = activeId ? activeSid : null;
      state.compId = activeId;
      state.compName = activeId ? activeId.substring(activeId.indexOf('|') + 1) : null;
      state.selection = sel;
      $('compText').textContent = state.compName ? 'comp: ' + state.compName : '';
      log('active comp: ' + (state.compName || 'none'));
      announceSelection();
    } else if (activeId && sel.join(',') !== state.selection.join(',')) {
      state.selection = sel;
      announceSelection();
    }
    if (activeId) state.lastActiveSid = activeSid;
  }

  // A snapshot that is not kept: have its attributes sent again, and restart
  // the follow-up walk so nothing it read in depth is skipped.
  function dropSnapshot(compSid) {
    state.resend[compSid] = 1;
    if (compSid === state.lastActiveSid) {
      state.trailOn = true;
      state.trailAt = 0;
    }
  }

  function hasKeys(obj) {
    for (var k in obj) return true;
    return false;
  }

  function announceSelection() {
    if (!state.connected) return;
    var msg = { t: 'selection', compId: state.compId, layers: state.selection };
    if (state.myHash && state.hashComp === state.compSid) msg.hash = state.myHash;
    send(msg);
  }

  function handleCycle(out, applied, forced) {
    var i;
    var sid;
    for (i = 0; i < applied.length; i++) {
      if (!out.r[i]) continue;
      if (out.r[i] === 'needs the comp open') {
        // Layer styles can only be added in the comp that is in the viewer.
        var parkSid = Sync.sidPart(applied[i].target.comp);
        var parked = state.parked[parkSid] || (state.parked[parkSid] = []);
        var pk = Sync.targetKey(applied[i]);
        for (var pj = parked.length - 1; pj >= 0; pj--) {
          if (Sync.targetKey(parked[pj]) === pk) parked.splice(pj, 1);
        }
        parked.push(applied[i]);
        logThrottled('parked:' + parkSid, 'a teammate changed layer styles in a comp you do not have open - they apply when you open it', 30000);
        continue;
      }
      state.applyFails = (state.applyFails || 0) + 1;
      logThrottled('applyfail:' + applied[i].kind + ':' + String(out.r[i]).slice(0, 40), 'apply failed: ' + applied[i].kind + ' ' + (applied[i].path || '') + ' - ' + out.r[i], 3000);
      if (repairable(out.r[i])) requestRepair(applied[i], String(out.r[i]));
    }
    if (out.viewer && out.active && state.parked[out.active]) {
      state.inbox.unshift(state.parked[out.active]);
      delete state.parked[out.active];
    }
    var snaps = out.snaps || [];
    var active = null;
    for (i = 0; i < snaps.length; i++) {
      if (Sync.sidPart(snaps[i].id) === out.active) active = snaps[i];
    }
    noteActive(active ? out.active : null, active ? active.id : null, active ? active.sel : []);

    if (!state.everConnected) return false;
    var live = true;
    var stamp = { items: [], layers: [] };
    var ops = [];
    var changed = applied.length > 0;

    // ---- project items (comps and folders)
    var items = out.items || [];
    var comps = [];
    for (i = 0; i < items.length; i++) {
      if (items[i].type === 'comp') comps.push(items[i].sid);
    }
    state.compSids = comps;
    var survivors = 0;
    if (state.shadowItems) {
      var nowBy = {};
      for (i = 0; i < items.length; i++) nowBy[items[i].sid] = 1;
      for (i = 0; i < state.shadowItems.length; i++) {
        if (nowBy[state.shadowItems[i].sid]) survivors++;
      }
    }
    if (state.shadowItems && state.shadowItems.length > 0 && survivors === 0) {
      // Every comp and folder we knew is gone at once: that is a different
      // project (File > New, Close), never a teammate-visible delete.
      log('project changed - sync restarts from the project that is open now');
      resetBaselines();
      state.rev = -1;
      state.resetPending = true;
      return true;
    }
    if (!state.shadowItems || !live) {
      state.shadowItems = items;
    } else {
      Sync.adoptItems(state.shadowItems, items, applied);
      for (i = 0; i < applied.length; i++) {
        // A comp a teammate just created: adopt it as it stands after creation.
        if (applied[i].kind === 'iadd' && applied[i].value && applied[i].value.type === 'comp' && !out.r[i]) {
          delete state.shadows[applied[i].value.sid];
        }
      }
      var freshItems = Sync.unstampedItems(state.shadowItems, items);
      if (freshItems.length > 0) {
        for (i = 0; i < freshItems.length; i++) stamp.items.push([freshItems[i], randomHex(12)]);
      } else {
        var itemOps = Sync.diffItems(state.shadowItems, items);
        for (i = 0; i < itemOps.length; i++) {
          ops.push(itemOps[i]);
          if (itemOps[i].kind === 'iadd' && itemOps[i].value.type === 'comp') {
            // Created here: teammates start it empty, so everything in it is news.
            state.shadows[itemOps[i].value.sid] = Sync.emptyComp(itemOps[i].value.sid);
            state.readQueue.push(itemOps[i].value.sid);
          }
          if (itemOps[i].kind === 'irm') delete state.shadows[itemOps[i].target.comp];
        }
        state.shadowItems = items;
      }
    }

    // ---- comps
    var seenSnap = {};
    for (var si = 0; si < snaps.length; si++) {
      var snap = snaps[si];
      var compSid = Sync.sidPart(snap.id);
      seenSnap[compSid] = 1;
      if (state.trailOn && compSid === state.lastActiveSid && compSid !== state.sweepComp) {
        state.trailAt += SWEEP_LAYERS;
        if (state.trailAt >= snap.layers.length) state.trailOn = false;
      }
      if (compSid === state.sweepComp) {
        state.sweepLayer += SWEEP_LAYERS;
        if (state.sweepLayer >= snap.layers.length) {
          state.sweepIdx++;
          state.sweepLayer = 0;
        }
        state.sweepComp = null;
      }
      if (snap.full) state.verifiedAt[compSid] = Date.now();
      var shadow = state.shadows[compSid];
      if (!shadow || !live) {
        if (snap.full) {
          state.shadows[compSid] = snap;
        } else if (!shadow) {
          state.fullNext[compSid] = 1;
          state.readQueue.push(compSid);
        }
        continue;
      }
      // Layers that were only listed keep the property tree the shadow holds.
      var known = {};
      for (i = 0; i < shadow.layers.length; i++) known[shadow.layers[i].sid] = shadow.layers[i];
      var unknown = false;
      for (i = 0; i < snap.layers.length; i++) {
        var lite = snap.layers[i];
        var held = known[lite.sid];
        if (!held) {
          // New here. Ask for every new layer in depth together, including the
          // ones that already came back in depth this time, so the next
          // snapshot has them all at once.
          state.deepQueue[compSid] = state.deepQueue[compSid] || {};
          state.deepQueue[compSid][lite.sid] = 1;
          if (lite.lite) unknown = true;
          continue;
        }
        if (!lite.lite) continue;
        if (!lite.a) lite.a = held.a;
        lite.p = held.p;
        lite.g = held.g;
        lite.kind = held.kind;
        if (held.src) lite.src = held.src;
        if (held.box) lite.box = held.box;
        delete lite.lite;
      }
      if (!unknown) delete state.deepQueue[compSid];
      if (applied.length) Sync.adopt(shadow, snap, applied);
      // A snapshot that is not kept must have its attributes sent again.
      if (unknown || stamp.items.length > 0) dropSnapshot(compSid);
      if (unknown) continue;
      // Items being stamped this cycle are not announced yet, so hold back
      // anything that could refer to them.
      if (stamp.items.length > 0) continue;
      var fresh = Sync.unstamped(shadow, snap);
      if (fresh.length > 0) {
        // Newly created layers get a room-wide id first; they are announced
        // from the next snapshot, which already shows them stamped.
        for (i = 0; i < fresh.length; i++) stamp.layers.push([snap.id, fresh[i], randomHex(12)]);
        state.readQueue.push(compSid);
        dropSnapshot(compSid);
        continue;
      }
      var d = Sync.diff(shadow, snap, { forced: forced });
      for (sid in d.keep) {
        for (i = 0; i < snap.layers.length; i++) {
          if (snap.layers[i].sid !== sid) continue;
          for (var path in d.keep[sid]) snap.layers[i].p[path] = d.keep[sid][path];
        }
        state.force[sid] = 1;
        state.readQueue.push(compSid);
      }
      state.shadows[compSid] = snap;
      for (i = 0; i < d.ops.length; i++) ops.push(d.ops[i]);
    }
    // A comp touched by remote ops that could not be read back has no state to
    // adopt; drop its shadow so the next read starts from what AE then holds.
    for (i = 0; i < applied.length; i++) {
      var touched = Sync.sidPart(applied[i].target.comp);
      if (applied[i].kind.charAt(0) !== 'i' && !seenSnap[touched]) delete state.shadows[touched];
    }
    if (state.sweepComp) {
      state.sweepIdx++;
      state.sweepLayer = 0;
    }

    if (stamp.items.length > 0 || stamp.layers.length > 0) {
      state.stampJob = stamp;
      changed = true;
    }
    if (ops.length > 0) {
      sendOps(ops);
      changed = true;
    }
    return changed;
  }

  // --------------------------------------------------------------- self-repair
  // Each panel publishes a fingerprint of the comp it has open. When two
  // fingerprints still disagree after things have gone quiet, the peer with the
  // higher id asks the one with the lowest id (the reference) for the layers
  // that differ, and the reference answers with whole layers. An edit that
  // could not be applied triggers the same request straight away.
  var REPAIR_TICK_MS = 2000;
  var REPAIR_QUIET_MS = 4000;
  var REPAIR_GAP_MS = 10000;
  var REPAIR_NEED_TTL_MS = 90000;
  var REPAIR_MAX_PER_LAYER = 2;
  var REPAIR_WINDOW_MS = 300000;

  function quietFor() {
    return Date.now() - Math.max(state.lastSyncAt || 0, state.lastChangeAt || 0);
  }

  // Nothing of ours is unacknowledged and nothing of theirs is unapplied.
  // Repairs only ever compare two peers that are both in this state.
  function caughtUp() {
    return state.inbox.length === 0 && !state.cycleBusy && !state.stampJob && !hasKeys(state.awaiting) && quietFor() >= REPAIR_TICK_MS;
  }

  // The reference in a disagreement is whoever has been in the room longest:
  // a late joiner is brought to the room's state, never the other way round.
  function joinedOf(id) {
    if (id === state.selfId) return state.selfJoinedAt;
    return (state.members[id] && state.members[id].joinedAt) || 0;
  }

  function olderThan(a, b) {
    var ja = joinedOf(a);
    var jb = joinedOf(b);
    if (ja !== jb) return ja < jb;
    return a < b;
  }

  function sendNeed(compId, to, layers, full) {
    send({ t: 'op', op: { opId: randomHex(12), kind: 'need', target: { comp: compId }, value: { to: to, layers: layers, full: full ? 1 : 0, fresh: full && !state.agreed[Sync.sidPart(compId)] ? 1 : 0 } } });
  }

  // A teammate's edit failed here because something it refers to is missing.
  function requestRepair(op, reason) {
    if (!op._from || !op.target) return;
    var key = Sync.sidPart(op.target.comp) + '|' + (op.target.layer || '');
    var now = Date.now();
    var seen = state.repairAsked[key] || [];
    while (seen.length > 0 && now - seen[0] > 60000) seen.shift();
    if (seen.length >= REPAIR_MAX_PER_LAYER) return;
    seen.push(now);
    state.repairAsked[key] = seen;
    var layers = null;
    if (op.target.layer && reason.indexOf('comp not found') < 0) {
      layers = {};
      layers[op.target.layer] = '';
    }
    log('repair: asking for ' + (layers ? 'a layer' : 'the comp') + ' again (' + reason + ')');
    sendNeed(op.target.comp, op._from, layers);
  }

  function repairable(reason) {
    var r = String(reason);
    if (r.indexOf('unavailable') >= 0 || r.indexOf('media not found') >= 0) return false;
    return r.indexOf('not found') >= 0;
  }

  function answerNeed(need) {
    var op = need.op;
    if (!caughtUp()) return false;
    if (op.value.items) {
      // A joiner asks what comps and folders the room has.
      var itemOps = state.shadowItems ? Sync.diffItems([], state.shadowItems) : [];
      if (itemOps.length > 0) sendOps(itemOps);
      return true;
    }
    var compSid = Sync.sidPart(op.target.comp);
    var shadow = state.shadows[compSid];
    if (!shadow) {
      // Not read yet: read it whole, then answer.
      state.fullNext[compSid] = 1;
      state.readQueue.push(compSid);
      kickCycle(0);
      return false;
    }
    var theirs = op.value.layers;
    var mine = Sync.digest(shadow);
    var ops = [];
    var now = Date.now();
    var i;
    if (!theirs) {
      for (i = 0; state.shadowItems && i < state.shadowItems.length; i++) {
        if (state.shadowItems[i].sid === compSid) ops.push({ opId: randomHex(12), kind: 'iadd', target: { comp: compSid }, value: state.shadowItems[i] });
      }
    }
    var have = {};
    for (i = 0; i < shadow.layers.length; i++) {
      var layer = shadow.layers[i];
      have[layer.sid] = 1;
      if (theirs && !op.value.full && !(layer.sid in theirs)) continue;
      if (theirs && theirs[layer.sid] === mine.layers[layer.sid]) continue;
      var key = need.author + '|' + compSid + '|' + layer.sid;
      // Sending the same layer again for the same pair of states cannot help
      // (the difference is one this machine or theirs cannot represent).
      var pairOf = (theirs && theirs[layer.sid] ? theirs[layer.sid] : String(Math.floor(now / 30000))) + '/' + mine.layers[layer.sid];
      if (state.repairSent[key] === pairOf) continue;
      state.repairSent[key] = pairOf;
      ops.push({ opId: randomHex(12), kind: 'add', target: { comp: shadow.id, layer: layer.sid }, value: { after: i > 0 ? shadow.layers[i - 1].sid : '', layer: layer } });
    }
    // A layer they have and we do not is never deleted by a repair (it may be
    // one this machine simply could not create). Ask them for it instead.
    var missing = null;
    for (var sid in theirs) {
      if (have[sid] || theirs[sid] === '') continue;
      if (op.value.fresh) {
        // They have never matched this comp since joining, so a layer the
        // room does not have is one that was deleted before they arrived.
        ops.push({ opId: randomHex(12), kind: 'remove', target: { comp: shadow.id, layer: sid } });
        continue;
      }
      var askKey = compSid + '|' + sid;
      var asked = state.repairAsked[askKey] || [];
      while (asked.length > 0 && now - asked[0] > REPAIR_WINDOW_MS) asked.shift();
      if (asked.length >= REPAIR_MAX_PER_LAYER) continue;
      asked.push(now);
      state.repairAsked[askKey] = asked;
      missing = missing || {};
      missing[sid] = '';
    }
    if (missing) sendNeed(shadow.id, need.author, missing);
    if (ops.length === 0) return true;
    if (theirs && op.value.full) {
      for (i = 0; i < shadow.layers.length; i++) {
        ops.push({ opId: randomHex(12), kind: 'reorder', target: { comp: shadow.id, layer: shadow.layers[i].sid }, value: { after: i > 0 ? shadow.layers[i - 1].sid : '' } });
      }
    }
    if (!theirs || op.value.full) for (var field in shadow.s) ops.push({ opId: randomHex(12), kind: 'comp', target: { comp: shadow.id }, path: field, value: shadow.s[field] });
    log('repair: sending ' + ops.length + ' op(s) to bring a teammate back in step');
    sendOps(ops);
    return true;
  }

  // Every comp this panel knows, not only the open one: each panel publishes a
  // fingerprint per comp, and a comp that still differs from the reference
  // after being re-read in full here is repaired like the open one.
  var SUM_EVERY_MS = 15000;
  var SUM_MIN_GAP_MS = 3000;
  var SUM_STALE_MS = 60000;

  function sendSums(now) {
    if (now - state.lastSumAt < SUM_MIN_GAP_MS || quietFor() < REPAIR_TICK_MS) return;
    var comps = {};
    var any = false;
    for (var sid in state.shadows) {
      comps[sid] = Sync.digest(state.shadows[sid]).hash;
      any = true;
    }
    if (!any) return;
    var sig = JSON.stringify(comps);
    if (sig === state.lastSumSig && now - state.lastSumAt < SUM_EVERY_MS) return;
    state.lastSumSig = sig;
    state.lastSumAt = now;
    send({ t: 'op', op: { opId: randomHex(12), kind: 'sum', target: { comp: '' }, value: { comps: comps } } });
  }

  function projectRepair(now) {
    if (quietFor() < REPAIR_QUIET_MS) return;
    for (var compSid in state.shadows) {
      var reference = state.selfId;
      var refHash = '';
      for (var id in state.peerSums) {
        var sum = state.peerSums[id];
        if (!state.members[id] || now - sum.at > SUM_STALE_MS || !(compSid in sum.comps)) continue;
        if (olderThan(id, reference)) {
          reference = id;
          refHash = sum.comps[compSid];
        }
      }
      if (reference === state.selfId) continue;
      var shadow = state.shadows[compSid];
      var mine = Sync.digest(shadow);
      if (mine.hash === refHash) {
        state.agreed[compSid] = 1;
        delete state.mismatchAt[compSid];
        continue;
      }
      // Re-read the comp in full first: anything changed here that was not
      // noticed yet is then sent as an edit instead of being overwritten.
      if (!state.mismatchAt[compSid] || (state.verifiedAt[compSid] || 0) <= state.mismatchAt[compSid]) {
        if (!state.mismatchAt[compSid]) {
          state.mismatchAt[compSid] = now;
          state.fullNext[compSid] = 1;
          state.readQueue.push(compSid);
          kickCycle(0);
        }
        continue;
      }
      var pair = reference + ':' + refHash + ':' + mine.hash;
      if (state.needSent[compSid] === pair && now - (state.needSentAt[compSid] || 0) < 30000) continue;
      state.needSent[compSid] = pair;
      state.needSentAt[compSid] = now;
      delete state.mismatchAt[compSid];
      log('repair: ' + compLabel(shadow.id) + ' differs from ' + ((state.members[reference] && state.members[reference].name) || 'a teammate') + ' - asking for the difference');
      sendNeed(shadow.id, reference, mine.layers, true);
    }
  }

  function repairTick() {
    if (!state.connected || !Sync || !inAE) return;
    var now = Date.now();
    var i;
    for (i = state.needs.length - 1; i >= 0; i--) {
      if (now - state.needs[i].at > REPAIR_NEED_TTL_MS || answerNeed(state.needs[i])) state.needs.splice(i, 1);
    }
    if (state.wantItems && caughtUp() && state.shadowItems) {
      var eldest = state.selfId;
      for (var mid in state.members) {
        if (state.members[mid].aeVersion !== 'observer' && olderThan(mid, eldest)) eldest = mid;
      }
      state.wantItems = false;
      if (eldest !== state.selfId) {
        send({ t: 'op', op: { opId: randomHex(12), kind: 'need', target: { comp: '' }, value: { to: eldest, items: 1 } } });
      }
    }
    if (caughtUp()) {
      sendSums(now);
      projectRepair(now);
    }
    var shadow = state.compSid ? state.shadows[state.compSid] : null;
    if (!shadow || !caughtUp()) return;
    var mine = Sync.digest(shadow);
    if (mine.hash !== state.myHash || state.hashComp !== state.compSid) {
      state.myHash = mine.hash;
      state.hashComp = state.compSid;
      announceSelection();
    }
    var reference = state.selfId;
    var referenceHash = mine.hash;
    var differs = false;
    for (var id in state.members) {
      var m = state.members[id];
      if (id === state.selfId || !m.compHash || Sync.sidPart(m.compId) !== state.compSid) continue;
      if (m.compHash !== mine.hash) differs = true;
      if (olderThan(id, reference)) {
        reference = id;
        referenceHash = m.compHash;
      }
    }
    if (reference === state.selfId || referenceHash === mine.hash) state.agreed[state.compSid] = 1;
    if (!differs || reference === state.selfId || referenceHash === mine.hash) return;
    if (quietFor() < REPAIR_QUIET_MS) return;
    var pair = reference + ':' + referenceHash + ':' + mine.hash;
    if (pair === state.lastNeedPair || now - state.lastNeedAt < REPAIR_GAP_MS) return;
    state.lastNeedPair = pair;
    state.lastNeedAt = now;
    log('repair: this comp differs from ' + ((state.members[reference] && state.members[reference].name) || 'a teammate') + ' - asking for the difference');
    sendNeed(shadow.id, reference, mine.layers, true);
  }

  // Two-instance test harness (tools/ae-pair). Inert unless
  // %LOCALAPPDATA%\Vynk\harness.json has an entry for this AE version.
  function initHarness() {
    if (!inAE || !cs || typeof require !== 'function') return;
    var fs;
    var cfg;
    try {
      fs = require('fs');
      var all = JSON.parse(fs.readFileSync((process.env.LOCALAPPDATA || '') + '\\Vynk\\harness.json', 'utf8'));
      cfg = all[String(hostVersion).split('.').slice(0, 2).join('.')];
    } catch (e) { return; }
    if (!cfg || !cfg.dir || !cfg.name) return;
    state.harness = true;
    $('serverInput').value = cfg.server || '';
    $('roomInput').value = cfg.room || '';
    $('nameInput').value = cfg.name;
    var busy = false;
    every(function () {
      if (busy) return;
      var file = cfg.dir + '\\' + cfg.name + '.cmd';
      var cmd;
      try {
        cmd = JSON.parse(fs.readFileSync(file, 'utf8'));
        fs.unlinkSync(file);
      } catch (e) { return; }
      busy = true;
      var done = function (result) {
        busy = false;
        try {
          fs.writeFileSync(file + '.tmp', JSON.stringify({ id: cmd.id, result: String(result) }));
          fs.renameSync(file + '.tmp', cfg.dir + '\\' + cfg.name + '.res');
        } catch (e) {}
      };
      if (cmd.js) {
        var out;
        try { out = eval(cmd.js); } catch (e) { out = 'ERR ' + e; }
        done(out);
      } else {
        cs.evalScript(cmd.jsx, done);
      }
    }, 80);
  }

  loadSettings();
  initHarness();
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
