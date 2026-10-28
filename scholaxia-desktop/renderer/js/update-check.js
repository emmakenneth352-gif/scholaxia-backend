/* Desktop update check — asks the backend which desktop version is current.
   If the installed app is older, shows a centered POPUP telling the user to
   download & install the latest update (opens the installer URL in the
   system browser, then the user runs the Setup like before). */
(function () {
  var APP_VERSION =
    (window.scholaxiaDesktop && window.scholaxiaDesktop.appVersion) || "1.0.0";

  function versionLess(a, b) {
    var pa = String(a || "0").split(".").map(Number);
    var pb = String(b || "0").split(".").map(Number);
    for (var i = 0; i < 3; i++) {
      var x = pa[i] || 0;
      var y = pb[i] || 0;
      if (x < y) return true;
      if (x > y) return false;
    }
    return false;
  }

  function dismissKey(v) {
    return "sia_desktop_update_dismissed_" + v;
  }

  function esc(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  }

  function hasInAppUpdater() {
    try {
      return !!(
        window.scholaxiaDesktop &&
        window.scholaxiaDesktop.downloadUpdate &&
        window.scholaxiaDesktop.runInstaller
      );
    } catch (e) {
      return false;
    }
  }

  function popupHtml(msg, url, latest) {
    var inApp = hasInAppUpdater();
    return (
      '<div id="desktop-update-popup" role="dialog" aria-modal="true" style="' +
      "position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;" +
      'background:rgba(0,0,0,.6);">' +
      '<div style="max-width:420px;width:90%;background:#fff;border-radius:16px;padding:26px 24px;' +
      "text-align:center;font-family:inherit;box-shadow:0 12px 40px rgba(0,0,0,.35);\">" +
      '<div style="font-size:44px;line-height:1;">⬆️</div>' +
      '<h2 style="margin:10px 0 6px;font-size:1.15rem;color:#5b21b6;">Update Scholaxia</h2>' +
      '<p style="margin:0 0 4px;color:#111827;font-size:0.95rem;">' + esc(msg) + "</p>" +
      '<p style="margin:0 0 18px;color:#6b7280;font-size:0.8rem;">' +
      "Your version: <strong>" + esc(APP_VERSION) + "</strong> &middot; Latest: <strong>" +
      esc(latest) + "</strong></p>" +
      (inApp
        ? '<p id="desktop-update-status" style="margin:0 0 12px;color:#374151;font-size:0.85rem;">' +
          "Tap below — Scholaxia downloads the update inside the app, then you tap Install.</p>" +
          '<div id="desktop-update-bar-wrap" style="display:none;margin:0 0 12px;background:#ede9fe;border-radius:8px;overflow:hidden;height:10px;">' +
          '<div id="desktop-update-bar" style="width:0%;height:100%;background:#5b21b6;transition:width .25s;"></div></div>' +
          '<p id="desktop-update-pct" style="display:none;margin:0 0 12px;color:#6b7280;font-size:0.8rem;"></p>'
        : '<ol style="margin:0 0 18px;padding-left:20px;color:#374151;font-size:0.82rem;text-align:left;line-height:1.55;">' +
          "<li>Tap <strong>Download latest update</strong> below (a Setup .exe file downloads).</li>" +
          "<li>Open the downloaded <strong>Scholaxia-Student-Setup file</strong> from your browser downloads.</li>" +
          '<li>If Windows says "Windows protected your PC", click <strong>More info</strong> then <strong>Run anyway</strong>.</li>' +
          "<li>Click through the Setup, then reopen Scholaxia from your desktop icon.</li></ol>") +
      '<a id="desktop-update-go" href="' + esc(url) + '" target="_blank" rel="noopener" style="' +
      "display:inline-block;background:#5b21b6;color:#fff;padding:11px 24px;border-radius:10px;" +
      'text-decoration:none;font-weight:700;font-size:0.95rem;">' +
      (inApp ? "Download update" : "Download latest update") + "</a>" +
      '<div><button type="button" id="desktop-update-dismiss" style="' +
      "background:none;border:0;color:#6b7280;cursor:pointer;margin-top:12px;font-size:0.85rem;" +
      '">Maybe later</button></div>' +
      "</div></div>"
    );
  }

  function showPopup(msg, url, latest) {
    if (document.getElementById("desktop-update-popup")) return;
    var dismissed = false;
    try { dismissed = !!localStorage.getItem(dismissKey(latest)); } catch (e) {}
    if (dismissed) return;
    document.body.insertAdjacentHTML("beforeend", popupHtml(msg, url, latest));

    // In-app updater: download inside Electron (progress bar), then launch the
    // installer. Fallback (old builds / plain browser): open the link outside.
    var go = document.getElementById("desktop-update-go");
    if (go) {
      if (hasInAppUpdater()) {
        var started = false;
        if (window.scholaxiaDesktop.onUpdateProgress) {
          window.scholaxiaDesktop.onUpdateProgress(function (info) {
            var wrap = document.getElementById("desktop-update-bar-wrap");
            var bar = document.getElementById("desktop-update-bar");
            var pct = document.getElementById("desktop-update-pct");
            if (!wrap || !bar) return;
            wrap.style.display = "block";
            if (info && info.percent >= 0) {
              bar.style.width = info.percent + "%";
              if (pct) {
                pct.style.display = "block";
                pct.textContent = "Downloading… " + info.percent + "%";
              }
            } else if (pct) {
              pct.style.display = "block";
              pct.textContent = "Downloading…";
            }
          });
        }
        go.addEventListener("click", function (ev) {
          ev.preventDefault();
          if (started) return;
          started = true;
          var status = document.getElementById("desktop-update-status");
          go.textContent = "Downloading…";
          go.style.opacity = "0.6";
          go.style.pointerEvents = "none";
          window.scholaxiaDesktop.downloadUpdate(url, latest).then(function (res) {
            if (!res || !res.ok) {
              started = false;
              go.textContent = "Try download again";
              go.style.opacity = "1";
              go.style.pointerEvents = "auto";
              if (status) status.textContent = (res && res.error) || "Download failed. Try again.";
              return;
            }
            if (status) status.textContent = "Download finished. Tap Install, click through the Setup, then reopen Scholaxia.";
            var bar2 = document.getElementById("desktop-update-bar");
            if (bar2) bar2.style.width = "100%";
            var pct2 = document.getElementById("desktop-update-pct");
            if (pct2) pct2.textContent = "Ready to install";
            go.textContent = "Install now";
            go.style.opacity = "1";
            go.style.pointerEvents = "auto";
            // onclick (not addEventListener): a retry-then-success sequence
            // must not stack duplicate handlers that launch Setup twice.
            go.onclick = function (ev2) {
              ev2.preventDefault();
              ev2.stopImmediatePropagation();
              window.scholaxiaDesktop.runInstaller(res.path);
              if (status) status.textContent = "Setup is opening — follow it, then reopen Scholaxia.";
              go.textContent = "Opening Setup…";
              go.style.pointerEvents = "none";
            };
          });
        });
      } else {
        go.addEventListener("click", function (ev) {
          try {
            ev.preventDefault();
            if (window.scholaxiaDesktop && window.scholaxiaDesktop.openExternal) {
              window.scholaxiaDesktop.openExternal(url);
            } else {
              window.open(url, "_blank", "noopener");
            }
            document.getElementById("desktop-update-popup").remove();
          } catch (e2) { /* fall back to default link behavior */ }
        });
      }
    }
    var btn = document.getElementById("desktop-update-dismiss");
    if (btn) {
      btn.addEventListener("click", function () {
        try { localStorage.setItem(dismissKey(latest), "1"); } catch (e) {}
        var p = document.getElementById("desktop-update-popup");
        if (p) p.remove();
      });
    }
  }

  function checkOnce() {
    var base =
      (typeof API_BASE === "string" && API_BASE) ||
      "https://scholaxia1.onrender.com";
    fetch(base + "/api/v1/app/version", {
      signal: (function () {
        var c = new AbortController();
        setTimeout(function () { try { c.abort(); } catch (e) {} }, 15000);
        return c.signal;
      })(),
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.desktop_latest_version) return;
        if (!versionLess(APP_VERSION, data.desktop_latest_version)) return;
        var url = data.desktop_url || "";
        if (!url) return;
        showPopup(
          data.desktop_message || "A new version of the Scholaxia desktop app is available. Please download and install the latest update.",
          url,
          data.desktop_latest_version
        );
      })
      .catch(function () { /* offline — try next load */ });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", checkOnce);
  } else {
    checkOnce();
  }
})();
