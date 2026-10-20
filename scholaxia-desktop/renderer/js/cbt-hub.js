/** CBT Practice hub — exam-type packages (JAMB / WAEC / NECO / Junior WAEC) via practice attempts. */

var cbtHubState = {
  home: null,
  view: "types", // types | board
  board: null,
  jambPicked: {},
  busy: false,
};

var DEFAULT_JAMB_SUBJECTS = [
  "Use of English", "Mathematics", "Physics", "Chemistry", "Biology",
  "Economics", "Government", "Literature in English", "Geography",
  "Christian Religious Studies", "Islamic Religious Studies", "Commerce", "Accounting",
];
var DEFAULT_SSCE_SUBJECTS = [
  "English Language", "Mathematics", "Biology", "Chemistry", "Physics",
  "Economics", "Government", "Literature in English", "Geography",
  "Agricultural Science", "Further Mathematics", "Commerce", "Financial Accounting",
];
var DEFAULT_JUNIOR_SUBJECTS = [
  "English Studies", "Mathematics", "Basic Science", "Basic Technology",
  "Social Studies", "Business Studies", "Civic Education",
  "Computer Studies/ICT", "Agricultural Science",
];

var CBT_BOARD_LABELS = {
  JAMB: "JAMB",
  WAEC: "WAEC",
  NECO: "NECO",
  JUNIOR_WAEC: "Junior WAEC",
  COMMON_ENTRANCE: "Common Entrance",
};

function cbtBoardLabel(board) {
  return CBT_BOARD_LABELS[board] || board || "CBT";
}

function cbtEsc(s) {
  var d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
}

function cbtAttemptToPack(attempt) {
  var allQuestions = [];
  var sections = [];
  (attempt.sections || []).forEach(function (sec) {
    var start = allQuestions.length;
    // Light payloads ship section stubs (no questions). Pad with placeholders so
    // flat question indices stay aligned with each section's start.
    var total = parseInt(sec.total || (sec.questions || []).length || 0, 10) || 0;
    (sec.questions || []).forEach(function (q) {
      var row = {
        id: q.id,
        question_text: q.question_text || q.text || "",
        topic: q.topic,
        image_url: q.image_url,
      };
      (q.options || []).forEach(function (opt) {
        var k = String(opt.key || "").toUpperCase();
        if (k) row["option_" + k.toLowerCase()] = opt.text || "";
      });
      allQuestions.push(row);
    });
    for (var i = (sec.questions || []).length; i < total; i++) allQuestions.push(null);
    sections.push({
      subject: sec.subject || "Subject",
      start: start,
      count: total,
      completed: !!sec.completed,
    });
  });
  return {
    title: cbtBoardLabel(attempt.exam_type) + " Practice",
    subject: (attempt.subjects || []).join(" · "),
    duration_minutes: attempt.duration_minutes || 60,
    questions: allQuestions,
    sections: sections,
    practice_attempt_id: attempt.attempt_id,
    exam_type: attempt.exam_type,
    seconds_left: attempt.seconds_left,
    answers: attempt.answers || {},
    section_index: attempt.section_index || 0,
  };
}

async function loadCbtHubPage() {
  var grid = document.getElementById("cbt-grid");
  var tabsEl = document.getElementById("cbt-hub-tabs");
  var subjEl = document.getElementById("cbt-hub-subjects");
  if (!grid) return;
  if (typeof isCbtExamActive === "function" && isCbtExamActive()) return;
  if (typeof showCbtListView === "function") showCbtListView();
  if (tabsEl) {
    tabsEl.innerHTML = "";
    tabsEl.classList.add("hidden");
  }
  if (subjEl) {
    subjEl.innerHTML = "";
    subjEl.classList.add("hidden");
  }
  grid.innerHTML = '<div class="loading">Loading CBT practice…</div>';
  cbtHubState.view = "types";
  cbtHubState.board = null;
  try {
    var data = await api("/api/v1/cbt/practice/home");
    cbtHubState.home = data || {};
    cbtHubState.offlineMode = false;
    try { localStorage.setItem("sia_cbt_hub_home", JSON.stringify(data || {})); } catch (eCache) {}
    renderCbtHub();
  } catch (e) {
    // Offline (or server unreachable): never leave the screen empty. Reuse the
    // last cached board list so the hub stays active without data.
    var cachedHome = null;
    try { cachedHome = JSON.parse(localStorage.getItem("sia_cbt_hub_home") || "null"); } catch (eParse) { cachedHome = null; }
    if (cachedHome && cachedHome.exam_types && cachedHome.exam_types.length) {
      cbtHubState.home = cachedHome;
      cbtHubState.offlineMode = true;
      renderCbtHub();
    } else {
      renderCbtHubOffline(e);
    }
  }
}

function cbtHubDownloadedPacks() {
  var out = [];
  try {
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (!key || key.indexOf("sia_cbt_pack_") !== 0) continue;
      var pack = null;
      try { pack = JSON.parse(localStorage.getItem(key)); } catch (e2) { pack = null; }
      var exam = pack && (pack.exam || pack);
      var qs = (exam && exam.questions) || pack && pack.questions || [];
      if (pack && qs && qs.length) {
        out.push({
          examId: pack.examId || key.replace("sia_cbt_pack_", "").replace(/_[^_]*$/, ""),
          year: pack.year || "",
          title: (exam && exam.title) || "Downloaded exam",
          subject: (exam && exam.subject) || "",
          count: qs.length,
          cachedAt: pack.cached_at || 0,
        });
      }
    }
  } catch (e3) { /* ignore */ }
  return out.sort(function (a, b) { return (b.cachedAt || 0) - (a.cachedAt || 0); });
}

/* Downloaded exams strip — shows on the hub so offline practice is obvious. */
function renderCbtHubDownloadedHtml() {
  var packs = cbtHubDownloadedPacks();
  if (!packs.length) return "";
  var html = '<div class="cbt-hub-note" style="margin-top:10px"><strong>Ready offline</strong> — downloaded exams you can practice without data:</div>';
  html += '<div class="cbt-subject-grid" style="margin-bottom:18px">';
  html += packs
    .map(function (p) {
      return (
        '<div class="cbt-type-card cbt-type-subject" onclick="startOfflinePack(\'' +
        cbtEsc(p.examId).replace(/'/g, "\\'") + "','" +
        cbtEsc(p.year).replace(/'/g, "\\'") +
        "')\">" +
        '<div class="cbt-type-icon">&#11014;</div>' +
        '<div class="cbt-type-body"><h3>' + cbtEsc(p.title) + "</h3>" +
        '<p class="cbt-type-sub">' + cbtEsc(p.subject || "Downloaded") + " · " + p.count + " questions</p></div>" +
        '<span class="cbt-type-arrow">&#9654;</span></div>'
      );
    })
    .join("");
  html += "</div>";
  return html;
}

function renderCbtHubOffline(err) {
  var grid = document.getElementById("cbt-grid");
  if (!grid) return;
  var offline = typeof navigator !== "undefined" && !navigator.onLine;
  var packs = cbtHubDownloadedPacks();
  var html = '<div class="cbt-hub-wrap">';
  html +=
    '<div class="empty-state-premium"><h3>' +
    (offline ? "You are offline" : "Could not load CBT") +
    "</h3><p>" +
    cbtEsc((err && err.message) || "") +
    "</p>";
  if (packs.length) {
    html += "<p><strong>You have " + packs.length + " downloaded exam(s) — practice them without data:</strong></p></div>";
    html += '<div class="cbt-subject-grid">';
    html += packs
      .map(function (p) {
        return (
          '<div class="cbt-type-card cbt-type-subject" onclick="startOfflinePack(\'' +
          cbtEsc(p.examId).replace(/'/g, "\\'") + "','" +
          cbtEsc(p.year).replace(/'/g, "\\'") +
          "')\">" +
          '<div class="cbt-type-icon">&#11014;</div>' +
          '<div class="cbt-type-body"><h3>' + cbtEsc(p.title) + "</h3>" +
          '<p class="cbt-type-sub">' + cbtEsc(p.subject || "Downloaded") + " · " + p.count + " questions · ready offline</p></div>" +
          '<span class="cbt-type-arrow">&#9654;</span></div>'
        );
      })
      .join("");
    html += "</div>";
  } else {
    html +=
      "</div><p class=\"cbt-hub-note\">Connect once with data and tap a year on any exam — Scholaxia saves it, then you can practice it offline anytime.</p>";
  }
  html += '</div>';
  grid.innerHTML = html;
}

async function startOfflinePack(examId, year) {
  try {
    if (typeof launchPortalExamFromCache === "function") {
      await launchPortalExamFromCache(examId, year);
      return;
    }
    throw new Error("Offline exam player unavailable.");
  } catch (e) {
    alert((e && e.message) || "Could not open the downloaded exam.");
  }
}
window.startOfflinePack = startOfflinePack;

function exitPracticeExam() {
  if (
    !currentSession ||
    !currentSession.is_practice ||
    !confirm("Leave this practice exam? Your answers so far are kept and you can resume when the teacher's timer allows.")
  ) {
    return;
  }
  stopCbtTimer();
  hideSubjectStartPicker();
  setExamLockMode(false);
  try {
    if (currentSession && currentSession.practice_attempt_id && Object.keys(answers || {}).length) {
      var map = {};
      (currentExam.questions || []).forEach(function (q, i) {
        if (q && answers[i]) map[q.id] = answers[i];
      });
      api("/api/v1/cbt/practice/attempts/" + currentSession.practice_attempt_id + "/answers", {
        method: "POST",
        body: JSON.stringify({ answers: map }),
      }).catch(function () {});
    }
  } catch (e) { /* best effort */ }
  currentExam = null;
  currentSession = null;
  answers = {};
  showCbtListView();
  if (typeof loadCbtHubPage === "function") loadCbtHubPage();
}
window.exitPracticeExam = exitPracticeExam;

function renderCbtHub() {
  var grid = document.getElementById("cbt-grid");
  if (!grid) return;
  var home = cbtHubState.home || {};
  var settings = home.settings || {};
  var offlineBanner = cbtHubState.offlineMode
    ? '<div class="cbt-hub-note" style="border:1px solid #f59e0b;background:rgba(245,158,11,.12);border-radius:10px;padding:10px 14px;margin-bottom:12px">&#9888; <strong>Offline mode</strong> — starting a new CBT needs data, but your downloaded exams below work without it.</div>'
    : "";
  if (settings.cbt_enabled === false && !cbtHubState.offlineMode) {
    grid.innerHTML = '<div class="empty-state-premium"><h3>CBT disabled</h3><p>Admin has turned off CBT practice.</p></div>';
    return;
  }
  if (cbtHubState.view === "board" && cbtHubState.board) {
    renderCbtBoard(grid);
    return;
  }
  var types = home.exam_types || [];
  if (!types.length) {
    grid.innerHTML = '<div class="empty-state-premium"><h3>No exam types</h3><p>CBT is not configured yet.</p></div>';
    return;
  }
  grid.innerHTML = '<div class="cbt-hub-wrap">' +
    offlineBanner +
    '<p class="cbt-hub-note">Choose <strong>JAMB</strong>, <strong>WAEC</strong>, <strong>NECO</strong>, or <strong>Junior WAEC</strong>. Question counts and timers come from admin CBT Settings.</p>' +
    renderCbtHubDownloadedHtml() +
    '<div class="cbt-type-grid">' +
    types
      .map(function (t) {
        var locked = !t.has_access;
        var logo =
          t.exam_type === "JAMB" ? "img/jamb-logo.svg"
          : t.exam_type === "WAEC" ? "img/waec-logo.svg"
          : t.exam_type === "NECO" ? "img/neco-logo.svg"
          : "";
        var accent =
          t.exam_type === "JAMB" ? "cbt-type-jamb"
          : t.exam_type === "WAEC" ? "cbt-type-waec"
          : t.exam_type === "NECO" ? "cbt-type-neco"
          : "cbt-type-junior";
        var label = cbtBoardLabel(t.exam_type);
        var logoHtml = logo
          ? '<img src="' + logo + '" alt="' + cbtEsc(label) + '" onerror="this.style.display=\'none\';this.parentNode.classList.add(\'cbt-logo-fallback\');this.parentNode.innerHTML=\'&#127979;\'" />'
          : '&#127979;';
        return (
          '<div class="cbt-type-card ' + accent + '" onclick="cbtHubOpenBoard(\'' +
          cbtEsc(t.exam_type) +
          "')\">" +
          '<div class="cbt-type-logo">' + logoHtml + "</div>" +
          '<div class="cbt-type-body">' +
          "<h3>" + cbtEsc(label) + "</h3>" +
          '<p class="cbt-type-sub">' +
          (t.exam_type === "JAMB"
            ? "Combined package · pick " + (settings.jamb_subjects_required || 4) + " subjects"
            : t.exam_type === "JUNIOR_WAEC"
            ? "BECE practice · pick your 9 subjects"
            : "Subject practice from your registered list") +
          "</p>" +
          '<span class="cbt-type-badge ' + (locked ? "is-locked" : "is-open") + '">' +
          (locked ? "&#128274; Locked — pay or coupon" : "&#128275; Unlocked") +
          "</span>" +
          "</div>" +
          '<span class="cbt-type-arrow">&#8594;</span>' +
          "</div>"
        );
      })
      .join("") +
    "</div></div>";
}

function cbtHubOpenBoard(board) {
  cbtHubState.board = board;
  cbtHubState.view = "board";
  // Prefill JAMB picks from the student's saved subject combination so they
  // don't re-tick 4 subjects every time (START still validates the count).
  if (board === "JAMB") {
    cbtHubState.jambPicked = {};
    var home = cbtHubState.home || {};
    var saved = (home.profile && home.profile.jamb_subjects) || [];
    saved.forEach(function (s) {
      cbtHubState.jambPicked[s] = true;
    });
  } else {
    cbtHubState.jambPicked = {};
  }
  renderCbtHub();
}

function renderCbtBoard(grid) {
  var board = cbtHubState.board;
  var home = cbtHubState.home || {};
  var settings = home.settings || {};
  var profile = home.profile || {};
  var info = (home.exam_types || []).find(function (t) {
    return t.exam_type === board;
  }) || { has_access: false };

  var html = '<div class="cbt-hub-wrap">' +
    (cbtHubState.offlineMode
      ? '<div class="cbt-hub-note" style="border:1px solid #f59e0b;background:rgba(245,158,11,.12);border-radius:10px;padding:10px 14px;margin-bottom:12px">&#9888; <strong>Offline mode</strong> — starting needs data. Reconnect and tap Refresh.</div>'
      : "") +
    '<p class="cbt-hub-note"><button type="button" class="btn-secondary btn-sm" onclick="loadCbtHubPage()">← Exam types</button></p>' +
    "<h3 style=\"margin:8px 0\">" +
    cbtEsc(cbtBoardLabel(board)) +
    " CBT</h3>";

  if (!info.has_access) {
    html +=
      '<div class="empty-state-premium"><h3>Package required</h3><p>Unlock ' +
      cbtEsc(cbtBoardLabel(board)) +
      " with Paystack or a coupon.</p>" +
      '<button type="button" class="btn-join" onclick="cbtHubUnlockBoard()">Unlock ' +
      cbtEsc(cbtBoardLabel(board)) +
      "</button></div>";
    grid.innerHTML = html;
    return;
  }

  if (board === "JAMB") {
    var need = settings.jamb_subjects_required || 4;
    var jambSubs =
      profile.jamb_subjects && profile.jamb_subjects.length
        ? profile.jamb_subjects
        : DEFAULT_JAMB_SUBJECTS;
    var pickedCount = Object.keys(cbtHubState.jambPicked).length;
    html +=
      '<p class="cbt-hub-note">Select exactly <strong>' +
      need +
      "</strong> subjects, then START CBT. Subjects run as separate sections in one exam.</p>";
    html += '<div class="cbt-subject-grid">';
    html += jambSubs
      .map(function (s) {
        var on = !!cbtHubState.jambPicked[s];
        return (
          '<button type="button" class="cbt-subject-chip' + (on ? " is-on" : "") +
          '" onclick="cbtHubToggleJamb(\'' +
          cbtEsc(s).replace(/'/g, "\\'") +
          "')\"><span class='cbt-chip-check'>" + (on ? "&#10003;" : "") + "</span>" +
          cbtEsc(s) +
          "</button>"
        );
      })
      .join("");
    html += "</div>";
    html +=
      '<div class="cbt-start-bar"><span id="cbt-jamb-count" class="cbt-start-count">' +
      pickedCount + " / " + need + " selected</span>" +
      '<button type="button" class="btn-join" onclick="cbtHubStartJambPractice()">START CBT &#8594;</button></div>';
    grid.innerHTML = html;
    return;
  }

  var registered =
    board === "JUNIOR_WAEC"
      ? (profile.junior_subjects && profile.junior_subjects.length
          ? profile.junior_subjects
          : DEFAULT_JUNIOR_SUBJECTS)
      : (profile.ssce_subjects && profile.ssce_subjects.length
          ? profile.ssce_subjects
          : DEFAULT_SSCE_SUBJECTS);
  var ssceStarted = board === "JUNIOR_WAEC" ? !!profile.junior_started : !!profile.ssce_started;
  var isRegistered = ssceStarted && registered && registered.length;

  if (!isRegistered) {
    // First-time WAEC/NECO/Junior WAEC: pick your own subjects (up to 9). Locks on first start.
    var picked = (cbtHubState.sscePicked = cbtHubState.sscePicked || []).slice();
    var allChoices = registered
      .concat(board === "JUNIOR_WAEC" ? DEFAULT_JUNIOR_SUBJECTS : DEFAULT_SSCE_SUBJECTS)
      .filter(function (s, i, a) {
        return a.indexOf(s) === i;
      });
    html +=
      '<p class="cbt-hub-note">Select your subjects (up to 9), then CONTINUE to save them. They lock after that — changes then need admin approval.</p>';
    html += '<div class="cbt-subject-grid">';
    html += allChoices
      .map(function (s) {
        var on = picked.indexOf(s) >= 0;
        return (
          '<button type="button" class="cbt-subject-chip' + (on ? " is-on" : "") +
          '" data-ssce-pick="' + cbtEsc(s).replace(/'/g, "\\'") + "'><span class='cbt-chip-check'>" + (on ? "&#10003;" : "") + "</span>" +
          cbtEsc(s) +
          "</button>"
        );
      })
      .join("");
    html += "</div>";
    html +=
      '<div class="cbt-start-bar"><span class="cbt-start-count">' +
      picked.length + " / up to 9 selected</span>" +
      '<button type="button" class="btn-join" id="cbt-hub-ssce-start">CONTINUE &#8594;</button></div>';
    html += "</div>";
    grid.innerHTML = html;
    grid.querySelectorAll("[data-ssce-pick]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var s = btn.getAttribute("data-ssce-pick");
        var i = cbtHubState.sscePicked.indexOf(s);
        if (i >= 0) cbtHubState.sscePicked.splice(i, 1);
        else if (cbtHubState.sscePicked.length < 9) cbtHubState.sscePicked.push(s);
        else alert("Maximum 9 subjects.");
        renderCbtHub();
      });
    });
    var startBtn = document.getElementById("cbt-hub-ssce-start");
    if (startBtn) {
      startBtn.addEventListener("click", function () {
        if (!cbtHubState.sscePicked.length) {
          alert("Select at least one subject.");
          return;
        }
        cbtHubRegisterSubjects(board, cbtHubState.sscePicked.slice(), startBtn);
      });
    }
    return;
  }

  html +=
    '<p class="cbt-hub-note">Choose one subject to practice. Only your registered subjects are listed.</p>';
  html += '<div class="cbt-subject-grid">';
  html += registered
    .map(function (s) {
      return (
        '<div class="cbt-type-card cbt-type-subject" onclick="cbtHubStartSubject(\'' +
        cbtEsc(s).replace(/'/g, "\\'") +
        "')\">" +
        '<div class="cbt-type-icon">&#128221;</div>' +
        '<div class="cbt-type-body"><h3>' + cbtEsc(s) + '</h3>' +
        '<p class="cbt-type-sub">' + cbtEsc(cbtBoardLabel(board)) + " practice</p></div>" +
        '<span class="cbt-type-arrow">&#9654;</span></div>'
      );
    })
    .join("");
  html += "</div>";
  html += '</div>';
  html +=
    '<p style="margin:1rem 0 0"><button type="button" class="btn-secondary btn-sm" data-cbt-scr-board="' +
    cbtEsc(board) +
    '">Request subject change (admin approves)</button></p>';
  grid.innerHTML = html;
}

async function cbtHubRequestSubjectChange(board) {
  var home = cbtHubState.home || {};
  var profile = home.profile || {};
  var current =
    board === "JAMB"
      ? profile.jamb_subjects
      : board === "JUNIOR_WAEC"
      ? profile.junior_subjects
      : profile.ssce_subjects;
  current = current || [];
  var choices = [
    "English Language", "Mathematics", "Biology", "Chemistry", "Physics",
    "Economics", "Government", "Literature-in-English", "CRS", "IRS",
    "Agricultural Science", "Commerce", "Accounting", "Geography",
    "Civic Education", "Computer Studies", "Further Mathematics", "French",
  ];
  // Reuse the package modal layer for a lightweight inline prompt
  var chosen = window.prompt(
    "Type the subjects you want (comma-separated), e.g: Biology, Chemistry, Physics\n\nYour current subjects: " +
      (current.join(", ") || "none"),
    current.join(", ")
  );
  if (!chosen) return;
  var newSubs = chosen
    .split(",")
    .map(function (s) {
      return s.trim();
    })
    .filter(Boolean);
  if (!newSubs.length) return;
  try {
    var res = await api("/api/v1/cbt/subject-change-requests", {
      method: "POST",
      body: JSON.stringify({ board: board, new_subjects: newSubs }),
    });
    alert((res && res.message) || "Request sent to admin.");
  } catch (e) {
    alert((e && e.message) || "Could not send request.");
  }
  // keep choices referenced (future UI upgrade)
  void choices;
  void picked;
}

function cbtHubToggleJamb(subject, on) {
  if (on === undefined) on = !cbtHubState.jambPicked[subject];
  if (on) cbtHubState.jambPicked[subject] = true;
  else delete cbtHubState.jambPicked[subject];
  renderCbtHub();
}

function cbtHubUnlockBoard() {
  if (typeof openCbtUnlockModal === "function") {
    openCbtUnlockModal(function () {
      loadCbtHubPage().then(function () {
        if (cbtHubState.board) cbtHubOpenBoard(cbtHubState.board);
      });
    });
  } else if (typeof showPage === "function") {
    showPage("cbt-packages");
  }
}

async function cbtHubStartJambPractice() {
  var settings = (cbtHubState.home && cbtHubState.home.settings) || {};
  var need = settings.jamb_subjects_required || 4;
  var picked = Object.keys(cbtHubState.jambPicked || {});
  if (picked.length !== need) {
    alert("Select exactly " + need + " JAMB subjects.");
    return;
  }
  await cbtHubStartPractice("JAMB", picked);
}

async function cbtHubStartSubject(subject) {
  await cbtHubStartPractice(cbtHubState.board, [subject]);
}

/* Section loader: practice attempts ship subject stubs; questions load on demand.
   currentQ lies inside a section whose questions have not been fetched yet. */
var _cbtSectionsFetched = {};
var _cbtSectionFetchBusy = false;

function _cbtSectionForIndex(index) {
  if (!currentExam || !currentExam.sections) return null;
  return currentExam.sections.find(function (s) {
    return index >= s.start && index < s.start + (s.count || 0);
  }) || null;
}

/* ---- OFFLINE PACK: cache the running attempt + downloaded question rows so
   the hub can resume an exam with no network (questions never change). ---- */
function _cbtRowFromQuestion(q) {
  var row = {
    id: q.id,
    question_text: q.question_text || "",
    topic: q.topic,
    image_url: q.image_url,
    correct_option: q.correct_option || q.correct_key || "",
    explanation: q.explanation || "",
    subject: q.subject || "",
  };
  (q.options || []).forEach(function (opt) {
    var k = String(opt.key || "").toUpperCase();
    if (k) row["option_" + k.toLowerCase()] = opt.text || "";
  });
  return row;
}

var CBT_OFFLINE_PRACTICE_PREFIX = "sia_cbt_offline_practice_";
var _cbtOfflinePackSaveQueue = Promise.resolve();

function _cbtOfflinePackSave() {
  if (!window.__cbtOfflineAttempt || !currentExam) return Promise.resolve();
  var attempt = Object.assign({}, window.__cbtOfflineAttempt, {
    answers_by_index: Object.assign({}, answers || {}),
    offline_ready: (currentExam.questions || []).length > 0 &&
      currentExam.questions.every(function (q) {
        return !!(q && (q.correct_option || q.correct_key));
      }),
  });
  var snapshot = { attempt: attempt, rows: currentExam.questions || [] };
  var saveSnapshot = async function () {
    try {
      localStorage.setItem("sia_cbt_attempt_last", JSON.stringify(attempt));
      var key = CBT_OFFLINE_PRACTICE_PREFIX + attempt.attempt_id;
      if (typeof ssSet === "function") {
        await ssSet(key, snapshot);
      } else {
        localStorage.setItem(key, JSON.stringify(snapshot));
      }
    } catch (eSave) {
      console.warn("Could not save the CBT offline pack", eSave);
    }
  };
  _cbtOfflinePackSaveQueue = _cbtOfflinePackSaveQueue.then(saveSnapshot, saveSnapshot);
  return _cbtOfflinePackSaveQueue;
}

async function _cbtOfflinePackLoad() {
  try {
    var attempt = JSON.parse(localStorage.getItem("sia_cbt_attempt_last") || "null");
    if (!attempt || !attempt.attempt_id) return null;
    var key = CBT_OFFLINE_PRACTICE_PREFIX + attempt.attempt_id;
    var saved = typeof ssGet === "function"
      ? await ssGet(key)
      : JSON.parse(localStorage.getItem(key) || "null");
    if (saved && saved.rows && saved.rows.length && saved.rows.some(function (r) { return !!r; })) {
      return saved;
    }
    var rows = JSON.parse(localStorage.getItem("sia_cbt_rows_" + attempt.attempt_id) || "null");
    if (!rows || !rows.length || !rows.some(function (r) { return !!r; })) return null;
    return { attempt: attempt, rows: rows };
  } catch (e) {
    return null;
  }
}

async function completeOfflinePracticeAttempt() {
  if (!window.__cbtOfflineAttempt) return;
  window.__cbtOfflineAttempt = Object.assign({}, window.__cbtOfflineAttempt, {
    completed_at: new Date().toISOString(),
  });
  await _cbtOfflinePackSave();
}

function _cbtApplySectionRows(qs, start, questionIndex, fresh) {
  qs.forEach(function (q, i) {
    var row = _cbtRowFromQuestion(q);
    currentExam.questions[start + i] = row;
    var saved = (currentExam.answers || {})[row.id];
    if (saved && !answers[start + i]) answers[start + i] = saved;
  });
  fresh.count = qs.length; // real question count (bank may be smaller than the stub)
  fresh.questions_loaded = true;
  _cbtOfflinePackSave();
  currentQ = start + Math.min(Math.max(questionIndex - start, 0), qs.length - 1);
  if (typeof buildSubjectTabs === "function") buildSubjectTabs();
  if (typeof buildQNav === "function") buildQNav();
  if (typeof renderQuestion === "function") renderQuestion();
}

async function maybeFetchPracticeSection(questionIndex) {
  if (!currentSession || !currentSession.practice_attempt_id) return;
  var sec = _cbtSectionForIndex(questionIndex);
  if (!sec || sec.questions_loaded) return;
  var key = currentSession.practice_attempt_id + ":" + sec.start;
  if (_cbtSectionsFetched[key]) return;
  _cbtSectionsFetched[key] = true;
  try {
    var built = await api(
      "/api/v1/cbt/practice/attempts/" + currentSession.practice_attempt_id +
      "/sections/" + currentExam.sections.indexOf(sec)
    );
    if (!currentExam || !currentExam.sections) return;
    var fresh = _cbtSectionForIndex(questionIndex) || sec;
    var start = fresh.start;
    var qs = (built && built.questions) || [];
    if (!qs.length) {
      _cbtSectionsFetched[key] = false;
      alert(
        "No questions in the bank yet for " + (fresh.subject || "this subject") +
        ". Ask admin to upload " + cbtBoardLabel(currentExam.exam_type) + " questions for it."
      );
      return;
    }
    // Fill rows IN PLACE — indices of every section stay stable, so already
    // loaded sections are never disturbed. Unused padding slots stay null and
    // are skipped by the question nav.
    _cbtApplySectionRows(qs, start, questionIndex, fresh);
  } catch (e) {
    _cbtSectionsFetched[key] = false;
    // OFFLINE: play the already-downloaded copy of this subject.
    var offlineNow = typeof navigator !== "undefined" && !navigator.onLine;
    var offlinePack = offlineNow ? await _cbtOfflinePackLoad() : null;
    if (offlinePack && offlinePack.rows) {
      var fresh2 = _cbtSectionForIndex(questionIndex) || sec;
      var slice = offlinePack.rows.slice(fresh2.start, fresh2.start + (fresh2.count || 0));
      if (slice.some(function (r) { return !!r; })) {
        for (var ri = 0; ri < slice.length; ri++) {
          if (slice[ri]) currentExam.questions[fresh2.start + ri] = slice[ri];
        }
        fresh2.questions_loaded = true;
        currentQ = fresh2.start;
        if (typeof buildSubjectTabs === "function") buildSubjectTabs();
        if (typeof buildQNav === "function") buildQNav();
        if (typeof renderQuestion === "function") renderQuestion();
        return;
      }
    }
    alert((e && e.message) || "Could not load this subject's questions.");
  } finally {
    _cbtSectionFetchBusy = false;
  }
}

/* CONTINUE: save (and lock) WAEC/NECO/Junior WAEC subjects without starting an exam.
   After registration the hub reloads and shows one card per subject. */
async function cbtHubRegisterSubjects(board, subjects, btn) {
  if (cbtHubState.busy) return;
  cbtHubState.busy = true;
  var oldLabel = btn ? btn.innerHTML : "";
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = "Saving…";
  }
  try {
    await api("/api/v1/cbt/practice/register-subjects", {
      method: "POST",
      body: JSON.stringify({ exam_type: board, subjects: subjects }),
    });
    cbtHubState.sscePicked = [];
    await loadCbtHubPage();
  } catch (e) {
    var msg = (e && e.message) || "Could not save subjects.";
    if (/locked/i.test(msg) || (e && e.status === 409)) {
      msg = "Your subjects are locked. Send your admin a subject-change request.";
    }
    alert(msg);
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = oldLabel;
    }
  } finally {
    cbtHubState.busy = false;
  }
}

async function cbtHubStartPractice(examType, subjects) {
  if (cbtHubState.busy) return;
  // Starting a new practice needs the server — downloaded exams are the
  // offline path (hub shows them in "Ready offline").
  if (cbtHubState.offlineMode || (typeof navigator !== "undefined" && !navigator.onLine)) {
    // OFFLINE RESUME: relaunch the cached attempt + downloaded questions.
    var saved = await _cbtOfflinePackLoad();
    if (
      saved &&
      saved.attempt.offline_ready &&
      String((saved.attempt && saved.attempt.exam_type) || "").toUpperCase() ===
        String(examType || "").toUpperCase()
    ) {
      await launchPracticeAttempt(saved.attempt, saved.rows, !!saved.attempt.completed_at);
      return;
    }
    alert(
      "You are offline — starting a new CBT needs data.\n\n" +
      "Your downloaded exams still work: go back and tap one under \"Ready offline\"."
    );
    return;
  }
  cbtHubState.busy = true;
  try {
    var attempt = await api("/api/v1/cbt/practice/start", {
      method: "POST",
      body: JSON.stringify({ exam_type: examType, subjects: subjects }),
    });
    var offlineRows = null;
    try {
      var offlinePack = await api(
        "/api/v1/cbt/practice/attempts/" + encodeURIComponent(attempt.attempt_id) + "/offline-pack",
        { method: "POST", timeout: 90000, retries: 0 }
      );
      offlineRows = [];
      (offlinePack.sections || []).forEach(function (section) {
        var sectionQuestions = [];
        (section.questions || []).forEach(function (q) {
          var row = _cbtRowFromQuestion(q);
          row.subject = section.subject || "Subject";
          sectionQuestions.push(row);
        });
        var sectionTotal = parseInt(section.total || sectionQuestions.length, 10) || 0;
        offlineRows = offlineRows.concat(sectionQuestions);
        for (var i = sectionQuestions.length; i < sectionTotal; i++) offlineRows.push(null);
      });
      if (!offlineRows.length || offlineRows.some(function (q) { return !q.correct_option; })) {
        throw new Error("The downloaded practice paper is missing answer keys.");
      }
      attempt.sections = (attempt.sections || []).map(function (section, index) {
        var offlineSection = (offlinePack.sections || [])[index] || {};
        return Object.assign({}, section, {
          subject: offlineSection.subject || section.subject,
          total: parseInt(offlineSection.total || (offlineSection.questions || []).length, 10) || 0,
        });
      });
    } catch (offlineError) {
      console.warn("Could not prepare CBT for offline scoring", offlineError);
      offlineRows = null;
    }
    await launchPracticeAttempt(attempt, offlineRows);
    if (!offlineRows) {
      var meta = document.getElementById("exam-meta");
      if (meta) meta.textContent += " · Offline score not downloaded";
    }
  } catch (e) {
    var msg = (e && e.message) || "";
    if (/402|cbt_package|package|paid|required/i.test(msg) || (e && e.status === 402)) {
      if (typeof openCbtUnlockModal === "function") {
        openCbtUnlockModal(function () {
          cbtHubStartPractice(examType, subjects);
        });
      } else {
        alert(msg);
      }
    } else {
      alert(msg || "Could not start CBT.");
    }
  } finally {
    cbtHubState.busy = false;
  }
}

async function launchPracticeAttempt(attempt, offlineRows, localReplay) {
  var pack = cbtAttemptToPack(attempt);
  // Sections arrive as stubs (questions load per subject on demand). Only fail
  // when the attempt has no sections at all.
  if (!pack.sections.length) {
    alert(
      "This " + cbtBoardLabel(attempt.exam_type) +
      " attempt has no subjects. Ask admin to check CBT Settings."
    );
    return;
  }
  currentExam = pack;
  if (offlineRows && offlineRows.length) {
    currentExam.questions = offlineRows;
    (pack.sections || []).forEach(function (s) {
      var slice = offlineRows.slice(s.start, s.start + (s.count || 0));
      if (slice.some(function (r) { return !!r; })) s.questions_loaded = true;
    });
  }
  window.__cbtOfflineAttempt = localReplay ? null : attempt;
  currentSession = {
    session_id: null,
    practice_attempt_id: localReplay ? null : attempt.attempt_id,
    is_practice: true,
    is_local_replay: !!localReplay,
  };
  window._lastPracticeReview = null;
  window._lastPracticeAttemptId = null;
  answers = {};
  // Restore saved answers by question index (rows can be null placeholders
  // for sections whose questions load on demand)
  if (!localReplay) {
    (pack.questions || []).forEach(function (q, i) {
      if (q && pack.answers && pack.answers[q.id]) answers[i] = pack.answers[q.id];
    });
    if (attempt.answers_by_index) {
      Object.keys(attempt.answers_by_index).forEach(function (i) {
        answers[i] = attempt.answers_by_index[i];
      });
    }
  }
  currentQ = 0;
  if (!localReplay && pack.sections && pack.sections.length > 1 && pack.section_index) {
    var sec = pack.sections[pack.section_index];
    if (sec) currentQ = sec.start || 0;
  }
  var totalCount = pack.sections.reduce(function (n, s) { return n + (s.count || 0); }, 0);
  secondsLeft = localReplay
    ? (pack.duration_minutes || 60) * 60
    : (typeof pack.seconds_left === "number" ? pack.seconds_left : (pack.duration_minutes || 60) * 60);

  await _cbtOfflinePackSave();
  if (typeof showCbtExamView === "function") showCbtExamView();
  document.getElementById("exam-title").textContent = pack.title;
  document.getElementById("exam-meta").textContent =
    (pack.subject || cbtBoardLabel(attempt.exam_type)) +
    " · " +
    totalCount +
    " questions · Settings timer";
  if (typeof buildSubjectTabs === "function") buildSubjectTabs();
  if (typeof buildQNav === "function") buildQNav();
  if (typeof renderQuestion === "function") renderQuestion();
  if (typeof startTimer === "function") startTimer();
}

function examTypeLabel(t) {
  return t || "CBT";
}

// Legacy stubs so old onclick handlers do not crash
function cbtHubSetTab() {}
function cbtHubSetSubject() {}
function cbtHubDownload() {
  alert("Download offline packs will sync with practice attempts in a follow-up update. Start CBT online for now.");
}
function cbtHubDownloadJamb() {
  cbtHubDownload();
}
function cbtHubStart() {
  alert("Use START CBT from the JAMB / WAEC / NECO flow.");
}
function cbtHubStartJamb() {
  alert("Select your 4 subjects, then tap START CBT.");
}

if (typeof window !== "undefined") {
  window.loadCbtHubPage = loadCbtHubPage;
  window.cbtHubOpenBoard = cbtHubOpenBoard;
  // Delegated handler for the subject-change button (re-rendered DOM)
  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-cbt-scr-board]");
    if (btn && typeof cbtHubRequestSubjectChange === "function") {
      cbtHubRequestSubjectChange(btn.getAttribute("data-cbt-scr-board"));
    }
  });
  window.cbtHubToggleJamb = cbtHubToggleJamb;
  window.cbtHubUnlockBoard = cbtHubUnlockBoard;
  window.cbtHubStartJambPractice = cbtHubStartJambPractice;
  window.cbtHubStartSubject = cbtHubStartSubject;
  window.cbtHubSetTab = cbtHubSetTab;
  window.cbtHubSetSubject = cbtHubSetSubject;
  window.cbtHubDownload = cbtHubDownload;
  window.cbtHubDownloadJamb = cbtHubDownloadJamb;
  window.cbtHubStart = cbtHubStart;
  window.cbtHubStartJamb = cbtHubStartJamb;
}
