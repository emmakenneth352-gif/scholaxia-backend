/*
 * Scholaxia Examination Portal — desktop port of static/app/exam-app.html.
 * Same UI and same offline engine as the website (§13–§24):
 *   reg number + access code login → exam cards → download package →
 *   offline CBT runner → sealed submissions sync when back online.
 * Desktop adaptations only:
 *   - API base: desktop-server proxy (/api-proxy) on 127.0.0.1/localhost,
 *     same-origin on prod domains (mirrors js/api.js).
 *   - Session keys: sia_exam_token / sia_exam_user (desktop-wide exam session),
 *     with one-time migration from the website keys (sx_exam_token / sx_exam_user).
 */
(function () {
  var API;
  (function detectApi() {
    var host = "";
    try { host = String((window.location && window.location.hostname) || "").toLowerCase(); } catch (e) {}
    if (host === "127.0.0.1" || host === "localhost") {
      API = window.location.origin + "/api-proxy/api/v1";
      return;
    }
    if (/scholaxia1\.onrender\.com$/.test(host) || /\.scholaxia\.com$/.test(host)) {
      API = window.location.origin + "/api/v1";
      return;
    }
    API = "https://scholaxia1.onrender.com/api/v1";
  })();

  var TK = "sia_exam_token", TU = "sia_exam_user";
  // One-time migration from the website portal keys so a student who already
  // downloaded exams on this device keeps their packages + session.
  try {
    var legacyTok = localStorage.getItem("sx_exam_token");
    if (legacyTok && !localStorage.getItem(TK)) localStorage.setItem(TK, legacyTok);
    var legacyUser = localStorage.getItem("sx_exam_user");
    if (legacyUser && !localStorage.getItem(TU)) localStorage.setItem(TU, legacyUser);
  } catch (e) { /* ignore */ }

  var S = { token: localStorage.getItem(TK) || null, me: null, exams: [], current: null, loginTyped: null };
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };

  function toast(msg) { var t = $("toast"); t.textContent = msg; t.style.display = "block"; clearTimeout(t._h); t._h = setTimeout(function () { t.style.display = "none"; }, 3200); }
  function detailOf(d) {
    if (!d) return null;
    var det = d.detail != null ? d.detail : (d.message != null ? d.message : null);
    if (det == null) return null;
    if (typeof det === "string") return det;
    if (Array.isArray(det)) return det.map(function (v) { return v && v.msg ? v.msg : ""; }).filter(Boolean).join("; ") || "Invalid input";
    try { return det.msg || JSON.stringify(det); } catch (_) { return "Request failed"; }
  }
  function isOnline() { return navigator.onLine !== false; }
  function api(path, opts) {
    opts = opts || {};
    var h = {};
    if (!opts.form) h["Content-Type"] = "application/json";
    if (S.token) h["Authorization"] = "Bearer " + S.token;
    return fetch(API + path, { method: opts.method || "GET", headers: h, body: opts.body ? JSON.stringify(opts.body) : undefined })
      .then(function (r) {
        return r.text().then(function (txt) {
          var d = null; try { d = txt ? JSON.parse(txt) : null; } catch (_) {}
          if (r.status === 401 && path !== "/school-cbt/student/login") {
            logout();
            var ex401 = new Error(detailOf(d) || "Session expired — log in again."); ex401.status = 401; throw ex401;
          }
          if (!r.ok) { var exHttp = new Error(detailOf(d) || ("Request failed (" + r.status + ")")); exHttp.status = r.status; throw exHttp; }
          return d;
        });
      });
  }

  /* ── TRUE OFFLINE STORE (§16–§23) — one localStorage key per exam ──
     sia_exam_pkg_<id>    : downloaded exam package (server-verified order)
     sia_attempt_<examId> : { attemptId, exam, seconds, questions, answers, flags } — survives reload/offline
     sia_offq_<examId>    : answers saved on the device while offline
     sia_pending_<examId> : sealed FULL submission awaiting secure sync
  */
  var K = {
    pkg: function (id) { return "sia_exam_pkg_" + id; },
    att: function (id) { return "sia_attempt_" + id; },
    pend: function (id) { return "sia_pending_" + id; },
  };
  var LEGACY_PREFIX = { pkg: "sx_exam_pkg_", att: "sx_attempt_", offq: "sx_offq_", pend: "sx_pending_", seal: "sx_sealed_" };
  function migrateKey(k) {
    // Website-portal data (sx_*) from a previous version keeps working under the new sia_* keys.
    if (k.indexOf("sx_exam_pkg_") === 0) return K.pkg(k.slice(LEGACY_PREFIX.pkg.length));
    if (k.indexOf("sx_attempt_") === 0) return K.att(k.slice(LEGACY_PREFIX.att.length));
    if (k.indexOf("sx_offq_") === 0) return "sia_offq_" + k.slice(LEGACY_PREFIX.offq.length);
    if (k.indexOf("sx_pending_") === 0) return K.pend(k.slice(LEGACY_PREFIX.pend.length));
    if (k.indexOf("sx_sealed_") === 0) return "sia_sealed_" + k.slice(LEGACY_PREFIX.seal.length);
    return k;
  }
  function lsKeys(prefix) {
    var out = [];
    try {
      Object.keys(localStorage).forEach(function (k) {
        if (k.indexOf(prefix) === 0) { var nk = migrateKey(k); if (nk !== k) { try { localStorage.setItem(nk, localStorage.getItem(k)); localStorage.removeItem(k); } catch (e) {} out.push(nk); } else out.push(k); }
      });
    } catch (e) {}
    return out;
  }
  function lsGet(k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  /* ── Durable offline identity ──
     The typed reg + access code are remembered across reloads, so a package
     downloaded in a LATER session (after the one-time login handoff was
     consumed) still carries the access code that sealed submissions need for
     silent re-login when the internet returns. Without this, a device that
     downloaded an exam after a reload could never auto-sync. */
  var SI_KEY = "sia_exam_identity";
  function rememberIdentity(reg, code) {
    try { localStorage.setItem(SI_KEY, JSON.stringify({ reg_number: String(reg || "").trim(), access_code: String(code || "").trim() })); } catch (e) {}
  }
  function knownIdentity(reg) {
    try {
      var id = JSON.parse(localStorage.getItem(SI_KEY) || "null");
      if (id && id.access_code && (!reg || String(id.reg_number || "").toUpperCase() === String(reg || "").toUpperCase())) return id;
    } catch (e) {}
    return null;
  }
  function backfillPkgIdentities() {
    // Devices that already downloaded packages before this fix: fill in the
    // access code from the remembered identity so their seals can sync.
    lsKeys("sia_exam_pkg_").concat(lsKeys("sx_exam_pkg_")).forEach(function (k) {
      var pkg = lsGet(k);
      if (pkg && pkg.student && !pkg.student.access_code) {
        var id = knownIdentity(pkg.student.reg_number);
        if (id) { pkg.student.access_code = id.access_code; lsSet(k, pkg); }
      }
    });
  }

  /* Offline answer queue (per exam) — saved locally, flushed when online. */
  function offlineQueueKey(examId) { return "sia_offq_" + examId; }
  function queueOffline(examId, entry) {
    var q = lsGet(offlineQueueKey(examId)) || [];
    for (var i = 0; i < q.length; i++) {
      if (q[i].question_id === entry.question_id) { q[i] = entry; entry = null; break; }
    }
    if (entry) q.push(entry);
    lsSet(offlineQueueKey(examId), q);
  }
  function drainOfflineQueue(examId) {
    var q = lsGet(offlineQueueKey(examId)) || [];
    if (!q.length || !S.token) return Promise.resolve(0);
    return api("/school-cbt/student/sync", {
      method: "POST",
      body: { attempt_id: (lsGet(K.att(examId)) || {}).attemptId || null, exam_id: examId, answers: q, offline_sync: true, client: "desktop-offline" },
    }).then(function () { lsDel(offlineQueueKey(examId)); return q.length; });
  }
  function flushAllQueues() {
    if (!isOnline()) return;
    if (S.token) {
      lsKeys("sia_offq_").concat(lsKeys("sx_offq_")).forEach(function (k) {
        drainOfflineQueue(k.replace(/^sia_offq_|^sx_offq_/, "")).catch(function () {});
      });
    }
    // Sealed submissions sync even with no active session — they silently
    // re-authenticate with the device identity (reg + access code), so a
    // sealed exam uploads as soon as the internet returns, without waiting
    // for the next student to log in.
    lsKeys("sia_pending_").concat(lsKeys("sx_pending_")).forEach(function (k) {
      syncPendingExam(k.replace(/^sia_pending_|^sx_pending_/, ""), null, { silent: true }).catch(function () {});
    });
  }
  window.addEventListener("online", function () { toast("🌐 Back online — syncing…"); flushAllQueues(); if (S.me) loadExams(); });

  window.toggleEye = function () {
    var el = $("lgCode");
    el.type = el.type === "password" ? "text" : "password";
  };
  window.retrieveDetails = function () {
    toast("Ask your school exam officer — they issued your Registration Number and Access Code.");
  };
  function logout() {
    localStorage.removeItem(TK); localStorage.removeItem(TU);
    S.token = null; S.me = null; location.reload();
  }
  window.examLogout = logout;

  /* ── AUTO LOGOUT after submit (§24): one student per device at a time.
        On submission the device is SEALED — the student sees the completion
        screen, then the account is cleared and the login screen returns for
        the next student. Sealed submissions keep syncing in the background. ── */
  function scheduledLogout(examId, seconds) {
    setTimeout(function () {
      lsDel(K.att(examId));
      lsDel(offlineQueueKey(examId));
      toast("✓ Submitted — logging out. Hand over to the next student.");
      setTimeout(function () { logout(); }, 800);
      // sia_pending_<examId> + sia_sealed_<examId> stay on the device until the
      // submission syncs; pendingSealOnBoot() clears them afterwards.
    }, Math.max(4000, (seconds || 12) * 1000));
  }
  function pendingSealOnBoot() {
    lsKeys("sia_sealed_").concat(lsKeys("sx_sealed_")).forEach(function (k) {
      var examId = k.replace(/^sia_sealed_|^sx_sealed_/, "");
      if (!lsGet(K.pend(examId))) lsDel(k); // sync already finished — clear the seal
    });
  }

  $("loginForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var reg = $("lgReg").value.trim(), code = $("lgCode").value.trim();
    if (!isOnline()) return offlineLogin(reg, code);
    var btn = $("lgBtn"), err = $("lgErr");
    err.style.display = "none";
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Logging in…';
    S.loginTyped = { reg: reg, code: code };
    rememberIdentity(reg, code);
    api("/school-cbt/student/login", { method: "POST", body: { reg_number: reg, access_code: code } })
      .then(function (d) {
        S.token = d.access_token; S.me = d.student;
        localStorage.setItem(TK, S.token);
        localStorage.setItem(TU, JSON.stringify(d.student));
        flushAllQueues();
        enterHome();
      })
      .catch(function (ex) {
        btn.disabled = false; btn.innerHTML = "⮕&nbsp; Login to Examination";
        var dev = findOfflineIdentity(reg);
        var networkish = !ex.status || ex.status >= 500 || /failed to fetch|networkerror|load failed|aborted/i.test(ex.message || "");
        if (dev && !isOnline()) {
          return offlineLogin(reg, code);
        }
        if (dev && networkish) {
          err.innerHTML = "Cannot reach the server — but this device holds an offline exam for <b>" + esc(reg) + "</b>. <a href='#' id='offGo' style='color:var(--blue);font-weight:700'>Continue offline →</a>";
          err.style.display = "block";
          $("offGo").onclick = function (ev) { ev.preventDefault(); offlineLogin(reg, code); };
          return;
        }
        err.textContent = ex.message || "Could not log in"; err.style.display = "block";
      });
  });

  /* ── Offline identity: a downloaded package remembers WHO downloaded it
        (reg + access code typed at login), so the device can authenticate
        the student offline later. ── */
  function findOfflineIdentity(reg) {
    var found = null;
    lsKeys("sia_exam_pkg_").concat(lsKeys("sx_exam_pkg_")).forEach(function (k) {
      if (found) return;
      var pkg = lsGet(k);
      if (pkg && pkg.student && String(pkg.student.reg_number || "").toUpperCase() === String(reg || "").toUpperCase()) {
        found = { examId: k.replace(/^sia_exam_pkg_|^sx_exam_pkg_/, ""), student: pkg.student };
      }
    });
    return found;
  }
  function storeOfflineIdentity(pkg, typed) {
    var reg = (typed && typed.reg) || (S.me && S.me.reg_number) || "";
    var id = knownIdentity(reg);
    pkg.student = {
      reg_number: reg,
      access_code: (typed && typed.code) || (id && id.access_code) || "",
      full_name: (S.me && S.me.full_name) || "",
      class_name: (S.me && S.me.class_name) || "",
    };
    lsSet(K.pkg(pkg.exam.id), pkg);
  }
  function offlineLogin(reg, code) {
    var err = $("lgErr"), btn = $("lgBtn");
    btn.disabled = false; btn.innerHTML = "⮕&nbsp; Login to Examination";
    var dev = findOfflineIdentity(reg);
    if (!dev) { err.textContent = "This device has no offline exam for that registration number."; err.style.display = "block"; return; }
    if (String(dev.student.access_code || "").toUpperCase() !== String(code || "").toUpperCase()) {
      err.textContent = "Wrong access code for this offline examination."; err.style.display = "block"; return;
    }
    S.me = { full_name: dev.student.full_name, reg_number: dev.student.reg_number };
    S.token = null; // offline session — sealed submissions log back in to sync
    S.loginTyped = { reg: reg, code: code };
    rememberIdentity(reg, code);
    localStorage.setItem(TU, JSON.stringify(S.me));
    enterHome();
    toast("📴 Offline mode — answers are saved on this device and sync automatically.");
  }

  function enterHome() {
    $("login").style.display = "none";
    $("app").classList.remove("hidden");
    $("whoBox").innerHTML = '<span class="ava">' + esc((S.me && S.me.full_name || "S").charAt(0).toUpperCase()) + '</span><span class="wname">' + esc(S.me && S.me.full_name || "") + '</span>' +
      ' <button class="btn-nav" style="padding:8px 14px;margin-left:8px" onclick="examLogout()">Log out</button>';
    $("hello").textContent = "Welcome, " + ((S.me && S.me.full_name || "").split(" ")[0] || "student");
    loadExams();
  }
  function tryResume() {
    var u = localStorage.getItem(TU);
    if (S.token && u) { try { S.me = JSON.parse(u); enterHome(); } catch (e) { logout(); return; } }
    else if (!S.token && u && !isOnline()) { try { S.me = JSON.parse(u); enterHome(); } catch (e2) { localStorage.removeItem(TU); } }
    pendingSealOnBoot();
  }

  function fmtDur(mins) {
    var h = Math.floor(mins / 60), m = mins % 60;
    return (h ? h + " Hour" + (h > 1 ? "s" : "") + (m ? " " : "") : "") + (m || !h ? m + " Minutes" : "");
  }
  function loadExams() {
    if (!S.token) { renderOfflineExams(); return; }
    api("/school-cbt/student/my-exams").then(function (d) {
      S.exams = d.exams || [];
      // A granted retake invalidates anything cached on this device: drop the
      // old attempt and the old downloaded paper so the next start/download
      // gets a fresh randomized set of questions. Clear it exactly once so a
      // freshly downloaded paper is not wiped on the next refresh.
      S.exams.forEach(function (x) {
        var rk = "sia_retake_cleared_" + x.id;
        if (x.retake_granted) {
          if (!lsGet(rk)) {
            lsDel(K.att(x.id));
            lsDel(K.pkg(x.id));
            lsDel("sx_attempt_" + x.id);
            lsDel("sx_exam_pkg_" + x.id);
            lsSet(rk, true);
          }
        } else {
          lsDel(rk);
        }
      });
      $("examGrid").innerHTML = S.exams.length ? S.exams.map(examCard).join("") : '<div class="ecard">No examinations assigned to you yet.</div>';
      flushAllQueues();
    }).catch(function (e) {
      if (!isOnline()) renderOfflineExams();
      else $("examGrid").innerHTML = '<div class="ecard">' + esc(e.message) + '</div>';
    });
  }
  function examCard(x) {
    var mode = (x.exam_mode || "ONLINE").toUpperCase();
    var pill = '<span class="mode-pill ' + mode.toLowerCase() + '">' + (mode === "ONLINE" ? "🌐" : mode === "OFFLINE" ? "⬇" : "🔄") + " " + mode + "</span>";
    var pkg = lsGet(K.pkg(x.id));
    if (pkg) pill += ' <span class="mode-pill offline">📥 On this device</span>';
    var body = "";
    if (x.attempt_status === "submitted") {
      body = '<div class="okrow">✓ Completed</div>';
      if (x.result) body += '<div class="scorecard">Score: ' + esc(x.result.final_score) + " / " + esc(x.result.total_mark) + " (" + esc(x.result.grade) + ")</div>";
      else body += '<div class="scorecard" style="background:var(--warnbg);color:var(--warn)">Result waiting for your school to publish</div>';
    } else if (x.needs_download) {
      body = '<button class="btn-go dlbtn" onclick="downloadExam(\'' + x.id + '\')">⬇ Download Examination</button>';
    } else {
      body = '<button class="btn-go" onclick="openExam(\'' + x.id + '\')">' + (pkg && mode !== "ONLINE" ? "OPEN EXAM" : "START EXAM") + "</button>";
    }
    if (!x.window_open && x.attempt_status !== "submitted") {
      body = '<div class="okrow" style="color:var(--warn)">⏰ Not available yet — check your exam date</div>';
    }
    return '<div class="ecard">' +
      '<h3>' + esc(x.subject) + '</h3>' +
      '<div class="esub">' + esc(x.class_name) + (x.term ? " · " + esc(x.term) : "") + (x.session ? " · " + esc(x.session) : "") + '</div>' +
      '<div class="emeta"><span><b>' + x.questions + '</b> Questions</span><span><b>' + fmtDur(x.duration_minutes) + '</b></span><span>Total Mark: <b>' + x.total_mark + '</b></span></div>' +
      pill + body + '</div>';
  }
  /* Offline home: everything downloaded on this device + pending syncs. */
  function renderOfflineExams() {
    var rows = [];
    lsKeys("sia_exam_pkg_").concat(lsKeys("sx_exam_pkg_")).forEach(function (k) {
      var examId = k.replace(/^sia_exam_pkg_|^sx_exam_pkg_/, "");
      var pkg = lsGet(k); if (!pkg || !pkg.exam) return;
      var pend = lsGet(K.pend(examId));
      var att = lsGet(K.att(examId));
      var st = pend ? '<div class="scorecard" style="background:var(--warnbg);color:var(--warn)">⏳ Completed — waiting for secure sync</div>'
        : '<button class="btn-go" onclick="openExamOffline(\'' + examId + '\')">' + (att ? "CONTINUE EXAM" : "START EXAM") + " (offline)</button>";
      rows.push('<div class="ecard"><h3>' + esc(pkg.exam.subject || pkg.exam.title) + '</h3>' +
        '<div class="esub">' + esc(pkg.exam.class_name || "") + '</div>' +
        '<div class="emeta"><span><b>' + (pkg.questions || []).length + '</b> Questions</span><span><b>' + fmtDur(pkg.exam.duration_minutes) + '</b></span><span>Total Mark: <b>' + pkg.exam.total_mark + '</b></span></div>' +
        '<span class="mode-pill offline">📴 Offline — on this device</span>' + st + '</div>');
    });
    $("examGrid").innerHTML = rows.length ? rows.join("") :
      '<div class="ecard">You are offline and this device has no downloaded examinations.<br/><br/>Connect to the internet once, log in, and press <b>⬇ Download Examination</b> — after that the exam works fully offline.</div>';
  }

  window.downloadExam = function (examId) {
    toast("Downloading examination…");
    api("/school-cbt/student/exams/" + examId + "/download", { method: "POST" }).then(function (pkg) {
      storeOfflineIdentity(pkg, S.loginTyped || {});
      lsSet(K.pkg(examId), pkg);
      loadExams();
      toast("✓ Exam downloaded, verified and ready — works offline now");
    }).catch(function (e) { toast("⚠️ " + e.message); });
  };

  /* ══ CBT RUNNER — online and offline share one code path ══ */
  var R = null; // active runner state

  window.openExam = function (examId) {
    var pkg = lsGet(K.pkg(examId));
    if ((!isOnline() || !S.token) && pkg) return openExamOffline(examId);
    if (!isOnline()) { toast("You are offline — only downloaded exams can open."); return; }
    // Always let the server decide which attempt is live. Resuming from a
    // local cached attempt used to hide a granted retake (the old paper kept
    // reappearing). /start returns the in-progress attempt + saved answers.
    api("/school-cbt/student/exams/" + examId + "/start", { method: "POST" }).then(function (d) {
      R = {
        attemptId: d.attempt_id,
        exam: d.exam,
        seconds: d.seconds_remaining,
        questions: d.questions,
        idx: 0,
        answers: {},
        flags: {},
        pkgExamId: examId,
        offline: false,
      };
      d.questions.forEach(function (q) {
        if (q.saved_answer) R.answers[q.id] = q.saved_answer;
        if (q.is_flagged) R.flags[q.id] = true;
      });
      persistAttempt();
      startRunner();
    }).catch(function (e) { toast("⚠️ " + e.message); });
  };

  /* Offline start: run entirely from the downloaded package. The server
     attempt is created by /sync (start_offline) when internet returns. */
  window.openExamOffline = function (examId) {
    var pkg = lsGet(K.pkg(examId));
    if (!pkg) { toast("Package missing on this device."); return; }
    var att = lsGet(K.att(examId));
    if (att && att.questions) {
      R = att; R.idx = R.idx || 0; startRunner(); return;
    }
    R = {
      attemptId: null,
      exam: pkg.exam,
      seconds: (pkg.exam.duration_minutes || 60) * 60,
      questions: pkg.questions,
      idx: 0,
      answers: {},
      flags: {},
      pkgExamId: examId,
      offline: true,
      startedAt: new Date().toISOString(),
    };
    persistAttempt();
    startRunner();
    toast("📴 Offline exam started — everything saves on this device.");
  };

  function persistAttempt() {
    if (!R) return;
    lsSet(K.att(R.pkgExamId || R.exam.id), {
      attemptId: R.attemptId, exam: R.exam, seconds: R.seconds, questions: R.questions,
      idx: R.idx, answers: R.answers, flags: R.flags, offline: !!R.offline, startedAt: R.startedAt,
    });
  }

  function startRunner() {
    $("home").classList.add("hidden");
    $("exam").classList.remove("hidden");
    $("qSubject").textContent = R.exam.subject;
    var offlineTag = R.offline || !S.token ? " · 📴 Offline mode" : "";
    $("qSub").textContent = R.exam.title + " · " + R.questions.length + " Questions · " + fmtDur(R.exam.duration_minutes) + offlineTag;
    if (!R.exam.allow_flagging) $("flagBtn").style.display = "none";
    buildPalette();
    renderQ();
    tick(); clearInterval(R._th); R._th = setInterval(tick, 1000);
    window.addEventListener("beforeunload", persistAttempt);
  }
  function tick() {
    if (!R) return;
    R.seconds--;
    if (R.seconds % 15 === 0) persistAttempt();
    if (R.seconds <= 0) { R.seconds = 0; clearInterval(R._th); persistAttempt(); toast("Time is up — submitting…"); doSubmit(true); return; }
    var h = Math.floor(R.seconds / 3600), m = Math.floor((R.seconds % 3600) / 60), s = R.seconds % 60;
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    $("timer").textContent = p(h) + ":" + p(m) + ":" + p(s);
    if (R.seconds === 300) toast("⏰ 5 minutes remaining!");
  }
  function renderQ() {
    var q = R.questions[R.idx];
    $("qNum").textContent = "Question " + (R.idx + 1) + " of " + R.questions.length;
    $("qText").textContent = q.question_text;
    $("flagBtn").classList.toggle("on", !!R.flags[q.id]);
    $("flagBtn").innerHTML = R.flags[q.id] ? "⚑ Flagged ✓" : "⚑ Flag Question";
    $("btnPrev").style.display = R.exam.allow_previous === false && R.idx === 0 ? "none" : "";
    $("qOpts").innerHTML = (q.options || []).map(function (o) {
      var sel = R.answers[q.id] === o.label;
      return '<div class="opt' + (sel ? " sel" : "") + '" onclick="pick(\'' + o.label + '\')">' +
        '<span class="radio"></span><span class="ol">' + esc(o.label) + "</span><span>" + esc(o.text) + "</span></div>";
    }).join("");
    buildPalette();
  }
  window.pick = function (label) {
    var q = R.questions[R.idx];
    R.answers[q.id] = label;
    saveAnswer(q.id, label);
    renderQ();
  };
  function saveAnswer(qid, answer) {
    if (R.offline || !S.token || !isOnline()) {
      queueOffline(R.pkgExamId, { question_id: qid, answer: answer });
      return;
    }
    api("/school-cbt/student/answers", { method: "POST", body: { attempt_id: R.attemptId, question_id: qid, answer: answer } })
      .catch(function () { queueOffline(R.pkgExamId, { question_id: qid, answer: answer }); });
  }
  window.toggleFlag = function () {
    var q = R.questions[R.idx];
    R.flags[q.id] = !R.flags[q.id];
    if (!R.offline && S.token && isOnline()) {
      api("/school-cbt/student/answers", { method: "POST", body: { attempt_id: R.attemptId, question_id: q.id, is_flagged: R.flags[q.id] } })
        .catch(function () { queueOffline(R.pkgExamId, { question_id: q.id, is_flagged: R.flags[q.id] }); });
    } else {
      queueOffline(R.pkgExamId, { question_id: q.id, is_flagged: R.flags[q.id] });
    }
    renderQ();
  };
  window.move = function (dir) {
    var n = R.idx + dir;
    if (n < 0 || n >= R.questions.length) { if (n >= R.questions.length) openSummary(); return; }
    R.idx = n;
    persistAttempt();
    renderQ();
  };
  function buildPalette() {
    $("palette").innerHTML = R.questions.map(function (q, i) {
      var cls = "pal";
      if (i === R.idx) cls += " cur";
      else if (R.answers[q.id]) cls += " ans";
      if (R.flags[q.id]) cls += " mk";
      return '<button class="' + cls + '" onclick="jump(' + i + ')">' + (i + 1) + "</button>";
    }).join("");
  }
  window.jump = function (i) { R.idx = i; persistAttempt(); renderQ(); };

  /* ── SUBMIT FLOW (§22) ── */
  window.openSummary = function () {
    var total = R.questions.length;
    var answered = R.questions.filter(function (q) { return R.answers[q.id]; }).length;
    var marked = R.questions.filter(function (q) { return R.flags[q.id]; }).length;
    var b = document.createElement("div"); b.className = "mback"; b.id = "sumM";
    b.innerHTML = '<div class="mmodal"><h3>Examination Summary</h3>' +
      '<div class="sumrow"><span>Total Questions</span><b>' + total + "</b></div>" +
      '<div class="sumrow"><span>Answered</span><b style="color:var(--ok)">' + answered + "</b></div>" +
      '<div class="sumrow"><span>Not Answered</span><b style="color:var(--bad)">' + (total - answered) + "</b></div>" +
      '<div class="sumrow" style="border:none"><span>Marked for Review</span><b style="color:var(--warn)">' + marked + "</b></div>" +
      '<div class="mnote">Are you sure you want to submit? You will not be able to change your answers after final submission.</div>' +
      '<div class="macts"><button class="btn-m" id="sumCancel">Review Answers</button><button class="btn-m danger" id="sumGo">Submit</button></div></div>';
    document.body.appendChild(b);
    $("sumCancel").onclick = function () { b.remove(); };
    $("sumGo").onclick = function () { b.remove(); doSubmit(false); };
  };
  function allAnswers() {
    return R.questions.map(function (q) {
      var item = { question_id: q.id };
      if (R.answers[q.id]) item.answer = R.answers[q.id];
      if (R.flags[q.id]) item.is_flagged = true;
      return item;
    }).filter(function (it) { return it.answer || it.is_flagged; });
  }
  function doSubmit(auto) {
    var examId = R.pkgExamId;
    var payload = {
      attempt_id: R.attemptId,
      is_auto_submit: !!auto,
      client: "desktop-portal",
      started_at: R.startedAt || null,
      submitted_at: new Date().toISOString(),
      answers: allAnswers(),
    };
    if (!S.token || !isOnline()) { showOfflineWait(payload); return; }
    var flush = drainOfflineQueue(examId).catch(function () {});
    flush.then(function () {
      return api("/school-cbt/student/exams/" + R.exam.id + "/submit", { method: "POST", body: payload });
    }).then(function (d) {
      lsDel(K.att(examId));
      lsDel(offlineQueueKey(examId));
      showCompletion(d);
    }).catch(function () { showOfflineWait(payload); });
  }
  function showOfflineWait(payload) {
    // §23 — seal the FULL submission (every answer) on the device; it syncs
    // automatically when the network returns, then the device logs out.
    var examId = R.pkgExamId;
    lsSet(K.pend(examId), payload);
    lsSet("sia_sealed_" + examId, { at: payload.submitted_at });
    if (R && R._th) clearInterval(R._th);
    persistAttempt();
    var b = document.createElement("div"); b.className = "mback"; b.id = "pendModal";
    b.innerHTML = '<div class="mmodal"><h3>Examination Completed</h3>' +
      '<p style="font-size:14.5px;line-height:1.6">Your answers have been securely saved on this device.<br/><br/>' +
      (isOnline() ? "Finalizing your submission…" : "Internet connection is currently unavailable.") +
      '<br/>Your examination will be securely synchronized when a connection becomes available.</p>' +
      '<div class="syncbox wait" id="syncBox">STATUS: Waiting for Secure Sync…</div>' +
      '<div class="macts"><button class="btn-m primary" id="syncClose">OK</button></div></div>';
    document.body.appendChild(b);
    $("syncClose").onclick = function () { b.remove(); scheduledLogout(examId, 6); };
    watchSync(payload);
  }
  function watchSync(payload) {
    var tries = 0;
    var examId = R ? R.pkgExamId : payload.exam_id;
    var h = setInterval(function () {
      tries++;
      var box = $("syncBox");
      if (!box) { clearInterval(h); return; }
      box.textContent = "Connecting…";
      syncPendingExam(examId, payload).then(function () {
        clearInterval(h);
        lsDel(K.att(examId));
        lsDel(offlineQueueKey(examId));
        lsDel("sia_sealed_" + examId);
        box.className = "syncbox done";
        box.textContent = "✓ Connecting… Verifying examination… Uploading answers… Submission Successful";
        setTimeout(function () { var m = $("pendModal"); if (m) m.remove(); scheduledLogout(examId, 8); }, 1600);
      }).catch(function () {
        if (box) box.textContent = "STATUS: Waiting for Secure Sync…";
        if (tries > 60) clearInterval(h);
      });
    }, 8000);
  }
  function sealAlreadyCounted(ex) {
    // The school already counted this exam for the student (submitted on
    // another device, or an old seal after a retake) — stop retrying forever.
    return !!ex && (ex.status === 403 || ex.status === 409) && /already taken|already submitted/i.test(ex.message || "");
  }
  function clearSeal(examId) {
    lsDel(K.pend(examId));
    lsDel("sia_sealed_" + examId);
  }
  function syncPendingExam(examId, payloadOverride, opts) {
    opts = opts || {};
    var pend = payloadOverride || lsGet(K.pend(examId));
    if (!pend) return Promise.reject(new Error("nothing pending"));
    var body = {
      attempt_id: pend.attempt_id || null,
      exam_id: examId,
      start_offline: !pend.attempt_id,
      answers: pend.answers || [],
      submit: true,
      is_auto_submit: !!pend.is_auto_submit,
      started_at: pend.started_at || null,
      submitted_at: pend.submitted_at || null,
      client: "desktop-offline",
    };
    if (!S.token) {
      // Offline session — log back in silently with the device identity, sync, logout.
      var ident = (S.me && S.me.reg_number) || (lsGet(TU) || {}).reg_number || "";
      var dev = findOfflineIdentity(ident);
      if (!dev) {
        // Session was cleared (e.g. post-submit auto-logout): the downloaded
        // package for THIS exam carries the student's reg number + access code.
        var ownPkg = lsGet(K.pkg(examId));
        if (ownPkg && ownPkg.student && ownPkg.student.reg_number) {
          dev = { examId: examId, student: ownPkg.student };
        }
      }
      if (dev && dev.student && !dev.student.access_code) {
        var kid = knownIdentity(dev.student.reg_number);
        if (kid) dev.student.access_code = kid.access_code;
      }
      if (!dev || !dev.student.access_code) return Promise.reject(new Error("no offline identity"));
      return api("/school-cbt/student/login", { method: "POST", body: { reg_number: dev.student.reg_number, access_code: dev.student.access_code } })
        .then(function (d) {
          S.token = d.access_token;
          localStorage.setItem(TK, S.token);
          return api("/school-cbt/student/sync", { method: "POST", body: body });
        })
        .then(function () { clearSeal(examId); if (!opts.silent) logout(); })
        .catch(function (ex) { if (sealAlreadyCounted(ex)) { clearSeal(examId); return; } throw ex; });
    }
    return api("/school-cbt/student/sync", { method: "POST", body: body }).then(function () {
      clearSeal(examId);
    }).catch(function (ex) { if (sealAlreadyCounted(ex)) { clearSeal(examId); return; } throw ex; });
  }
  function showCompletion(d) {
    var s = (d && d.summary) || {};
    var b = document.createElement("div"); b.className = "mback";
    var scoreHTML = "";
    if (s.final_score != null) {
      scoreHTML = '<div class="sumrow"><span>Your Score</span><b style="color:var(--ok)">' + s.final_score + " / " + s.total_mark + " (" + esc(s.grade || "") + ")</b></div>";
    } else {
      scoreHTML = '<div class="sumrow"><span>Result</span><b style="color:var(--warn)">Calculated — ready for your school to publish</b></div>';
    }
    b.innerHTML = '<div class="mmodal"><h3>✅ Examination Submitted</h3>' +
      '<div class="sumrow"><span>Questions</span><b>' + (s.total_questions != null ? s.total_questions : (R ? R.questions.length : 0)) + "</b></div>" +
      '<div class="sumrow"><span>Answered</span><b>' + (s.answered != null ? s.answered : answeredCount()) + "</b></div>" +
      scoreHTML +
      '<div class="mnote">' + esc((d && d.message) || "Submitted successfully. You will be logged out automatically.") + "</div>" +
      '<div class="macts"><button class="btn-m primary" id="doneGo">Done</button></div></div>';
    document.body.appendChild(b);
    scheduledLogout(R ? R.pkgExamId : null, 12);
    $("doneGo").onclick = function () { b.remove(); logout(); };
  }
  function answeredCount() { return R ? R.questions.filter(function (q) { return R.answers[q.id]; }).length : 0; }
  window.goHome = function () {
    if (R) { clearInterval(R._th); persistAttempt(); }
    R = null;
    $("exam").classList.add("hidden");
    $("home").classList.remove("hidden");
    loadExams();
  };

  /* boot */
  // Consume the credentials typed on the auth page's Exam tab (index.html),
  // so packages downloaded after that login still carry the offline identity
  // (reg + access code) needed for offline re-login and silent sync.
  try {
    var handoff = localStorage.getItem("sia_exam_login_typed");
    if (handoff) {
      S.loginTyped = JSON.parse(handoff);
      if (S.loginTyped && S.loginTyped.reg) rememberIdentity(S.loginTyped.reg, S.loginTyped.code);
      if (!S.me) {
        try { S.me = JSON.parse(localStorage.getItem(TU) || "null"); } catch (e2) {}
      }
      if (S.me) localStorage.removeItem("sia_exam_login_typed"); // consumed
    }
  } catch (e) {}
  tryResume();
  backfillPkgIdentities();
  flushAllQueues();
})();
