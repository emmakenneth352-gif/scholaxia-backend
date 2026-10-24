/**
 * plugNmeet live-class launcher for the Scholaxia desktop app.
 *
 * The backend returns `pnm_join_url` for every live-class join/token call when
 * plugNmeet is configured — the website navigates there, so the desktop does the
 * same: the room opens in a dedicated in-app window (see main.js openPnmRoom)
 * instead of leaving the desktop app behind.
 *
 * Must be loaded before teacher.js / live-payment.js / admin.js / app.js.
 */
(function () {
  function launchPnmRoom(joinUrl) {
    var url = String(joinUrl || "").trim();
    if (!url) return false;
    if (window.scholaxiaDesktop && typeof window.scholaxiaDesktop.openPnmRoom === "function") {
      try {
        window.scholaxiaDesktop.openPnmRoom(url);
        return true;
      } catch (e) {
        console.error("launchPnmRoom failed", e);
      }
    }
    // Not running inside Electron (e.g. the same renderer served from the site) —
    // normal behave like the website: navigate to the room.
    try { window.location.href = url; } catch (e2) { window.open(url, "_blank", "noopener"); }
    return true;
  }

  window.launchPnmRoom = launchPnmRoom;
})();
