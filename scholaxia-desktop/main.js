const { app, BrowserWindow, shell, screen, session, desktopCapturer } = require("electron");
const path = require("path");
const { startDesktopServer, stopDesktopServer } = require("./desktop-server");
let mainWindow;
let appBaseUrl = "";

// Desktop keeps its own design/UI (local renderer). Site features are ported
// into this UI — we do NOT load the website inside the window.
const REMOTE_APP_ORIGIN = "https://scholaxia1.onrender.com";
const LOCAL_START_URL = "app.html";

function isLocalServerUrl(u) {
  return /^https?:\/\/127\.0\.0\.1:17890/i.test(u) || /^https?:\/\/localhost:17890/i.test(u);
}

function getWindowSize() {
  const display = screen.getPrimaryDisplay();
  const { width: sw, height: sh } = display.workAreaSize;
  const width = Math.min(1280, Math.max(900, Math.floor(sw * 0.92)));
  const height = Math.min(860, Math.max(640, Math.floor(sh * 0.9)));
  const minWidth = Math.min(768, width);
  const minHeight = Math.min(600, height);
  return { width, height, minWidth, minHeight };
}

/** Allow mic/camera/screen-share so live class A/V works in Electron. */
function enableLiveClassMediaPermissions() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    const allow = new Set([
      "media",
      "display-capture",
      "fullscreen",
      "notifications",
      "clipboard-sanitized-write",
    ]);
    callback(allow.has(permission));
  });
  ses.setPermissionCheckHandler((_wc, permission) => {
    return (
      permission === "media" ||
      permission === "display-capture" ||
      permission === "fullscreen" ||
      permission === "notifications"
    );
  });
  // Electron 28+: without this, getDisplayMedia / LiveKit screen share often fails.
  try {
    ses.setDisplayMediaRequestHandler(async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ["screen", "window"],
          thumbnailSize: { width: 0, height: 0 },
        });
        if (!sources.length) {
          callback({});
          return;
        }
        callback({ video: sources[0], audio: "loopback" });
      } catch (_e) {
        callback({});
      }
    });
  } catch (_e) {
    /* older Electron without setDisplayMediaRequestHandler */
  }
}

function createWindow() {
  const size = getWindowSize();
  mainWindow = new BrowserWindow({
    width: size.width,
    height: size.height,
    minWidth: size.minWidth,
    minHeight: size.minHeight,
    title: "Scholaxia",
    icon: path.join(__dirname, "assets", "logo.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    autoHideMenuBar: true,
    backgroundColor: "#0d1f14",
    resizable: true,
    fullscreenable: true,
  });

  const startUrl = appBaseUrl ? `${appBaseUrl}/app.html` : LOCAL_START_URL;
  if (appBaseUrl) mainWindow.loadURL(startUrl);
  else mainWindow.loadFile(LOCAL_START_URL);
  if (size.width >= screen.getPrimaryDisplay().workAreaSize.width * 0.95) {
    mainWindow.maximize();
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isLocalServerUrl(url)) {
      mainWindow.loadURL(url);
      return { action: "deny" };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });

  // Keep in-app navigation inside the window (live site or local server).
  mainWindow.webContents.on("will-navigate", (e, url) => {
    const ok = /^https?:\/\/127\.0\.0\.1:17890/i.test(url) ||
      /^https?:\/\/localhost:17890/i.test(url) ||
      /^file:/i.test(url) || url.indexOf("about:") === 0;
    if (!ok) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
}

app.whenReady().then(async () => {
  enableLiveClassMediaPermissions();
  try {
    appBaseUrl = await startDesktopServer();
  } catch (err) {
    console.error("Desktop server failed, falling back to file://", err);
    appBaseUrl = "";
  }
  createWindow();
  watchForNewInstall();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// ── plugNmeet classroom window ─────────────────────────────────────────────
// The site joins live classes with a plugNmeet room; on the desktop we open the
// SAME room in a dedicated window (mic/camera/screen-share permission handlers
// above already cover every window via session.defaultSession). When the
// meeting is ended plugNmeet redirects to the Scholaxia app — we close the
// classroom window there so the student lands back in the app.
const PNM_HOST_RE = /(^|\.)plugnmeet\.(cloud|in)$/i;
let pnmRoomWin = null;

function openPnmRoom(joinUrl) {
  try {
    const url = new URL(joinUrl);
    if (!/^https?:$/.test(url.protocol)) return;
    if (pnmRoomWin && !pnmRoomWin.isDestroyed()) {
      // Repeated "Enter live" clicks while a room is already open must not
      // spawn multiple windows/tokens — reload and focus the existing window.
      try { pnmRoomWin.loadURL(joinUrl); } catch (err) { /* ignore */ }
      pnmRoomWin.show();
      pnmRoomWin.focus();
      return;
    }
    const roomWin = new BrowserWindow({
      width: 1280,
      height: 800,
      minWidth: 800,
      minHeight: 560,
      title: "Scholaxia Live Class",
      backgroundColor: "#111827",
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    pnmRoomWin = roomWin;
    roomWin.loadURL(joinUrl);
    roomWin.webContents.on("will-navigate", (_e, next) => {
      // plugNmeet ended the meeting → logout_url redirect: close and return.
      if (typeof next === "string" && !PNM_HOST_RE.test(new URL(next).hostname.split("@").pop() || "")) {
        try { roomWin.close(); } catch (err) { /* ignore */ }
      }
    });
    roomWin.webContents.setWindowOpenHandler(({ url: target }) => {
      shell.openExternal(target);
      return { action: "deny" };
    });
    roomWin.on("closed", () => {
      // Meeting ended (or window closed): bring the Scholaxia window —
      // the screen the class was hosted from — back in front.
      if (pnmRoomWin === roomWin) pnmRoomWin = null;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.focus();
        try { mainWindow.webContents.send("scholaxia:pnm-room-closed"); } catch (err) { /* ignore */ }
      }
    });
  } catch (err) {
    console.error("openPnmRoom failed", err);
    shell.openExternal(String(joinUrl));
  }
}

(function registerDesktopBridge() {
  try {
    const { ipcMain } = require("electron");
    ipcMain.on("scholaxia:open-pnm-room", (_ev, joinUrl) => {
      if (typeof joinUrl === "string" && joinUrl) openPnmRoom(joinUrl);
    });
    ipcMain.on("scholaxia:open-external", (_ev, target) => {
      if (typeof target === "string" && /^https?:/i.test(target)) {
        try { shell.openExternal(target); } catch (e) { console.error(e); }
      }
    });
    ipcMain.on("scholaxia:get-version", (ev) => {
      try { ev.returnValue = app.getVersion(); } catch (err) { ev.returnValue = ""; }
    });
  } catch (e) {
    console.error("Could not register desktop bridge", e);
  }
})();

function watchForNewInstall() {
  // Nudge already-installing users: once the new Setup runs, the old
  // installed copy is replaced and old versions keep working until then.
  const exe = process.execPath || "";
  console.log("[Scholaxia] desktop running version", app.getVersion(), "from", exe);
}

app.on("before-quit", () => {
  stopDesktopServer();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
