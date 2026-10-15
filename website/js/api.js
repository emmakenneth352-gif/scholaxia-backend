/* Scholaxia website API — calls production backend */
(function (global) {
  var API_BASE = (function () {
    try {
      var host = String((global.location && location.hostname) || "");
      // Same-origin when the site is served from Render — avoids GitHub Pages CORS blocks.
      if (host === "scholaxia1.onrender.com") {
        return String(location.origin || "").replace(/\/$/, "") || "https://scholaxia1.onrender.com";
      }
      // School private links (divine-light.scholaxia.com) are served by the same
      // Render service, so the API is same-origin there too.
      if (/\.scholaxia\.com$/i.test(host) && host.toLowerCase() !== "scholaxia.com" && host.toLowerCase() !== "www.scholaxia.com") {
        return String(location.origin || "").replace(/\/$/, "");
      }
      // Local dev server (e.g. 127.0.0.1:8000) has no reachable database —
      // call the production API directly (CORS allows all origins).
      if (host === "localhost" || host === "127.0.0.1") {
        return "https://scholaxia1.onrender.com";
      }
    } catch (e) {}
    return "https://scholaxia1.onrender.com";
  })();
  global.API_BASE = API_BASE;
  global.SCHOLAXIA_SCHOOL_HOST = (function () {
    try {
      var host = String((global.location && location.hostname) || "").toLowerCase();
      if (/\.scholaxia\.com$/i.test(host) && host !== "scholaxia.com" && host !== "www.scholaxia.com") {
        return host.split(".")[0];
      }
    } catch (e) {}
    return null;
  })();

  function fetchTimeout(ms) {
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
      var t = fetchTimeout(timeout);
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
      return "Cannot reach the Scholaxia API. Wait a minute if the server is waking up, then tap Try again.";
    }
    return msg || "Request failed";
  }

  function pathNeedsReliableTransport(path) {
    return /\/auth\/(login|signup)|\/cbt\/coupons\/redeem$|\/payments\/paystack\/|\/cbt\/practice\/|\/students\/(setup-exam|me|subjects)$|\/live-classes\/|\/student-groups\/|\/community\//i.test(
      path || ""
    );
  }

  function pathNeedsAwaitWake(path) {
    // Only block on wake for join — groups/community/auth must stay snappy.
    return /\/live-classes\/[^/]+\/join|\/live-classes\/join-by-code/i.test(path || "");
  }

  async function ensureAwakeBlocking(ms) {
    var budget = Math.min(ms || 25000, 45000);
    // Reuse a recent successful wake — do NOT reset cache every call (that froze Groups).
    if (Date.now() - lastWakeOkAt < 60000) {
      return true;
    }
    if (wakePromise) {
      try {
        var cached = await wakePromise;
        return !!cached;
      } catch (e) {
        /* fall through */
      }
    }
    var start = Date.now();
    wakePromise = wakeServer(budget)
      .then(function (ok) {
        if (ok) lastWakeOkAt = Date.now();
        return ok;
      })
      .finally(function () {
        setTimeout(function () {
          wakePromise = null;
        }, 3000);
      });
    var ok = await wakePromise;
    if (ok) return true;
    var left = budget - (Date.now() - start);
    if (left > 4000) {
      await new Promise(function (r) {
        setTimeout(r, 800);
      });
      ok = await wakeServer(left);
      if (ok) lastWakeOkAt = Date.now();
    }
    return !!ok;
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
    // "email" may actually be a Student ID / registration number (school
    // platform login without email) — send it in the right field.
    var identField = String(email || "").indexOf("@") >= 0 ? "email" : "email_or_id";
    var identBody = {};
    identBody[identField] = email;
    identBody.password = password;
    try {
      return await api("/api/v1/auth/login", {
        method: "POST",
        noAuth: true,
        body: identBody,
        timeout: 20000,
        retries: 1,
        preferXhr: true,
        awaitWake: false,
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
    function clean(tok) {
      tok = String(tok || "").replace(/^Bearer\s+/i, "").replace(/\s+/g, "").trim();
      if (!tok || tok === "null" || tok === "undefined" || tok.length < 16) return "";
      return tok;
    }
    schoolTok = clean(schoolTok);
    teacherTok = clean(teacherTok);
    studentTok = clean(studentTok);
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
      if (data.user.country) localStorage.setItem("sia_country", data.user.country);
      if (data.user.language) localStorage.setItem("sia_language", data.user.language);
    }
  }

  function clearSession() {
    [
      "sia_token",
      "sia_teacher_token",
      "sia_school_token",
      "sia_admin_token",
      "sia_role",
      "sia_name",
      "sia_email",
      "sia_exam_type",
      "sia_subjects",
      "sia_age_group",
      "sia_user_school_id",
      "sia_user_school_name",
      "sia_class",
      "sia_school_student_id",
      "live_session",
      "sia_stop_live_ring",
    ].forEach(function (k) {
      try {
        localStorage.removeItem(k);
      } catch (e) {}
    });
  }

  function handleSessionExpired() {
    // Any 401 with an existing session means the token is invalid/expired —
    // clear everything and force the user back to login.
    try {
      var hadSession = !!(getToken() || localStorage.getItem("sia_teacher_token") || localStorage.getItem("sia_school_token"));
      var here = currentPageName();
      var onAuthPage = here === "auth.html" || here === "portal.html" || here === "index.html";
      if (hadSession && !onAuthPage) {
        clearSession();
        window.location.replace("portal.html?force=1&reason=auth");
      }
    } catch (e) {}
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
      if (res.status === 401) handleSessionExpired();
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
    var reliable = pathNeedsReliableTransport(path);
    var isAuth = /\/auth\//i.test(path || "");
    var tries = options.retries == null ? (isAuth ? 1 : reliable ? 2 : 1) : options.retries;
    var lastErr = null;
    var timeoutMs =
      options.timeout ||
      (isAuth ? 20000 : reliable ? (method === "POST" ? 45000 : 30000) : 25000);

    // Fast-first: never block the first attempt on a long health check.
    // Only join (awaitWake) may pre-wake, and that wake is capped + cached.
    var shouldBlockWake =
      options.awaitWake === true || (options.awaitWake !== false && pathNeedsAwaitWake(path));
    if (shouldBlockWake) {
      try {
        await ensureAwakeBlocking(Math.min(timeoutMs, 25000));
      } catch (w0) {}
    } else {
      try {
        ensureAwake();
      } catch (w) {}
    }

    var preferXhr = !!options.preferXhr || (reliable && method !== "GET");
    // GET lists (groups/community) prefer fetch first — same path as working CBT pages.
    // XHR still used for auth POST / join and as fallback after network failure.

    async function oneAttempt(useXhr) {
      if (useXhr) {
        return await xhrJson(
          path,
          headers,
          Object.assign({}, options, { method: method, timeout: timeoutMs })
        );
      }
      var t = fetchTimeout(timeoutMs);
      try {
        var res = await fetch(API_BASE + path, {
          method: method,
          mode: "cors",
          headers: headers,
          body: hasBody ? (isFormData ? options.body : (typeof options.body === "string" ? options.body : JSON.stringify(options.body))) : undefined, // pre-serialized bodies: do NOT double-encode
          credentials: "omit",
          cache: "no-store",
          signal: t.signal,
        });
        return await parseResponse(res);
      } finally {
        t.clear();
      }
    }

    function isNetworkish(err) {
      if (!err) return false;
      if (err.status) return false;
      var msg = (err.message || "") + "";
      return (
        err.name === "AbortError" ||
        /failed to fetch|networkerror|load failed|aborted/i.test(msg)
      );
    }

    for (var i = 0; i <= tries; i++) {
      if (i > 0) {
        try {
          await ensureAwakeBlocking(20000);
        } catch (w2) {}
        await new Promise(function (resolve) {
          setTimeout(resolve, 400 * i);
        });
      }
      try {
        // Attempt 0: fetch for GET, XHR for POST when preferXhr
        var useXhrFirst = preferXhr && method !== "GET";
        var data = await oneAttempt(useXhrFirst);
        lastWakeOkAt = Date.now();
        return data;
      } catch (err) {
        lastErr = err;
        if (!isNetworkish(err)) throw err;
      }
      // Alternate transport once per attempt
      try {
        var data2 = await oneAttempt(!(preferXhr && method !== "GET"));
        lastWakeOkAt = Date.now();
        return data2;
      } catch (err2) {
        lastErr = err2;
        if (!isNetworkish(err2)) throw err2;
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
    throw lastErr || new Error("Request failed");
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
        options.body
          ? options.body instanceof FormData
            ? options.body
            : JSON.stringify(options.body)
          : null
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
    var t = options.signal ? null : fetchTimeout(options.timeout || 90000);
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
    role = String(role || "")
      .toLowerCase()
      .replace(/^userrole\./, "");
    if (role === "school_admin") return "office.html";
    if (role === "teacher" || role === "admin") return "teacher.html";
    if (role === "kind") return "kind.html";
    if (role === "vendor") return "vendor.html";
    return "student.html";
  }

  function currentPageName() {
    try {
      var parts = String(location.pathname || "").split("/");
      return (parts[parts.length - 1] || "").toLowerCase() || "index.html";
    } catch (e) {
      return "";
    }
  }

  function requireAuth(expectedRoles) {
    var role = String(localStorage.getItem("sia_role") || "")
      .toLowerCase()
      .replace(/^userrole\./, "");
    var token = getToken();
    if (!token) {
      try {
        clearSession();
      } catch (e) {}
      if (currentPageName() !== "portal.html") {
        window.location.replace("portal.html?force=1&reason=auth");
      }
      return false;
    }
    if (expectedRoles && expectedRoles.indexOf(role) < 0) {
      var dest = dashboardForRole(role);
      var here = currentPageName();
      // Prevent blink loop: never redirect to the same page.
      if (here === String(dest || "").toLowerCase()) {
        try {
          clearSession();
        } catch (e2) {}
        window.location.replace("portal.html?force=1&reason=role");
        return false;
      }
      window.location.replace(dest);
      return false;
    }
    // Persist normalized role so later checks stay stable
    try {
      if (role) localStorage.setItem("sia_role", role);
    } catch (e3) {}
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
  global.api = global.ScholaxiaAPI;
})(window);
