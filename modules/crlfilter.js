"use strict";

const {Cc,Ci,Cu,Cr} = require("chrome");
const {pathFor,platform} = require('sdk/system');
Cu.import("resource://gre/modules/XPCOMUtils.jsm", this);
Cu.import("resource://gre/modules/Services.jsm");

const self = require('sdk/self'),
      utils = require('sdk/window/utils'),
      simple_prefs = require('sdk/simple-prefs'),
      Request = require('sdk/request').Request,
      bloom = require('bloom-filter'),
      tabs = require('sdk/tabs'),
      ui = require('sdk/ui'),
      panel = require('sdk/panel'),
      //Buffer = require('sdk/io/buffer').Buffer,
      preferences = simple_prefs.prefs,
      STATE_START = Ci.nsIWebProgressListener.STATE_START,
      STATE_STOP = Ci.nsIWebProgressListener.STATE_STOP,
      log = console.error.bind(console);
var ADDON_ID = self.id;
var JSONStore = require('./jsonstore');
var serverurl = require('../package.json').serverurl;
const DEFAULT = {};
const SERVER_URL = 'http://localhost:8080';
const TODAYS_FILTER = '/todays-filter/';

// Main logic handling of filters and revocation checking
var CRLFilter = {
  filter : undefined,
  lastUpdate: undefined,
  enabled: undefined,
  filterID: undefined,
  maxRank: 1000, //undefined;
  
  getStore: function(callback) {
    return new JSONStore(ADDON_ID, 'filter', DEFAULT).then(callback);
  },
  
  init: function() {
    // Initiate filter if not already done
    // Load it from data folder, else sync with server
    this.enabled = preferences.enabled;
    let self = this;
    this.getStore((store) => {
      self.filter = getFilter(store.data.filterData);
      self.lastUpdate = store.data.lastUpdate;
      self.filterID = store.data.filterID;
      //self.maxRank = store.maxRank;
      self.enabled = store.data.enabled;
      //if (self.filter === undefined) {
        // so... we have no filter stored. get a fresh one.
        self.syncFilter((store) => {
          console.log("FILTER " + JSON.stringify(self.filter));
        });
      //}
    });
  },
  
  uninit: function() {
    // Remove the filter update daemon. To be done when the browser closes
    // Useless maybe
    //return this.updateInterval && clearInterval(this.updateInterval);
  },

  syncFilter : function(callback = ()=>{}) {
    let self = this;
    Request({
      url: SERVER_URL + TODAYS_FILTER + this.maxRank,
      onComplete: (response) => {
        if (response.status >= 300) {
          console.log("Filter sync error: " + response.text);
        } else if (response.json.filter_id == self.filterID)  {
          // this won't exist when we update filters correctly
          console.log("We have an up-to-date filter: " + self.filterID);
        } else {
          let body = response.json;
          let data = {};
          data.lastUpdate = self.lastUpdate = Date.now;
          data.filterID = self.filterID = body.filter_id;
          data.filterData = body.filter_data;
          self.filter = getFilter(body.filter_data);
          data.maxRank = self.maxRank;
          data.enabled = self.enabled;
          self.getStore((store) => {
            store.data = data;
            callback(store);
          });
        }
      }
    }).get();
  },
  
  updateFilter: function() {},
  
  checkSerial: function(cert) {
    //TODO Possible fix for CA issuer name
    // Return values: 0 if not revoked
    //                1 if undetermined
    //                2 if revoked
    let serial = cert.serialNumber;
    let ca_issuer;
    return  (!isCertValid(cert)) ? 2 : 
      ((this.filter !== undefined) && 
       this.filter.has(serial) && 
       this.checkSerialServer(serial,ca_issuer)) || 0;
  },
  
  checkSerialServer: function(serial,ca_issuer) {
    // TODO Should check with server on certificate revocation,
    // now returns 1 for to decide on hard fail check
    // should return 2 if certificate is indeed revoked
    log(preferences.hardFail);
    return 1;
  },
  
  filterInitialized: function() {
    return this.filter !== undefined;
  },
  
  flipEnabled: function(checked) {
    if (checked) {
      this.enabled = true;    
      if (!this.filter) {
        this.getFilter();    
      } 
    } else {
      this.enabled = false;    
    } 
  },
  
  isEnabled: function() {
    if (this.enabled === undefined) {
      throw "Enabled is undefined. This is (?) impossible.";
    }
    return this.enabled;
  }
};

//Implement the app
var CRLFilterApp = {
  prefs: null,
  
  extensionStartup: function (firstRun, reinstall) {
    forEachOpenWindow(CRLFilterApp.initWindow);
    Services.wm.addListener(WindowListener);
    
    // Initiate filter if not already have done so
    CRLFilter.init();
  },
  
  extensionShutdown: function () {
    forEachOpenWindow(CRLFilterApp.uninitWindow);
    Services.wm.removeListener(WindowListener);
    
    CRLFilter.uninit();
  },
  
  extensionUninstall: function () {},
  
  initWindow : function (window) {
    // Add listeners to each browser window
    window.gBrowser.addProgressListener(ProgressListener);
  },
  
  uninitWindow: function (window) {
    // Remove listeners to each browser window
    window.gBrowser.removeProgressListener(ProgressListener);
  },
};

var ProgressListener = {
  QueryInterface: XPCOMUtils.generateQI(["nsIWebProgressListener",
                                         "nsISupportsWeakReference"]),
  
  onStateChange: function(aWebProgress, aRequest, aFlag, aStatus) {
    // If you use ProgressListener for more than one tab/window, use
    // aWebProgress.DOMWindow to obtain the tab/window which triggers the state change
    if (aFlag & STATE_START) {
      // This fires when the load event is initiated
      log("Here at start");
    }
    if (aFlag & STATE_STOP) {
      // This fires when the load finishes
      log("Here at end");
    }
  },
  
  onLocationChange: function(aProgress, aRequest, aURI) {
    // This fires when the location bar changes; that is load event is confirmed
    // or when the user switches tabs. If you use ProgressListener for more than one tab/window,
    // use aProgress.DOMWindow to obtain the tab/window which triggered the change.
    log("At location change");
  },
  
  // For definitions of the remaining functions see related documentation
  onProgressChange: function(aWebProgress, aRequest, curSelf, maxSelf, curTot, maxTot) { log("progress changed");},
  
  onStatusChange: function(aWebProgress, aRequest, aStatus, aMessage) { 
    log("status changed with status " + aStatus + " and message: " + aMessage);
    /*
      let channel = aRequest.QueryInterface(Ci.nsIHttpChannel);
      let domWin = channel.notificationCallbacks.getInterface(Ci.nsIDOMWindow);
      let browser = gBrowser.getBrowserForDocument(domWin.top.document);
    */
  },
  
  onSecurityChange: function(aWebProgress, aRequest, aState) {
    log("onSecurityChange");
    
    try {
      log(aRequest.name);
      let state = aState;
      let filter = CRLFilter.filter;
      if (CRLFilter.isEnabled() &&
          (state & Ci.nsIWebProgressListener.STATE_IS_SECURE)// && 
          // filter
         ) {
        log('Secure');
        if (state & Ci.nsIWebProgressListener.STATE_IDENTITY_EV_TOPLEVEL) {
          log('EV');
        }
        let win = getWinFromProgress(aWebProgress);
        let secUI = win.gBrowser.securityUI;
        if (secUI.SSLStatus) {
          try {
            let cert = secUI.SSLStatus.serverCert;
            let serialNumber = cert.serialNumber;
            log('Here!');
            log(serialNumber);
            
            //TODO Currently it simply stops at filter, need to 
            // send request to server for check
            let revokeCheck = 2; //CRLFilter.checkSerial(cert);
            if (revokeCheck > 0) {
              log('********** Possibly Not Secure!');
              if (revokeCheck === 1 && preferences.hardFail === 0) {
                // TODO Send message to user regarding this event
                log('Allowed due to soft fail');
                return;
              }
              //aRequest.cancel(Cr.NS_ERROR_DOM_SECURITY_ERR);
              
              let channel = aRequest.QueryInterface(Ci.nsIHttpChannel);
              let url = aRequest.name;
              let gBrowser = win.gBrowser;
              let domWin = channel.notificationCallbacks.getInterface(Ci.nsIDOMWindow);
              let browser = gBrowser.getBrowserForDocument(domWin.top.document);
              let abouturl = revokedErrorURL(url);
              log(abouturl);
              browser.loadURIWithFlags(abouturl, 2048);
              //log(browser);
              log('Done stopping');
            } 
          } catch(e) {
            log(e);    
          }
        }
      } else if ((state & Ci.nsIWebProgressListener.STATE_IS_INSECURE)) {
        log('InSecure');
      } else if ((state & Ci.nsIWebProgressListener.STATE_IS_BROKEN)) {
        log('Broken');
      } else {
        log("Filter is undefined, CRLFilter is disabled, or we are in a weird state.");
      }
    } catch(err) {
      log('ERROR:' + err);    
    } finally {
      log('Done:onSecurityChange');    
    }
  }
};

var WindowListener = {
  onOpenWindow: function (xulWindow) {
    let window = xulWindow
        .QueryInterface(Components.interfaces.nsIInterfaceRequestor)
        .getInterface(Components.interfaces.nsIDOMWindow);
    
    function onWindowLoad() {
      window.removeEventListener("load", onWindowLoad);
      if (window.document.documentElement
          .getAttribute("windowtype") === "navigator:browser") {
        CRLFilterApp.initWindow(window);
      }
    }
    window.addEventListener("load", onWindowLoad);
  },
  onCloseWindow: function (xulWindow) {
    let window = xulWindow
        .QueryInterface(Components.interfaces.nsIInterfaceRequestor)
        .getInterface(Components.interfaces.nsIDOMWindow);
    if (window.document.documentElement
        .getAttribute("windowtype") === "navigator:browser") {
      CRLFilterApp.initWindow(window);
    }
    
  },
  onWindowTitleChange: function (xulWindow, newTitle) {}
};

var toggleButton = ui.ToggleButton({
  id: 'mainButton',
  label: 'CRLfilter',
  icon: changeIcon(preferences.enabled),
  checked: preferences.enabled,
  onChange: function(state) {
    CRLFilter.enabled = state.checked;    
    preferences.enabled = state.checked;
    toggleButton.icon = changeIcon(state.checked);
  }
});

//var messagePanel = panel

// Updating the filter when the filter type has changed
simple_prefs.on("filterType", function () {
  //TODO Some problem while changing filter type
  log('Changing filter type');
  try {
    CRLFilter.type = preferences.filterType;
    CRLFilter.syncFilter();
  } catch (err) {
    log(err);
  }
});

simple_prefs.on("enabled", function() {
  try {
    CRLFilter.flipEnabled(preferences.enabled);
    toggleButton.checked = preferences.enabled;
    toggleButton.icon = changeIcon(preferences.enabled);
  } catch (err) {
    log(err);    
  }    
});

simple_prefs.on("updateFilter",function() {
  getExtraSerials(CRLFilter.filter);    
});

function isCertValid(cert) {
  let usecs = new Date().getTime();
  return (usecs > cert.validity.notBefore / 1000 &&
          usecs < cert.validity.notAfter / 1000);
}

function getWinFromProgress(progress) {
  return progress.DOMWindow.QueryInterface(Ci.nsIInterfaceRequestor)
    .getInterface(Ci.nsIWebNavigation)
    .QueryInterface(Ci.nsIDocShellTreeItem)
    .rootTreeItem
    .QueryInterface(Ci.nsIInterfaceRequestor)
    .getInterface(Ci.nsIDOMWindow);
}

function forEachOpenWindow(todo) {
  log('forEachOpenWindow');
  let windows = Services.wm.getEnumerator("navigator:browser");
  while (windows.hasMoreElements()) {
    todo(windows.getNext()
         .QueryInterface(Ci.nsIDOMWindow));
  }
}

function sendFilterRequest(parms,callback) {
  //TODO Need to fix the url ending &
  let url = serverurl + 'filter';
  if (parms) {
    log(parms);
    url += '?';
    for (let parm in parms) {
      url += (parm + '=' + parms[parm] + '&');
    }
    url.slice(0,url.length-1);
  }
  console.log(url);
  Request({
    url: url,
    contentType: 'application/json',
    onComplete: callback
  }).get();
}

function saveFilter(store,filter,type,lastUpdate,id) {
  try {
    store.data.filter = filter;
    store.data.lastUpdate = lastUpdate;
    store.data.type = type;
    store.data.filterid = id;
    store.save();
    log('Filter saved');
  } catch(err) {
    log(err);
  }
}

function changeIcon(checked) {
  return (checked) ? './CRLf_green.ico' : './CRLf_red.ico';
}

function getExtraSerials(filter) {
  let serials = preferences.extraSerial;
  if (serials && serials.length > 0) {
    (serials.split(',')).forEach(function(serial) {
      filter.add(serial);
    });
  }
}

function getFilter(filterData) {
  let b = bloom.create(1000, 0.01);
  b.vData = filterData;
  return b;
}

function revokedErrorURL(url) {
  let location = 'about:neterror?e=nssFailure2&u=';
  let e = encodeURIComponent;
  location += e(url);
  location += '&d='
  location += e("An error occurred during your connection to " + url);
  location += e(". Peer's certificate has been revoked. ");
  location += e("Error code: sec_error_revoked_certificate.) ")
  location += e("This error brought to you by the Bloomtastic add-on.")
  return location;
}

module.exports = CRLFilterApp;
