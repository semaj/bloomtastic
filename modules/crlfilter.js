"use strict";

const {Cc,Ci,Cu,Cr} = require("chrome");
const {pathFor,platform} = require('sdk/system');
Cu.import("resource://gre/modules/XPCOMUtils.jsm", this);
Cu.import("resource://gre/modules/Services.jsm");

const fs = require('sdk/io/fs'),
      path = require('sdk/fs/path'),
      file = require('sdk/io/file'),
      self = require('sdk/self'),
      simple_prefs = require('sdk/simple-prefs'),
      Request = require('sdk/request').Request,
      bloem = require('bloem'),
      Buffer = require('sdk/io/buffer').Buffer,
      preferences = simple_prefs.prefs,
      STATE_START = Ci.nsIWebProgressListener.STATE_START,
      STATE_STOP = Ci.nsIWebProgressListener.STATE_STOP,
      log = console.error.bind(console);
var contentReplace = ["An%20error%20occurred%20during%20a%20connection%20to%20",".%20Peer%27s%20Certificate%20has%20been%20revoked.%20(Error%20code%3A%20sec_error_revoked_certificate)."];   
var enabled = true;
var ADDON_ID = self.id;
var JSONStore = require('./jsonstore');
var serverurl = require('../package.json').serverurl;
const DEFAULT = {'lastUpdate': undefined};

/*
new JSONStore(ADDON_ID, "config", {}).then(store => {
    console.log(store);

    //store.data = {};
    store.data.baz = 'something';
    store.data.filter = new bloem.SafeBloem(Math.pow(10,7),0.01);
    store.save();
});
*/

var CRLFilter = {
    filter : undefined,
    lastUpdate: undefined,
    type: undefined,

    init: function() {
        // Initiate filter if not already done
        // Load it from data folder, else sync with server
        let crlfilter = this;
        if (!this.filter) {
            new JSONStore(ADDON_ID,'filter',DEFAULT).then(store => {
                if (!store.data.filter) {
                    return crlfilter.syncFilter();
                }
                crlfilter.filter = store.data.filter;
                crlfilter.lastUpdate = store.data.lastUpdate;
                crlfilter.type = store.data.type;
            });
        }
        //this.updateInterval = this.updateInterval || setInterval(this.updateFilter,1000*60*60*2);
    },

    uninit: function() {
        // Remove the filter update daemon. To be done when the browser closes
        // Useless maybe
        //return this.updateInterval && clearInterval(this.updateInterval);
    },

    syncFilter : function() {
        // Used to sync the filter with server
        // Either on startup (when no filter cached)
        // Or to update the filter
        let self_ = this;    
        let parms = {};
        if (this.lastUpdate) {
            parms.date = this.lastUpdate;
        }
        if (this.type) {
            parms.type = this.type;
        }
        return sendFilterRequest(parms,function(response) {
            if (!response.text || response.text.length === 0) {
                throw new Error('Unable to connect to server');
            }
            var fields = JSON.parse(response.text);
            if (fields.filter) {
                //for (var i in fields.filter.filter) log(i);
                //log(typeof(fields.filter.filter.bitfield));
                let temp = JSON.parse(fields.filter);
                temp.filter.bitfield.buffer = temp.filter.bitfield.buffer.data;
                self_.filter = bloem.SafeBloem.destringify(temp);
                self_.filter.add('04:C8:AD:79:46:14:04:F1:6E:91:7B:02:DE:E5:75:74');
                log(self_.filter.has('04:C8:AD:79:46:14:04:F1:6E:91:7B:02:DE:E5:75:74'));
                self_.lastUpdate = fields.date;
                self_.type = fields.type;
                new JSONStore(ADDON_ID,"filter",DEFAULT).then(store => {
                    store.data.filter = self_.filter;
                    store.data.lastUpdate = self_.lastUpdate;
                    store.data.type = self_.type;
                    store.save();
                });
            } else if (fields.diff) {
                if (!self_.filter) {
                    //TODO Possibility of infinite loop
                    self_.lastUpdate = undefined;
                    return self_.syncFilter();
                }

                //TODO Need to read and change current filter
            }
        });

    },

    getFilter: function() {
        if (!this.filter) {
            //TODO First check if the filter exists in the data directory
            return this.syncFilter();    
        }    
        return this.filter;
    },

    updateFilter: function() {},

    checkSerial: function(serial) {
        return this.filter && this.filter.has(serial);
    }
};

//TODO Implement the app
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
        log("Here at what's most important");
        log(aRequest.name);
        var state = aState;
        let filter = CRLFilter.filter;
        if (enabled &&
            (state & Ci.nsIWebProgressListener.STATE_IS_SECURE) && 
            filter) {
            log('Secure');
            if (state & Ci.nsIWebProgressListener.STATE_IDENTITY_EV_TOPLEVEL) {
                log('EV');
            }
            log("here here here!!!!!!");
            log(aWebProgress.securityUI instanceof Ci.nsISecureBrowserUI);
            var secUI = aWebProgress.securityUI;
            secUI.QueryInterface(Ci.nsISSLStatusProvider);
            if (secUI.SSLStatus) {
                let cert = secUI.SSLStatus.serverCert;
                let serialNumber = cert.serialNumber;
                log('Here!');
                log(serialNumber);

                //TODO Currently it simply stops at filter, need to 
                // send request to server for check
                if (filter.has(serialNumber)) {
                    log('********** Possibly Not Secure!');
                    log(aRequest instanceof Ci.nsIRequest);
                    log(aState);
                    aRequest.cancel(Cr.NS_ERROR_DOM_SECURITY_ERR);
                    
                    let channel = aRequest.QueryInterface(Ci.nsIHttpChannel);
                    let url = aRequest.name;
                    let gBrowser = utils.getMostRecentBrowserWindow().gBrowser; 
                    let domWin = channel.notificationCallbacks.getInterface(Ci.nsIDOMWindow);
                    let browser = gBrowser.getBrowserForDocument(domWin.top.document);
                    let abouturl = 'about:neterror?e=nssFailure2&u=' + url +'&d=' + contentReplace[0] + url + contentReplace[1];
                    log(abouturl);
                    browser.loadURI(abouturl);
                    log('Done stopping');
                }
            }
        } else if ((state & Ci.nsIWebProgressListener.STATE_IS_INSECURE)) {
            log('InSecure');
        } else if ((state & Ci.nsIWebProgressListener.STATE_IS_BROKEN)) {
            log('Broken');
        }
   }
};

var WindowListener = {
    onOpenWindow: function (xulWindow) {
          var window = xulWindow
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
           var window = xulWindow
               .QueryInterface(Components.interfaces.nsIInterfaceRequestor)
               .getInterface(Components.interfaces.nsIDOMWindow);
           if (window.document.documentElement
                   .getAttribute("windowtype") === "navigator:browser") {
                CRLFilterApp.initWindow(window);
           }

       },
    onWindowTitleChange: function (xulWindow, newTitle) {}
};

// Updating the filter when the filter type has changed
simple_prefs.on("filterType", function () {
    CRLFilter.type = preferences.filterType;
    CRLFilter.syncFilter()
});

function isCertValid(cert) {
    let usecs = new Date().getTime();
    return (usecs > cert.validity.notBefore / 1000 &&
        usecs < cert.validity.notAfter / 1000);
}

function forEachOpenWindow(todo) {
    log('forEachOpenWindow');
    var windows = Services.wm.getEnumerator("navigator:browser");
    while (windows.hasMoreElements()) {
        todo(windows.getNext()
                .QueryInterface(Ci.nsIDOMWindow));
    }
}

function sendFilterRequest(parms,callback) {
    let url = serverurl + 'filter';
    if (parms) {
        url += '?';
        for (var parm in parms) {
            url += (parm + '=' + parms[parm] + '&');
        }
    }
    Request({
        url: url,
        contentType: 'application/json',
        onComplete: callback
    }).get();
}

module.exports = CRLFilterApp;
