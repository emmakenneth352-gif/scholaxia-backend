const { app, BrowserWindow, shell, screen, session, desktopCapturer } = require("electron");
const path = require("path");
const { startDesktopServer, stopDesktopServer } = require("./desktop-server");
let mainWindow;
let appBaseUrl = "";

// Desktop keeps its own design/UI (local renderer). Site features are ported
// into this UI — we do NOT load the website inside the window.
const REMOTE_APP_ORIGIN = "https://scholaxia1.onrender.com";
const LOCAL_START_URL = "index.html";

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

  const startUrl = appBaseUrl ? `${appBaseUrl}/index.html` : LOCAL_START_URL;
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
let keyboardWin = null;

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

// ── Class keyboard floating window ─────────────────────────────────────────
// Subject/language symbol keyboard that can sit next to the plugNmeet room
// window (or the classroom) so the teacher can type Math/Python/Chemistry and
// Igbo/Hausa/Efik/Yoruba characters, then copy them into chat or whiteboard.
function openClassroomKeyboard() {
  if (keyboardWin && !keyboardWin.isDestroyed()) {
    try { keyboardWin.show(); keyboardWin.focus(); } catch (err) { /* ignore */ }
    return;
  }
  try {
    keyboardWin = new BrowserWindow({
      width: 440,
      height: 672,
      minWidth: 360,
      minHeight: 460,
      title: "Scholaxia Class Keyboard",
      backgroundColor: "#0d0a17",
      autoHideMenuBar: true,
      resizable: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    keyboardWin.loadFile(path.join(__dirname, "renderer", "keyboard.html"));
    keyboardWin.on("closed", () => {
      keyboardWin = null;
    });
  } catch (err) {
    console.error("openClassroomKeyboard failed", err);
  }
}

(function registerDesktopBridge() {
  try {
    const { ipcMain } = require("electron");
    ipcMain.on("scholaxia:open-pnm-room", (_ev, joinUrl) => {
      if (typeof joinUrl === "string" && joinUrl) openPnmRoom(joinUrl);
    });
    ipcMain.on("scholaxia:open-classroom-keyboard", () => {
      openClassroomKeyboard();
    });
    ipcMain.on("scholaxia:open-external", (_ev, target) => {
      if (typeof target === "string" && /^https?:/i.test(target)) {
        try { shell.openExternal(target); } catch (e) { console.error(e); }
      }
    });
    ipcMain.on("scholaxia:get-version", (ev) => {
      try { ev.returnValue = app.getVersion(); } catch (err) { ev.returnValue = ""; }
    });
    ipcMain.handle("scholaxia:download-update", (ev, downloadUrl, versionHint) =>
      startUpdateDownload(downloadUrl, ev.sender, versionHint)
    );
    ipcMain.on("scholaxia:run-installer", (_ev, filePath) => {
      runInstallerFile(filePath);
    });
  } catch (e) {
    console.error("Could not register desktop bridge", e);
  }
})();

// ── In-app update download + install ─────────────────────────────────────────
// Downloads the new Setup exe inside the app (with progress) and launches it,
// so updates no longer depend on the browser's download list.
const UPDATE_TMP_PREFIX = "Scholaxia-Student-Setup-";

function updateTmpPath(versionHint) {
  const safe =
    String(versionHint || "latest").replace(/[^0-9a-zA-Z._-]/g, "").slice(0, 32) || "latest";
  return path.join(app.getPath("temp"), `${UPDATE_TMP_PREFIX}${safe}.exe`);
}

function sendUpdateProgress(sender, received, total) {
  try {
    if (!sender || sender.isDestroyed()) return;
    const percent = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : -1;
    sender.send("scholaxia:update-progress", { received, total, percent });
  } catch (err) { /* window gone — download continues */ }
}

function startUpdateDownload(downloadUrl, sender, versionHint) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    try {
      const u = new URL(String(downloadUrl || ""));
      if (u.protocol !== "https:" || !/\.exe(\?|#|$)/i.test(u.pathname)) {
        done({ ok: false, error: "That update link looks invalid. Please try again." });
        return;
      }
      const { net: electronNet } = require("electron");
      const fs = require("fs");
      const dest = updateTmpPath(versionHint);
      // Fixed temp name: repeat downloads overwrite instead of piling up copies.
      try { if (fs.existsSync(dest)) fs.unlinkSync(dest); } catch (err) { /* overwrite */ }
      const req = electronNet.request({ method: "GET", url: u.toString(), redirect: "follow" });
      req.on("error", () => done({ ok: false, error: "Download failed. Check your connection and try again." }));
      req.on("response", (res) => {
        if (res.statusCode !== 200) {
          try { req.abort(); } catch (err) { /* ignore */ }
          done({ ok: false, error: "Update server answered " + res.statusCode + ". Try again in a few minutes." });
          return;
        }
        const total = Number(res.headers["content-length"] || 0) || 0;
        let received = 0;
        let lastSent = 0;
        const out = fs.createWriteStream(dest);
        const fail = (msg) => {
          try { req.abort(); } catch (err) { /* ignore */ }
          try { out.destroy(); } catch (err) { /* ignore */ }
          try { if (fs.existsSync(dest)) fs.unlinkSync(dest); } catch (err) { /* ignore */ }
          done({ ok: false, error: msg });
        };
        out.on("error", () => fail("Could not save the update file. Free some space and try again."));
        res.on("data", (chunk) => {
          received += chunk.length;
          const now = Date.now();
          if (now - lastSent > 300) {
            lastSent = now;
            sendUpdateProgress(sender, received, total);
          }
        });
        res.on("error", () => fail("Download interrupted. Try again."));
        // Wait for the FILE to finish flushing (not just the last network
        // chunk) before reporting success — otherwise the launched Setup
        // can be truncated/corrupt.
        out.on("finish", () => {
          sendUpdateProgress(sender, received, total);
          if (total > 0 && received !== total) {
            fail("Download incomplete (" + received + " of " + total + " bytes). Try again.");
            return;
          }
          if (received < 1024 * 1024) {
            fail("Downloaded file looks too small to be the installer. Try again.");
            return;
          }
          done({ ok: true, path: dest, size: received });
        });
        res.pipe(out);
      });
      req.end();
    } catch (err) {
      done({ ok: false, error: "Could not start the download. Try again." });
    }
  });
}

function runInstallerFile(filePath) {
  try {
    const p = String(filePath || "");
    const expectedDir = app.getPath("temp");
    const base = path.basename(p);
    // Only ever launch update files this app downloaded itself.
    if (!p || path.dirname(p) !== expectedDir || !base.startsWith(UPDATE_TMP_PREFIX) || !base.toLowerCase().endsWith(".exe")) {
      return;
    }
    const { shell: electronShell } = require("electron");
    electronShell.openPath(p);
  } catch (err) {
    console.error("runInstallerFile failed", err);
  }
}

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
