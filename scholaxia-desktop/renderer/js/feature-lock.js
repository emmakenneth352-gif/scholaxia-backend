/**
 * Admin-controlled feature locks for the desktop app (student + teacher).
 *
 * The admin panel at /admin/ → Feature Access stores one switch per feature.
 * This script reads the public lock list and lets a screen ask
 * "is this feature locked?" — a locked feature opens a maintenance card
 * ("Under maintenance — we will update you soon") instead of the page.
 */
(function (global) {
  "use strict";

  var DEFAULT_MESSAGE = "Under maintenance - we will update you soon.";
  var CACHE_KEY = "sx_feature_access_desktop_v1";
  var CACHE_TTL = 20000;
  var REFRESH_EVERY = 60000;

  var state = {
    locks: {},
    labels: {},
    defaultMessage: DEFAULT_MESSAGE,
    loaded: false,
    fetchedAt: 0,
    promise: null,
  };

  // page id in this app -> feature key in the admin catalog
  var PAGE_KEYS = {
    dashboard: "student.home",
    home: "student.home",
    "study-materials": "student.study-materials",
    "past-questions": "student.past-questions",
    cbt: "student.cbt",
    "school-portal": "student.school-portal",
    school: "student.school",
    live: null, // portal dependent - resolved in keyForPage
    subscription: "student.subscription",
    skills: "student.skills",
    library: "student.library",
    games: "student.games",
    assignments: "student.assignments",
    community: "student.community",
    groups: "student.groups",
    about: "student.about",
    contact: "student.contact",
    profile: "student.profile",
    affiliate: "student.affiliate",
    "voice-classroom": "student.sia",
    materials: "teacher.materials",
    exams: "teacher.exams",
    students: "teacher.students",
    ai: "teacher.ai",
  };

  function isTeacherPortal() {
    return /teacher\.html$/i.test((global.location && location.pathname) || "");
  }

  function portalPrefix() {
    return isTeacherPortal() ? "teacher." : "student.";
  }

  function keyForPage(page) {
    if (!page) return "";
    if (PAGE_KEYS[page]) return PAGE_KEYS[page];
    if (page === "live") return portalPrefix() + "live";
    return portalPrefix() + page;
  }

  function apiBase() {
    try {
      if (typeof global.API_BASE === "string" && global.API_BASE) {
        return global.API_BASE.replace(/\/$/, "");
      }
      if (global.SCHOLAXIA_API_BASE) {
        return String(global.SCHOLAXIA_API_BASE).replace(/\/$/, "");
      }
    } catch (e) { /* ignore */ }
    return "https://scholaxia1.onrender.com";
  }

  function readCache() {
    try {
      var raw = global.sessionStorage && sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var saved = JSON.parse(raw);
      if (!saved || !saved.at || Date.now() - saved.at > CACHE_TTL) return null;
      return saved;
    } catch (e) {
      return null;
    }
  }

  function writeCache() {
    try {
      if (!global.sessionStorage) return;
      sessionStorage.setItem(
        CACHE_KEY,
        JSON.stringify({
          at: Date.now(),
          locks: state.locks,
          labels: state.labels,
          defaultMessage: state.defaultMessage,
        })
      );
    } catch (e) { /* ignore */ }
  }

  function applyPayload(data) {
    var locks = (data && data.locks) || {};
    var labels = {};
    ((data && data.features) || []).forEach(function (f) {
      if (f && f.key && f.label) labels[f.key] = f.label;
    });
    var clean = {};
    Object.keys(locks).forEach(function (key) {
      var item = locks[key] || {};
      clean[key] = {
        message: String(item.message || "").trim() || DEFAULT_MESSAGE,
      };
    });
    state.locks = clean;
    state.labels = labels;
    state.defaultMessage =
      String((data && data.default_message) || "").trim() || DEFAULT_MESSAGE;
    state.loaded = true;
    state.fetchedAt = Date.now();
    writeCache();
    decorateNavigation();
  }

  function load(force) {
    if (!force && state.loaded && Date.now() - state.fetchedAt < CACHE_TTL) {
      return Promise.resolve(state);
    }
    if (state.promise && !force) return state.promise;

    if (!force) {
      var cached = readCache();
      if (cached) {
        state.locks = cached.locks || {};
        state.labels = cached.labels || {};
        state.defaultMessage = cached.defaultMessage || DEFAULT_MESSAGE;
        state.loaded = true;
        state.fetchedAt = cached.at || Date.now();
        decorateNavigation();
        return Promise.resolve(state);
      }
    }

    state.promise = fetch(apiBase() + "/api/v1/feature-access", {
      headers: { Accept: "application/json" },
    })
      .then(function (res) {
        if (!res.ok) throw new Error("feature access failed");
        return res.json();
      })
      .then(function (data) {
        applyPayload(data);
        return state;
      })
      .catch(function () {
        // Never lock learners out because the network hiccuped.
        state.loaded = true;
        state.fetchedAt = Date.now();
        return state;
      })
      .then(function (result) {
        state.promise = null;
        return result;
      });

    return state.promise;
  }

  function isLocked(key) {
    return !!(key && state.locks[key]);
  }

  function messageFor(key) {
    var item = key && state.locks[key];
    return (item && item.message) || state.defaultMessage;
  }

  function labelFor(key) {
    if (state.labels[key]) return state.labels[key];
    var parts = String(key || "").split(".");
    var raw = parts.length > 1 ? parts.slice(1).join(".") : parts[0] || "This feature";
    return raw.replace(/[-_]+/g, " ").replace(/\b\w/g, function (c) {
      return c.toUpperCase();
    });
  }

  function injectStyles() {
    if (document.getElementById("sx-fl-css")) return;
    var style = document.createElement("style");
    style.id = "sx-fl-css";
    style.textContent = [
      ".sx-fl-overlay{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:24px;",
      "background:rgba(15,23,42,.62);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);}",
      ".sx-fl-overlay[hidden]{display:none!important;}",
      ".sx-fl-card{width:min(460px,100%);background:#fff;border-radius:22px;padding:28px 26px;text-align:center;",
      "box-shadow:0 30px 70px rgba(15,23,42,.4);font-family:inherit;}",
      ".sx-fl-icon{width:64px;height:64px;margin:0 auto 14px;border-radius:18px;display:grid;place-items:center;font-size:28px;",
      "background:linear-gradient(145deg,#7c3aed,#4f46e5);color:#fff;}",
      ".sx-fl-kicker{display:inline-block;margin:0 0 10px;padding:5px 12px;border-radius:999px;font-size:.72rem;font-weight:800;",
      "letter-spacing:.1em;text-transform:uppercase;color:#5b21b6;background:#f3e8ff;}",
      ".sx-fl-card h2{margin:0 0 8px;font-size:1.2rem;color:#1e1b4b;}",
      ".sx-fl-card p{margin:0 0 20px;color:#5b5675;font-size:.92rem;line-height:1.55;}",
      ".sx-fl-actions{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;}",
      ".sx-fl-actions button{border:0;border-radius:12px;padding:11px 18px;font:inherit;font-weight:800;cursor:pointer;}",
      ".sx-fl-home{background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff;}",
      ".sx-fl-close{background:#f6f4ff;color:#4c1d95;border:1.5px solid #ddd6fe;}",
      "html[data-app-theme=\"dark\"] .sx-fl-card{background:#262030;color:#f2edf7;}",
      "html[data-app-theme=\"dark\"] .sx-fl-card h2{color:#f2edf7;}",
      "html[data-app-theme=\"dark\"] .sx-fl-card p{color:#bdb2cc;}",
      "html[data-app-theme=\"dark\"] .sx-fl-close{background:#332c42;color:#e9d5ff;border-color:rgba(196,181,253,.3);}",
      ".nav-item.sx-locked{opacity:.55;}",
      ".nav-item.sx-locked .nav-label::after{content:'\\1F512';margin-left:6px;font-size:.8em;}",
    ].join("");
    document.head.appendChild(style);
  }

  function ensureOverlay() {
    injectStyles();
    var existing = document.getElementById("sx-fl-overlay");
    if (existing) return existing;

    var wrap = document.createElement("div");
    wrap.id = "sx-fl-overlay";
    wrap.className = "sx-fl-overlay";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");
    wrap.hidden = true;
    wrap.innerHTML =
      '<div class="sx-fl-card">' +
      '<div class="sx-fl-icon" aria-hidden="true">\uD83D\uDEE0\uFE0F</div>' +
      '<span class="sx-fl-kicker">Under maintenance</span>' +
      '<h2 id="sx-fl-title">We will update you soon</h2>' +
      '<p id="sx-fl-text"></p>' +
      '<div class="sx-fl-actions">' +
      '<button type="button" class="sx-fl-home" id="sx-fl-home">Go to Home</button>' +
      '<button type="button" class="sx-fl-close" id="sx-fl-close">Got it</button>' +
      "</div></div>";
    document.body.appendChild(wrap);

    wrap.querySelector("#sx-fl-close").addEventListener("click", function () {
      wrap.hidden = true;
    });
    wrap.querySelector("#sx-fl-home").addEventListener("click", function () {
      wrap.hidden = true;
      goHome();
    });
    return wrap;
  }

  function goHome() {
    try {
      if (isTeacherPortal() && typeof global.showTeacherPage === "function") {
        global.showTeacherPage("live");
        return;
      }
      if (typeof global.showPage === "function") {
        global.showPage("dashboard");
        return;
      }
    } catch (e) { /* ignore */ }
  }

  function showLocked(key, opts) {
    opts = opts || {};
    var overlay = ensureOverlay();
    var title = overlay.querySelector("#sx-fl-title");
    var text = overlay.querySelector("#sx-fl-text");
    var label = labelFor(key);
    if (title) title.textContent = label + " is under maintenance";
    if (text) text.textContent = opts.message || messageFor(key);
    overlay.hidden = false;
    try {
      overlay.querySelector("#sx-fl-close").focus({ preventScroll: true });
    } catch (e) { /* older Chromium */ }
  }

  /** Returns false (and shows the maintenance card) when the page is locked. */
  function guard(page, opts) {
    var key = keyForPage(page);
    if (!key) return true;
    if (!isLocked(key)) return true;
    showLocked(key, opts);
    return false;
  }

  function decorateNavigation() {
    try {
      document.querySelectorAll(".nav-item[data-page]").forEach(function (el) {
        var key = keyForPage(el.getAttribute("data-page"));
        var locked = isLocked(key);
        el.classList.toggle("sx-locked", locked);
        if (locked) el.setAttribute("title", "Under maintenance - " + messageFor(key));
        else el.removeAttribute("title");
      });
    } catch (e) { /* non fatal */ }
  }

  global.SxFeatures = {
    load: load,
    refresh: function () {
      return load(true);
    },
    isLocked: isLocked,
    messageFor: messageFor,
    label: labelFor,
    showLocked: showLocked,
    guard: guard,
    keyForPage: keyForPage,
    decorate: decorateNavigation,
    state: state,
  };

  load();
  setInterval(function () {
    load(true);
  }, REFRESH_EVERY);
})(window);
