/* Scholaxia Teacher website — full desktop/app feature set */
(function () {
  var api = window.ScholaxiaAPI;
  if (!api || typeof api.requireAuth !== "function") {
    try {
      var el = document.querySelector(".teacher-content") || document.body;
      el.insertAdjacentHTML(
        "afterbegin",
        '<div class="empty" style="margin:1rem">Teacher app failed to load. Hard refresh this page.</div>'
      );
    } catch (e0) {}
    return;
  }
  if (!api.requireAuth(["teacher", "admin"])) return;

  var TITLES = {
    live: "Live Classes",
    materials: "Materials",
    exams: "Exams",
    students: "Students",
    grading: "Grading",
    community: "Community",
    ai: "Teacher AI",
    profile: "Profile",
  };

  var pageHistory = ["live"];
  var currentPage = "live";
  var hostBusy = false;
  var gradeSubmissionId = null;
  var announceChannelId = null;
  var shell = document.getElementById("teacherShell");

  function $(id) {
    return document.getElementById(id);
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatDT(iso) {
    if (!iso) return "—";
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return String(iso);
      return d.toLocaleString();
    } catch (e) {
      return String(iso);
    }
  }

  function subjects() {
    try {
      var list = JSON.parse(localStorage.getItem("sia_teacher_subjects") || "[]");
      if (Array.isArray(list) && list.length) return list;
    } catch (e) {}
    return ["Mathematics", "Physics", "Chemistry", "English"];
  }

  async function uploadFile(file) {
    var fd = new FormData();
    fd.append("file", file);
    return api.apiUpload("/api/v1/community/upload", fd);
  }

  function closeMobileNav() {
    document.body.classList.remove("nav-open");
    var bd = $("sidebarBackdrop");
    if (bd) {
      bd.hidden = true;
      bd.setAttribute("hidden", "");
      bd.style.pointerEvents = "none";
    }
  }

  function openMobileNav() {
    document.body.classList.add("nav-open");
    var bd = $("sidebarBackdrop");
    if (bd) {
      bd.hidden = false;
      bd.removeAttribute("hidden");
      bd.style.pointerEvents = "auto";
    }
  }

  function updateBackBtn() {
    var btn = $("backBtn");
    if (!btn) return;
    btn.hidden = !(pageHistory.length > 1 || currentPage !== "live");
  }

  function showPage(id, opts) {
    id = String(id || "").trim();
    if (!TITLES[id]) return;
    opts = opts || {};
    if (!opts.replace && currentPage !== id) {
      pageHistory.push(id);
      if (pageHistory.length > 24) pageHistory.shift();
    }
    currentPage = id;
    document.querySelectorAll(".page").forEach(function (p) {
      p.classList.toggle("is-on", p.id === "page-" + id);
    });
    document.querySelectorAll(".nav-btn").forEach(function (b) {
      b.classList.toggle("is-active", b.getAttribute("data-page") === id);
    });
    if ($("pageTitle")) $("pageTitle").textContent = TITLES[id];
    updateBackBtn();
    closeMobileNav();

    try {
      if (id === "live") {
        setDefaultSchedule();
        loadLive();
        loadStudentPickers();
        loadSchoolGroups();
      } else if (id === "materials") loadMaterials();
      else if (id === "exams") loadExams();
      else if (id === "students") loadStudents();
      else if (id === "grading") loadGrading();
      else if (id === "community") loadCommunity();
      else if (id === "ai") initAI();
      else if (id === "profile") loadProfile();
    } catch (err) {
      console.error(err);
    }
  }

  window.teacherShowPage = showPage;

  function goBack() {
    if (pageHistory.length > 1) {
      pageHistory.pop();
      showPage(pageHistory[pageHistory.length - 1] || "live", { replace: true });
      return;
    }
    if (currentPage !== "live") showPage("live", { replace: true });
  }

  function setUserChip(name, email) {
    var first = (name || "Teacher").split(" ")[0];
    var letter = first.charAt(0).toUpperCase() || "T";
    if ($("userName")) $("userName").textContent = first;
    if ($("userAv")) $("userAv").textContent = letter;
    if ($("userEmail")) $("userEmail").textContent = email || "";
    if ($("profileName")) $("profileName").textContent = name || first;
    if ($("profileAv")) $("profileAv").textContent = letter;
  }

  function setDefaultSchedule() {
    var d = new Date();
    var pad = function (n) {
      return String(n).padStart(2, "0");
    };
    if ($("hostDate") && !$("hostDate").value) {
      $("hostDate").value = d.toISOString().slice(0, 10);
    }
    if ($("hostStart") && !$("hostStart").value) {
      $("hostStart").value = pad(d.getHours()) + ":" + pad(d.getMinutes());
    }
    if ($("hostEnd") && !$("hostEnd").value) {
      var end = new Date(d.getTime() + 60 * 60 * 1000);
      $("hostEnd").value = pad(end.getHours()) + ":" + pad(end.getMinutes());
    }
  }

  function onVisibilityChange() {
    var vis = (document.querySelector('input[name="host-visibility"]:checked') || {}).value || "public";
    var priv = $("hostPrivateWrap");
    var school = $("hostSchoolWrap");
    if (priv) {
      if (vis === "private") {
        priv.hidden = false;
        priv.removeAttribute("hidden");
        priv.style.display = "grid";
      } else {
        priv.hidden = true;
        priv.setAttribute("hidden", "");
        priv.style.display = "none";
      }
    }
    if (school) {
      if (vis === "school_group") {
        school.hidden = false;
        school.removeAttribute("hidden");
        school.style.display = "grid";
      } else {
        school.hidden = true;
        school.setAttribute("hidden", "");
        school.style.display = "none";
      }
    }
  }

  function getHostPayload(goLiveNow) {
    var title = (($("hostTitle") && $("hostTitle").value) || "").trim();
    var subject = (($("hostSubject") && $("hostSubject").value) || "").trim();
    var date = ($("hostDate") && $("hostDate").value) || "";
    var startTime = ($("hostStart") && $("hostStart").value) || "";
    var endTime = ($("hostEnd") && $("hostEnd").value) || "";
    var duration = parseInt(($("hostDuration") && $("hostDuration").value) || "60", 10) || 60;
    if (!title || !subject) throw new Error("Title and subject are required.");

    var vis = (document.querySelector('input[name="host-visibility"]:checked') || {}).value || "public";
    var body = {
      title: title,
      subject: subject,
      duration_minutes: duration,
      go_live_now: !!goLiveNow,
      visibility: vis,
    };

    if (vis === "private") {
      // Direct email invites (kids join from their list — parents get an email).
      var rawEmails = (($("hostInviteEmails") && $("hostInviteEmails").value) || "");
      var emails = rawEmails.split(",").map(function (s) { return s.trim(); }).filter(function (s) { return s.indexOf("@") > 0; });
      if (emails.length) body.invited_student_emails = emails;
    }
    if (vis === "school_group") {
      var gid = ($("hostSchoolGroup") && $("hostSchoolGroup").value) || "";
      if (!gid) throw new Error("Select a school group.");
      body.school_group_id = gid;
    }

    function parseDT(dateStr, timeStr) {
      if (!dateStr || !timeStr) return null;
      var d = new Date(dateStr + "T" + timeStr);
      return isNaN(d.getTime()) ? null : d;
    }

    if (!goLiveNow) {
      if (!date || !startTime) throw new Error("Pick a date and start time to schedule.");
      var startDt = parseDT(date, startTime);
      if (!startDt) throw new Error("Invalid date or start time.");
      body.start_time = startDt.toISOString();
      if (endTime) {
        var endDt = parseDT(date, endTime);
        if (!endDt) throw new Error("Invalid end time.");
        if (endDt <= startDt) throw new Error("End time must be after start time.");
        body.end_time = endDt.toISOString();
      }
    } else if (endTime && date) {
      var liveEnd = parseDT(date, endTime);
      if (liveEnd && liveEnd > new Date()) body.end_time = liveEnd.toISOString();
    }
    return body;
  }

  var pendingHostClass = null;

  function copyText(text) {
    text = String(text || "");
    if (!text) return Promise.reject(new Error("No code"));
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        resolve();
      } catch (e) {
        reject(e);
      }
      document.body.removeChild(ta);
    });
  }

  function showHostAccessCode(created, body, goLiveNow) {
    var box = $("hostCodeShare");
    var value = $("hostCodeValue");
    var title = $("hostCodeTitle");
    var hint = $("hostCodeHint");
    var openWrap = $("hostCodeOpenWrap");
    var code = created && created.join_code;
    if (!code || !box || !value) {
      if (goLiveNow && created && created.id) {
        if (confirm("Class is live!\n\nOpen classroom now?")) {
          enterClassroom(created.id, body.title, body.subject, created.end_time, true);
        }
      } else {
        alert("Class scheduled successfully.");
      }
      return;
    }
    pendingHostClass = {
      id: created.id,
      title: body.title,
      subject: body.subject,
      end: created.end_time,
    };
    value.textContent = code;
    if (title) title.textContent = goLiveNow ? "Class is live — share this code" : "Class scheduled — share this code";
    if (hint) hint.textContent = "Copy or share this access code so students can join.";
    if (openWrap) openWrap.hidden = !goLiveNow;
    box.hidden = false;
    try {
      box.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (e) {}
  }

  async function hostClass(goLiveNow) {
    if (hostBusy) return;
    hostBusy = true;
    var err = $("hostError");
    if (err) {
      err.textContent = "";
      err.className = "form-status";
    }
    var scheduleBtn = $("hostScheduleBtn");
    var liveBtn = $("hostLiveBtn");
    if (scheduleBtn) {
      scheduleBtn.disabled = true;
      if (!goLiveNow) scheduleBtn.textContent = "Scheduling…";
    }
    if (liveBtn) {
      liveBtn.disabled = true;
      if (goLiveNow) liveBtn.textContent = "Going live…";
    }
    try {
      var body = getHostPayload(goLiveNow);
      var created = await api.api("/api/v1/live-classes/", { method: "POST", body: body });
      if ($("hostTitle")) $("hostTitle").value = "";
      await loadLive();
      showHostAccessCode(created, body, goLiveNow);
    } catch (e) {
      if (err) {
        err.textContent = e.message || "Could not host class.";
        err.className = "form-status err";
      }
    } finally {
      hostBusy = false;
      if (scheduleBtn) {
        scheduleBtn.disabled = false;
        scheduleBtn.textContent = "Schedule class";
      }
      if (liveBtn) {
        liveBtn.disabled = false;
        liveBtn.textContent = "Go live now";
      }
    }
  }

  async function startClass(id) {
    try {
      await api.api("/api/v1/live-classes/" + encodeURIComponent(id) + "/start", { method: "POST" });
      alert("Class started — students notified.");
      loadLive();
    } catch (e) {
      alert(e.message || "Could not start class.");
    }
  }

async function endClass(id) {
    if (!id) return;
    if (!confirm("End this class for everyone?")) return;
    var cardBtn = document.querySelector('[data-end-class="' + id + '"]');
    var card = cardBtn && cardBtn.closest ? cardBtn.closest(".item-card") : null;
    function flipCardEnded() {
      if (!card) return;
      card.classList.remove("is-live");
      card.setAttribute("data-ended", "1");
      var badge = card.querySelector(".badge.live");
      if (badge) {
        badge.className = "badge muted";
        badge.textContent = "Ended";
      }
      var actions = card.querySelector(".actions");
      if (actions) {
        actions.innerHTML =
          '<button type="button" class="btn-sm" data-start="' +
          esc(id) +
          '">Start</button>';
      }
    }
    flipCardEnded();
    if ($("statLive")) {
      var n = parseInt($("statLive").textContent || "0", 10) || 0;
      $("statLive").textContent = String(Math.max(0, n - 1));
    }
    try {
      var res = await api.api("/api/v1/live-classes/" + encodeURIComponent(id) + "/end", {
        method: "POST",
        preferXhr: true,
        timeout: 90000,
        retries: 3,
        awaitWake: true,
      });
      if (res && res.is_live === true) {
        res = await api.api("/api/v1/live-classes/" + encodeURIComponent(id) + "/end", {
          method: "POST",
          preferXhr: true,
          timeout: 90000,
          retries: 2,
          awaitWake: true,
        });
      }
      if (res && res.is_live === true) {
        throw new Error("Server did not end the class. Tap End again or refresh.");
      }
      alert("Class ended.");
      await loadLive();
      var still = document.querySelector('[data-end-class="' + id + '"]');
      if (still) {
        flipCardEnded();
        try {
          await api.api("/api/v1/live-classes/" + encodeURIComponent(id) + "/end", {
            method: "POST",
            preferXhr: true,
            timeout: 90000,
            retries: 1,
          });
          await loadLive();
        } catch (e3) { /* ignore */ }
      }
    } catch (e) {
      alert(e.message || "Could not end class.");
      try {
        await loadLive();
      } catch (e2) { /* ignore */ }
    }
  }

  async function enterClassroom(classId, title, subject, endTime, alreadyLive) {
    try {
      if (!alreadyLive) {
        await api.api("/api/v1/live-classes/" + encodeURIComponent(classId) + "/start", {
          method: "POST",
        });
      }
      var token = await api.api("/api/v1/live-classes/" + encodeURIComponent(classId) + "/token");
      if (!token) throw new Error("Could not get classroom token.");
      var user = api.getUser();
      // plugNmeet room ready: open it in a NEW tab so this dashboard tab
      // stays put — the class keyboard button is one click away, and when
      // the meeting ends plugNmeet redirects that tab to teacher.html.
      if (token.pnm_join_url) {
        var roomWin = null;
        try {
          roomWin = window.open(token.pnm_join_url, "_blank", "noopener");
        } catch (eOpen) { roomWin = null; }
        if (!roomWin) window.location.href = token.pnm_join_url;
        return;
      }
      localStorage.setItem(
        "live_session",
        JSON.stringify({
          class_id: classId,
          classId: classId,
          room_id: token.room_id || token.channel_id,
          channel_id: token.channel_id || token.room_id,
          livekit_token: token.livekit_token || token.token,
          livekit_url: token.livekit_url,
          identity: token.identity,
          teacher_id: token.teacher_id || token.identity,
          can_publish: token.can_publish !== false,
          title: title || "Live Class",
          subject: subject || "",
          teacher_name: user.name,
          role: "teacher",
          end_time: endTime || token.end_time || null,
          already_live: !!alreadyLive,
          session_status: "LIVE",
          is_live: true,
        })
      );
      window.location.href = "classroom.html";
    } catch (e) {
      alert(e.message || "Could not enter classroom.");
    }
  }

  function classLooksLive(c) {
    if (!c) return false;
    if (c.status === "ended" || c.status === "past") return false;
    if (!c.is_live) return false;
    if (c.end_time) {
      try {
        var raw = String(c.end_time).trim();
        // Treat naive timestamps from API as UTC
        if (raw && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)) raw += "Z";
        var endMs = new Date(raw).getTime();
        if (!isNaN(endMs) && endMs <= Date.now()) return false;
      } catch (e) { /* ignore */ }
    }
    if (c.start_time) {
      try {
        var sraw = String(c.start_time).trim();
        if (sraw && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(sraw)) sraw += "Z";
        var startMs = new Date(sraw).getTime();
        // Match server heal: sessions older than 4h are not "live now"
        if (!isNaN(startMs) && Date.now() - startMs > 4 * 60 * 60 * 1000) return false;
      } catch (e2) { /* ignore */ }
    }
    return true;
  }

  async function loadLive() {
    var el = $("liveList");
    if (!el) return;
    var reqId = (loadLive._reqId = (loadLive._reqId || 0) + 1);
    el.innerHTML = '<div class="loading">Loading classes…</div>';
    var timedOut = false;
    var watchdog = setTimeout(function () {
      if (loadLive._reqId !== reqId) return;
      timedOut = true;
      el.innerHTML =
        '<div class="empty">Still loading… <button type="button" class="btn-sm" id="liveRetryBtn">Retry</button></div>';
      var btn = $("liveRetryBtn");
      if (btn) btn.onclick = function () { loadLive(); };
    }, 12000);
    try {
      var status = ($("liveFilter") && $("liveFilter").value) || "";
      var url = "/api/v1/live-classes/?limit=50";
      if (status) url += "&status=" + encodeURIComponent(status);
      var rows = await api.api(url, { timeout: 20000, retries: 1, awaitWake: false });
      if (loadLive._reqId !== reqId) return;
      clearTimeout(watchdog);
      if (!Array.isArray(rows)) rows = (rows && (rows.items || rows.classes)) || [];
      if (!Array.isArray(rows)) rows = [];
      var liveN = rows.filter(classLooksLive).length;
      var upN = rows.filter(function (c) {
        return !classLooksLive(c) && c.status !== "ended" && c.status !== "past";
      }).length;
      if ($("statLive")) $("statLive").textContent = String(liveN);
      if ($("statUpcoming")) $("statUpcoming").textContent = String(upN);
      if (!rows.length) {
        el.innerHTML = '<div class="empty">No classes yet. Schedule or go live above.</div>';
        return;
      }
      el.innerHTML = rows
        .map(function (c) {
          var live = classLooksLive(c);
          var ended = !live && (c.status === "past" || c.status === "ended" || !!c.end_time);
          var actions = live
            ? '<button type="button" class="btn-sm" data-enter="' +
              esc(c.id) +
              '" data-title="' +
              esc(c.title) +
              '" data-subject="' +
              esc(c.subject || "") +
              '" data-end="' +
              esc(c.end_time || "") +
              '" data-live="1">Enter</button>' +
              '<button type="button" class="btn-danger" data-end-class="' +
              esc(c.id) +
              '">End</button>'
            : '<button type="button" class="btn-sm" data-start="' +
              esc(c.id) +
              '">Start</button>' +
              '<button type="button" class="btn-sm" data-enter="' +
              esc(c.id) +
              '" data-title="' +
              esc(c.title) +
              '" data-subject="' +
              esc(c.subject || "") +
              '" data-end="' +
              esc(c.end_time || "") +
              '">Enter</button>';
          return (
            '<article class="item-card' +
            (live ? " is-live" : "") +
            '" data-class-id="' +
            esc(c.id) +
            '">' +
            (live
              ? '<span class="badge live">LIVE</span>'
              : ended
                ? '<span class="badge muted">Ended</span>'
                : '<span class="badge muted">Scheduled</span>') +
            "<h4>" +
            esc(c.title || "Live class") +
            "</h4>" +
            '<p class="meta">' +
            esc(c.subject || "") +
            " · " +
            esc(c.visibility || "public") +
            (c.join_code ? ' · <code class="join-code">' + esc(c.join_code) + "</code>" : "") +
            "</p>" +
            '<p class="meta">' +
            formatDT(c.start_time) +
            "</p>" +
            '<div class="actions">' +
            actions +
            (c.join_code
              ? '<button type="button" class="btn-sm" data-copy-code="' +
                esc(c.join_code) +
                '">Copy code</button>' +
                '<button type="button" class="btn-sm" data-share-code="' +
                esc(c.join_code) +
                '" data-share-title="' +
                esc(c.title || "Live class") +
                '">Share code</button>'
              : "") +
            "</div></article>"
          );
        })
        .join("");
    } catch (e) {
      if (loadLive._reqId !== reqId) return;
      clearTimeout(watchdog);
      if (timedOut) return;
      el.innerHTML =
        '<div class="empty">' +
        esc(e.message || "Could not load classes") +
        ' <button type="button" class="btn-sm" id="liveRetryBtn">Retry</button></div>';
      var btn2 = $("liveRetryBtn");
      if (btn2) btn2.onclick = function () { loadLive(); };
    } finally {
      clearTimeout(watchdog);
    }
  }

  async function loadStudentPickers() {
    try {
      var rows = await api.api("/api/v1/live-classes/requests?status=approved").catch(function () {
        return [];
      });
      if (!Array.isArray(rows) || !rows.length) {
        rows = await api.api("/api/v1/live-classes/requests").catch(function () {
          return [];
        });
      }
      if (!Array.isArray(rows)) rows = [];
      var opts = rows
        .map(function (r) {
          var id = r.student_id || r.user_id || r.id;
          if (!id) return "";
          return (
            '<option value="' +
            esc(String(id)) +
            '">' +
            esc(r.student_name || r.name || "Student") +
            " — " +
            esc(r.subject || "") +
            "</option>"
          );
        })
        .filter(Boolean)
        .join("");
      if ($("hostInvitedStudents")) {
        $("hostInvitedStudents").innerHTML = opts || '<option value="" disabled>No assigned students</option>';
      }
      if ($("sgStudents")) {
        $("sgStudents").innerHTML = opts || '<option value="" disabled>No assigned students</option>';
      }
    } catch (e) {
      /* optional */
    }
  }

  async function loadSchoolGroups() {
    try {
      var groups = await api.api("/api/v1/school-groups/mine");
      if (!Array.isArray(groups)) groups = groups.items || [];
      var sel = $("hostSchoolGroup");
      if (sel) {
        sel.innerHTML =
          '<option value="">Select group</option>' +
          groups
            .map(function (g) {
              return (
                '<option value="' +
                esc(g.id) +
                '">' +
                esc(g.name || g.group_name || "Group") +
                (g.school_name ? " · " + esc(g.school_name) : "") +
                "</option>"
              );
            })
            .join("");
      }
      var list = $("schoolGroupsList");
      if (list) {
        list.innerHTML = groups.length
          ? groups
              .map(function (g) {
                return (
                  '<div class="item-card"><h4>' +
                  esc(g.name || g.group_name || "Group") +
                  '</h4><p class="meta">' +
                  esc(g.school_name || "") +
                  " · " +
                  esc(String((g.student_ids || g.members || []).length)) +
                  " students</p></div>"
                );
              })
              .join("")
          : '<div class="empty">No school groups yet.</div>';
      }
    } catch (e) {
      if ($("hostSchoolGroup")) $("hostSchoolGroup").innerHTML = '<option value="">No groups</option>';
      if ($("schoolGroupsList")) {
        $("schoolGroupsList").innerHTML = '<div class="empty">' + esc(e.message || "Could not load groups") + "</div>";
      }
    }
  }

  async function createSchoolGroup() {
    var school = (($("sgSchool") && $("sgSchool").value) || "").trim();
    var name = (($("sgName") && $("sgName").value) || "").trim();
    var sel = $("sgStudents");
    var ids = sel
      ? Array.prototype.slice.call(sel.selectedOptions).map(function (o) {
          return o.value;
        })
      : [];
    if (!school || !name) {
      alert("Enter school name and group name.");
      return;
    }
    try {
      await api.api("/api/v1/school-groups/", {
        method: "POST",
        body: { school_name: school, name: name, student_ids: ids },
      });
      if ($("sgSchool")) $("sgSchool").value = "";
      if ($("sgName")) $("sgName").value = "";
      loadSchoolGroups();
      alert("School group created.");
    } catch (e) {
      alert(e.message || "Could not create group.");
    }
  }

  /* Materials */
  function populateSubjectFilters() {
    var subs = subjects();
    var filter = $("matSubjectFilter");
    if (filter) {
      var cur = filter.value;
      filter.innerHTML =
        '<option value="">All subjects</option>' +
        subs
          .map(function (s) {
            return '<option value="' + esc(s) + '">' + esc(s) + "</option>";
          })
          .join("");
      if (cur) filter.value = cur;
    }
    ["matSubjectList", "texamSubjectList", "aiSubjectList"].forEach(function (id) {
      var dl = $(id);
      if (dl) {
        dl.innerHTML = subs
          .map(function (s) {
            return '<option value="' + esc(s) + '">';
          })
          .join("");
      }
    });
  }

  function toggleMatInputs() {
    var type = ($("matType") && $("matType").value) || "pdf";
    var isLink = type === "link" || type === "video";
    if ($("matFileWrap")) $("matFileWrap").hidden = isLink;
    if ($("matLinkWrap")) $("matLinkWrap").hidden = !isLink;
    var paid = ($("matAccess") && $("matAccess").value) === "paid";
    if ($("matPriceWrap")) $("matPriceWrap").hidden = !paid;
  }

  async function loadMaterials() {
    populateSubjectFilters();
    var el = $("materialsList");
    if (!el) return;
    el.innerHTML = '<div class="loading">Loading materials…</div>';
    try {
      var mine = await api.api("/api/v1/materials/mine").catch(function () {
        return [];
      });
      if (!Array.isArray(mine)) mine = mine.items || mine.materials || [];
      var books = await api.api("/api/v1/library/teacher").catch(function () {
        return [];
      });
      if (!Array.isArray(books)) books = books.books || books.items || [];

      var subjectF = ($("matSubjectFilter") && $("matSubjectFilter").value) || "";
      var typeF = ($("matTypeFilter") && $("matTypeFilter").value) || "";
      var filtered = mine.filter(function (m) {
        if (subjectF && String(m.subject || "") !== subjectF) return false;
        if (typeF && String(m.material_type || m.type || "") !== typeF) return false;
        return true;
      });

      if ($("materialsStats")) {
        $("materialsStats").innerHTML =
          '<span class="stat-pill">' +
          filtered.length +
          " materials</span>" +
          (books.length ? '<span class="stat-pill">' + books.length + " library books</span>" : "");
      }

      var cards = filtered.map(function (m) {
        return (
          '<article class="item-card"><span class="badge muted">' +
          esc(m.material_type || m.type || "file") +
          "</span><h4>" +
          esc(m.title) +
          '</h4><p class="meta">' +
          esc(m.subject || "") +
          (m.is_free === false ? " · Paid" : " · Free") +
          "</p>" +
          (m.description ? '<p class="meta">' + esc(m.description) + "</p>" : "") +
          '<div class="actions">' +
          (m.file_url
            ? '<a class="btn-sm" href="' + esc(m.file_url) + '" target="_blank" rel="noopener">Open</a>'
            : "") +
          '<button type="button" class="btn-danger" data-del-mat="' +
          esc(m.id) +
          '">Delete</button></div></article>'
        );
      });

      books.forEach(function (b) {
        cards.push(
          '<article class="item-card"><span class="badge ok">Library</span><h4>' +
            esc(b.title || "Book") +
            '</h4><p class="meta">' +
            esc(b.subject || "") +
            '</p><div class="actions"><button type="button" class="btn-sm" data-open-book="' +
            esc(b.id) +
            '">Read</button></div></article>'
        );
      });

      el.innerHTML = cards.length ? cards.join("") : '<div class="empty">No materials yet. Add one to get started.</div>';
    } catch (e) {
      el.innerHTML = '<div class="empty">' + esc(e.message || "Could not load materials") + "</div>";
    }
  }

  async function saveMaterial() {
    var err = $("matError");
    if (err) {
      err.textContent = "";
      err.className = "form-status";
    }
    var title = (($("matTitle") && $("matTitle").value) || "").trim();
    var subject = (($("matSubject") && $("matSubject").value) || "").trim();
    var type = ($("matType") && $("matType").value) || "pdf";
    var desc = (($("matDesc") && $("matDesc").value) || "").trim();
    var access = ($("matAccess") && $("matAccess").value) || "free";
    var isFree = access !== "paid";
    var price = parseFloat(($("matPrice") && $("matPrice").value) || "0") || 0;
    if (!title || !subject) {
      if (err) {
        err.textContent = "Title and subject are required.";
        err.className = "form-status err";
      }
      return;
    }
    if (!isFree && price < 100) {
      if (err) {
        err.textContent = "Paid materials need a price of at least ₦100.";
        err.className = "form-status err";
      }
      return;
    }
    var btn = $("saveMaterialBtn");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Saving…";
    }
    try {
      var url = "";
      if (type === "link" || type === "video") {
        url = (($("matUrl") && $("matUrl").value) || "").trim();
        if (!url) throw new Error("Enter a URL for this material.");
      } else {
        var fileInput = $("matFile");
        if (!fileInput || !fileInput.files || !fileInput.files[0]) throw new Error("Choose a file to upload.");
        var uploaded = await uploadFile(fileInput.files[0]);
        url = uploaded.file_url;
        if (uploaded.file_type === "pdf") type = "pdf";
        else if (uploaded.file_type === "doc") type = "doc";
        else if (uploaded.file_type === "image") type = "image";
      }
      await api.api("/api/v1/materials/", {
        method: "POST",
        body: {
          title: title,
          subject: subject,
          material_type: type,
          file_url: url,
          description: desc || null,
          is_free: isFree,
          price: isFree ? 0 : price,
        },
      });
      $("materialModal").hidden = true;
      loadMaterials();
    } catch (e) {
      if (err) {
        err.textContent = e.message || "Save failed.";
        err.className = "form-status err";
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Save material";
      }
    }
  }

  /* Exams */
  function toLocalDatetimeInput(d) {
    var pad = function (n) {
      return String(n).padStart(2, "0");
    };
    return (
      d.getFullYear() +
      "-" +
      pad(d.getMonth() + 1) +
      "-" +
      pad(d.getDate()) +
      "T" +
      pad(d.getHours()) +
      ":" +
      pad(d.getMinutes())
    );
  }

  function initExamForm() {
    populateSubjectFilters();
    var now = new Date();
    if ($("texamStart") && !$("texamStart").value) $("texamStart").value = toLocalDatetimeInput(now);
    if ($("texamEnd") && !$("texamEnd").value) {
      $("texamEnd").value = toLocalDatetimeInput(new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000));
    }
    if ($("texamSubject") && !$("texamSubject").value && subjects()[0]) {
      $("texamSubject").value = subjects()[0];
    }
  }

  function downloadExamTemplate() {
    var sample = {
      title: "Mathematics — Week 4 test",
      subject: "Mathematics",
      duration_minutes: 30,
      questions: [
        {
          question_text: "What is 15% of 200?",
          option_a: "25",
          option_b: "30",
          option_c: "35",
          option_d: "40",
          correct_option: "B",
          explanation: "15/100 × 200 = 30",
          topic: "Percentages",
        },
        {
          question_text: "Solve: 2x + 5 = 17",
          option_a: "x = 5",
          option_b: "x = 6",
          option_c: "x = 7",
          option_d: "x = 8",
          correct_option: "B",
          topic: "Algebra",
        },
      ],
    };
    var blob = new Blob([JSON.stringify(sample, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "scholaxia-exam-template.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  var texamQuestions = [];

  function letters() { return ["A", "B", "C", "D"]; }

  function normalizeTexamQuestion(q) {
    if (!q || typeof q !== "object") return null;
    if (q.question_text && q.option_a != null) {
      return {
        question_text: String(q.question_text || "").trim(),
        option_a: String(q.option_a || "").trim(),
        option_b: String(q.option_b || "").trim(),
        option_c: String(q.option_c || "").trim(),
        option_d: String(q.option_d || "").trim(),
        correct_option: String(q.correct_option || "A").trim().charAt(0).toUpperCase() || "A",
        explanation: q.explanation || null,
        topic: q.topic || null,
      };
    }
    var opts = Array.isArray(q.options) ? q.options : [];
    var idx = typeof q.correct_index === "number" ? q.correct_index : 0;
    return {
      question_text: String(q.prompt || q.question || q.question_text || "").trim(),
      option_a: String(opts[0] || q.option_a || "").trim(),
      option_b: String(opts[1] || q.option_b || "").trim(),
      option_c: String(opts[2] || q.option_c || "").trim(),
      option_d: String(opts[3] || q.option_d || "").trim(),
      correct_option: letters()[idx] || "A",
      explanation: q.explanation || null,
      topic: q.topic || null,
    };
  }

  function renderTexamQuestionList() {
    var list = $("tqList");
    if (!list) return;
    if (!texamQuestions.length) {
      list.innerHTML = '<p class="muted">No questions added yet.</p>';
      return;
    }
    list.innerHTML = texamQuestions.map(function (q, i) {
      var n = normalizeTexamQuestion(q) || q;
      return (
        '<div class="panel-card" style="margin-bottom:8px;padding:10px">' +
        "<strong>Q" + (i + 1) + ".</strong> " + esc(n.question_text || q.prompt || "") +
        ' <button type="button" class="btn btn-mini" data-rm-tq="' + i + '">Remove</button></div>'
      );
    }).join("");
  }

  function addTexamQuestion() {
    var prompt = (($("tqPrompt") && $("tqPrompt").value) || "").trim();
    var opts = [
      (($("tqA") && $("tqA").value) || "").trim(),
      (($("tqB") && $("tqB").value) || "").trim(),
      (($("tqC") && $("tqC").value) || "").trim(),
      (($("tqD") && $("tqD").value) || "").trim(),
    ];
    var correct = parseInt(($("tqCorrect") && $("tqCorrect").value) || "0", 10);
    if (!prompt || opts.filter(Boolean).length < 2) {
      alert("Enter the question and at least two options.");
      return;
    }
    texamQuestions.push({
      question_text: prompt,
      option_a: opts[0],
      option_b: opts[1],
      option_c: opts[2],
      option_d: opts[3],
      correct_option: letters()[isNaN(correct) ? 0 : correct] || "A",
    });
    if ($("tqPrompt")) $("tqPrompt").value = "";
    ["tqA", "tqB", "tqC", "tqD"].forEach(function (id) { if ($(id)) $(id).value = ""; });
    renderTexamQuestionList();
  }

  async function parseTexamFile() {
    var err = $("texamError");
    var fileInput = $("texamFile");
    if (!fileInput || !fileInput.files || !fileInput.files[0]) {
      if (err) {
        err.textContent = "Choose a PDF, Word, or JSON file first.";
        err.className = "form-status err";
      }
      return;
    }
    var btn = $("texamParseBtn");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Extracting…";
    }
    if (err) {
      err.textContent = "";
      err.className = "form-status";
    }
    try {
      var fd = new FormData();
      fd.append("file", fileInput.files[0]);
      var preview = await (api.apiUpload
        ? api.apiUpload("/api/v1/cbt/school-exams/import-preview", fd, { timeout: 120000 })
        : api.api("/api/v1/cbt/school-exams/import-preview", {
            method: "POST",
            body: fd,
            timeout: 120000,
            retries: 0,
          }));
      var qs = (preview && preview.questions) || [];
      var mapped = qs.map(normalizeTexamQuestion).filter(function (q) {
        return q && q.question_text && (q.option_a || q.option_b);
      });
      if (!mapped.length) throw new Error("No usable questions found in that file.");
      texamQuestions = mapped;
      renderTexamQuestionList();
      if (err) {
        err.textContent =
          "Loaded " +
          mapped.length +
          " question(s) from " +
          ((preview && preview.source) || "file") +
          ". Review the list, then Publish.";
        err.className = "form-status ok";
      }
    } catch (e) {
      if (err) {
        err.textContent = e.message || "Could not extract questions.";
        err.className = "form-status err";
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Extract questions from file";
      }
    }
  }

  async function publishExam() {
    var err = $("texamError");
    if (err) {
      err.textContent = "";
      err.className = "form-status";
    }
    var title = (($("texamTitle") && $("texamTitle").value) || "").trim();
    var subject = (($("texamSubject") && $("texamSubject").value) || "").trim();
    var duration = parseInt(($("texamDuration") && $("texamDuration").value) || "30", 10) || 30;
    var startVal = ($("texamStart") && $("texamStart").value) || "";
    var endVal = ($("texamEnd") && $("texamEnd").value) || "";
    var fileInput = $("texamFile");
    if (!title || !subject) {
      if (err) {
        err.textContent = "Title and subject are required.";
        err.className = "form-status err";
      }
      return;
    }
    var questions = texamQuestions.map(normalizeTexamQuestion).filter(Boolean);
    if ((!questions.length) && fileInput && fileInput.files && fileInput.files[0]) {
      try {
        await parseTexamFile();
        questions = texamQuestions.map(normalizeTexamQuestion).filter(Boolean);
      } catch (e) {
        if (err) {
          err.textContent = e.message || "Could not read exam file.";
          err.className = "form-status err";
        }
        return;
      }
    }
    if (!questions.length) {
      if (err) {
        err.textContent = "Add questions one by one, or upload a PDF and extract them.";
        err.className = "form-status err";
      }
      return;
    }
    var btn = $("texamPublishBtn");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Publishing…";
    }
    try {
      await api.api("/api/v1/cbt/school-exams", {
        method: "POST",
        body: {
          title: title,
          subject: subject,
          duration_minutes: duration,
          scheduled_start: startVal ? new Date(startVal).toISOString() : new Date().toISOString(),
          scheduled_end: endVal
            ? new Date(endVal).toISOString()
            : new Date(Date.now() + 14 * 86400000).toISOString(),
          questions: questions,
          camera_required: false,
          ai_locked: true,
          block_minimize: true,
        },
      });
      texamQuestions = [];
      renderTexamQuestionList();
      if (fileInput) fileInput.value = "";
      if ($("texamFileName")) $("texamFileName").textContent = "Choose PDF / Word / JSON";
      alert("Exam published! Students were notified.");
      loadExams();
    } catch (e) {
      if (err) {
        err.textContent = e.message || "Publish failed.";
        err.className = "form-status err";
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Publish exam";
      }
    }
  }

  async function loadExamResults(examId, panel) {
    if (!panel) return;
    panel.hidden = false;
    panel.innerHTML = '<div class="loading">Loading scores…</div>';
    try {
      var data = await api.api("/api/v1/cbt/school-exams/" + encodeURIComponent(examId) + "/results");
      var rows = (data && data.results) || [];
      if (!rows.length) {
        panel.innerHTML = '<p class="meta">No submissions yet.</p>';
        return;
      }
      panel.innerHTML =
        '<div class="exam-results"><table><thead><tr><th>Student</th><th>Score</th><th>%</th><th>Submitted</th></tr></thead><tbody>' +
        rows
          .map(function (r) {
            return (
              "<tr><td>" +
              esc(r.student_name) +
              "</td><td>" +
              esc(String(r.score)) +
              "</td><td>" +
              esc(String(Math.round(r.percentage || 0))) +
              "%</td><td>" +
              esc(formatDT(r.submitted_at)) +
              "</td></tr>"
            );
          })
          .join("") +
        "</tbody></table></div>";
    } catch (e) {
      panel.innerHTML = '<p class="form-status err">' + esc(e.message) + "</p>";
    }
  }

  async function loadExams() {
    initExamForm();
    var el = $("examList");
    if (!el) return;
    el.innerHTML = '<div class="loading">Loading exams…</div>';
    try {
      var exams = await api.api("/api/v1/cbt/school-exams/mine");
      if (!Array.isArray(exams)) exams = exams.exams || [];
      if (!exams.length) {
        el.innerHTML = '<div class="empty">No exams yet. Publish a JSON exam above.</div>';
        return;
      }
      el.innerHTML = exams
        .map(function (e) {
          return (
            '<article class="item-card"><span class="badge muted">' +
            esc(String(e.duration_minutes || 0)) +
            " min</span><h4>" +
            esc(e.title) +
            '</h4><p class="meta">' +
            esc(e.subject) +
            " · " +
            esc(String(e.total_questions || 0)) +
            " questions</p><p class='meta'>Open: " +
            formatDT(e.scheduled_start) +
            " — " +
            formatDT(e.scheduled_end) +
            '</p><div class="actions"><button type="button" class="btn-sm" data-exam-scores="' +
            esc(e.id) +
            '">View scores</button></div><div class="exam-results" id="examResults-' +
            esc(e.id) +
            '" hidden></div></article>'
          );
        })
        .join("");
    } catch (e) {
      el.innerHTML = '<div class="empty">' + esc(e.message || "Could not load exams") + "</div>";
    }
  }

  /* Students */
  async function loadStudents() {
    var el = $("studentsList");
    if (!el) return;
    el.innerHTML = '<div class="loading">Loading students…</div>';
    try {
      var rows = await api.api("/api/v1/live-classes/requests?status=approved");
      if (!Array.isArray(rows) || !rows.length) {
        rows = await api.api("/api/v1/live-classes/requests");
      }
      if (!Array.isArray(rows) || !rows.length) {
        el.innerHTML =
          '<div class="empty">No session requests yet. Host a <strong>Private</strong> class and invite students by email — no admin approval needed.</div>';
        return;
      }
      el.innerHTML = rows
        .map(function (r) {
          return (
            '<article class="item-card"><h4>' +
            esc(r.student_name || "Student") +
            '</h4><p class="meta">' +
            esc(r.subject || "") +
            " · " +
            esc(r.topic || r.message || "Live session") +
            '</p><p class="meta">' +
            formatDT(r.preferred_time || r.created_at) +
            ' · <span class="badge ok">' +
            esc(r.status || "approved") +
            '</span></p><div class="actions"><button type="button" class="btn-sm" data-host-for="' +
            esc(r.subject || "") +
            '" data-topic="' +
            esc(r.topic || r.message || "Live session") +
            '">Host class</button></div></article>'
          );
        })
        .join("");
    } catch (e) {
      el.innerHTML = '<div class="empty">' + esc(e.message || "Could not load students") + "</div>";
    }
  }

  /* Grading */
  async function loadGrading() {
    var el = $("gradingList");
    if (!el) return;
    el.innerHTML = '<div class="loading">Loading submissions…</div>';
    try {
      var rows = await api.api("/api/v1/community/assignments/pending");
      if (!Array.isArray(rows)) rows = rows.items || rows.submissions || [];
      if (!rows.length) {
        el.innerHTML = '<div class="empty">No pending submissions to grade.</div>';
        return;
      }
      el.innerHTML = rows
        .map(function (s) {
          return (
            '<article class="item-card"><h4>' +
            esc(s.student_name || s.caption || "Student submission") +
            '</h4><p class="meta">' +
            esc(s.file_type || "file") +
            (s.caption ? " · " + esc(s.caption) : "") +
            '</p><p class="meta">' +
            formatDT(s.submitted_at || s.created_at) +
            '</p><div class="actions"><button type="button" class="btn-sm" data-grade="' +
            esc(s.id) +
            '" data-url="' +
            esc(s.file_url || "") +
            '" data-name="' +
            esc(s.student_name || "Student") +
            '" data-title="' +
            esc(s.caption || "Assignment") +
            '">Score</button>' +
            (s.file_url
              ? '<a class="btn-sm" href="' + esc(s.file_url) + '" target="_blank" rel="noopener">Open file</a>'
              : "") +
            "</div></article>"
          );
        })
        .join("");
    } catch (e) {
      el.innerHTML = '<div class="empty">' + esc(e.message || "Could not load grading queue") + "</div>";
    }
  }

  async function saveGrade() {
    if (!gradeSubmissionId) return;
    var err = $("gradeError");
    if (err) {
      err.textContent = "";
      err.className = "form-status";
    }
    var score = parseFloat(($("gradeScore") && $("gradeScore").value) || "0");
    var feedback = (($("gradeFeedback") && $("gradeFeedback").value) || "").trim();
    try {
      await api.api("/api/v1/community/assignments/" + encodeURIComponent(gradeSubmissionId) + "/result", {
        method: "POST",
        body: {
          result_text: "Score: " + score + "/100",
          result_score: String(score) + "/100",
          result_feedback: feedback || null,
        },
      });
      $("gradeModal").hidden = true;
      gradeSubmissionId = null;
      loadGrading();
    } catch (e) {
      if (err) {
        err.textContent = e.message || "Could not save score.";
        err.className = "form-status err";
      }
    }
  }

  /* Community */
  async function loadCommunity() {
    var el = $("announceList");
    if (!el) return;
    el.innerHTML = '<div class="loading">Loading…</div>';
    try {
      var channels = await api.api("/api/v1/community/channels", {
        preferXhr: true,
        awaitWake: false,
        timeout: 25000,
        retries: 1,
      });
      var ann = (channels || []).find(function (c) {
        return c.type === "teacher_announcement";
      });
      if (!ann) {
        el.innerHTML = '<div class="empty">Announcement channel not found.</div>';
        return;
      }
      announceChannelId = ann.id;
      var posts = await api.api(
        "/api/v1/community/posts?channel_id=" + encodeURIComponent(ann.id) + "&limit=30",
        { preferXhr: true, awaitWake: false, timeout: 25000, retries: 1 }
      );
      if (!Array.isArray(posts)) {
        posts = (posts && (posts.posts || posts.items || posts.results)) || [];
      }
      if (!posts.length) {
        el.innerHTML = '<div class="empty">No announcements yet. Send one above.</div>';
        return;
      }
      el.innerHTML = posts
        .map(function (p) {
          var media =
            p.media_url && p.media_type === "audio"
              ? '<audio controls src="' + esc(p.media_url) + '" style="width:100%;margin-top:0.4rem"></audio>'
              : "";
          return (
            '<article class="item-card"><p class="meta">' +
            formatDT(p.created_at) +
            '</p><p style="font-weight:700;line-height:1.45">' +
            esc(p.content || "Voice announcement") +
            "</p>" +
            media +
            "</article>"
          );
        })
        .join("");
    } catch (e) {
      el.innerHTML = '<div class="empty">' + esc(e.message || "Could not load announcements") + "</div>";
    }
  }

  async function sendAnnouncement() {
    var err = $("announceError");
    if (err) {
      err.textContent = "";
      err.className = "form-status";
    }
    var text = (($("announceInput") && $("announceInput").value) || "").trim();
    if (!text) {
      if (err) {
        err.textContent = "Write a message first.";
        err.className = "form-status err";
      }
      return;
    }
    if (!announceChannelId) await loadCommunity();
    if (!announceChannelId) {
      if (err) {
        err.textContent = "Announcement channel not ready.";
        err.className = "form-status err";
      }
      return;
    }
    try {
      await api.api("/api/v1/community/posts", {
        method: "POST",
        preferXhr: true,
        awaitWake: false,
        timeout: 30000,
        retries: 1,
        body: {
          channel_id: announceChannelId,
          content: text,
          visibility: "everyone",
        },
      });
      if ($("announceInput")) $("announceInput").value = "";
      if (err) {
        err.textContent = "Announcement sent.";
        err.className = "form-status ok";
      }
      // Wait briefly then reload so recent posts includes the new row after DB commit.
      await new Promise(function (r) { setTimeout(r, 400); });
      await loadCommunity();
      var list = $("announceList");
      if (list && /No announcements yet/i.test(list.textContent || "")) {
        await new Promise(function (r) { setTimeout(r, 800); });
        await loadCommunity();
      }
    } catch (e) {
      if (err) {
        err.textContent = e.message || "Send failed.";
        err.className = "form-status err";
      }
    }
  }

  /* AI */
  var aiHistory = [];

  function initAI() {
    populateSubjectFilters();
    if ($("aiSubject") && !$("aiSubject").value && subjects()[0]) {
      $("aiSubject").value = subjects()[0];
    }
  }

  function appendAiBubble(role, text) {
    var log = $("aiChatLog");
    if (!log) return;
    log.hidden = false;
    var div = document.createElement("div");
    div.className = "ai-bubble ai-bubble-" + role;
    var label = document.createElement("strong");
    label.textContent = role === "user" ? "You" : "Teacher AI";
    var body = document.createElement("pre");
    body.textContent = text || "";
    div.appendChild(label);
    div.appendChild(body);
    log.appendChild(div);
    // Align the TOP of the newest reply in view — reads down naturally.
    if (div.scrollIntoView) {
      div.scrollIntoView({ block: "start", behavior: "smooth" });
    } else {
      log.scrollTop = log.scrollHeight;
    }
  }

  async function askAI() {
    var err = $("aiError");
    if (err) {
      err.textContent = "";
      err.className = "form-status";
    }
    var task = ($("aiTask") && $("aiTask").value) || "lesson_plan";
    var subject = (($("aiSubject") && $("aiSubject").value) || "").trim();
    var level = (($("aiLevel") && $("aiLevel").value) || "").trim();
    var details = (($("aiDetails") && $("aiDetails").value) || "").trim();
    if (!subject || !details) {
      if (err) {
        err.textContent = "Subject and a message are required.";
        err.className = "form-status err";
      }
      return;
    }
    var btn = $("aiAskBtn");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Working…";
    }
    appendAiBubble("user", details);
    if ($("aiDetails")) $("aiDetails").value = "";
    aiHistory.push({ role: "user", text: details });
    var detailsPayload = details;
    if (aiHistory.length > 1) {
      detailsPayload =
        "Previous conversation:\n" +
        aiHistory
          .slice(0, -1)
          .map(function (m) {
            return (m.role === "user" ? "Teacher" : "AI") + ": " + m.text;
          })
          .join("\n\n") +
        "\n\nTeacher follow-up: " +
        details;
    }
    var log = $("aiChatLog");
    var typing = null;
    if (log) {
      log.hidden = false;
      typing = document.createElement("div");
      typing.className = "ai-bubble ai-bubble-ai ai-typing";
      typing.setAttribute("aria-label", "Teacher AI is typing");
      typing.innerHTML = "<span></span><span></span><span></span>";
      log.appendChild(typing);
      if (typing.scrollIntoView) typing.scrollIntoView({ block: "end", behavior: "smooth" });
    }
    try {
      var res = await api.api("/api/v1/teacher-ai/ask", {
        method: "POST",
        body: {
          task: task,
          subject: subject,
          education_level: level || "SS2",
          details: detailsPayload,
        },
      });
      if (typing) typing.remove();
      var result = (res && res.result) || "No response.";
      appendAiBubble("ai", result);
      aiHistory.push({ role: "ai", text: result });
      if ($("aiDetails")) {
        $("aiDetails").placeholder = "Reply here (e.g. Yes — make it friendlier, or add date/time)…";
        $("aiDetails").focus();
      }
      if (btn) btn.textContent = "Send reply";
    } catch (e) {
      if (typing) typing.remove();
      if (err) {
        err.textContent = e.message || "AI request failed.";
        err.className = "form-status err";
      }
    } finally {
      if (typing && typing.parentNode) typing.remove();
      if (btn) btn.disabled = false;
      if (btn && btn.textContent === "Working…") btn.textContent = "Ask Teacher AI";
    }
  }

  /* Profile */
  async function loadProfile() {
    var user = api.getUser();
    setUserChip(user.name, user.email);
    if ($("profileText")) {
      $("profileText").textContent =
        (user.name || "Teacher") + " · " + (user.email || "") + " · Teacher";
    }
    if ($("tpName")) $("tpName").value = user.name || "";
    if ($("tpEmail")) $("tpEmail").value = user.email || "";
    try {
      var me = await api.api("/api/v1/teachers/me");
      if (me) {
        if (me.full_name) {
          localStorage.setItem("sia_name", me.full_name);
          setUserChip(me.full_name, me.email || user.email);
        }
        if (me.subjects) localStorage.setItem("sia_teacher_subjects", JSON.stringify(me.subjects));
        var approved = me.is_approved === true;
        if ($("teacherPendingBanner")) $("teacherPendingBanner").hidden = approved;
        if ($("teacherQuickActions")) $("teacherQuickActions").hidden = !approved;
        if ($("tpName")) $("tpName").value = me.full_name || user.name || "";
        if ($("tpEmail")) $("tpEmail").value = me.email || user.email || "";
        if ($("tpPhone")) $("tpPhone").value = me.phone || "";
        if ($("tpSubjects")) $("tpSubjects").value = (me.subjects || []).join(", ");
        if ($("profileText")) {
          $("profileText").textContent =
            (me.full_name || user.name) +
            " · " +
            (me.email || user.email) +
            " · " +
            (approved ? "Approved teacher" : "Pending approval") +
            (me.subjects && me.subjects.length ? " · " + me.subjects.join(", ") : "");
        }
        localStorage.setItem("sia_teacher_pending_approval", approved ? "0" : "1");
        if (me.profile_picture) showTeacherPhoto(me.profile_picture);
      }
    } catch (e) {
      /* keep session */
    }
  }

  function showTeacherPhoto(url) {
    var img = $("profilePhoto");
    var av = $("profileAv");
    if (!img) return;
    if (url) {
      img.src = url;
      img.hidden = false;
      if (av) av.style.display = "none";
    } else {
      img.removeAttribute("src");
      img.hidden = true;
      if (av) av.style.display = "";
    }
  }

  async function uploadTeacherPhoto() {
    var input = $("tpPhoto");
    var status = $("tpPhotoStatus");
    var btn = $("tpPhotoBtn");
    function say(msg, ok) {
      if (status) {
        status.textContent = msg;
        status.className = "form-status" + (ok ? " ok" : "");
      }
    }
    if (!input || !input.files || !input.files[0]) {
      say("Choose a photo first.");
      return;
    }
    var file = input.files[0];
    if (file.size > 20 * 1024 * 1024) {
      say("Photo is too large. Maximum is 20MB.");
      return;
    }
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Uploading…";
    }
    say("");
    try {
      var up = await uploadFile(file);
      var url = (up && (up.file_url || up.secure_url || up.url)) || "";
      if (!url) throw new Error("Upload did not return a photo URL.");
      var res = await api.api("/api/v1/profiles/me/picture", {
        method: "PATCH",
        body: JSON.stringify({ profile_picture: url }),
      });
      var finalUrl = (res && res.profile_picture) || url;
      showTeacherPhoto(finalUrl);
      say("Profile photo updated.", true);
    } catch (e) {
      say(e.message || "Could not upload photo.");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Upload photo";
      }
    }
  }

  /* Events */
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (!t || !t.closest) return;

    var nav = t.closest(".nav-btn, [data-page]");
    if (nav && nav.getAttribute("data-page") && nav.classList.contains("nav-btn")) {
      e.preventDefault();
      showPage(nav.getAttribute("data-page"));
      return;
    }
    var goto = t.closest("[data-goto]");
    if (goto && goto.getAttribute("data-goto")) {
      e.preventDefault();
      showPage(goto.getAttribute("data-goto"));
      return;
    }
    var start = t.closest("[data-start]");
    if (start) {
      startClass(start.getAttribute("data-start"));
      return;
    }
    var endC = t.closest("[data-end-class]");
    if (endC) {
      endClass(endC.getAttribute("data-end-class"));
      return;
    }
    var enter = t.closest("[data-enter]");
    if (enter) {
      enterClassroom(
        enter.getAttribute("data-enter"),
        enter.getAttribute("data-title"),
        enter.getAttribute("data-subject"),
        enter.getAttribute("data-end"),
        enter.getAttribute("data-live") === "1"
      );
      return;
    }
    var copyCode = t.closest("[data-copy-code]");
    if (copyCode) {
      var codeVal = copyCode.getAttribute("data-copy-code");
      copyText(codeVal).then(function () {
        copyCode.textContent = "Copied";
        setTimeout(function () { copyCode.textContent = "Copy code"; }, 1600);
      }).catch(function () {
        alert("Access code: " + codeVal);
      });
      return;
    }
    var shareCode = t.closest("[data-share-code]");
    if (shareCode) {
      var shareVal = shareCode.getAttribute("data-share-code");
      var shareTitle = shareCode.getAttribute("data-share-title") || "Scholaxia live class";
      var shareText = shareTitle + " access code: " + shareVal;
      if (navigator.share) {
        navigator.share({ title: shareTitle, text: shareText }).catch(function () {});
      } else {
        copyText(shareVal).then(function () {
          shareCode.textContent = "Copied";
          setTimeout(function () { shareCode.textContent = "Share code"; }, 1600);
        }).catch(function () {
          alert(shareText);
        });
      }
      return;
    }
    var del = t.closest("[data-del-mat]");
    if (del) {
      if (!confirm("Remove this material?")) return;
      api
        .api("/api/v1/materials/" + encodeURIComponent(del.getAttribute("data-del-mat")), {
          method: "DELETE",
        })
        .then(loadMaterials)
        .catch(function (err) {
          alert(err.message);
        });
      return;
    }
    var book = t.closest("[data-open-book]");
    if (book) {
      var bookId = book.getAttribute("data-open-book");
      fetch(api.API_BASE + "/api/v1/library/" + encodeURIComponent(bookId) + "/file", {
        headers: { Authorization: "Bearer " + api.getToken() },
        credentials: "omit",
      })
        .then(function (res) {
          if (!res.ok) throw new Error("Could not open this material");
          return res.blob();
        })
        .then(function (blob) {
          window.open(URL.createObjectURL(blob), "_blank");
        })
        .catch(function (err) {
          alert(err.message);
        });
      return;
    }
    var scores = t.closest("[data-exam-scores]");
    if (scores) {
      var id = scores.getAttribute("data-exam-scores");
      var panel = $("examResults-" + id);
      if (panel) {
        if (panel.hidden) loadExamResults(id, panel);
        else panel.hidden = true;
      }
      return;
    }
    var hostFor = t.closest("[data-host-for]");
    if (hostFor) {
      showPage("live");
      if ($("hostSubject")) $("hostSubject").value = hostFor.getAttribute("data-host-for") || "";
      if ($("hostTitle")) $("hostTitle").value = hostFor.getAttribute("data-topic") || "";
      return;
    }
    var grade = t.closest("[data-grade]");
    if (grade) {
      gradeSubmissionId = grade.getAttribute("data-grade");
      if ($("gradeMeta")) {
        $("gradeMeta").textContent =
          (grade.getAttribute("data-name") || "Student") +
          " · " +
          (grade.getAttribute("data-title") || "Assignment");
      }
      var url = grade.getAttribute("data-url") || "";
      if ($("gradePreview")) {
        $("gradePreview").innerHTML = url
          ? url.match(/\.(png|jpe?g|gif|webp)$/i)
            ? '<img src="' + esc(url) + '" alt="Submission" />'
            : '<a href="' + esc(url) + '" target="_blank" rel="noopener">Open submission file</a>'
          : "No file preview";
      }
      if ($("gradeError")) $("gradeError").textContent = "";
      $("gradeModal").hidden = false;
      return;
    }
    var chip = t.closest("#aiChips .chip");
    if (chip) {
      if ($("aiTask") && chip.getAttribute("data-task")) $("aiTask").value = chip.getAttribute("data-task");
      if ($("aiDetails") && chip.getAttribute("data-prompt")) {
        $("aiDetails").value = chip.getAttribute("data-prompt");
        $("aiDetails").focus();
      }
    }
  });

  document.querySelectorAll('input[name="host-visibility"]').forEach(function (r) {
    r.addEventListener("change", onVisibilityChange);
    r.addEventListener("click", onVisibilityChange);
  });
  document.querySelectorAll(".vis-opt").forEach(function (lab) {
    lab.addEventListener("click", function () {
      setTimeout(onVisibilityChange, 0);
    });
  });
  onVisibilityChange();

  document.querySelectorAll(".nav-btn[data-page]").forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      showPage(btn.getAttribute("data-page"));
    });
  });

  if ($("hostScheduleBtn")) $("hostScheduleBtn").addEventListener("click", function () { hostClass(false); });
  if ($("hostLiveBtn")) $("hostLiveBtn").addEventListener("click", function () { hostClass(true); });
  if ($("hostCodeCopyBtn")) {
    $("hostCodeCopyBtn").addEventListener("click", function () {
      var code = (($("hostCodeValue") && $("hostCodeValue").textContent) || "").trim();
      var btn = $("hostCodeCopyBtn");
      copyText(code).then(function () {
        if (btn) btn.textContent = "Copied";
        setTimeout(function () { if (btn) btn.textContent = "Copy code"; }, 1600);
      }).catch(function () {
        alert("Access code: " + code);
      });
    });
  }
  if ($("hostCodeShareBtn")) {
    $("hostCodeShareBtn").addEventListener("click", function () {
      var code = (($("hostCodeValue") && $("hostCodeValue").textContent) || "").trim();
      var text = "Join my Scholaxia private class with access code: " + code;
      if (navigator.share) {
        navigator.share({ title: "Scholaxia class code", text: text }).catch(function () {});
      } else {
        copyText(code).then(function () {
          $("hostCodeShareBtn").textContent = "Copied";
          setTimeout(function () { $("hostCodeShareBtn").textContent = "Share"; }, 1600);
        }).catch(function () {
          alert(text);
        });
      }
    });
  }
  if ($("hostCodeOpenBtn")) {
    $("hostCodeOpenBtn").addEventListener("click", function () {
      if (!pendingHostClass || !pendingHostClass.id) return;
      enterClassroom(pendingHostClass.id, pendingHostClass.title, pendingHostClass.subject, pendingHostClass.end, true);
    });
  }
  if ($("liveRefreshBtn")) $("liveRefreshBtn").addEventListener("click", loadLive);
  if ($("liveFilter")) $("liveFilter").addEventListener("change", loadLive);
  if ($("sgCreateBtn")) $("sgCreateBtn").addEventListener("click", createSchoolGroup);

  if ($("openMaterialBtn")) {
    $("openMaterialBtn").addEventListener("click", function () {
      populateSubjectFilters();
      toggleMatInputs();
      if ($("matError")) $("matError").textContent = "";
      if ($("matFile")) $("matFile").value = "";
      if ($("matFileName")) $("matFileName").textContent = "Choose file";
      var drop = $("matFile") && $("matFile").closest(".file-drop");
      if (drop) drop.classList.remove("has-file");
      $("materialModal").hidden = false;
    });
  }
  if ($("closeMaterialBtn")) $("closeMaterialBtn").addEventListener("click", function () { $("materialModal").hidden = true; });
  if ($("cancelMaterialBtn")) $("cancelMaterialBtn").addEventListener("click", function () { $("materialModal").hidden = true; });
  if ($("saveMaterialBtn")) $("saveMaterialBtn").addEventListener("click", saveMaterial);
  if ($("matType")) $("matType").addEventListener("change", toggleMatInputs);
  if ($("matAccess")) $("matAccess").addEventListener("change", toggleMatInputs);
  if ($("matRefreshBtn")) $("matRefreshBtn").addEventListener("click", loadMaterials);
  if ($("matSubjectFilter")) $("matSubjectFilter").addEventListener("change", loadMaterials);
  if ($("matTypeFilter")) $("matTypeFilter").addEventListener("change", loadMaterials);

  if ($("texamTemplateBtn")) $("texamTemplateBtn").addEventListener("click", downloadExamTemplate);
  if ($("texamParseBtn")) $("texamParseBtn").addEventListener("click", parseTexamFile);
  if ($("texamPublishBtn")) $("texamPublishBtn").addEventListener("click", publishExam);
  if ($("tqAddBtn")) $("tqAddBtn").addEventListener("click", addTexamQuestion);
  document.addEventListener("click", function (e) {
    var rm = e.target && e.target.closest && e.target.closest("[data-rm-tq]");
    if (!rm) return;
    var i = parseInt(rm.getAttribute("data-rm-tq"), 10);
    if (!isNaN(i)) { texamQuestions.splice(i, 1); renderTexamQuestionList(); }
  });
  if ($("studentsRefreshBtn")) $("studentsRefreshBtn").addEventListener("click", loadStudents);
  if ($("gradingRefreshBtn")) $("gradingRefreshBtn").addEventListener("click", loadGrading);
  if ($("announceSendBtn")) $("announceSendBtn").addEventListener("click", sendAnnouncement);
  if ($("aiAskBtn")) $("aiAskBtn").addEventListener("click", askAI);
  if ($("tpPhotoBtn")) $("tpPhotoBtn").addEventListener("click", uploadTeacherPhoto);

  if ($("closeGradeBtn")) $("closeGradeBtn").addEventListener("click", function () { $("gradeModal").hidden = true; });
  if ($("cancelGradeBtn")) $("cancelGradeBtn").addEventListener("click", function () { $("gradeModal").hidden = true; });
  if ($("saveGradeBtn")) $("saveGradeBtn").addEventListener("click", saveGrade);

  if ($("logoutBtn")) {
    $("logoutBtn").addEventListener("click", function (e) {
      e.preventDefault();
      try {
        api.clearSession();
      } catch (err) {}
      window.location.replace("portal.html?force=1&reason=logout");
    });
  }
  if ($("mobileMenuBtn")) {
    $("mobileMenuBtn").addEventListener("click", function () {
      if (document.body.classList.contains("nav-open")) closeMobileNav();
      else openMobileNav();
    });
  }
  if ($("sidebarBackdrop")) $("sidebarBackdrop").addEventListener("click", closeMobileNav);
  if ($("sidebarCloseBtn")) {
    $("sidebarCloseBtn").addEventListener("click", function () {
      if (window.matchMedia("(max-width: 900px)").matches) closeMobileNav();
      else if (shell) {
        shell.classList.add("sidebar-collapsed");
        if ($("sidebarToggle")) $("sidebarToggle").textContent = "›";
      }
    });
  }
  if ($("sidebarToggle")) {
    $("sidebarToggle").addEventListener("click", function () {
      if (!shell) return;
      var collapsed = !shell.classList.contains("sidebar-collapsed");
      shell.classList.toggle("sidebar-collapsed", collapsed);
      $("sidebarToggle").textContent = collapsed ? "›" : "‹";
    });
  }
  if ($("backBtn")) $("backBtn").addEventListener("click", goBack);

  function bindFileDrop(inputId, nameId) {
    var input = $(inputId);
    var nameEl = $(nameId);
    if (!input || !nameEl) return;
    var drop = input.closest(".file-drop");

    function syncName() {
      var file = input.files && input.files[0];
      if (file) {
        nameEl.textContent = file.name;
        if (drop) drop.classList.add("has-file");
      } else {
        nameEl.textContent = inputId === "texamFile" ? "Choose JSON file" : "Choose file";
        if (drop) drop.classList.remove("has-file");
      }
    }

    input.addEventListener("change", syncName);

    if (drop) {
      ["dragenter", "dragover"].forEach(function (ev) {
        drop.addEventListener(ev, function (e) {
          e.preventDefault();
          drop.classList.add("is-drag");
        });
      });
      ["dragleave", "drop"].forEach(function (ev) {
        drop.addEventListener(ev, function (e) {
          e.preventDefault();
          drop.classList.remove("is-drag");
        });
      });
      drop.addEventListener("drop", function (e) {
        var files = e.dataTransfer && e.dataTransfer.files;
        if (!files || !files.length) return;
        try {
          input.files = files;
        } catch (err) {
          /* some browsers block setting files; click still works */
        }
        if (input.files && input.files.length) syncName();
        else {
          // Fallback: create DataTransfer
          try {
            var dt = new DataTransfer();
            dt.items.add(files[0]);
            input.files = dt.files;
            syncName();
          } catch (err2) {
            nameEl.textContent = files[0].name;
            drop.classList.add("has-file");
          }
        }
      });
    }
  }

  bindFileDrop("texamFile", "texamFileName");
  bindFileDrop("matFile", "matFileName");

  /* boot — never leave an invisible drawer overlay blocking taps */
  closeMobileNav();
  onVisibilityChange();
  var user = api.getUser();
  setUserChip(user.name, user.email);
  loadProfile();
  var hash = (location.hash || "").replace("#", "");
  showPage(TITLES[hash] ? hash : "live", { replace: true });
})();
