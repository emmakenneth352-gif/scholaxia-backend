/* Scholaxia — Student Portal
   Functional dashboard wired to the production backend via window.ScholaxiaAPI.
*/
(function () {
  "use strict";

  var api = window.ScholaxiaAPI;
  if (!api || !api.requireAuth(["student"])) return;

  /* =====================================================================
     Small utilities
     ===================================================================== */

  function $(id) {
    return document.getElementById(id);
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function fmtDate(v) {
    if (!v) return "";
    var d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function errMsg(err) {
    var msg = (err && err.message) || "Something went wrong. Please try again.";
    // Prefer real API detail when present (join/live/groups)
    if (err && err.data) {
      var d0 = err.data.detail || err.data.message || err.data;
      if (typeof d0 === "object" && d0) {
        var detail0 = d0.message || d0.detail || "";
        if (detail0) msg = String(detail0);
      } else if (typeof d0 === "string" && d0.trim()) {
        msg = d0;
      }
    }
    if (err && (err.status === 401 || err.status === 403)) {
      if (/not invited|private class|subjects|plan|Students only|kid learners/i.test(msg)) {
        return msg;
      }
      return "Your session expired. Log out and log in again, then open Groups/Community.";
    }
    if (err && err.status >= 500) {
      if (msg && !/^Request failed$/i.test(msg)) {
        var clean = String(msg).replace(/\s*\(Background on this error[\s\S]*$/i, "").trim();
        if (clean && !/^Internal Server Error$/i.test(clean)) {
          return clean.length > 240 ? clean.slice(0, 240) + "…" : clean;
        }
      }
      return "Server error loading this section. Tap Try again — if it keeps failing, wait a minute for a redeploy.";
    }
    if (/failed to fetch|networkerror|load failed/i.test(msg)) {
      return "Cannot reach the Scholaxia API. Wait a minute if the server is waking up, then tap Try again.";
    }
    if (/aborted|abort/i.test(msg) || (err && err.name === "AbortError")) {
      return "Server took too long. Wait 30 seconds and try again (Render may be waking up).";
    }
    // Unwrap JSON-looking detail blobs from FastAPI
    try {
      if (msg.charAt(0) === "{") {
        var parsed = JSON.parse(msg);
        if (parsed && (parsed.message || parsed.detail || parsed.code)) {
          return parsed.message || parsed.detail || msg;
        }
      }
    } catch (e) { /* ignore */ }
    return msg;
  }

  function isCbtPackageError(err) {
    var raw = ((err && err.message) || "") + JSON.stringify((err && err.data) || {});
    return /cbt_package|package_required|402/i.test(raw);
  }

  function loadingHtml(msg) {
    return '<div class="loading-state">' + esc(msg || "Loading…") + "</div>";
  }

  function emptyHtml(icon, msg) {
    return (
      '<div class="empty-state"><span class="empty-icon">' +
      (icon || "✨") +
      "</span><strong style=\"display:block;margin-bottom:0.35rem;color:#0f172a\">Nothing here yet</strong>" +
      esc(msg || "Check back soon.") +
      "</div>"
    );
  }

  function errorHtml(msg, retryAttr) {
    return (
      '<div class="error-state">⚠ ' +
      esc(msg || "Could not load this.") +
      (retryAttr
        ? '<br /><button type="button" data-retry="' + retryAttr + '">Try again</button>'
        : "") +
      ' <button type="button" data-fix-session style="margin-left:0.5rem">Log in again</button>' +
      '<div class="api-ping" style="margin-top:0.65rem;font-size:0.78rem;opacity:.85" data-api-ping>Checking API…</div>' +
      "</div>"
    );
  }

  function forceRelogin() {
    try {
      if (api && api.clearSession) api.clearSession();
    } catch (e) {}
    try {
      ["sia_token", "sia_teacher_token", "sia_school_token", "sia_role", "sia_name", "sia_email"].forEach(function (k) {
        localStorage.removeItem(k);
      });
    } catch (e2) {}
    window.location.href = "portal.html?v=20260827q&force=1&reason=session";
  }

  document.addEventListener("click", function (e) {
    if (e.target && e.target.closest && e.target.closest("[data-fix-session]")) {
      e.preventDefault();
      forceRelogin();
    }
  });

  function runApiPing(lastErr) {
    var nodes = document.querySelectorAll("[data-api-ping]");
    if (!nodes.length) return;
    var status = lastErr && lastErr.status;
    var base = (api && api.API_BASE) || "https://scholaxia1.onrender.com";
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = setTimeout(function () {
      try {
        if (ctrl) ctrl.abort();
      } catch (e) {}
    }, 12000);
    fetch(base + "/health", {
      method: "GET",
      mode: "cors",
      cache: "no-store",
      signal: ctrl ? ctrl.signal : undefined,
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function (out) {
        clearTimeout(timer);
        var online = out.ok && out.data && out.data.status === "ok";
        var text;
        if (!online) {
          text = "API health returned an unexpected response.";
        } else if (status === 401 || status === 403) {
          text = "API is online. Your login session is broken — tap Log in again.";
        } else if (status >= 500) {
          text = "API is online, but this page hit a server error. Tap Try again in a moment.";
        } else {
          text = "API is online. Tap Try again. If it still fails, tap Log in again.";
        }
        nodes.forEach(function (n) {
          n.textContent = text;
        });
      })
      .catch(function () {
        clearTimeout(timer);
        nodes.forEach(function (n) {
          n.textContent =
            "This browser cannot reach " +
            base +
            ". Try another network, or open https://scholaxia1.onrender.com/app/student.html after Manual Deploy.";
        });
      });
  }

  function setStatus(el, msg, ok) {
    if (!el) return;
    el.textContent = msg || "";
    el.className = "form-status" + (msg ? (ok ? " ok" : " err") : "");
  }

  function firstArray(data, keys) {
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== "object") return [];
    for (var i = 0; i < keys.length; i++) {
      if (Array.isArray(data[keys[i]])) return data[keys[i]];
    }
    return [];
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      var args = arguments;
      clearTimeout(t);
      t = setTimeout(function () {
        fn.apply(null, args);
      }, ms || 250);
    };
  }

  function readLocalJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function writeLocalJson(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) {}
  }

  /* =====================================================================
     Header / identity
     ===================================================================== */

  var user = api.getUser();
  var nameEl = $("userName");
  var av = $("userAv");
  if (nameEl) nameEl.textContent = user.name;
  if (av) av.textContent = (user.name || "S").charAt(0).toUpperCase();

  var hour = new Date().getHours();
  var greet =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  var dashGreetingEl = $("dashGreeting");
  if (dashGreetingEl) {
    dashGreetingEl.textContent =
      greet + ", " + (user.name || "Student").split(" ")[0];
  }

  function refreshLocalExamBadges() {
    var examType = localStorage.getItem("sia_exam_type") || "";
    var subjects = readLocalJson("sia_subjects", []);
    if (!Array.isArray(subjects)) subjects = [];

    if ($("examPill")) $("examPill").textContent = examType ? examType.toUpperCase() : "Student";
    if ($("dashExamType")) $("dashExamType").textContent = examType ? examType.toUpperCase() : "Your exam";
    if ($("dashSubjCount"))
      $("dashSubjCount").textContent = subjects.length ? subjects.length + " subjects" : "Your subjects";
    if ($("dashFocus")) $("dashFocus").textContent = subjects.length ? subjects.slice(0, 2).join(", ") : "Set up subjects";
    if ($("dashSubjectsText"))
      $("dashSubjectsText").textContent =
        subjects.length + " subject" + (subjects.length === 1 ? "" : "s") + " selected";
    if ($("statSubjects")) $("statSubjects").textContent = String(subjects.length);
    if ($("profileExam")) $("profileExam").textContent = examType ? examType.toUpperCase() : "Not set";
    if ($("profileSubjects")) $("profileSubjects").textContent = subjects.length ? subjects.join(", ") : "None selected";
    return { examType: examType, subjects: subjects };
  }
  refreshLocalExamBadges();

  if ($("profileText")) {
    $("profileText").textContent = user.name + " · " + user.email + " · Student";
  }

  var logoutBtn = $("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      try {
        if (api && api.clearSession) api.clearSession();
      } catch (err) {}
      // force=1 stops auth/portal from bouncing straight back into the dashboard
      window.location.replace("portal.html?force=1&reason=logout&v=20260827q");
    });
  }

  /* =====================================================================
     Navigation / lazy page loading
     ===================================================================== */

  var PAGE_TITLES = {
    home: "Home",
    "study-materials": "Video Tutorials",
    coding: "Coding Tutorials",
    "past-questions": "Past Questions",
    cbt: "CBT Practice",
    school: "Scholaxia Exam",
    "access-code": "Live Class",
    live: "Live Class",
    "school-portal": "Examinations",
    subscription: "Subscription",
    skills: "Skills",
    library: "Library",
    games: "Games",
    assignments: "Assignments",
    sia: "Tutor AI",
    community: "Community",
    groups: "Groups",
    about: "About",
    contact: "Contact",
    profile: "Profile",
  };

  var loadedPages = {};

  var PAGE_LOADERS = {
    home: loadHome,
    "study-materials": loadStudyMaterials,
    coding: loadCodingTutorials,
    "past-questions": loadPastQuestions,
    cbt: loadCbt,
    school: loadSchoolExams,
    "access-code": function () { showPage("live"); },
    live: loadLive,
    "school-portal": loadSchoolPortal,
    subscription: loadSubscription,
    skills: loadSkills,
    library: loadLibrary,
    games: function () {
      if (typeof loadGamesPage === "function") loadGamesPage();
    },
    assignments: loadAssignments,
    community: loadCommunity,
    groups: loadGroups,
    profile: loadProfile,
  };

  var pageHistory = [];
  var currentPageId = "home";

  function showPage(id, opts) {
    opts = opts || {};
    if (id === "access-code") id = "live";
    if (id === "saved") id = "home";
    if (!PAGE_TITLES.hasOwnProperty(id)) id = "home";

    if (!opts.replace && currentPageId && currentPageId !== id) {
      pageHistory.push(currentPageId);
      if (pageHistory.length > 20) pageHistory = pageHistory.slice(-20);
    }
    currentPageId = id;

    document.querySelectorAll(".page").forEach(function (p) {
      p.classList.toggle("is-on", p.id === "page-" + id);
    });
    document.querySelectorAll(".side-link").forEach(function (b) {
      b.classList.toggle("is-active", b.dataset.page === id || (id === "live" && b.dataset.page === "live"));
    });
    if ($("pageTitle")) $("pageTitle").textContent = PAGE_TITLES[id] || "";
    var main = document.querySelector(".app-content");
    if (main) main.scrollTop = 0;

    updateBackBtn();

    if ((!loadedPages[id] || id === "games") && PAGE_LOADERS[id]) {
      if (id !== "games") loadedPages[id] = true;
      try {
        PAGE_LOADERS[id]();
      } catch (e) {
        console.error("Page load failed for", id, e);
      }
    }
  }

  function updateBackBtn() {
    var btn = $("backBtn");
    if (!btn) return;
    var show = currentPageId !== "home";
    btn.hidden = !show;
    btn.setAttribute("aria-hidden", show ? "false" : "true");
  }

  function goBack() {
    var prev = null;
    while (pageHistory.length) {
      prev = pageHistory.pop();
      if (prev && prev !== currentPageId) break;
      prev = null;
    }
    showPage(prev || "home", { replace: true });
  }

  document.querySelectorAll(".side-link, [data-goto]").forEach(function (el) {
    el.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      var page = el.dataset.page || el.dataset.goto;
      if (page) {
        showPage(page);
        if (window.matchMedia("(max-width: 900px)").matches) closeMobileNav();
      }
    });
  });

  // Delegate so dynamically rendered [data-goto] buttons (home cards, etc.) work
  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-goto]");
    if (!btn || btn.closest(".side-link")) return;
    // Side nav already handled above / capture handler
    if (btn.closest(".student-side")) return;
    var page = btn.getAttribute("data-goto") || btn.dataset.goto;
    if (!page) return;
    e.preventDefault();
    showPage(page);
    if (window.matchMedia("(max-width: 900px)").matches) closeMobileNav();
  });

  // Capture-phase fallback so mobile taps on icons/text still switch pages
  var sideNav = document.querySelector(".student-side");
  if (sideNav) {
    sideNav.addEventListener(
      "click",
      function (e) {
        var btn = e.target.closest(".side-link, [data-goto]");
        if (!btn) return;
        var page = btn.getAttribute("data-page") || btn.getAttribute("data-goto");
        if (!page) return;
        e.preventDefault();
        e.stopPropagation();
        showPage(page);
        if (window.matchMedia("(max-width: 900px)").matches) closeMobileNav();
      },
      true
    );
  }

  document.addEventListener("click", function (e) {
    var retryBtn = e.target.closest("[data-retry]");
    if (retryBtn) {
      var page = retryBtn.dataset.retry;
      loadedPages[page] = false;
      examsCacheByKind = {};
      examsForMeCache = null;
      var go = function () {
        if (PAGE_LOADERS[page]) PAGE_LOADERS[page]();
      };
      if (api.wakeServer) {
        retryBtn.disabled = true;
        retryBtn.textContent = "Waking server…";
        api
          .wakeServer(60000)
          .catch(function () { return null; })
          .then(go)
          .finally(function () {
            retryBtn.disabled = false;
            retryBtn.textContent = "Try again";
          });
      } else {
        go();
      }
      return;
    }
    var refreshBtn = e.target.closest("[data-refresh]");
    if (refreshBtn) {
      var p2 = refreshBtn.dataset.refresh;
      loadedPages[p2] = false;
      if (PAGE_LOADERS[p2]) PAGE_LOADERS[p2]();
    }
  });

  /* =====================================================================
     HOME
     ===================================================================== */

  function renderLiveCardMini(c) {
    var title = c.title || c.topic || c.subject || "Live class";
    var teacher = c.teacher_name || c.host_name || c.teacher || "";
    var id = c.id || c.class_id || "";
    return (
      '<div class="card">' +
      '<span class="card-tag">🔴 LIVE</span>' +
      "<h4>" +
      esc(title) +
      "</h4>" +
      (teacher ? '<p class="muted">' + esc(teacher) + "</p>" : "") +
      '<div class="card-foot"><button type="button" class="btn btn-primary btn-mini" data-join-live="' +
      esc(id) +
      '">Join now</button></div>' +
      "</div>"
    );
  }

  function loadHome() {
    api
      .api("/api/v1/students/me")
      .then(function (me) {
        if (!me) return;
        var name = me.full_name || me.name || user.name;
        if (nameEl && name) nameEl.textContent = name;
        if (av && name) av.textContent = String(name).charAt(0).toUpperCase();
        if (dashGreetingEl && name) {
          dashGreetingEl.textContent = greet + ", " + String(name).split(" ")[0];
        }
        if (me.exam_type) localStorage.setItem("sia_exam_type", me.exam_type);
        if (Array.isArray(me.subjects)) writeLocalJson("sia_subjects", me.subjects);
        refreshLocalExamBadges();
      })
      .catch(function () {});

    api
      .api("/api/v1/live-classes/?status=live")
      .then(function (data) {
        var items = firstArray(data, ["classes", "items", "results", "live_classes"]);
        if ($("statLive")) $("statLive").textContent = String(items.length || 0);
        var wrap = $("homeLiveNow");
        var titleWrap = $("homeLiveNowTitle");
        if (!wrap) return;
        if (!items.length) {
          wrap.innerHTML = "";
          if (titleWrap) titleWrap.style.display = "none";
          return;
        }
        if (titleWrap) titleWrap.style.display = "flex";
        wrap.innerHTML = items.slice(0, 3).map(renderLiveCardMini).join("");
      })
      .catch(function () {
        if ($("statLive")) $("statLive").textContent = "0";
      });

    api
      .api("/api/v1/cbt/exams/for-me")
      .then(function (data) {
        data = data || {};
        var count =
          (data.practice_exams || []).length +
          (data.jamb_exams || []).length +
          (data.ssce_exams || []).length +
          (data.school_exams || []).length;
        if ($("statExams")) $("statExams").textContent = String(count);
        cacheExamsForMe(data);
      })
      .catch(function () {
        if ($("statExams")) $("statExams").textContent = "—";
      });
  }

  /* =====================================================================
     STUDY ACCESS — any paid subscription unlocks videos + library
     ===================================================================== */

  var _studyAccessPromise = null;

  function fetchStudyAccess() {
    if (!_studyAccessPromise) {
      _studyAccessPromise = api
        .api("/api/v1/study-access", { timeout: 20000, retries: 1, preferXhr: true })
        .catch(function () {
          _studyAccessPromise = null; // allow retry on next visit
          return { unlocked: false };
        });
    }
    return _studyAccessPromise;
  }

  function pickGateTags(el) {
    if (!el) return [];
    return Array.prototype.slice.call(el.querySelectorAll(".study-gate"));
  }

  // Per-skill state from /api/v1/study-access → {unlocked, all_unlocked, skills{}}.
  var _skillAccess = { unlocked: false, all_unlocked: false, skills: {} };

  var VIDEO_SKILL_CATS = [
    "web design", "app development", "software development", "digital marketing",
    "graphics design", "cyber security", "data analysis",
  ];

  function skillUnlocked(cat) {
    if (_skillAccess.all_unlocked) return true;
    var s = _skillAccess.skills || {};
    var entry = s[cat];
    if (entry && entry.active) return true;
    return false;
  }

  function videoCategoryOf(it) {
    var blob = [it.category, it.subject, it.topic, it.tags, it.title, it.exam_type]
      .filter(Boolean).join(" ").toLowerCase();
    for (var i = 0; i < VIDEO_SKILL_CATS.length; i++) {
      var cat = VIDEO_SKILL_CATS[i];
      if (blob.indexOf(cat) >= 0) return cat;
      var words = cat.split(" ");
      if (words.length === 2 && blob.indexOf(words[words.length - 1]) >= 0 && words[words.length - 1].length > 4 && blob.indexOf(words[0]) >= 0) return cat;
    }
    return "academics";
  }

  function anySkillActive() {
    var s = _skillAccess.skills || {};
    return Object.keys(s).some(function (k) { return s[k] && s[k].active; });
  }

  function skillsListHtml() {
    var cats = ["academics"].concat(VIDEO_SKILL_CATS);
    var s = _skillAccess.skills || {};
    var rows = "";
    cats.forEach(function (c) {
      var on = skillUnlocked(c) || ((s[c] || {}).active);
      var label = c.replace(/\b\w/g, function (w) { return w.toUpperCase(); });
      rows += '<li style="font-size:0.85rem;padding:0.15rem 0">' + (on ? "✅ <strong style='color:#0a7d33'>" + label + "</strong> unlocked" : "🔒 " + label + " — code from tutor") + "</li>";
    });
    return rows;
  }

  function renderStudyGate(unlocked, info) {
    var bannerHtml = "";
    if (unlocked) {
      bannerHtml =
        '<div class="study-unlock-banner">🔓 ' +
        esc((info && (info.all_unlocked ? "All skills" : "Activation code")) || "Activation code") +
        " active — enter a new code below to unlock more skills</div>";
    }
    var anySkill = unlocked && anySkillActive();
    pickGateTags($("page-study-materials")).forEach(function (g) { g.hidden = !anySkill; });
    pickGateTags($("page-library")).forEach(function (g) { g.hidden = !anySkill; });
    pickGateTags($("page-coding")).forEach(function (g) { g.hidden = !anySkill; });
    ["studyMaterialsList", "libraryGrid", "codingList", "libToolbar", "lessonSearchWrap", "codingSearchWrap"].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      if (anySkill) {
        el.hidden = false;
        if (bannerHtml && !el.dataset.gateBanner) {
          el.insertAdjacentHTML("beforebegin", bannerHtml);
          el.dataset.gateBanner = "1";
        }
      }
    });

    // Redeem box — always available so a student can add more skills later.
    var sPage = $("page-study-materials");
    if (sPage && !sPage.querySelector(".study-coupon-box")) {
      var gate = sPage.querySelector(".study-gate");
      var host = gate ? gate.querySelector(".study-gate-card") : null;
      if (host) {
        host.insertAdjacentHTML(
          "beforeend",
          '<div class="study-coupon-box" style="margin-top:0.9rem">' +
            '<div class="form-field" style="margin:0;display:flex;gap:0.5rem">' +
            '<input id="studyCouponCode" type="text" placeholder="Have a coupon code? Enter it here" ' +
            'autocomplete="off" style="text-transform:uppercase" />' +
            '<button type="button" class="btn btn-primary" id="studyCouponRedeemBtn">Redeem</button>' +
            "</div>" +
            '<p class="coupon-msg" id="studyCouponMsg" style="margin:0.45rem 0 0;color:#47546a;font-size:0.85rem"></p>' +
            (anySkill ? "" : "<ul style='margin:0.5rem 0 0;padding-left:1.1rem;color:#47546a'>" + skillsListHtml() + "</ul>") +
          "</div>"
        );
      }
    }
  }

  async function redeemStudyCoupon() {
    var input = $("studyCouponCode");
    var msg = $("studyCouponMsg");
    var btn = $("studyCouponRedeemBtn");
    if (!input || !msg) return;
    var code = (input.value || "").trim();
    if (!code) { msg.textContent = "Enter a coupon code first."; return; }
    if (btn) { btn.disabled = true; btn.textContent = "Checking…"; }
    msg.textContent = "Checking code…";
    try {
      var res = await api.api("/api/v1/study-coupons/redeem", {
        method: "POST",
        body: JSON.stringify({ code: code }),
        headers: { "Content-Type": "application/json" },
        timeout: 20000,
        retries: 1,
        preferXhr: true,
      });
      msg.textContent = (res && res.message) || "🎉 Code accepted!";
      msg.style.color = "#0a7d33";
      _studyAccessPromise = null;
      var access = await fetchStudyAccess();
      _skillAccess = access || _skillAccess;
      renderStudyGate(!!(access && access.unlocked), access);
      loadStudyMaterials();
    } catch (e2) {
      msg.textContent = (e2 && e2.message) || "Could not redeem this code.";
      msg.style.color = "#b3261e";
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Redeem"; }
    }
  }

  document.addEventListener("click", function (e) {
    if (e.target && e.target.id === "studyCouponRedeemBtn") redeemStudyCoupon();
  });
  document.addEventListener("keydown", function (e) {
    if (e.target && e.target.id === "studyCouponCode" && e.key === "Enter") {
      e.preventDefault();
      redeemStudyCoupon();
    }
  });

  /* Υ =====================================================================
     CODING — a "coding" tutorial is a video whose subject is Coding/Computer
     ===================================================================== */

  function youtubeEmbed(url) {
    var u = String(url || "").trim();
    var m = u.match(/(?:youtu\.be\/|v=)([A-Za-z0-9_-]{6,})/);
    if (m) return "https://www.youtube.com/embed/" + m[1];
    return u;
  }

  var lessonVideosCache = [];

  function renderLessonVideos(items) {
    var wrap = $("studyMaterialsList");
    if (!wrap) return;
    if (!items.length) {
      wrap.innerHTML = emptyHtml(
        "▶",
        "No video tutorials yet. Admin posts YouTube lessons under Video Tutorials. PDF Lesson Notes are in Library."
      );
      return;
    }
    wrap.innerHTML = items
      .map(function (it) {
        var src = youtubeEmbed(it.video_url || it.url || "");
        var tutor = it.tutor_name || it.tutor || it.teacher_name || it.channel || "";
        return (
          '<div class="card">' +
          '<span class="card-tag">' +
          esc(it.subject || "Video") +
          "</span><h4>" +
          esc(it.title || "Lesson video") +
          "</h4>" +
          (tutor
            ? '<p class="muted" style="margin:0.25rem 0 0.65rem">Tutor: ' + esc(tutor) + "</p>"
            : "") +
          (src
            ? '<div class="video-frame"><iframe src="' +
              esc(src) +
              '" title="' +
              esc(it.title || "Lesson") +
              '" allowfullscreen loading="lazy"></iframe></div>'
            : "") +
          "</div>"
        );
      })
      .join("");
  }

  function filterLessonNotes() {
    var q = (($("lessonNotesSearch") && $("lessonNotesSearch").value) || "").trim().toLowerCase();
    if (!q) {
      renderLessonVideos(lessonVideosCache);
      return;
    }
    var filteredVideos = lessonVideosCache.filter(function (it) {
      var cat = videoCategoryOf(it);
      // Per-skill activation: hidden until that skill's code is redeemed.
      if (!skillUnlocked(cat)) return false;
      var blob = [
        it.title,
        it.subject,
        it.topic,
        it.tutor_name,
        it.tutor,
        it.teacher_name,
        it.channel,
        it.exam_type,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return blob.indexOf(q) >= 0;
    });
    renderLessonVideos(filteredVideos);
  }

  function loadStudyMaterials() {
    var wrap = $("studyMaterialsList");
    if (!wrap) return;
    wrap.innerHTML = loadingHtml("Loading video tutorials…");
    fetchStudyAccess().then(function (access) {
      _skillAccess = access || _skillAccess;
      renderStudyGate(!!(access && access.unlocked), access);
      api
        .api("/api/v1/videos", { timeout: 30000, retries: 1, preferXhr: true })
        .then(function (data) {
          lessonVideosCache = firstArray(data, ["videos", "items", "results"]);
          filterLessonNotes();
        })
        .catch(function (err) {
          wrap.innerHTML = errorHtml(errMsg(err), "study-materials");
        });
    });
  }

  /* Coding tutorials = videos whose subject/topic is a coding topic. */
  var _codingCache = null;

  function isCodingItem(it) {
    var blob = [it && it.subject, it && it.topic, it && it.title, it && it.category]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return /\b(coding|programming|computer science|javascript|python|html|css|web development|scratch|php|java|c\+\+|sql|app development)\b/.test(blob);
  }

  function renderCodingList(items) {
    var wrap = $("codingList");
    if (!wrap) return;
    if (!items.length) {
      wrap.innerHTML = emptyHtml(
        "💻",
        "No coding tutorials yet. Admin posts them under Video Tutorials with a coding subject (e.g. Coding, Python, JavaScript)."
      );
      return;
    }
    wrap.innerHTML = items
      .map(function (it) {
        var src = youtubeEmbed(it.video_url || it.url || "");
        var tutor = it.tutor_name || it.tutor || it.teacher_name || it.channel || "";
        return (
          '<div class="card">' +
          '<span class="card-tag">' +
          esc(it.subject || "Coding") +
          "</span><h4>" +
          esc(it.title || "Coding lesson") +
          "</h4>" +
          (tutor
            ? '<p class="muted" style="margin:0.25rem 0 0.65rem">Tutor: ' + esc(tutor) + "</p>"
            : "") +
          (src
            ? '<div class="video-frame"><iframe src="' +
              esc(src) +
              '" title="' +
              esc(it.title || "Coding lesson") +
              '" allowfullscreen loading="lazy"></iframe></div>'
            : "") +
          "</div>"
        );
      })
      .join("");
  }

  function filterCoding(q) {
    var list = _codingCache || [];
    if (q) {
      list = list.filter(function (it) {
        var blob = [it.title, it.subject, it.topic, it.tutor_name, it.tutor, it.teacher_name, it.channel]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return blob.indexOf(q) >= 0;
      });
    }
    renderCodingList(list);
  }

  function loadCodingTutorials() {
    var wrap = $("codingList");
    if (!wrap) return;
    wrap.innerHTML = loadingHtml("Loading coding tutorials…");
    fetchStudyAccess().then(function (access) {
      _skillAccess = access || _skillAccess;
      renderStudyGate(!!(access && access.unlocked), access);
      api
        .api("/api/v1/videos", { timeout: 30000, retries: 1, preferXhr: true })
        .then(function (data) {
          var all = firstArray(data, ["videos", "items", "results"]);
          // Per-skill gate + coding list mapping
          _codingCache = all.filter(function (it) {
            return (isCodingItem(it) && (skillUnlocked("app development") || skillUnlocked("software development") || skillUnlocked("web design") || _skillAccess.all_unlocked)) || it.audience === "coding";
          });
          filterCoding((($("codingSearch") && $("codingSearch").value) || "").trim().toLowerCase());
        })
        .catch(function (err) {
          wrap.innerHTML = errorHtml(errMsg(err), "coding");
        });
    });
  }

  document.addEventListener("input", function (e) {
    if (e.target && e.target.id === "lessonNotesSearch") filterLessonNotes();
    if (e.target && e.target.id === "codingSearch") filterCoding(e.target.value.trim().toLowerCase());
  });

  document.addEventListener("click", function (e) {
    if (e.target.closest("#libReaderClose")) {
      closeLibraryReader();
      return;
    }
    var openBtn = e.target.closest("[data-open-book]");
    if (openBtn) openLibraryRead(openBtn.dataset.openBook, openBtn);
    var dlBtn = e.target.closest("[data-download-book]");
    if (dlBtn) downloadLibraryPdf(dlBtn.dataset.downloadBook, dlBtn);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeLibraryReader();
  });

  var libReaderTask = 0;

  function closeLibraryReader() {
    libReaderTask += 1;
    var overlay = $("libReader");
    var pages = $("libReaderPages");
    if (overlay) overlay.hidden = true;
    if (pages) pages.innerHTML = "";
  }

  function loadPdfJs() {
    return new Promise(function (resolve, reject) {
      if (window.pdfjsLib) {
        resolve(window.pdfjsLib);
        return;
      }
      var s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      s.onload = function () {
        if (!window.pdfjsLib) {
          reject(new Error("PDF reader failed to load"));
          return;
        }
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        resolve(window.pdfjsLib);
      };
      s.onerror = function () {
        reject(new Error("Could not load the PDF reader. Check your connection."));
      };
      document.head.appendChild(s);
    });
  }

  async function renderPdfPages(bytes, taskId) {
    var pages = $("libReaderPages");
    if (!pages) return;
    pages.innerHTML = '<p class="lib-reader-status">Opening pages…</p>';
    var pdfjs = await loadPdfJs();
    if (taskId !== libReaderTask) return;
    var pdf = await pdfjs.getDocument({ data: bytes }).promise;
    if (taskId !== libReaderTask) return;
    pages.innerHTML = "";
    var maxW = Math.max(280, pages.clientWidth - 16);
    for (var n = 1; n <= pdf.numPages; n++) {
      if (taskId !== libReaderTask) return;
      var page = await pdf.getPage(n);
      var base = page.getViewport({ scale: 1 });
      var scale = Math.min(1.6, maxW / base.width);
      var viewport = page.getViewport({ scale: scale * (window.devicePixelRatio || 1) });
      var canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = Math.floor(base.width * scale) + "px";
      pages.appendChild(canvas);
      await page.render({ canvasContext: canvas.getContext("2d"), viewport: viewport }).promise;
    }
  }

  async function fetchLibraryPdf(id) {
    if (api.fetchBinary) {
      return api.fetchBinary("/api/v1/library/" + encodeURIComponent(id) + "/file", {
        timeout: 180000,
        retries: 3,
        headers: { Accept: "application/pdf" },
      });
    }
    var token = api.getToken();
    var url = api.API_BASE + "/api/v1/library/" + encodeURIComponent(id) + "/file";
    var lastErr = null;
    for (var attempt = 0; attempt < 4; attempt++) {
      if (api.wakeServer) {
        try {
          await api.wakeServer(60000);
        } catch (e) {}
      }
      try {
        var bytes = await new Promise(function (resolve, reject) {
          var xhr = new XMLHttpRequest();
          xhr.open("GET", url, true);
          xhr.responseType = "arraybuffer";
          xhr.timeout = 180000;
          xhr.setRequestHeader("Authorization", "Bearer " + token);
          xhr.setRequestHeader("Accept", "application/pdf");
          xhr.onload = function () {
            if (xhr.status === 402) {
              reject(new Error("Pay to unlock this material."));
              return;
            }
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve(new Uint8Array(xhr.response));
              return;
            }
            reject(new Error("Could not open this material (" + xhr.status + ")"));
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
        if (attempt < 3) continue;
        throw err;
      }
    }
    throw lastErr || new Error("Could not open this material.");
  }

  function isLibraryDownloadable(it) {
    if (!it) return false;
    if (it.is_downloadable === true) return true;
    return !!(it.drm && it.drm.is_downloadable);
  }

  async function downloadLibraryPdf(id, btn) {
    if (!id) return;
    var prev = btn ? btn.textContent : "";
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Saving…";
    }
    try {
      if (api.wakeServer) {
        try {
          await api.wakeServer(45000);
        } catch (e) {}
      }
      var bytes;
      if (api.fetchBinary) {
        bytes = await api.fetchBinary(
          "/api/v1/library/" + encodeURIComponent(id) + "/file?download=1",
          { timeout: 180000, retries: 3, headers: { Accept: "application/pdf" } }
        );
      } else {
        bytes = await fetchLibraryPdf(id);
      }
      var blob = new Blob([bytes], { type: "application/pdf" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "scholaxia-material.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    } catch (err) {
      alert(err && err.message ? err.message : "Download failed.");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = prev || "Download";
      }
    }
  }

  function openLibraryRead(id, btn) {
    if (!id) return;
    if ($("result-screen")) $("result-screen").classList.remove("is-on");
    var prevText = btn ? btn.textContent : "";
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Opening…";
    }
    var reset = function () {
      if (!btn) return;
      btn.disabled = false;
      btn.textContent = prevText || "Read";
    };
    var title = "";
    if (btn && btn.closest(".card")) {
      var h = btn.closest(".card").querySelector("h4");
      title = (h && h.textContent) || "";
    }
    var overlay = $("libReader");
    var titleEl = $("libReaderTitle");
    var pages = $("libReaderPages");
    if (titleEl) titleEl.textContent = title || "Reading";
    if (pages) pages.innerHTML = '<p class="lib-reader-status">Waking server… then loading PDF. Large books can take up to 2 minutes on first open.</p>';
    if (overlay) overlay.hidden = false;
    var taskId = ++libReaderTask;
    fetchLibraryPdf(id)
      .then(function (bytes) {
        if (taskId !== libReaderTask) return;
        return renderPdfPages(bytes, taskId);
      })
      .then(function () { reset(); })
      .catch(function (err) {
        if (pages) {
          pages.innerHTML =
            '<p class="lib-reader-status">' + esc(errMsg(err) || "Could not open this PDF on this phone.") + "</p>";
        } else {
          alert("Could not open resource: " + errMsg(err));
        }
        reset();
      });
  }

  /* =====================================================================
     PAST QUESTIONS — paid library PDFs (buy + download, not CBT)
     ===================================================================== */

  var pastQuestionsCache = null;
  var pqActiveCat = "all";
  var pqSearchTerm = "";

  function renderPastQuestionCard(it) {
    var title = it.title || it.name || "Past paper";
    var exam = it.exam_type || "";
    var desc = it.description || it.subject || "";
    var price = Number(it.price || 0);
    var hasAccess = !!(it.has_access || it.is_free || price <= 0);
    var canDownload = isLibraryDownloadable(it);
    var foot;
    if (hasAccess) {
      if (canDownload) {
        foot =
          '<button type="button" class="btn btn-primary btn-mini" data-download-book="' +
          esc(it.id) +
          '">Download PDF</button>';
      } else {
        foot =
          '<button type="button" class="btn btn-primary btn-mini" data-open-book="' +
          esc(it.id) +
          '">Read</button>';
      }
    } else {
      foot =
        "<strong>₦" +
        price.toLocaleString("en-NG") +
        '</strong><button type="button" class="btn btn-primary btn-mini" data-pay-type="library_book" data-pay-id="' +
        esc(it.id) +
        '">Buy &amp; download</button>';
    }
    return (
      '<div class="card">' +
      '<span class="card-tag">' +
      esc(exam || "Past Questions") +
      "</span>" +
      (canDownload ? '<span class="card-tag is-downloadable">PDF</span>' : "") +
      "<h4>" +
      esc(title) +
      "</h4>" +
      (desc ? "<p>" + esc(desc) + "</p>" : "") +
      '<div class="card-foot">' +
      foot +
      "</div></div>"
    );
  }

  function loadPastQuestions() {
    var wrap = $("pastQuestionsList");
    if (!wrap) return;
    wrap.innerHTML = loadingHtml("Loading past question papers…");
    var load = function () {
      return api.api("/api/v1/library/student?category=Past%20Questions", {
        timeout: 45000,
        retries: 1,
        preferXhr: true,
      });
    };
    (api.wakeServer ? api.wakeServer(30000).then(load).catch(load) : load())
      .then(function (data) {
        pastQuestionsCache = firstArray(data, ["items", "results", "library", "books"]);
        renderPastQuestions();
      })
      .catch(function (err) {
        wrap.innerHTML = errorHtml(errMsg(err), "past-questions");
      });
  }

  function renderPastQuestions() {
    var wrap = $("pastQuestionsList");
    if (!wrap || !pastQuestionsCache) return;
    var items = pastQuestionsCache;
    if (pqActiveCat !== "all") {
      items = items.filter(function (it) {
        var hay = (
          (it.exam_type || "") +
          " " +
          (it.title || "") +
          " " +
          (it.subject || "") +
          " " +
          (it.category || "")
        ).toLowerCase();
        var categoryMatch = hay.indexOf(pqActiveCat) > -1;
        if (pqActiveCat === "post") {
          categoryMatch = hay.indexOf("utme") > -1 || hay.indexOf("post-utme") > -1;
        }
        if (pqActiveCat === "common") {
          categoryMatch = hay.indexOf("common entrance") > -1 || hay.indexOf("common_entrance") > -1;
        }
        return categoryMatch;
      });
    }
    if (pqSearchTerm) {
      items = items.filter(function (it) {
        var hay = (
          (it.exam_type || "") +
          " " +
          (it.title || "") +
          " " +
          (it.subject || "") +
          " " +
          (it.category || "") +
          " " +
          (it.description || "")
        ).toLowerCase();
        return hay.indexOf(pqSearchTerm.toLowerCase()) > -1;
      });
    }
    if (!items.length) {
      wrap.innerHTML = emptyHtml(
        "📄",
        "No past-question PDFs match your search. Try another subject, title, or exam category."
      );
      return;
    }
    wrap.innerHTML = items.map(renderPastQuestionCard).join("");
  }

  var pqTabs = $("pqFilterTabs");
  if (pqTabs) {
    pqTabs.addEventListener("click", function (e) {
      var btn = e.target.closest(".tab");
      if (!btn) return;
      pqTabs.querySelectorAll(".tab").forEach(function (t) {
        t.classList.toggle("is-active", t === btn);
      });
      pqActiveCat = btn.dataset.cat;
      renderPastQuestions();
    });
  }

  var pqStudentSearch = $("pqStudentSearch");
  if (pqStudentSearch) {
    pqStudentSearch.addEventListener("input", function () {
      pqSearchTerm = (pqStudentSearch.value || "").trim();
      renderPastQuestions();
    });
  }

  function renderLibraryCard(it) {
    var title = it.title || it.name || "Resource";
    var cat = it.category || it.type || "Library";
    var desc = it.description || it.subject || "";
    var price = Number(it.price || 0);
    var hasAccess = !!(it.has_access || it.is_free || price <= 0);
    var canDownload = isLibraryDownloadable(it);
    var foot;
    if (hasAccess) {
      foot =
        '<button type="button" class="btn btn-primary btn-mini" data-open-book="' +
        esc(it.id) +
        '">Read</button>';
      if (canDownload) {
        foot +=
          '<button type="button" class="btn btn-secondary btn-mini" data-download-book="' +
          esc(it.id) +
          '">Download</button>';
      }
    } else {
      foot =
        "<strong>₦" +
        price.toLocaleString("en-NG") +
        '</strong><button type="button" class="btn btn-primary btn-mini" data-pay-type="library_book" data-pay-id="' +
        esc(it.id) +
        '">Pay with Paystack</button>';
    }
    return (
      '<div class="card">' +
      '<span class="card-tag">' +
      esc(cat) +
      "</span>" +
      (canDownload ? '<span class="card-tag is-downloadable">Downloadable</span>' : "") +
      "<h4>" +
      esc(title) +
      "</h4>" +
      (desc ? "<p>" + esc(desc) + "</p>" : "") +
      '<div class="card-foot">' +
      foot +
      "</div></div>"
    );
  }

  /* =====================================================================
     LIBRARY — full list with search / category filter
     ===================================================================== */

  var libraryCache = [];

  function loadLibrary() {
    var wrap = $("libraryGrid");
    if (!wrap) return;
    wrap.innerHTML = loadingHtml("Loading library…");
    fetchStudyAccess().then(function (access) {
      renderStudyGate(!!(access && access.unlocked), access);
      if (!(access && access.unlocked)) {
        wrap.innerHTML = "";
        return;
      }
      loadLibraryInner(wrap);
    });
  }

  function loadLibraryInner(wrap) {
    api
      .api("/api/v1/library/student", { timeout: 45000, retries: 1, preferXhr: true })
      .then(function (data) {
        libraryCache = firstArray(data, ["items", "results", "library", "books"]);
        var fixed = ["Books", "Study Materials", "Scheme of Work", "Lesson Notes"];
        var extras = libraryCache
          .map(function (it) {
            return it.category || it.type;
          })
          .filter(function (c) {
            return c && fixed.indexOf(c) < 0;
          });
        var cats = fixed.concat(
          Array.from(new Set(extras)).sort(function (a, b) {
            return String(a).localeCompare(String(b));
          })
        );
        var sel = $("libFilter");
        var prev = sel ? sel.value : "";
        if (sel) {
          sel.innerHTML =
            '<option value="">All categories</option>' +
            cats.map(function (c) {
              return '<option value="' + esc(c) + '">' + esc(c) + "</option>";
            }).join("");
          if (prev) sel.value = prev;
        }
        renderLibrary();
      })
      .catch(function (err) {
        wrap.innerHTML = errorHtml(errMsg(err), "library");
      });
  }

  function libraryCategoryMatches(itemCat, filterCat) {
    if (!filterCat) return true;
    var a = String(itemCat || "")
      .toLowerCase()
      .replace(/[_-]+/g, " ")
      .trim();
    var b = String(filterCat || "")
      .toLowerCase()
      .replace(/[_-]+/g, " ")
      .trim();
    if (a === b) return true;
    if (b === "lesson notes" && (a === "notes" || a === "lesson note")) return true;
    if (b === "study materials" && (a === "study material" || a === "materials")) return true;
    if (b === "scheme of work" && (a === "scheme" || a.indexOf("scheme") === 0)) return true;
    return false;
  }

  function renderLibrary() {
    var wrap = $("libraryGrid");
    if (!wrap) return;
    var q = ($("libSearch") && $("libSearch").value || "").toLowerCase().trim();
    var cat = ($("libFilter") && $("libFilter").value) || "";
    var items = libraryCache.filter(function (it) {
      if (!libraryCategoryMatches(it.category || it.type, cat)) return false;
      if (q) {
        var hay = ((it.title || "") + " " + (it.description || "") + " " + (it.subject || "")).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    if (!items.length) {
      wrap.innerHTML = emptyHtml(
        "📚",
        cat
          ? "No materials in «" + cat + "» yet. Admin uploads them under Library with that Material type."
          : "No library resources match your search."
      );
      return;
    }
    wrap.innerHTML = items.map(renderLibraryCard).join("");
  }

  if ($("libSearch")) $("libSearch").addEventListener("input", debounce(renderLibrary, 200));
  if ($("libFilter")) $("libFilter").addEventListener("change", renderLibrary);

  /* =====================================================================
     Exam data cache + shared exam engine (CBT / School / External)
     ===================================================================== */

  var examsForMeCache = null;

  var examsCacheByKind = {};

  function cacheExamsForMe(data) {
    examsForMeCache = data || {};
    examsCacheByKind.cbt_practice = examsForMeCache;
  }

  function bucketPublicExams(rows) {
    var jamb = [];
    var ssce = [];
    var practice = [];
    var school = [];
    (rows || []).forEach(function (e) {
      if (e.is_school_exam) {
        school.push(e);
        return;
      }
      var t = String(e.exam_type || "").toUpperCase();
      if (t.indexOf("JAMB") >= 0 || t.indexOf("UTME") >= 0) jamb.push(e);
      else if (
        t.indexOf("WAEC") >= 0 ||
        t.indexOf("NECO") >= 0 ||
        t.indexOf("JUNIOR") >= 0 ||
        t.indexOf("COMMON") >= 0
      ) {
        ssce.push(e);
      } else {
        practice.push(e);
      }
    });
    return {
      practice_exams: practice.concat(jamb, ssce),
      jamb_exams: jamb,
      ssce_exams: ssce,
      school_exams: school,
      boards: [].concat(jamb.length ? ["JAMB"] : [], ssce.length ? ["WAEC_NECO"] : []),
      _fallback: true,
    };
  }

  function fetchExamsForMe(paperKind) {
    paperKind = paperKind || "cbt_practice";
    if (examsCacheByKind[paperKind]) return Promise.resolve(examsCacheByKind[paperKind]);
    return api
      .api("/api/v1/cbt/exams/for-me?paper_kind=" + encodeURIComponent(paperKind), {
        timeout: 60000,
        retries: 3,
      })
      .then(function (data) {
        examsCacheByKind[paperKind] = data || {};
        if (paperKind === "cbt_practice") examsForMeCache = examsCacheByKind[paperKind];
        return examsCacheByKind[paperKind];
      })
      .catch(function (err) {
        // Fallback: public published list so Practice / Past Questions still show something
        return api
          .api(
            "/api/v1/cbt/exams?paper_kind=" + encodeURIComponent(paperKind),
            { timeout: 60000, retries: 2, noAuth: false }
          )
          .then(function (rows) {
            var data = bucketPublicExams(Array.isArray(rows) ? rows : []);
            examsCacheByKind[paperKind] = data;
            if (paperKind === "cbt_practice") examsForMeCache = data;
            return data;
          })
          .catch(function () {
            throw err;
          });
      });
  }

  function packKey(id, isExternal) {
    return isExternal ? "sia_cbt_pack_ext_" + id : "sia_cbt_pack_" + id;
  }

  function getPack(id, isExternal) {
    return readLocalJson(packKey(id, isExternal), null);
  }

  function setPack(id, isExternal, data) {
    writeLocalJson(packKey(id, isExternal), data);
  }

  function examMinutes(exam) {
    return exam.duration_minutes || exam.duration || exam.time_limit || 20;
  }

  function renderExamCard(exam, opts) {
    opts = opts || {};
    var id = exam.id || exam.exam_id;
    var title = exam.title || exam.name || exam.subject || "Exam";
    var subject = exam.subject || "";
    var year = exam.year || "";
    var qCount = exam.total_questions || exam.question_count || (exam.questions && exam.questions.length) || "";
    var hasPack = !!getPack(id, opts.isExternal);
    var badge = opts.badge || (exam.board ? exam.board.toUpperCase() : "EXAM");
    return (
      '<div class="card" data-exam-card="' +
      esc(id) +
      '">' +
      '<span class="card-tag">' +
      esc(badge) +
      "</span><h4>" +
      esc(title) +
      "</h4>" +
      '<p style="margin:0;color:#64748b;font-size:0.84rem;line-height:1.4">Timed CBT session ready when you are.</p>' +
      '<div class="card-meta-row">' +
      (subject ? "<span>" + esc(subject) + "</span>" : "") +
      (year ? "<span>" + esc(year) + "</span>" : "") +
      (qCount ? "<span>" + esc(qCount) + " Qs</span>" : "") +
      "<span>" + esc(examMinutes(exam)) + " mins</span>" +
      "</div>" +
      '<div class="card-foot">' +
      '<button type="button" class="btn btn-secondary btn-mini' +
      (hasPack ? " is-done" : "") +
      '" data-action="download" data-exam-id="' +
      esc(id) +
      '" data-external="' +
      (opts.isExternal ? "1" : "0") +
      '">' +
      (hasPack ? "Downloaded ✓" : "Download") +
      "</button>" +
      '<button type="button" class="btn btn-primary btn-mini" data-action="start" data-exam-id="' +
      esc(id) +
      '" data-external="' +
      (opts.isExternal ? "1" : "0") +
      '" data-school="' +
      (opts.isSchool ? "1" : "0") +
      '">Start exam</button>' +
      "</div></div>"
    );
  }

  function findExamById(list, id) {
    return (list || []).filter(function (e) { return String(e.id || e.exam_id) === String(id); })[0];
  }

  var cbtUnlockAfter = null;
  var cbtUnlockOpenedAt = 0;
  var startExamLock = false;

  function resetCbtUnlockModal() {
    if ($("cbtUnlockChoice")) $("cbtUnlockChoice").hidden = false;
    if ($("cbtUnlockCoupon")) $("cbtUnlockCoupon").hidden = true;
    if ($("cbtUnlockPay")) $("cbtUnlockPay").hidden = true;
    if ($("cbtUnlockStatus")) {
      $("cbtUnlockStatus").textContent = "";
      $("cbtUnlockStatus").className = "form-status";
    }
    if ($("cbtUnlockCode")) $("cbtUnlockCode").value = "";
  }

  function closeCbtUnlockModal(force) {
    // Ignore the same tap that opened the modal (common on phones)
    if (!force && cbtUnlockOpenedAt && Date.now() - cbtUnlockOpenedAt < 700) return;
    cbtUnlockOpenedAt = 0;
    var modal = $("cbtUnlockModal");
    if (modal) modal.classList.remove("is-on");
    cbtUnlockAfter = null;
    resetCbtUnlockModal();
  }

  function openCbtUnlockModal(afterUnlock) {
    cbtUnlockAfter = afterUnlock;
    resetCbtUnlockModal();
    var modal = $("cbtUnlockModal");
    if (!modal) {
      if (confirm("CBT package required. Open CBT packages to pay?")) showPage("cbt");
      return;
    }
    // Defer show so the Start click cannot hit the new overlay and instantly close it
    cbtUnlockOpenedAt = Date.now();
    setTimeout(function () {
      cbtUnlockOpenedAt = Date.now();
      modal.classList.add("is-on");
    }, 60);
  }

  function loadCbtUnlockPackages() {
    var list = $("cbtUnlockPayList");
    if (!list) return;
    list.innerHTML = loadingHtml("Loading packages…");
    api.api("/api/v1/payments/paystack/cbt-packages").then(function (catalog) {
      var packages = firstArray(catalog, ["packages", "items"]);
      if (!packages.length) {
        list.innerHTML = emptyHtml("📝", "No CBT packages listed yet.");
        return;
      }
      list.innerHTML = packages.map(function (p) {
        var id = p.id || p.package_id;
        var price = Number(p.price || p.amount || 0);
        return (
          '<div class="card-foot" style="margin-bottom:8px">' +
          "<strong>" + esc(p.name || p.title || id) + " · ₦" + price.toLocaleString("en-NG") + "</strong>" +
          '<button type="button" class="btn btn-primary btn-mini" data-pay-type="cbt_package" data-pay-id="' +
          esc(id) +
          '">Pay</button></div>'
        );
      }).join("");
    }).catch(function (err) {
      list.innerHTML = errorHtml(errMsg(err));
    });
  }

  // Delegated handlers for exam cards (download / start) across cbt / school / school-portal
  document.addEventListener("click", function (e) {
    var openSchool = e.target.closest("[data-open-school-exam]");
    if (openSchool) {
      window.location.href = "exam.html?exam=" + encodeURIComponent(openSchool.getAttribute("data-open-school-exam"));
      return;
    }
    var btn = e.target.closest("[data-action]");
    if (!btn) return;
    var action = btn.dataset.action;
    var examId = btn.dataset.examId;
    var isExternal = btn.dataset.external === "1";
    var isSchool = btn.dataset.school === "1";
    if (action === "download") downloadExam(examId, isExternal, btn);
    if (action === "start") startExamFlow(examId, isExternal, isSchool, btn);
  });

  function currentExamSourceList() {
    var list = []
      .concat(examsForMeCache ? examsForMeCache.practice_exams || [] : [])
      .concat(examsForMeCache ? examsForMeCache.jamb_exams || [] : [])
      .concat(examsForMeCache ? examsForMeCache.ssce_exams || [] : [])
      .concat(examsForMeCache ? examsForMeCache.school_exams || [] : [])
      .concat(externalExamsCache || []);
    return list;
  }

  function downloadExam(examId, isExternal, btn) {
    var base = isExternal ? "/api/v1/cbt/external-exams/" : "/api/v1/cbt/exams/";
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Downloading…";
    }
    api
      .api(base + examId + "/download")
      .then(function (data) {
        setPack(examId, isExternal, data);
        if (btn) {
          btn.disabled = false;
          btn.textContent = "Downloaded ✓";
          btn.classList.add("is-done");
        }
      })
      .catch(function (err) {
        if (btn) {
          btn.disabled = false;
          btn.textContent = "Download";
        }
        if (isCbtPackageError(err)) {
          openCbtUnlockModal(function () { downloadExam(examId, isExternal, btn); });
          return;
        }
        alert("Download failed: " + errMsg(err));
      });
  }

  function startExamFlow(examId, isExternal, isSchool, btn) {
    if (startExamLock) return;
    startExamLock = true;
    var exam = findExamById(currentExamSourceList(), examId) || {};

    function unlockStart() {
      startExamLock = false;
    }

    function launchWithPack(pack) {
      var title = exam.title || exam.name || (pack && (pack.title || pack.name)) || "Exam";

      if (isExternal) {
        unlockStart();
        openExam({
          examId: examId,
          title: title,
          pack: pack,
          isExternal: true,
        });
        return;
      }

      if (btn) {
        btn.disabled = true;
        btn.textContent = "Starting…";
      }
      api
        .api("/api/v1/cbt/sessions/" + examId + "/start", {
          method: "POST",
          body: { is_school: !!isSchool },
        })
        .then(function (res) {
          var sessionId =
            (res && (res.session_id || res.id || (res.session && res.session.id))) || null;
          var questions = (res && (res.questions || (res.session && res.session.questions))) || null;
          if (btn) {
            btn.disabled = false;
            btn.textContent = "Start exam";
          }
          unlockStart();
          openExam({
            examId: examId,
            title: title,
            pack: questions ? { questions: questions, duration_minutes: examMinutes(exam) } : pack,
            sessionId: sessionId,
            isSchool: isSchool,
          });
        })
        .catch(function (err) {
          if (btn) {
            btn.disabled = false;
            btn.textContent = "Start exam";
          }
          if (typeof isCbtPackageError === "function" && isCbtPackageError(err)) {
            unlockStart();
            openCbtUnlockModal(function () { ensurePackThenLaunch(false); });
            return;
          }
          unlockStart();
          // Offline pack is enough to sit the paper if session start fails for other reasons
          openExam({ examId: examId, title: title, pack: pack, isSchool: isSchool });
        });
    }

    function ensurePackThenLaunch(retried) {
      var pack = getPack(examId, isExternal);
      if (pack) {
        launchWithPack(pack);
        return;
      }
      // Download is optional for the student — Start loads the paper automatically
      var base = isExternal ? "/api/v1/cbt/external-exams/" : "/api/v1/cbt/exams/";
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Loading…";
      }
      api
        .api(base + examId + "/download", { timeout: 90000, retries: 2 })
        .then(function (data) {
          setPack(examId, isExternal, data);
          if (btn) {
            btn.disabled = false;
            btn.textContent = "Start exam";
          }
          launchWithPack(data);
        })
        .catch(function (err) {
          if (btn) {
            btn.disabled = false;
            btn.textContent = "Start exam";
          }
          // After coupon redeem, first download can race the DB commit — retry once
          var justUnlocked = 0;
          try { justUnlocked = Number(sessionStorage.getItem("sia_cbt_just_unlocked") || 0); } catch (e) {}
          if (!retried && isCbtPackageError(err) && justUnlocked && Date.now() - justUnlocked < 120000) {
            setTimeout(function () { ensurePackThenLaunch(true); }, 700);
            return;
          }
          unlockStart();
          if (isCbtPackageError(err)) {
            var boardHint = "";
            try {
              var d = err && err.data && err.data.detail;
              if (d && d.board) boardHint = " This exam needs " + d.board + " access.";
            } catch (e2) {}
            if (justUnlocked && Date.now() - justUnlocked < 120000) {
              alert(
                "Coupon saved, but this exam board is not in your package." +
                  boardHint +
                  " Open an exam that matches your coupon, or pay for the right package."
              );
            }
            openCbtUnlockModal(function () { ensurePackThenLaunch(false); });
            return;
          }
          alert("Could not open this exam: " + errMsg(err));
        });
    }

    if (isSchool || isExternal) {
      ensurePackThenLaunch(false);
      return;
    }
    // If coupon was just redeemed on this device, skip the unlock popup
    var justUnlockedAt = 0;
    try { justUnlockedAt = Number(sessionStorage.getItem("sia_cbt_just_unlocked") || 0); } catch (e3) {}
    if (justUnlockedAt && Date.now() - justUnlockedAt < 120000) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Start exam";
      }
      ensurePackThenLaunch(false);
      return;
    }
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Checking…";
    }
    api
      .api("/api/v1/payments/paystack/cbt-access", { timeout: 25000, retries: 1 })
      .then(function (access) {
        if (btn) {
          btn.disabled = false;
          btn.textContent = "Start exam";
        }
        if (access && access.has_access) {
          try { sessionStorage.setItem("sia_cbt_just_unlocked", String(Date.now())); } catch (e4) {}
          ensurePackThenLaunch(false);
        } else {
          unlockStart();
          openCbtUnlockModal(function () { ensurePackThenLaunch(false); });
        }
      })
      .catch(function () {
        if (btn) {
          btn.disabled = false;
          btn.textContent = "Start exam";
        }
        unlockStart();
        openCbtUnlockModal(function () { ensurePackThenLaunch(false); });
      });
  }

  /* ---------- Exam runner ---------- */

  var Exam = { current: null };

  function normalizeQuestions(raw) {
    return (raw || []).map(function (q, i) {
      var options = [];
      if (q.options && typeof q.options === "object" && !Array.isArray(q.options)) {
        ["A", "B", "C", "D", "E"].forEach(function (k) {
          if (q.options[k] != null && q.options[k] !== "") options.push({ key: k, text: q.options[k] });
        });
      } else if (Array.isArray(q.options)) {
        var letters = ["A", "B", "C", "D", "E"];
        q.options.forEach(function (opt, idx) {
          var text = typeof opt === "string" ? opt : opt.text || opt.label || opt.value || "";
          var key =
            typeof opt === "object" && opt && opt.key
              ? String(opt.key).toUpperCase()
              : letters[idx] || String(idx);
          if (text) options.push({ key: key, text: text });
        });
      } else {
        ["a", "b", "c", "d", "e"].forEach(function (l) {
          var field = "option_" + l;
          if (q[field] != null && q[field] !== "") options.push({ key: l.toUpperCase(), text: q[field] });
        });
      }
      var correct = q.correct_answer || q.correct_option || q.answer || q.correct || null;
      if (correct != null) correct = String(correct).trim().charAt(0).toUpperCase();
      return {
        id: String(q.id || q.question_id || q._id || i),
        text: q.question || q.text || q.title || q.question_text || "Question " + (i + 1),
        options: options,
        correct: correct,
      };
    });
  }

  function openExam(opts) {
    var pack = opts.pack || {};
    var rawQuestions = Array.isArray(pack) ? pack : pack.questions || pack.data || pack.items || [];
    var questions = normalizeQuestions(rawQuestions);
    if (!questions.length) {
      alert("No questions were found in this exam pack.");
      return;
    }
    Exam.current = {
      examId: opts.examId,
      title: opts.title || "Exam",
      questions: questions,
      answers: {},
      sessionId: opts.sessionId || null,
      isExternal: !!opts.isExternal,
      isSchool: !!opts.isSchool,
      index: 0,
      // OFFLINE SECURITY: record the exact start time on the device — it is
      // sent with the submission and the duration is enforced from it.
      startedAt: (opts.isExternal || opts.isSchool) ? new Date().toISOString() : null,
      durationMinutes: examMinutes(pack),
      remainingSec: examMinutes(pack) * 60,
      timerId: null,
    };
    renderExamNav();
    renderExamQuestion();
    $("examTitle").textContent = Exam.current.title;
    $("examSub").textContent =
      (Exam.current.isExternal ? "External exam" : Exam.current.isSchool ? "Scholaxia exam" : "CBT practice") +
      " · " +
      questions.length +
      " questions";
    var bar = $("examSectionBar");
    if (bar) bar.hidden = true;
    var chooser = $("examSectionChooser");
    if (chooser) chooser.hidden = true;
    var body = $("examBody");
    if (body) body.hidden = false;
    $("exam-screen").classList.add("is-on");
    startExamTimer();
  }

  function startExamTimer() {
    stopExamTimer();
    if (!Exam.current) return;
    // Never open an exam with 0 time left — that instantly auto-submits as 0%
    if (!(Exam.current.remainingSec > 0)) {
      var mins = Exam.current.durationMinutes || 180;
      Exam.current.remainingSec = Math.max(60, mins * 60);
    }
    updateTimerDisplay();
    Exam.current.timerId = setInterval(function () {
      if (!Exam.current) return;
      Exam.current.remainingSec -= 1;
      updateTimerDisplay();
      if (Exam.current.remainingSec <= 0) {
        stopExamTimer();
        // Only auto-submit if the student actually entered the paper
        if (Exam.current.awaitingSectionPick) {
          Exam.current.remainingSec = 0;
          updateTimerDisplay();
          return;
        }
        submitExam(true);
      }
    }, 1000);
  }

  function stopExamTimer() {
    if (Exam.current && Exam.current.timerId) {
      clearInterval(Exam.current.timerId);
      Exam.current.timerId = null;
    }
  }

  function updateTimerDisplay() {
    var el = $("examTimer");
    if (!el || !Exam.current) return;
    var s = Math.max(0, Exam.current.remainingSec);
    var m = Math.floor(s / 60);
    var sec = s % 60;
    el.textContent = (m < 10 ? "0" : "") + m + ":" + (sec < 10 ? "0" : "") + sec;
    el.classList.toggle("is-low", s <= 60);
  }

  function renderExamNav() {
    var nav = $("examQuestionNav");
    if (!nav || !Exam.current) return;
    nav.innerHTML = Exam.current.questions
      .map(function (q, i) {
        var cls = "";
        if (i === Exam.current.index) cls = "is-current";
        else if (Exam.current.answers[q.id]) cls = "is-answered";
        return (
          '<button type="button" data-goto-q="' + i + '" class="' + cls + '">' + (i + 1) + "</button>"
        );
      })
      .join("");
  }

  function renderExamQuestion() {
    var st = Exam.current;
    if (!st) return;
    var qCount = $("examQCount");
    var qText = $("examQuestionText");
    var qOpts = $("examOptions");
    var q = st.questions && st.questions[st.index];
    if (!q) {
      if (qCount) qCount.textContent = "No question loaded";
      if (qText) qText.textContent = "Pick a subject again, or tap Start to reopen the exam.";
      if (qOpts) qOpts.innerHTML = "";
      return;
    }
    if (qCount) qCount.textContent = "Question " + (st.index + 1) + " of " + st.questions.length;
    if (qText) qText.textContent = q.text || q.question_text || "";
    var selected = st.answers[q.id];
    var options = q.options || [];
    if (qOpts) {
      qOpts.innerHTML = options
        .map(function (opt) {
          return (
            '<button type="button" class="exam-option' +
            (selected === opt.key ? " is-selected" : "") +
            '" data-opt-key="' +
            esc(opt.key) +
            '"><span class="opt-key">' +
            esc(opt.key) +
            "</span><span>" +
            esc(opt.text) +
            "</span></button>"
          );
        })
        .join("");
    }
    if ($("examPrevBtn")) $("examPrevBtn").disabled = st.index === 0;
    if ($("examNextBtn")) {
      $("examNextBtn").textContent =
        st.index === st.questions.length - 1 ? "Finish" : "Next →";
    }
    renderExamNav();
  }

  var examOptionsEl = $("examOptions");
  if (examOptionsEl) {
    examOptionsEl.addEventListener("click", function (e) {
      var btn = e.target.closest(".exam-option");
      if (!btn || !Exam.current) return;
      var q = Exam.current.questions[Exam.current.index];
      Exam.current.answers[q.id] = btn.dataset.optKey;
      renderExamQuestion();
      if (Exam.current.isPractice) {
        renderPracticeSectionTabs();
        savePracticeAnswers();
      }
    });
  }

  var examNavEl = $("examQuestionNav");
  if (examNavEl) {
    examNavEl.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-goto-q]");
      if (!btn || !Exam.current) return;
      Exam.current.index = parseInt(btn.dataset.gotoQ, 10) || 0;
      renderExamQuestion();
    });
  }

  if ($("examPrevBtn")) {
    $("examPrevBtn").addEventListener("click", function () {
      if (!Exam.current) return;
      Exam.current.index = Math.max(0, Exam.current.index - 1);
      renderExamQuestion();
    });
  }

  if ($("examNextBtn")) {
    $("examNextBtn").addEventListener("click", function () {
      if (!Exam.current) return;
      if (Exam.current.index >= Exam.current.questions.length - 1) {
        if (Exam.current.isPractice) {
          advanceOrSubmitPracticeSection();
        } else {
          confirmSubmitExam();
        }
      } else {
        Exam.current.index += 1;
        renderExamQuestion();
      }
    });
  }

  function closeExamScreen() {
    stopExamTimer();
    Exam.current = null;
    var screen = $("exam-screen");
    if (!screen) return;
    screen.classList.remove("is-on");
    // openPracticeAttempt sets inline display:flex — must clear or Quit looks broken
    screen.style.display = "";
    screen.style.removeProperty("display");
  }

  if ($("examSubmitBtn")) {
    $("examSubmitBtn").addEventListener("click", confirmSubmitExam);
  }

  if ($("examQuitBtn")) {
    $("examQuitBtn").addEventListener("click", function () {
      if (!Exam.current) {
        closeExamScreen();
        return;
      }
      if (Exam.current.isPractice) {
        if (!confirm("Leave this CBT? Your answers will be saved so you can resume later.")) return;
        var leaving = Exam.current;
        savePracticeAnswers(function () {
          // Only close if we are still on the same attempt
          if (Exam.current === leaving || !Exam.current) {
            closeExamScreen();
          }
        });
        // Safety: never stay stuck if save hangs
        setTimeout(function () {
          if (Exam.current === leaving) closeExamScreen();
        }, 2500);
        return;
      }
      if (confirm("Quit this exam? Your progress will be lost.")) {
        closeExamScreen();
      }
    });
  }

  /* ---------- OFFLINE SECURITY (owner PRD): encrypted pending-sync queue ----------
   * "Encrypt sensitive locally stored exam data where practical." — the
   * answer sheet of an offline-taken school exam is AES-GCM encrypted with a
   * per-device key (WebCrypto) before it touches storage, then auto-synced
   * (once, duplicates are merged) when the connection returns. */
  var SX_ENC_PREFIX = "sxenc_v1:";
  var SX_MASTER_KEY = "sx_ss_master_key_v1";
  var SX_KEY_PROMISE = null;

  function sxSubtle() {
    return (window.crypto && window.crypto.subtle) || null;
  }
  function sxB64(bytes) {
    var bin = "";
    var arr = new Uint8Array(bytes);
    for (var i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
    return btoa(bin);
  }
  function sxUnb64(text) {
    var bin = atob(text);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }
  function sxKey() {
    if (SX_KEY_PROMISE) return SX_KEY_PROMISE;
    var s = sxSubtle();
    if (!s) return Promise.resolve(null);
    SX_KEY_PROMISE = (async function () {
      try {
        var raw = localStorage.getItem(SX_MASTER_KEY);
        if (raw) return await s.importKey("raw", sxUnb64(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
        var fresh = await s.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
        var exported = await s.exportKey("raw", fresh);
        localStorage.setItem(SX_MASTER_KEY, sxB64(exported));
        return fresh;
      } catch (e) {
        return null;
      }
    })();
    return SX_KEY_PROMISE;
  }
  async function sxSecSet(key, value) {
    var json = JSON.stringify(value == null ? null : value);
    var s = sxSubtle();
    var k = s ? await sxKey() : null;
    if (!k) {
      try { localStorage.setItem(key, json); } catch (e) { /* quota */ }
      return;
    }
    try {
      var iv = window.crypto.getRandomValues(new Uint8Array(12));
      var cipher = await s.encrypt({ name: "AES-GCM", iv: iv }, k, new TextEncoder().encode(json));
      localStorage.setItem(key, SX_ENC_PREFIX + sxB64(iv) + ":" + sxB64(cipher));
    } catch (e) {
      try { localStorage.setItem(key, json); } catch (e2) { /* quota */ }
    }
  }
  async function sxSecGet(key) {
    var raw = null;
    try { raw = localStorage.getItem(key); } catch (e) { return null; }
    if (raw == null) return null;
    if (raw.indexOf(SX_ENC_PREFIX) !== 0) {
      try { return JSON.parse(raw); } catch (e) { return null; }
    }
    var s = sxSubtle();
    var k = s ? await sxKey() : null;
    if (!k) return null;
    try {
      var parts = raw.slice(SX_ENC_PREFIX.length).split(":");
      var plain = await s.decrypt({ name: "AES-GCM", iv: sxUnb64(parts[0]) }, k, sxUnb64(parts[1]));
      return JSON.parse(new TextDecoder().decode(plain));
    } catch (e) {
      return null; // tampered value or wrong key
    }
  }

  var SIA_EXT_QUEUED_KEY = "sia_ext_pending_submits";
  async function readQueuedExams() {
    var list = await sxSecGet(SIA_EXT_QUEUED_KEY);
    return Array.isArray(list) ? list : [];
  }
  async function writeQueuedExams(list) {
    await sxSecSet(SIA_EXT_QUEUED_KEY, list || []);
  }
  // One entry per exam: a re-queued submission replaces the older draft, so
  // the same attempt can never be submitted twice.
  async function queueExternalSubmit(st, answers, submittedAtIso) {
    try {
      var list = await readQueuedExams();
      list = list.filter(function (x) { return x.exam_id !== st.examId; });
      list.push({
        exam_id: st.examId,
        title: st.title || "",
        answers: answers,
        started_at: st.startedAt || null,
        submitted_at: submittedAtIso || new Date().toISOString(),
        client: "site",
        queued_at: new Date().toISOString(),
      });
      await writeQueuedExams(list);
    } catch (e) { /* never block a submission over queue errors */ }
  }
  async function flushQueuedExternalSubmits() {
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    var list = await readQueuedExams();
    if (!list.length) return;
    var remaining = [];
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      try {
        await api.api("/api/v1/cbt/external-exams/" + item.exam_id + "/submit", {
          method: "POST",
          body: {
            answers: item.answers,
            is_auto_submit: false,
            started_at: item.started_at || null,
            submitted_at: item.submitted_at || null,
            offline_sync: true,
            client: "site",
          },
        });
      } catch (e) {
        remaining.push(item);
      }
    }
    await writeQueuedExams(remaining);
  }

  function confirmSubmitExam() {
    if (!Exam.current) return;
    var st = Exam.current;
    var answered = Object.keys(st.answers || {}).length;
    var total = 0;
    if (st._jwAllView) {
      // All-questions view: count across every subject section
      total = (st.sections || []).reduce(function (n, sec) {
        return n + (Number(sec && sec.total) || (sec && sec.questions || []).length || 0);
      }, 0);
    } else {
      total = st.questions.length;
    }
    if (answered < total) {
      if (!confirm("You have answered " + answered + " of " + total + " questions. Submit anyway?")) return;
    }
    submitExam(false);
  }

  function localScore(st) {
    var correctCount = 0;
    var scored = 0;
    st.questions.forEach(function (q) {
      if (!q.correct) return;
      scored += 1;
      if (st.answers[q.id] && st.answers[q.id] === q.correct) correctCount += 1;
    });
    var total = st.questions.length;
    var pct = scored ? Math.round((correctCount / scored) * 100) : null;
    return {
      score: correctCount,
      total: scored || total,
      percentage: pct,
      offline: true,
      unscored: !scored,
    };
  }

  function submitExam(isAuto) {
    var st = Exam.current;
    if (!st) return;
    stopExamTimer();
    var screen = $("exam-screen");
    if (screen) {
      screen.classList.remove("is-on");
      screen.style.display = "";
      screen.style.removeProperty("display");
    }

    var answersOut = {};
    Object.keys(st.answers).forEach(function (k) {
      answersOut[k] = st.answers[k];
    });

    if (st.isPractice && st.practiceAttemptId) {
      api
        .api("/api/v1/cbt/practice/attempts/" + st.practiceAttemptId + "/submit", {
          method: "POST",
          body: { answers: answersOut },
        })
        .then(function (res) {
          if (res && res.percent != null && res.percentage == null) res.percentage = res.percent;
          if (res && res.max_score != null && res.total == null) res.total = res.max_score;
          showResult(res, st);
        })
        .catch(function () {
          showResult(localScore(st), st);
        });
      return;
    }

    if (st.isExternal) {
      var submittedAtIso = new Date().toISOString();
      api
        .api("/api/v1/cbt/external-exams/" + st.examId + "/submit", {
          method: "POST",
          body: {
            answers: answersOut,
            is_auto_submit: !!isAuto,
            started_at: st.startedAt || null,
            submitted_at: submittedAtIso,
            client: "site",
          },
        })
        .then(function (res) {
          showResult(res, st);
        })
        .catch(function () {
          // OFFLINE SECURITY: save the answer sheet ENCRYPTED on this device
          // and auto-sync it when the connection returns. The server re-scores
          // every submission, so the local score is only a preview.
          queueExternalSubmit(st, answersOut, submittedAtIso);
          var offlineRes = localScore(st);
          offlineRes.queued_sync = true;
          showResult(offlineRes, st);
        });
      return;
    }

    if (st.sessionId) {
      api
        .api("/api/v1/cbt/sessions/submit", {
          method: "POST",
          body: { session_id: st.sessionId, answers: answersOut, is_auto_submit: !!isAuto },
        })
        .then(function (res) {
          showResult(res, st);
        })
        .catch(function () {
          showResult(localScore(st), st);
        });
      return;
    }

    showResult(localScore(st), st);
  }

  var lastExamReview = null;
  var lastExamFullReview = null;
  var lastReviewMeta = null;

  function optionLabel(options, key) {
    if (!options || !key) return key || "—";
    var found = options.find(function (o) {
      return String(o.key || o.label || "").toUpperCase() === String(key).toUpperCase();
    });
    if (found) return (found.key || "") + ". " + (found.text || found.label || "");
    return key;
  }

  function normalizeSubjectKey(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[_-]+/g, " ")
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function subjectFromExamTitle(title) {
    var parts = String(title || "").split("·");
    if (parts.length < 2) return "";
    return parts.slice(1).join("·").replace(/\s*CBT\s*$/i, "").trim();
  }

  function itemMatchesExamSubject(item, wanted) {
    var key = normalizeSubjectKey(wanted);
    if (!key) return false;
    var hay = normalizeSubjectKey(
      [item.subject, item.title, item.category, item.type].filter(Boolean).join(" ")
    );
    if (!hay) return false;
    if (hay.indexOf(key) >= 0) return true;
    var compact = key.replace(/\s+/g, "");
    return compact.length > 3 && hay.replace(/\s+/g, "").indexOf(compact) >= 0;
  }

  function loadReviewBookTips(subjects, examSubject) {
    var panel = $("reviewBooksPanel");
    var list = $("reviewBooksList");
    if (!panel || !list) return;
    var wanted = String(examSubject || "").trim();
    if (!wanted && subjects && subjects.length === 1) wanted = subjects[0];
    if (!wanted) {
      panel.hidden = true;
      list.innerHTML = "";
      return;
    }
    panel.hidden = false;
    list.innerHTML = '<p class="muted">Loading notes for ' + esc(wanted) + "…</p>";
    var books = [];

    function addBook(b, fallbackSubject) {
      if (!b || !b.title) return;
      var item = {
        title: b.title,
        author: b.author,
        subject: b.subject || fallbackSubject || wanted,
      };
      if (!itemMatchesExamSubject(item, wanted)) return;
      books.push(item);
    }

    var rec = api
      .api("/api/v1/sia/recommendations?subject=" + encodeURIComponent(wanted), {
        timeout: 35000,
        retries: 0,
      })
      .then(function (data) {
        (data && data.recommended_books || []).forEach(function (b) {
          addBook(b, wanted);
        });
      })
      .catch(function () {});

    var lib = (libraryCache && libraryCache.length
      ? Promise.resolve(libraryCache)
      : api
          .api("/api/v1/library/student", { timeout: 35000, retries: 0, preferXhr: true })
          .then(function (data) {
            libraryCache = firstArray(data, ["items", "results", "library", "books"]);
            return libraryCache;
          })
          .catch(function () {
            return [];
          })
    ).then(function (items) {
      (items || []).forEach(function (it) {
        addBook(
          {
            title: it.title || it.name,
            author: it.author || it.class_level || it.level,
            subject: it.subject || wanted,
          },
          wanted
        );
      });
    });

    Promise.all([rec, lib]).then(function () {
      if (!books.length) {
        list.innerHTML =
          '<p class="muted">No ' +
          esc(wanted) +
          " e-notes in the library yet. Check Library → Lesson Notes.</p>";
        return;
      }
      var uniq = {};
      list.innerHTML = books
        .filter(function (b) {
          var k = normalizeSubjectKey(b.title);
          if (uniq[k]) return false;
          uniq[k] = true;
          return true;
        })
        .slice(0, 8)
        .map(function (b) {
          return (
            '<span class="review-book-chip"><strong>' +
            esc(wanted) +
            "</strong> · " +
            esc(b.title) +
            (b.author ? " — " + esc(b.author) : "") +
            "</span>"
          );
        })
        .join("");
    });
  }

  function fetchSiaDeepExplain(q) {
    var subject = q.subject || "General";
    var correctText = optionLabel(q.options, q.correct_key);
    var yourText = q.your_answer ? optionLabel(q.options, q.your_answer) : "Not answered";
    var prompt =
      "I just finished a CBT practice question in " +
      subject +
      ".\n\nQuestion: " +
      (q.question_text || "") +
      "\nMy answer: " +
      yourText +
      "\nCorrect answer: " +
      correctText +
      (q.explanation ? "\nShort explanation: " + q.explanation : "") +
      "\n\nGive a deeper step-by-step explanation so I understand this type of question. " +
      "Then list 2–3 specific books or topics from Scholaxia library I should read to master similar questions.";

    if (!q.is_correct && q.your_answer) {
      return api.api("/api/v1/sia/explain-wrong", {
        method: "POST",
        body: {
          question: q.question_text || "",
          wrong_answer: yourText,
          correct_answer: correctText,
          subject: subject,
          language: "english",
        },
        timeout: 90000,
        retries: 0,
      });
    }
    return api.api("/api/v1/sia/ask", {
      method: "POST",
      body: {
        question: prompt,
        subject: subject,
        language: "english",
        tutor_mode: "smart",
      },
      timeout: 90000,
      retries: 0,
    });
  }

  function renderReviewQuestionCard(q, index) {
    var expl = (q.explanation || "").trim();
    var cls = q.is_skipped ? "is-skipped" : q.is_correct ? "is-correct" : "is-wrong";
    var status = q.is_skipped ? "Skipped" : q.is_correct ? "Correct" : "Wrong";
    return (
      '<article class="review-item ' +
      cls +
      '" data-review-q="' +
      esc(q.id) +
      '">' +
      '<p class="review-meta">Question ' +
      (index + 1) +
      " · " +
      esc(q.subject || "") +
      " · " +
      status +
      (q.topic ? " · " + esc(q.topic) : "") +
      "</p>" +
      '<p class="review-q">' +
      esc(q.question_text || "") +
      "</p>" +
      '<p class="review-answer-row ' +
      cls +
      '"><strong>Your answer:</strong> ' +
      esc(q.your_answer ? optionLabel(q.options, q.your_answer) : "Not answered") +
      "</p>" +
      '<p class="review-answer-row is-correct"><strong>Correct answer:</strong> ' +
      esc(optionLabel(q.options, q.correct_key)) +
      "</p>" +
      (expl
        ? '<div class="review-expl"><strong>Explanation</strong><p>' + esc(expl) + "</p></div>"
        : "") +
      '<div class="review-sia-actions">' +
      '<button type="button" class="btn btn-secondary btn-mini" data-sia-deep="' +
      esc(q.id) +
      '">Ask Sia for deeper explanation</button>' +
      "</div>" +
      '<div class="review-sia" id="review-sia-' +
      esc(q.id) +
      '" hidden></div>' +
      "</article>"
    );
  }

  function showReviewScreen(items, meta) {
    items = items || [];
    meta = meta || lastReviewMeta || {};
    var wrap = $("reviewList");
    var screen = $("review-screen");
    var titleEl = $("reviewPageTitle");
    var subEl = $("reviewPageSub");
    if (!wrap || !screen) return;
    if (titleEl) {
      titleEl.textContent =
        (meta.title || "Your answers & explanations") +
        (meta.percent != null ? " · " + meta.percent + "%" : "");
    }
    if (subEl) {
      subEl.textContent =
        items.length +
        " questions · " +
        (meta.wrong_count != null ? meta.wrong_count + " wrong · " : "") +
        "Tap Ask Sia on any question for a deeper explanation and study tips.";
    }
    if (!items.length) {
      wrap.innerHTML =
        '<div class="empty-state"><strong>No review data yet</strong><p>Finish a CBT exam and tap Review all answers on the result screen.</p></div>';
    } else {
      wrap.innerHTML = items.map(renderReviewQuestionCard).join("");
    }
    var examSubject = meta.subject || subjectFromExamTitle(meta.title);
    if (!examSubject) {
      var seen = {};
      var fromQuestions = [];
      items.forEach(function (q) {
        if (q.subject && !seen[q.subject]) {
          seen[q.subject] = true;
          fromQuestions.push(q.subject);
        }
      });
      if (fromQuestions.length === 1) examSubject = fromQuestions[0];
    }
    loadReviewBookTips(examSubject ? [examSubject] : [], examSubject);
    screen.classList.add("is-on");
    document.body.style.overflow = "hidden";
  }

  function closeReviewScreen() {
    var screen = $("review-screen");
    if (screen) screen.classList.remove("is-on");
    document.body.style.overflow = "";
  }

  document.addEventListener("click", function (e) {
    var siaBtn = e.target.closest("[data-sia-deep]");
    if (!siaBtn) return;
    var qid = siaBtn.dataset.siaDeep;
    var q = (lastExamFullReview || lastExamReview || []).find(function (x) {
      return String(x.id) === String(qid);
    });
    if (!q) return;
    var box = $("review-sia-" + qid);
    if (!box) return;
    siaBtn.disabled = true;
    siaBtn.textContent = "Sia is thinking…";
    box.hidden = false;
    box.innerHTML = "<strong>Sia</strong><p>Loading deeper explanation…</p>";
    fetchSiaDeepExplain(q)
      .then(function (res) {
        var text = (res && (res.sia || res.answer || res.message)) || "Could not load explanation.";
        box.innerHTML = "<strong>Sia — deeper explanation</strong><p>" + esc(text) + "</p>";
        siaBtn.textContent = "Refresh Sia explanation";
        siaBtn.disabled = false;
      })
      .catch(function (err) {
        box.innerHTML =
          "<strong>Sia</strong><p>" +
          esc(errMsg(err) || "Sia is unavailable right now. Try again in a moment.") +
          "</p>";
        siaBtn.textContent = "Try Sia again";
        siaBtn.disabled = false;
      });
  });

  function showResult(res, st) {
    res = res || {};
    lastExamReview = Array.isArray(res.review) ? res.review : null;
    lastExamFullReview = Array.isArray(res.full_review)
      ? res.full_review
      : lastExamReview
      ? lastExamReview.slice()
      : null;
    var score = res.score != null ? res.score : res.correct_count;
    var total =
      res.total != null
        ? res.total
        : res.max_score != null
        ? res.max_score
        : res.total_questions || (st && st.questions && st.questions.length);
    var pct =
      res.percentage != null
        ? res.percentage
        : res.percent != null
        ? res.percent
        : score != null && total
        ? Math.round((score / total) * 100)
        : null;
    lastReviewMeta = {
      title: st ? st.title : "",
      subject: st
        ? st.subject ||
          (st.sections && st.sections[st.sectionIndex] && st.sections[st.sectionIndex].subject) ||
          subjectFromExamTitle(st.title)
        : "",
      examType: st ? st.examType : "",
      percent: pct,
      wrong_count: res.wrong_count != null ? res.wrong_count : lastExamReview ? lastExamReview.length : 0,
      attempt_id: res.attempt_id || (st && st.practiceAttemptId),
    };

    // Owner spec §22/§25: school-exam scores stay hidden until the school
    // publishes — the student sees a confirmation instead of a score.
    var schoolResultHidden =
      (st && (st.isSchool || st.isExternal)) &&
      (res.result_status === "hidden" || res.result_status == null) &&
      !(res.already_submitted && res.result_status === "published");
    if (schoolResultHidden) {
      $("resultRing").textContent = "✓";
      $("resultTitle").textContent = "Exam submitted successfully";
      $("resultSub").textContent = st ? st.title : "";
      $("resultStats").innerHTML =
        '<div style="grid-column:1/-1;text-align:center;padding:8px 4px">' +
        "Your examination has been submitted. Your result will be available " +
        "when published by your school." +
        (res && res.queued_sync
          ? '<div style="margin-top:6px;font-size:0.85rem">📴 You were offline — your answers are saved securely and will sync automatically when you reconnect.</div>'
          : "") +
        "</div>";
    } else {
    $("resultRing").textContent = pct != null ? pct + "%" : "—";
    $("resultTitle").textContent = res.unscored ? "Exam submitted" : "Exam completed";
    $("resultSub").textContent = st ? st.title : "";
    $("resultStats").innerHTML =
      '<div><strong>' +
      (score != null ? score : "—") +
      "</strong><span>Correct</span></div>" +
      '<div><strong>' +
      (total != null ? total : "—") +
      "</strong><span>Total</span></div>" +
      '<div><strong>' +
      (res.offline ? "Offline" : "Synced") +
      "</strong><span>Status</span></div>";
    }
    var reviewBtn = $("resultReviewBtn");
    if (reviewBtn) {
      reviewBtn.hidden = !(st && st.isPractice);
      reviewBtn.textContent = "Review all answers";
    }
    $("result-screen").classList.add("is-on");
    Exam.current = null;
  }

  if ($("resultReviewBtn")) {
    $("resultReviewBtn").addEventListener("click", function () {
      $("result-screen").classList.remove("is-on");
      var items = lastExamFullReview || lastExamReview || [];
      if (!items.length && lastReviewMeta && lastReviewMeta.attempt_id) {
        api
          .api("/api/v1/cbt/practice/attempts/" + lastReviewMeta.attempt_id + "/review", {
            timeout: 60000,
            retries: 0,
          })
          .then(function (data) {
            lastExamFullReview = data.full_review || [];
            lastExamReview = data.review || [];
            lastReviewMeta.wrong_count = data.wrong_count;
            lastReviewMeta.percent = data.percent;
            showReviewScreen(lastExamFullReview, lastReviewMeta);
          })
          .catch(function (err) {
            alert(errMsg(err) || "Could not load review.");
          });
        return;
      }
      showReviewScreen(items, lastReviewMeta);
    });
  }

  if ($("reviewCloseBtn")) {
    $("reviewCloseBtn").addEventListener("click", closeReviewScreen);
  }

  if ($("resultCloseBtn")) {
    $("resultCloseBtn").addEventListener("click", function () {
      $("result-screen").classList.remove("is-on");
      // Refresh whichever exam list is currently visible so downloaded/attempted state updates.
      ["cbt", "school", "school-portal"].forEach(function (p) {
        if (document.getElementById("page-" + p) && document.getElementById("page-" + p).classList.contains("is-on")) {
          loadedPages[p] = false;
          PAGE_LOADERS[p] && PAGE_LOADERS[p]();
        }
      });
    });
  }

  /* =====================================================================
     CBT — exam type packages (JAMB / WAEC / NECO)
     ===================================================================== */

  var cbtHomeCache = null;
  var cbtSelectedBoard = null;
  var DEFAULT_JAMB_SUBJECTS = [
    "Use of English",
    "Mathematics",
    "Physics",
    "Chemistry",
    "Biology",
    "Economics",
    "Government",
    "Literature in English",
    "Geography",
    "Christian Religious Studies",
    "Islamic Religious Studies",
    "Commerce",
    "Accounting",
  ];
  var DEFAULT_SSCE_SUBJECTS = [
    "English Language",
    "Mathematics",
    "Biology",
    "Chemistry",
    "Physics",
    "Economics",
    "Government",
    "Literature in English",
    "Geography",
    "Agricultural Science",
    "Further Mathematics",
    "Commerce",
    "Financial Accounting",
  ];

  function localProfileSubjects() {
    var examType = (localStorage.getItem("sia_exam_type") || "").toUpperCase();
    var jamb = readLocalJson("sia_jamb_subjects", null) || [];
    var ssce = readLocalJson("sia_ssce_subjects", null) || [];
    var any = readLocalJson("sia_subjects", []) || [];
    if ((!jamb || !jamb.length) && examType === "JAMB" && any.length) jamb = any.slice();
    if ((!ssce || !ssce.length) && (examType === "WAEC" || examType === "NECO") && any.length) {
      ssce = any.slice();
    }
    return {
      jamb_subjects: Array.isArray(jamb) ? jamb.filter(Boolean) : [],
      ssce_subjects: Array.isArray(ssce) ? ssce.filter(Boolean) : [],
      ssce_exam_type: examType === "NECO" ? "NECO" : "WAEC",
    };
  }

  function cachedCbtSettings() {
    return readLocalJson("sia_cbt_settings", null) || {};
  }

  function saveCachedCbtSettings(settings) {
    if (!settings || typeof settings !== "object") return;
    writeLocalJson("sia_cbt_settings", {
      cbt_enabled: settings.cbt_enabled !== false,
      jamb_subjects_required: Number(settings.jamb_subjects_required) || 4,
      jamb_duration_minutes: Number(settings.jamb_duration_minutes) || 60,
      jamb_questions_per_subject: Number(settings.jamb_questions_per_subject) || 40,
      jamb_english_questions: Number(settings.jamb_english_questions) || 40,
      waec_duration_minutes: Number(settings.waec_duration_minutes) || 60,
      neco_duration_minutes: Number(settings.neco_duration_minutes) || 60,
    });
  }

  function defaultCbtHome(accessBoards) {
    var boards = accessBoards || [];
    function has(b) {
      return boards.indexOf(b) >= 0;
    }
    // Treat a very recent coupon redeem as unlocked on this device
    try {
      var justAt = Number(sessionStorage.getItem("sia_cbt_just_unlocked") || 0);
      var pkg = String(sessionStorage.getItem("sia_cbt_package_id") || "").toLowerCase();
      if (justAt && Date.now() - justAt < 24 * 60 * 60 * 1000) {
        ["jamb", "waec", "neco"].forEach(function (id) {
          if (pkg === id || pkg.indexOf(id) >= 0) {
            var name = id.toUpperCase();
            if (boards.indexOf(name) < 0) boards.push(name);
          }
        });
        if (!pkg && boards.indexOf("JAMB") < 0) boards.push("JAMB", "WAEC", "NECO");
      }
    } catch (e) {}
    var cached = cachedCbtSettings();
    return {
      settings: {
        cbt_enabled: cached.cbt_enabled !== false,
        jamb_subjects_required: Number(cached.jamb_subjects_required) || 4,
        // Prefer last admin settings from API — do not hardcode 180
        jamb_duration_minutes: Number(cached.jamb_duration_minutes) || 60,
        jamb_questions_per_subject: Number(cached.jamb_questions_per_subject) || 40,
        jamb_english_questions: Number(cached.jamb_english_questions) || 40,
        waec_duration_minutes: Number(cached.waec_duration_minutes) || 60,
        neco_duration_minutes: Number(cached.neco_duration_minutes) || 60,
      },
      exam_types: [
        { exam_type: "JAMB", has_access: has("JAMB"), package_id: "jamb" },
        { exam_type: "WAEC", has_access: has("WAEC"), package_id: "waec" },
        { exam_type: "NECO", has_access: has("NECO"), package_id: "neco" },
      ],
      profile: localProfileSubjects(),
      _local: true,
    };
  }

  function mergeCbtHome(data) {
    var base = defaultCbtHome();
    var incoming = data || {};
    var local = localProfileSubjects();
    var profile = Object.assign({}, base.profile, incoming.profile || {});
    if (!(profile.jamb_subjects && profile.jamb_subjects.length) && local.jamb_subjects.length) {
      profile.jamb_subjects = local.jamb_subjects.slice();
    }
    if (!(profile.ssce_subjects && profile.ssce_subjects.length) && local.ssce_subjects.length) {
      profile.ssce_subjects = local.ssce_subjects.slice();
    }
    var types = (incoming.exam_types && incoming.exam_types.length
      ? incoming.exam_types
      : base.exam_types
    ).map(function (t) {
      var localT = (base.exam_types || []).find(function (x) {
        return x.exam_type === t.exam_type;
      });
      return Object.assign({}, t, {
        has_access: !!(t.has_access || (localT && localT.has_access)),
      });
    });
    var settings = Object.assign({}, base.settings, incoming.settings || {});
    if (incoming.settings) saveCachedCbtSettings(settings);
    return {
      settings: settings,
      exam_types: types,
      profile: profile,
    };
  }

  function loadCbt() {
    var list = $("cbtExamTypeList");
    var home = $("cbtHomePanel");
    var board = $("cbtBoardPanel");
    if (home) home.hidden = false;
    if (board) board.hidden = true;
    if (!list) return;

    function applyHome(data) {
      cbtHomeCache = mergeCbtHome(data);
      renderCbtExamTypes();
    }

    // Never leave cards stuck on "Loading…" — show Locked packages immediately
    applyHome(defaultCbtHome());

    function fallbackHome() {
      return api
        .api("/api/v1/payments/paystack/cbt-access", { timeout: 12000, retries: 0, preferXhr: true })
        .then(function (access) {
          return defaultCbtHome((access && access.boards) || []);
        });
    }

    if (api.wakeServer) {
      try {
        api.wakeServer(12000);
      } catch (e) {}
    }

    api
      .api("/api/v1/cbt/practice/home", { timeout: 18000, retries: 0, preferXhr: true })
      .then(applyHome)
      .catch(function () {
        fallbackHome()
          .then(applyHome)
          .catch(function () {
            // Keep the local Locked cards — user can still tap JAMB → coupon/pay
            applyHome(defaultCbtHome());
          });
      });
  }

  function renderCbtExamTypes() {
    var list = $("cbtExamTypeList");
    if (!list) return;
    var types = (cbtHomeCache && cbtHomeCache.exam_types) || [];
    if (!types.length) {
      list.innerHTML = emptyHtml("📝", "CBT is not available yet.");
      return;
    }
    var settings = (cbtHomeCache && cbtHomeCache.settings) || {};
    if (settings.cbt_enabled === false) {
      list.innerHTML = emptyHtml("📝", "CBT practice is currently disabled by admin.");
      return;
    }
    list.innerHTML = types
      .map(function (t) {
        var board = t.exam_type;
        var access = t.has_access
          ? '<span class="badge badge-purple">Unlocked</span>'
          : '<span class="badge">Locked</span>';
        var hint =
          board === "JAMB"
            ? "One combined CBT · your profile subjects · settings from admin"
            : "Subject practice from your registered profile subjects";
        var logoFile =
          board === "JAMB" ? "media/jamb-logo.svg"
          : board === "WAEC" ? "media/waec-logo.svg"
          : board === "NECO" ? "media/neco-logo.svg"
          : null;
        var logoHtml = logoFile
          ? '<img src="' + logoFile + '" alt="' + esc(board) + ' logo" style="width:44px;height:44px;float:right;margin-left:0.75rem" onerror="this.style.display=\'none\'" />'
          : "";
        return (
          '<button type="button" class="card card-click" data-cbt-board="' +
          esc(board) +
          '" style="text-align:left;cursor:pointer;border:1px solid #e2e8f0">' +
          logoHtml +
          '<span class="card-tag">' +
          esc(board) +
          "</span>" +
          access +
          "<h4 style=\"margin:0.5rem 0 0.35rem\">" +
          esc(board) +
          "</h4><p style=\"margin:0;color:#64748b;font-size:0.9rem\">" +
          esc(hint) +
          "</p></button>"
        );
      })
      .join("");
  }

  function boardHasAccess(board) {
    var types = (cbtHomeCache && cbtHomeCache.exam_types) || [];
    var info = types.find(function (t) {
      return t.exam_type === board;
    });
    return !!(info && info.has_access);
  }

  function markBoardUnlockedLocally(board) {
    try {
      sessionStorage.setItem("sia_cbt_just_unlocked", String(Date.now()));
      sessionStorage.setItem("sia_cbt_package_id", String(board).toLowerCase());
    } catch (e) {}
    cbtHomeCache = mergeCbtHome(
      Object.assign({}, cbtHomeCache || {}, {
        exam_types: ["JAMB", "WAEC", "NECO"].map(function (b) {
          var prev = ((cbtHomeCache && cbtHomeCache.exam_types) || []).find(function (t) {
            return t.exam_type === b;
          });
          return {
            exam_type: b,
            has_access: b === board || !!(prev && prev.has_access),
            package_id: b.toLowerCase(),
          };
        }),
      })
    );
  }

  /* =====================================================================
     JUNIOR WAEC — unlock → select subjects (up to 9) → START builds one
     combined attempt with a question section for every selected subject.
     ===================================================================== */
  var cbtJwPicked = [];

  function renderJuniorWaecBoard(cfg) {
    var body = cfg.body;
    var hint = cfg.hint;
    var profile = cfg.profile || {};
    var settings = cfg.settings || {};
    var unlocked = !!cfg.unlocked;
    var dur = Number(settings.jw_duration_minutes) || 60;
    var per = Number(settings.jw_questions_per_subject) || 60;

    if (hint) {
      hint.textContent = unlocked
        ? "Select your subjects (up to 9), then start — every subject's questions load in one exam."
        : "Preview first. Pay or enter a coupon when you tap START.";
    }

    if (!unlocked) {
      body.innerHTML =
        '<div class="empty-state"><strong>Junior WAEC is locked</strong>' +
        "<p>Use a coupon or pay for the Junior WAEC package — then pick your subjects and start.</p>" +
        '<button type="button" class="btn btn-primary" id="cbtJwUnlock">Unlock with coupon or pay</button></div>';
      var ub = document.getElementById("cbtJwUnlock");
      if (ub) {
        ub.onclick = function () {
          openCbtUnlockModal(function () {
            markBoardUnlockedLocally("JUNIOR_WAEC");
            cbtJwPicked = [];
            openCbtBoard("JUNIOR_WAEC", { skipUnlockModal: true });
          });
        };
      }
      return;
    }

    var choices = (profile.junior_subjects || []).filter(Boolean);
    if (!choices.length) {
      choices = SUBJECT_CHANGE_CHOICES.slice();
    }
    if (!cbtJwPicked.length) {
      var localJw = readLocalJson("sia_junior_subjects", null) || [];
      if (Array.isArray(localJw) && localJw.length) cbtJwPicked = localJw.filter(Boolean).slice(0, 9);
    }
    cbtJwPicked = cbtJwPicked.filter(function (s) { return choices.indexOf(s) >= 0; });

    body.innerHTML =
      '<p class="muted" style="margin:0 0 0.85rem">Select your subjects (up to 9) · ' +
      esc(String(per)) + " questions per subject · " + esc(String(dur)) + " min total</p>" +
      '<div style="display:flex;flex-wrap:wrap;gap:0.45rem" id="cbtJwChips">' +
      choices
        .map(function (s) {
          var on = cbtJwPicked.indexOf(s) >= 0;
          return (
            '<button type="button" data-jw-pick="' + esc(s) +
            '" style="padding:0.45rem 0.9rem;border-radius:999px;border:1px solid " + (on ? "#7c3aed" : "#e2e8f0") + ";background:" + (on ? "#f3e8ff" : "#fff") + ";font-size:0.88rem;cursor:pointer">' +
            esc(s) +
            "</button>"
          );
        })
        .join("") +
      "</div>" +
      '<p style="margin:0.8rem 0" class="muted"><span id="cbtJwCount">' + cbtJwPicked.length +
      "</span> subject(s) selected</p>" +
      '<button type="button" class="btn btn-primary" id="cbtJwStart" ' + (cbtJwPicked.length ? "" : "disabled") + ">START JUNIOR WAEC</button>" +
      '<p id="cbtJwMsg" class="form-status" style="margin-top:0.75rem"></p>';

    var startBtn = document.getElementById("cbtJwStart");
    if (startBtn) {
      startBtn.onclick = function () {
        if (!cbtJwPicked.length) return;
        var picked = cbtJwPicked.slice();
        startBtn.disabled = true;
        startBtn.textContent = "Saving subjects…";
        api
          .api("/api/v1/cbt/practice/register-subjects", {
            method: "POST",
            body: { exam_type: "JUNIOR_WAEC", subjects: picked },
            timeout: 30000,
            retries: 0,
            preferXhr: true,
          })
          .then(function () {
            writeLocalJson("sia_junior_subjects", picked);
            startBtn.textContent = "Starting…";
            startPracticeAttempt("JUNIOR_WAEC", picked, startBtn);
          })
          .catch(function (err) {
            startBtn.disabled = false;
            startBtn.textContent = "START JUNIOR WAEC";
            var msg = document.getElementById("cbtJwMsg");
            if (msg) {
              msg.className = "form-status err";
              msg.textContent = errMsg(err) || "Could not save subjects. Try again.";
            }
          });
      };
    }
  }

  function ensureBoardUnlockedThen(board, run) {
    if (boardHasAccess(board)) {
      run();
      return;
    }
    openCbtUnlockModal(function () {
      markBoardUnlockedLocally(board);
      run();
    });
  }

  function openCbtBoard(board, opts) {
    opts = opts || {};
    cbtSelectedBoard = board;
    var pickedSsce = (typeof cbtSscePicked !== "undefined" && cbtSscePicked) || [];
    if (!cbtHomeCache) cbtHomeCache = defaultCbtHome();

    // Never show pay/coupon until the student taps START
    try {
      closeCbtUnlockModal(true);
    } catch (eClose) {}

    var home = $("cbtHomePanel");
    var panel = $("cbtBoardPanel");
    var body = $("cbtBoardBody");
    var title = $("cbtBoardTitle");
    var hint = $("cbtBoardHint");
    if (home) home.hidden = true;
    if (panel) panel.hidden = false;
    if (title) title.textContent = board === "JAMB" ? "Your JAMB exam" : board + " CBT";
    if (!body) return;

    var types = (cbtHomeCache && cbtHomeCache.exam_types) || [];
    var info = types.find(function (t) {
      return t.exam_type === board;
    }) || { has_access: false };
    var profile = Object.assign({}, localProfileSubjects(), (cbtHomeCache && cbtHomeCache.profile) || {});
    var settings = (cbtHomeCache && cbtHomeCache.settings) || {};
    var unlocked = !!info.has_access;

    if (board === "JAMB") {
      var need = settings.jamb_subjects_required || 4;
      var jambSubs = (profile.jamb_subjects || []).filter(Boolean);
      if (jambSubs.length < need) {
        var localJamb = readLocalJson("sia_jamb_subjects", null) || readLocalJson("sia_subjects", []);
        if (Array.isArray(localJamb) && localJamb.length) jambSubs = localJamb.filter(Boolean);
      }
      // Dedupe keep order
      jambSubs = jambSubs.filter(function (s, i, arr) {
        return arr.indexOf(s) === i;
      });
      var dur = Number(settings.jamb_duration_minutes) || Number(cachedCbtSettings().jamb_duration_minutes) || 60;
      var perSub = Number(settings.jamb_questions_per_subject) || Number(cachedCbtSettings().jamb_questions_per_subject) || 40;
      var totalQ = perSub * jambSubs.length;
      if (hint) {
        hint.textContent = "Your saved JAMB subjects. Settings come from Admin CBT Settings.";
      }
      if (!jambSubs.length) {
        body.innerHTML =
          '<div class="empty-state"><strong>No JAMB subjects saved yet</strong>' +
          "<p>Go to Profile, choose your " +
          need +
          " JAMB subjects, save, then come back here to preview the exam.</p>" +
          '<button type="button" class="btn btn-primary" data-goto="profile">Open Profile</button></div>';
        // Refresh from API in case subjects exist only on server
        api.api("/api/v1/students/me", { timeout: 15000, retries: 0, preferXhr: true }).then(function (me) {
          var p = (me && (me.profile || me)) || {};
          var remote = p.jamb_subjects || p.subjects || [];
          if (Array.isArray(remote) && remote.length) {
            writeLocalJson("sia_jamb_subjects", remote);
            writeLocalJson("sia_subjects", remote);
            openCbtBoard("JAMB");
          }
        }).catch(function () {});
        return;
      }
      body.innerHTML =
        "<h3 style=\"margin:0 0 0.55rem\">Your " +
        esc(String(jambSubs.length)) +
        " subjects</h3>" +
        '<p class="muted" style="margin:0 0 0.85rem">' +
        esc(String(totalQ)) +
        " questions · " +
        esc(String(dur)) +
        " minutes (from admin settings)</p>" +
        '<ol style="margin:0 0 1rem;padding:0;list-style:none;display:grid;gap:0.45rem">' +
        jambSubs
          .map(function (s, idx) {
            return (
              '<li style="display:flex;align-items:center;gap:0.75rem;padding:0.85rem 1rem;border:1px solid #e2e8f0;border-radius:12px;background:#fff">' +
              '<span style="width:1.75rem;height:1.75rem;border-radius:999px;background:#ede9fe;color:#5b21b6;display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:0.85rem">' +
              (idx + 1) +
              "</span>" +
              '<span style="font-weight:700;font-size:1.02rem">' +
              esc(s) +
              "</span>" +
              '<span style="margin-left:auto;color:#64748b;font-size:0.85rem">' +
              esc(String(perSub)) +
              " q</span></li>"
            );
          })
          .join("") +
        "</ol>" +
        (jambSubs.length !== need
          ? '<p class="form-status err" style="margin:0 0 0.85rem">JAMB usually needs exactly ' +
            need +
            " subjects. You have " +
            jambSubs.length +
            '. <button type="button" class="btn btn-mini" data-goto="profile">Edit in Profile</button></p>'
          : "") +
        (unlocked
          ? ""
          : '<p style="margin:0 0 1rem;padding:0.75rem 0.9rem;border-radius:10px;background:#ecfdf5;color:#065f46;font-size:0.92rem">Preview only for now. Coupon or Paystack appears when you tap <strong>Start this JAMB exam</strong>.</p>') +
        '<div class="btn-row" style="margin-top:0.5rem">' +
        '<button type="button" class="btn btn-primary" id="cbtStartJambBtn">' +
        (unlocked ? "START CBT" : "Start this JAMB exam") +
        "</button>" +
        "</div>" +
        '<p id="cbtJambPickMsg" class="form-status" style="margin-top:0.75rem"></p>';
      var startJ = $("cbtStartJambBtn");
      if (startJ) {
        startJ.onclick = function () {
          if (jambSubs.length !== need) {
            var msg = $("cbtJambPickMsg");
            if (msg) {
              msg.className = "form-status err";
              msg.textContent = "Save exactly " + need + " JAMB subjects in Profile first.";
            }
            return;
          }
          ensureBoardUnlockedThen(board, function () {
            startPracticeAttempt("JAMB", jambSubs.slice(), startJ);
          });
        };
      }
      // Refresh admin settings in background so duration/question counts stay correct
      api
        .api("/api/v1/cbt/practice/settings", { timeout: 12000, retries: 0, preferXhr: true })
        .then(function (data) {
          if (!data || !data.settings) return;
          saveCachedCbtSettings(data.settings);
          if (cbtHomeCache) cbtHomeCache.settings = Object.assign({}, cbtHomeCache.settings || {}, data.settings);
          var nextDur = Number(data.settings.jamb_duration_minutes);
          if (nextDur && nextDur !== dur) openCbtBoard("JAMB", { skipUnlockModal: true });
        })
        .catch(function () {});
      return;
    }

    // WAEC / NECO — before first start the student picks their own subjects
    // (up to 9). After the first start the subjects are locked and each
    // registered subject becomes a one-tap card.
    /* Junior WAEC has its own flow: unlock → pick subjects (up to 9) →
       one combined attempt with a section (and questions) per subject. */
    if (board === "JUNIOR_WAEC") {
      renderJuniorWaecBoard({
        body: body,
        hint: hint,
        profile: profile,
        settings: settings,
        unlocked: unlocked,
      });
      return;
    }

    var registered = (profile.ssce_subjects || []).filter(Boolean);
    var ssceStarted = !!profile.ssce_started;
    var isRegistered = registered.length > 0 && ssceStarted;
    if (!registered.length) {
      var localSsce = readLocalJson("sia_ssce_subjects", null) || readLocalJson("sia_subjects", []);
      if (Array.isArray(localSsce) && localSsce.length) registered = localSsce.slice();
    }
    if (hint) {
      hint.textContent = unlocked
        ? (isRegistered ? "Pick a subject and start." : "Select your subjects (up to 9), then start. They lock after your first exam.")
        : "Preview first. Pay or coupon only when you tap START.";
    }
    if (!registered.length) {
      body.innerHTML =
        '<div class="empty-state"><strong>No ' +
        esc(board) +
        " subjects on your profile</strong>" +
        "<p>Add your subjects under Profile, then return here.</p>" +
        '<button type="button" class="btn btn-primary" data-goto="profile">Open Profile</button></div>';
      return;
    }
    var packDur =
      board === "WAEC" ? settings.waec_duration_minutes || 60 : settings.neco_duration_minutes || 60;
    var html =
      (unlocked
        ? ""
        : '<p style="margin:0 0 0.85rem;padding:0.75rem 0.9rem;border-radius:10px;background:#ecfdf5;color:#065f46;font-size:0.92rem">Review your subjects first. Unlock with coupon or pay when you start.</p>') +
      '<p class="muted" style="margin:0 0 0.85rem">' +
      (isRegistered
        ? "Pick one subject to practice · " + esc(String(packDur)) + " min"
        : "Select your subjects (up to 9) · " + esc(String(packDur)) + " min · locked after first exam") +
      "</p>";
    if (isRegistered) {
      html +=
        '<div class="card-grid" id="cbtSubjectCards">' +
        registered
          .map(function (s) {
            return (
              '<div class="card"><span class="card-tag">' +
              esc(board) +
              "</span><h4>" +
              esc(s) +
              "</h4>" +
              '<div class="card-foot"><button type="button" class="btn btn-primary btn-mini" data-cbt-start-subject="' +
              esc(s) +
              '">' +
              (unlocked ? "START CBT" : "START") +
              "</button></div></div>"
            );
          })
          .join("") +
        "</div>";
    } else {
      var allChoices = SUBJECT_CHANGE_CHOICES.concat(registered).filter(function (s, i, a) {
        return a.indexOf(s) === i;
      });
      html +=
        '<div id="cbtSscePick" style="display:flex;flex-wrap:wrap;gap:0.45rem">' +
        allChoices
          .map(function (s) {
            var on = pickedSsce.indexOf(s) >= 0;
            return (
              '<button type="button" data-ssce-pick="' + esc(s) +
              '" style="padding:0.4rem 0.85rem;border-radius:999px;border:1px solid " + (on ? "#7c3aed" : "#e2e8f0") + ";background:" + (on ? "#f3e8ff" : "#fff") + ";font-size:0.86rem;cursor:pointer">' +
              esc(s) +
              "</button>"
            );
          })
          .join("") +
        "</div>" +
        '<p style="margin:0.8rem 0 0" class="muted"><span id="cbtSsceCount">' +
        pickedSsce.length +
        "</span> selected · you can change these until your first exam starts.</p>";
    }
    html +=
      '<p style="margin:1rem 0 0">' +
      (isRegistered
        ? '<button type="button" class="btn btn-ghost btn-mini" data-cbt-subject-change="' + esc(board) + '">Request subject change (admin approves)</button>'
        : '<button type="button" class="btn btn-primary" id="cbtSsceContinue" ' + (pickedSsce.length ? "" : "disabled") + '>CONTINUE</button>') +
      "</p>";
    body.innerHTML = html;
    if (!isRegistered) {
      body.addEventListener("click", function (e) {
        var chipBtn = e.target.closest("[data-ssce-pick]");
        if (chipBtn) {
          var s = chipBtn.getAttribute("data-ssce-pick");
          var i = pickedSsce.indexOf(s);
          if (i >= 0) pickedSsce.splice(i, 1);
          else if (pickedSsce.length < 9) pickedSsce.push(s);
          else alert("Maximum 9 subjects.");
          var count = document.getElementById("cbtSsceCount");
          if (count) count.textContent = String(pickedSsce.length);
          chipBtn.style.border = "1px solid " + (pickedSsce.indexOf(s) >= 0 ? "#7c3aed" : "#e2e8f0");
          chipBtn.style.background = pickedSsce.indexOf(s) >= 0 ? "#f3e8ff" : "#fff";
          var startBtn = document.getElementById("cbtSsceStart");
          if (startBtn) startBtn.disabled = !pickedSsce.length;
          return;
        }
        if (e.target.id === "cbtSsceContinue") {
          if (!pickedSsce.length) return;
          registerSsceSubjects(board, pickedSsce.slice(), e.target);
          return;
        }
      });
    }
  }

  /* CONTINUE: save (and lock) WAEC/NECO subjects without starting an exam.
     After registration the board re-renders showing one card per subject. */
  function registerSsceSubjects(board, subjects, btn) {
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Saving…";
    }
    api
      .api("/api/v1/cbt/practice/register-subjects", {
        method: "POST",
        body: { exam_type: board, subjects: subjects },
        timeout: 30000,
        retries: 0,
        preferXhr: true,
      })
      .then(function () {
        cbtHomeCache = cbtHomeCache || {};
        var prof = (cbtHomeCache.profile = cbtHomeCache.profile || {});
        if (board === "WAEC") prof.waec_subjects = subjects.slice();
        else prof.neco_subjects = subjects.slice();
        prof.ssce_subjects = subjects.slice();
        prof.ssce_exam_type = board;
        prof.ssce_started = !!prof.ssce_started;
        openCbtBoard(board, { skipUnlockModal: true });
      })
      .catch(function (err) {
        if (btn) {
          btn.disabled = false;
          btn.textContent = "CONTINUE";
        }
        var msg = errMsg(err) || "Could not save subjects. Try again.";
        if (String(err && (err.status || err.code)).indexOf("409") >= 0 || /locked/i.test(msg)) {
          msg = "Your subjects are locked. Send your admin a subject-change request.";
        }
        alert(msg);
      });
  }

  /* Subject-change request modal (admin approves before subjects change) */
  var cbtSscePicked = [];
  var SUBJECT_CHANGE_CHOICES = [
    "English Language", "Mathematics", "Biology", "Chemistry", "Physics",
    "Economics", "Government", "Literature-in-English", "CRS", "IRS",
    "Agricultural Science", "Commerce", "Accounting", "Geography",
    "Civic Education", "Computer Studies", "Further Mathematics", "French",
  ];

  function openSubjectChangeModal(board) {
    var profile = Object.assign({}, localProfileSubjects(), (cbtHomeCache && cbtHomeCache.profile) || {});
    var current = (board === "JAMB" ? profile.jamb_subjects : profile.ssce_subjects) || [];
    var picked = current.slice();
    var overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem";
    function chip(s) {
      var on = picked.indexOf(s) >= 0;
      return (
        '<button type="button" data-scc="' + esc(s) +
        '" style="margin:0.2rem;padding:0.3rem 0.7rem;border-radius:999px;border:1px solid ' +
        (on ? "#7c3aed" : "#e2e8f0") + ";background:" + (on ? "#f3e8ff" : "#fff") +
        ';font-size:0.82rem;cursor:pointer">' + esc(s) + "</button>"
      );
    }
    function body() {
      return (
        '<h4 style="margin:0 0 0.3rem">Request ' + esc(board) + " subject change</h4>" +
        '<p style="margin:0 0 0.7rem;color:#64748b;font-size:0.88rem">Admin reviews and approves before your subjects change.</p>' +
        '<div style="max-height:220px;overflow:auto">' +
        SUBJECT_CHANGE_CHOICES.map(chip).join("") +
        "</div>" +
        '<textarea id="sccReason" placeholder="Why do you need this change? (optional)" style="width:100%;margin-top:0.7rem;min-height:60px"></textarea>' +
        '<div style="display:flex;justify-content:flex-end;gap:0.5rem;margin-top:0.8rem">' +
        '<button type="button" id="sccCancel" class="btn btn-ghost btn-mini">Cancel</button>' +
        '<button type="button" id="sccSend" class="btn btn-primary btn-mini">Send request</button></div>'
      );
    }
    var box = document.createElement("div");
    box.style.cssText =
      "background:#fff;border-radius:14px;padding:1.1rem 1.2rem;max-width:420px;width:100%;max-height:85vh;overflow:auto";
    box.innerHTML = body();
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    function close() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }
    overlay.addEventListener("click", function (e) {
      var chipBtn = e.target.closest("[data-scc]");
      if (chipBtn) {
        var s = chipBtn.getAttribute("data-scc");
        var i = picked.indexOf(s);
        if (i >= 0) picked.splice(i, 1);
        else picked.push(s);
        box.innerHTML = body();
        return;
      }
      if (e.target === overlay) close();
    });
    box.addEventListener("click", function (e) {
      if (e.target.id === "sccCancel") {
        close();
        return;
      }
      if (e.target.id === "sccSend") {
        var reason = (document.getElementById("sccReason") || {}).value || "";
        api
          .api("/api/v1/cbt/subject-change-requests", {
            method: "POST",
            body: { board: board, new_subjects: picked, reason: reason.trim() || undefined },
          })
          .then(function (res) {
            close();
            alert((res && res.message) || "Request sent to admin.");
          })
          .catch(function (err) {
            alert(errMsg(err) || "Could not send request.");
          });
      }
    });
  }

  function startPracticeAttempt(examType, subjects, btn) {
    var statusEl = $("cbtJambPickMsg");
    function setStartStatus(msg, ok) {
      if (!statusEl) return;
      statusEl.className = "form-status" + (msg ? (ok ? " ok" : " err") : "");
      statusEl.textContent = msg || "";
    }
    function resetStartBtn() {
      if (!btn) return;
      btn.disabled = false;
      btn.textContent = btn.getAttribute("data-start-label") || "Start this JAMB exam";
    }
    if (btn) {
      if (!btn.getAttribute("data-start-label")) {
        btn.setAttribute("data-start-label", btn.textContent || "Start this JAMB exam");
      }
      btn.disabled = true;
      btn.textContent = "Opening…";
    }
    setStartStatus("Opening exam…", true);

    try {
      if ($("result-screen")) $("result-screen").classList.remove("is-on");
    } catch (e0) {}

    if (api.wakeServer) {
      try {
        api.wakeServer(12000);
      } catch (eWake) {}
    }

    var finished = false;
    var watchdog = setTimeout(function () {
      if (finished) return;
      setStartStatus("Still opening… one moment.", true);
    }, 5000);
    var hardStop = setTimeout(function () {
      if (finished) return;
      finished = true;
      clearTimeout(watchdog);
      resetStartBtn();
      setStartStatus("Start timed out. Tap Start again.", false);
    }, 60000);

    api
      .api("/api/v1/cbt/practice/start", {
        method: "POST",
        body: { exam_type: examType, subjects: subjects },
        timeout: 55000,
        retries: 0,
        preferXhr: true,
      })
      .then(function (attempt) {
        if (finished && !attempt) return;
        finished = true;
        clearTimeout(watchdog);
        clearTimeout(hardStop);
        resetStartBtn();
        try {
          openPracticeAttempt(attempt);
          setStartStatus("", true);
        } catch (openErr) {
          setStartStatus(errMsg(openErr) || "Could not open exam. Tap Start again.", false);
        }
      })
      .catch(function (err) {
        if (finished) return;
        finished = true;
        clearTimeout(watchdog);
        clearTimeout(hardStop);
        resetStartBtn();
        if (isCbtPackageError(err)) {
          setStartStatus("Unlock required — use coupon or pay, then start again.", false);
          openCbtUnlockModal(function () {
            startPracticeAttempt(examType, subjects, btn);
          });
          return;
        }
        setStartStatus(errMsg(err) || "Could not start CBT. Try again.", false);
      });
  }

  function sectionQuestions(section) {
    return normalizeQuestions((section && section.questions) || []).map(function (q) {
      return q;
    });
  }

  function openPracticeAttempt(attempt) {
    if (!attempt || !attempt.attempt_id) {
      alert("Could not start CBT attempt.");
      return;
    }
    // Never show a fake completed result instead of the exam
    if (String(attempt.status || "").toLowerCase() === "completed") {
      alert("That attempt already finished. Starting a new exam…");
      startPracticeAttempt(attempt.exam_type || cbtSelectedBoard || "JAMB", attempt.subjects || [], null);
      return;
    }

    var sections = attempt.sections || [];
    if (!sections.length) {
      alert("No questions were loaded for this exam. Ask admin to upload JAMB practice questions.");
      return;
    }
    var totalQs = 0;
    sections.forEach(function (sec) {
      totalQs += Number(sec && sec.total) || ((sec && sec.questions) || []).length || 0;
    });
    if (!totalQs) {
      alert("No questions were loaded for this exam. Ask admin to upload JAMB practice questions.");
      return;
    }

    var idx = Math.min(attempt.section_index || 0, Math.max(0, sections.length - 1));
    var answers = Object.assign({}, attempt.answers || {});
    try {
      var cached = JSON.parse(localStorage.getItem("sia_cbt_attempt_" + attempt.attempt_id) || "null");
      if (cached && cached.answers) Object.assign(answers, cached.answers);
    } catch (e) {}
    var hasAnyAnswer = Object.keys(answers).length > 0;
    var multi = sections.length > 1;

    var durationMinutes =
      attempt.duration_minutes ||
      Number(cachedCbtSettings().jamb_duration_minutes) ||
      60;
    var remaining =
      typeof attempt.seconds_left === "number" ? attempt.seconds_left : durationMinutes * 60;
    // Expired resumed attempts used to open with 0s and instantly submit as 0%
    if (!(remaining > 30)) {
      remaining = durationMinutes * 60;
    }

    Exam.current = {
      practiceAttemptId: attempt.attempt_id,
      examId: attempt.attempt_id,
      title: (attempt.exam_type || "CBT") + " CBT",
      examType: attempt.exam_type,
      sections: sections,
      sectionIndex: idx,
      questions: [],
      answers: answers,
      sessionId: null,
      isPractice: true,
      awaitingSectionPick: false,
      isExternal: false,
      isSchool: false,
      index: 0,
      durationMinutes: durationMinutes,
      remainingSec: remaining,
      timerId: null,
    };

    try {
      if ($("result-screen")) $("result-screen").classList.remove("is-on");
      closeCbtUnlockModal(true);
    } catch (e1) {}

    if ($("examTitle")) $("examTitle").textContent = Exam.current.title;
    updatePracticeExamSub();
    var screen = $("exam-screen");
    if (!screen) {
      throw new Error("Exam screen missing on this page. Hard refresh and try again.");
    }
    screen.classList.add("is-on");
    screen.style.display = "flex";
    try {
      screen.scrollIntoView({ behavior: "smooth", block: "start" });
      window.scrollTo(0, 0);
    } catch (eScroll) {}
    startExamTimer();

    // No chooser popup — load the selected top subject (or first) immediately
    var chooser = $("examSectionChooser");
    if (chooser) chooser.hidden = true;
    // Junior WAEC opens the ALL-QUESTIONS view: every selected subject's
    // questions listed one after another on a single page.
    if (String(attempt.exam_type || "").toUpperCase() === "JUNIOR_WAEC" && sections.length > 1) {
      openPracticeAllQuestions(0);
      return;
    }
    enterPracticeSection(idx, true);
  }

  /* Junior WAEC all-questions page: every subject section rendered on one
     scrolling page, grouped under subject headings. Questions are fetched
     per section the first time they are shown. */
  var _jwAllLoading = false;

  function openPracticeAllQuestions(startIndex) {
    var st = Exam.current;
    if (!st || !st.isPractice) return;
    st.awaitingSectionPick = false;
    st.sectionIndex = parseInt(startIndex, 10) || 0;
    st._jwAllView = true;

    var bar = $("examSectionBar");
    var chooser = $("examSectionChooser");
    var body = $("examBody");
    if (bar) bar.hidden = false;
    if (chooser) chooser.hidden = true;
    renderPracticeSectionTabs();

    var title = $("examTitle");
    if (title) title.textContent = (st.examType || "CBT") + " · All subjects";
    if ($("examSub")) {
      $("examSub").textContent =
        (st.examType || "CBT") + " · " + (st.sections || []).length + " subjects · all questions in one page";
    }

    if (body) {
      body.innerHTML =
        '<div style="max-width:860px;margin:0 auto;padding:1rem" id="jwAllWrap">' +
        '<p class="muted">Loading your subjects…</p></div>';
    }
    loadNextJwSection(0);
  }

  function loadNextJwSection(i) {
    var st = Exam.current;
    if (!st || !st.isPractice) return;
    var sections = st.sections || [];
    if (i >= sections.length) {
      wireJwAllSubmit();
      return;
    }
    var sec = sections[i];
    if (sec && sec.questions && sec.questions.length) {
      appendJwSection(i);
      loadNextJwSection(i + 1);
      return;
    }
    api
      .api(
        "/api/v1/cbt/practice/attempts/" + encodeURIComponent(st.practiceAttemptId) +
          "/sections/" + i,
        { timeout: 60000, retries: 1, preferXhr: true }
      )
      .then(function (data) {
        var norm = normalizeQuestions((data && data.questions) || []);
        sections[i].questions = norm;
        sections[i].total = Number(data && data.total) || norm.length;
        appendJwSection(i);
        loadNextJwSection(i + 1);
      })
      .catch(function () {
        appendJwSection(i, "Could not load " + ((sec && sec.subject) || "this subject") + " — tap its tab to retry.");
        loadNextJwSection(i + 1);
      });
  }

  function appendJwSection(i, errText) {
    var st = Exam.current;
    var wrap = document.getElementById("jwAllWrap");
    if (!st || !wrap) return;
    var sec = (st.sections || [])[i] || {};
    var qs = sec.questions || [];
    var answers = st.answers || {};
    var html =
      '<div class="jw-all-section" style="margin:0 0 1.5rem" data-jw-all-section="' + i + '">' +
      '<div style="display:flex;align-items:center;gap:0.6rem;margin:0 0 0.6rem">' +
      '<span style="width:1.75rem;height:1.75rem;border-radius:999px;background:#ede9fe;color:#5b21b6;display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:0.85rem">' +
      (i + 1) + "</span>" +
      '<h3 style="margin:0;font-size:1.05rem">' + esc(sec.subject || "Subject " + (i + 1)) + "</h3>" +
      '<span class="muted" style="font-size:0.85rem">' + (qs.length ? qs.length + " questions" : "") + "</span>" +
      "</div>";
    if (errText) {
      html += '<p class="form-status err">' + esc(errText) + "</p></div>";
      wrap.insertAdjacentHTML("beforeend", html);
      return;
    }
    if (!qs.length) {
      html += '<p class="muted">No questions available for this subject yet.</p></div>';
      wrap.insertAdjacentHTML("beforeend", html);
      return;
    }
    html += qs
      .map(function (q, qi) {
        var picked = answers[String(q.id)] || "";
        return (
          '<div class="jw-all-q" style="padding:0.9rem;border:1px solid #e2e8f0;border-radius:12px;margin:0 0 0.6rem;background:#fff" data-qid="' +
          esc(String(q.id)) + '">' +
          '<p style="margin:0 0 0.5rem;font-weight:600">' + (qi + 1) + ". " + esc(q.question || "") + "</p>" +
          (q.options || [])
            .map(function (opt, oi) {
              var label = String.fromCharCode(65 + oi);
              var on = picked === label;
              return (
                '<button type="button" data-jw-answer="' + esc(String(q.id)) + '" data-val="' + label + '" style="display:block;width:100%;text-align:left;padding:0.5rem 0.7rem;margin:0 0 0.35rem;border-radius:10px;border:1px solid ' +
                (on ? "#7c3aed;background:#f3e8ff" : "#e2e8f0;background:#fff") +
                ';font-size:0.92rem;cursor:pointer"><strong>' + label + ".</strong> " + esc(opt) + "</button>"
              );
            })
            .join("") +
          "</div>"
        );
      })
      .join("") +
      "</div>";
    wrap.insertAdjacentHTML("beforeend", html);
  }

  /* Answer taps inside the Junior WAEC all-questions page */
  document.addEventListener("click", function (e) {
    var ansBtn = e.target.closest("[data-jw-answer]");
    if (!ansBtn) return;
    var st = Exam.current;
    if (!st || !st.isPractice) return;
    var qid = ansBtn.getAttribute("data-jw-answer");
    var val = ansBtn.getAttribute("data-val") || "";
    st.answers[qid] = val;
    var qDiv = ansBtn.closest("[data-qid]");
    if (qDiv) {
      qDiv.querySelectorAll("[data-jw-answer]").forEach(function (b) {
        var on = b === ansBtn;
        b.style.border = "1px solid " + (on ? "#7c3aed" : "#e2e8f0");
        b.style.background = on ? "#f3e8ff" : "#fff";
      });
    }
    renderPracticeSectionTabs();
    savePracticeAnswers();
  });

  function wireJwAllSubmit() {
    var wrap = document.getElementById("jwAllWrap");
    if (!wrap) return;
    var old = document.getElementById("jwAllSubmitRow");
    if (old) old.remove();
    var row = document.createElement("div");
    row.id = "jwAllSubmitRow";
    row.style.cssText = "display:flex;gap:0.6rem;align-items:center;flex-wrap:wrap;margin:1rem 0";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-primary";
    btn.textContent = "Submit exam";
    btn.onclick = function () {
      confirmSubmitExam();
    };
    row.appendChild(btn);
    wrap.appendChild(row);
  }

  function setPracticeQuestionView(showQuestions) {
    var chooser = $("examSectionChooser");
    var body = $("examBody");
    if (chooser) chooser.hidden = !!showQuestions;
    if (body) body.hidden = !showQuestions;
  }

  function showPracticeSectionChooser() {
    var st = Exam.current;
    if (!st || !st.isPractice) return;
    st.awaitingSectionPick = true;
    st.questions = [];
    setPracticeQuestionView(false);
    renderPracticeSectionTabs();
    var title = $("examChooserTitle");
    var hint = $("examChooserHint");
    var grid = $("examChooserGrid");
    if (title) title.textContent = (st.examType || "CBT") + " — Choose where to start";
    if (hint) {
      hint.textContent =
        "Subjects stay separate. Pick any section. Progress is saved automatically.";
    }
    if (!grid) return;
    grid.innerHTML = (st.sections || [])
      .map(function (sec, i) {
        var answered = 0;
        (sec.questions || []).forEach(function (q) {
          if (st.answers[String(q.id)]) answered += 1;
        });
        var total = Number(sec.total) || (sec.questions || []).length || 0;
        var done = !!sec.completed || (total > 0 && answered === total && (sec.questions || []).length > 0);
        return (
          '<button type="button" class="exam-section-chooser-btn' +
          (done ? " is-done" : "") +
          '" data-practice-section="' +
          i +
          '"><span>' +
          (done ? "✓ " : "") +
          esc(sec.subject || "Subject " + (i + 1)) +
          '</span><span class="meta">' +
          answered +
          " / " +
          total +
          (done ? " completed" : " answered") +
          "</span></button>"
        );
      })
      .join("");
    if ($("examSub")) {
      $("examSub").textContent =
        (st.examType || "CBT") + " · Choose a subject · Timer from admin settings";
    }
  }

  function enterPracticeSection(nextIndex, skipSave) {
    var st = Exam.current;
    if (!st || !st.isPractice) return;
    var sections = st.sections || [];
    nextIndex = parseInt(nextIndex, 10);
    if (isNaN(nextIndex) || nextIndex < 0 || nextIndex >= sections.length) return;

    function apply() {
      st.awaitingSectionPick = false;
      st.sectionIndex = nextIndex;
      var next = sections[nextIndex];
      st.questions = sectionQuestions(next);
      st.index = 0;
      st.title = (st.examType || "CBT") + " · " + ((next && next.subject) || "Practice");
      if ($("examTitle")) $("examTitle").textContent = st.title;
      setPracticeQuestionView(true);
      updatePracticeExamSub();
      renderPracticeSectionTabs();
      renderExamNav();
      renderExamQuestion();
      savePracticeAnswers();
    }

    function ensureQuestionsThenApply() {
      var next = sections[nextIndex];
      var hasQs = next && next.questions && next.questions.length;
      if (hasQs) {
        apply();
        return;
      }
      if (!st.practiceAttemptId) {
        alert("Could not load this subject. Tap Start again.");
        return;
      }

      // Never replace #examBody HTML — that destroys question/option nodes permanently.
      var loadId = (st._sectionLoadId = (st._sectionLoadId || 0) + 1);
      var subjectName = (next && next.subject) || "subject";
      st.awaitingSectionPick = false;
      st.sectionIndex = nextIndex;
      st.questions = [];
      st.title = (st.examType || "CBT") + " · " + subjectName;
      if ($("examTitle")) $("examTitle").textContent = st.title;
      setPracticeQuestionView(true);
      renderPracticeSectionTabs();
      if ($("examQuestionText")) {
        $("examQuestionText").textContent = "Loading " + subjectName + " questions…";
      }
      if ($("examOptions")) $("examOptions").innerHTML = "";
      if ($("examQCount")) $("examQCount").textContent = "Loading…";
      if ($("examQuestionNav")) $("examQuestionNav").innerHTML = "";
      if ($("examSub")) $("examSub").textContent = "Loading " + subjectName + "…";

      api
        .api(
          "/api/v1/cbt/practice/attempts/" +
            encodeURIComponent(st.practiceAttemptId) +
            "/sections/" +
            nextIndex,
          { timeout: 90000, retries: 1, preferXhr: true }
        )
        .then(function (sec) {
          if (!Exam.current || Exam.current._sectionLoadId !== loadId) return;
          if (!sec || !(sec.questions || []).length) {
            throw new Error(
              "No questions in the bank for " +
                subjectName +
                ". Ask admin to upload/publish JAMB practice questions for this subject."
            );
          }
          sections[nextIndex] = sec;
          st.sections = sections;
          apply();
        })
        .catch(function (err) {
          if (!Exam.current || Exam.current._sectionLoadId !== loadId) return;
          var msg = errMsg(err) || "Could not load subject questions. Try again.";
          if ($("examQuestionText")) $("examQuestionText").textContent = msg;
          if ($("examOptions")) {
            $("examOptions").innerHTML =
              '<button type="button" class="btn btn-primary btn-mini" id="cbtRetrySectionBtn">Try again</button>';
            var retry = $("cbtRetrySectionBtn");
            if (retry) {
              retry.onclick = function () {
                enterPracticeSection(nextIndex, true);
              };
            }
          }
          if ($("examSub")) $("examSub").textContent = "Could not load " + subjectName;
        });
    }

    if (skipSave) ensureQuestionsThenApply();
    else savePracticeAnswers(ensureQuestionsThenApply);
  }

  function renderPracticeSectionTabs() {
    var bar = $("examSectionBar");
    var tabs = $("examSectionTabs");
    var st = Exam.current;
    if (!bar || !tabs) return;
    if (!st || !st.isPractice || !(st.sections && st.sections.length > 1)) {
      bar.hidden = true;
      tabs.innerHTML = "";
      return;
    }
    bar.hidden = false;
    var html = st.sections
      .map(function (sec, i) {
        var answered = 0;
        (sec.questions || []).forEach(function (q) {
          if (st.answers[String(q.id)]) answered += 1;
        });
        var total = Number(sec.total) || (sec.questions || []).length || 0;
        var cls = "exam-section-tab";
        if (!st.awaitingSectionPick && i === st.sectionIndex) cls += " is-active";
        if (sec.completed || (total && answered === total && (sec.questions || []).length)) cls += " is-done";
        return (
          '<button type="button" class="' +
          cls +
          '" data-practice-section="' +
          i +
          '">' +
          esc(sec.subject || "Subject " + (i + 1)) +
          (total ? " (" + answered + "/" + total + ")" : "") +
          "</button>"
        );
      })
      .join("");
    tabs.innerHTML = html;
  }

  function switchPracticeSection(nextIndex) {
    var st = Exam.current;
    // In the Junior WAEC all-questions view the subject tabs scroll to that
    // subject's block instead of switching the single-question view.
    if (st && st._jwAllView) {
      var target = document.querySelector('[data-jw-all-section="' + parseInt(nextIndex, 10) + '"]');
      if (target) {
        try {
          target.scrollIntoView({ behavior: "smooth", block: "start" });
        } catch (eScroll) {
          target.scrollIntoView();
        }
      } else {
        // Sections still loading — nudge and retry shortly
        var wrap = document.getElementById("jwAllWrap");
        if (wrap) {
          var note = document.createElement("p");
          note.className = "muted";
          note.textContent = "Subjects are still loading…";
          wrap.insertBefore(note, wrap.firstChild);
          setTimeout(function () {
            if (note.parentNode) note.parentNode.removeChild(note);
          }, 1500);
        }
      }
      return;
    }
    enterPracticeSection(nextIndex, false);
  }

  function updatePracticeExamSub() {
    var st = Exam.current;
    if (!st || !$("examSub")) return;
    if (st.awaitingSectionPick) {
      $("examSub").textContent =
        (st.examType || "CBT") + " · Choose a subject · Timer from admin settings";
      renderPracticeSectionTabs();
      return;
    }
    var sec = (st.sections && st.sections[st.sectionIndex]) || {};
    $("examSub").textContent =
      (st.examType || "CBT") +
      " · Section " +
      (st.sectionIndex + 1) +
      "/" +
      (st.sections || []).length +
      " · " +
      (sec.subject || "") +
      " · " +
      st.questions.length +
      " questions";
    renderPracticeSectionTabs();
  }

  function savePracticeAnswers(done) {
    var st = Exam.current;
    if (!st || !st.practiceAttemptId) {
      if (done) done();
      return;
    }
    // Keep a local copy for poor networks
    try {
      localStorage.setItem(
        "sia_cbt_attempt_" + st.practiceAttemptId,
        JSON.stringify({
          answers: st.answers,
          section_index: st.sectionIndex,
          saved_at: Date.now(),
        })
      );
    } catch (e) {}
    api
      .api("/api/v1/cbt/practice/attempts/" + st.practiceAttemptId + "/answers", {
        method: "POST",
        body: { answers: st.answers, section_index: st.sectionIndex },
        preferXhr: true,
        retries: 1,
        timeout: 20000,
      })
      .then(function () {
        if (done) done();
      })
      .catch(function () {
        if (done) done();
      });
  }

  function advanceOrSubmitPracticeSection() {
    var st = Exam.current;
    if (!st || !st.isPractice) return;
    var sections = st.sections || [];
    sections[st.sectionIndex].completed = true;
    renderPracticeSectionTabs();

    var remaining = sections.filter(function (sec, i) {
      return i !== st.sectionIndex && !sec.completed;
    }).length;

    if (remaining > 0) {
      var nextIdx = -1;
      for (var i = 0; i < sections.length; i++) {
        if (i !== st.sectionIndex && !sections[i].completed) {
          nextIdx = i;
          break;
        }
      }
      savePracticeAnswers(function () {
        if (nextIdx >= 0) enterPracticeSection(nextIdx, true);
        else confirmSubmitExam();
      });
      return;
    }
    confirmSubmitExam();
  }

  document.addEventListener("click", function (e) {
    var secTab = e.target.closest("[data-practice-section]");
    if (secTab) {
      switchPracticeSection(secTab.getAttribute("data-practice-section"));
      return;
    }
    var typeBtn = e.target.closest("[data-cbt-board]");
    if (typeBtn) {
      openCbtBoard(typeBtn.getAttribute("data-cbt-board"));
      return;
    }
    var subBtn = e.target.closest("[data-cbt-start-subject]");
    if (subBtn) {
      var subject = subBtn.getAttribute("data-cbt-start-subject");
      var board = cbtSelectedBoard || "WAEC";
      ensureBoardUnlockedThen(board, function () {
        startPracticeAttempt(board, [subject], subBtn);
      });
      return;
    }
    /* Junior WAEC: tick the subjects you want (up to 9), then one START */
    var jwChip = e.target.closest("[data-jw-pick]");
    if (jwChip) {
      var s = jwChip.getAttribute("data-jw-pick");
      var i = cbtJwPicked.indexOf(s);
      if (i >= 0) cbtJwPicked.splice(i, 1);
      else if (cbtJwPicked.length < 9) cbtJwPicked.push(s);
      else alert("Maximum 9 subjects.");
      jwChip.style.border = "1px solid " + (cbtJwPicked.indexOf(s) >= 0 ? "#7c3aed" : "#e2e8f0");
      jwChip.style.background = cbtJwPicked.indexOf(s) >= 0 ? "#f3e8ff" : "#fff";
      var count = document.getElementById("cbtJwCount");
      if (count) count.textContent = String(cbtJwPicked.length);
      var go = document.getElementById("cbtJwStart");
      if (go) go.disabled = !cbtJwPicked.length;
      return;
    }
    var chgBtn = e.target.closest("[data-cbt-subject-change]");
    if (chgBtn) {
      openSubjectChangeModal(chgBtn.getAttribute("data-cbt-subject-change"));
      return;
    }
  });

  if ($("cbtBackToTypes")) {
    $("cbtBackToTypes").addEventListener("click", function () {
      loadCbt();
    });
  }

  var cbtActiveBoard = "practice_exams";

  function renderCbtBoard() {
    /* legacy no-op — exam cards replaced by exam-type flow */
  }

  /* =====================================================================
     SCHOOL (Scholaxia Exam)
     ===================================================================== */

  function loadSchoolExams() {
    var wrap = $("schoolExamsList");
    if (!wrap) return;
    wrap.innerHTML = loadingHtml("Loading exams…");
    fetchExamsForMe()
      .then(function (data) {
        var list = (data && data.school_exams) || [];
        if (!list.length) {
          wrap.innerHTML = emptyHtml("⏱", "No school exams loaded yet. Check back after your teacher publishes one.");
          return;
        }
        wrap.innerHTML = list.map(function (exam) { return renderExamCard(exam, { isSchool: true, badge: "SCHOOL" }); }).join("");
      })
      .catch(function (err) {
        wrap.innerHTML = errorHtml(errMsg(err), "school");
      });
  }

  /* =====================================================================
     EXTERNAL SCHOOL EXAM (school-portal)
     ===================================================================== */

  var externalExamsCache = [];

  function loadSchoolPortal() {
    var wrap = $("schoolPortalList");
    var idCard = $("examIdentityCard");
    if (!wrap) return;
    wrap.innerHTML = loadingHtml("Loading exams…");
    api
      .api("/api/v1/external-exams/mine")
      .then(function (data) {
        var st = (data && data.student) || {};
        if (idCard) {
          idCard.style.display = "block";
          idCard.innerHTML =
            "<strong>" + esc(st.full_name || api.getUser().name) + "</strong> · " +
            esc(st.school_name || "") + " · " + esc(st.class_name || "") +
            (st.school_student_id ? " · ID " + esc(st.school_student_id) : "");
        }
        var exams = (data && data.exams) || [];
        if (!exams.length) {
          wrap.innerHTML = emptyHtml("🏫", "No exam is published for your class yet.");
          return;
        }
        wrap.innerHTML = exams.map(function (exam) {
          return (
            '<div class="card"><span class="card-tag">EXAM</span><h4>' + esc(exam.title) + "</h4><p>" +
            esc(exam.subject) + " · " + esc(exam.total_questions || 0) + " questions · " +
            esc(exam.duration_minutes) + " min · " + esc(exam.total_marks) + " marks</p>" +
            '<div class="card-foot"><button type="button" class="btn btn-primary btn-mini" data-open-school-exam="' +
            esc(exam.id) + '">View exam</button></div></div>'
          );
        }).join("");
      })
      .catch(function (err) {
        var msg = errMsg(err);
        if (/not linked|school_id|school has not/i.test(msg + JSON.stringify((err && err.data) || {}))) {
          wrap.innerHTML = emptyHtml(
            "🏫",
            "Your school has not linked this account yet. Ask the school office to add your email, then refresh."
          );
          return;
        }
        wrap.innerHTML = errorHtml(msg, "school-portal");
      });
  }

  /* =====================================================================
     ACCESS CODE
     ===================================================================== */

  function renderAccessCodeCard(c) {
    var code = c.code || c.access_code || "";
    var subject = c.subject || c.topic || c.class_title || "Live class access";
    var unread = c.is_read === false || c.read === false;
    return (
      '<div class="card-list-row" data-code-id="' +
      esc(c.id) +
      '">' +
      "<div><strong>" +
      esc(subject) +
      "</strong><div class=\"card-meta-row\"><span>" +
      esc(code) +
      "</span>" +
      (unread ? '<span class="badge badge-purple">New</span>' : "") +
      (c.created_at ? "<span>" + esc(fmtDate(c.created_at)) + "</span>" : "") +
      "</div></div>" +
      '<div class="btn-row">' +
      '<button type="button" class="btn btn-primary btn-mini" data-join-code="' +
      esc(code) +
      '">Join class</button>' +
      '<button type="button" class="btn btn-secondary btn-mini" data-copy-code="' +
      esc(code) +
      '">Copy</button>' +
      (unread
        ? '<button type="button" class="btn btn-mini" data-mark-read="' + esc(c.id) + '">Mark read</button>'
        : "") +
      "</div></div>"
    );
  }

  /* Live class invitations — ring sound removed (user request); timers kept for stop() cleanup. */
  var liveRingTimer = null;
  var liveRingLimitTimer = null;
  var knownUnreadCodes = {};
  var LIVE_RING_MAX_MS = 20000;
  var LIVE_RING_BURST_MS = 4000;
  var LIVE_RING_SILENCE_MS = 24 * 60 * 60 * 1000;

  function loadSilencedInviteIds() {
    try {
      var raw = localStorage.getItem("sia_silenced_live_invites");
      var parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function rememberSilencedInviteIds(ids) {
    try {
      var map = loadSilencedInviteIds();
      var until = Date.now() + LIVE_RING_SILENCE_MS;
      (ids || []).forEach(function (id) {
        if (id) map[String(id)] = until;
      });
      localStorage.setItem("sia_silenced_live_invites", JSON.stringify(map));
    } catch (e) {}
  }

  function isInviteSilenced(id) {
    if (!id) return false;
    var map = loadSilencedInviteIds();
    var until = Number(map[String(id)] || 0);
    return until > Date.now();
  }

  function stopLiveClassRing() {
    if (liveRingTimer) {
      clearInterval(liveRingTimer);
      liveRingTimer = null;
    }
    if (liveRingLimitTimer) {
      clearTimeout(liveRingLimitTimer);
      liveRingLimitTimer = null;
    }
    var bar = $("liveInviteRingBar");
    if (bar) bar.hidden = true;
  }

  function silenceLiveClassRing() {
    try {
      localStorage.setItem("sia_stop_live_ring", String(Date.now()));
    } catch (e) {}
    stopLiveClassRing();
    // Mark invites read + remember ids so refresh does not restart the tone
    api
      .api("/api/v1/live-classes/access-codes/mine")
      .then(function (data) {
        var items = firstArray(data, ["codes", "items", "results"]);
        var ids = items
          .map(function (c) {
            return String(c.id || c.code || c.access_code || "");
          })
          .filter(Boolean);
        rememberSilencedInviteIds(ids);
        return api.api("/api/v1/live-classes/access-codes/mark-read", {
          method: "POST",
          body: {},
        });
      })
      .catch(function () {});
  }

  function startLiveClassRing() {
    // Ring sound removed — invitations are surfaced on the Access Codes page
    // and via notifications; nothing plays and no ring bar is shown.
  }

  function pollLiveInvitesForRing() {
    var stopped = Number(localStorage.getItem("sia_stop_live_ring") || "0");
    if (stopped && Date.now() - stopped < LIVE_RING_SILENCE_MS) {
      stopLiveClassRing();
      return;
    }
    api
      .api("/api/v1/live-classes/access-codes/mine")
      .then(function (data) {
        var items = firstArray(data, ["codes", "items", "results"]);
        var unread = items.filter(function (c) {
          if (c.is_class_live === false) return false;
          var id = String(c.id || c.code || c.access_code || "");
          if (isInviteSilenced(id)) return false;
          return c.is_read === false || c.read === false;
        });
        var hasNew = false;
        unread.forEach(function (c) {
          var id = String(c.id || c.code || c.access_code || "");
          if (id && !knownUnreadCodes[id]) {
            knownUnreadCodes[id] = true;
            hasNew = true;
          }
        });
        if (unread.length && hasNew) startLiveClassRing();
        else if (!unread.length) stopLiveClassRing();
      })
      .catch(function () {});
  }

  function loadAccessCodes() {
    var wrap = $("accessCodesList");
    if (!wrap) return;
    wrap.innerHTML = loadingHtml("Loading access codes…");
    api
      .api("/api/v1/live-classes/access-codes/mine")
      .then(function (data) {
        var items = firstArray(data, ["codes", "items", "results"]);
        if (!items.length) {
          wrap.innerHTML = emptyHtml("🔑", "No access codes yet.");
          return;
        }
        wrap.innerHTML = items.map(renderAccessCodeCard).join("");
      })
      .catch(function (err) {
        wrap.innerHTML = errorHtml(errMsg(err), "access-code");
      });
  }

  document.addEventListener("click", function (e) {
    var joinCodeBtn = e.target.closest("[data-join-code]");
    if (joinCodeBtn) {
      var joinCode = (joinCodeBtn.dataset.joinCode || "").trim();
      if (!joinCode) return;
      joinCodeBtn.disabled = true;
      joinCodeBtn.textContent = "Joining…";
      stopLiveClassRing();
      api
        .api("/api/v1/live-classes/join-by-code", { method: "POST", body: { code: joinCode } })
        .then(function (res) {
          showLiveJoinResult(res || {});
        })
        .catch(function (err) {
          alert("Could not join with that code: " + errMsg(err));
        })
        .then(function () {
          joinCodeBtn.disabled = false;
          joinCodeBtn.textContent = "Join class";
        });
      return;
    }
    var copyBtn = e.target.closest("[data-copy-code]");
    if (copyBtn) {
      var code = copyBtn.dataset.copyCode;
      if (navigator.clipboard && code) {
        navigator.clipboard.writeText(code).then(function () {
          var prev = copyBtn.textContent;
          copyBtn.textContent = "Copied!";
          setTimeout(function () { copyBtn.textContent = prev; }, 1500);
        });
      }
      return;
    }
    var markBtn = e.target.closest("[data-mark-read]");
    if (markBtn) {
      var id = markBtn.dataset.markRead;
      api
        .api("/api/v1/live-classes/access-codes/mark-read", { method: "POST", body: { id: id, code_id: id } })
        .then(function () { loadAccessCodes(); })
        .catch(function () {});
    }
  });

  if ($("clearOldCodesBtn")) {
    $("clearOldCodesBtn").addEventListener("click", function () {
      if (!confirm("Clear old access codes?")) return;
      api
        .api("/api/v1/live-classes/access-codes/clear", { method: "POST", body: { mode: "old" } })
        .then(function () { loadAccessCodes(); })
        .catch(function (err) { alert(errMsg(err)); });
    });
  }
  if ($("clearAllCodesBtn")) {
    $("clearAllCodesBtn").addEventListener("click", function () {
      if (!confirm("Clear ALL access codes? This cannot be undone.")) return;
      api
        .api("/api/v1/live-classes/access-codes/clear", { method: "POST", body: { mode: "all" } })
        .then(function () { loadAccessCodes(); })
        .catch(function (err) { alert(errMsg(err)); });
    });
  }

  /* =====================================================================
     LIVE CLASS
     ===================================================================== */

  function renderLiveCard(c, isLive) {
    var title = c.title || c.topic || c.subject || "Live class";
    var teacher = c.teacher_name || c.host_name || c.teacher || "Scholaxia teacher";
    var subject = c.subject || c.topic || "";
    var time = c.starts_at || c.scheduled_at || c.start_time;
    var vis = (c.visibility || c.type || "").toLowerCase();
    var isFree =
      c.is_free === true ||
      c.requires_payment === false ||
      vis === "private" ||
      vis === "public" ||
      vis === "school_group";
    return (
      '<article class="live-card' + (isLive ? " is-live" : "") + '">' +
      '<div class="live-card-banner">' +
      '<span class="badge" style="background:rgba(255,255,255,.2);color:#fff">' +
      (isLive ? "● LIVE" : "UPCOMING") +
      "</span>" +
      (vis ? '<span style="opacity:.9;font-size:.75rem;font-weight:700">' + esc(vis) + (isFree ? " · Free" : "") + "</span>" : "") +
      "</div>" +
      '<div class="live-card-body">' +
      "<h4>" + esc(title) + "</h4>" +
      "<p>" + esc(teacher) + (subject ? " · " + esc(subject) : "") + "</p>" +
      (time ? '<div class="card-meta-row"><span>' + esc(fmtDate(time)) + "</span></div>" : "") +
      '<div class="card-foot">' +
      (isLive || isFree
        ? '<button type="button" class="btn btn-primary btn-mini" data-join-live="' + esc(c.id) + '">' +
          (isLive ? "Join now" : "Join free") +
          "</button>"
        : '<button type="button" class="btn btn-secondary btn-mini" data-goto="subscription">Get plan</button>') +
      "</div></div></article>"
    );
  }

  function loadLive() {
    loadAccessCodes();
    var liveWrap = $("liveNowGrid");
    var upWrap = $("liveUpcomingGrid");
    if (liveWrap) liveWrap.innerHTML = loadingHtml("Loading live classes…");
    if (upWrap) upWrap.innerHTML = loadingHtml("Loading upcoming classes…");

    api
      .api("/api/v1/live-classes/?status=live", {
        preferXhr: true,
        awaitWake: false,
        timeout: 30000,
        retries: 2,
      })
      .then(function (data) {
        var items = firstArray(data, ["classes", "items", "results", "live_classes"]);
        if (!liveWrap) return;
        liveWrap.innerHTML = items.length
          ? items.map(function (c) { return renderLiveCard(c, true); }).join("")
          : emptyHtml("📺", "No live classes right now. Your invite codes appear above when a teacher starts a class.");
      })
      .catch(function () {
        if (liveWrap) {
          liveWrap.innerHTML = emptyHtml(
            "📺",
            "No live classes right now. Your invite codes appear above when a teacher starts a class."
          );
        }
      });

    api
      .api("/api/v1/live-classes/?status=upcoming", {
        preferXhr: true,
        awaitWake: false,
        timeout: 30000,
        retries: 2,
      })
      .then(function (data) {
        var items = firstArray(data, ["classes", "items", "results", "live_classes"]);
        if (!upWrap) return;
        upWrap.innerHTML = items.length
          ? items.map(function (c) { return renderLiveCard(c, false); }).join("")
          : emptyHtml("🗓", "No upcoming classes scheduled yet.");
      })
      .catch(function () {
        if (upWrap) upWrap.innerHTML = emptyHtml("🗓", "No upcoming classes scheduled yet.");
      });
  }

  document.addEventListener("click", function (e) {
    var joinBtn = e.target.closest("[data-join-live]");
    if (!joinBtn) return;
    var id = joinBtn.dataset.joinLive;
    if (!id) return;
    var originalLabel = joinBtn.textContent || "Join now";
    joinBtn.disabled = true;
    joinBtn.textContent = "Joining…";
    var joinPromise = Promise.resolve();
    if (api.wakeServer) {
      joinPromise = api.wakeServer(20000).catch(function () { return null; });
    }
    joinPromise
      .then(function () {
        return api.api("/api/v1/live-classes/" + encodeURIComponent(id) + "/join", {
          method: "POST",
          preferXhr: true,
          awaitWake: true,
          timeout: 45000,
          retries: 2,
        });
      })
      .then(function (res) {
        showLiveJoinResult(res || {});
      })
      .catch(function (err) {
        alert("Could not join: " + errMsg(err));
      })
      .then(function () {
        joinBtn.disabled = false;
        joinBtn.textContent = /join/i.test(originalLabel) ? originalLabel : "Join now";
      });
  });

  function enterLiveClassroom(res) {
    var classId = res.class_id || res.classId || res.id || "";
    var roomId = res.room_id || res.channel_id || "";
    var token = res.livekit_token || res.token || "";
    var url = res.livekit_url || "";
    function go(sessRes) {
      var r = sessRes || res || {};
      var rid = r.room_id || r.channel_id || roomId;
      var tok = r.livekit_token || r.token || token;
      var lurl = r.livekit_url || url;
      if (!rid || !tok) {
        alert("Joined, but classroom media was not ready. Ask the teacher to restart the class, then try again.");
        return;
      }
      var user = api.getUser();
      var sess = {
        class_id: classId || r.class_id || "",
        classId: classId || r.class_id || "",
        room_id: rid,
        channel_id: rid,
        livekit_token: tok,
        livekit_url: lurl,
        identity: r.identity || "",
        teacher_id: r.teacher_id || "",
        title: r.title || r.topic || r.subject || "Live Class",
        subject: r.subject || "",
        teacher_name: r.teacher_name || r.host_name || "",
        mic_allowed: r.mic_allowed !== false,
        camera_allowed: r.camera_allowed !== false,
        can_publish: r.can_publish !== false,
        role: "student",
        end_time: r.end_time || null,
        session_status: r.session_status || (r.is_live ? "LIVE" : "LOBBY"),
        is_live: r.is_live !== false,
      };
      writeLocalJson("live_session", sess);
      try {
        localStorage.setItem("sia_stop_live_ring", String(Date.now()));
      } catch (e) {}
      window.location.href = "classroom.html";
    }
    if (roomId && token && url) {
      go(res);
      return;
    }
    // Missing LiveKit URL/token — fetch a fresh one before opening the room.
    if (!classId) {
      go(res);
      return;
    }
    api
      .api("/api/v1/live-classes/" + encodeURIComponent(classId) + "/token")
      .then(function (tokRes) {
        go(Object.assign({}, res || {}, tokRes || {}));
      })
      .catch(function () {
        go(res);
      });
  }

  function showLiveJoinResult(res) {
    writeLocalJson("live_session", res);
    var panel = $("liveJoinResult");
    var title = res.title || res.topic || res.subject || "Live class";
    var code = res.code || res.access_code || "";
    if (panel) {
      panel.style.display = "block";
      panel.innerHTML =
        "<h3>✅ You're in: " +
        esc(title) +
        "</h3>" +
        '<div class="card-meta-row">' +
        (code ? "<span>Code: " + esc(code) + "</span>" : "") +
        (res.host_name || res.teacher_name
          ? "<span>Host: " + esc(res.host_name || res.teacher_name) + "</span>"
          : "") +
        "</div>" +
        '<div class="btn-row">' +
        '<button type="button" class="btn btn-primary" id="openClassroomBtn">Open classroom</button>' +
        "</div>";
      var openBtn = document.getElementById("openClassroomBtn");
      if (openBtn) {
        openBtn.addEventListener("click", function () {
          enterLiveClassroom(res || {});
        });
      }
    }
    // Auto-enter the real LiveKit classroom (two-way A/V)
    enterLiveClassroom(res || {});
  }

  var joinCodeForm = $("joinCodeForm");
  if (joinCodeForm) {
    joinCodeForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var code = $("joinCodeInput").value.trim();
      if (!code) return;
      var btn = joinCodeForm.querySelector("button[type=submit]");
      btn.disabled = true;
      api
        .api("/api/v1/live-classes/join-by-code", { method: "POST", body: { code: code } })
        .then(function (res) {
          showLiveJoinResult(res || {});
          $("joinCodeInput").value = "";
        })
        .catch(function (err) {
          alert("Could not join with that code: " + errMsg(err));
        })
        .then(function () {
          btn.disabled = false;
        });
    });
  }

  var liveRequestForm = $("liveRequestForm");
  if (liveRequestForm) {
    liveRequestForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var subject = $("liveReqSubject").value.trim();
      var topic = $("liveReqTopic").value.trim();
      var description = $("liveReqDesc").value.trim();
      if (!subject || !topic) return;
      var btn = liveRequestForm.querySelector("button[type=submit]");
      btn.disabled = true;
      btn.textContent = "Sending…";
      api
        .api("/api/v1/live-classes/requests", {
          method: "POST",
          body: { subject: subject, topic: topic, description: description },
        })
        .then(function () {
          alert("Request sent! We'll notify you when a class is scheduled.");
          liveRequestForm.reset();
        })
        .catch(function (err) {
          alert("Could not send request: " + errMsg(err));
        })
        .then(function () {
          btn.disabled = false;
          btn.textContent = "Send request";
        });
    });
  }

  /* =====================================================================
     SUBSCRIPTION
     ===================================================================== */

  function planSessionsLabel(p) {
    var sessions = Number(p.sessions || 0);
    var billing = String(p.billing || "");
    var cat = String(p.category || "");
    var isWeekly =
      billing === "holiday" ||
      billing === "monthly" ||
      /holiday|nursery|primary|secondary|exam/i.test(cat);
    if (sessions === 1) return "1 session";
    if (isWeekly && sessions > 1) return sessions + " sessions weekly";
    return sessions + " sessions";
  }

  var PLAN_SUBJECTS_FALLBACK = {
    single_class: ["1 live session", "One-on-one tutor", "Class notes"],
    jamb_prep: ["4 subjects", "4 sessions weekly", "JAMB past questions & CBT drills"],
    jamb_waec_neco_prep: ["6 subjects", "5 sessions weekly", "JAMB, WAEC & NECO practice", "Mock exams"],
    private_lesson: ["4 subjects", "4 sessions weekly", "Dedicated one-on-one tutor", "Unlimited Sia AI Tutor"],
    primary_school: ["3 subjects", "3 sessions weekly", "Mathematics, English & Phonics", "Parent feedback"],
    nursery_school: ["2 subjects", "2 sessions weekly", "Reading & Phonics", "Parent feedback"],
  };

  function planSubjectsHtml(p) {
    var features = Array.isArray(p.features) ? p.features : [];
    var subjects = features.filter(function (f) {
      return f && !/session|tutor|notes|save|questions|and answers/i.test(String(f));
    });
    var planId = String(p.id || p.plan_id || "");
    if (!subjects.length && PLAN_SUBJECTS_FALLBACK[planId]) {
      subjects = PLAN_SUBJECTS_FALLBACK[planId].slice();
    }
    if (!subjects.length && p.max_subjects) {
      subjects = [
        p.max_subjects === "All core subjects" || p.max_subjects >= 99
          ? "All core subjects"
          : "Up to " + p.max_subjects + " subjects",
      ];
    }
    if (!subjects.length) return "";
    return (
      '<ul class="plan-subjects">' +
      subjects
        .map(function (s) {
          return "<li>" + esc(s) + "</li>";
        })
        .join("") +
      "</ul>"
    );
  }

  function loadSubscription() {
    var wrap = $("subscriptionPlans");
    var banner = $("activePlanBanner");
    if (!wrap) return;
    wrap.innerHTML = loadingHtml("Loading plans…");
    api
      .api("/api/v1/payments/paystack/live-class/plans", { timeout: 60000, retries: 3 })
      .catch(function () {
        return api.api("/api/v1/payments/live-class/plans", { timeout: 60000, retries: 2 });
      })
      .then(function (data) {
        data = data || {};
        var plans = firstArray(data, ["plans", "items", "results"]);
        var active = data.active_plan || data.current_plan || null;
        if (banner) {
          if (active) {
            banner.style.display = "flex";
            banner.innerHTML =
              "<div><strong>Active plan: " +
              esc(active.plan_name || active.name || active.title || "Plan") +
              "</strong><div style=\"opacity:.9;font-size:.86rem\">" +
              (active.sessions_left != null ? esc(active.sessions_left) + " sessions left · " : "") +
              (active.expires_at ? "Expires " + esc(fmtDate(active.expires_at)) : "Active subscription") +
              "</div></div>";
          } else {
            banner.style.display = "none";
          }
        }
        if (!plans.length) {
          wrap.innerHTML = emptyHtml("💳", "No subscription plans available right now.");
        } else {
          wrap.innerHTML = plans
            .map(function (p) {
              var id = p.id || p.plan_id;
              var isActive = active && (active.id === id || active.plan_id === id);
              var price = p.price != null ? Number(p.price) : null;
              var mins = p.session_minutes
                ? p.session_minutes >= 60
                  ? p.session_minutes / 60 + " hr each"
                  : p.session_minutes + " min each"
                : "";
              return (
                '<div class="card plan-card' +
                (isActive ? " is-active" : "") +
                '">' +
                '<span class="card-tag">' +
                esc(p.category || p.interval || p.billing || "Live plan") +
                "</span><h4>" +
                esc(p.name || p.title || "Plan") +
                "</h4>" +
                '<p class="plan-sessions"><strong>' +
                esc(planSessionsLabel(p)) +
                "</strong>" +
                (mins ? " · " + esc(mins) : "") +
                "</p>" +
                planSubjectsHtml(p) +
                '<div class="card-foot"><strong>' +
                (price != null ? "₦" + price.toLocaleString("en-NG") : "—") +
                "</strong>" +
                (isActive
                  ? '<span class="badge badge-green">Active</span>'
                  : '<button type="button" class="btn btn-primary btn-mini" data-pay-type="class_package" data-pay-id="' +
                    esc(id) +
                    '">Pay with Paystack</button>') +
                "</div></div>"
              );
            })
            .join("");
        }
        loadCbtPackages();
      })
      .catch(function (err) {
        wrap.innerHTML = errorHtml(errMsg(err), "subscription");
        loadCbtPackages();
      });
  }

  function loadCbtPackages(opts) {
    opts = opts || {};
    var wrap = $(opts.gridId || "cbtPackagesGrid");
    var banner = $(opts.bannerId || "cbtAccessBanner");
    if (!wrap) return;
    wrap.innerHTML = loadingHtml("Loading CBT packages…");
    Promise.all([
      api.api("/api/v1/payments/paystack/cbt-packages").catch(function () { return { packages: [] }; }),
      api.api("/api/v1/payments/paystack/cbt-access").catch(function () { return null; }),
    ]).then(function (pair) {
      var catalog = pair[0] || {};
      var access = pair[1];
      var packages = firstArray(catalog, ["packages", "items"]);
      if (banner) {
        if (access && access.has_access) {
          banner.style.display = "block";
          banner.textContent =
            "You have active CBT access" +
            (access.expires_at ? " until " + String(access.expires_at).slice(0, 10) : "") +
            ". You can download and start practice exams below.";
        } else {
          banner.style.display = "block";
          banner.className = "info-banner warn-banner";
          banner.textContent =
            "No active CBT package yet. When you tap Start exam you can use a coupon or pay with Paystack.";
        }
      }
      if (!packages.length) {
        wrap.innerHTML = emptyHtml("📝", "No CBT packages listed yet.");
        return;
      }
      wrap.innerHTML = packages
        .map(function (p) {
          var id = p.id || p.package_id;
          var price = Number(p.price || p.amount || 0);
          var hasAccess = !!(access && access.has_access);
          return (
            '<div class="card plan-card' +
            (hasAccess ? " is-active" : "") +
            '">' +
            '<span class="card-tag">CBT Package</span><h4>' +
            esc(p.name || p.title || id) +
            "</h4><p>" +
            esc(p.description || "Annual CBT practice access + Tutor AI support") +
            '</p><div class="card-meta-row">' +
            (p.duration_days ? "<span>" + esc(p.duration_days) + " days</span>" : "<span>1 year</span>") +
            '</div><div class="card-foot"><strong>₦' +
            price.toLocaleString("en-NG") +
            "</strong>" +
            (hasAccess
              ? '<span class="badge badge-green">Unlocked</span>'
              : '<button type="button" class="btn btn-primary btn-mini" data-pay-type="cbt_package" data-pay-id="' +
                esc(id) +
                '">Pay with Paystack</button>') +
            "</div></div>"
          );
        })
        .join("");
    });
  }

  if ($("refreshCbtPackagesBtn")) {
    $("refreshCbtPackagesBtn").addEventListener("click", function () {
      loadCbtPackages({
        gridId: "cbtPagePackagesGrid",
        bannerId: "cbtPageAccessBanner",
      });
    });
  }

  async function handlePayClick(btn) {
    var type = btn.dataset.payType;
    var id = btn.dataset.payId;
    if (!type || !id) return;
    if (type === "skill_enrollment") {
      openSkillEnroll(id);
      return;
    }
    if (typeof window.paystackPurchase !== "function") {
      alert("Payment module not loaded. Refresh the page.");
      return;
    }
    var label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Opening Paystack…";
    try {
      var returnPage =
        type === "cbt_package"
          ? "cbt"
          : type === "class_package"
          ? "subscription"
          : type === "library_book"
          ? "library"
          : type === "marketplace_booking"
          ? "marketplace"
          : "subscription";
      // Redirects away — code after this usually won't run
      await window.paystackPurchase({
        productType: type,
        productId: id,
        returnPage: returnPage,
      });
    } catch (err) {
      alert(errMsg(err));
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  document.addEventListener("click", function (e) {
    var payBtn = e.target.closest("[data-pay-type]");
    if (payBtn) handlePayClick(payBtn);
  });

  /* =====================================================================
     SKILLS
     ===================================================================== */

  var SKILLS_PROGRAMS = [
    { id: "web-design", title: "Web Design", fee: 400000, duration: "6 months", description: "HTML, CSS, JavaScript and modern responsive design fundamentals." },
    { id: "mobile-app", title: "Mobile App Development", fee: 300000, duration: "9 months", description: "Build Android & iOS apps with a beginner-friendly cross-platform stack." },
    { id: "graphics", title: "Graphics Design", fee: 70000, duration: "3 months", description: "Logo, flyer, and social media design using industry tools." },
    { id: "cyber-security", title: "Cyber Security", fee: 250000, duration: "6 months", description: "Security fundamentals, ethical hacking basics, and safe practices." },
    { id: "data-analysis", title: "Data Analysis", fee: 100000, duration: "6 months", description: "Excel, SQL, and visualisation for real-world decision making." },
    { id: "gsm-repairs", title: "Computer / GSM Repairs", fee: 150000, duration: "6 months", description: "Hands-on phone & computer hardware diagnosis and repair training." },
  ];

  function formatNaira(n) {
    return "₦" + Number(n || 0).toLocaleString("en-NG");
  }

  function loadSkills() {
    var wrap = $("skillsGrid");
    if (!wrap) return;
    var enrolledIds = [];
    wrap.innerHTML = SKILLS_PROGRAMS.map(function (p) { return renderSkillCard(p, false); }).join("");

    api
      .api("/api/v1/payments/paystack/skills/enrollments")
      .catch(function () {
        return api.api("/api/v1/payments/skills/enrollments").catch(function () {
          return { enrollments: [] };
        });
      })
      .then(function (data) {
        var items = firstArray(data, ["enrollments", "items", "results"]);
        enrolledIds = items.map(function (it) { return it.program_id || it.skill_id || it.slug || it.id; });
        wrap.innerHTML = SKILLS_PROGRAMS
          .map(function (p) { return renderSkillCard(p, enrolledIds.indexOf(p.id) > -1); })
          .join("");
      })
      .catch(function () {
        // Enrollment endpoint optional — keep the static program cards as-is.
      });
  }

  function renderSkillCard(p, enrolled) {
    return (
      '<div class="card">' +
      '<span class="card-tag">' +
      (enrolled ? "✅ Enrolled" : "Skill Program") +
      "</span><h4>" +
      esc(p.title) +
      "</h4>" +
      "<p>" +
      esc(p.description) +
      "</p>" +
      '<div class="card-meta-row"><span>' +
      esc(p.duration) +
      "</span></div>" +
      '<div class="card-foot"><strong>' +
      esc(formatNaira(p.fee)) +
      "</strong>" +
      (enrolled
        ? '<span class="badge badge-green">Active</span>'
        : '<button type="button" class="btn btn-primary btn-mini" data-enroll-skill="' +
          esc(p.id) +
          '">Enroll</button>') +
      "</div></div>"
    );
  }

  function openSkillEnroll(skillId) {
    var skill = SKILLS_PROGRAMS.filter(function (s) { return s.id === skillId; })[0];
    if (!skill || !$("skillEnrollModal")) return;
    $("skillEnrollId").value = skill.id;
    $("skillEnrollTitle").textContent = "Enroll — " + skill.title;
    $("skillEnrollSub").textContent = "Fill your details, then continue to Paystack.";
    $("skillEnrollName").value = user.name || "";
    $("skillEnrollEmail").value = user.email || "";
    $("skillEnrollPhone").value = "";
    $("skillEnrollStart").value = "";
    $("skillEnrollNotes").value = "";
    if ($("skillPayMode")) $("skillPayMode").value = "half";
    updateSkillFeeCopy();
    setStatus($("skillEnrollStatus"), "", true);
    $("skillEnrollModal").classList.add("is-on");
  }

  function updateSkillFeeCopy() {
    var id = $("skillEnrollId") && $("skillEnrollId").value;
    var skill = SKILLS_PROGRAMS.filter(function (s) { return s.id === id; })[0];
    var feeEl = $("skillEnrollFee");
    if (!skill || !feeEl) return;
    var mode = ($("skillPayMode") && $("skillPayMode").value) || "half";
    var half = Math.round(skill.fee / 2);
    feeEl.textContent =
      mode === "once"
        ? "Paying once: " + formatNaira(skill.fee) + " — unlocks enrollment + live classes."
        : "Pay half now (" + formatNaira(half) + "), then balance (" + formatNaira(skill.fee - half) + ") later.";
  }

  document.addEventListener("click", function (e) {
    var enrollBtn = e.target.closest("[data-enroll-skill]");
    if (enrollBtn) openSkillEnroll(enrollBtn.dataset.enrollSkill);
    if (e.target.id === "skillEnrollClose" || e.target === $("skillEnrollModal")) {
      if ($("skillEnrollModal")) $("skillEnrollModal").classList.remove("is-on");
    }
    if (e.target.id === "cbtUnlockClose") {
      closeCbtUnlockModal(true);
      return;
    }
    if (e.target === $("cbtUnlockModal")) {
      closeCbtUnlockModal();
      return;
    }
    // Clicks inside the modal panel must not bubble to overlay close logic elsewhere
    if (e.target.closest && e.target.closest("#cbtUnlockModal .modal")) {
      e.stopPropagation();
    }
    if (e.target.id === "cbtUnlockPickCoupon") {
      $("cbtUnlockChoice").hidden = true;
      $("cbtUnlockCoupon").hidden = false;
      $("cbtUnlockPay").hidden = true;
      if ($("cbtUnlockStatus")) {
        $("cbtUnlockStatus").textContent = "";
        $("cbtUnlockStatus").className = "form-status";
      }
    }
    if (e.target.id === "cbtUnlockPickPay") {
      $("cbtUnlockChoice").hidden = true;
      $("cbtUnlockCoupon").hidden = true;
      $("cbtUnlockPay").hidden = false;
      if ($("cbtUnlockStatus")) {
        $("cbtUnlockStatus").textContent = "";
        $("cbtUnlockStatus").className = "form-status";
      }
      loadCbtUnlockPackages();
    }
    if (e.target.id === "cbtUnlockRedeem") {
      var code = (($("cbtUnlockCode") && $("cbtUnlockCode").value) || "")
        .trim()
        .replace(/\s+/g, "")
        .toUpperCase();
      var statusEl = $("cbtUnlockStatus");
      if (!code) {
        if (statusEl) {
          statusEl.className = "form-status err";
          statusEl.textContent = "Enter your coupon code.";
        }
        return;
      }
      e.target.disabled = true;
      if (statusEl) {
        statusEl.className = "form-status";
        statusEl.textContent = "Checking coupon…";
      }
      api.api("/api/v1/cbt/coupons/redeem", {
        method: "POST",
        body: { code: code },
        timeout: 90000,
        retries: 2,
      })
        .then(function (res) {
          var next = cbtUnlockAfter;
          var boards = (res && res.boards) || [];
          try {
            sessionStorage.setItem("sia_cbt_just_unlocked", String(Date.now()));
            if (res && res.package_id) {
              sessionStorage.setItem("sia_cbt_package_id", String(res.package_id));
            }
            if (boards.length) {
              sessionStorage.setItem("sia_cbt_boards", JSON.stringify(boards));
            }
          } catch (s) {}
          closeCbtUnlockModal(true);
          examsCacheByKind = {};
          examsForMeCache = null;
          if (typeof loadCbtPackages === "function") {
            loadCbtPackages({ gridId: "cbtPackagesGrid", bannerId: "cbtAccessBanner" });
          }
          // Wait briefly so DB commit is visible, then start the exam
          if (typeof next === "function") {
            setTimeout(function () { next(); }, 400);
          } else if (typeof loadCbt === "function") {
            loadCbt();
          }
        })
        .catch(function (err) {
          if (statusEl) {
            statusEl.className = "form-status err";
            statusEl.textContent = errMsg(err) || "Coupon could not be redeemed.";
          }
        })
        .finally(function () { e.target.disabled = false; });
    }
  });
  if ($("skillPayMode")) $("skillPayMode").addEventListener("change", updateSkillFeeCopy);
  if ($("skillEnrollForm")) {
    $("skillEnrollForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var statusEl = $("skillEnrollStatus");
      var btn = $("skillEnrollSubmit");
      var opts = {
        productType: "skill_enrollment",
        productId: $("skillEnrollId").value,
        full_name: $("skillEnrollName").value.trim(),
        phone: $("skillEnrollPhone").value.trim(),
        email: $("skillEnrollEmail").value.trim(),
        preferred_start: $("skillEnrollStart").value.trim(),
        notes: $("skillEnrollNotes").value.trim(),
        payment_mode: ($("skillPayMode") && $("skillPayMode").value) || "half",
        installment: 1,
        returnPage: "skills",
      };
      if (!opts.full_name || !opts.phone || !opts.email) {
        setStatus(statusEl, "Name, phone, and email are required.", false);
        return;
      }
      btn.disabled = true;
      btn.textContent = "Opening Paystack…";
      setStatus(statusEl, "Redirecting to Paystack…", true);
      window.paystackPurchase(opts).catch(function (err) {
        setStatus(statusEl, errMsg(err), false);
        btn.disabled = false;
        btn.textContent = "Continue to Paystack";
      });
    });
  }

  /* =====================================================================
     ASSIGNMENTS
     ===================================================================== */

  function loadAssignments() {
    var annWrap = $("announcementsList");
    var mineWrap = $("assignmentsMineList");
    var teacherSel = $("assignTeacherSelect");
    if (annWrap) annWrap.innerHTML = loadingHtml("Loading announcements…");
    if (mineWrap) mineWrap.innerHTML = loadingHtml("Loading your assignments…");

    api
      .api("/api/v1/community/announcements")
      .then(function (data) {
        var items = firstArray(data, ["items", "results", "announcements"]);
        if (!annWrap) return;
        annWrap.innerHTML = items.length
          ? items
              .map(function (a) {
                return (
                  '<div class="feed-post"><div class="feed-post-head"><div class="feed-avatar">📢</div><div><strong>' +
                  esc(a.title || "Announcement") +
                  "</strong><span> " +
                  esc(fmtDate(a.created_at)) +
                  "</span></div></div><div class=\"feed-post-body\">" +
                  esc(a.content || a.message || "") +
                  "</div></div>"
                );
              })
              .join("")
          : emptyHtml("📢", "No announcements yet.");
      })
      .catch(function (err) {
        if (annWrap) annWrap.innerHTML = errorHtml(errMsg(err), "assignments");
      });

    api
      .api("/api/v1/community/assignments/mine")
      .then(function (data) {
        var items = firstArray(data, ["items", "results", "assignments"]);
        if (!mineWrap) return;
        mineWrap.innerHTML = items.length
          ? items
              .map(function (a) {
                var status = a.status || (a.grade != null ? "graded" : "pending");
                return (
                  '<div class="card-list-row"><div><strong>' +
                  esc(a.caption || a.title || "Submission") +
                  "</strong><div class=\"card-meta-row\"><span>" +
                  esc(fmtDate(a.created_at)) +
                  "</span>" +
                  (a.grade != null ? "<span>Grade: " + esc(a.grade) + "</span>" : "") +
                  "</div></div><span class=\"badge " +
                  (status === "graded" ? "badge-green" : "badge-grey") +
                  "\">" +
                  esc(status) +
                  "</span></div>"
                );
              })
              .join("")
          : emptyHtml("📋", "You haven't submitted any assignments yet.");
      })
      .catch(function (err) {
        if (mineWrap) mineWrap.innerHTML = errorHtml(errMsg(err), "assignments");
      });

    api
      .api("/api/v1/profiles/teachers")
      .then(function (data) {
        var items = firstArray(data, ["items", "results", "teachers"]);
        if (!teacherSel) return;
        teacherSel.innerHTML =
          '<option value="">Select teacher</option>' +
          items
            .map(function (t) {
              return '<option value="' + esc(t.id) + '">' + esc(t.full_name || t.name || "Teacher") + "</option>";
            })
            .join("");
      })
      .catch(function () {});
  }

  var assignmentForm = $("assignmentForm");
  if (assignmentForm) {
    assignmentForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var statusEl = $("assignmentStatus");
      var teacherId = $("assignTeacherSelect").value;
      var file = $("assignFileInput").files[0];
      var caption = $("assignCaption").value.trim();
      if (!teacherId || !file) {
        setStatus(statusEl, "Please choose a teacher and a file.", false);
        return;
      }
      var fd = new FormData();
      fd.append("file", file);
      fd.append("tagged_teacher_id", teacherId);
      fd.append("caption", caption);
      var btn = assignmentForm.querySelector("button[type=submit]");
      btn.disabled = true;
      setStatus(statusEl, "Uploading…", true);
      api
        .apiUpload("/api/v1/community/assignments", fd)
        .then(function () {
          setStatus(statusEl, "Submitted!", true);
          assignmentForm.reset();
          loadedPages.assignments = false;
          loadAssignments();
        })
        .catch(function (err) {
          setStatus(statusEl, errMsg(err), false);
        })
        .then(function () {
          btn.disabled = false;
        });
    });
  }

  /* Marketplace lives on marketplace.html (standalone). */

  /* =====================================================================
     TUTOR AI — SIA
     ===================================================================== */

  var siaHistory = [];
  var siaLevelSelect = $("siaLevelSelect");
  if (siaLevelSelect) {
    var savedLevel = localStorage.getItem("sia_education_level");
    if (savedLevel) {
      var optMatch = Array.prototype.some.call(siaLevelSelect.options, function (o) {
        return o.value.toUpperCase() === String(savedLevel).toUpperCase();
      });
      if (optMatch) siaLevelSelect.value = String(savedLevel).toUpperCase();
    }
    siaLevelSelect.addEventListener("change", function () {
      localStorage.setItem("sia_education_level", siaLevelSelect.value);
    });
    if (!localStorage.getItem("sia_education_level")) {
      localStorage.setItem("sia_education_level", siaLevelSelect.value);
    }
  }

  if ($("communityAv")) {
    $("communityAv").textContent = (user.name || "S").charAt(0).toUpperCase();
  }

  function siaDefaultSubject() {
    var jamb = readLocalJson("sia_jamb_subjects", null) || readLocalJson("sia_subjects", []);
    if (Array.isArray(jamb) && jamb.length) return String(jamb[0]);
    var ssce = readLocalJson("sia_ssce_subjects", null) || [];
    if (Array.isArray(ssce) && ssce.length) return String(ssce[0]);
    return "General";
  }

  function addBubble(text, isMe) {
    var box = $("siaChat");
    if (!box) return;
    var welcome = box.querySelector(".sia-welcome");
    if (welcome) welcome.remove();
    var el = document.createElement("div");
    el.className = "bubble " + (isMe ? "me" : "bot");
    el.textContent = text;
    box.appendChild(el);
    box.scrollTop = box.scrollHeight;
  }

  function askSia(text) {
    if (!text) return;
    var input = $("siaInput");
    if (input) input.value = "";
    addBubble(text, true);
    siaHistory.push({ role: "user", content: text });
    if (siaHistory.length > 12) siaHistory = siaHistory.slice(-12);

    var thinking = document.createElement("div");
    thinking.className = "bubble bot";
    thinking.textContent = "Sia is thinking…";
    $("siaChat").appendChild(thinking);
    $("siaChat").scrollTop = $("siaChat").scrollHeight;

    api
      .api("/api/v1/sia/ask", {
        method: "POST",
        body: {
          question: text,
          subject: siaDefaultSubject(),
          language: "english",
          education_level: (siaLevelSelect && siaLevelSelect.value) || "SS3",
          conversation_history: siaHistory,
          tutor_mode: "smart",
        },
      })
      .then(function (res) {
        var answer =
          (res && (res.sia || res.answer || res.response || res.reply || res.message || res.result)) ||
          "I couldn't find an answer for that just now.";
        thinking.remove();
        addBubble(answer, false);
        siaHistory.push({ role: "assistant", content: answer });
      })
      .catch(function (err) {
        thinking.remove();
        var msg = errMsg(err);
        if (/Field required|validation/i.test(msg)) {
          msg = "Sia could not start that chat. Refresh the page and try again.";
        }
        addBubble("Sorry, I ran into a problem: " + msg, false);
      });
  }

  var siaForm = $("siaForm");
  if (siaForm) {
    siaForm.addEventListener("submit", function (e) {
      e.preventDefault();
      askSia(($("siaInput") && $("siaInput").value.trim()) || "");
    });
  }

  document.addEventListener("click", function (e) {
    var chip = e.target.closest("[data-sia-q]");
    if (chip) askSia(chip.dataset.siaQ);
  });

  if ($("siaClearChat")) {
    $("siaClearChat").addEventListener("click", function () {
      siaHistory = [];
      var box = $("siaChat");
      if (!box) return;
      box.innerHTML =
        '<div class="sia-welcome"><div class="sia-orb sm">S</div><div><strong>Hi, I’m Sia</strong><p>Ask me anything about your subjects. I’ll explain at your level with clear steps.</p></div></div>';
    });
  }

  /* =====================================================================
     COMMUNITY — General / Groups / Announcements
     ===================================================================== */

  var communityTab = "general";
  var communityGeneralChannelId = null;

  function setCommunityTab(tab) {
    communityTab = tab || "general";
    document.querySelectorAll(".comm-tab").forEach(function (b) {
      var on = b.getAttribute("data-comm-tab") === communityTab;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    var g = $("commPanelGeneral");
    var gr = $("commPanelGroups");
    var a = $("commPanelAnnouncements");
    if (g) {
      g.hidden = communityTab !== "general";
      g.classList.toggle("is-on", communityTab === "general");
    }
    if (gr) {
      gr.hidden = communityTab !== "groups";
      gr.classList.toggle("is-on", communityTab === "groups");
    }
    if (a) {
      a.hidden = communityTab !== "announcements";
      a.classList.toggle("is-on", communityTab === "announcements");
    }
    if (communityTab === "general") loadCommunityGeneral();
    else if (communityTab === "groups") loadCommunityGroupsTab();
    else if (communityTab === "announcements") loadCommunityAnnouncementsTab();
  }

  function loadCommunity() {
    setCommunityTab(communityTab || "general");
  }

  function loadCommunityGeneral() {
    var wrap = $("communityFeed");
    if (!wrap) return;
    wrap.innerHTML = loadingHtml("Loading #general…");
    var opts = { preferXhr: false, awaitWake: false, timeout: 30000, retries: 2 };
    var token = api.getToken ? api.getToken() : localStorage.getItem("sia_token");
    if (!token) {
      wrap.innerHTML = errorHtml("You are not logged in.", "community");
      runApiPing({ status: 401 });
      return;
    }
    // Sequential — parallel auth requests fail as "Failed to fetch" on some browsers.
    api
      .api("/api/v1/community/channels", opts)
      .catch(function () { return []; })
      .then(function (channels) {
        channels = Array.isArray(channels) ? channels : [];
        var general = channels.find(function (c) {
          return c.type === "general";
        });
        if (general) communityGeneralChannelId = general.id;
        return api.api("/api/v1/community/feed?limit=50", opts);
      })
      .then(function (data) {
        var items = Array.isArray(data) ? data : firstArray(data, ["items", "results", "posts", "feed"]);
        if (!items.length) {
          wrap.innerHTML = emptyHtml("💬", "No posts in #general yet. Be the first to share something!");
          return;
        }
        wrap.innerHTML = items.map(renderCommunityPost).join("");
      })
      .catch(function (err) {
        wrap.innerHTML = errorHtml(errMsg(err), "community");
        runApiPing(err);
      });
  }

  function loadCommunityAnnouncementsTab() {
    var wrap = $("communityAnnouncements");
    if (!wrap) return;
    wrap.innerHTML = loadingHtml("Loading announcements…");
    var opts = { preferXhr: false, awaitWake: false, timeout: 30000, retries: 2 };
    api
      .api("/api/v1/community/announcements?limit=40", opts)
      .catch(function () {
        // Fallback: resolve announcement channel then list posts
        return api.api("/api/v1/community/channels", opts).then(function (channels) {
          var ann = (channels || []).find(function (c) {
            return c.type === "teacher_announcement" || c.type === "announcement";
          });
          if (!ann) return [];
          return api.api(
            "/api/v1/community/posts?channel_id=" + encodeURIComponent(ann.id) + "&limit=40",
            opts
          );
        });
      })
      .then(function (data) {
        var items = Array.isArray(data) ? data : firstArray(data, ["items", "results", "posts", "announcements"]);
        if (!items.length) {
          wrap.innerHTML = emptyHtml("📢", "No announcements yet. Teachers post updates here.");
          return;
        }
        wrap.innerHTML = items.map(renderCommunityPost).join("");
      })
      .catch(function (err) {
        wrap.innerHTML = errorHtml(errMsg(err), "community");
        runApiPing(err);
      });
  }

  function loadCommunityGroupsTab() {
    var wrap = $("communityTabGroups");
    if (!wrap) return;
    wrap.innerHTML = loadingHtml("Loading groups…");
    var opts = { preferXhr: false, awaitWake: false, timeout: 30000, retries: 2 };
    Promise.all([
      api.api("/api/v1/student-groups/mine", opts).catch(function () { return []; }),
      api.api("/api/v1/student-groups/community-listed", opts).catch(function () {
        return api.api("/api/v1/student-groups/discover", opts).catch(function () { return []; });
      }),
    ]).then(function (pair) {
      var mine = firstArray(pair[0], ["items", "groups", "results"]);
      if (Array.isArray(pair[0])) mine = pair[0];
      var discover = firstArray(pair[1], ["items", "groups", "results"]);
      if (Array.isArray(pair[1])) discover = pair[1];
      var cards = []
        .concat(
          mine.map(function (g) {
            return renderGroupCard(g, true);
          })
        )
        .concat(
          discover.map(function (g) {
            return renderGroupCard(g, false);
          })
        );
      wrap.innerHTML = cards.length
        ? cards.join("")
        : emptyHtml("👥", "No groups yet. Open Groups to create or join one.");
    }).catch(function (err) {
      wrap.innerHTML = errorHtml(errMsg(err), "community");
      runApiPing(err);
    });
  }

  function renderCommunityPost(p) {
    var name = p.author_name || p.full_name || (p.author && p.author.full_name) || "Student";
    var media = "";
    if (p.media_url && p.media_type === "audio") {
      media = '<audio controls src="' + esc(p.media_url) + '" style="width:100%;margin-top:0.5rem"></audio>';
    } else if (p.media_url && /image/i.test(String(p.media_type || ""))) {
      media = '<img src="' + esc(p.media_url) + '" alt="" style="max-width:100%;border-radius:12px;margin-top:0.5rem" />';
    }
    return (
      '<div class="feed-post"><div class="feed-post-head"><div class="feed-avatar">' +
      esc(name.charAt(0).toUpperCase()) +
      "</div><div><strong>" +
      esc(name) +
      "</strong><span> " +
      esc(fmtDate(p.created_at)) +
      "</span></div></div><div class=\"feed-post-body\">" +
      esc(p.content || p.text || "") +
      media +
      "</div></div>"
    );
  }

  var communityTabs = $("communityTabs");
  if (communityTabs) {
    communityTabs.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-comm-tab]");
      if (!btn) return;
      setCommunityTab(btn.getAttribute("data-comm-tab"));
    });
  }

  var communityPostForm = $("communityPostForm");
  if (communityPostForm) {
    communityPostForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var input = $("communityPostInput");
      var content = input.value.trim();
      if (!content) return;
      var btn = communityPostForm.querySelector("button[type=submit]");
      btn.disabled = true;

      function doPost(channelId) {
        var body = { content: content, visibility: "everyone" };
        if (channelId) body.channel_id = channelId;
        return api.api("/api/v1/community/posts", { method: "POST", body: body });
      }

      var ready = communityGeneralChannelId
        ? Promise.resolve(communityGeneralChannelId)
        : api.api("/api/v1/community/channels").then(function (channels) {
            var general = (channels || []).find(function (c) {
              return c.type === "general";
            });
            if (general) communityGeneralChannelId = general.id;
            return communityGeneralChannelId;
          });

      ready
        .then(function (channelId) {
          return doPost(channelId);
        })
        .then(function () {
          input.value = "";
          loadCommunityGeneral();
        })
        .catch(function (err) {
          alert("Could not post: " + errMsg(err));
        })
        .then(function () {
          btn.disabled = false;
        });
    });
  }

  /* =====================================================================
     GROUPS
     ===================================================================== */

  function renderGroupCard(g, mine) {
    var name = g.name || g.title || "Study group";
    var initial = name.charAt(0).toUpperCase();
    var isOwner = !!(mine && (g.is_creator || g.is_owner || g.role === "admin" || g.yours));
    var actions = mine
      ? '<span class="badge badge-green">Joined</span>'
      : '<button type="button" class="btn btn-primary btn-mini" data-join-group="' + esc(g.id) + '">Request to join</button>';
    if (isOwner || mine) {
      actions +=
        ' <button type="button" class="btn btn-secondary btn-mini" data-edit-group="' + esc(g.id) + '" data-group-name="' + esc(name) + '" data-group-desc="' + esc(g.description || "") + '">Edit</button>' +
        ' <button type="button" class="btn btn-danger btn-mini" data-delete-group="' + esc(g.id) + '">Delete</button>';
    }
    return (
      '<article class="group-card">' +
      '<div class="group-avatar">' + esc(initial) + "</div>" +
      "<h4>" + esc(name) + "</h4>" +
      (g.description ? "<p>" + esc(g.description) + "</p>" : "<p>Study group</p>") +
      '<div class="card-meta-row"><span>' +
      esc(g.member_count || (g.members && g.members.length) || 0) +
      " members</span>" +
      (mine ? '<span class="badge badge-purple">Yours</span>' : "") +
      "</div>" +
      '<div class="card-foot">' + actions + "</div></article>"
    );
  }

  async function editMyGroup(id, oldName, oldDesc) {
    var name = prompt("Group name", oldName || "");
    if (name == null) return;
    name = String(name).trim();
    if (name.length < 2) return alert("Name is too short.");
    var description = prompt("Description", oldDesc || "");
    if (description == null) return;
    try {
      await api.api("/api/v1/student-groups/" + encodeURIComponent(id), {
        method: "PATCH",
        body: { name: name, description: String(description).trim() },
      });
      loadGroups();
    } catch (e) {
      alert(e.message || "Could not update group");
    }
  }

  async function deleteMyGroup(id) {
    if (!confirm("Delete this group permanently?")) return;
    try {
      await api.api("/api/v1/student-groups/" + encodeURIComponent(id), { method: "DELETE" });
      loadGroups();
    } catch (e) {
      alert(e.message || "Could not delete group");
    }
  }

  var groupsCache = { mine: [], community: [] };

  function groupMatchesQuery(g, q) {
    if (!q) return true;
    var hay = ((g && (g.name || g.title)) || "") + " " + ((g && g.description) || "");
    return hay.toLowerCase().indexOf(q) >= 0;
  }

  function renderGroupLists() {
    var q = (($("groupSearchInput") && $("groupSearchInput").value) || "").toLowerCase().trim();
    var mineWrap = $("myGroupsList");
    var commWrap = $("communityGroupsList");
    var mine = (groupsCache.mine || []).filter(function (g) { return groupMatchesQuery(g, q); });
    var comm = (groupsCache.community || []).filter(function (g) { return groupMatchesQuery(g, q); });
    if (mineWrap) {
      mineWrap.innerHTML = mine.length
        ? mine.map(function (g) { return renderGroupCard(g, true); }).join("")
        : emptyHtml("👥", q ? "No groups match “" + q + "”." : "No groups yet. Create one to start studying together.");
    }
    if (commWrap) {
      commWrap.innerHTML = comm.length
        ? comm.map(function (g) { return renderGroupCard(g, false); }).join("")
        : emptyHtml("🌐", q ? "No groups match “" + q + "”." : "No community groups listed yet.");
    }
  }

  function loadGroups() {
    var mineWrap = $("myGroupsList");
    var commWrap = $("communityGroupsList");
    if (mineWrap) mineWrap.innerHTML = loadingHtml("Loading your groups…");
    if (commWrap) commWrap.innerHTML = loadingHtml("Loading community groups…");

    var opts = { preferXhr: false, awaitWake: false, timeout: 30000, retries: 2 };
    api
      .api("/api/v1/student-groups/mine", opts)
      .then(function (data) {
        var items = firstArray(data, ["items", "results", "groups"]);
        if (Array.isArray(data)) items = data;
        groupsCache.mine = items || [];
        renderGroupLists();
      })
      .catch(function (err) {
        if (mineWrap) mineWrap.innerHTML = errorHtml(errMsg(err), "groups");
        runApiPing(err);
      });

    api
      .api("/api/v1/student-groups/community-listed", opts)
      .catch(function () {
        return api.api("/api/v1/student-groups/discover", opts);
      })
      .then(function (data) {
        var items = firstArray(data, ["items", "results", "groups"]);
        if (Array.isArray(data)) items = data;
        groupsCache.community = (items || []).filter(function (g) { return !g.is_member; });
        renderGroupLists();
      })
      .catch(function (err) {
        if (commWrap) commWrap.innerHTML = errorHtml(errMsg(err), "groups");
        runApiPing(err);
      });
  }

  document.addEventListener("click", function (e) {
    var editG = e.target.closest("[data-edit-group]");
    if (editG) {
      e.preventDefault();
      editMyGroup(
        editG.getAttribute("data-edit-group"),
        editG.getAttribute("data-group-name"),
        editG.getAttribute("data-group-desc")
      );
      return;
    }
    var delG = e.target.closest("[data-delete-group]");
    if (delG) {
      e.preventDefault();
      deleteMyGroup(delG.getAttribute("data-delete-group"));
      return;
    }
    var joinBtn = e.target.closest("[data-join-group]");
    if (!joinBtn) return;
    var id = joinBtn.dataset.joinGroup;
    joinBtn.disabled = true;
    joinBtn.textContent = "Joining…";
    api
      .api("/api/v1/student-groups/" + id + "/join-request", { method: "POST" })
      .catch(function () {
        return api.api("/api/v1/student-groups/" + id + "/join", { method: "POST" });
      })
      .then(function () {
        joinBtn.textContent = "Requested ✓";
      })
      .catch(function (err) {
        joinBtn.disabled = false;
        joinBtn.textContent = "Join";
        alert("Could not join group: " + errMsg(err));
      });
  });

  if ($("groupSearchInput")) {
    $("groupSearchInput").addEventListener("input", renderGroupLists);
  }

  if ($("showCreateGroupBtn")) {
    $("showCreateGroupBtn").addEventListener("click", function () {
      var form = $("createGroupForm");
      form.style.display = form.style.display === "none" ? "grid" : "none";
    });
  }
  if ($("cancelCreateGroupBtn")) {
    $("cancelCreateGroupBtn").addEventListener("click", function () {
      $("createGroupForm").style.display = "none";
    });
  }

  var createGroupForm = $("createGroupForm");
  if (createGroupForm) {
    createGroupForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = $("groupNameInput").value.trim();
      var description = $("groupDescInput").value.trim();
      if (!name) return;
      var statusEl = $("groupCreateStatus");
      var btn = createGroupForm.querySelector("button[type=submit]");
      btn.disabled = true;
      setStatus(statusEl, "Creating…", true);
      api
        .api("/api/v1/student-groups/", {
          method: "POST",
          body: { name: name, description: description, is_public: true, is_community_listed: true },
        })
        .then(function () {
          setStatus(statusEl, "Group created!", true);
          createGroupForm.reset();
          loadedPages.groups = false;
          loadGroups();
        })
        .catch(function (err) {
          setStatus(statusEl, errMsg(err), false);
        })
        .then(function () {
          btn.disabled = false;
        });
    });
  }

  /* =====================================================================
     SAVED
     ===================================================================== */

  function loadSaved() {
    renderSaved();
  }

  function renderSaved() {
    var wrap = $("savedList");
    if (!wrap) return;
    var items = readLocalJson("sia_saved_lives_web", []);
    if (!Array.isArray(items) || !items.length) {
      wrap.innerHTML = emptyHtml("▶", "No saved items yet. Save a live class from the Live Class page.");
      return;
    }
    wrap.innerHTML = items
      .map(function (it, i) {
        return (
          '<div class="card-list-row"><div><strong>' +
          esc(it.title || "Saved item") +
          "</strong><div class=\"card-meta-row\"><span>" +
          esc(fmtDate(it.savedAt)) +
          "</span></div></div><div class=\"btn-row\">" +
          (it.url
            ? '<button type="button" class="btn btn-primary btn-mini" data-play-saved="' + i + '">Play</button>'
            : '<span class="muted">No recording link</span>') +
          '<button type="button" class="btn btn-danger btn-mini" data-delete-saved="' +
          i +
          '">Delete</button></div></div>'
        );
      })
      .join("");
  }

  document.addEventListener("click", function (e) {
    var playBtn = e.target.closest("[data-play-saved]");
    if (playBtn) {
      var items = readLocalJson("sia_saved_lives_web", []);
      var it = items[parseInt(playBtn.dataset.playSaved, 10)];
      if (it && it.url) window.open(it.url, "_blank");
      return;
    }
    var delBtn = e.target.closest("[data-delete-saved]");
    if (delBtn) {
      var idx = parseInt(delBtn.dataset.deleteSaved, 10);
      var arr = readLocalJson("sia_saved_lives_web", []);
      arr.splice(idx, 1);
      writeLocalJson("sia_saved_lives_web", arr);
      renderSaved();
    }
  });

  /* =====================================================================
     CONTACT (static + client-side success)
     ===================================================================== */

  var contactForm = $("contactForm");
  if (contactForm) {
    contactForm.addEventListener("submit", function (e) {
      e.preventDefault();
      setStatus($("contactStatus"), "Message sent! We'll get back to you shortly.", true);
      contactForm.reset();
    });
  }

  /* =====================================================================
     PROFILE
     ===================================================================== */

  var subjectsCatalog = [];
  var selectedSubjects = [];
  var FALLBACK_SUBJECTS = [
    "Mathematics", "English Language", "Biology", "Chemistry", "Physics",
    "Economics", "Government", "Geography", "Literature in English",
    "Agricultural Science", "Commerce", "Christian Religious Studies",
    "Islamic Religious Studies", "Further Mathematics",
    "Citizenship and Heritage Studies (Civic)", "Physical Education",
    "Office Practice", "Home Management", "Fine Arts", "Animal Husbandry",
    "Book Keeping", "Data Processing",
  ];

  function loadProfile() {
    var examType = localStorage.getItem("sia_exam_type");
    if (examType && $("examTypeSelect")) $("examTypeSelect").value = examType;

    api
      .api("/api/v1/students/me", { preferXhr: true, timeout: 45000, retries: 1 })
      .then(function (me) {
        if (!me) return;
        var name = me.full_name || me.name || user.name;
        $("profileText").textContent = name + " · " + (me.email || user.email) + " · Student";
        if (me.exam_type) {
          localStorage.setItem("sia_exam_type", me.exam_type);
          if ($("examTypeSelect")) $("examTypeSelect").value = me.exam_type;
        }
        if (me.education_level && $("eduLevelSelect")) $("eduLevelSelect").value = me.education_level;
        var loaded =
          (me.exam_type === "JAMB" && Array.isArray(me.jamb_subjects) && me.jamb_subjects.length
            ? me.jamb_subjects
            : null) ||
          (Array.isArray(me.ssce_subjects) && me.ssce_subjects.length ? me.ssce_subjects : null) ||
          (Array.isArray(me.selected_subjects) && me.selected_subjects.length ? me.selected_subjects : null) ||
          (Array.isArray(me.subjects) ? me.subjects : null) ||
          [];
        selectedSubjects = loaded.slice();
        writeLocalJson("sia_subjects", selectedSubjects);
        if (me.exam_type === "JAMB") writeLocalJson("sia_jamb_subjects", selectedSubjects);
        if (me.exam_type === "WAEC" || me.exam_type === "NECO") writeLocalJson("sia_ssce_subjects", selectedSubjects);
        refreshLocalExamBadges();
        renderSubjectChips();
      })
      .catch(function () {
        selectedSubjects = readLocalJson("sia_subjects", []);
        if (!Array.isArray(selectedSubjects)) selectedSubjects = [];
        refreshLocalExamBadges();
        renderSubjectChips();
      });

    api
      .api("/api/v1/students/subjects", { preferXhr: true, timeout: 35000, retries: 1 })
      .then(function (data) {
        subjectsCatalog = firstArray(data, ["subjects", "items", "results"]);
        if (!subjectsCatalog.length && data && typeof data === "object") {
          Object.keys(data).forEach(function (k) {
            if (Array.isArray(data[k])) subjectsCatalog = subjectsCatalog.concat(data[k]);
          });
        }
        renderSubjectChips();
      })
      .catch(function (err) {
        subjectsCatalog = FALLBACK_SUBJECTS.slice();
        var wrap = $("profileSubjectChips");
        if (wrap && !subjectsCatalog.length) {
          wrap.innerHTML = errorHtml(errMsg(err), "profile");
        } else {
          renderSubjectChips();
        }
      });
  }

  function renderSubjectChips() {
    var wrap = $("profileSubjectChips");
    if (!wrap) return;
    if (!subjectsCatalog.length) {
      wrap.innerHTML = emptyHtml("📚", "Subject list unavailable right now.");
      return;
    }
    wrap.innerHTML = subjectsCatalog
      .map(function (s) {
        var name = typeof s === "string" ? s : s.name || s.title || s.subject || "";
        var isSel = selectedSubjects.indexOf(name) > -1;
        return (
          '<button type="button" class="chip' +
          (isSel ? " is-selected" : "") +
          '" data-subject-chip="' +
          esc(name) +
          '">' +
          esc(name) +
          "</button>"
        );
      })
      .join("");
  }

  var subjectChipsWrap = $("profileSubjectChips");
  if (subjectChipsWrap) {
    subjectChipsWrap.addEventListener("click", function (e) {
      var chip = e.target.closest("[data-subject-chip]");
      if (!chip) return;
      var name = chip.dataset.subjectChip;
      var idx = selectedSubjects.indexOf(name);
      if (idx > -1) selectedSubjects.splice(idx, 1);
      else selectedSubjects.push(name);
      renderSubjectChips();
    });
  }

  function buildSetupPayload(examType, selectedSubjects, eduLevel) {
    var body = {
      education_level: eduLevel,
      exam_type: examType,
      subjects: selectedSubjects.slice(),
    };
    if (examType === "JAMB") {
      body.enable_jamb = true;
      body.enable_ssce = false;
      body.jamb_subjects = selectedSubjects.slice();
    } else if (examType === "WAEC" || examType === "NECO") {
      body.enable_jamb = false;
      body.enable_ssce = true;
      body.ssce_exam_type = examType;
      body.ssce_subjects = selectedSubjects.slice();
    }
    return body;
  }

  function saveProfileExamSetup() {
    var statusEl = $("profileSaveStatus");
    var examType = (($("examTypeSelect") && $("examTypeSelect").value) || "").toUpperCase().replace(/-/g, "_");
    var eduLevel = (($("eduLevelSelect") && $("eduLevelSelect").value) || "SS1").toUpperCase();
    if (!selectedSubjects.length) {
      setStatus(statusEl, "Select at least one subject.", false);
      return;
    }
    if (examType === "JAMB" && selectedSubjects.length !== 4) {
      setStatus(statusEl, "JAMB requires exactly 4 subjects (include English Language if you offer it).", false);
      return;
    }
    if ((examType === "WAEC" || examType === "NECO") && selectedSubjects.length !== 9) {
      setStatus(statusEl, examType + " requires exactly 9 subjects.", false);
      return;
    }

    var btn = $("profileSaveBtn");
    btn.disabled = true;
    setStatus(statusEl, "Saving…", true);

    function commitLocalCache() {
      localStorage.setItem("sia_exam_type", examType);
      writeLocalJson("sia_subjects", selectedSubjects.slice());
      if (examType === "JAMB") writeLocalJson("sia_jamb_subjects", selectedSubjects.slice());
      if (examType === "WAEC" || examType === "NECO") writeLocalJson("sia_ssce_subjects", selectedSubjects.slice());
      refreshLocalExamBadges();
      if (cbtHomeCache) {
        cbtHomeCache.profile = cbtHomeCache.profile || {};
        if (examType === "JAMB") cbtHomeCache.profile.jamb_subjects = selectedSubjects.slice();
        else cbtHomeCache.profile.ssce_subjects = selectedSubjects.slice();
      }
    }

    var payload = buildSetupPayload(examType, selectedSubjects, eduLevel);

    function delayMs(ms) {
      return new Promise(function (resolve) {
        setTimeout(resolve, ms);
      });
    }

    function postSetupOnce() {
      return api.api("/api/v1/students/setup-exam", {
        method: "POST",
        body: payload,
        preferXhr: true,
        timeout: 120000,
        retries: 1,
      });
    }

    function saveWithRetries() {
      var attempts = 0;
      function run() {
        attempts += 1;
        return postSetupOnce().catch(function (err) {
          if (attempts >= 6) throw err;
          var retryable =
            !err ||
            !err.status ||
            err.status >= 500 ||
            /failed to fetch|network|timeout|abort/i.test((err && err.message) || "");
          if (!retryable) throw err;
          return delayMs(2000 * attempts).then(run);
        });
      }
      return run();
    }

    var wakeChain = api.wakeServer ? api.wakeServer(90000) : Promise.resolve();
    wakeChain
      .then(function () {
        return delayMs(800).then(saveWithRetries);
      })
      .catch(function () {
        return delayMs(2000).then(saveWithRetries);
      })
      .then(function (res) {
        commitLocalCache();
        setStatus(statusEl, "Saved to your account — syncs on every device you log into.", true);
        if (res && Array.isArray(res.jamb_subjects)) {
          writeLocalJson("sia_jamb_subjects", res.jamb_subjects);
        }
        if (res && Array.isArray(res.ssce_subjects)) {
          writeLocalJson("sia_ssce_subjects", res.ssce_subjects);
        }
      })
      .catch(function (err) {
        commitLocalCache();
        if (!err || !err.status || /failed to fetch|network|timeout|abort/i.test((err && err.message) || "")) {
          setStatus(
            statusEl,
            "Saved on this device. Server sync failed — wait 30 seconds and tap Save again.",
            false
          );
          return;
        }
        if (err.status >= 500) {
          setStatus(statusEl, "Saved on this device. " + errMsg(err), false);
          return;
        }
        setStatus(statusEl, errMsg(err), false);
      })
      .then(function () {
        btn.disabled = false;
      });
  }

  if ($("profileSaveBtn")) {
    $("profileSaveBtn").addEventListener("click", saveProfileExamSetup);
  }


  /* =====================================================================
     Init
     ===================================================================== */

  if (typeof window.resumePendingPaystack === "function") {
    window.resumePendingPaystack().then(function (res) {
      if (!res) return;
      if (res.paid) {
        alert("Payment confirmed. Your access is updated.");
        var page = (res.pending && res.pending.returnPage) || "subscription";
        loadedPages[page] = false;
        showPage(page);
      }
    });
  }

  // Sidebar collapse (desktop) + mobile drawer
  function setSidebarCollapsed(collapsed) {
    var shell = $("appShell");
    var btn = $("sidebarToggle");
    if (!shell) return;
    shell.classList.toggle("sidebar-collapsed", !!collapsed);
    localStorage.setItem("sia_sidebar_collapsed", collapsed ? "1" : "0");
    if (btn) {
      btn.textContent = collapsed ? "›" : "‹";
      btn.setAttribute("aria-label", collapsed ? "Show menu" : "Hide menu");
      btn.title = collapsed ? "Show menu" : "Hide menu";
    }
  }

  function closeMobileNav() {
    document.body.classList.remove("nav-open");
    var bd = $("sidebarBackdrop");
    if (bd) bd.hidden = true;
  }
  function openMobileNav() {
    document.body.classList.add("nav-open");
    // On mobile, opening menu should not stay in collapsed desktop mode
    setSidebarCollapsed(false);
    var bd = $("sidebarBackdrop");
    if (bd) bd.hidden = false;
  }

  if (localStorage.getItem("sia_sidebar_collapsed") === "1") {
    setSidebarCollapsed(true);
  }

  if ($("sidebarToggle")) {
    $("sidebarToggle").addEventListener("click", function () {
      var shell = $("appShell");
      var collapsed = !(shell && shell.classList.contains("sidebar-collapsed"));
      setSidebarCollapsed(collapsed);
      if (!collapsed && window.matchMedia("(max-width: 900px)").matches) openMobileNav();
      if (collapsed) closeMobileNav();
    });
  }
  if ($("sidebarCloseBtn")) {
    $("sidebarCloseBtn").addEventListener("click", function () {
      if (window.matchMedia("(max-width: 900px)").matches) closeMobileNav();
      else setSidebarCollapsed(true);
    });
  }
  if ($("mobileMenuBtn")) {
    $("mobileMenuBtn").addEventListener("click", function () {
      if (document.body.classList.contains("nav-open")) closeMobileNav();
      else openMobileNav();
    });
  }
  if ($("backBtn")) {
    $("backBtn").addEventListener("click", function () {
      goBack();
    });
  }
  if ($("sidebarBackdrop")) {
    $("sidebarBackdrop").addEventListener("click", closeMobileNav);
  }
  // close handler already on side-link above

  pollLiveInvitesForRing();
  setInterval(pollLiveInvitesForRing, 12000);

  // OFFLINE SECURITY: auto-sync queued school-exam submissions when the
  // connection returns (owner PRD — "auto-sync on reconnect" + audit trail).
  if (typeof flushQueuedExternalSubmits === "function") {
    flushQueuedExternalSubmits();
    window.addEventListener("online", function () { flushQueuedExternalSubmits(); });
  }

  // Wake Render before first dashboard load so Exam / Live / CBT screens do not flash network errors
  if (api.wakeServer) {
    api
      .wakeServer(60000)
      .catch(function () { return null; })
      .finally(function () {
        loadHome();
      });
  } else {
    loadHome();
  }
})();
