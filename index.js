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
