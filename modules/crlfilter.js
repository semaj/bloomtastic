"use strict";

const {Cc,Ci,Cu,Cr} = require("chrome");
const {pathFor,platform} = require('sdk/system');
Cu.import("resource://gre/modules/XPCOMUtils.jsm", this);
Cu.import("resource://gre/modules/Services.jsm");

const self = require('sdk/self'),
      simple_prefs = require('sdk/simple-prefs'),
      Request = require('sdk/request').Request,
      bloom = require('bloom-filter'),
      tabs = require('sdk/tabs'),
      ui = require('sdk/ui'),
      preferences = simple_prefs.prefs,
      STATE_START = Ci.nsIWebProgressListener.STATE_START,
      STATE_STOP = Ci.nsIWebProgressListener.STATE_STOP,
      log = console.error.bind(console);
const ADDON_ID = self.id,
      JSONStore = require('./jsonstore'),
      DEFAULT = {},
      SERVER_URL = 'http://localhost:8080',
      TODAYS_FILTER = '/todays-filter/';
      

// Main logic handling of filters and revocation checking
var CRLFilter = {
  filter : undefined,
  lastUpdate: undefined,
  filterID: undefined,
  
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
      //self.enabled = store.data.enabled;
      //if (self.filter === undefined) {
        // so... we have no filter stored. get a fresh one.
        self.syncFilter((store) => {
          log("FILTER " + JSON.stringify(self.filter));
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
    let that = this;
    Request({
      url: SERVER_URL + TODAYS_FILTER + preferences.filterSize,
      onComplete: (response) => {
        if (response.status == 0 || response.status >= 300) {
          log("Filter sync error: " + response.text);
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
            store.save();
            callback(store);
          });
        }
      }
    }).get();
  },
  
  updateFilter: function() {},
  
  checkSerial: function(cert) {
    let serial = cert.serialNumber;
    let r = this.filter.contains(serial);
    log("is " + serial + " there? " + r);
    return r;
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
          (state & Ci.nsIWebProgressListener.STATE_IS_SECURE) && 
          CRLFilter.filter) {
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
            if (CRLFilter.checkSerial(cert)) {
              log('********** Possibly Not Secure!');
              //if (revokeCheck === 1 && preferences.hardFail === 0) {
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
              log('Done forbidding.');
            } 
          } catch(e) {
            log("Cert checking exception: " + e);    
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
simple_prefs.on("filterSize", function () {
  log('Changing filter type');
  CRLFilter.filterSize = preferences.filterSize;
  CRLFilter.syncFilter(() => {
    CRLFilter.insertExtraSerials();
  });
});

simple_prefs.on("enabled", function() {
  try {
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

function changeIcon(checked) {
  return (checked) ? './CRLf_green.ico' : './CRLf_red.ico';
}



function getFilterSize() {
  let filterSizeName = preferences.filterSize;
  if (filterSizeName === "small") {
    return 1000;
  } else if (filterSizeName === "medium") {
    return 100000;
  } else {
    return 100000000;
  }
}

function getFilter(filterData) {
  let b = bloom.create(getFilterSize(), 0.01);
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
  location += e("(Error code: sec_error_revoked_certificate) ")
  location += e("This error brought to you by the Bloomtastic add-on.")
  return location;
}

module.exports = CRLFilterApp;
