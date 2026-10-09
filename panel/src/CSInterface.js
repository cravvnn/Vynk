(function () {
  'use strict';

  function CSInterface() {}

  CSInterface.prototype.getHostEnvironment = function () {
    var cep = window.__adobe_cep__;
    if (!cep) return null;
    try {
      return JSON.parse(cep.getHostEnvironment());
    } catch (e) {
      return null;
    }
  };

  CSInterface.prototype.evalScript = function (script, callback) {
    var cep = window.__adobe_cep__;
    if (!cep) {
      if (callback) callback('EvalScript error: not running inside a CEP host');
      return;
    }
    cep.evalScript(script, callback || function () {});
  };

  CSInterface.prototype.getSystemPath = function (pathType) {
    var cep = window.__adobe_cep__;
    if (!cep) return '';
    return cep.getSystemPath(pathType);
  };

  CSInterface.prototype.addEventListener = function (type, listener) {
    var cep = window.__adobe_cep__;
    if (!cep) return;
    cep.addEventListener(type, listener);
  };

  CSInterface.prototype.dispatchEvent = function (event) {
    var cep = window.__adobe_cep__;
    if (!cep) return;
    cep.dispatchEvent(event);
  };

  window.CSInterface = CSInterface;
  window.SystemPath = {
    USER_DATA: 'userData',
    EXTENSION: 'extension',
    MY_DOCUMENTS: 'myDocuments',
    COMMON_FILES: 'commonFiles'
  };
  window.CSEvent = function (type, data) {
    this.type = type;
    this.data = data;
  };
})();
