/* Desktop update check — asks the backend which desktop version is current.
   If the installed app is older, shows a banner with a download link. */
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

  function bannerHtml(msg, url) {
    return (
      '<div id="desktop-update-banner" role="alert" style="' +
      "position:fixed;left:0;right:0;bottom:0;z-index:9999;display:flex;gap:12px;" +
      "align-items:center;justify-content:center;flex-wrap:wrap;padding:12px 16px;" +
      "background:#5b21b6;color:#fff;font-size:0.95rem;box-shadow:0 -4px 14px rgba(0,0,0,.35);\">" +
      "<span>⬆️ " + esc(msg) + "</span>" +
      '<a href="' + esc(url) + '" target="_blank" rel="noopener" style="' +
      "color:#fff;background:#8b5cf6;padding:6px 14px;border-radius:8px;" +
      'text-decoration:none;font-weight:600;">Download update</a>' +
      '<button type="button" id="desktop-update-dismiss" style="' +
      "background:none;border:0;color:#e0d7ff;cursor:pointer;font-size:1.1rem;" +
      '">✕</button>' +
      "</div>"
    );
  }

  function esc(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  }

  function showBanner(msg, url, latest) {
    if (document.getElementById("desktop-update-banner")) return;
    var dismissed = false;
    try { dismissed = !!localStorage.getItem(dismissKey(latest)); } catch (e) {}
    if (dismissed) return;
    document.body.insertAdjacentHTML("beforeend", bannerHtml(msg, url));
    var btn = document.getElementById("desktop-update-dismiss");
    if (btn) {
      btn.addEventListener("click", function () {
        try { localStorage.setItem(dismissKey(latest), "1"); } catch (e) {}
        var b = document.getElementById("desktop-update-banner");
        if (b) b.remove();
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
        showBanner(data.desktop_message || "A new version of the Scholaxia desktop app is available.", url, data.desktop_latest_version);
      })
      .catch(function () { /* offline — try next load */ });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", checkOnce);
  } else {
    checkOnce();
  }
})();
