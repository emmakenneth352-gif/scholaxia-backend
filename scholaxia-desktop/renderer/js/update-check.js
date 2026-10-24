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

  function popupHtml(msg, url, latest) {
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
      '<a id="desktop-update-go" href="' + esc(url) + '" target="_blank" rel="noopener" style="' +
      "display:inline-block;background:#5b21b6;color:#fff;padding:11px 24px;border-radius:10px;" +
      'text-decoration:none;font-weight:700;font-size:0.95rem;">Download latest update</a>' +
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

    // Opening the link must go through the system browser — the popup is an
    // in-app window so target=_blank alone can be blocked by Electron.
    var go = document.getElementById("desktop-update-go");
    if (go) {
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
