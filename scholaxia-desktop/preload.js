const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("scholaxia", {
  platform: process.platform,
});

// Desktop bridge used by the renderer:
//  - scholaxiaDesktop.appVersion       → real installer version (update check)
//  - scholaxiaDesktop.openPnmRoom(url) → opens a live-class plugNmeet room in a
//    dedicated window (mic/camera/screen-share already allowed in main.js).
//  - scholaxiaDesktop.onPnmRoomClosed(cb) → fires when the live-class window
//    closes (meeting ended) so the page can refresh/return to the class list.
contextBridge.exposeInMainWorld("scholaxiaDesktop", {
  appVersion: (function () {
    try {
      return ipcRenderer.sendSync("scholaxia:get-version") || "";
    } catch (e) {
      return "";
    }
  })(),
  openPnmRoom: function (joinUrl) {
    try {
      ipcRenderer.send("scholaxia:open-pnm-room", String(joinUrl || ""));
    } catch (e) {
      console.error("openPnmRoom failed", e);
    }
  },
  openClassroomKeyboard: function () {
    try {
      ipcRenderer.send("scholaxia:open-classroom-keyboard");
    } catch (e) {
      console.error("openClassroomKeyboard failed", e);
    }
  },
  openExternal: function (target) {
    try {
      ipcRenderer.send("scholaxia:open-external", String(target || ""));
    } catch (e) {
      console.error("openExternal failed", e);
    }
  },
  onPnmRoomClosed: function (cb) {
    try {
      if (typeof cb === "function")
        ipcRenderer.on("scholaxia:pnm-room-closed", function () { try { cb(); } catch (e) { /* ignore */ } });
    } catch (e) { /* ignore */ }
  },
});
