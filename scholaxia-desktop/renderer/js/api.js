/* Scholaxia website API — calls production backend */
(function (global) {
  // Desktop builds are served from the local desktop-server (127.0.0.1:17890),
  // which proxies /api-proxy/* to the remote API — same-origin, no CORS.
  function scholaxiaApiBase() {
    try {
      var host = String((global.location && global.location.hostname) || "").toLowerCase();
      if (host === "127.0.0.1" || host === "localhost") {
        return global.location.origin + "/api-proxy";
      }
    } catch (e) { /* fall through */ }
    return "https://scholaxia1.onrender.com";
  }

  var API_BASE = scholaxiaApiBase();
  global.API_BASE = API_BASE;

  // Old public contract: returns the AbortSignal itself (callers do `signal: fetchTimeout(ms)`).
  function fetchTimeout(ms) {
    try {
      if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) {
        return AbortSignal.timeout(ms || 25000);
      }
    } catch (e) { /* fall through */ }
    var ctrl = new AbortController();
    setTimeout(function () {
      try { ctrl.abort(); } catch (e) {}
    }, ms || 25000);
    return ctrl.signal;
  }

  // Internal handle with manual clear (used by api/apiUpload/readHealth internals).
  function fetchTimeoutHandle(ms) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () {
      try { ctrl.abort(); } catch (e) {}
    }, ms || 25000);
    return { signal: ctrl.signal, clear: function () { clearTimeout(timer); } };
  }

  async function readHealth(ms) {
    var timeout = ms || 45000;
    // XHR first — more reliable than fetch on some mobile browsers / GitHub Pages
    try {
      var data = await new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open("GET", API_BASE + "/health", true);
        xhr.timeout = timeout;
        xhr.onload = function () {
          try {
            resolve(xhr.responseText ? JSON.parse(xhr.responseText) : { status: xhr.status === 200 ? "ok" : "error" });
          } catch (e) {
            resolve({ status: xhr.status === 200 ? "ok" : "error" });
          }
        };
        xhr.onerror = function () { reject(new Error("Failed to fetch")); };
        xhr.ontimeout = function () { reject(new Error("The user aborted a request.")); };
        xhr.send();
      });
      return data;
    } catch (xhrErr) {
      var t = fetchTimeoutHandle(timeout);
      try {
        var res = await fetch(API_BASE + "/health", {
          method: "GET",
          mode: "cors",
          credentials: "omit",
          cache: "no-store",
          signal: t.signal,
        });
        try {
          return await res.json();
        } catch (e) {
          return { status: res.ok ? "ok" : "error" };
        }
      } finally {
        t.clear();
      }
    }
  }

  async function wakeServer(ms) {
    try {
      return await readHealth(ms || 45000);
    } catch (e) {
      return null;
    }
  }

  function friendlyFetchError(err) {
    var name = (err && err.name) || "";
    var msg = (err && err.message) || "";
    if (name === "AbortError" || /aborted|abort/i.test(msg)) {
      return "Server took too long. Wait 30 seconds and try again (Render may be waking up).";
    }
    if (/failed to fetch|networkerror|load failed/i.test(msg)) {
      return "Cannot reach the Scholaxia API. Wait a minute if the server is restarting, then try again.";
    }
    return msg || "Request failed";
  }

  function formPost(path, fields, timeout) {
    return new Promise(function (resolve, reject) {
      var body = Object.keys(fields)
        .map(function (k) {
          return encodeURIComponent(k) + "=" + encodeURIComponent(fields[k] == null ? "" : String(fields[k]));
        })
        .join("&");
      var xhr = new XMLHttpRequest();
      xhr.open("POST", API_BASE + path, true);
      xhr.timeout = timeout || 60000;
      xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
      xhr.onload = function () {
        var data = null;
        try {
          data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
        } catch (e) {
          data = { detail: xhr.responseText || "Invalid response" };
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(data);
          return;
        }
        var msg = (data && (data.detail || data.message)) || ("Request failed (" + xhr.status + ")");
        if (typeof msg === "object") msg = JSON.stringify(msg);
        var err = new Error(msg);
        err.status = xhr.status;
        reject(err);
      };
      xhr.onerror = function () {
        var err = new Error("Failed to fetch");
        err.status = 0;
        reject(err);
      };
      xhr.ontimeout = function () {
        var err = new Error("The user aborted a request.");
        reject(err);
      };
      xhr.send(body);
    });
  }

  async function loginApi(email, password) {
    var last = null;
    // "email" may be a school Student ID / reg number (no-email login)
    var identField = String(email || "").indexOf("@") >= 0 ? "email" : "email_or_id";
    var identBody = {};
    identBody[identField] = email;
    identBody.password = password;
    try {
      return await api("/api/v1/auth/login", {
        method: "POST",
        noAuth: true,
        body: identBody,
        timeout: 25000,
        retries: 0,
        preferXhr: true,
      });
    } catch (err) {
      last = err;
      // Wrong password / locked account — do not fall through to a second long attempt
      if (err && err.status && err.status >= 400 && err.status < 500) {
        throw err;
      }
    }
    try {
      return await formPost("/api/v1/auth/login", identBody, 20000);
    } catch (formErr) {
      var e = last || formErr;
      var friendly = friendlyFetchError(e);
      var out = new Error(friendly || (e && e.message) || "Login failed");
      out.status = e && e.status;
      out.data = e && e.data;
      throw out;
    }
  }

  function getToken() {
    var schoolTok = localStorage.getItem("sia_school_token") || "";
    var teacherTok = localStorage.getItem("sia_teacher_token") || localStorage.getItem("sia_admin_token") || "";
    var studentTok = localStorage.getItem("sia_token") || "";
    var role = "";
    try {
      role = localStorage.getItem("sia_role") || "";
    } catch (e) {}
    try {
      var path = String(window.location.pathname || "");
      if (/external-exam(\.html)?$/i.test(path) || /exam(\.html)?$/i.test(path)) {
        return studentTok;
      }
      if (/schools(\.html)?$/i.test(path) || /office(\.html)?$/i.test(path)) {
        return schoolTok || teacherTok;
      }
      var onClassroom = /classroom(\.html)?$/i.test(path) || /\/classroom/i.test(path);
      var sess = null;
      try {
        sess = JSON.parse(localStorage.getItem("live_session") || "null");
      } catch (e2) {
        sess = null;
      }
      var sessRole = (sess && sess.role) || "";
      if (onClassroom && (sessRole === "teacher" || sessRole === "admin")) {
        return teacherTok || schoolTok || studentTok;
      }
      if (onClassroom && sessRole === "student") {
        return studentTok || teacherTok;
      }
      if (role === "school_admin") {
        return schoolTok || teacherTok || studentTok;
      }
      if (role === "teacher" || role === "admin") {
        return teacherTok || studentTok;
      }
      if (role === "vendor") {
        return studentTok || teacherTok;
      }
      if (role === "student" || role === "kind") {
        return studentTok || teacherTok;
      }
    } catch (e) {}
    return schoolTok || teacherTok || studentTok;
  }

  function getUser() {
    return {
      name: localStorage.getItem("sia_name") || "User",
      email: localStorage.getItem("sia_email") || "",
      role: localStorage.getItem("sia_role") || "student",
      ageGroup: localStorage.getItem("sia_age_group") || "",
    };
  }

  function saveSession(data, email, nameOverride) {
    var role = (data && data.role) || "student";
    var token = data && data.access_token;
    if (!token) return;

    if (role === "school_admin") {
      localStorage.setItem("sia_school_token", token);
      localStorage.setItem("sia_teacher_token", token);
    } else if (role === "teacher" || role === "admin") {
      localStorage.setItem("sia_teacher_token", token);
    } else {
      localStorage.setItem("sia_token", token);
    }
    localStorage.setItem("sia_role", role);
    if (email) localStorage.setItem("sia_email", email);
    var name =
      nameOverride ||
      (data.user && data.user.full_name) ||
      localStorage.getItem("sia_name") ||
      email ||
      "User";
    localStorage.setItem("sia_name", name);
    if (data.user) {
      if (data.user.school_id) localStorage.setItem("sia_user_school_id", data.user.school_id);
      if (data.user.school_name) localStorage.setItem("sia_user_school_name", data.user.school_name);
      if (data.user.education_level) localStorage.setItem("sia_class", data.user.education_level);
      if (data.user.school_student_id) localStorage.setItem("sia_school_student_id", data.user.school_student_id);
    }
  }

  function clearSession() {
    [
      "sia_token",
      "sia_teacher_token",
      "sia_school_token",
      "sia_role",
      "sia_name",
      "sia_email",
      "sia_exam_type",
      "sia_subjects",
      "sia_age_group",
    ].forEach(function (k) {
      localStorage.removeItem(k);
    });
  }

  async function parseResponse(res) {
    var text = await res.text();
    var data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (e) {
      data = { detail: text || "Invalid response" };
    }
    if (!res.ok) {
      var msg =
        (data && (data.detail || data.message)) ||
        "Request failed (" + res.status + ")";
      if (typeof msg === "object") msg = JSON.stringify(msg);
      var err = new Error(msg);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  var wakePromise = null;
  var lastWakeOkAt = 0;

  function ensureAwake() {
    // Never block UI/API calls on a long health check — wake in the background only
    if (Date.now() - lastWakeOkAt < 45000) {
      return Promise.resolve({ status: "ok", cached: true });
    }
    if (!wakePromise) {
      wakePromise = wakeServer(12000)
        .then(function (res) {
          if (res) lastWakeOkAt = Date.now();
          return res;
        })
        .finally(function () {
          setTimeout(function () {
            wakePromise = null;
          }, 5000);
        });
    }
    return Promise.resolve({ status: "waking" });
  }

  async function api(path, options) {
    options = options || {};
    var method = (options.method || "GET").toUpperCase();
    var hasBody = !!options.body;
    var isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
    var headers = Object.assign({ Accept: "application/json" }, options.headers || {});
    if (hasBody && !isFormData && !headers["Content-Type"] && !headers["content-type"]) {
      headers["Content-Type"] = "application/json";
    }
    if (isFormData) {
      delete headers["Content-Type"];
      delete headers["content-type"];
    }
    var token = getToken();
    if (token && !options.noAuth && !headers.Authorization) {
      headers.Authorization = "Bearer " + token;
    }
    var tries = options.retries == null ? (method === "POST" ? 2 : 2) : options.retries;
    var lastErr = null;
    var timeoutMs = options.timeout || (method === "GET" ? 45000 : 45000);

    // Background wake only — do not await
    try {
      ensureAwake();
    } catch (w) {}

    // Prefer XHR for flaky browser fetch (CBT, profile save, payments)
    var preferXhr =
      !!options.preferXhr ||
      /\/auth\/login$|\/cbt\/coupons\/redeem$|\/payments\/paystack\/initialize$|\/payments\/paystack\/verify$|\/cbt\/practice\/home$|\/cbt\/practice\/start$|\/students\/setup-exam$|\/students\/me$|\/students\/subjects$|\/live-classes\/[^/]+\/join$/i.test(
        path
      );
    if (preferXhr) {
      try {
        return await xhrJson(path, headers, Object.assign({}, options, { method: method, timeout: timeoutMs }));
      } catch (xhrFirstErr) {
        var xm = (xhrFirstErr && xhrFirstErr.message) || "";
        var networkish =
          !xhrFirstErr.status ||
          /failed to fetch|networkerror|load failed|aborted/i.test(xm) ||
          xhrFirstErr.name === "AbortError";
        if (!networkish) throw xhrFirstErr;
        lastErr = xhrFirstErr;
      }
    }

    for (var i = 0; i <= tries; i++) {
      var t = null;
      try {
        if (i > 0) {
          wakePromise = null;
          lastWakeOkAt = 0;
          try { await ensureAwake(); } catch (w2) {}
          await new Promise(function (resolve) { setTimeout(resolve, 700 * i); });
        }
        t = fetchTimeoutHandle(timeoutMs);
        var res = await fetch(API_BASE + path, {
          method: method,
          mode: "cors",
          headers: headers,
          body: hasBody ? (isFormData ? options.body : (typeof options.body === "string" ? options.body : JSON.stringify(options.body))) : undefined, // pre-serialized bodies: do NOT double-encode
          credentials: "omit",
          cache: "no-store",
          signal: t.signal,
        });
        lastWakeOkAt = Date.now();
        return await parseResponse(res);
      } catch (err) {
        lastErr = err;
        var msg = (err && err.message) || "";
        var retryable =
          /failed to fetch|networkerror|load failed|aborted/i.test(msg) ||
          err.name === "AbortError";
        if (!retryable || i === tries) break;
      } finally {
        if (t) t.clear();
      }
    }
    // XHR fallback for any method — some browsers report Failed to fetch on GET too (CBT home, etc.)
    if (lastErr) {
      try {
        return await xhrJson(path, headers, Object.assign({}, options, { method: method, timeout: timeoutMs }));
      } catch (xhrErr) {
        lastErr = xhrErr || lastErr;
      }
    }
    if (lastErr) {
      var friendly = friendlyFetchError(lastErr);
      if (friendly && friendly !== lastErr.message) {
        var wrapped = new Error(friendly);
        wrapped.status = lastErr.status;
        wrapped.data = lastErr.data;
        wrapped.name = lastErr.name;
        throw wrapped;
      }
    }
    throw lastErr;
  }

  function xhrJson(path, headers, options) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open(options.method || "POST", API_BASE + path, true);
      xhr.timeout = options.timeout || 60000;
      Object.keys(headers || {}).forEach(function (k) {
        try { xhr.setRequestHeader(k, headers[k]); } catch (e) {}
      });
      xhr.onload = function () {
        var data = null;
        try { data = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch (e) {
          data = { detail: xhr.responseText || "Invalid response" };
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(data);
          return;
        }
        var msg = (data && (data.detail || data.message)) || ("Request failed (" + xhr.status + ")");
        if (typeof msg === "object") msg = JSON.stringify(msg);
        var err = new Error(msg);
        err.status = xhr.status;
        err.data = data;
        reject(err);
      };
      xhr.onerror = function () { reject(new Error("Failed to fetch")); };
      xhr.ontimeout = function () { reject(new Error("The user aborted a request.")); };
      xhr.send(
        options.body == null
          ? null
          : options.body instanceof FormData
            ? options.body
            : typeof options.body === "string"
              ? options.body // already serialized — do NOT double-encode
              : JSON.stringify(options.body)
      );
    });
  }

  async function apiUpload(path, formData, options) {
    options = options || {};
    var headers = { Accept: "application/json" };
    var token = getToken();
    if (token && !options.noAuth && !headers.Authorization) {
      headers.Authorization = "Bearer " + token;
    }
    var t = options.signal ? null : fetchTimeoutHandle(options.timeout || 90000);
    var res = await fetch(API_BASE + path, {
      method: options.method || "POST",
      headers: headers,
      body: formData,
      credentials: "omit",
      signal: options.signal || (t && t.signal),
    });
    try {
      return await parseResponse(res);
    } finally {
      if (t) t.clear();
    }
  }

  function dashboardForRole(role) {
    if (role === "school_admin") return "office.html";
    if (role === "teacher" || role === "admin") return "teacher.html";
    if (role === "kind") return "kind.html";
    if (role === "vendor") return "vendor.html";
    return "student.html";
  }

  function requireAuth(expectedRoles) {
    var role = localStorage.getItem("sia_role") || "";
    var token = getToken();
    if (!token) {
      window.location.href = "portal.html";
      return false;
    }
    if (expectedRoles && expectedRoles.indexOf(role) < 0) {
      window.location.href = dashboardForRole(role);
      return false;
    }
    return true;
  }

  async function fetchBinary(path, options) {
    options = options || {};
    var token = getToken();
    var headers = Object.assign({ Accept: "application/octet-stream,*/*" }, options.headers || {});
    if (token && !options.noAuth && !headers.Authorization) {
      headers.Authorization = "Bearer " + token;
    }
    var timeoutMs = options.timeout || 180000;
    var tries = options.retries == null ? 3 : options.retries;
    var lastErr = null;
    var url = API_BASE + path;

    for (var i = 0; i <= tries; i++) {
      if (i > 0) {
        wakePromise = null;
        lastWakeOkAt = 0;
        try {
          await wakeServer(60000);
        } catch (w) {}
        await new Promise(function (resolve) {
          setTimeout(resolve, 1500 * i);
        });
      } else {
        try {
          await wakeServer(45000);
        } catch (w2) {}
      }
      try {
        var bytes = await new Promise(function (resolve, reject) {
          var xhr = new XMLHttpRequest();
          xhr.open("GET", url, true);
          xhr.responseType = "arraybuffer";
          xhr.timeout = timeoutMs;
          Object.keys(headers).forEach(function (k) {
            xhr.setRequestHeader(k, headers[k]);
          });
          xhr.onload = function () {
            if (xhr.status === 402) {
              var err402 = new Error("Pay to unlock this material.");
              err402.status = 402;
              reject(err402);
              return;
            }
            if (xhr.status === 403) {
              var err403 = new Error("This file is not downloadable.");
              err403.status = 403;
              reject(err403);
              return;
            }
            if (xhr.status >= 200 && xhr.status < 300) {
              lastWakeOkAt = Date.now();
              resolve(new Uint8Array(xhr.response));
              return;
            }
            var err = new Error("Request failed (" + xhr.status + ")");
            err.status = xhr.status;
            reject(err);
          };
          xhr.onerror = function () {
            reject(new Error("Failed to fetch"));
          };
          xhr.ontimeout = function () {
            reject(new Error("The user aborted a request."));
          };
          xhr.send();
        });
        return bytes;
      } catch (err) {
        lastErr = err;
        var msg = (err && err.message) || "";
        var retryable =
          !err.status || err.status >= 500 || /failed to fetch|networkerror|load failed|aborted/i.test(msg);
        if (!retryable || i === tries) break;
      }
    }
    throw new Error(friendlyFetchError(lastErr) || "Could not download file.");
  }

  global.ScholaxiaAPI = {
    API_BASE: API_BASE,
    api: api,
    apiUpload: apiUpload,
    fetchBinary: fetchBinary,
    wakeServer: wakeServer,
    loginApi: loginApi,
    friendlyFetchError: friendlyFetchError,
    fetchTimeout: fetchTimeout,
    getToken: getToken,
    getUser: getUser,
    saveSession: saveSession,
    clearSession: clearSession,
    dashboardForRole: dashboardForRole,
    requireAuth: requireAuth,
  };
  // `api` must be the callable fetcher — feature scripts do api("/path").
  // (Assigning the namespace object here broke every data load: the object
  // clobbered the hoisted global function, so api("/x") threw "not a function"
  // and pages showed "Network error" / "can't load" everywhere.)
  global.api = api;
})(window);

// ── Global auth helpers (used across app.js, marketplace.js, etc.) ──────────
// Restored: these were dropped in the api.js rewrite and left callers
// (notably initUserUI in app.js) throwing ReferenceError on startup.
function isStudentLoggedIn() {
  try {
    return !!localStorage.getItem("sia_token");
  } catch (e) {
    return false;
  }
}

var PUBLIC_APP_PAGES = ["dashboard", "cbt", "games", "school-portal", "marketplace", "study-materials", "past-questions", "about", "contact"];

function isPagePublic(page) {
  return PUBLIC_APP_PAGES.indexOf(page) >= 0;
}

function goToLogin(returnPage) {
  var page = returnPage || sessionStorage.getItem("sia_current_page") || "dashboard";
  if (page && !isPagePublic(page)) {
    sessionStorage.setItem("sia_login_return", page);
  }
  window.location.href = "index.html" + (page && !isPagePublic(page) ? "?return=" + encodeURIComponent(page) : "");
}

if (typeof window !== "undefined") {
  window.isStudentLoggedIn = isStudentLoggedIn;
  window.isPagePublic = isPagePublic;
  window.goToLogin = goToLogin;
  window.PUBLIC_APP_PAGES = PUBLIC_APP_PAGES;
}

// ── Bare-name compatibility bridge ─────────────────────────────────────────
// Many renderer scripts (auth.js, app.js, kind.js, admin.js, teacher.js,
// classroom.js, …) call these helpers as bare globals, but the rewritten
// api.js only exposed them on the ScholaxiaAPI namespace — so pages failed
// to initialize (dead buttons on index.html, blank reveal sections).
if (typeof window !== "undefined" && window.ScholaxiaAPI) {
  var __apiNames = ["getToken", "getUser", "saveSession", "clearSession", "fetchTimeout", "apiUpload", "fetchBinary", "loginApi", "friendlyFetchError", "wakeServer", "dashboardForRole", "requireAuth"];
  __apiNames.forEach(function (name) {
    if (typeof window[name] === "undefined" && typeof window.ScholaxiaAPI[name] === "function") {
      window[name] = window.ScholaxiaAPI[name];
    }
  });
}

// ── Legacy global API helpers (restored from pre-rewrite api.js) ───────────
// Feature scripts across the app call `api("/path")` as a bare async function.
// The rewrite turned `api` into a namespace object, so every data load in the
// student/kid apps failed with "api is not a function" ("can't load" errors).
function parseUtcIso(iso) {
  if (!iso) return null;
  var s = String(iso).trim();
  if (!s) return null;
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) s += "Z";
  var d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function normalizeLiveEndTime(endTime, isLive) {
  if (!endTime) return null;
  var endAt = parseUtcIso(endTime);
  if (!endAt) return null;
  if (endAt.getTime() <= Date.now() && isLive !== false) return null;
  return endTime;
}

function persistLiveSession(sess) {
  if (!sess) return;
  var json = JSON.stringify(sess);
  try {
    localStorage.setItem("live_session", json);
    sessionStorage.setItem("live_session", json);
  } catch (e) { /* ignore */ }
}

function loadLiveSessionData() {
  try {
    var raw = localStorage.getItem("live_session") || sessionStorage.getItem("live_session");
    return JSON.parse(raw || "null");
  } catch (e) {
    return null;
  }
}

function clearLiveSession() {
  try {
    localStorage.removeItem("live_session");
    sessionStorage.removeItem("live_session");
  } catch (e) { /* ignore */ }
}

function isClassroomPage() {
  try {
    var path = window.location.pathname || "";
    var href = window.location.href || "";
    return /classroom\.html/i.test(path) || /classroom\.html/i.test(href);
  } catch (e) {
    return false;
  }
}

function formatApiError(detail) {
  if (!detail) return "";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail.map(function (d) {
      if (typeof d === "string") return d;
      if (d && d.msg) return d.msg;
      try { return JSON.stringify(d); } catch (e) { return String(d); }
    }).join("; ");
  }
  if (detail.msg) return detail.msg;
  try { return JSON.stringify(detail); } catch (e) { return String(detail); }
}

function setOfflineBanner(offline) {
  var el = document.getElementById("sx-offline-banner");
  if (!el) {
    el = document.createElement("div");
    el.id = "sx-offline-banner";
    el.style.cssText =
      "display:none;position:fixed;top:0;left:0;right:0;z-index:9999;background:#F59E0B;color:#000;text-align:center;padding:6px 12px;font-size:12px;font-weight:700";
    el.textContent = "Offline — showing saved information";
    document.body.appendChild(el);
  }
  var role = "";
  try { role = localStorage.getItem("sia_role") || ""; } catch (e) {}
  var show = !!offline && !!getToken() && (role === "student" || role === "kind");
  el.style.display = show ? "block" : "none";
}

function networkErrorMessage(err) {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return "There is no internet on your data.";
  }
  var msg = (err && err.message) || "";
  if (/failed to fetch|timed out|network error|no internet/i.test(msg)) {
    return "There is no internet on your data.";
  }
  return msg || "Something went wrong.";
}

function firstName(name) {
  return (name || "Student").split(" ")[0];
}

function formatDate(iso) {
  if (!iso) return "—";
  var d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

var _apiWarmPromise = null;
function warmScholaxiaApi() {
  if (_apiWarmPromise) return _apiWarmPromise;
  _apiWarmPromise = fetch(API_BASE + "/health", { signal: fetchTimeout(90000) })
    .catch(function () { _apiWarmPromise = null; });
  return _apiWarmPromise;
}

function handleApiUnauthorized(detail) {
  var hadSession = false;
  try { hadSession = !!localStorage.getItem("sia_token"); } catch (e) {}
  if (typeof clearSession === "function") clearSession();
  if (!hadSession) return;
  var msg = (detail && String(detail)) || "Your session expired. Please sign in again.";
  if (/another device|logged in elsewhere|session/i.test(msg)) {
    msg = "You signed in on another device. This session was signed out.";
  }
  if (isClassroomPage()) {
    clearLiveSession();
    window.location.href = "index.html";
    return;
  }
  if (typeof goToLogin === "function") {
    goToLogin();
  } else {
    window.location.href = "index.html";
  }
}

async function api(path, options) {
  options = options || {};
  var method = (options.method || "GET").toUpperCase();
  var headers = Object.assign(
    { Accept: "application/json", Authorization: "Bearer " + getToken() },
    options.headers || {}
  );
  var body = options.body;
  if (body != null && typeof body === "object" && !(typeof FormData !== "undefined" && body instanceof FormData)) {
    if (!headers["Content-Type"] && !headers["content-type"]) {
      headers["Content-Type"] = "application/json";
    }
    body = JSON.stringify(body);
  } else if (body != null && !headers["Content-Type"] && !headers["content-type"]) {
    headers["Content-Type"] = "application/json";
  }
  if ((method === "GET" || method === "HEAD") && body == null) {
    delete headers["Content-Type"];
    delete headers["content-type"];
  }
  var res;
  try {
    res = await fetch(API_BASE + path, {
      method: method,
      headers: headers,
      body: body,
      signal: options.signal || fetchTimeout(options.timeoutMs || 45000),
    });
  } catch (ex) {
    setOfflineBanner(true);
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      throw new Error("There is no internet on your data.");
    }
    if (ex.name === "AbortError" || ex.name === "TimeoutError") {
      throw new Error("There is no internet on your data.");
    }
    var netMsg = (ex && ex.message) || "Network error";
    if (/failed to fetch/i.test(netMsg)) {
      throw new Error("There is no internet on your data.");
    }
    throw new Error(netMsg + ". Check your connection.");
  }
  setOfflineBanner(false);
  var data = await res.json().catch(function () { return {}; });
  if (res.status === 401) {
    handleApiUnauthorized(formatApiError(data.detail) || data.detail);
    return null;
  }
  if (!res.ok) {
    var err = new Error(formatApiError(data.detail) || "Request failed (" + res.status + ")");
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function apiRetry(path, options) {
  options = options || {};
  var attempts = options.attempts || 3;
  var baseDelay = options.retryDelay || 1000;
  if (!options.skipWarm) {
    try { await warmScholaxiaApi(); } catch (e) { /* ignore */ }
  }
  var lastErr;
  for (var i = 0; i < attempts; i++) {
    try {
      return await api(path, options);
    } catch (e) {
      lastErr = e;
      var retryable = /failed to fetch|timed out|network|waking up/i.test(e.message || "");
      if (!retryable || i >= attempts - 1) throw e;
      await new Promise(function (r) { setTimeout(r, baseDelay * (i + 1)); });
      _apiWarmPromise = null;
      try { await warmScholaxiaApi(); } catch (e2) { /* ignore */ }
    }
  }
  throw lastErr;
}

if (typeof window !== "undefined") {
  window.parseUtcIso = parseUtcIso;
  window.normalizeLiveEndTime = normalizeLiveEndTime;
  window.persistLiveSession = persistLiveSession;
  window.loadLiveSessionData = loadLiveSessionData;
  window.clearLiveSession = clearLiveSession;
  window.isClassroomPage = isClassroomPage;
  window.formatApiError = formatApiError;
  window.setOfflineBanner = setOfflineBanner;
  window.networkErrorMessage = networkErrorMessage;
  window.firstName = firstName;
  window.formatDate = formatDate;
  window.warmScholaxiaApi = warmScholaxiaApi;
  window.handleApiUnauthorized = handleApiUnauthorized;
  window.apiRetry = apiRetry;
  window.stripYearLabel = stripYearLabel;
  // `api` must be a callable function — feature scripts do api("/path").
  window.api = api;
}

// Hide upload years in titles: "WAEC Biology 2025 Past Questions" ->
// "WAEC Biology Past Questions". Handles single years, ranges (2018 - 2023),
// slash sessions (2024/2025) and parenthesized years.
function stripYearLabel(text) {
  var s = String(text == null ? "" : text);
  s = s.replace(/[([]?\s*\b(?:19|20)\d{2}\s*(?:[-–—/]|\bto\b)\s*(?:19|20)\d{2}\s*[)\]]?\s*/gi, " ");
  s = s.replace(/[([]\s*\b(?:19|20)\d{2}\s*[)\]]/g, " ");
  s = s.replace(/\b(?:19|20)\d{2}\s*\/\s*(?:19|20)\d{2}\b/g, " ");
  s = s.replace(/,?\s*\b(?:19|20)\d{2}\b/g, "");
  return s.replace(/\s{2,}/g, " ").replace(/\s+([,.;:])/g, "$1").replace(/,\s*$/, "").trim();
}
