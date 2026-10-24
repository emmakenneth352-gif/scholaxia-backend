var currentTeacherPage = "live";
var teacherVoiceRecorder = null;

var TEACHER_PAGE_TITLES = {
  live: "Live Classes",
  materials: "Study Materials",
  exams: "Scholaxia Exam",
  students: "My Students",
  community: "Community",
  ai: "Teacher AI",
};

window.onload = function () {
  bindTeacherUI();
  setDefaultScheduleDate();

  if (!getTeacherToken()) {
    document.getElementById("auth-screen").classList.remove("hidden");
    document.getElementById("app-screen").classList.add("hidden");
    return;
  }
  document.getElementById("auth-screen").classList.add("hidden");
  document.getElementById("app-screen").classList.remove("hidden");
  initTeacherUI();
  initTeacherSidebar();
  showTeacherPage("live");
  if (typeof startTeacherNotifications === "function") startTeacherNotifications();
};

function updateTeacherTopbar(page) {
  var label = document.getElementById("teacher-topbar-label");
  if (!label) return;
  var base = "Scholaxia Teacher Studio";
  var t = TEACHER_PAGE_TITLES[page];
  label.textContent = t ? base + " — " + t : base;
}

function initTeacherSidebar() {
  var shell = document.getElementById("app-screen");
  var btn = document.getElementById("sidebar-toggle");
  if (!shell || !btn) return;

  if (localStorage.getItem("sia_teacher_sidebar_collapsed") === "1") {
    shell.classList.add("sidebar-collapsed");
  }
  updateTeacherSidebarToggle(btn, shell.classList.contains("sidebar-collapsed"));

  btn.addEventListener("click", function () {
    shell.classList.toggle("sidebar-collapsed");
    var collapsed = shell.classList.contains("sidebar-collapsed");
    localStorage.setItem("sia_teacher_sidebar_collapsed", collapsed ? "1" : "0");
    updateTeacherSidebarToggle(btn, collapsed);
  });
}

function updateTeacherSidebarToggle(btn, collapsed) {
  btn.textContent = collapsed ? "\u203A" : "\u2039";
  btn.setAttribute("aria-label", collapsed ? "Show menu" : "Hide menu");
  btn.title = collapsed ? "Show menu" : "Hide menu";
}

function initTeacherUI() {
  var user = getTeacherUser();
  document.getElementById("teacher-name-label").textContent = user.name;
  document.getElementById("teacher-email-label").textContent = user.email;
  var avatar = document.getElementById("teacher-user-avatar");
  if (avatar) {
    var initial = (user.name || user.email || "T").trim().charAt(0).toUpperCase();
    avatar.textContent = initial || "T";
  }
}

function teacherNetworkMessage(err) {
  var msg = (err && err.message) ? String(err.message) : "";
  if (err && (err.name === "AbortError" || err.name === "TimeoutError")) {
    return "Server is waking up — wait a moment and try again.";
  }
  if (msg === "Failed to fetch" || msg.indexOf("NetworkError") >= 0 || msg.indexOf("network") >= 0) {
    return "Cannot reach Scholaxia server. Restart the app and check your internet.";
  }
  return msg || "Login failed. Please try again.";
}

function formatTeacherApiError(data, status) {
  var detail = data && data.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map(function (d) { return d.msg || d; }).join(", ");
  if (detail && typeof detail === "object") return detail.msg || JSON.stringify(detail);
  if (status === 401) return "Wrong email or password.";
  if (status === 403) return "Account disabled.";
  if (status === 502) return "Server proxy error — fully close the app and open TEACHER.bat again.";
  if (status === 501) return "Old desktop server still running. Close ALL Scholaxia windows, then open TEACHER.bat again.";
  return "Login failed (HTTP " + status + ").";
}

async function teacherLogin(ev) {
  if (ev) ev.preventDefault();
  var email = document.getElementById("teacher-login-email").value.trim();
  var password = document.getElementById("teacher-login-password").value;
  var err = document.getElementById("teacher-login-error");
  var btn = document.getElementById("teacher-login-btn");
  err.textContent = "";
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Logging in…";
  }
  try {
    var signal = typeof fetchTimeout === "function" ? fetchTimeout(45000) : teacherFetchTimeout(45000);
    var res = await fetch(API_BASE + "/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email, password: password }),
      signal: signal,
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      throw new Error(formatTeacherApiError(data, res.status));
    }
    var role = data.role || (data.user && data.user.role) || "";
    if (role !== "teacher" && role !== "admin") {
      throw new Error("This portal is for teachers only. Use the student or admin app.");
    }
    saveTeacherSession(data, email, data.user && data.user.full_name);
    try {
      var profile = await teacherApi("/api/v1/teachers/me");
      if (profile && profile.subjects) {
        localStorage.setItem("sia_teacher_subjects", JSON.stringify(profile.subjects));
      }
    } catch (e) { /* optional */ }
    window.location.reload();
  } catch (e) {
    err.textContent = teacherNetworkMessage(e);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Sign in";
    }
  }
}

function teacherLogout() {
  clearTeacherSession();
  // Return to the general desktop auth screen (role select + login), not the stale teacher page.
  window.location.href = "index.html#auth";
}

function showTeacherPage(page) {
  currentTeacherPage = page;
  updateTeacherTopbar(page);
  document.querySelectorAll(".teacher-page").forEach(function (p) { p.classList.remove("active"); });
  document.querySelectorAll("#teacher-topnav .topnav-btn").forEach(function (b) { b.classList.remove("active"); });
  var pg = document.getElementById("page-" + page);
  if (pg) pg.classList.add("active");
  var btn = document.querySelector('#teacher-topnav .topnav-btn[data-page="' + page + '"]');
  if (btn) btn.classList.add("active");
  if (page === "live") {
    loadTeacherLive();
    loadHostStudentPickers();
    loadSchoolGroupsForHost();
    renderSchoolGroupsList();
  }
  else if (page === "students") loadTeacherStudents();
  else if (page === "materials") loadTeacherMaterials();
  else if (page === "exams") loadTeacherExams();
  else if (page === "community") loadTeacherCommunity();
  else if (page === "ai") initTeacherAI();
}

function parseScheduleDateTime(date, time) {
  if (!date || !time) return null;
  var d = new Date(date + "T" + time);
  if (isNaN(d.getTime())) return null;
  return d;
}

function getSchedulePayload(goLiveNow) {
  var title = document.getElementById("host-title").value.trim();
  var subject = document.getElementById("host-subject").value.trim();
  var date = document.getElementById("host-date").value;
  var startTime = document.getElementById("host-start").value;
  var endTime = document.getElementById("host-end").value;
  var duration = parseInt(document.getElementById("host-duration").value, 10) || 60;
  if (!title || !subject) throw new Error("Title and subject are required");

  var visEl = document.querySelector('input[name="host-visibility"]:checked');
  var visibility = visEl ? visEl.value : "public";

  var body = {
    title: title,
    subject: subject,
    duration_minutes: duration,
    go_live_now: goLiveNow,
    visibility: visibility,
  };

  if (visibility === "private") {
    // Invited students/emails (kids are invited by email and join from their
    // Live Class list — no code needed). Other students still join by code.
    var ids = [];
    var hidden = document.getElementById("host-invited-students");
    if (hidden) {
      Array.prototype.forEach.call(hidden.options || [], function (o) {
        if (o.selected && o.value) ids.push(o.value);
      });
    }
    if (ids.length) body.invited_student_ids = ids;
    // Direct email invites: every address gets a class invitation email.
    var emailInput = document.getElementById("host-invite-emails");
    var rawEmails = (emailInput && emailInput.value) || "";
    var emails = rawEmails.split(",").map(function (s) { return s.trim(); }).filter(function (s) { return s.indexOf("@") > 0; });
    if (emails.length) body.invited_student_emails = emails;
  }
  if (visibility === "school_group") {
    var gid = document.getElementById("host-school-group").value;
    if (!gid) throw new Error("Select a school group.");
    body.school_group_id = gid;
  }

  if (!goLiveNow) {
    if (!date || !startTime) throw new Error("Pick a date and start time to schedule");
    var startDt = parseScheduleDateTime(date, startTime);
    if (!startDt) throw new Error("Invalid date or start time");
    body.start_time = startDt.toISOString();
    if (endTime) {
      var endDt = parseScheduleDateTime(date, endTime);
      if (!endDt) throw new Error("Invalid end time");
      if (endDt <= startDt) throw new Error("End time must be after start time");
      body.end_time = endDt.toISOString();
    }
  } else if (endTime && date) {
    var liveEnd = parseScheduleDateTime(date, endTime);
    var now = new Date();
    if (liveEnd && liveEnd > now) {
      body.end_time = liveEnd.toISOString();
    }
  }
  return body;
}

function setHostButtonsBusy(busy, goLiveNow) {
  var scheduleBtn = document.getElementById("host-schedule-btn");
  var liveBtn = document.getElementById("host-live-btn");
  if (scheduleBtn) {
    scheduleBtn.disabled = !!busy;
    if (!busy) scheduleBtn.textContent = "Schedule class";
    else if (!goLiveNow) scheduleBtn.textContent = "Scheduling…";
  }
  if (liveBtn) {
    liveBtn.disabled = !!busy;
    if (!busy) liveBtn.textContent = "Go live now";
    else if (goLiveNow) liveBtn.textContent = "Going live…";
  }
}

var _teacherHostBusy = false;

var _pendingHostClass = null;

function showTeacherHostCode(created, body, goLiveNow) {
  var code = (created && created.join_code) || "";
  if (!code) return;
  _pendingHostClass = {
    id: created.id,
    title: body.title,
    subject: body.subject,
    end: created.end_time,
  };
  var box = document.getElementById("host-code-share");
  var value = document.getElementById("host-code-value");
  var title = document.getElementById("host-code-title");
  var hint = document.getElementById("host-code-hint");
  var openWrap = document.getElementById("host-code-open-wrap");
  if (value) value.textContent = code;
  if (title) title.textContent = goLiveNow ? "Class is live — share this code" : "Class scheduled — share this code";
  if (hint) hint.textContent = "Students open Join Live, paste this code, and they're in. It also lands in their Access Code tab automatically.";
  if (openWrap) openWrap.hidden = !goLiveNow;
  if (box) {
    box.hidden = false;
    try { box.scrollIntoView({ behavior: "smooth", block: "nearest" }); } catch (e) {}
  }
}

function copyTeacherHostCode() {
  var code = ((document.getElementById("host-code-value") || {}).textContent || "").trim();
  if (!code) return;
  function done(btn) {
    if (!btn) return;
    var prev = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(function () { btn.textContent = prev; }, 1600);
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(code).then(function () {
      done(document.getElementById("host-code-copy-btn"));
    }).catch(function () {
      prompt("Copy this access code:", code);
    });
  } else {
    prompt("Copy this access code:", code);
  }
}

function shareTeacherHostCode() {
  var code = ((document.getElementById("host-code-value") || {}).textContent || "").trim();
  if (!code) return;
  var text = "Join my Scholaxia live class with this access code: " + code;
  if (navigator.share) {
    navigator.share({ title: "Scholaxia class code", text: text }).catch(function () {});
  } else if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function () {
      var btn = document.getElementById("host-code-share-btn");
      if (btn) {
        btn.textContent = "Copied!";
        setTimeout(function () { btn.textContent = "Copy invite text"; }, 1600);
      }
    }).catch(function () {
      prompt("Copy this invite:", text);
    });
  } else {
    prompt("Copy this invite:", text);
  }
}

function openPendingHostClassroom() {
  if (!_pendingHostClass || !_pendingHostClass.id) return;
  teacherEnterClassroom(_pendingHostClass.id, _pendingHostClass.title, _pendingHostClass.subject, _pendingHostClass.end, true);
}

async function teacherHostClass(goLiveNow) {
  if (_teacherHostBusy) return;
  _teacherHostBusy = true;
  var err = document.getElementById("host-error");
  if (err) err.textContent = "";
  setHostButtonsBusy(true, goLiveNow);
  try {
    var body = getSchedulePayload(goLiveNow);
    var created = await teacherApi("/api/v1/live-classes/", {
      method: "POST",
      body: JSON.stringify(body),
      timeout: 120000,
    });
    if (!created) {
      throw new Error("Could not create class. Please sign in again.");
    }
    var titleInput = document.getElementById("host-title");
    if (titleInput) titleInput.value = "";
    await loadTeacherLive();
    if (created.join_code) {
      showTeacherHostCode(created, body, goLiveNow);
      return;
    }
    if (goLiveNow && created.id) {
      var visMsg = body.visibility === "public"
        ? "All students on Scholaxia were notified."
        : "Students were notified.";
      if (confirm("Class is live! " + visMsg + " Open classroom?")) {
        teacherEnterClassroom(created.id, body.title, body.subject, created.end_time, true);
      }
    } else {
      alert("Class scheduled.");
    }
  } catch (e) {
    var msg = (e && e.message) ? e.message : "Could not host class. Try again.";
    if (err) {
      err.textContent = msg;
      err.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    alert(msg);
  } finally {
    _teacherHostBusy = false;
    setHostButtonsBusy(false, goLiveNow);
  }
}

async function teacherStartClass(id) {
  try {
    await teacherApi("/api/v1/live-classes/" + id + "/start", { method: "POST" });
    loadTeacherLive();
    alert("Class started — students notified.");
  } catch (e) { alert(e.message); }
}

async function teacherEndClass(id) {
  try {
    await teacherApi("/api/v1/live-classes/" + id + "/end", { method: "POST" });
    try { localStorage.setItem("sia_stop_live_ring", String(Date.now())); } catch (e) { /* ignore */ }
    loadTeacherLive();
  } catch (e) { alert(e.message); }
}

var _enterClassBusy = false;
async function teacherEnterClassroom(classId, title, subject, endTime, alreadyLive) {
  // One click at a time: /start + room-create + /token can take a few seconds;
  // impatient extra clicks used to mint 4 tokens and spawn 4 room windows.
  if (_enterClassBusy) return;
  _enterClassBusy = true;
  try {
    if (!alreadyLive) {
      await teacherApi("/api/v1/live-classes/" + classId + "/start", { method: "POST" });
    }
    var token = await teacherApi("/api/v1/live-classes/" + classId + "/token");
    if (!token) return;
    // plugNmeet room ready → open its own client (same as the website).
    if (token.pnm_join_url) {
      try { localStorage.setItem("sia_stop_live_ring", String(Date.now())); } catch (e) { /* ignore */ }
      if (typeof launchPnmRoom === "function" && launchPnmRoom(token.pnm_join_url)) return;
      window.location.href = token.pnm_join_url;
      return;
    }
    localStorage.setItem("live_session", JSON.stringify({
      class_id: classId,
      classId: classId,
      room_id: token.channel_id,
      channel_id: token.channel_id,
      livekit_token: token.livekit_token || token.token,
      livekit_url: token.livekit_url,
      identity: token.identity,
      teacher_id: token.teacher_id || token.identity,
      can_publish: token.can_publish !== false,
      title: title || "Live Class",
      subject: subject || "",
      teacher_name: getTeacherUser().name,
      role: "teacher",
      end_time: endTime || token.end_time || null,
      already_live: !!alreadyLive,
    }));
    window.location.href = "classroom.html";
  } catch (e) {
    alert(e.message);
  } finally {
    _enterClassBusy = false;
  }
}

var liveStudentsClassId = null;
var liveStudentsPollTimer = null;

function closeLiveStudentsModal() {
  var modal = document.getElementById("live-students-modal");
  if (modal) modal.classList.add("hidden");
  liveStudentsClassId = null;
  if (liveStudentsPollTimer) {
    clearInterval(liveStudentsPollTimer);
    liveStudentsPollTimer = null;
  }
}

async function openLiveStudentsModal(classId, title) {
  liveStudentsClassId = classId;
  var modal = document.getElementById("live-students-modal");
  var titleEl = document.getElementById("live-students-title");
  if (titleEl) titleEl.textContent = title || "Live class";
  if (modal) modal.classList.remove("hidden");
  await loadLiveClassStudents();
  if (liveStudentsPollTimer) clearInterval(liveStudentsPollTimer);
  liveStudentsPollTimer = setInterval(function () {
    if (liveStudentsClassId) loadLiveClassStudents(true);
  }, 12000);
}

async function loadLiveClassStudents(quiet) {
  var el = document.getElementById("live-students-list");
  if (!el || !liveStudentsClassId) return;
  if (!quiet) el.innerHTML = '<div class="loading">Loading students…</div>';
  try {
    var rows = await teacherApi("/api/v1/live-classes/" + liveStudentsClassId + "/students");
    if (!rows || !rows.length) {
      el.innerHTML = '<div class="empty-state">No students in class yet. They appear here after they tap Join on Live Class.</div>';
      return;
    }
    el.innerHTML = rows.map(function (s) {
      var safeId = String(s.student_id).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      var safeName = escHtml(s.name || "Student");
      var status = s.mic_allowed
        ? '<span class="badge live">Can speak</span>'
        : '<span class="badge muted">Muted</span>';
      var btn = s.mic_allowed
        ? '<button type="button" class="btn-sm danger" onclick="teacherRevokeStudentMic(\'' + safeId + '\')">Mute</button>'
        : '<button type="button" class="btn-sm primary" onclick="teacherAllowStudentMic(\'' + safeId + '\')">Allow to speak</button>';
      return '<div class="live-student-row">' +
        '<div><strong>' + safeName + '</strong><br><span class="muted">' + status + '</span></div>' +
        '<div class="actions">' + btn + '</div></div>';
    }).join("");
  } catch (e) {
    if (!quiet) el.innerHTML = '<div class="empty-state">' + escHtml(e.message) + '</div>';
  }
}

async function teacherAllowStudentMic(studentId) {
  if (!liveStudentsClassId || !studentId) return;
  try {
    await teacherApi("/api/v1/live-classes/" + liveStudentsClassId + "/students/" + studentId + "/unmute", {
      method: "POST",
    });
    await loadLiveClassStudents(true);
    alert("Student can now unmute and speak in the live class.");
  } catch (e) {
    alert(e.message || "Could not allow mic.");
  }
}

async function teacherRevokeStudentMic(studentId) {
  if (!liveStudentsClassId || !studentId) return;
  try {
    await teacherApi("/api/v1/live-classes/" + liveStudentsClassId + "/students/" + studentId + "/mute", {
      method: "POST",
    });
    await loadLiveClassStudents(true);
  } catch (e) {
    alert(e.message || "Could not mute student.");
  }
}

window.openLiveStudentsModal = openLiveStudentsModal;
window.closeLiveStudentsModal = closeLiveStudentsModal;
window.teacherAllowStudentMic = teacherAllowStudentMic;
window.teacherRevokeStudentMic = teacherRevokeStudentMic;
window.loadLiveClassStudents = function () { return loadLiveClassStudents(false); };

function visibilityLabel(v) {
  if (v === "public") return "Public";
  if (v === "private") return "Private";
  if (v === "school_group") return "School";
  return "Subject";
}

function onHostVisibilityChange() {
  var visEl = document.querySelector('input[name="host-visibility"]:checked');
  var vis = visEl ? visEl.value : "public";
  var priv = document.getElementById("host-private-wrap");
  var school = document.getElementById("host-school-wrap");
  if (priv) priv.classList.toggle("hidden", vis !== "private");
  if (school) school.classList.toggle("hidden", vis !== "school_group");
  document.querySelectorAll(".host-vis-option").forEach(function (opt) {
    var input = opt.querySelector('input[name="host-visibility"]');
    opt.classList.toggle("is-selected", !!(input && input.checked));
  });
}

async function loadHostStudentPickers() {
  var privSel = document.getElementById("host-invited-students");
  if (!privSel && !document.getElementById("sg-students-picker")) return;
  try {
    var rows = await teacherApi("/api/v1/live-classes/requests?status=approved");
    if (!rows || !rows.length) rows = await teacherApi("/api/v1/live-classes/requests");
    var students = (rows || []).filter(function (r) { return r.student_id; });
    var seen = {};
    var unique = students.filter(function (r) {
      if (seen[r.student_id]) return false;
      seen[r.student_id] = true;
      return true;
    });
    if (privSel) {
      privSel.innerHTML = unique.map(function (r) {
        return '<option value="' + escHtml(r.student_id) + '">' + escHtml(r.student_name || r.topic || "Student") + "</option>";
      }).join("") || '<option disabled>No assigned students yet</option>';
    }
    renderStudentChipPicker("sg-students-picker", unique, "sg-selected-count");
    renderStudentChipPicker("host-invited-picker", unique, "host-selected-count");
  } catch (e) {
    if (privSel) privSel.innerHTML = '<option disabled>Could not load students</option>';
    renderStudentChipPicker("sg-students-picker", [], "sg-selected-count");
    renderStudentChipPicker("host-invited-picker", [], "host-selected-count");
  }
  onHostVisibilityChange();
}

function getSelectedStudentIds(pickerId) {
  var el = document.getElementById(pickerId);
  if (!el) return [];
  return Array.from(el.querySelectorAll(".student-chip.selected")).map(function (c) { return c.dataset.id; });
}

function updateChipPickerCount(pickerId, countId) {
  var count = getSelectedStudentIds(pickerId).length;
  var label = document.getElementById(countId);
  if (label) label.textContent = count === 0 ? "Tap to select" : count + " selected";
}

function renderStudentChipPicker(containerId, students, countId) {
  var el = document.getElementById(containerId);
  if (!el) return;
  if (!students.length) {
    el.innerHTML =
      '<div class="student-chip-empty">' +
      '<div class="student-chip-empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-3.5 3.6-6 8-6s8 2.5 8 6"/></svg></div>' +
      "<p>No assigned students yet</p>" +
      "<small>Students appear here once admin assigns them to you.</small></div>";
    if (countId) updateChipPickerCount(containerId, countId);
    return;
  }
  el.innerHTML = students.map(function (r) {
    var name = r.student_name || r.topic || "Student";
    var initial = name.trim().charAt(0).toUpperCase() || "S";
    return (
      '<button type="button" class="student-chip" data-id="' + escHtml(r.student_id) + '" aria-pressed="false">' +
      '<span class="student-chip-avatar">' + escHtml(initial) + "</span>" +
      '<span class="student-chip-name">' + escHtml(name) + "</span>" +
      '<span class="student-chip-check" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg></span>' +
      "</button>"
    );
  }).join("");
  el.querySelectorAll(".student-chip").forEach(function (chip) {
    chip.addEventListener("click", function () {
      chip.classList.toggle("selected");
      chip.setAttribute("aria-pressed", chip.classList.contains("selected") ? "true" : "false");
      if (countId) updateChipPickerCount(containerId, countId);
    });
  });
  if (countId) updateChipPickerCount(containerId, countId);
}

async function loadSchoolGroupsForHost() {
  var sel = document.getElementById("host-school-group");
  if (!sel) return;
  try {
    var groups = await teacherApi("/api/v1/school-groups/mine") || [];
    sel.innerHTML = '<option value="">Select a group</option>' + groups.map(function (g) {
      return '<option value="' + escHtml(g.id) + '">' + escHtml(g.school_name) + " — " + escHtml(g.name) + " (" + g.member_count + ")</option>";
    }).join("");
  } catch (e) {
    sel.innerHTML = '<option value="">No groups yet</option>';
  }
}

async function renderSchoolGroupsList() {
  var el = document.getElementById("school-groups-list");
  if (!el) return;
  try {
    var groups = await teacherApi("/api/v1/school-groups/mine") || [];
    if (!groups.length) {
      el.innerHTML =
        '<div class="sg-empty-groups">' +
        '<div class="sg-empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4"/><path d="M9 9v.01M9 12v.01M9 15v.01"/></svg></div>' +
        "<p>No school groups yet</p>" +
        "<span>Create your first group above to organize class live sessions.</span></div>";
      return;
    }
    el.innerHTML = groups.map(function (g) {
      var initial = (g.name || "G").trim().charAt(0).toUpperCase();
      return (
        '<div class="sg-group-card">' +
        '<div class="sg-group-icon">' + escHtml(initial) + "</div>" +
        '<div class="sg-group-info"><strong>' + escHtml(g.name) + "</strong>" +
        '<span class="sg-group-school">' + escHtml(g.school_name) + "</span></div>" +
        '<div class="sg-group-meta"><span class="sg-member-badge">' + g.member_count + " student" + (g.member_count === 1 ? "" : "s") + "</span></div>" +
        "</div>"
      );
    }).join("");
  } catch (e) {
    el.innerHTML = "";
  }
}

async function createSchoolGroup() {
  var school = document.getElementById("sg-school").value.trim();
  var name = document.getElementById("sg-name").value.trim();
  var ids = getSelectedStudentIds("sg-students-picker");
  var errEl = document.getElementById("sg-create-error");
  if (errEl) errEl.textContent = "";
  if (!school || !name) {
    if (errEl) errEl.textContent = "Enter school name and group name.";
    return;
  }
  var btn = document.getElementById("sg-create-btn");
  if (btn) {
    btn.disabled = true;
    btn.classList.add("busy");
  }
  try {
    await teacherApi("/api/v1/school-groups/", {
      method: "POST",
      body: JSON.stringify({ school_name: school, name: name, student_ids: ids }),
    });
    document.getElementById("sg-school").value = "";
    document.getElementById("sg-name").value = "";
    document.querySelectorAll("#sg-students-picker .student-chip.selected").forEach(function (c) {
      c.classList.remove("selected");
      c.setAttribute("aria-pressed", "false");
    });
    updateChipPickerCount("sg-students-picker", "sg-selected-count");
    await loadSchoolGroupsForHost();
    await renderSchoolGroupsList();
  } catch (e) {
    if (errEl) errEl.textContent = e.message || "Could not create group.";
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.classList.remove("busy");
    }
  }
}

window.onHostVisibilityChange = onHostVisibilityChange;
window.createSchoolGroup = createSchoolGroup;

async function loadTeacherLive() {
  var el = document.getElementById("live-table");
  if (!el) return;
  el.innerHTML = '<div class="loading">Loading…</div>';
  try {
    var status = document.getElementById("live-filter").value;
    var url = "/api/v1/live-classes/?limit=50";
    if (status) url += "&status=" + status;
    var rows = await teacherApi(url);
    if (!rows || !rows.length) {
      el.innerHTML = '<div class="empty-state">No classes yet. Schedule or go live above.</div>';
      return;
    }
    el.innerHTML = '<table class="data-table"><thead><tr><th>Title</th><th>Code</th><th>Type</th><th>Subject</th><th>Schedule</th><th>Status</th><th></th></tr></thead><tbody>' +
      rows.map(function (c) {
        var badge = c.is_live ? '<span class="badge live">LIVE</span>' : '<span class="badge muted">Scheduled</span>';
        var vis = '<span class="badge">' + visibilityLabel(c.visibility) + "</span>";
        var codeCell = c.join_code ? '<code class="join-code">' + escHtml(c.join_code) + "</code>" : "—";
        var actions = "";
        if (c.is_live) {
          actions += '<button type="button" class="btn-sm" data-action="enter" data-id="' + escHtml(c.id) + '" data-title="' + escHtml(c.title) + '" data-subject="' + escHtml(c.subject) + '" data-end="' + escHtml(c.end_time || "") + '">Enter</button> ';
          actions += '<button type="button" class="btn-sm primary" data-action="mics" data-id="' + escHtml(c.id) + '" data-title="' + escHtml(c.title) + '">Students</button> ';
          actions += '<button type="button" class="btn-sm danger" data-action="end" data-id="' + escHtml(c.id) + '">End</button>';
        } else {
          actions += '<button type="button" class="btn-sm" data-action="start" data-id="' + escHtml(c.id) + '">Start</button> ';
          actions += '<button type="button" class="btn-sm" data-action="enter" data-id="' + escHtml(c.id) + '" data-title="' + escHtml(c.title) + '" data-subject="' + escHtml(c.subject) + '" data-end="' + escHtml(c.end_time || "") + '">Enter</button>';
        }
        return "<tr><td>" + escHtml(c.title) + "</td><td>" + codeCell + "</td><td>" + vis + "</td><td>" + escHtml(c.subject) + "</td>" +
          "<td>" + formatDateTime(c.start_time) + "</td>" +
          "<td>" + badge + "</td><td class=\"actions\">" + actions + "</td></tr>";
      }).join("") + "</tbody></table>";
  } catch (e) {
    el.innerHTML = '<div class="empty-state">' + escHtml(e.message) + "</div>";
  }
}

async function loadTeacherStudents() {
  var el = document.getElementById("students-table");
  if (!el) return;
  el.innerHTML = '<div class="loading">Loading…</div>';
  try {
    var rows = await teacherApi("/api/v1/live-classes/requests?status=approved");
    if (!rows || !rows.length) {
      rows = await teacherApi("/api/v1/live-classes/requests");
    }
    if (!rows || !rows.length) {
      el.innerHTML = '<div class="empty-state-premium"><div class="empty-icon">&#128101;</div><h3>No students yet</h3><p>When admin assigns a student to you, they will appear here.</p></div>';
      return;
    }
    el.innerHTML = '<table class="data-table"><thead><tr><th>Student</th><th>Subject</th><th>Topic</th><th>Preferred time</th><th>Status</th><th></th></tr></thead><tbody>' +
      rows.map(function (r) {
        var status = String(r.status || "approved");
        var subj = escHtml(r.subject);
        var topic = escHtml(r.topic || r.message || "Live session");
        var hostBtn =
          '<button type="button" class="btn-sm primary" onclick="teacherHostForStudent(' +
          JSON.stringify(r.subject) + ',' + JSON.stringify(r.topic || r.message || "Live session") + ')">Host class</button>';
        return "<tr><td>" + escHtml(r.student_name || "Student") + "</td><td>" + subj + "</td>" +
          "<td>" + topic + "</td><td>" + formatDateTime(r.preferred_time || r.created_at) + "</td>" +
          '<td><span class="badge approved">' + escHtml(status) + "</span></td>" +
          '<td class="actions">' + hostBtn + "</td></tr>";
      }).join("") + "</tbody></table>";
  } catch (e) {
    el.innerHTML = '<div class="empty-state-premium"><div class="empty-icon">&#9888;</div><h3>Could not load students</h3><p>' + escHtml(e.message) + '</p><button type="button" class="btn-action" id="students-retry-btn">Try again</button></div>';
    var retry = document.getElementById("students-retry-btn");
    if (retry) retry.addEventListener("click", loadTeacherStudents);
  }
}

function teacherHostForStudent(subject, topic) {
  showTeacherPage("live");
  var subEl = document.getElementById("host-subject");
  var titleEl = document.getElementById("host-title");
  if (subEl && subject) subEl.value = subject;
  if (titleEl && topic) titleEl.value = topic;
  var liveSection = document.getElementById("page-live");
  if (liveSection) liveSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

function materialTypeIcon(type) {
  if (type === "pdf") return "&#128196;";
  if (type === "doc") return "&#128221;";
  if (type === "image") return "&#128247;";
  if (type === "video") return "&#127909;";
  return "&#128279;";
}

function materialTypeLabel(type) {
  if (type === "pdf") return "PDF";
  if (type === "doc") return "Document";
  if (type === "image") return "Image";
  if (type === "video") return "Video";
  return "Link";
}

function getLocalMaterials() {
  try {
    return JSON.parse(localStorage.getItem("sia_teacher_materials_v1") || "[]");
  } catch (e) {
    return [];
  }
}

function setLocalMaterials(list) {
  localStorage.setItem("sia_teacher_materials_v1", JSON.stringify(list));
}

function getTeacherSubjects() {
  var user = getTeacherUser();
  return Array.isArray(user.subjects) && user.subjects.length ? user.subjects : ["Mathematics", "Physics", "Chemistry"];
}

function populateSubjectFilters() {
  var subjects = getTeacherSubjects();
  var filter = document.getElementById("materials-subject-filter");
  var datalist = document.getElementById("mat-subject-list");
  if (filter) {
    var current = filter.value;
    filter.innerHTML = '<option value="">All subjects</option>' +
      subjects.map(function (s) { return '<option value="' + escHtml(s) + '">' + escHtml(s) + "</option>"; }).join("");
    if (current) filter.value = current;
  }
  if (datalist) {
    datalist.innerHTML = subjects.map(function (s) { return '<option value="' + escHtml(s) + '">'; }).join("");
  }
  var matSub = document.getElementById("mat-subject");
  if (matSub && !matSub.value && subjects[0]) matSub.value = subjects[0];
}

function toggleMaterialPrice() {
  var access = (document.getElementById("mat-access") || {}).value || "free";
  var wrap = document.querySelector(".mat-price-wrap");
  if (wrap) wrap.classList.toggle("hidden", access !== "paid");
}

function openMaterialModal() {
  document.getElementById("mat-error").textContent = "";
  document.getElementById("mat-title").value = "";
  document.getElementById("mat-desc").value = "";
  document.getElementById("mat-file").value = "";
  document.getElementById("mat-url").value = "";
  var access = document.getElementById("mat-access");
  if (access) access.value = "free";
  var price = document.getElementById("mat-price");
  if (price) price.value = "500";
  populateSubjectFilters();
  toggleMaterialInputs();
  toggleMaterialPrice();
  document.getElementById("material-modal").classList.remove("hidden");
}

function closeMaterialModal() {
  document.getElementById("material-modal").classList.add("hidden");
}

function toggleMaterialInputs() {
  var type = document.getElementById("mat-type").value;
  var isLink = type === "link" || type === "video";
  document.querySelector(".mat-file-wrap").classList.toggle("hidden", isLink);
  document.querySelector(".mat-link-wrap").classList.toggle("hidden", !isLink);
}

async function saveTeacherMaterial() {
  var err = document.getElementById("mat-error");
  var btn = document.getElementById("mat-save-btn");
  err.textContent = "";
  var title = document.getElementById("mat-title").value.trim();
  var subject = document.getElementById("mat-subject").value.trim();
  var type = document.getElementById("mat-type").value;
  var desc = document.getElementById("mat-desc").value.trim();
  var access = (document.getElementById("mat-access") || {}).value || "free";
  var isFree = access !== "paid";
  var price = parseFloat((document.getElementById("mat-price") || {}).value) || 0;
  if (!title || !subject) {
    err.textContent = "Title and subject are required.";
    return;
  }
  if (!isFree && price < 100) {
    err.textContent = "Paid materials need a price of at least ₦100.";
    return;
  }
  var url = "";
  btn.disabled = true;
  btn.textContent = "Saving…";
  try {
    if (type === "link" || type === "video") {
      url = document.getElementById("mat-url").value.trim();
      if (!url) throw new Error("Enter a URL for this material.");
    } else {
      var fileInput = document.getElementById("mat-file");
      if (!fileInput.files || !fileInput.files[0]) throw new Error("Choose a file to upload.");
      var uploaded = await teacherApiUpload("/api/v1/community/upload", fileInput.files[0]);
      url = uploaded.file_url;
      if (uploaded.file_type === "pdf") type = "pdf";
      else if (uploaded.file_type === "doc") type = "doc";
      else if (uploaded.file_type === "image") type = "image";
    }
    await teacherApi("/api/v1/materials/", {
      method: "POST",
      body: JSON.stringify({
        title: title,
        subject: subject,
        material_type: type,
        file_url: url,
        description: desc || null,
        is_free: isFree,
        price: isFree ? 0 : price,
      }),
    });
    closeMaterialModal();
    loadTeacherMaterials();
  } catch (e) {
    err.textContent = e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = "Save material";
  }
}

async function deleteTeacherMaterial(id) {
  if (!confirm("Remove this material? Students will no longer see it.")) return;
  try {
    await teacherApi("/api/v1/materials/" + encodeURIComponent(id), { method: "DELETE" });
    loadTeacherMaterials();
  } catch (e) {
    alert(e.message);
  }
}

function openMaterialUrl(url) {
  if (!url) return;
  window.open(url, "_blank", "noopener,noreferrer");
}

async function openLibraryBook(bookId) {
  try {
    var data = await teacherApi("/api/v1/library/" + bookId + "/read");
    if (data && data.read_url) openMaterialUrl(data.read_url);
  } catch (e) {
    alert(e.message);
  }
}

async function loadTeacherMaterials() {
  var el = document.getElementById("materials-list");
  var stats = document.getElementById("materials-stats");
  if (!el) return;
  populateSubjectFilters();
  el.innerHTML = '<div class="loading">Loading materials…</div>';
  if (stats) stats.innerHTML = "";
  var subjectFilter = (document.getElementById("materials-subject-filter") || {}).value || "";
  var typeFilter = (document.getElementById("materials-type-filter") || {}).value || "";
  var local = [];
  try {
    local = await teacherApi("/api/v1/materials/mine") || [];
  } catch (e) {
    local = getLocalMaterials();
  }
  var library = [];
  try {
    library = await teacherApi("/api/v1/library/teacher") || [];
  } catch (e) {
    library = [];
  }
  var items = [];
  library.forEach(function (b) {
    items.push({
      id: "lib-" + b.id,
      title: b.title,
      subject: b.subject || "General",
      type: "pdf",
      url: "",
      description: b.description || ("By " + (b.author || "Scholaxia")),
      created_at: null,
      is_library: true,
      book_id: b.id,
      cover: b.cover_image_url,
    });
  });
  local.forEach(function (m) {
    items.push({
      id: m.id,
      title: m.title,
      subject: m.subject || "General",
      type: m.material_type || m.type || "pdf",
      url: m.file_url || m.url || "",
      description: m.description || "",
      created_at: m.created_at,
      is_free: m.is_free !== false,
      price: m.price || 0,
    });
  });
  if (subjectFilter) items = items.filter(function (m) { return (m.subject || "").toLowerCase() === subjectFilter.toLowerCase(); });
  if (typeFilter) items = items.filter(function (m) { return (m.type || m.material_type) === typeFilter; });
  if (stats) {
    stats.innerHTML =
      '<div class="stat-pill"><strong>' + items.length + "</strong> materials</div>" +
      '<div class="stat-pill"><strong>' + local.length + "</strong> yours</div>" +
      '<div class="stat-pill"><strong>' + library.length + "</strong> from library</div>";
  }
  if (!items.length) {
    el.innerHTML =
      '<div class="empty-state-premium">' +
      '<div class="empty-icon">&#128218;</div>' +
      "<h3>No materials yet</h3>" +
      "<p>Upload a PDF, worksheet or link for your students. Materials are grouped by subject.</p>" +
      '<button type="button" class="btn-action" id="materials-empty-add-btn">Add your first material</button>' +
      "</div>";
    var emptyBtn = document.getElementById("materials-empty-add-btn");
    if (emptyBtn) emptyBtn.addEventListener("click", openMaterialModal);
    return;
  }
  el.innerHTML = items.map(function (m) {
    var actions = "";
    if (m.is_library) {
      actions = '<button type="button" class="btn-sm primary" data-action="open-library" data-id="' + escHtml(m.book_id) + '">Open</button>';
    } else {
      var priceTag = m.is_free === false && m.price > 0
        ? '<span class="material-price">₦' + Number(m.price).toLocaleString("en-NG") + "</span>"
        : '<span class="material-price free">Free</span>';
      actions =
        priceTag +
        ' <button type="button" class="btn-sm primary" data-action="open-url" data-url="' + escHtml(m.url) + '">Open</button> ' +
        '<button type="button" class="btn-sm danger" data-action="delete-material" data-id="' + escHtml(m.id) + '">Delete</button>';
    }
    return (
      '<article class="material-card">' +
      (m.cover ? '<div class="material-cover" style="background-image:url(\'' + escHtml(m.cover) + '\')"></div>' : '<div class="material-icon">' + materialTypeIcon(m.type) + "</div>") +
      '<div class="material-body">' +
      '<span class="material-type">' + materialTypeLabel(m.type) + (m.is_library ? " · Library" : "") + "</span>" +
      "<h3>" + escHtml(m.title) + "</h3>" +
      '<p class="material-subject">' + escHtml(m.subject) + "</p>" +
      (m.description ? '<p class="material-desc">' + escHtml(m.description) + "</p>" : "") +
      '<div class="material-actions">' + actions + "</div>" +
      "</div></article>"
    );
  }).join("");
}

function initTeacherExamForm() {
  var subjects = getTeacherSubjects();
  var datalist = document.getElementById("texam-subject-list");
  var sub = document.getElementById("texam-subject");
  if (datalist) {
    datalist.innerHTML = subjects.map(function (s) {
      return '<option value="' + escHtml(s) + '">';
    }).join("");
  }
  if (sub && !sub.value.trim() && subjects[0]) sub.value = subjects[0];

  var start = document.getElementById("texam-start");
  var end = document.getElementById("texam-end");
  var now = new Date();
  if (start && !start.value) {
    start.value = toLocalDatetimeInput(now);
  }
  if (end && !end.value) {
    var later = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    end.value = toLocalDatetimeInput(later);
  }
}

function toLocalDatetimeInput(d) {
  var pad = function (n) { return String(n).padStart(2, "0"); };
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
    "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
}

function localDatetimeToIso(value) {
  if (!value) return new Date().toISOString();
  return new Date(value).toISOString();
}

function downloadTeacherExamTemplate() {
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

function parseTeacherExamFile(text) {
  var data = JSON.parse(text);
  var questions = Array.isArray(data) ? data : (data.questions || []);
  if (!questions.length) throw new Error("The JSON file has no questions.");
  questions.forEach(function (q, i) {
    var n = i + 1;
    if (!q.question_text) throw new Error("Question " + n + " is missing question_text.");
    if (!q.option_a || !q.option_b || !q.option_c || !q.option_d) {
      throw new Error("Question " + n + " needs options A–D.");
    }
    if (!q.correct_option) throw new Error("Question " + n + " needs correct_option (A/B/C/D).");
  });
  return {
    questions: questions,
    title: data.title,
    subject: data.subject,
    duration_minutes: data.duration_minutes,
  };
}

async function publishTeacherExam() {
  var err = document.getElementById("texam-error");
  var btn = document.getElementById("texam-publish-btn");
  if (err) err.textContent = "";
  var title = (document.getElementById("texam-title") || {}).value.trim();
  var subject = (document.getElementById("texam-subject") || {}).value.trim();
  var duration = parseInt((document.getElementById("texam-duration") || {}).value, 10) || 30;
  var startVal = (document.getElementById("texam-start") || {}).value;
  var endVal = (document.getElementById("texam-end") || {}).value;
  var fileInput = document.getElementById("texam-file");
  if (!title || !subject) {
    if (err) err.textContent = "Title and subject are required.";
    return;
  }
  if (!fileInput || !fileInput.files || !fileInput.files[0]) {
    if (err) err.textContent = "Choose a JSON questions file to upload.";
    return;
  }
  btn.disabled = true;
  btn.textContent = "Publishing…";
  try {
    var text = await fileInput.files[0].text();
    var parsed = parseTeacherExamFile(text);
    if (parsed.title && !title) title = parsed.title;
    if (parsed.subject && !subject) subject = parsed.subject;
    if (parsed.duration_minutes) duration = parsed.duration_minutes;
    await teacherApi("/api/v1/cbt/school-exams", {
      method: "POST",
      body: JSON.stringify({
        title: title,
        subject: subject,
        duration_minutes: duration,
        scheduled_start: localDatetimeToIso(startVal),
        scheduled_end: localDatetimeToIso(endVal),
        questions: parsed.questions,
        camera_required: false,
        ai_locked: true,
        block_minimize: true,
      }),
    });
    fileInput.value = "";
    var hint = document.getElementById("texam-file-hint");
    if (hint) hint.textContent = "No file chosen";
    alert("Exam published! Students were notified — they can take it under Exams.");
    loadTeacherExams();
  } catch (e) {
    if (err) err.textContent = e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = "Publish exam";
  }
}

async function loadTeacherExamResults(examId, container) {
  if (!container) return;
  container.innerHTML = '<div class="loading">Loading scores…</div>';
  try {
    var data = await teacherApi("/api/v1/cbt/school-exams/" + encodeURIComponent(examId) + "/results");
    var rows = data.results || [];
    if (!rows.length) {
      container.innerHTML = '<p class="exam-results-empty">No students have submitted this exam yet.</p>';
      return;
    }
    container.innerHTML =
      '<div class="data-table-wrap"><table class="data-table exam-scores-table"><thead><tr>' +
      "<th>Student</th><th>Score</th><th>%</th><th>Correct</th><th>Wrong</th><th>Submitted</th>" +
      "</tr></thead><tbody>" +
      rows.map(function (r) {
        return "<tr><td>" + escHtml(r.student_name) + "</td><td>" + escHtml(String(r.score)) + "</td><td>" +
          escHtml(String(Math.round(r.percentage || 0))) + "%</td><td>" + escHtml(String(r.total_correct)) +
          "</td><td>" + escHtml(String(r.total_wrong)) + "</td><td>" +
          escHtml(formatDateTime(r.submitted_at)) + "</td></tr>";
      }).join("") +
      "</tbody></table></div>";
  } catch (e) {
    container.innerHTML = '<p class="error-msg">' + escHtml(e.message) + "</p>";
  }
}

async function loadTeacherExams() {
  initTeacherExamForm();
  var el = document.getElementById("teacher-exam-list");
  if (!el) return;
  el.innerHTML = '<div class="loading">Loading exams…</div>';
  try {
    var exams = await teacherApi("/api/v1/cbt/school-exams/mine") || [];
    if (!exams.length) {
      el.innerHTML =
        '<div class="empty-state-premium">' +
        '<div class="empty-icon">&#128221;</div>' +
        "<h3>No exams yet</h3>" +
        "<p>Upload a JSON file above. Students see it in the <strong>Exams</strong> tab and get their score right after submitting.</p>" +
        "</div>";
      return;
    }
    el.innerHTML = exams.map(function (e) {
      return (
        '<article class="announce-card teacher-exam-card" data-exam-id="' + escHtml(e.id) + '">' +
        '<div class="announce-card-head">' +
        '<span class="announce-date">' + escHtml(e.subject) + " · " + escHtml(String(e.total_questions)) + " questions</span>" +
        '<span class="announce-badge">' + escHtml(String(e.duration_minutes)) + " min</span>" +
        "</div>" +
        "<h4 class=\"teacher-exam-card-title\">" + escHtml(e.title) + "</h4>" +
        '<p class="announce-body muted">' +
        (e.scheduled_start ? "Open: " + escHtml(formatDateTime(e.scheduled_start)) + " — " + escHtml(formatDateTime(e.scheduled_end)) : "Always open") +
        "</p>" +
        '<div class="material-actions">' +
        '<button type="button" class="btn-sm primary" data-exam-action="scores" data-id="' + escHtml(e.id) + '">View student scores</button>' +
        "</div>" +
        '<div class="exam-results-panel hidden" id="exam-results-' + escHtml(e.id) + '"></div>' +
        "</article>"
      );
    }).join("");

    el.querySelectorAll("[data-exam-action=scores]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.dataset.id;
        var panel = document.getElementById("exam-results-" + id);
        if (!panel) return;
        var open = panel.classList.contains("hidden");
        el.querySelectorAll(".exam-results-panel").forEach(function (p) {
          if (p !== panel) p.classList.add("hidden");
        });
        if (open) {
          panel.classList.remove("hidden");
          loadTeacherExamResults(id, panel);
        } else {
          panel.classList.add("hidden");
        }
      });
    });
  } catch (e) {
    el.innerHTML = '<div class="empty-state">' + escHtml(e.message) + "</div>";
  }
}

function setDefaultScheduleDate() {
  var d = new Date();
  var dateEl = document.getElementById("host-date");
  var startEl = document.getElementById("host-start");
  var endEl = document.getElementById("host-end");
  if (dateEl && !dateEl.value) {
    dateEl.value = d.toISOString().slice(0, 10);
  }
  if (startEl && !startEl.value) {
    startEl.value = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }
  if (endEl && !endEl.value) {
    var end = new Date(d.getTime() + 60 * 60 * 1000);
    endEl.value = String(end.getHours()).padStart(2, "0") + ":" + String(end.getMinutes()).padStart(2, "0");
  }
}

async function loadTeacherCommunity() {
  initTeacherVoiceRecorder();
  var listEl = document.getElementById("teacher-announce-list");
  if (!listEl) return;
  listEl.innerHTML = '<div class="loading">Loading…</div>';
  try {
    var channels = await teacherApi("/api/v1/community/channels");
    var ann = (channels || []).find(function (c) { return c.type === "teacher_announcement"; });
    if (!ann) {
      listEl.innerHTML = '<div class="empty-state">Announcement channel not found.</div>';
      return;
    }
    window._teacherAnnounceChannelId = ann.id;
    var posts = await teacherApi("/api/v1/community/posts?channel_id=" + encodeURIComponent(ann.id) + "&limit=30");
    if (!posts || !posts.length) {
      listEl.innerHTML =
        '<div class="empty-state-premium">' +
        '<div class="empty-icon">&#128227;</div>' +
        '<h3>No announcements yet</h3>' +
        '<p>Your messages will appear here after you send them. Students get a push notification too.</p>' +
        '</div>';
      return;
    }
    listEl.innerHTML = posts.map(function (p) {
      var media = "";
      if (p.media_url && p.media_type === "audio") {
        media = '<audio controls src="' + escHtml(p.media_url) + '" class="post-audio"></audio>';
      }
      var badge = p.media_url ? (p.content ? "Text + voice" : "Voice") : "Text";
      var body = p.content
        ? '<p class="announce-body">' + escHtml(p.content) + "</p>"
        : (media ? "" : '<p class="announce-body muted">Voice announcement</p>');
      return (
        '<article class="announce-card">' +
        '<div class="announce-card-head">' +
        '<span class="announce-date">' + escHtml(formatDateTime(p.created_at)) + "</span>" +
        '<span class="announce-badge">' + escHtml(badge) + "</span>" +
        "</div>" +
        body +
        media +
        "</article>"
      );
    }).join("");
  } catch (e) {
    listEl.innerHTML = '<div class="empty-state">' + escHtml(e.message) + '</div>';
  }
}

async function sendTeacherAnnouncement() {
  var err = document.getElementById("teacher-announce-error");
  var input = document.getElementById("teacher-announce-input");
  if (err) err.textContent = "";
  if (teacherVoiceRecorder && teacherVoiceRecorder.isRecording()) {
    if (err) err.textContent = "Stop recording before you send.";
    return;
  }
  var text = input ? input.value.trim() : "";
  var channelId = window._teacherAnnounceChannelId;
  if (!channelId) {
    await loadTeacherCommunity();
    channelId = window._teacherAnnounceChannelId;
  }
  if (!channelId) {
    if (err) err.textContent = "Announcement channel not ready.";
    return;
  }
  try {
    var mediaUrl = null;
    var mediaType = null;
    if (teacherVoiceRecorder && teacherVoiceRecorder.hasRecording()) {
      var voiceFile = teacherVoiceRecorder.getFile();
      if (voiceFile) {
        var uploaded = await teacherApiUpload("/api/v1/community/upload", voiceFile);
        mediaUrl = uploaded.file_url;
        mediaType = uploaded.file_type || "audio";
      }
    }
    if (!text && !mediaUrl) {
      if (err) err.textContent = "Write a message or record a voice note.";
      return;
    }
    await teacherApi("/api/v1/community/posts", {
      method: "POST",
      body: JSON.stringify({
        channel_id: channelId,
        content: text || "Voice announcement",
        media_url: mediaUrl,
        media_type: mediaType,
        visibility: "everyone",
      }),
    });
    if (input) input.value = "";
    if (teacherVoiceRecorder) teacherVoiceRecorder.cancel();
    loadTeacherCommunity();
    alert("Announcement sent — all students were notified.");
  } catch (e) {
    if (err) err.textContent = e.message;
  }
}

function initTeacherAI() {
  var subjects = getTeacherSubjects();
  var datalist = document.getElementById("teacher-ai-subject-list");
  var subjectInput = document.getElementById("teacher-ai-subject");
  if (datalist) {
    datalist.innerHTML = subjects.map(function (s) {
      return '<option value="' + escHtml(s) + '">';
    }).join("");
  }
  if (subjectInput && !subjectInput.value.trim() && subjects[0]) {
    subjectInput.value = subjects[0];
  }
  var levelInput = document.getElementById("teacher-ai-level");
  if (levelInput && !levelInput.value.trim()) {
    levelInput.value = "SS2";
  }
}

function applyTeacherAIPrompt(chip) {
  if (!chip) return;
  var task = document.getElementById("teacher-ai-task");
  var details = document.getElementById("teacher-ai-details");
  if (task && chip.dataset.task) task.value = chip.dataset.task;
  if (details && chip.dataset.prompt) details.value = chip.dataset.prompt;
  if (details) details.focus();
}

async function askTeacherAI() {
  var err = document.getElementById("teacher-ai-error");
  var out = document.getElementById("teacher-ai-result");
  var wrap = document.getElementById("teacher-ai-result-wrap");
  var btn = document.getElementById("teacher-ai-ask");
  if (err) err.textContent = "";
  var task = document.getElementById("teacher-ai-task").value;
  var subject = document.getElementById("teacher-ai-subject").value.trim();
  var level = document.getElementById("teacher-ai-level").value.trim();
  var details = document.getElementById("teacher-ai-details").value.trim();
  if (!subject || !details) {
    if (err) err.textContent = "Subject and details are required.";
    return;
  }
  if (wrap) wrap.classList.remove("hidden");
  if (out) {
    out.classList.remove("loading");
    out.textContent = "";
    out.innerHTML =
      '<span class="sia-typing-dots ai-inline-typing" aria-label="Tutor AI is typing">' +
      "<span></span><span></span><span></span></span>";
  }
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Working…";
  }
  try {
    var res = await teacherApi("/api/v1/teacher-ai/ask", {
      method: "POST",
      body: JSON.stringify({
        task: task,
        subject: subject,
        education_level: level || "SS2",
        details: details,
      }),
    });
    if (out) {
      out.classList.remove("loading");
      out.textContent = res.result || "No response.";
    }
    // Show the TOP of the result — reading flows down instead of landing at
    // the bottom of a long answer.
    if (wrap) wrap.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    if (err) err.textContent = e.message;
    if (wrap) wrap.classList.add("hidden");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Ask Teacher AI";
    }
  }
}

function initTeacherVoiceRecorder() {
  if (teacherVoiceRecorder) return;
  teacherVoiceRecorder = createVoiceRecorder({
    buttonId: "teacher-voice-btn",
    statusId: "teacher-voice-status",
    previewId: "teacher-voice-preview",
    playbackId: "teacher-voice-playback",
    deleteButtonId: "teacher-voice-delete",
    idleLabel: "🎤 Tap to record voice",
    onError: function (e) {
      var errEl = document.getElementById("teacher-announce-error");
      if (errEl) errEl.textContent = e.message || "Could not access microphone.";
    },
  });
}

function bindTeacherUI() {
  if (window._teacherUIBound) return;
  window._teacherUIBound = true;

  var loginForm = document.getElementById("teacher-login-form");
  if (loginForm) loginForm.addEventListener("submit", teacherLogin);

  var pwToggle = document.getElementById("teacher-pw-toggle");
  var pwInput = document.getElementById("teacher-login-password");
  if (pwToggle && pwInput) {
    pwToggle.addEventListener("click", function () {
      var show = pwInput.type === "password";
      pwInput.type = show ? "text" : "password";
      pwToggle.textContent = show ? "Hide" : "Show";
    });
  }

  var logoutBtn = document.getElementById("teacher-logout-btn");
  if (logoutBtn) logoutBtn.addEventListener("click", teacherLogout);

  document.querySelectorAll("#teacher-topnav .topnav-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (btn.dataset.page) showTeacherPage(btn.dataset.page);
    });
  });

  var scheduleBtn = document.getElementById("host-schedule-btn");
  if (scheduleBtn) scheduleBtn.addEventListener("click", function () { teacherHostClass(false); });
  var liveBtn = document.getElementById("host-live-btn");
  if (liveBtn) liveBtn.addEventListener("click", function () { teacherHostClass(true); });
  var liveFilter = document.getElementById("live-filter");
  if (liveFilter) liveFilter.addEventListener("change", loadTeacherLive);
  var liveRefresh = document.getElementById("live-refresh-btn");
  if (liveRefresh) liveRefresh.addEventListener("click", loadTeacherLive);

  var liveTable = document.getElementById("live-table");
  if (liveTable) {
    liveTable.addEventListener("click", function (ev) {
      var btn = ev.target.closest("[data-action]");
      if (!btn) return;
      var id = btn.dataset.id;
      if (btn.dataset.action === "start") teacherStartClass(id);
      else if (btn.dataset.action === "end") teacherEndClass(id);
      else if (btn.dataset.action === "enter") {
        teacherEnterClassroom(id, btn.dataset.title, btn.dataset.subject, btn.dataset.end)
          .catch(function () { /* alert already shown by the function */ });
      } else if (btn.dataset.action === "mics") {
        openLiveStudentsModal(id, btn.dataset.title);
      }
    });
  }

  var openMatBtn = document.getElementById("open-material-modal-btn");
  if (openMatBtn) openMatBtn.addEventListener("click", openMaterialModal);
  var matRefresh = document.getElementById("materials-refresh-btn");
  if (matRefresh) matRefresh.addEventListener("click", loadTeacherMaterials);
  var subFilter = document.getElementById("materials-subject-filter");
  if (subFilter) subFilter.addEventListener("change", loadTeacherMaterials);
  var typeFilter = document.getElementById("materials-type-filter");
  if (typeFilter) typeFilter.addEventListener("change", loadTeacherMaterials);

  var matList = document.getElementById("materials-list");
  if (matList) {
    matList.addEventListener("click", function (ev) {
      var btn = ev.target.closest("[data-action]");
      if (!btn) return;
      if (btn.dataset.action === "open-library") openLibraryBook(btn.dataset.id);
      else if (btn.dataset.action === "open-url") openMaterialUrl(btn.dataset.url);
      else if (btn.dataset.action === "delete-material") deleteTeacherMaterial(btn.dataset.id);
    });
  }

  var matModal = document.getElementById("material-modal");
  if (matModal) {
    matModal.addEventListener("click", function (ev) {
      if (ev.target === matModal) closeMaterialModal();
    });
  }
  var matClose = document.getElementById("material-modal-close");
  if (matClose) matClose.addEventListener("click", closeMaterialModal);
  var matCancel = document.getElementById("material-modal-cancel");
  if (matCancel) matCancel.addEventListener("click", closeMaterialModal);
  var matSave = document.getElementById("mat-save-btn");
  if (matSave) matSave.addEventListener("click", saveTeacherMaterial);
  var matType = document.getElementById("mat-type");
  if (matType) matType.addEventListener("change", toggleMaterialInputs);

  var texamFile = document.getElementById("texam-file");
  if (texamFile) {
    texamFile.addEventListener("change", function () {
      var hint = document.getElementById("texam-file-hint");
      if (hint) hint.textContent = texamFile.files && texamFile.files[0] ? texamFile.files[0].name : "No file chosen";
    });
  }
  var texamTemplate = document.getElementById("texam-download-template");
  if (texamTemplate) texamTemplate.addEventListener("click", downloadTeacherExamTemplate);
  var texamPublish = document.getElementById("texam-publish-btn");
  if (texamPublish) texamPublish.addEventListener("click", publishTeacherExam);
  var studentsRefresh = document.getElementById("students-refresh-btn");
  if (studentsRefresh) studentsRefresh.addEventListener("click", loadTeacherStudents);

  var announceSend = document.getElementById("teacher-announce-send");
  if (announceSend) announceSend.addEventListener("click", sendTeacherAnnouncement);
  var aiAsk = document.getElementById("teacher-ai-ask");
  if (aiAsk) aiAsk.addEventListener("click", askTeacherAI);
  document.querySelectorAll(".ai-prompt-chip").forEach(function (chip) {
    chip.addEventListener("click", function () { applyTeacherAIPrompt(chip); });
  });
}

window.teacherLogin = teacherLogin;
window.teacherLogout = teacherLogout;
window.showTeacherPage = showTeacherPage;
window.loadTeacherLive = loadTeacherLive;
window.loadTeacherMaterials = loadTeacherMaterials;
window.loadTeacherStudents = loadTeacherStudents;
window.teacherHostForStudent = teacherHostForStudent;
window.openMaterialModal = openMaterialModal;
window.closeMaterialModal = closeMaterialModal;
window.toggleMaterialInputs = toggleMaterialInputs;
window.toggleMaterialPrice = toggleMaterialPrice;
window.saveTeacherMaterial = saveTeacherMaterial;
window.deleteTeacherMaterial = deleteTeacherMaterial;
window.openMaterialUrl = openMaterialUrl;
window.openLibraryBook = openLibraryBook;
window.loadTeacherExams = loadTeacherExams;
window.publishTeacherExam = publishTeacherExam;
window.teacherHostClass = teacherHostClass;
window.teacherStartClass = teacherStartClass;
window.teacherEndClass = teacherEndClass;
window.teacherEnterClassroom = teacherEnterClassroom;

document.addEventListener("DOMContentLoaded", function () {
  bindTeacherUI();
  setDefaultScheduleDate();
  // The plugNmeet live-class window closed (meeting ended / teacher closed
  // it): refresh the Live page so the class list and status are current.
  if (window.scholaxiaDesktop && typeof window.scholaxiaDesktop.onPnmRoomClosed === "function") {
    window.scholaxiaDesktop.onPnmRoomClosed(function () {
      try { if (typeof loadTeacherLive === "function") loadTeacherLive(); } catch (e) { /* ignore */ }
    });
  }
});
