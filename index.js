"use strict";

const {Cc,Ci,Cu,Cr} = require("chrome");
const {pathFor,platform} = require('sdk/system');
Cu.import("resource://gre/modules/XPCOMUtils.jsm", this);
Cu.import("resource://gre/modules/Services.jsm");

const fs = require('sdk/io/fs'),
      path = require('sdk/fs/path'),
      file = require('sdk/io/file'),
      Request = require('sdk/request').Request,
      bloem = require('bloem'),
      Buffer = require('sdk/io/buffer').Buffer,
      STATE_START = Ci.nsIWebProgressListener.STATE_START,
      STATE_STOP = Ci.nsIWebProgressListener.STATE_STOP;

this.log = console.error.bind(console);
var self = require('sdk/self'),
    contentReplace = ["An%20error%20occurred%20during%20a%20connection%20to%20",".%20Peer%27s%20Certificate%20has%20been%20revoked.%20(Error%20code%3A%20sec_error_revoked_certificate)."];   
var enabled = true;



var httpListener = {
    QueryInterface: XPCOMUtils.generateQI(["nsIWebProgressListener",
                            "nsISupportsWeakReference"]),

    onStateChange: function(aWebProgress, aRequest, aFlag, aStatus) {
        // If you use myListener for more than one tab/window, use
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
                          // or when the user switches tabs. If you use myListener for more than one tab/window,
                          // use aProgress.DOMWindow to obtain the tab/window which triggered the change.
                          log("At location change");
                      },

    // For definitions of the remaining functions see related documentation
    onProgressChange: function(aWebProgress, aRequest, curSelf, maxSelf, curTot, maxTot) { log("progress changed");},

    onStatusChange: function(aWebProgress, aRequest, aStatus, aMessage) { 
        log("status changed with status " + aStatus + " and message: " + aMessage);
        let channel = aRequest.QueryInterface(Ci.nsIHttpChannel);
        let domWin = channel.notificationCallbacks.getInterface(Ci.nsIDOMWindow);
        let browser = gBrowser.getBrowserForDocument(domWin.top.document);
},

    onSecurityChange: function(aWebProgress, aRequest, aState) {
        log("Here at what's most important");
        log(aRequest.name);
        var state = aState;
        if ((state & Ci.nsIWebProgressListener.STATE_IS_SECURE && filter && enabled)) {
            log('Secure');
            if (state & Ci.nsIWebProgressListener.STATE_IDENTITY_EV_TOPLEVEL) {
                log('EV');
            }
            log("here here here!!!!!!");
            log(aWebProgress.securityUI instanceof Ci.nsISecureBrowserUI);
            var secUI = aWebProgress.securityUI;
            secUI.QueryInterface(Ci.nsISSLStatusProvider);
            if (secUI.SSLStatus) {
                let serialNumber = secUI.SSLStatus.serverCert.serialNumber;
                log('Here!');
                log(serialNumber);
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

// a dummy function, to show how tests work.
// to see how to test this function, look at test/test-index.js
function dummy(text, callback) {
  callback(text);
}

exports.dummy = dummy;
