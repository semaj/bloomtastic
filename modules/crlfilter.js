"use strict";

const {Cc,Ci,Cu,Cr} = require("chrome");
const {pathFor,platform} = require('sdk/system');
const {XMLHttpRequest} = require("sdk/net/xhr");
const { ActionButton } = require("sdk/ui/button/action");
Cu.import("resource://gre/modules/XPCOMUtils.jsm", this);
Cu.import("resource://gre/modules/Services.jsm");

const self = require('sdk/self'),
      simple_prefs = require('sdk/simple-prefs'),
      Request = require('sdk/request').Request,
      bloom = require('bloom-filter'),
      sha1 = require('sha1'),
      tabs = require('sdk/tabs'),
      pako = require('pako'),
      ui = require('sdk/ui'),
      preferences = simple_prefs.prefs,
      STATE_START = Ci.nsIWebProgressListener.STATE_START,
      STATE_STOP = Ci.nsIWebProgressListener.STATE_STOP,
      error = console.error.bind(console),
      info = console.log.bind(console);
const ADDON_ID = self.id,
      JSONStore = require('./jsonstore'),
      DEFAULT = {},
      SERVER_URL = 'https://revocations.ccs.neu.edu',
      TODAYS_FILTER = '/todays-filter/',
      TODAYS_META = '/todays-meta/',
      TODAYS_DIFF = '/todays-diff/',
      LOCKED_IMG = './ssl-most-wanted-locked-16.png',
      UNLOCKED_IMG = './ssl-most-wanted-unlocked-16.png';


var currentHost;
// Main logic handling of filters and revocation checking
var CRLFilter = {
  filter : undefined,
  lastUpdate: undefined,
  filterID: undefined,
  toBlacklist: undefined,
  blacklist: [],

  getStore: function(callback) {
    return new JSONStore(ADDON_ID, 'filter', DEFAULT).then(callback)
      .catch(function(error) {
        error(error.message);
        error(error.stack);
      });
  },

  init: function() {
    // Initiate filter if not already done
    // Load it from data folder, else sync with server
    let that = this;
    this.getStore((store) => {
      info("initializing store.");
      if (store.data.filterData !== undefined) {
        that.filter = getFilter(store.data.filterData);
      }
      that.lastUpdate = store.data.lastUpdate;
      that.filterID = store.data.filterID;
      if (store.data.blacklist !== undefined) {
        that.blacklist = store.data.blacklist;
      }

      if (store.data.filterSize !== undefined) {
        preference.filterSize = store.data.filterSize;
      }

      if (store.data.debug !== undefined) {
        preferences.debug = store.data.debug;
      }

      if (store.data.filterData === undefined) {
        info("we have no filter stored. get a fresh one");
        that.syncFilter((store) => {
          info("Done getting filter");
        });
        that.syncMeta((store) => {
          info("Done getting meta");
        });
      } else {
        info("we have a filter. possibly updating.");
        that.updateFilter();
      }
    });
  },

  uninit: function() {
    let that = this;
    this.getStore((store) => {
      store.data.blacklist = that.blacklist;
      store.data.filterSize = preferences.filterSize;
      store.data.debug = preferences.debug;
      store.flush().then(() => info("uninit done"));
    });
  },

  syncMeta : function(callback = ()=>{}) {
    let that = this;
    Request({
      url: SERVER_URL + TODAYS_META + preferences.filterSize,
      onComplete: (response) => {
        if (response.status == 0 || response.status >= 300) {
          error("Meta sync error: " + response.text);
        } else {
          let body = response.json;
          that.lastUpdate = Date.now;
          that.filterID = body.primary_id;
          that.getStore((store) => {
            store.data.lastUpdate = that.lastUpdate;
            store.data.filterID = that.filterID;
            store.save();
            callback(store);
          });
        }
      }
    }).get();
  },

  syncFilter : function(callback = ()=>{}) {
    let that = this;
    let oReq = new XMLHttpRequest();
    oReq.open("GET", SERVER_URL + TODAYS_FILTER + preferences.filterSize, true);
    oReq.responseType = 'arraybuffer';

    oReq.onload = function (oEvent) {
      try {
        let arrayBuffer = this.response; // Note: not oReq.responseText
        if (arrayBuffer) {
          let filterData = new Uint8Array(arrayBuffer);
          filterData = pako.inflate(filterData);
          that.filter = getFilter(filterData);
          info("CHECKING SANITY");
          info("sane?: " + !that.filter.contains("help"));
          info("sane?: " + that.filter.contains("fdc40d42b9b61fef02f6453d7a42d1cf4cf6956b"));
          that.getStore((store) => {
            store.data.filterData = filterData;
            store.save();
            callback(store);
          });
        } else {
          error("GET filter error");
        }
      } catch (e) {
        error(e);
      }
    };
    oReq.send(null);
  },

  updateFilter: function() {
    let currentID = this.filterID;
    let that = this;
    this.syncMeta((store) => {
      if (store.data.filterID > currentID) {
        that.syncFilter((_) => {
          info("Just updated the filter by downloading a new one.");
        });
      } else {
        let oReq = new XMLHttpRequest();
        oReq.open("GET", SERVER_URL + TODAYS_DIFF + preferences.filterSize
            + "?current_id=" + currentID, true);
        oReq.responseType = 'arraybuffer';

        oReq.onload = function (oEvent) {
          let arrayBuffer = this.response; // Note: not oReq.responseText
          if (arrayBuffer) {
            let diffData = new Uint8Array(arrayBuffer);
            diffData = pako.inflate(diffData);
            let filterData = applyDiff(that.filter, diffData);
            that.filter = filterData;
            info("UPDATE CHECKING SANITY");
            info("sane?: " + !that.filter.contains("help"));
            that.getStore((store) => {
              store.data.filterData = filterData;
              store.save();
              callback(store);
            });
          } else {
            error("GET diff error");
          }
        };
        oReq.send(null);
      }
    });
  },

  checkIdentifier: function(identifier) {
    let r = this.filter.contains(identifier);
    info("is " + identifier + " there? " + r);
    return r;
  },
};

//Implement the app
var CRLFilterApp = {
  prefs: null,

  extensionStartup: function (firstRun, reinstall) {
    forEachOpenWindow(CRLFilterApp.initWindow);
    Services.wm.addListener(WindowListener);

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
      info("Here at start");
    }
    if (aFlag & STATE_STOP) {
      // This fires when the load finishes
      info("Here at end");
    }
  },

  onLocationChange: function(aProgress, aRequest, aURI) {
    // This fires when the location bar changes; that is load event is confirmed
    // or when the user switches tabs. If you use ProgressListener for more than one tab/window,
    // use aProgress.DOMWindow to obtain the tab/window which triggered the change.

    // this is a disgusting global variable holding the current host
    currentHost = aURI.host;
    info("At location change");
    if (CRLFilter.blacklist.includes(aURI.host) && preferences.debug === true) {
      Button.icon = LOCKED_IMG;
    } else {
      Button.icon = UNLOCKED_IMG;
    }
    info(aURI);
  },

  // For definitions of the remaining functions see related documentation
  onProgressChange: function(aWebProgress, aRequest, curSelf, maxSelf, curTot, maxTot) { info("progress changed");},

  onStatusChange: function(aWebProgress, aRequest, aStatus, aMessage) {
    info("status changed with status " + aStatus + " and message: " + aMessage);
  },

  onSecurityChange: function(aWebProgress, aRequest, aState) {
    let that = this;
    info("onSecurityChange");
    try {
      info("web progress " + aWebProgress);
      let state = aState;
      let filter = CRLFilter.filter;
      if ((state & Ci.nsIWebProgressListener.STATE_IS_SECURE) &&
          CRLFilter.filter) {
        info('Secure');
        if (state & Ci.nsIWebProgressListener.STATE_IDENTITY_EV_TOPLEVEL) {
          info('EV');
        }
        let win = getWinFromProgress(aWebProgress);
        let secUI = win.gBrowser.securityUI;
        let status = secUI.SSLStatus;
        if (status) {
          try {
            let cert = status.serverCert;
            let chain = cert.getChain();
            CRLFilter.toBlacklist = false;
            for (var i = 0; i < chain.length; i++) {
              let currCert = chain.queryElementAt(i, Ci.nsIX509Cert);
              let serialNumber = currCert.serialNumber;
              let asn1Tree = Cc["@mozilla.org/security/nsASN1Tree;1"].createInstance(Ci.nsIASN1Tree);
              asn1Tree.loadASN1Structure(currCert.ASN1Structure);
              let crlURL, ocspURL;
              let j = 0;
              while (true) {
                try {
                  var certLine = asn1Tree.getDisplayData(j);
                } catch (err) {
                  break;
                }
                let crlUrls = certLine.match(/http.*\.crl/g);
                if (crlUrls && crlUrls.length > 0) {
                  crlURL = crlUrls.sort()[0];
                  info("CRL");
                  info(crlURL);
                  break;
                }
                let ocsp = certLine.match(/OCSP: URI: (http.*)\n/)
                if (ocsp) {
                  ocspURL = ocsp[1];
                  info("OCSP");
                  info(ocspURL);
                }
                j++;
              }
              let identifier;
              if (crlURL) {
                identifier = sha1((sha1(crlURL + '\n') + serialNumber));
              } else if (ocspURL) {
                identifier = sha1((sha1(ocspURL + '\n') + serialNumber));
              } else {
                error("We have no identifier! aborting");
                break;
              }
              info("IDENTIFIER!: " + identifier);
              if (!CRLFilter.toBlacklist) {
                CRLFilter.toBlacklist = {};
                CRLFilter.toBlacklist.id = identifier;
                CRLFilter.toBlacklist.host = currentHost;
              }
              if (CRLFilter.checkIdentifier(identifier)) {
                info('********** Possibly Not Secure!');
                let channel = aRequest.QueryInterface(Ci.nsIHttpChannel);
                let url = aRequest.name;
                let gBrowser = win.gBrowser;
                let domWin = channel.notificationCallbacks.getInterface(Ci.nsIDOMWindow);
                var browser = gBrowser.getBrowserForDocument(domWin.top.document);
                var abouturl = revokedErrorURL(url);
                isRevoked(identifier, (response) => {
                  let body = response.json;
                  info('Checking with server');
                  if (preferences.debug || body['is-revoked'] === true)
                  {
                    info('it is indeed revoked (or debug is on and we added it)');
                    info(abouturl);
                    browser.loadURIWithFlags(abouturl, 2048);
                    Button.icon = LOCKED_IMG;
                    CRLFilter.blacklist.push(currentHost);
                    info('Done forbidding.');
                  } else {
                    info('On second thought, it is not really revoked.');
                  }
                });
              }
            }
          } catch(e) {
            error("Cert checking exception: " + e);
          }
        } else {
          error("no secUI SSLStatus");
        }
      } else if ((state & Ci.nsIWebProgressListener.STATE_IS_INSECURE)) {
        error('InSecure');
      } else if ((state & Ci.nsIWebProgressListener.STATE_IS_BROKEN)) {
        error('Broken');
      } else {
        error("Filter is undefined, CRLFilter is disabled, or we are in a weird state.");
      }
    } catch(err) {
      error('ERROR: ' + err);
    } finally {
      info('Done:onSecurityChange');
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

const Button = ActionButton({
  id: "blacklist",
  label: "SSL Most Wanted: Blacklist",
  icon: UNLOCKED_IMG,
  onClick: function(state) {
    if (preferences.debug === true) {
      info("Inserting " + CRLFilter.toBlacklist.id);
      CRLFilter.filter.insert(CRLFilter.toBlacklist.id);
      CRLFilter.blacklist.push(CRLFilter.toBlacklist.host);
      CRLFilter.toBlacklist = false;
      this.icon = LOCKED_IMG;
    } else {
      info("Please enable DEBUG mode if you'd like to insert the current site into the filter");
    }
  }
});

// Updating the filter when the filter type has changed
simple_prefs.on("filterSize", function () {
  info('Changing filter type');
  CRLFilter.filterSize = preferences.filterSize;
  CRLFilter.syncFilter();
});

simple_prefs.on("freshFilter", function() {
  CRLFilter.syncFilter();
});

function getWinFromProgress(progress) {
  return progress.DOMWindow.QueryInterface(Ci.nsIInterfaceRequestor)
    .getInterface(Ci.nsIWebNavigation)
    .QueryInterface(Ci.nsIDocShellTreeItem)
    .rootTreeItem
    .QueryInterface(Ci.nsIInterfaceRequestor)
    .getInterface(Ci.nsIDOMWindow);
}

function forEachOpenWindow(todo) {
  info('forEachOpenWindow');
  let windows = Services.wm.getEnumerator("navigator:browser");
  while (windows.hasMoreElements()) {
    todo(windows.getNext()
         .QueryInterface(Ci.nsIDOMWindow));
  }
}

function getFilterSize() {
  let filterSizeName = preferences.filterSize;
  if (filterSizeName === "small") {
    return 1000;
  } else if (filterSizeName === "medium") {
    return 100000;
  } else {
    return 10000000;
  }
}

function getFilter(filterData) {
  let b = bloom.create(getFilterSize(), 0.001);
  b.vData = filterData;
  return b;
}

function padLeft(n, str){
  var diff = n - str.length;
  for (var i = 0; i < diff; i++) {
    str = "0" + str;
  }
  return str;
}

function bin_to_i(s) {
  function help(x, acc) {
    if (x.length == 0) {
      return acc;
    }
    return help(x.slice(1), 2 * acc + parseInt(x[0]));
  }
  return help(s, 0);
}

function applyDiff(oldFilter, update) {
  var newFilter = new Buffer(oldFilter.length);
  assert(oldFilter.length === update.length);
  for (var i = 0; i < oldFilter.length; i++) {
    var old_i = padLeft(8, oldFilter[i].toString(2));
    var diff_i = padLeft(8, update[i].toString(2));
    var new_value = "";
    for (var j = 0; j < old_i.length; j++) {
      if (diff_i[j] === "1") {
        new_value += (old_i[j] === "0" ? "1" : "0"); // flip the bit!
      } else {
        new_value += old_i[j];
      }
    }
    newFilter[i] = bin_to_i(new_value));
  }
  return newFilter;
}

function revokedErrorURL(url) {
  let location = 'about:neterror?e=nssFailure2&u=';
  let e = encodeURIComponent;
  location += e(url);
  location += '&d='
  location += e("An error occurred during your connection to " + url);
  location += e(". Peer's certificate has been revoked. ");
  location += e("(Error code: sec_error_revoked_certificate) ")
  location += e("This error brought to you by the SSL Most Wanted add-on.")
  return location;
}

function isRevoked(identifier, callback = ()=>{}) {
  Request({
    url: SERVER_URL + '/is-revoked/' + identifier,
    onComplete: callback
  }).get();
}


module.exports = CRLFilterApp;
