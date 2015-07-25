"use strict";

/*
const {Cc,Ci,Cu,Cr} = require("chrome");
const {pathFor,platform} = require('sdk/system');
Cu.import("resource://gre/modules/XPCOMUtils.jsm", this);
Cu.import("resource://gre/modules/Services.jsm");
*/

var CRLFilterApp = require('./modules/crlfilter');

exports.main = function() {
    CRLFilterApp.extensionStartup();    
};

exports.onUnload = function() {
    CRLFilterApp.extensionShutdown();    
};

// a dummy function, to show how tests work.
// to see how to test this function, look at test/test-index.js
function dummy(text, callback) {
  callback(text);
}

exports.dummy = dummy;
