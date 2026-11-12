/* Scholaxia feature guard - admin-controlled maintenance locks.
 *
 * The admin panel stores one switch per feature. This script reads the public
 * lock list and lets every student/kind screen ask "is this feature locked?".
 * It also draws the maintenance overlay, so a locked feature never disappears
 * silently - the learner is told what is happening.
 */
(function (global) {
  "use strict";

  var DEFAULT_MESSAGE =
    "We are running an update - we will be open soon. Thanks for your patience!";
  var CACHE_KEY = "sx_feature_access_v1";
  var CACHE_TTL = 20000;
  var REFRESH_EVERY = 45000;

  var state = {
    locks: {},
    labels: {},
    defaultMessage: DEFAULT_MESSAGE,
    loaded: false,
    fetchedAt: 0,
    promise: null,
  };

  function apiBase() {
    var base = global.API_BASE || global.SCHOLAXIA_API_BASE || "";
    if (base) return String(base).replace(/\/$/, "");
    // Pages such as the public Past Questions marketplace do not load api.js,
    // so derive the API host the same way it does.
    try {
      var host = String((global.location && location.hostname) || "").toLowerCase();
      if (
        host === "scholaxia1.onrender.com" ||
        host === "localhost" ||
        host === "127.0.0.1" ||
        (/\.scholaxia\.com$/.test(host) && host !== "scholaxia.com" && host !== "www.scholaxia.com")
      ) {
        return String(location.origin || "").replace(/\/$/, "");
      }
    } catch (e) { /* fall through */ }
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
    } catch (e) {
      /* storage can be disabled - the in-memory copy still works */
    }
  }

  function applyPayload(data) {
    var locks = (data && data.locks) || {};
    var labels = {};
    (data && data.features ? data.features : []).forEach(function (feature) {
      if (feature && feature.key && feature.label) labels[feature.key] = feature.label;
    });
    var clean = {};
    Object.keys(locks).forEach(function (key) {
      var item = locks[key] || {};
      clean[key] = {
        message: String(item.message || "").trim() || DEFAULT_MESSAGE,
        updated_at: item.updated_at || null,
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
    checkCurrentPage();
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
        checkCurrentPage();
        return Promise.resolve(state);
      }
    }

    var url = apiBase() + "/api/v1/feature-access";
    var ctrl = null;
    var timer = null;
    try {
      if (global.AbortController) {
        ctrl = new AbortController();
        timer = setTimeout(function () {
          try { ctrl.abort(); } catch (e) { /* ignore */ }
        }, 12000);
      }
    } catch (e) {
      ctrl = null;
    }

    state.promise = fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: ctrl ? ctrl.signal : undefined,
    })
      .then(function (res) {
        if (!res.ok) throw new Error("Feature access request failed");
        return res.json();
      })
      .then(function (data) {
        applyPayload(data);
        return state;
      })
      .catch(function () {
        // Never lock learners out because the network hiccupped.
        state.loaded = true;
        state.fetchedAt = Date.now();
        return state;
      })
      .then(function (result) {
        state.promise = null;
        if (timer) clearTimeout(timer);
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

  function currentFeature() {
    try {
      var value = document.body.getAttribute("data-sx-feature") || "";
      if (value) return value;
      if (document.body.classList.contains("kind-body")) return "kind.home";
      if (document.querySelector(".student-shell")) return "student.home";
      return "";
    } catch (e) {
      return "";
    }
  }

  function checkCurrentPage() {
    var key = currentFeature();
    if (isLocked(key)) showLocked(key, { persistent: true, quiet: true });
  }

  function injectStyles() {
    if (document.getElementById("sx-feature-guard-css")) return;
    var style = document.createElement("style");
    style.id = "sx-feature-guard-css";
    style.textContent = [
      ".sx-feature-guard{position:fixed;inset:0;z-index:2147482000;display:grid;place-items:center;padding:clamp(16px,4vw,32px);",
      "background:radial-gradient(120% 120% at 15% 0%,rgba(124,58,237,.32),rgba(15,23,42,.72) 62%,rgba(2,6,23,.86));",
      "backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);animation:sx-fg-fade .2s ease both;}",
      ".sx-feature-guard[hidden]{display:none!important;}",
      ".sx-fg-card{position:relative;width:min(540px,100%);background:linear-gradient(160deg,#fff,#faf5ff 70%,#eef2ff);",
      "border:1px solid rgba(124,58,237,.18);border-radius:28px;padding:clamp(24px,5vw,38px);text-align:center;",
      "box-shadow:0 36px 90px rgba(2,6,23,.45),0 2px 0 rgba(255,255,255,.9) inset;animation:sx-fg-rise .28s cubic-bezier(.2,.8,.2,1) both;}",
      ".sx-fg-card::before{content:'';position:absolute;inset:0;border-radius:28px;pointer-events:none;",
      "background:radial-gradient(80% 60% at 50% 0%,rgba(124,58,237,.16),transparent 70%);}",
      ".sx-fg-icon{width:76px;height:76px;margin:0 auto 14px;border-radius:24px;display:grid;place-items:center;font-size:34px;",
      "background:linear-gradient(145deg,#7c3aed,#4f46e5);color:#fff;box-shadow:0 18px 34px rgba(79,70,229,.35);",
      "animation:sx-fg-bob 2.8s ease-in-out infinite;}",
      ".sx-fg-kicker{display:inline-block;margin:0 0 8px;padding:6px 12px;border-radius:999px;font-size:.72rem;font-weight:800;",
      "letter-spacing:.12em;text-transform:uppercase;color:#5b21b6;background:#f3e8ff;border:1px solid #e9d5ff;}",
      ".sx-fg-card h2{margin:0 0 10px;font-size:clamp(1.35rem,4vw,1.9rem);letter-spacing:-.03em;color:#1e1b4b;}",
      ".sx-fg-card p{margin:0 auto 22px;max-width:38ch;color:#5b5675;font-size:.98rem;line-height:1.6;}",
      ".sx-fg-actions{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;}",
      ".sx-fg-actions button{border:0;border-radius:14px;padding:12px 20px;font:inherit;font-weight:800;cursor:pointer;",
      "transition:transform .15s ease,box-shadow .15s ease;min-height:46px;}",
      ".sx-fg-actions button:active{transform:scale(.98);}",
      ".sx-fg-home{color:#fff;background:linear-gradient(135deg,#7c3aed,#4f46e5);box-shadow:0 12px 26px rgba(79,70,229,.32);}",
      ".sx-fg-home:hover{transform:translateY(-2px);box-shadow:0 18px 32px rgba(79,70,229,.4);}",
      ".sx-fg-close{color:#4c1d95;background:#fff;border:1.5px solid #ddd6fe!important;box-shadow:0 4px 12px rgba(15,23,42,.06);}",
      ".sx-locked{position:relative;opacity:.62;}",
      ".sx-locked::after{content:'\\1F512';font-size:.7em;margin-left:6px;filter:grayscale(1);}",
      "body.sx-feature-blocked{overflow:hidden!important;}",
      "@keyframes sx-fg-fade{from{opacity:0}to{opacity:1}}",
      "@keyframes sx-fg-rise{from{opacity:0;transform:translateY(16px) scale(.97)}to{opacity:1;transform:none}}",
      "@keyframes sx-fg-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}",
      "@media (prefers-reduced-motion:reduce){.sx-feature-guard,.sx-fg-card,.sx-fg-icon{animation:none!important;}}",
    ].join("");
    document.head.appendChild(style);
  }

  function ensureOverlay() {
    injectStyles();
    var existing = document.getElementById("sx-feature-guard");
    if (existing) return existing;

    var wrap = document.createElement("div");
    wrap.id = "sx-feature-guard";
    wrap.className = "sx-feature-guard";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");
    wrap.setAttribute("aria-labelledby", "sx-fg-title");
    wrap.hidden = true;
    wrap.innerHTML =
      '<div class="sx-fg-card">' +
      '<div class="sx-fg-icon" aria-hidden="true">\uD83D\uDEE0\uFE0F</div>' +
      '<span class="sx-fg-kicker">Scheduled maintenance</span>' +
      '<h2 id="sx-fg-title">We&rsquo;ll be right back</h2>' +
      '<p id="sx-fg-text"></p>' +
      '<div class="sx-fg-actions">' +
      '<button type="button" class="sx-fg-home" id="sx-fg-home">Go to Home</button>' +
      '<button type="button" class="sx-fg-close" id="sx-fg-close">Got it</button>' +
      "</div></div>";
    document.body.appendChild(wrap);

    wrap.querySelector("#sx-fg-close").addEventListener("click", function () {
      wrap.hidden = true;
      document.body.classList.remove("sx-feature-blocked");
    });
    wrap.querySelector("#sx-fg-home").addEventListener("click", function () {
      wrap.hidden = true;
      document.body.classList.remove("sx-feature-blocked");
      goHome();
    });
    return wrap;
  }

  function goHome() {
    if (typeof global.kindShowPage === "function") {
      try { global.kindShowPage("home"); return; } catch (e) { /* ignore */ }
    }
    if (typeof global.studentShowPage === "function") {
      try { global.studentShowPage("home"); return; } catch (e) { /* ignore */ }
    }
    try {
      if (document.body.classList.contains("kind-body")) {
        location.href = "kind.html";
      } else if (document.querySelector(".student-shell")) {
        location.href = "student.html";
      } else {
        location.href = "index.html";
      }
    } catch (e2) {
      location.href = "/";
    }
  }

  function showLocked(key, opts) {
    opts = opts || {};
    var label = state.labels[key] || featureLabel(key);
    var item = state.locks[key];
    if (item && item.label) label = item.label;
    var message = opts.message || messageFor(key);
    var overlay = ensureOverlay();
    var title = overlay.querySelector("#sx-fg-title");
    var text = overlay.querySelector("#sx-fg-text");
    if (title) title.textContent = label ? label + " is under maintenance" : "We\u2019ll be right back";
    if (text) text.textContent = message;
    overlay.hidden = false;
    if (opts.persistent) document.body.classList.add("sx-feature-blocked");
    try {
      var closeBtn = overlay.querySelector("#sx-fg-close");
      if (closeBtn) closeBtn.focus({ preventScroll: true });
    } catch (e) { /* older browser */ }
  }

  function featureLabel(key) {
    var parts = String(key || "").split(".");
    var label = parts.length > 1 ? parts.slice(1).join(".") : parts[0] || "This feature";
    return label
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function decorateNavigation() {
    try {
      var kind = /(^|\/)kind\.html$/i.test(location.pathname) ||
        document.body.classList.contains("kind-body");
      var prefix = kind ? "kind." : "student.";
      document.querySelectorAll("[data-page]").forEach(function (el) {
        var page = el.getAttribute("data-page");
        if (!page) return;
        var key = prefix + page;
        el.classList.toggle("sx-locked", isLocked(key));
        if (isLocked(key)) {
          el.setAttribute("title", messageFor(key));
        } else {
          el.removeAttribute("title");
        }
      });
      document.querySelectorAll("[data-feature-lock]").forEach(function (el) {
        var key2 = el.getAttribute("data-feature-lock");
        el.classList.toggle("sx-locked", isLocked(key2));
      });
    } catch (e) { /* non-fatal */ }
  }

  // One delegated handler covers nav buttons, quick actions and outbound links.
  document.addEventListener(
    "click",
    function (e) {
      var target = e.target.closest && e.target.closest("[data-feature-lock]");
      if (!target) return;
      var key = target.getAttribute("data-feature-lock");
      if (!isLocked(key)) return;
      e.preventDefault();
      e.stopPropagation();
      showLocked(key);
    },
    true
  );

  // Block a whole public page (e.g. past-questions.html) when its feature is locked.
  function blockPage(key) {
    try { document.body.setAttribute("data-sx-feature", key); } catch (e) { /* ignore */ }
    load().then(function () {
      if (isLocked(key)) showLocked(key, { persistent: true });
    });
  }

  global.ScholaxiaFeatures = {
    load: load,
    refresh: function () { return load(true); },
    isLocked: isLocked,
    messageFor: messageFor,
    showLocked: showLocked,
    blockPage: blockPage,
    label: function (key) {
      var lock = state.locks[key];
      if (lock && lock.label) return lock.label;
      return state.labels[key] || featureLabel(key);
    },
    ready: function () { return load(); },
    state: state,
  };

  // Fetch immediately so the first tap already has the answer.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { load(); });
  } else {
    load();
  }

  // Keep open tabs in sync with admin changes without a page refresh.
  setInterval(function () { load(true); }, REFRESH_EVERY);
})(window);
