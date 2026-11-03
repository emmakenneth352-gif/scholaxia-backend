/** External / Internal School Exams — download offline, submit when back online
 *  Owner PRD — OFFLINE SECURITY (site + desktop):
 *   • exam packs + pending submissions stored ENCRYPTED (secure-store.js, AES-GCM)
 *   • exam start time + submission time recorded on the device and sent to the server
 *   • exam duration enforced from the recorded start time
 *   • one queue entry per exam — duplicates are merged, never submitted twice
 *   • the server validates and re-scores every submission (device score is a preview only)
 */

var internalExamsList = [];
var INTERNAL_CACHE_PREFIX = "sia_internal_exam_pack_";
var INTERNAL_PENDING_KEY = "sia_internal_pending_submits";

function ieEsc(s) {
  var d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
}

/* ── Encrypted local storage (OFFLINE SECURITY) ──────────────────────────── */
async function sxEncSet(key, value) {
  if (typeof ssSet === "function") { await ssSet(key, value); return; }
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* quota */ }
}

async function sxEncGet(key) {
  if (typeof ssGet === "function") { return ssGet(key); }
  try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { return null; }
}

async function sxEncDel(key) {
  if (typeof ssDel === "function") { await ssDel(key); return; }
  try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
}

/** Exam pack cache (download once → take offline). Encrypted at rest. */
async function getInternalPack(examId) {
  var pack = await sxEncGet(INTERNAL_CACHE_PREFIX + examId);
  if (pack) return pack;
  // Legacy plain-JSON value from an older build — migrate it into the
  // encrypted store and remove the readable copy from localStorage.
  try {
    var raw = localStorage.getItem(INTERNAL_CACHE_PREFIX + examId);
    if (raw) {
      var legacy = JSON.parse(raw);
      await sxEncSet(INTERNAL_CACHE_PREFIX + examId, legacy);
      localStorage.removeItem(INTERNAL_CACHE_PREFIX + examId);
      return legacy;
    }
  } catch (e) { /* ignore */ }
  return null;
}

async function saveInternalPack(examId, pack) {
  await sxEncSet(INTERNAL_CACHE_PREFIX + examId, pack);
}

function listCachedInternalExams() {
  var out = [];
  try {
    // secure-store.js encrypts the VALUE under the same key name, so scanning
    // key names finds both plain (legacy) and encrypted packs.
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf(INTERNAL_CACHE_PREFIX) === 0) out.push(k.replace(INTERNAL_CACHE_PREFIX, ""));
    }
  } catch (e) { /* ignore */ }
  return out;
}

/* ── Offline submission queue (answers saved locally → auto-sync on reconnect) ── */
async function getPendingSubmits() {
  var list = await sxEncGet(INTERNAL_PENDING_KEY);
  try {
    if (!list) {
      var raw = localStorage.getItem(INTERNAL_PENDING_KEY);
      if (raw) {
        list = JSON.parse(raw) || [];
        await sxEncSet(INTERNAL_PENDING_KEY, list); // migrate to encrypted
        localStorage.removeItem(INTERNAL_PENDING_KEY);
      }
    }
  } catch (e) { /* ignore */ }
  return Array.isArray(list) ? list : [];
}

async function savePendingSubmits(list) {
  await sxEncSet(INTERNAL_PENDING_KEY, list || []);
}

async function queueInternalSubmit(examId, answers, meta) {
  meta = meta || {};
  var list = await getPendingSubmits();
  // One entry per exam: a re-queued submission REPLACES the older draft for
  // the same exam (duplicate submissions are impossible by construction).
  list = list.filter(function (x) { return x.exam_id !== examId; });
  list.push({
    exam_id: examId,
    answers: answers,
    started_at: meta.started_at || null,
    submitted_at: meta.submitted_at || new Date().toISOString(),
    client: meta.client || "desktop",
    queued_at: new Date().toISOString(),
  });
  await savePendingSubmits(list);
}

async function flushPendingInternalSubmits() {
  if (typeof isStudentLoggedIn !== "function" || !isStudentLoggedIn()) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  var list = await getPendingSubmits();
  if (!list.length) return;
  var remaining = [];
  for (var i = 0; i < list.length; i++) {
    var item = list[i];
    try {
      await api("/api/v1/cbt/external-exams/" + item.exam_id + "/submit", {
        method: "POST",
        body: JSON.stringify({
          answers: item.answers,
          is_auto_submit: false,
          started_at: item.started_at || null,
          submitted_at: item.submitted_at || null,
          offline_sync: true,
          client: "desktop",
        }),
      });
    } catch (e) {
      remaining.push(item);
    }
  }
  await savePendingSubmits(remaining);
  if (list.length > remaining.length && typeof loadInternalExamsPage === "function") {
    loadInternalExamsPage();
  }
}

async function loadInternalExamsPage() {
  var el = document.getElementById("internal-exams-list");
  var banner = document.getElementById("internal-pending-banner");
  if (!el) return;

  if (typeof isStudentLoggedIn !== "function" || !isStudentLoggedIn()) {
    el.innerHTML = '<div class="empty-state-premium"><h3>Sign in required</h3><p>Log in to see school exams uploaded by admin.</p></div>';
    return;
  }

  await flushPendingInternalSubmits();

  var pending = await getPendingSubmits();
  if (banner) {
    if (pending.length) {
      banner.classList.remove("hidden");
      banner.innerHTML = "&#128228; " + pending.length + " exam submission(s) waiting to sync — connect to internet and tap Refresh.";
    } else {
      banner.classList.add("hidden");
    }
  }

  el.innerHTML = '<div class="loading">Loading school exams…</div>';
  try {
    var data = await api("/api/v1/cbt/external-exams/for-me");
    internalExamsList = (data && data.exams) || [];
    await dropRetakeCaches(internalExamsList);
    renderInternalExamsList();
  } catch (e) {
    el.innerHTML = '<div class="empty-state-premium"><h3>Could not load exams</h3><p>' + ieEsc(e.message) + "</p>";
    var cached = listCachedInternalExams();
    if (cached.length) {
      el.innerHTML += "<p>You have " + cached.length + " downloaded exam(s) available offline.</p>";
    }
    el.innerHTML += "</div>";
  }
}

/** A granted retake invalidates this device's cached paper + queued answers
 *  exactly once, so the next download is freshly randomized. The marker stops
 *  the newly downloaded pack from being wiped on the next refresh. */
async function dropRetakeCaches(exams) {
  for (var i = 0; i < (exams || []).length; i++) {
    var ex = exams[i] || {};
    var rid = String(ex.id || "");
    if (!rid) continue;
    var marker = "sia_internal_retake_cleared_" + rid;
    if (ex.retake_granted) {
      if (!localStorage.getItem(marker)) {
        await sxEncDel(INTERNAL_CACHE_PREFIX + rid);
        var list = await getPendingSubmits();
        var kept = list.filter(function (p) { return String(p.exam_id) !== rid; });
        if (kept.length !== list.length) await savePendingSubmits(kept);
        try { localStorage.setItem(marker, "1"); } catch (e) { /* ignore */ }
      }
    } else {
      try { localStorage.removeItem(marker); } catch (e) { /* ignore */ }
    }
  }
}

async function renderInternalExamsListAsync() {
  var el = document.getElementById("internal-exams-list");
  if (!el) return;

  if (!internalExamsList.length) {
    el.innerHTML =
      '<div class="empty-state-premium">' +
      '<div class="empty-icon">&#127979;</div>' +
      "<h3>No school exams yet</h3>" +
      "<p>When admin uploads an Scholaxia Exam, it will appear here. Download it while online, take it offline, then submit your answers.</p></div>";
    return;
  }

  var pendingList = await getPendingSubmits();
  var cachedIds = listCachedInternalExams();
  el.innerHTML = "";
  for (var idx = 0; idx < internalExamsList.length; idx++) {
    var e = internalExamsList[idx];
    var cached = cachedIds.indexOf(String(e.id)) !== -1;
    var taken = e.already_taken;
    var pending = pendingList.some(function (p) { return p.exam_id === e.id; });
    var card = document.createElement("div");
    card.className = "card sx-card";
    card.innerHTML =
      '<div class="time-badge">' + (taken ? "Submitted" : "School exam") + "</div>" +
      "<h3>" + ieEsc(e.title) + "</h3>" +
      '<p class="meta">' + ieEsc(e.subject) + " · " + ieEsc(e.teacher_name || "Admin") + " · " + (e.total_questions || "?") + " questions · " + (e.duration_minutes || 60) + " min</p>" +
      (cached ? '<p class="meta sx-meta-ok">&#10003; Downloaded — ready for offline use</p>' : "") +
      (pending ? '<p class="meta sx-meta-warn">&#128228; Answers saved — will submit when online</p>' : "") +
      (e.notes_url ? '<a href="' + ieEsc(e.notes_url) + '" target="_blank" rel="noopener" class="btn-secondary btn-sm">View notes / PDF</a> ' : "") +
      '<div class="card-actions-row">' +
      (!taken && !cached ? '<button type="button" class="btn-action btn-sm" data-ie-download="' + ieEsc(String(e.id)) + '">Download for offline</button>' : "") +
      (!taken && cached ? '<button type="button" class="btn-join" data-ie-start="' + ieEsc(String(e.id)) + '">Take exam</button>' : "") +
      (taken
        ? '<span class="meta">Submitted' +
          (e.my_score_percent != null
            ? ' · Your score: <strong>' + Math.round(Number(e.my_score_percent)) + "%</strong>"
            : " — awaiting board publish") +
          "</span>"
        : "") +
      "</div>";
    el.appendChild(card);
  }
  el.querySelectorAll("[data-ie-download]").forEach(function (btn) {
    btn.addEventListener("click", function () { downloadInternalExam(btn.getAttribute("data-ie-download")); });
  });
  el.querySelectorAll("[data-ie-start]").forEach(function (btn) {
    btn.addEventListener("click", function () { startInternalExam(btn.getAttribute("data-ie-start")); });
  });
}

function renderInternalExamsList() {
  renderInternalExamsListAsync();
}

async function downloadInternalExam(examId) {
  try {
    var pack = await api("/api/v1/cbt/exams/" + examId + "/download");
    if (!pack.questions || !pack.questions.length) {
      alert("This exam has no questions yet.");
      return;
    }
    await saveInternalPack(examId, pack);
    alert("Downloaded! You can take this exam offline anytime.");
    renderInternalExamsList();
  } catch (e) {
    alert(e.message || "Download failed. Stay online and try again.");
  }
}

/** Start the exam from the encrypted local pack. Records the exact start time
 *  (sent with the submission) and derives the remaining time from it, so the
 *  duration stands even fully offline. */
async function startInternalExam(examId) {
  var pack = await getInternalPack(examId);
  if (!pack) {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      alert("Download this exam first while you have internet.");
      return;
    }
    await downloadInternalExam(examId);
    pack = await getInternalPack(examId);
  }
  if (!pack || !pack.questions || !pack.questions.length) {
    alert("Exam pack not found. Download again.");
    return;
  }

  if (typeof showCbtExamView !== "function") {
    alert("Exam viewer not ready. Refresh the page.");
    return;
  }

  var startedAt = new Date().toISOString();
  var minutes = pack.duration_minutes || 60;
  window.__ieStart = { exam_id: examId, started_at: startedAt, duration_minutes: minutes };

  currentExam = pack;
  currentSession = { is_internal: true, exam_id: examId, is_school_exam: true };
  answers = {};
  currentQ = 0;
  secondsLeft = minutes * 60;

  showCbtExamView();
  document.getElementById("exam-title").textContent = pack.title || "School Exam";
  document.getElementById("exam-meta").textContent =
    (pack.subject || "Exam") + " · " + pack.questions.length + " questions · Offline mode (submit when done)";

  if (typeof buildQNav === "function") buildQNav();
  if (typeof renderQuestion === "function") renderQuestion();
  if (typeof startTimer === "function") startTimer();
  if (typeof setExamLockMode === "function") setExamLockMode(true);
}

if (typeof window !== "undefined") {
  window.loadInternalExamsPage = loadInternalExamsPage;
  window.downloadInternalExam = downloadInternalExam;
  window.startInternalExam = startInternalExam;
  window.flushPendingInternalSubmits = flushPendingInternalSubmits;
  window.queueInternalSubmit = queueInternalSubmit;
  window.getPendingSubmits = getPendingSubmits;
  window.getInternalPack = getInternalPack;
}
