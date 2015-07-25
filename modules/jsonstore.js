const {Cc,Ci,Cu,Cr} = require("chrome");
Cu.import("resource://gre/modules/osfile.jsm");
Cu.import("resource://gre/modules/AddonManager.jsm");
Cu.import("resource://gre/modules/Task.jsm");
Cu.import("resource://gre/modules/DeferredSave.jsm");

/**
 * Handles the asynchronous reading and writing of add-on-specific JSON
 * data files.
 *
 * @param {string} The basename of the file.
 * @param {object} A JSON-compatible object which will be used in place
 *      of the file's data, if the file does not already exist.
 *      @optional
 *
 * @return {Promise<JSONStore>}
 */
function JSONStore(ADDON_ID, name, default_={}) {
    return Task.spawn(function* () {
        // Determine the correct path for the file.
        let addon = yield new Promise(accept =>
            AddonManager.getAddonByID(ADDON_ID, accept));
        let dir = yield new Promise(accept =>
            addon.getDataDirectory(accept));
        this.path = OS.Path.join(dir, name + ".json");

        // Read the file's contents, or fall back to defaults.
        try {
            this.data = JSON.parse(
                yield OS.File.read(this.path,
                                   { encoding: "utf-8" }));
        }
        catch (e if e.becauseNoSuchFile) {
            this.data = JSON.parse(JSON.stringify(default_));
        }

        // Create a saver to write our JSON-stringified data to our
        // path, at 1000ms minimum intervals.
        this.saver = new DeferredSave(this.path,
                                      () => JSON.stringify(this.data),
                                      1000);

        return this;
    }.bind(this));
}
/**
 * Immediately save the data to disk.
 *
 * @return {Promise} A promise which resolves when the file's contents
 * have been written.
 */
JSONStore.prototype.flush = function () {
    return this.saver.flush();
};
/**
 * Queue a save operation. The operation will commence after a full
 * second has passed without further calls to this method.
 *
 * @return {Promise} A promise which resolves when the file's contents
 * have been written.
 */
JSONStore.prototype.save = function () {
    return this.saver.saveChanges();
};

module.exports = JSONStore;
