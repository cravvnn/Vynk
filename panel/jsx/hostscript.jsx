if (typeof COLLAB_JSON_POLYFILLED === 'undefined') { COLLAB_JSON_POLYFILLED = false; }

if (typeof JSON === 'undefined' || typeof JSON.stringify === 'undefined' || typeof JSON.parse === 'undefined') {
  COLLAB_JSON_POLYFILLED = true;
  if (typeof JSON === 'undefined') { JSON = {}; }

  var collabQuote = function (s) {
    var out = '"';
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      var code = s.charCodeAt(i);
      if (c === '"') out += '\\"';
      else if (c === '\\') out += '\\\\';
      else if (c === '\n') out += '\\n';
      else if (c === '\r') out += '\\r';
      else if (c === '\t') out += '\\t';
      else if (code < 32) {
        var hex = code.toString(16);
        out += '\\u0000'.substring(0, 6 - hex.length) + hex;
      } else {
        out += c;
      }
    }
    return out + '"';
  };

  var collabIsArray = function (value) {
    return Object.prototype.toString.call(value) === '[object Array]';
  };

  var collabStringify = function (value) {
    if (value === null) return 'null';
    var t = typeof value;
    if (t === 'number') return isFinite(value) ? String(value) : 'null';
    if (t === 'boolean') return value ? 'true' : 'false';
    if (t === 'string') return collabQuote(value);
    if (t === 'undefined' || t === 'function') return undefined;
    var i;
    if (collabIsArray(value)) {
      var parts = [];
      for (i = 0; i < value.length; i++) {
        var item = collabStringify(value[i]);
        parts.push(item === undefined ? 'null' : item);
      }
      return '[' + parts.join(',') + ']';
    }
    if (t === 'object') {
      var out = [];
      for (var key in value) {
        if (!value.hasOwnProperty(key)) continue;
        var member = value[key];
        var mt = typeof member;
        if (mt === 'undefined' || mt === 'function') continue;
        var encoded = collabStringify(member);
        if (encoded === undefined) continue;
        out.push(collabQuote(key) + ':' + encoded);
      }
      return '{' + out.join(',') + '}';
    }
    return undefined;
  };

  var collabParse = function (text) {
    var pos = 0;
    var len = text.length;

    function fail(msg) { throw new Error(msg + ' at ' + pos); }

    function skipWsT() {
      while (pos < len) {
        var c = text.charAt(pos);
        if (c === ' ' || c === '\t' || c === '\n' || c === '\r') pos++;
        else break;
      }
    }

    function parseString() {
      var out = '';
      pos++;
      while (pos < len) {
        var c = text.charAt(pos);
        if (c === '"') { pos++; return out; }
        if (c === '\\') {
          pos++;
          var esc = text.charAt(pos);
          if (esc === '"') out += '"';
          else if (esc === '\\') out += '\\';
          else if (esc === '/') out += '/';
          else if (esc === 'b') out += '\b';
          else if (esc === 'f') out += '\f';
          else if (esc === 'n') out += '\n';
          else if (esc === 'r') out += '\r';
          else if (esc === 't') out += '\t';
          else if (esc === 'u') {
            out += String.fromCharCode(parseInt(text.substr(pos + 1, 4), 16));
            pos += 4;
          } else {
            fail('bad escape');
          }
          pos++;
        } else {
          out += c;
          pos++;
        }
      }
      fail('unterminated string');
    }

    function parseNumber() {
      var start = pos;
      if (text.charAt(pos) === '-') pos++;
      while (pos < len && text.charAt(pos) >= '0' && text.charAt(pos) <= '9') pos++;
      if (text.charAt(pos) === '.') {
        pos++;
        while (pos < len && text.charAt(pos) >= '0' && text.charAt(pos) <= '9') pos++;
      }
      if (text.charAt(pos) === 'e' || text.charAt(pos) === 'E') {
        pos++;
        if (text.charAt(pos) === '+' || text.charAt(pos) === '-') pos++;
        while (pos < len && text.charAt(pos) >= '0' && text.charAt(pos) <= '9') pos++;
      }
      return parseFloat(text.substring(start, pos));
    }

    function parseObject() {
      var obj = {};
      pos++;
      skipWsT();
      if (text.charAt(pos) === '}') { pos++; return obj; }
      for (;;) {
        skipWsT();
        var key = parseString();
        skipWsT();
        if (text.charAt(pos) !== ':') fail('expected colon');
        pos++;
        obj[key] = parseValue();
        skipWsT();
        var c = text.charAt(pos);
        if (c === ',') { pos++; continue; }
        if (c === '}') { pos++; return obj; }
        fail('expected comma or brace');
      }
    }

    function parseArray() {
      var arr = [];
      pos++;
      skipWsT();
      if (text.charAt(pos) === ']') { pos++; return arr; }
      for (;;) {
        arr.push(parseValue());
        skipWsT();
        var c = text.charAt(pos);
        if (c === ',') { pos++; continue; }
        if (c === ']') { pos++; return arr; }
        fail('expected comma or bracket');
      }
    }

    function parseValue() {
      skipWsT();
      var c = text.charAt(pos);
      if (c === '"') return parseString();
      if (c === '{') return parseObject();
      if (c === '[') return parseArray();
      if (c === '-' || (c >= '0' && c <= '9')) return parseNumber();
      if (text.substr(pos, 4) === 'true') { pos += 4; return true; }
      if (text.substr(pos, 5) === 'false') { pos += 5; return false; }
      if (text.substr(pos, 4) === 'null') { pos += 4; return null; }
      return fail('unexpected token');
    }

    var result = parseValue();
    skipWsT();
    if (pos < len) fail('trailing characters');
    return result;
  };

  if (typeof JSON.stringify !== 'function') JSON.stringify = collabStringify;
  if (typeof JSON.parse !== 'function') JSON.parse = collabParse;
}

// The sync engine lives in sync.jsx. This file only installs the JSON polyfill
// above (some After Effects builds have no JSON) and reports host details.
var collab = (function () {
  function getHostInfo() {
    var info = {
      app: app.version,
      buildName: app.buildName,
      projectName: null,
      projectPath: null,
      numItems: 0
    };
    try {
      if (app.project) {
        info.projectName = app.project.file ? app.project.file.name : null;
        info.projectPath = app.project.file ? app.project.file.fsName : null;
        info.numItems = app.project.numItems;
      }
    } catch (e) {}
    return JSON.stringify(info);
  }

  return {
    jsonPolyfilled: COLLAB_JSON_POLYFILLED,
    ping: function () { return 'pong'; },
    getHostInfo: getHostInfo
  };
})();
