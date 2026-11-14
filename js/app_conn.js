if (typeof lib != 'undefined')
  throw new Error('Global "lib" object already exists.');

var lib = {};

lib.AppConnection = function(spec) {
  // Callback functions.
  this.callbacks = {
    connect: spec.onConnect,        // Called when socket is connected.
    disconnect: spec.onDisconnect,  // Called when socket is disconnected.
    recv: spec.onReceive,           // Called when client receives data from server.
    sent: spec.onSent,               // Called when client sends data to server.
    paste: spec.onPasteDone,
    storage: spec.onStorageDone,
    font: spec.onSymFont
  };

  this.isConnected = false;
  var params = new URLSearchParams(window.location.search);

  this.officialAppId = 'hhnlfapopmaimdlldbknjdgekpgffmbo';
  this.testAppId = 'hmhhegkjioifokmmlhkblnebfoekbalf';

  // An explicit appId query parameter takes priority. If omitted, probe the
  // independent test build first, then fall back to the official build.
  this.appId = params.get('appId') || null;
  this.appPort = null;
};

lib.AppConnection.prototype.checkChromeApp = function(callback) {
  var self = this;

  if (typeof chrome == 'undefined' || !chrome.runtime) {
    console.error('chrome.runtime is unavailable');
    self.showJumbo();
    return;
  }

  var candidates;
  if (self.appId) {
    candidates = [self.appId];
  } else {
    candidates = [self.testAppId, self.officialAppId];
  }

  var tryNext = function(index) {
    if (index >= candidates.length) {
      console.error('No compatible PttChrome App was found');
      self.showJumbo();
      return;
    }

    var candidateId = candidates[index];
    chrome.runtime.sendMessage(candidateId, { action: 'status' }, function(response) {
      var error = chrome.runtime.lastError;
      if (error) {
        console.warn('Unable to connect to PttChrome App ' + candidateId + ': ' + error.message);
        tryNext(index + 1);
        return;
      }

      if (!response || response.result !== true) {
        console.warn('PttChrome App returned an invalid status response: ' + candidateId);
        tryNext(index + 1);
        return;
      }

      // connect() must use the same ID that successfully answered status.
      self.appId = candidateId;
      console.log('Using PttChrome App: ' + candidateId);
      callback();
    });
  };

  tryNext(0);
};

lib.AppConnection.prototype.showJumbo = function() {
  var self = this;
  $('#getAppBtn').off();
  $('#getAppBtn').click(function() {
    if (typeof(chrome) == 'undefined') {
      window.open('https://chrome.google.com/webstore/detail/pttchrome/'+self.appId, '_self');
      return;
    }
    // turn it on when it works
    chrome.webstore.install(undefined, function() {
      // successfully installed
      location.reload();
    });
    //window.open('https://chrome.google.com/webstore/detail/pttchrome/'+self.appId, '_self');
  });
  console.log('app is not running or installed');
  $('#getAppBtn').text(i18n('getAppBtn'));
  for (var i = 1; i < 5; ++i) {
    $('#alreadyInstalledHint'+i).text(i18n('alreadyInstalledHint'+i));
  }
  $('#welcomeJumbo').show();
};

lib.AppConnection.prototype.connect = function(callback) {
  var self = this;
  this.checkChromeApp(function() {
    //var tabid = document.getElementById('cmdHandler').getAttribute('mapcode');
    //_this.so.connect(_this.host, _this.port, tabid);
    self.appPort = chrome.runtime.connect(self.appId);
    self.appPort.onMessage.addListener(function(msg) {
      switch(msg.action) {
        case "connected":
          self.callbacks.connect();
          break;
        case "onReceive":
          self.callbacks.recv(msg.data);
          break;
        case "disconnected":
          self.callbacks.disconnect();
          break;
        case "onPasteDone":
          self.callbacks.paste(msg.data);
          break;
        case "onStorageDone":
          self.callbacks.storage(msg);
          break;
        case "onSymFont":
          self.callbacks.font(msg);
          break;
        default:
          break;
      }
    });
    
    self.appPort.onDisconnect.addListener(function(msg) {
      self.callbacks.disconnect();
    });
    self.isConnected = true;
    
    callback();
  });
};

lib.AppConnection.prototype.connectTcp = function(host, port, keepAlive) {
  if (!this.isConnected) {
    return;
  }
  this.appPort.postMessage({
    action: "connect",
    host: host,
    port: port,
    keepAlive: keepAlive
  });
};

lib.AppConnection.prototype.sendTcp = function(str) {
  if (this.appPort === null) {
    return;
  }
  if (!this.isConnected) {
    return;
  }

  // because ptt seems to reponse back slowly after large
  // chunk of text is pasted, so better to split it up.
  var chunk = 1000;
  for (var i = 0; i < str.length; i += chunk) {
    var chunkStr = str.substring(i, i+chunk);
    this.appPort.postMessage({
      action: 'send',
      data: chunkStr
    });
  }
};

lib.AppConnection.prototype.disconnectTcp = function() {
  if (!this.isConnected || !this.appPort) {
    return;
  }
  try {
    this.appPort.postMessage({ action: 'disconnect' });
  } catch (e) {
  }
};

lib.AppConnection.prototype.disconnect = function() {
  this.disconnectTcp();
  if (this.appPort) {
    try {
      this.appPort.disconnect();
    } catch (e) {
    }
  }
  this.appPort = null;
  this.isConnected = false;
};

