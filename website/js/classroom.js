var liveSession = null;
var liveSocket = null;
var localPreviewStream = null;
var studentMicAllowed = false;
window.studentMicAllowed = false;
window.syncStudentMicState = function (allowed) {
  studentMicAllowed = !!allowed;
  window.studentMicAllowed = studentMicAllowed;
  if (liveSession) {
    liveSession.mic_allowed = studentMicAllowed;
    saveLiveSession(liveSession);
  }
};
var studentCameraAllowed = false;
window.studentCameraAllowed = false;
var classStudentsPollTimer = null;
var micMonitorTimer = null;
var micMonitorCtx = null;
var selfHearAudio = null;
var classAutoEndTimer = null;
var raisedHands = {};
window.raisedHands = raisedHands;
var wsStudentCount = 0;
var chatUnreadCount = 0;
var seenChatEventIds = {};
var lastClassroomStudents = [];
var hostParticipantFilter = "";
var activeMeetTab = "chat";
var classElapsedTimer = null;
var classPermissions = {
  studentsCanUseCamera: true,
  studentsCanUseMicrophone: true,
  studentsCanChat: true,
  studentsCanReact: true,
  studentsCanRaiseHand: true,
};
window.classPermissions = classPermissions;
var currentSpotlight = "teacher";
var spotlightUserId = "";
window.spotlightUserId = spotlightUserId;
var API_WS = (typeof window !== "undefined" && window.API_WS)
  ? window.API_WS
  : (typeof window !== "undefined" && window.API_BASE
      /* Derive ws://wss:// from the REST API base so the local sandbox and
         same-origin deploys reach THEIR OWN WebSocket server instead of
         always dialing production. */
      ? window.API_BASE.replace(/^http/i, "ws")
      : "wss://scholaxia1.onrender.com");
var JOIN_TIMEOUT_MS = 45000;

function escHtml(value) {
  if (value == null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
window.escHtml = escHtml;

var SUBJECT_SYMBOLS = {
  mathematics: {
    label: "Mathematics",
    symbols: [
      "+", "−", "×", "÷", "=", "≠", "≈", "≤", "≥", "±", "∞", "√", "∛", "∜",
      "π", "θ", "α", "β", "γ", "Δ", "∫", "∑", "∏", "∂", "∇", "°", "′", "″",
      "x²", "x³", "xⁿ", "½", "¼", "¾", "⅓", "⅔", "→", "↔", "⇒", "∈", "∉",
      "⊂", "⊃", "∪", "∩", "∅", "ℝ", "ℕ", "ℤ", "ℚ", "ℂ", "sin", "cos", "tan",
      "log", "ln", "lim", "f(x)", "dy/dx", "∴", "∵", "(", ")", "[", "]", "{", "}"
    ]
  },
  physics: {
    label: "Physics",
    symbols: [
      "F", "m", "a", "v", "u", "t", "s", "d", "E", "W", "P", "V", "I", "R", "Q",
      "Ω", "λ", "ν", "f", "Hz", "J", "N", "kg", "m/s", "m/s²", "Δ", "ρ", "μ",
      "ε", "σ", "θ", "ω", "α", "β", "γ", "Φ", "Ψ", "∫", "∇", "×", "·", "→", "↑", "↓",
      "F=ma", "V=IR", "P=IV", "E=mc²", "KE", "PE", "W=Fd", "v²=u²+2as",
      "°C", "K", "Pa", "N·m", "W/m²", "c", "h", "e", "π", "±", "≈", "∝"
    ]
  },
  chemistry: {
    label: "Chemistry",
    symbols: [
      "H", "He", "Li", "C", "N", "O", "Na", "Cl", "Fe", "Cu", "Zn", "Ag", "Au",
      "H₂", "O₂", "N₂", "CO₂", "H₂O", "NaCl", "H⁺", "OH⁻", "e⁻", "→", "⇌", "⇋",
      "↑", "↓", "(s)", "(l)", "(g)", "(aq)", "Δ", "°C", "mol", "M", "mol/L",
      "pH", "pKa", "Ksp", "K_eq", "E°", "ΔG", "ΔH", "ΔS", "+", "−", "=", "≡",
      "#", "[", "]", "(", ")", "¹", "²", "³", "⁴", "⁺", "⁻", "½", "⅓", "⁄"
    ]
  },
  english: {
    label: "English",
    symbols: [
      "—", "–", "…", "\u2019", "\u2018", "\u201C", "\u201D", "«", "»", ";", ":", "?", "!", "@",
      "#", "%", "&", "*", "(", ")", "[", "]", "{", "}", "§", "†", "‡", "•",
      "¿", "¡", "/", "\\", "|", "~", "^", "_", "+", "=", "<", ">", "A", "B",
      "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P"
    ]
  },
  igbo: {
    label: "Igbo",
    symbols: [
      "a", "b", "ch", "d", "e", "f", "g", "gb", "gh", "gw", "h", "i", "ị", "j",
      "k", "kp", "kw", "l", "m", "n", "ṅ", "nw", "ny", "o", "ọ", "p", "r", "s",
      "sh", "t", "u", "ụ", "v", "w", "y", "z", "á", "à", "é", "è", "í", "ì",
      "ó", "ò", "ú", "ù", "ḿ", "ń", "A", "B", "CH", "D", "E", "Ị", "Ọ", "Ụ",
      "kedu", "biko", "daalụ", "nno", "ọ dị mma", "?", "!", "."
    ]
  },
  yoruba: {
    label: "Yoruba",
    symbols: [
      "a", "b", "d", "e", "ẹ", "f", "g", "gb", "h", "i", "j", "k", "l", "m", "n",
      "o", "ọ", "p", "r", "s", "ṣ", "t", "u", "w", "y", "á", "à", "é", "è", "ẹ́", "ẹ̀",
      "í", "ì", "ó", "ò", "ọ́", "ọ̀", "ú", "ù", "ń", "A", "B", "D", "E", "Ẹ", "F", "G",
      "bawo", "ẹ jọ", "o ṣe", "jọ̀wọ́", "?", "!", "."
    ]
  },
  hausa: {
    label: "Hausa",
    symbols: [
      "a", "b", "ɓ", "c", "d", "ɗ", "e", "f", "g", "h", "i", "j", "k", "ƙ", "l", "m",
      "n", "o", "p", "r", "s", "sh", "t", "u", "w", "y", "z", "ʼ", "A", "B", "Ɓ", "C",
      "D", "Ɗ", "E", "F", "G", "H", "I", "J", "K", "Ƙ", "L", "M", "N", "O", "R", "S",
      "sannu", "na gode", "don Allah", "?", "!", "."
    ]
  }
};

var board = {
  open: false,
  ctx: null,
  canvas: null,
  drawing: false,
  lastX: 0,
  lastY: 0,
  tool: "type",
  pendingSymbol: null,
  canDraw: false,
  history: [],
  textX: 24,
  textY: 48,
  liveText: "",
  liveTextId: "live-line",
  fontSize: 64,
  lineHeight: 80,
  imageCache: {}
};
var boardWsQueue = [];
// Whiteboard is BACK — typing/erase/clear are streamed over the classroom
// WebSocket the instant they happen (no waiting for HTTP sync), and students
// render strokes the same frame they arrive.
window.SX_WHITEBOARD_ENABLED = true;
var WHITEBOARD_ENABLED = window.SX_WHITEBOARD_ENABLED;
var BOARD_BASE_WIDTH = 1280;
var BOARD_BASE_MIN_HEIGHT = 720;

function queueBoardMessage(msg) {
  if (!msg) return;
  if (board.canvas && board.ctx) {
    handleBoardMessage(msg);
    return;
  }
  boardWsQueue.push(msg);
  if (boardWsQueue.length > 200) boardWsQueue = boardWsQueue.slice(-200);
}

function flushBoardWsQueue() {
  if (!board.canvas || !board.ctx) return;
  while (boardWsQueue.length) {
    handleBoardMessage(boardWsQueue.shift());
  }
}

function applyBoardReplayMessages(messages) {
  if (!messages || !messages.length) return;
  messages.forEach(function (msg) {
    if (msg && msg.event === "whiteboard") queueBoardMessage(msg);
  });
  flushBoardWsQueue();
  if (!isTeacherRole() && board.open) {
    showBoardForStudent(true);
    redrawBoard();
  }
}

function isStudentScreenShareActive() {
  if (window._teacherScreenSharing) return true;
  if (typeof window.remoteTeacherScreenActive === "function" && window.remoteTeacherScreenActive()) return true;
  var remote = document.getElementById("video-remote");
  return remote && remote.classList.contains("screen-active");
}
window.isStudentScreenShareActive = isStudentScreenShareActive;

function pauseStudentBoardSyncForScreenShare() {
  window._teacherScreenSharing = true;
  if (window._sxBoardSyncPoll) {
    clearInterval(window._sxBoardSyncPoll);
    window._sxBoardSyncPoll = null;
  }
  if (window._sxBoardHttpSync) {
    clearInterval(window._sxBoardHttpSync);
    window._sxBoardHttpSync = null;
  }
}

function resumeStudentBoardSyncAfterScreenShare() {
  window._teacherScreenSharing = false;
  if (isTeacherRole()) return;
  if (!window._sxBoardHttpSync) startStudentBoardHttpSync();
  if (liveSocket && liveSocket.readyState === WebSocket.OPEN) {
    try {
      liveSocket.send(JSON.stringify({ event: "request_board_sync" }));
    } catch (eSync) { /* ignore */ }
  }
}

function pullBoardStateFromServer() {
  if (!liveSession || !liveSession.room_id || isTeacherRole()) return;
  if (isStudentScreenShareActive()) return;
  var path =
    "/api/v1/live-classes/board-sync/" + encodeURIComponent(liveSession.room_id);
  api(path, { preferXhr: true, timeout: 25000, retries: 0 })
    .then(function (data) {
      if (!data) return;
      if (data.open) {
        if (!board.open) {
          applyBoardReplayMessages(data.messages || []);
        } else if (!board.history.length && (data.messages || []).length) {
          applyBoardReplayMessages(data.messages || []);
        }
      } else if (board.open) {
        hideBoardForStudent();
      }
    })
    .catch(function () { /* ignore */ });
}

function startStudentBoardHttpSync() {
  if (!WHITEBOARD_ENABLED) return;
  if (isTeacherRole() || window._sxBoardHttpSync) return;
  pullBoardStateFromServer();
  window._sxBoardHttpSync = setInterval(pullBoardStateFromServer, 10000);
}

function startTeacherBoardHeartbeat() {
  if (!WHITEBOARD_ENABLED) return;
  if (!isTeacherRole() || window._sxBoardHeartbeat) return;
  window._sxBoardHeartbeat = setInterval(function () {
    if (!board.open) return;
    if (liveSocket && liveSocket.readyState === WebSocket.OPEN) {
      sendBoardHeartbeat();
    } else {
      try { connectChat(true); } catch (eHb) { /* ignore */ }
    }
  }, 12000);
}

function sendBoardHeartbeat() {
  if (!isTeacherRole() || !board.open) return;
  sendBoardEvent("board_open", { open: true });
  if (board.liveText) {
    sendBoardEvent("text_stream", {
      id: board.liveTextId || boardLiveTextId(),
      x: board.textX,
      y: board.textY,
      text: board.liveText,
      size: board.fontSize,
    });
  }
}

function newBoardTextId() {
  return "t-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 1e6).toString(36);
}

function boardLiveTextId() {
  return "live-" + Math.round(board.textX) + "-" + Math.round(board.textY);
}

var _boardRedrawScheduled = false;
var _boardTypeSendTimer = null;
var _lastBoardTypeStream = "";
var _lastRemoteTextStream = "";
// Id of the most recent text line the LOCAL teacher committed — the server
// echo of it must not be re-added to teacher history (dup guard).
var _lastOwnTextId = "";
var _boardCacheCanvas = null;
var _boardCacheHistoryLen = -1;

function invalidateBoardCache() {
  _boardCacheCanvas = null;
  _boardCacheHistoryLen = -1;
}

function scheduleRedrawBoard() {
  if (_boardRedrawScheduled) return;
  _boardRedrawScheduled = true;
  requestAnimationFrame(function () {
    _boardRedrawScheduled = false;
    if (board.liveText && redrawBoardLiveTextFast()) return;
    redrawBoard();
  });
}

function redrawBoardLiveTextFast() {
  if (!board.ctx || !board.canvas || !board.liveText) return false;
  if (!_boardCacheCanvas || _boardCacheHistoryLen !== board.history.length) return false;
  board.ctx.clearRect(0, 0, board.canvas.width, board.canvas.height);
  board.ctx.drawImage(_boardCacheCanvas, 0, 0);
  drawBoardTextWrapped({
    x: board.textX,
    y: board.textY,
    text: board.liveText,
    size: board.fontSize
  }, false);
  updateBoardCursor();
  return true;
}

function cacheBoardHistoryBitmap() {
  if (!board.ctx || !board.canvas || board.liveText) return;
  try {
    _boardCacheCanvas = document.createElement("canvas");
    _boardCacheCanvas.width = board.canvas.width;
    _boardCacheCanvas.height = board.canvas.height;
    _boardCacheCanvas.getContext("2d").drawImage(board.canvas, 0, 0);
    _boardCacheHistoryLen = board.history.length;
  } catch (eCache) {
    invalidateBoardCache();
  }
}

function refreshLiveKitRosterDebounced() {
  if (window._sxRosterDebounce) clearTimeout(window._sxRosterDebounce);
  window._sxRosterDebounce = setTimeout(function () {
    window._sxRosterDebounce = null;
    refreshLiveKitRoster();
  }, 600);
}
var liveSaveChunks = [];
var liveSaveActive = false;
var liveSaveStartedAt = null;

function parseJwt(token) {
  try {
    var part = token.split(".")[1];
    if (!part) return {};
    part = part.replace(/-/g, "+").replace(/_/g, "/");
    while (part.length % 4) part += "=";
    return JSON.parse(atob(part));
  } catch (e) {
    return {};
  }
}

function getAuthToken() {
  if (isTeacherRole()) {
    return localStorage.getItem("sia_teacher_token") || localStorage.getItem("sia_admin_token") || localStorage.getItem("sia_token") || "";
  }
  return localStorage.getItem("sia_token") || localStorage.getItem("sia_teacher_token") || localStorage.getItem("sia_admin_token") || "";
}

function loadLiveSession() {
  if (typeof loadLiveSessionData === "function") return loadLiveSessionData();
  try {
    var raw = localStorage.getItem("live_session") || sessionStorage.getItem("live_session");
    return JSON.parse(raw || "null");
  } catch (e) {
    return null;
  }
}

function saveLiveSession(sess) {
  if (typeof persistLiveSession === "function") persistLiveSession(sess);
  else localStorage.setItem("live_session", JSON.stringify(sess));
  window.liveSession = sess;
}

function isClassroomHost() {
  if (isTeacherRole()) return true;
  try {
    var r = String(localStorage.getItem("sia_role") || "").toLowerCase().replace(/^userrole\./, "");
    if (r === "teacher" || r === "admin") return true;
  } catch (e) { /* ignore */ }
  return !!(
    localStorage.getItem("sia_teacher_token") ||
    localStorage.getItem("sia_admin_token")
  );
}

function isTeacherRole() {
  if (!liveSession) return false;
  var role = String(liveSession.role || "").toLowerCase();
  if (role === "teacher" || role === "admin" || role === "host") return true;
  try {
    var stored = String(localStorage.getItem("sia_role") || "").toLowerCase().replace(/^userrole\./, "");
    if ((stored === "teacher" || stored === "admin") && liveSession.teacher_id) {
      var selfId = String(liveSession.identity || liveSession.user_id || "");
      if (selfId && String(liveSession.teacher_id) === selfId) return true;
    }
    if (stored === "teacher" || stored === "admin") {
      // Teacher dashboard entry usually sets role=teacher; recover if it was dropped.
      if (role === "" || role === "student") {
        var tok = localStorage.getItem("sia_teacher_token") || localStorage.getItem("sia_admin_token") || "";
        if (tok) {
          liveSession.role = stored === "admin" ? "admin" : "teacher";
          return true;
        }
      }
    }
  } catch (e) { /* ignore */ }
  return false;
}

function setStatus(text) {
  var el = document.getElementById("cr-status");
  if (!el) return;
  if (!isTeacherRole()) {
    el.classList.add("hidden");
    el.textContent = "";
    return;
  }
  el.textContent = text || "";
  el.classList.remove("hidden");
}

var classroomToastTimer = null;
function showClassroomToast(message, isError) {
  var el = document.getElementById("classroom-toast");
  if (!el) return;
  if (classroomToastTimer) clearTimeout(classroomToastTimer);
  var text = message || "";
  if (isError && !isTeacherRole() && /publication of local|timed out|no response from server/i.test(text)) {
    text = "Connection is slow — tap Mic or Cam to try again.";
  }
  el.textContent = text;
  el.classList.remove("hidden", "error", "show");
  if (isError) el.classList.add("error");
  void el.offsetWidth;
  el.classList.add("show");
  el.classList.remove("hidden");
  classroomToastTimer = setTimeout(function () {
    el.classList.add("hidden");
    el.classList.remove("show");
  }, isError ? 4500 : 3200);
}

function findParticipantCard(studentId) {
  if (!studentId) return null;
  var want = String(studentId);
  var wantLower = want.toLowerCase();
  var cards = document.querySelectorAll(".participant-card[data-student-id]");
  for (var i = 0; i < cards.length; i++) {
    var sid = cards[i].getAttribute("data-student-id") || "";
    if (sid === want || sid.toLowerCase() === wantLower) return cards[i];
  }
  return null;
}

/** Ensure a participant tile exists for LiveKit identity (teacher view). */
function ensureParticipantCardForStudent(studentId, name) {
  if (!studentId || !isTeacherRole()) return findParticipantCard(studentId);
  var existing = findParticipantCard(studentId);
  if (existing) return existing;
  var list = document.getElementById("participants-list");
  if (!list) return null;
  var empty = list.querySelector(".participants-empty");
  if (empty) empty.remove();
  var s = {
    student_id: String(studentId),
    name: name || "Student",
    mic_allowed: true,
    camera_allowed: true,
  };
  list.insertAdjacentHTML("beforeend", buildParticipantCardHtml(s));
  bindParticipantActionClicks();
  return findParticipantCard(studentId);
}
window.ensureParticipantCardForStudent = ensureParticipantCardForStudent;

function updateSessionStatusPill(status) {
  var pill = document.getElementById("live-status-pill");
  if (!pill) return;
  var s = String(status || "LIVE").toUpperCase();
  pill.textContent = s === "LIVE" ? "LIVE" : s;
  pill.classList.toggle("is-lobby", s === "LOBBY");
  pill.classList.toggle("is-ended", s === "ENDED");
}

function showLobbyBanner(show) {
  var el = document.getElementById("lobby-banner");
  if (!el) return;
  el.classList.toggle("hidden", !show);
}

function setJoinOverlay(show, text) {
  var el = document.getElementById("class-join-overlay");
  var txt = document.getElementById("class-join-overlay-text");
  if (!el) return;
  if (txt && text) txt.textContent = text;
  el.classList.toggle("hidden", !show);
}
window.setJoinOverlay = setJoinOverlay;

function maybeHideJoinOverlay() {
  if (isTeacherRole()) {
    var chatOk = liveSocket && liveSocket.readyState === WebSocket.OPEN;
    var videoOk = window.LiveClassMedia && LiveClassMedia.isJoined && LiveClassMedia.isJoined();
    if (chatOk || videoOk) setJoinOverlay(false);
    return;
  }
  // Students: never block the whole class behind a spinner — chat/video connect in background.
  setJoinOverlay(false);
}

function applySessionStatus(status) {
  updateSessionStatusPill(status);
  var s = String(status || "").toUpperCase();
  if (!isTeacherRole()) {
    showLobbyBanner(s === "LOBBY" || s === "SCHEDULED");
    if (s === "LOBBY" || s === "SCHEDULED") {
      setJoinOverlay(false);
      setStatus("Waiting for your teacher to start…");
    } else if (s === "LIVE") {
      showLobbyBanner(false);
      maybeHideJoinOverlay();
    } else if (s === "ENDED") {
      showLobbyBanner(false);
      setJoinOverlay(false);
    }
  } else {
    showLobbyBanner(false);
  }
}
window.applySessionStatus = applySessionStatus;

function applyRoomSnapshot(snapshot) {
  if (!snapshot) return;
  window.__roomSnapshot = snapshot;
  // Replay chat history recorded while this socket was away — addChatMessage
  // dedupes by eventId, so re-applying a snapshot never duplicates messages.
  // The sender's own copies already rendered as "You" (they never carry an
  // eventId locally), so skip those on replay to avoid a named duplicate.
  if (Array.isArray(snapshot.recentChat) && snapshot.recentChat.length) {
    snapshot.recentChat.forEach(function (m) {
      if (!m || m.event !== "chat") return;
      var mine = m.user_id && String(m.user_id).toLowerCase() === String(window.__myChatUserId || "").toLowerCase();
      if (mine && (window.__ownRecentChat || []).indexOf(m.text) >= 0) return;
      var who = m.name || (m.role === "teacher" ? "Teacher" : "Student");
      addChatMessage(who, m.text || "", false, m.eventId);
    });
  }
  var parts = snapshot.participants || [];
  window.__participantNames = window.__participantNames || {};
  parts.forEach(function (p) {
    var pid = p.userId || p.participantId || p.user_id;
    var pname = (p.name || p.displayName || "").trim();
    if (pid && pname && pname.toLowerCase() !== "student" && !looksLikeUuid(pname)) {
      window.__participantNames[normalizeStudentId(pid)] = pname;
    }
  });
  if (isTeacherRole() && parts.length) {
    var students = parts
      .filter(function (p) {
        return String(p.role || "").toUpperCase() !== "TEACHER" &&
          String(p.connectionState || "") !== "DISCONNECTED";
      })
      .map(function (p) {
        var sid = p.userId || p.participantId;
        return {
          student_id: sid,
          name: resolveStudentDisplayName({ student_id: sid, name: p.name }),
          mic_allowed: !!(p.micAllowed || p.microphoneEnabled),
          camera_allowed: !!(p.cameraAllowed || p.cameraEnabled),
          joined_at: p.joinedAt,
          connection_state: p.connectionState,
          camera_enabled: !!p.cameraEnabled,
        };
      });
    renderClassroomStudents(students);
    flushPendingStudentVideos();
    if (typeof window.scheduleReattachParticipantVideos === "function") {
      window.scheduleReattachParticipantVideos();
    } else if (typeof window.reattachParticipantVideos === "function") {
      window.reattachParticipantVideos();
    }
  }
  var hands = snapshot.raisedHands || [];
  hands.forEach(function (h) {
    if (h && h.userId) addRaisedHand(h.userId, h.name || "Student");
  });
  if (snapshot.permissions) applyClassPermissions(snapshot.permissions);
  if (!isTeacherRole()) syncStudentMediaControls();
  if (snapshot.sessionStatus) applySessionStatus(snapshot.sessionStatus);
  var spot = snapshot.spotlight || snapshot.presentation;
  if (spot) {
    applySpotlight(spot, true, snapshot.spotlightUserId || "");
  }
  if (snapshot.boardOpen && !isTeacherRole() && typeof showBoardForStudent === "function") {
    showBoardForStudent(true);
  }
  if (snapshot.screenShareActive && !isTeacherRole()) {
    addChatMessage("", "Teacher is sharing their screen…", true);
    if (typeof syncMainStageLayers === "function") syncMainStageLayers();
  }
  updateAudienceStats();
}
window.applyRoomSnapshot = applyRoomSnapshot;

function isMobileClassroomView() {
  try {
    return window.matchMedia("(max-width: 900px)").matches;
  } catch (e) {
    return window.innerWidth <= 900;
  }
}
window.isMobileClassroomView = isMobileClassroomView;

function updateCamRailLayout() {
  var wrap = document.querySelector(".main-stage-wrap");
  var rail = document.getElementById("student-cam-rail");
  if (!wrap || !rail) return;
  wrap.classList.toggle("has-cam-rail", !rail.classList.contains("hidden") && rail.children.length > 0);
}

function findOrCreateCamRailSlot(studentId) {
  if (!isTeacherRole() || !studentId) return null;
  var sess = window.liveSession || liveSession;
  var teacherId = sess && (sess.teacher_id || sess.teacherId || sess.identity);
  if (teacherId && String(studentId).toLowerCase() === String(teacherId).toLowerCase()) return null;
  var rail = document.getElementById("student-cam-rail");
  if (!rail) return null;
  var sid = String(studentId);
  var tile = rail.querySelector('[data-rail-student-id="' + sid + '"]');
  if (!tile) {
    tile = document.createElement("div");
    tile.className = "cam-rail-tile";
    tile.setAttribute("data-rail-student-id", sid);
    var initial = "S";
    var card = findParticipantCard(sid);
    if (card) {
      var strong = card.querySelector(".participant-body > strong");
      if (strong && strong.textContent) initial = strong.textContent.charAt(0).toUpperCase();
    }
    tile.innerHTML =
      '<div class="cam-rail-video"></div><span class="cam-rail-label">' + escHtml(initial) + "</span>";
    rail.appendChild(tile);
  }
  rail.classList.remove("hidden");
  updateCamRailLayout();
  return tile.querySelector(".cam-rail-video");
}

function findParticipantVideoSlot(studentId) {
  if (!studentId) return null;
  var railSlot = findOrCreateCamRailSlot(studentId);
  if (railSlot) return railSlot;
  var card = findParticipantCard(studentId);
  if (card) {
    var slot = card.querySelector(".participant-video");
    if (slot) return slot;
  }
  return document.getElementById("participant-video-" + studentId);
}

function showStudentSelfPreview(track) {
  if (isTeacherRole() || !track) return;
  if (track.isMuted === true) return;
  try {
    if (track.mediaStreamTrack && !track.mediaStreamTrack.enabled) return;
  } catch (eTr) { /* ignore */ }
  var wrap = document.getElementById("student-self-video");
  var panel = document.getElementById("student-self-panel");
  if (!wrap || !panel) return;
  wrap.innerHTML = "";
  var el;
  if (typeof track.attach === "function") {
    el = track.attach();
    el.className = "participant-video-el";
    el.muted = true;
    el.autoplay = true;
    el.playsInline = true;
  } else {
    el = document.createElement("video");
    el.className = "participant-video-el";
    el.autoplay = true;
    el.playsInline = true;
    el.muted = true;
    el.srcObject = new MediaStream([track]);
  }
  wrap.appendChild(el);
  panel.classList.remove("hidden");
  panel.classList.add("has-live-cam");
  var status = document.getElementById("student-self-status");
  if (status) status.textContent = "Your camera is on";
}

function hideStudentSelfPreview() {
  var wrap = document.getElementById("student-self-video");
  var panel = document.getElementById("student-self-panel");
  if (wrap) wrap.innerHTML = "";
  if (panel) {
    panel.classList.add("hidden");
    panel.classList.remove("has-live-cam");
  }
  var localEl = document.getElementById("video-local");
  if (localEl && !isTeacherRole()) {
    localEl.innerHTML = "";
    localEl.classList.add("hidden");
  }
}

window.showClassroomToast = showClassroomToast;
window.showStudentSelfPreview = showStudentSelfPreview;
window.hideStudentSelfPreview = hideStudentSelfPreview;

function showHostTools(show) {
  var keepHiddenIds = {
    "class-permissions-panel": true,
    "attendance-panel": true,
    "class-join-overlay": true,
    "livekit-setup-banner": true,
    "audio-unlock-banner": true,
  };
  document.querySelectorAll(".host-only").forEach(function (el) {
    if (keepHiddenIds[el.id]) return;
    if (show) el.classList.remove("hidden");
    else el.classList.add("hidden");
  });
  if (show) {
    document.body.classList.add("host-view");
    document.body.classList.remove("student-view");
    document.querySelectorAll(".student-only").forEach(function (el) {
      el.classList.add("hidden");
    });
    var side = document.getElementById("host-sidebar");
    if (side && !isMobileClassroomView()) side.classList.remove("hidden");
    collapseMeetChatPanel(false);
    startTeacherBoardHeartbeat();
    bindRaisedHandActions();
  } else {
    document.body.classList.remove("host-view");
  }
}

function showStudentTools(show) {
  document.querySelectorAll(".student-only").forEach(function (el) {
    if (show) el.classList.remove("hidden");
    else el.classList.add("hidden");
  });
  if (show) {
    document.body.classList.add("student-view");
    document.body.classList.remove("host-view");
    var statusEl = document.getElementById("cr-status");
    if (statusEl) statusEl.classList.add("hidden");
    ["btn-save-class-top", "btn-save-live", "save-live-badge"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.classList.add("hidden");
    });
    collapseMeetChatPanel(true);
  } else {
    document.body.classList.remove("student-view");
  }
}

function updateSaveLiveUi() {
  var label = liveSaveActive ? "Stop recording" : "Record class";
  var btn = document.getElementById("btn-save-live");
  var topBtn = document.getElementById("btn-save-class-top");
  var badge = document.getElementById("save-live-badge");
  if (btn) {
    btn.classList.toggle("save-active", liveSaveActive);
    btn.innerHTML = (liveSaveActive ? "&#9632; " : "&#128190; ") + label;
  }
  if (topBtn) {
    topBtn.classList.toggle("save-active", liveSaveActive);
    topBtn.innerHTML = (liveSaveActive ? "&#9632; " : "&#128190; ") + label;
  }
  if (badge) badge.classList.toggle("hidden", !liveSaveActive);
}

var liveSaveWaitTimer = null;
var liveSaveHintShown = false;

function maybeShowSaveClassHint() {
  if (!isClassroomHost() || liveSaveHintShown || liveSaveActive || liveSaveWaitTimer) return;
  liveSaveHintShown = true;
  addChatMessage("", "Tip: tap <strong>Record class</strong> to save this lesson on your device.", true);
}

function startLiveSave(stream) {
  liveSaveChunks = [];
  liveSaveStartedAt = Date.now();
  try {
    liveSaveRecorder = new MediaRecorder(stream, { mimeType: pickRecorderMimeType() });
  } catch (e) {
    liveSaveRecorder = new MediaRecorder(stream);
  }
  liveSaveRecorder.ondataavailable = function (ev) {
    if (ev.data && ev.data.size) liveSaveChunks.push(ev.data);
  };
  liveSaveRecorder.start(1000);
  liveSaveActive = true;
  updateSaveLiveUi();
  addChatMessage("", "Recording this class on your device. Tap <strong>Stop recording</strong> when finished.", true);
}

function waitForRemoteStreamAndSave(maxMs) {
  if (liveSaveWaitTimer) clearInterval(liveSaveWaitTimer);
  var started = Date.now();
  liveSaveWaitTimer = setInterval(function () {
    if (liveSaveActive) {
      clearInterval(liveSaveWaitTimer);
      liveSaveWaitTimer = null;
      return;
    }
    var stream = getRemoteClassMediaStream();
    if (!stream && typeof getLocalClassRecordStream === "function") {
      stream = getLocalClassRecordStream();
    }
    if (stream) {
      clearInterval(liveSaveWaitTimer);
      liveSaveWaitTimer = null;
      startLiveSave(stream);
      return;
    }
    if (Date.now() - started > maxMs) {
      clearInterval(liveSaveWaitTimer);
      liveSaveWaitTimer = null;
      addChatMessage("", "Teacher video/audio not connected yet. Tap Save class again when you can hear the lesson.", true);
    }
  }, 1500);
}

function pickRecorderMimeType() {
  var types = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  for (var i = 0; i < types.length; i++) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(types[i])) return types[i];
  }
  return "video/webm";
}

function toggleSaveLive() {
  if (!isClassroomHost()) return;
  if (liveSaveActive) {
    stopLiveSaveAndStore(true);
    return;
  }
  var stream = getRemoteClassMediaStream();
  if (!stream && typeof getLocalClassRecordStream === "function") {
    stream = getLocalClassRecordStream();
  }
  if (!stream) {
    addChatMessage("", "Waiting for student audio/video… recording will start when someone is live.", true);
    waitForRemoteStreamAndSave(45000);
    return;
  }
  startLiveSave(stream);
}

async function stopLiveSaveAndStore(showNotice) {
  if (!liveSaveActive && !liveSaveRecorder) return;
  liveSaveActive = false;
  updateSaveLiveUi();
  if (!liveSaveRecorder) return;
  var recorder = liveSaveRecorder;
  liveSaveRecorder = null;
  return new Promise(function (resolve) {
    recorder.onstop = async function () {
      try {
        if (!liveSaveChunks.length) {
          resolve();
          return;
        }
        var blob = new Blob(liveSaveChunks, { type: recorder.mimeType || "video/webm" });
        liveSaveChunks = [];
        var mins = liveSaveStartedAt ? Math.max(1, Math.round((Date.now() - liveSaveStartedAt) / 60000)) : 0;
        await saveLiveRecording({
          title: (liveSession && liveSession.title) || "Live class",
          subject: liveSession && liveSession.subject,
          teacher: liveSession && liveSession.teacher_name,
          class_id: liveSession && liveSession.class_id,
          duration_hint: mins ? (mins + " min") : "",
        }, blob);
        if (showNotice) {
          addChatMessage("", "Class saved on this device. Open <strong>Saved Lives</strong> in the app menu to watch again.", true);
        }
      } catch (e) {
        if (showNotice) addChatMessage("", "Could not save recording: " + e.message, true);
      }
      resolve();
    };
    try {
      recorder.stop();
    } catch (e) {
      resolve();
    }
  });
}

function syncStudentMediaControls() {
  if (isTeacherRole()) return;
  var micBtn = document.getElementById("btn-mic");
  var camBtn = document.getElementById("btn-cam");
  var micOk = window.studentMicAllowed === true;
  var camOk = window.studentCameraAllowed === true;
  if (micBtn) {
    micBtn.disabled = !micOk;
    micBtn.classList.toggle("media-locked", !micOk);
  }
  if (camBtn) {
    camBtn.disabled = !camOk;
    camBtn.classList.toggle("media-locked", !camOk);
  }
}
window.syncStudentMediaControls = syncStudentMediaControls;

function setVideoControlsEnabled(enabled) {
  var micBtn = document.getElementById("btn-mic");
  var camBtn = document.getElementById("btn-cam");
  var shareBtn = document.getElementById("btn-share");
  if (isTeacherRole()) {
    [micBtn, camBtn, shareBtn].forEach(function (btn) {
      if (btn) btn.disabled = !enabled;
    });
    return;
  }
  // Students: mic/cam depend on teacher grant — stay clickable so tap can reconnect video.
  var micOk = window.studentMicAllowed === true;
  var camOk = window.studentCameraAllowed === true;
  if (micBtn) {
    micBtn.disabled = !micOk;
    micBtn.classList.toggle("media-locked", !micOk);
  }
  if (camBtn) {
    camBtn.disabled = !camOk;
    camBtn.classList.toggle("media-locked", !camOk);
  }
}

function showAudioUnlockBanner() {
  if (window._sxAudioUnlockDismissed) return;
  var bar = document.getElementById("audio-unlock-banner");
  if (!bar || !bar.classList.contains("hidden")) return;
  window._sxAudioUnlockShown = true;
  var label = bar.querySelector("strong");
  if (label) {
    label.textContent = isTeacherRole() ? "Tap anywhere to hear students" : "Tap anywhere to hear your teacher";
  }
  bar.classList.remove("hidden");
}

function unlockClassAudio() {
  window._sxAudioUnlockDismissed = true;
  var bar = document.getElementById("audio-unlock-banner");
  if (bar) bar.classList.add("hidden");
  if (!isTeacherRole() && typeof reattachTeacherAudio === "function") {
    reattachTeacherAudio();
  }
  if (typeof reattachRemoteClassAudio === "function") {
    reattachRemoteClassAudio();
  }
  if (typeof ensureRoomAudioPlayback === "function") {
    ensureRoomAudioPlayback();
  }
}

function bindClassroomAudioUnlock() {
  var unlock = function () {
    unlockClassAudio();
  };
  document.body.addEventListener("click", unlock, { once: true, capture: true });
  document.body.addEventListener("touchstart", unlock, { once: true, capture: true, passive: true });
}

function updateMediaButton(btn, on) {
  if (!btn) return;
  btn.classList.toggle("off", !on);
  btn.classList.toggle("on", on);
}

function showMicMeter(show) {
  var meter = document.getElementById("mic-meter");
  if (meter) meter.classList.toggle("hidden", !show);
}

function showMicLiveBadge(show, text) {
  var badge = document.getElementById("mic-live-badge");
  if (!badge) return;
  if (typeof text === "string") badge.textContent = text;
  badge.classList.toggle("hidden", !show);
}

function updateAudienceStats() {
  var badge = document.getElementById("audience-badge");
  if (!badge || !isTeacherRole()) return;
  var inChat = wsStudentCount;
  var inVideo = countVideoAudience();
  var parts = [];
  if (inChat > 0) parts.push(inChat + " in chat");
  if (inVideo > 0) parts.push(inVideo + " on video");
  if (!parts.length) {
    badge.textContent = "No students yet";
    badge.classList.remove("hidden");
    return;
  }
  badge.textContent = parts.join(" · ");
  badge.classList.remove("hidden");
}

function updateMicAudienceBadge(level) {
  if (!isTeacherRole()) return;
  var audience = countVideoAudience();
  var inChat = wsStudentCount;
  var mode = window.LiveClassMedia ? LiveClassMedia.getMediaMode() : "none";
  var micOn = window.LiveClassMedia ? LiveClassMedia.getMicOn() : false;
  var joined = window.LiveClassMedia ? LiveClassMedia.isJoined() : false;
  if (mode === "local") {
    showMicLiveBadge(
      micOn && level > 8,
      inChat > 0
        ? "Mic on — students can't hear yet (" + inChat + " waiting)"
        : "Mic on — preview only (video not connected)"
    );
    return;
  }
  if (micOn && level > 8 && audience > 0) {
    showMicLiveBadge(true, audience + " student(s) can hear you");
  } else if (micOn && joined && audience === 0) {
    showMicLiveBadge(true, "Mic live — waiting for students to join video");
  } else {
    showMicLiveBadge(micOn && level > 8, "Students hear you");
  }
}

function stopMicMonitor() {
  if (micMonitorTimer) {
    clearInterval(micMonitorTimer);
    micMonitorTimer = null;
  }
  if (micMonitorCtx) {
    try { micMonitorCtx.close(); } catch (e) { /* ignore */ }
    micMonitorCtx = null;
  }
  showMicMeter(false);
  showMicLiveBadge(false);
}

function startMicMonitor(streamOrTrack) {
  stopMicMonitor();
  if (!streamOrTrack) return;

  var stream = streamOrTrack;
  if (streamOrTrack.getMediaStreamTrack) {
    stream = new MediaStream([streamOrTrack.getMediaStreamTrack()]);
  } else if (streamOrTrack.mediaStreamTrack) {
    stream = new MediaStream([streamOrTrack.mediaStreamTrack]);
  }

  try {
    micMonitorCtx = new (window.AudioContext || window.webkitAudioContext)();
    var source = micMonitorCtx.createMediaStreamSource(stream);
    var analyser = micMonitorCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    var data = new Uint8Array(analyser.frequencyBinCount);
    showMicMeter(true);

    micMonitorTimer = setInterval(function () {
      analyser.getByteFrequencyData(data);
      var sum = 0;
      for (var i = 0; i < data.length; i++) sum += data[i];
      var level = Math.min(100, Math.round((sum / data.length) * 1.4));
      var fill = document.getElementById("mic-meter-fill");
      if (fill) fill.style.width = level + "%";
      updateMicAudienceBadge(level);
    }, 80);
  } catch (e) { /* ignore */ }
}

  function startSelfHear(streamOrTrack) {
    stopSelfHear();
    /* Disabled — local mic playback caused echo for teacher and students. */
  }

function stopSelfHear() {
  if (!selfHearAudio) return;
  try {
    selfHearAudio.pause();
    selfHearAudio.srcObject = null;
    selfHearAudio.remove();
  } catch (e) { /* ignore */ }
  selfHearAudio = null;
}

function looksLikeUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "").trim()
  );
}

function normalizeStudentId(id) {
  return String(id || "").trim().toLowerCase();
}

function getStudentName() {
  return localStorage.getItem("sia_name") || "Student";
}

function applyRaisedHandNameToRoster(userId, name) {
  if (!userId || !name) return;
  var key = normalizeStudentId(userId);
  var display = String(name).trim();
  if (!display || display.toLowerCase() === "student") return;
  window.__participantNames = window.__participantNames || {};
  window.__participantNames[key] = display;
  if (Array.isArray(lastClassroomStudents)) {
    lastClassroomStudents.forEach(function (s) {
      if (s && normalizeStudentId(s.student_id) === key) {
        s.name = display;
      }
    });
  }
  if (isClassroomHost()) renderHostParticipantList(lastClassroomStudents);
}

function findStudentInRoster(userId) {
  var key = normalizeStudentId(userId);
  if (!Array.isArray(lastClassroomStudents)) return null;
  for (var i = 0; i < lastClassroomStudents.length; i++) {
    var s = lastClassroomStudents[i];
    if (s && normalizeStudentId(s.student_id) === key) return s;
  }
  return null;
}

function getStudentPermState(userId) {
  var s = findStudentInRoster(userId);
  return {
    mic_allowed: !!(s && s.mic_allowed),
    camera_allowed: !!(s && (s.camera_allowed || s.camera_on)),
    name: s ? resolveStudentDisplayName(s) : "Student",
  };
}

function buildRaisedHandActionsHtml(userId, displayName) {
  var perms = getStudentPermState(userId);
  var safeName = escHtml(displayName);
  var sid = escHtml(String(userId));
  var html = '<span class="raise-hand-actions">';
  if (!perms.mic_allowed) {
    html += '<button type="button" class="btn-hand-allow" data-hand-action="allow" data-user-id="' + sid +
      '" data-user-name="' + safeName + '" onclick="sxAllowSpeak(this)">Allow mic</button>';
  } else {
    html += '<button type="button" class="btn-hand-mute" data-user-id="' + sid +
      '" onclick="sxMuteStudent(this)">Mute</button>';
  }
  if (!perms.camera_allowed) {
    html += '<button type="button" class="btn-hand-cam" data-user-id="' + sid +
      '" onclick="sxAllowCam(this)">Allow cam</button>';
  } else {
    html += '<button type="button" class="btn-hand-cam-off" data-user-id="' + sid +
      '" onclick="sxRevokeCam(this)">Cam off</button>';
  }
  html += '<button type="button" class="btn-hand-lower" data-hand-action="lower" data-user-id="' + sid +
    '" onclick="sxLowerHand(this)">Lower</button>';
  html += "</span>";
  return html;
}

function buildRaisedHandsHtml() {
  var ids = Object.keys(raisedHands);
  if (!ids.length) return '<p class="raise-hand-empty">No students waiting.</p>';
  return ids.map(function (id, idx) {
    var item = raisedHands[id];
    var name = resolveStudentDisplayName({ student_id: id, name: item.name });
    var safeName = escHtml(name);
    return '<div class="raise-hand-item">' +
      '<span><span class="hand-rank">' + (idx + 1) + '.</span>&#9995; ' + safeName + '</span>' +
      buildRaisedHandActionsHtml(id, name) +
      "</div>";
  }).join("");
}

function bindRaisedHandActions() {
  var roots = [
    document.getElementById("host-sidebar"),
    document.getElementById("raise-hand-panel"),
    document.getElementById("meet-bottom-panel"),
  ];
  roots.forEach(function (root) {
    if (!root || root.dataset.handActionsBound === "1") return;
    root.dataset.handActionsBound = "1";
    root.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-hand-action]");
      if (!btn || !isClassroomHost()) return;
      e.preventDefault();
      e.stopPropagation();
      var uid = btn.getAttribute("data-user-id");
      var uname = btn.getAttribute("data-user-name") || "Student";
      var action = btn.getAttribute("data-hand-action");
      if (action === "allow") grantStudentMic(uid, uname);
      else if (action === "lower") lowerHandForStudent(uid);
    });
  });
  if (!window.__sxHandDocBound) {
    window.__sxHandDocBound = true;
    document.addEventListener("click", function (e) {
      if (!isClassroomHost()) return;
      var allowBtn = e.target.closest(".btn-hand-allow");
      if (allowBtn) {
        e.preventDefault();
        e.stopPropagation();
        grantStudentMic(
          allowBtn.getAttribute("data-user-id") || allowBtn.getAttribute("data-uid"),
          allowBtn.getAttribute("data-user-name") || allowBtn.getAttribute("data-name") || "Student"
        );
        return;
      }
      var lowerBtn = e.target.closest(".btn-hand-lower");
      if (lowerBtn) {
        e.preventDefault();
        e.stopPropagation();
        lowerHandForStudent(lowerBtn.getAttribute("data-user-id") || lowerBtn.getAttribute("data-uid"));
      }
    }, true);
  }
}

function resolveStudentDisplayName(s) {
  if (!s) return "Student";
  var sid = normalizeStudentId(s.student_id || s.userId || s.user_id || "");
  var n = (s.name || "").trim();
  if (n && n.toLowerCase() !== "student" && !looksLikeUuid(n)) return n;
  if (sid) {
    Object.keys(raisedHands).forEach(function (k) {
      if (normalizeStudentId(k) !== sid) return;
      var rh = raisedHands[k];
      if (rh && rh.name && rh.name.toLowerCase() !== "student" && !looksLikeUuid(rh.name)) {
        n = rh.name;
      }
    });
    if (n && n.toLowerCase() !== "student" && !looksLikeUuid(n)) return n;
  }
  if (sid && raisedHands[sid] && raisedHands[sid].name &&
      raisedHands[sid].name.toLowerCase() !== "student" &&
      !looksLikeUuid(raisedHands[sid].name)) {
    return raisedHands[sid].name;
  }
  var names = window.__participantNames || {};
  var nameHit = names[sid];
  if (!nameHit) {
    Object.keys(names).some(function (k) {
      if (normalizeStudentId(k) === sid) {
        nameHit = names[k];
        return true;
      }
      return false;
    });
  }
  if (nameHit && !looksLikeUuid(nameHit)) return nameHit;
  try {
    var remotes = liveKitRosterFallback();
    for (var i = 0; i < remotes.length; i++) {
      var r = remotes[i];
      if (normalizeStudentId(r.student_id || "") === sid && r.name &&
          r.name.toLowerCase() !== "student" && !looksLikeUuid(r.name)) {
        return r.name;
      }
    }
  } catch (e) { /* ignore */ }
  return "Student";
}
window.resolveStudentDisplayName = resolveStudentDisplayName;

function renderRaisedHands() {
  if (!isClassroomHost()) return;
  var html = buildRaisedHandsHtml();
  var list = document.getElementById("raise-hand-list");
  var bottom = document.getElementById("raise-hand-list-bottom");
  if (list) list.innerHTML = html;
  if (bottom) bottom.innerHTML = html;
  var count = Object.keys(raisedHands).length;
  var tabBadge = document.getElementById("hands-tab-badge");
  var sideBadge = document.getElementById("hands-side-badge");
  if (tabBadge) {
    tabBadge.textContent = String(count);
    tabBadge.classList.toggle("hidden", count === 0);
  }
  if (sideBadge) sideBadge.textContent = "(" + count + ")";
  bindRaisedHandActions();
}

function addRaisedHand(userId, name) {
  if (!userId || !isClassroomHost()) return;
  var uid = normalizeStudentId(userId);
  var display = (name || "").trim();
  if (!raisedHands[uid]) {
    raisedHands[uid] = { name: display || "Student", at: Date.now() };
  } else {
    raisedHands[uid].name = display || raisedHands[uid].name || "Student";
  }
  if (display && display.toLowerCase() !== "student") {
    window.__participantNames = window.__participantNames || {};
    window.__participantNames[uid] = display;
    applyRaisedHandNameToRoster(userId, display);
  }
  var panel = document.getElementById("raise-hand-panel");
  if (panel) panel.classList.remove("hidden");
  renderRaisedHands();
  renderRaisedHandToolbarBadge();
  if (isClassroomHost()) renderHostParticipantList(lastClassroomStudents);
}

function removeRaisedHand(userId) {
  delete raisedHands[normalizeStudentId(userId)];
  renderRaisedHands();
  renderRaisedHandToolbarBadge();
}

function lowerHandForStudent(userId) {
  if (!userId) return;
  removeRaisedHand(userId);
  if (liveSocket && liveSocket.readyState === WebSocket.OPEN) {
    liveSocket.send(JSON.stringify({
      event: "lower_hand",
      target_user_id: userId,
    }));
  }
}
window.lowerHandForStudent = lowerHandForStudent;

function lowerAllHands() {
  if (!isClassroomHost()) return;
  raisedHands = {};
  window.raisedHands = raisedHands;
  renderRaisedHands();
  renderRaisedHandToolbarBadge();
  if (liveSocket && liveSocket.readyState === WebSocket.OPEN) {
    liveSocket.send(JSON.stringify({ event: "lower_all_hands" }));
  }
  showClassroomToast("All hands lowered");
}
window.lowerAllHands = lowerAllHands;

function renderRaisedHandToolbarBadge() {
  renderRaisedHands();
}

function getMyClassroomUserId() {
  var payload = parseJwt(getAuthToken());
  return payload.sub || (liveSession && (liveSession.identity || liveSession.user_id)) || "";
}

function isMicEventForMe(msg) {
  if (!msg) return false;
  var mine = String(getMyClassroomUserId() || "").toLowerCase();
  var target = String(msg.user_id || msg.target_user_id || "").toLowerCase();
  if (!target) return true;
  return target === mine;
}

function formatGrantError(detail, fallback) {
  if (!detail) return fallback || "Request failed";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail.map(function (d) { return (d && d.msg) || String(d); }).join(", ");
  }
  if (typeof detail === "object" && detail.msg) return detail.msg;
  try { return JSON.stringify(detail); } catch (e) { return fallback || "Request failed"; }
}

async function classroomHostApi(path, options, errorFallback) {
  options = options || {};
  var tok = localStorage.getItem("sia_teacher_token") || localStorage.getItem("sia_admin_token") || getAuthToken();
  if (!tok) throw new Error("Not signed in as teacher — open the class from the teacher dashboard");
  var res = await fetch(API_BASE + path, {
    method: options.method || "GET",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok },
    body: options.body,
  });
  var data = await res.json().catch(function () { return {}; });
  if (!res.ok) {
    var msg = formatGrantError(data.detail, errorFallback) ||
      (data.message ? String(data.message) : "") ||
      "Request failed (" + res.status + ")";
    throw new Error(msg);
  }
  return data;
}

async function grantStudentMic(userId, studentName) {
  if (!isClassroomHost() || !userId) {
    showClassroomToast("Only the teacher can allow students to speak.", true);
    return;
  }
  var classId = liveSession.class_id || liveSession.classId;
  if (!classId) {
    showClassroomToast("Class session not found. Re-enter the classroom.", true);
    return;
  }
  var uidRaw = String(userId).trim();
  var uidKey = normalizeStudentId(uidRaw);
  var name = studentName || (raisedHands[uidKey] && raisedHands[uidKey].name) || "Student";
  showClassroomToast("Allowing " + name + " to speak…");
  var ok = false;
  var errMsg = "";
  var wsSent = false;
  if (liveSocket && liveSocket.readyState === WebSocket.OPEN) {
    liveSocket.send(JSON.stringify({ event: "grant_mic", target_user_id: uidRaw }));
    wsSent = true;
  } else {
    showClassroomToast("Chat not connected — reconnecting…", true);
    try { connectChat(true); } catch (eC) { /* ignore */ }
  }
  try {
    await classroomHostApi(
      "/api/v1/live-classes/" + classId + "/students/" + encodeURIComponent(uidRaw) + "/unmute",
      { method: "POST" },
      "Could not allow student to speak"
    );
    ok = true;
  } catch (e) {
    errMsg = e.message || "Server error";
    if (wsSent) ok = true;
  }
  if (ok) {
    removeRaisedHand(uidKey);
    window.__participantNames = window.__participantNames || {};
    window.__participantNames[uidKey] = name;
    showClassroomToast("Done — " + name + " can speak now");
    addChatMessage("", name + " can now use the microphone.", true);
    if (typeof ensureRoomAudioPlayback === "function") ensureRoomAudioPlayback();
    await loadClassroomStudents(true);
    setTimeout(function () {
      if (typeof reattachRemoteClassAudio === "function") reattachRemoteClassAudio();
      if (typeof ensureRoomAudioPlayback === "function") ensureRoomAudioPlayback();
    }, 600);
    return;
  }
  showClassroomToast("Could not allow " + name + ": " + errMsg, true);
  addChatMessage("", "Could not allow " + name + " to speak: " + errMsg, true);
}

async function grantStudentAccess(userId, studentName) {
  return grantStudentMic(userId, studentName);
}

async function giveAccessToWaitingStudents() {
  if (!isTeacherRole()) return;
  var ids = Object.keys(raisedHands);
  if (!ids.length) {
    addChatMessage("", "No raised hands — students tap Raise hand when they want to speak.", true);
    return;
  }
  for (var i = 0; i < ids.length; i++) {
    await grantStudentAccess(ids[i], raisedHands[ids[i]] && raisedHands[ids[i]].name);
  }
}

async function revokeStudentMic(userId) {
  if (!isClassroomHost() || !userId) return;
  var classId = liveSession.class_id || liveSession.classId;
  if (!classId) return;
  var uidRaw = String(userId).trim();
  var name = (findStudentInRoster(uidRaw) && resolveStudentDisplayName(findStudentInRoster(uidRaw))) || "Student";
  showClassroomToast("Muting " + name + "…");
  try {
    if (liveSocket && liveSocket.readyState === WebSocket.OPEN) {
      liveSocket.send(JSON.stringify({ event: "revoke_mic", target_user_id: uidRaw }));
    }
    await classroomHostApi(
      "/api/v1/live-classes/" + classId + "/students/" + encodeURIComponent(uidRaw) + "/mute",
      { method: "POST" }
    );
    showClassroomToast(name + " muted");
    addChatMessage("", name + " microphone muted.", true);
    await loadClassroomStudents(true);
  } catch (e) {
    showClassroomToast("Could not mute: " + (e.message || "Try again."), true);
    addChatMessage("", "Could not mute student: " + (e.message || "Try again."), true);
  }
}

async function grantStudentCamera(userId) {
  if (!isClassroomHost() || !userId) return;
  var classId = liveSession.class_id || liveSession.classId;
  if (!classId) {
    showClassroomToast("Class session not found. Re-enter the classroom.", true);
    return;
  }
  var uidRaw = String(userId).trim();
  var rosterHit = findStudentInRoster(uidRaw);
  if (rosterHit && rosterHit.student_id) uidRaw = String(rosterHit.student_id).trim();
  var name = (rosterHit && resolveStudentDisplayName(rosterHit)) || "Student";
  showClassroomToast("Allowing " + name + " camera…");
  var wsSent = false;
  if (liveSocket && liveSocket.readyState === WebSocket.OPEN) {
    liveSocket.send(JSON.stringify({ event: "grant_camera", target_user_id: uidRaw }));
    wsSent = true;
  }
  try {
    await classroomHostApi(
      "/api/v1/live-classes/" + classId + "/students/" + encodeURIComponent(uidRaw) + "/allow-camera",
      { method: "POST" },
      "Could not allow camera"
    );
    showClassroomToast(name + " can use camera");
    addChatMessage("", name + " can turn on camera now.", true);
    await loadClassroomStudents(true);
    if (typeof window.scheduleReattachParticipantVideos === "function") {
      window.scheduleReattachParticipantVideos();
    }
  } catch (e) {
    if (wsSent) {
      showClassroomToast(name + " camera allowed — student can tap Cam");
      addChatMessage("", name + " can turn on camera (via live chat).", true);
      await loadClassroomStudents(true);
      return;
    }
    showClassroomToast("Could not allow camera: " + (e.message || "Try again."), true);
    addChatMessage("", "Could not allow camera: " + (e.message || "Try again."), true);
  }
}

async function revokeStudentCamera(userId) {
  if (!isClassroomHost() || !userId) return;
  var classId = liveSession.class_id || liveSession.classId;
  if (!classId) return;
  var uidRaw = String(userId).trim();
  var name = (findStudentInRoster(uidRaw) && resolveStudentDisplayName(findStudentInRoster(uidRaw))) || "Student";
  showClassroomToast("Revoking " + name + " camera…");
  try {
    if (liveSocket && liveSocket.readyState === WebSocket.OPEN) {
      liveSocket.send(JSON.stringify({ event: "revoke_camera", target_user_id: uidRaw }));
    }
    await classroomHostApi(
      "/api/v1/live-classes/" + classId + "/students/" + encodeURIComponent(uidRaw) + "/revoke-camera",
      { method: "POST" }
    );
    showClassroomToast(name + " camera off");
    addChatMessage("", name + " camera access removed.", true);
    await loadClassroomStudents(true);
  } catch (e) {
    showClassroomToast("Could not revoke camera: " + (e.message || "Try again."), true);
    addChatMessage("", "Could not revoke camera: " + (e.message || "Try again."), true);
  }
}

function buildParticipantCardHtml(s) {
  var sid = String(s.student_id || "");
  var raised = raisedHands[sid] || raisedHands[sid.toLowerCase()];
  var displayName = resolveStudentDisplayName(s);
  var initial = displayName.charAt(0).toUpperCase();
  var micOn = s.mic_allowed;
  var camOn = s.camera_allowed;
  var camLive = !!s.camera_enabled;
  var conn = String(s.connection_state || "CONNECTED").toUpperCase();
  var micLabel = micOn ? "🎤 On" : "🎤 Off";
  var camLabel = camLive ? "📷 Live" : (camOn ? "📷 Ready" : "📷 Off");
  var handLabel = raised ? '<span>✋ Raised</span>' : "";
  var joined = s.joined_at ? '<span>Joined ' + formatParticipantTime(s.joined_at) + "</span>" : "";
  var connClass = conn === "CONNECTED" ? "connected" : "";
  var connLabel = conn === "RECONNECTING" ? "Reconnecting…" :
    conn === "CONNECTING" ? "Connecting…" :
    conn === "DISCONNECTED" ? "Offline" : "";
  var cardMods = (raised ? " raised" : "") +
    (camLive ? " camera-on" : "") +
    (conn === "RECONNECTING" || conn === "CONNECTING" ? " is-reconnecting" : "") +
    (s.is_speaking ? " is-speaking" : "");
  var hostActions = "";
  if (isTeacherRole()) {
    hostActions = '<div class="participant-actions">' +
      (micOn
        ? '<button type="button" data-action="mute-student" data-student-id="' + escHtml(sid) + '">Mute</button>'
        : '<button type="button" class="btn-give-access btn-allow-speak" data-action="allow-speak" data-student-id="' +
          escHtml(sid) + '" data-student-name="' + escHtml(s.name || "Student") + '">Allow to speak</button>') +
      (camOn
        ? '<button type="button" data-action="revoke-cam" data-student-id="' + escHtml(sid) + '">Revoke cam</button>'
        : '<button type="button" data-action="allow-cam" data-student-id="' + escHtml(sid) + '">Allow cam</button>') +
      (raised
        ? '<button type="button" onclick="lowerHandForStudent(' + JSON.stringify(sid) + ')">Lower hand</button>'
        : "") +
      '<button type="button" data-action="spotlight-student" data-student-id="' + escHtml(sid) + '">Spotlight</button>' +
      '<button type="button" data-action="remove-student" data-student-id="' + escHtml(sid) + '">Remove</button>' +
      "</div>";
  }
  return '<article class="participant-card' + cardMods + '" data-student-id="' + escHtml(sid) + '" data-camera-on="' + (camLive ? "1" : "0") + '">' +
    (connLabel ? '<span class="participant-conn ' + connClass + '">' + connLabel + "</span>" : "") +
    '<div id="participant-reaction-' + escHtml(sid) + '" class="participant-reaction hidden" aria-hidden="true"></div>' +
    '<div id="participant-video-' + escHtml(sid) + '" class="participant-video' + (camLive ? "" : " hidden") + '"></div>' +
    '<div class="participant-details">' +
    '<div class="participant-details-row">' +
    '<div class="participant-avatar" aria-hidden="true">' + escHtml(initial) + "</div>" +
    '<div class="participant-body"><strong>' + escHtml(displayName) + "</strong>" +
    '<div class="participant-status"><span>' + micLabel + "</span><span>" + camLabel + "</span>" + handLabel + joined + "</div>" +
    hostActions + "</div></div></div></article>";
}

function updateParticipantCardContent(card, s) {
  if (!card || !s) return;
  card.classList.toggle("raised", !!raisedHands[s.student_id]);
  card.classList.toggle("camera-on", !!(s.camera_enabled || s.camera_allowed));
  card.setAttribute("data-camera-on", (s.camera_enabled || s.camera_allowed) ? "1" : "0");
  var strong = card.querySelector(".participant-body > strong");
  if (strong) strong.textContent = resolveStudentDisplayName(s);
  var status = card.querySelector(".participant-status");
  if (status) {
    var micLabel = s.mic_allowed ? "🎤 On" : "🎤 Off";
    var camLabel = (s.camera_enabled || s.camera_allowed) ? "📷 Live" : "📷 Off";
    var handLabel = raisedHands[s.student_id] ? '<span>✋ Raised</span>' : "";
    var joined = s.joined_at ? '<span>Joined ' + formatParticipantTime(s.joined_at) + "</span>" : "";
    var statusHtml = "<span>" + micLabel + "</span><span>" + camLabel + "</span>" + handLabel + joined;
    if (status.innerHTML !== statusHtml) status.innerHTML = statusHtml;
  }
  var actions = card.querySelector(".participant-actions");
  if (isTeacherRole()) {
    var sid = String(s.student_id || "");
    var raised = raisedHands[sid] || raisedHands[sid.toLowerCase()];
    var stateKey = sid + "|" + (s.mic_allowed ? "1" : "0") + "|" + (s.camera_allowed ? "1" : "0") + "|" + (raised ? "1" : "0");
    if (actions && actions.dataset.stateKey === stateKey) return;
    var html = (s.mic_allowed
      ? '<button type="button" data-action="mute-student" data-student-id="' + escHtml(sid) + '">Mute</button>'
      : '<button type="button" class="btn-give-access btn-allow-speak" data-action="allow-speak" data-student-id="' +
        escHtml(sid) + '" data-student-name="' + escHtml(s.name || "Student") + '">Allow to speak</button>') +
      (s.camera_allowed
        ? '<button type="button" data-action="revoke-cam" data-student-id="' + escHtml(sid) + '">Revoke cam</button>'
        : '<button type="button" data-action="allow-cam" data-student-id="' + escHtml(sid) + '">Allow cam</button>') +
      (raised
        ? '<button type="button" onclick="lowerHandForStudent(' + JSON.stringify(sid) + ')">Lower hand</button>'
        : "") +
      '<button type="button" data-action="spotlight-student" data-student-id="' + escHtml(sid) + '">Spotlight</button>' +
      '<button type="button" data-action="remove-student" data-student-id="' + escHtml(sid) + '">Remove</button>';
    if (!actions) {
      var body = card.querySelector(".participant-body");
      if (body) {
        actions = document.createElement("div");
        actions.className = "participant-actions";
        body.appendChild(actions);
      }
    }
    if (actions) {
      actions.innerHTML = html;
      actions.dataset.stateKey = stateKey;
    }
  }
}

function renderClassroomStudents(students) {
  var list = document.getElementById("participants-list");
  var legacyList = document.getElementById("class-students-list");
  if (!list && !legacyList) return;
  if (!isTeacherRole() && list) {
    renderParticipantsForStudent(students);
    return;
  }
  if (!list) {
    if (!legacyList) return;
    list = legacyList;
  }
  var scrollTop = list.scrollTop;
  if (!students || !students.length) {
    if (!list.querySelector(".participant-card[data-student-id]")) {
      list.innerHTML = '<p class="participants-empty">No students in class yet.</p>';
    }
    updateParticipantsHeader(0, liveSession && liveSession.teacher_name);
    return;
  }

  var empty = list.querySelector(".participants-empty");
  if (empty) empty.remove();

  var existing = {};
  var needsReattach = false;
  list.querySelectorAll(".participant-card[data-student-id]").forEach(function (card) {
    existing[card.getAttribute("data-student-id")] = card;
  });
  var seen = {};
  students.forEach(function (s) {
    var sid = String(s.student_id || "");
    if (!sid) return;
    seen[sid] = true;
    var card = existing[sid];
    if (!card) {
      var wrap = document.createElement("div");
      wrap.innerHTML = buildParticipantCardHtml(s);
      card = wrap.firstChild;
      list.appendChild(card);
      needsReattach = true;
    } else {
      updateParticipantCardContent(card, s);
    }
  });
  Object.keys(existing).forEach(function (sid) {
    if (!seen[sid]) {
      if (typeof detachParticipantCameraVideo === "function") {
        detachParticipantCameraVideo(sid);
      }
      existing[sid].remove();
      needsReattach = true;
    }
  });
  list.scrollTop = scrollTop;
  var cardCount = list.querySelectorAll(".participant-card[data-student-id]").length;
  list.setAttribute("data-count", String(Math.min(cardCount, 6) || 0));
  updateParticipantsHeader(students.length, liveSession && liveSession.teacher_name);
  if (needsReattach && typeof window.reattachParticipantVideos === "function") {
    window.reattachParticipantVideos();
  }
  if (typeof flushPendingStudentVideos === "function") {
    flushPendingStudentVideos();
  }
  bindParticipantActionClicks();
  if (isTeacherRole()) renderHostParticipantList(students);
}

function enrichStudentsWithKnownNames(students) {
  if (!students || !students.length) return students || [];
  var names = window.__participantNames || {};
  return students.map(function (s) {
    if (!s) return s;
    var sid = normalizeStudentId(s.student_id || "");
    var best = resolveStudentDisplayName(s);
    if (best && best.toLowerCase() !== "student") {
      return Object.assign({}, s, { name: best });
    }
    if (sid && names[sid] && names[sid].toLowerCase() !== "student") {
      return Object.assign({}, s, { name: names[sid] });
    }
    return s;
  });
}

function buildHostParticipantRowHtml(s, isTeacher) {
  if (isTeacher) {
    return '<div class="host-participant-row host-teacher" data-name="teacher">' +
      '<span class="host-part-avatar">T</span>' +
      '<span class="host-part-name">' + escHtml(s.name || "Teacher") + "</span>" +
      '<span class="host-part-icons"><span class="icon-on">🎤</span><span class="icon-on">📷</span></span></div>';
  }
  var sidRaw = String(s.student_id || "");
  var sid = normalizeStudentId(sidRaw);
  var micOn = !!(s.mic_allowed || s.mic_on);
  var camOn = !!(s.camera_allowed || s.camera_on);
  Object.keys(raisedHands).forEach(function (k) {
    if (normalizeStudentId(k) === sid && raisedHands[k] && raisedHands[k].name) {
      var rn = String(raisedHands[k].name).trim();
      if (rn && rn.toLowerCase() !== "student" && !looksLikeUuid(rn)) displayName = rn;
    }
  });
  var displayName = resolveStudentDisplayName(s);
  return '<div class="host-participant-row" data-student-id="' + escHtml(sidRaw || sid) + '" data-name="' +
    escHtml(displayName.toLowerCase()) + '">' +
    '<span class="host-part-avatar">' + escHtml(displayName.charAt(0).toUpperCase()) + "</span>" +
    '<span class="host-part-name">' + escHtml(displayName) + "</span>" +
    '<span class="host-part-icons">' +
    '<span class="' + (micOn ? "icon-on" : "icon-off") + '">🎤</span>' +
    '<span class="' + (camOn ? "icon-on" : "icon-off") + '">📷</span></span>' +
    '<span class="host-part-actions">' +
    (micOn
      ? '<button type="button" class="host-part-btn btn-mute" data-user-id="' + escHtml(sidRaw || sid) + '" onclick="sxMuteStudent(this)">Mute</button>'
      : '<button type="button" class="host-part-btn btn-allow" data-user-id="' + escHtml(sidRaw || sid) + '" data-user-name="' + escHtml(displayName) + '" onclick="sxAllowSpeak(this)">Mic</button>') +
    (camOn
      ? '<button type="button" class="host-part-btn btn-cam-off" data-user-id="' + escHtml(sidRaw || sid) + '" onclick="sxRevokeCam(this)">Cam off</button>'
      : '<button type="button" class="host-part-btn btn-cam" data-user-id="' + escHtml(sidRaw || sid) + '" onclick="sxAllowCam(this)">Cam</button>') +
    "</span></div>";
}

function renderHostParticipantList(students) {
  if (!isClassroomHost()) return;
  var list = document.getElementById("host-participants-list");
  if (!list) return;
  lastClassroomStudents = enrichStudentsWithKnownNames(students || []);
  var q = (hostParticipantFilter || "").trim().toLowerCase();
  var filtered = lastClassroomStudents.filter(function (s) {
    if (!q) return true;
    var label = resolveStudentDisplayName(s);
    return label.toLowerCase().indexOf(q) >= 0 || (s.name || "").toLowerCase().indexOf(q) >= 0;
  });
  var teacherName = liveSession && liveSession.teacher_name || "Teacher";
  var html = buildHostParticipantRowHtml({ name: teacherName }, true);
  if (!filtered.length && q) {
    html += '<p class="participants-empty">No match.</p>';
  } else {
    html += filtered.map(function (s) { return buildHostParticipantRowHtml(s, false); }).join("");
  }
  list.innerHTML = html;
  var countEl = document.getElementById("host-participants-count");
  if (countEl) countEl.textContent = "(" + (lastClassroomStudents.length + 1) + ")";
}

function filterHostParticipants(value) {
  hostParticipantFilter = value || "";
  renderHostParticipantList(lastClassroomStudents);
}
window.filterHostParticipants = filterHostParticipants;

function bindParticipantActionClicks() {
  var list = document.getElementById("participants-list");
  if (!list || list.dataset.actionsBound === "1") return;
  list.dataset.actionsBound = "1";
  list.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-action]");
    if (!btn || !isClassroomHost()) return;
    e.preventDefault();
    e.stopPropagation();
    var sid = btn.getAttribute("data-student-id");
    var sname = btn.getAttribute("data-student-name") || "Student";
    var action = btn.getAttribute("data-action");
    if (action === "allow-speak") grantStudentMic(sid, sname);
    else if (action === "mute-student") revokeStudentMic(sid);
    else if (action === "allow-cam") grantStudentCamera(sid);
    else if (action === "revoke-cam") revokeStudentCamera(sid);
    else if (action === "spotlight-student") spotlightStudent(sid);
    else if (action === "remove-student") removeStudentFromClass(sid);
  });
}

function setParticipantCameraOn(studentId, on) {
  if (!studentId) return;
  var card = findParticipantCard(studentId);
  if (card) card.classList.toggle("camera-on", !!on);
}

function attachParticipantCameraVideo(studentId, track) {
  if (!studentId || !track) return;
  window.__pendingStudentVideos = window.__pendingStudentVideos || {};
  if (isTeacherRole() && typeof ensureParticipantCardForStudent === "function") {
    ensureParticipantCardForStudent(studentId, "Student");
  }
  var slot = findParticipantVideoSlot(studentId);
  if (!slot) {
    window.__pendingStudentVideos[studentId] = track;
    if (isTeacherRole() && typeof refreshLiveKitRosterDebounced === "function") {
      refreshLiveKitRosterDebounced();
    }
    return;
  }
  delete window.__pendingStudentVideos[studentId];
  // Reuse existing attached video element when possible (avoids flicker at scale).
  var existing = slot.querySelector("video.participant-video-el");
  if (existing && existing.srcObject) {
    try {
      var same = false;
      if (track.mediaStreamTrack && existing.srcObject.getVideoTracks) {
        var tracks = existing.srcObject.getVideoTracks();
        same = tracks.length && tracks[0].id === track.mediaStreamTrack.id;
      }
      if (same) {
        slot.classList.remove("hidden");
        setParticipantCameraOn(studentId, true);
        return;
      }
    } catch (e) { /* remount below */ }
  }
  slot.innerHTML = "";
  var el = track.attach();
  el.className = "participant-video-el";
  el.muted = true;
  el.autoplay = true;
  el.playsInline = true;
  slot.appendChild(el);
  slot.classList.remove("hidden");
  setParticipantCameraOn(studentId, true);
  updateCamRailLayout();
  if (typeof updateSpotlightStudentStage === "function") updateSpotlightStudentStage();
  var playPromise = el.play && el.play();
  if (playPromise && playPromise.catch) {
    playPromise.catch(function () { /* autoplay policy */ });
  }
}

function flushPendingStudentVideos() {
  var pending = window.__pendingStudentVideos || {};
  Object.keys(pending).forEach(function (studentId) {
    attachParticipantCameraVideo(studentId, pending[studentId]);
  });
}

function detachParticipantCameraVideo(studentId) {
  if (!studentId) return;
  var sid = String(studentId);
  var rail = document.getElementById("student-cam-rail");
  if (rail) {
    var tile = rail.querySelector('[data-rail-student-id="' + sid + '"]');
    if (tile) tile.remove();
    if (!rail.querySelector(".cam-rail-tile")) rail.classList.add("hidden");
    updateCamRailLayout();
  }
  var slot = document.getElementById("participant-video-" + sid);
  if (!slot) {
    var card = findParticipantCard(sid);
    if (card) slot = card.querySelector(".participant-video");
  }
  if (slot) {
    var vids = slot.querySelectorAll("video");
    vids.forEach(function (v) {
      try {
        if (v.srcObject) v.srcObject.getTracks().forEach(function (t) { t.stop(); });
      } catch (e) { /* ignore */ }
    });
    slot.innerHTML = "";
    slot.classList.add("hidden");
  }
  setParticipantCameraOn(studentId, false);
}

function isParticipantVideoLive(entry) {
  if (!entry || !entry.track || !entry.publication) return false;
  if (entry.publication.isMuted || entry.track.isMuted) return false;
  if (!entry.publication.track) return false;
  return true;
}

window.attachParticipantCameraVideo = attachParticipantCameraVideo;
window.detachParticipantCameraVideo = detachParticipantCameraVideo;
window.setParticipantCameraOn = setParticipantCameraOn;
window.isParticipantVideoLive = isParticipantVideoLive;

function renderParticipantsForStudent(students) {
  /* Student view: teacher video fills stage; no participant strip. */
  updateParticipantsHeader((students || []).length, liveSession && (liveSession.teacher_name || liveSession.teacher));
}

function refreshLiveKitRoster() {
  if (!liveSession) return;
  loadClassroomStudents(true);
  if (typeof flushPendingStudentVideos === "function") {
    flushPendingStudentVideos();
  }
  if (typeof window.scheduleReattachParticipantVideos === "function") {
    window.scheduleReattachParticipantVideos();
  } else if (typeof window.reattachParticipantVideos === "function") {
    window.reattachParticipantVideos();
  }
}

window.refreshLiveKitRoster = refreshLiveKitRoster;
window.refreshLiveKitRosterDebounced = refreshLiveKitRosterDebounced;

function formatParticipantTime(iso) {
  try {
    var d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch (e) {
    return "";
  }
}

function updateParticipantsHeader(studentCount, teacherName) {
  var countEl = document.getElementById("participants-count");
  var badge = document.getElementById("audience-badge");
  var total = (studentCount || 0) + 1;
  if (countEl) countEl.textContent = "(" + total + ")";
  if (badge && !classElapsedTimer) {
    badge.textContent = total + " in class";
  }
}

function toggleChatDrawer(forceOpen) {
  if (typeof forceOpen === "boolean" && !forceOpen) {
    collapseMeetChatPanel(true);
    return;
  }
  toggleMeetChatPanel();
}

function switchMeetTab(tab) {
  activeMeetTab = tab || "chat";
  document.querySelectorAll(".meet-tab").forEach(function (btn) {
    btn.classList.toggle("is-active", btn.getAttribute("data-tab") === activeMeetTab);
  });
  var chatPanel = document.getElementById("meet-panel-chat");
  var handsPanel = document.getElementById("meet-panel-hands");
  if (chatPanel) chatPanel.classList.toggle("hidden", activeMeetTab !== "chat");
  if (handsPanel) handsPanel.classList.toggle("hidden", activeMeetTab !== "hands");
  if (activeMeetTab === "chat") {
    collapseMeetChatPanel(false);
    clearChatUnread();
    try {
      var input = document.getElementById("chat-input");
      if (input) setTimeout(function () { input.focus(); }, 120);
    } catch (e) { /* ignore */ }
  }
}
window.switchMeetTab = switchMeetTab;

function collapseMeetChatPanel(collapse) {
  var panel = document.querySelector(".meet-bottom-panel");
  if (!panel) return;
  var hide = typeof collapse === "boolean" ? collapse : !panel.classList.contains("collapsed");
  panel.classList.toggle("collapsed", hide);
  try { sessionStorage.setItem("sx_meet_chat_collapsed", hide ? "1" : "0"); } catch (e) {}
}
window.collapseMeetChatPanel = collapseMeetChatPanel;

function toggleMeetChatPanel() {
  var panel = document.querySelector(".meet-bottom-panel");
  if (!panel) return;
  collapseMeetChatPanel(!panel.classList.contains("collapsed"));
  if (!panel.classList.contains("collapsed")) switchMeetTab("chat");
}
window.toggleMeetChatPanel = toggleMeetChatPanel;

function toggleParticipantStrip(forceShow) {
  var wrap = document.getElementById("meet-strip-wrap");
  if (!wrap) return;
  var hidden;
  if (typeof forceShow === "boolean") hidden = !forceShow;
  else hidden = !wrap.classList.contains("strip-hidden");
  wrap.classList.toggle("strip-hidden", hidden);
  var btn = wrap.querySelector(".meet-strip-toggle");
  if (btn) btn.textContent = hidden ? "Show people" : "Hide people";
  try { sessionStorage.setItem("sx_meet_strip_hidden", hidden ? "1" : "0"); } catch (e) {}
}
window.toggleParticipantStrip = toggleParticipantStrip;

function toggleHostSidebar(forceShow) {
  var side = document.getElementById("host-sidebar");
  if (!side) return;
  var show = typeof forceShow === "boolean" ? forceShow : side.classList.contains("hidden");
  side.classList.toggle("hidden", !show);
}
window.toggleHostSidebar = toggleHostSidebar;

function startClassElapsedTimer() {
  if (classElapsedTimer) return;
  var start = Date.now();
  classElapsedTimer = setInterval(function () {
    var badge = document.getElementById("audience-badge");
    if (!badge) return;
    var secs = Math.floor((Date.now() - start) / 1000);
    var m = Math.floor(secs / 60);
    var s = secs % 60;
    var timer = m + ":" + String(s).padStart(2, "0");
    if (isTeacherRole()) {
      var inChat = wsStudentCount;
      var inVideo = countVideoAudience();
      var parts = [];
      if (inChat > 0) parts.push(inChat + " in chat");
      if (inVideo > 0) parts.push(inVideo + " on video");
      badge.textContent = parts.length ? parts.join(" · ") : "In class · " + timer;
    } else {
      badge.textContent = "In class · " + timer;
    }
    if (liveSocket && liveSocket.readyState === WebSocket.OPEN &&
        window.LiveClassMedia && LiveClassMedia.isJoined && LiveClassMedia.isJoined()) {
      showReconnectBanner(false);
    }
  }, 1000);
}

function setChatUnread(n) {
  chatUnreadCount = Math.max(0, n | 0);
  var badge = document.getElementById("chat-unread");
  if (!badge) return;
  if (chatUnreadCount > 0) {
    badge.textContent = chatUnreadCount > 99 ? "99+" : String(chatUnreadCount);
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }
}

function clearChatUnread() {
  setChatUnread(0);
}

function bumpChatUnread() {
  var panel = document.querySelector(".meet-bottom-panel");
  if (activeMeetTab === "chat" && panel && !panel.classList.contains("collapsed")) return;
  setChatUnread(chatUnreadCount + 1);
}

async function removeStudentFromClass(studentId) {
  if (!liveSession || !studentId) return;
  var classId = liveSession.class_id || liveSession.classId;
  try {
    await api("/api/v1/live-classes/" + classId + "/students/" + studentId + "/remove", { method: "POST" });
    loadClassroomStudents(true);
  } catch (e) {
    addChatMessage("", "Could not remove student: " + e.message, true);
  }
}

async function loadClassAttendance() {
  if (!isTeacherRole() || !liveSession) return;
  var classId = liveSession.class_id || liveSession.classId;
  var log = document.getElementById("attendance-log");
  var panel = document.getElementById("attendance-panel");
  if (!log) return;
  try {
    var data = await api("/api/v1/live-classes/" + classId + "/attendance");
    if (!data.records || !data.records.length) {
      log.innerHTML = "<p>No attendance yet.</p>";
      return;
    }
    log.innerHTML = data.records.map(function (r) {
      return "<div>" + escHtml(r.name) + " joined at " + formatParticipantTime(r.joined_at) +
        (r.left_at ? " · left " + formatParticipantTime(r.left_at) : "") + "</div>";
    }).join("");
  } catch (e) { /* optional */ }
}

window.toggleChatDrawer = toggleChatDrawer;
window.removeStudentFromClass = removeStudentFromClass;

function authHeadersForClassroom() {
  var tok = typeof getAuthToken === "function" ? getAuthToken() : "";
  return tok ? { Authorization: "Bearer " + tok } : {};
}

function liveKitRosterFallback() {
  try {
    if (window.LiveClassMedia && typeof window.LiveClassMedia.listRemoteRoster === "function") {
      return window.LiveClassMedia.listRemoteRoster().filter(function (p) {
        return p && !p.is_teacher;
      });
    }
  } catch (e) { /* ignore */ }
  return [];
}

function applyStudentRoster(students, teacherName, activeCount) {
  var list = enrichStudentsWithKnownNames(students || []);
  var remote = liveKitRosterFallback();
  if (remote.length) {
    var byId = {};
    list.forEach(function (s) {
      if (s && s.student_id) byId[normalizeStudentId(s.student_id)] = s;
    });
    remote.forEach(function (r) {
      if (r && r.student_id && !byId[normalizeStudentId(r.student_id)]) {
        byId[normalizeStudentId(r.student_id)] = r;
      }
    });
    list = Object.keys(byId).map(function (k) { return byId[k]; });
  }
  var count = Math.max(
    list.length,
    activeCount != null ? Number(activeCount) || 0 : 0,
    remote.length,
    wsStudentCount || 0
  );
  if (isTeacherRole()) {
    renderClassroomStudents(list);
    // Keep header honest even when render path had zero cards briefly.
    updateParticipantsHeader(count, teacherName || liveSession.teacher_name || "Teacher");
    if (!window._sxAttendanceLoaded) {
      window._sxAttendanceLoaded = true;
      loadClassAttendance();
    }
    if (Object.keys(raisedHands).length) renderRaisedHands();
  } else {
    renderParticipantsForStudent(list);
    updateParticipantsHeader(
      count,
      teacherName || liveSession.teacher_name || liveSession.teacher || "Teacher"
    );
  }
  var badge = document.getElementById("audience-badge");
  if (badge && !isTeacherRole()) {
    badge.textContent = (count + 1) + " in class";
    badge.classList.remove("hidden");
  }
}

async function loadClassroomStudents(quiet) {
  if (!liveSession) return;
  var classId = liveSession.class_id || liveSession.classId;
  if (!classId) return;
  var list = document.getElementById("participants-list");
  if (!quiet && list) list.innerHTML = '<p class="participants-empty">Loading students…</p>';
  var opts = { headers: authHeadersForClassroom() };
  try {
    // Presence works for teacher + joined students (does not depend on chat WS).
    var presence = await api("/api/v1/live-classes/" + encodeURIComponent(classId) + "/presence", opts);
    var students = (presence && presence.students) || [];
    if (presence && presence.teacher_name) {
      liveSession.teacher_name = presence.teacher_name;
    }
    // Merge LiveKit remotes so A/V-connected peers always show even if DB lags.
    var remote = liveKitRosterFallback();
    if (remote.length) {
      var byId = {};
    students.forEach(function (s) {
      if (s && s.student_id) byId[normalizeStudentId(s.student_id)] = s;
    });
    remote.forEach(function (r) {
      if (r && r.student_id && !byId[normalizeStudentId(r.student_id)]) {
        byId[normalizeStudentId(r.student_id)] = r;
      }
    });
      students = Object.keys(byId).map(function (k) { return byId[k]; });
    }
    applyStudentRoster(
      students,
      (presence && presence.teacher_name) || liveSession.teacher_name,
      presence && presence.active_attendees != null ? presence.active_attendees : students.length
    );
  } catch (e) {
    var fallback = liveKitRosterFallback();
    if (isTeacherRole()) {
      try {
        var students2 = await api(
          "/api/v1/live-classes/" + encodeURIComponent(classId) + "/students",
          opts
        ) || [];
        if (fallback.length) {
          var map = {};
          students2.forEach(function (s) {
            if (s && s.student_id) map[normalizeStudentId(s.student_id)] = s;
          });
          fallback.forEach(function (r) {
            if (r && r.student_id && !map[normalizeStudentId(r.student_id)]) {
              map[normalizeStudentId(r.student_id)] = r;
            }
          });
          students2 = Object.keys(map).map(function (k) { return map[k]; });
        }
        applyStudentRoster(students2, liveSession.teacher_name, students2.length);
        return;
      } catch (e2) {
        if (fallback.length) {
          applyStudentRoster(fallback, liveSession.teacher_name, fallback.length);
          return;
        }
        if (list && !list.querySelector(".participant-card[data-student-id]")) {
          list.innerHTML =
            '<p class="participants-empty">Could not load students' +
            (e2 && e2.message ? " (" + escHtml(String(e2.message)) + ")" : "") +
            ".</p>";
        }
      }
    } else if (fallback.length) {
      applyStudentRoster(fallback, liveSession.teacher_name || liveSession.teacher, fallback.length);
    } else {
      renderParticipantsForStudent([]);
      updateParticipantsHeader(wsStudentCount || 0, liveSession.teacher_name || liveSession.teacher);
    }
  }
}

function startClassroomStudentsPoll() {
  if (classStudentsPollTimer) clearInterval(classStudentsPollTimer);
  loadClassroomStudents(true);
  var pollMs = isTeacherRole() ? 8000 : 20000;
  classStudentsPollTimer = setInterval(function () {
    loadClassroomStudents(true);
  }, pollMs);
}

var studentMicPollTimer = null;
function startStudentMicPermissionPoll() {
  if (isTeacherRole() || studentMicPollTimer) return;
  studentMicPollTimer = setInterval(async function () {
    if (!liveSession) return;
    if (window._sxMicEnableBusy) return;
    try {
      var classId = liveSession.class_id || liveSession.classId;
      if (!classId) return;
      if (typeof isLocalMicPublished === "function" && isLocalMicPublished()) return;
      var data = await api("/api/v1/live-classes/" + classId + "/token");
      if (data && data.mic_allowed && typeof enableStudentMic === "function") {
        enableStudentMic({ silent: true }).catch(function () { /* retry on next poll */ });
      }
    } catch (e) { /* ignore */ }
  }, 8000);
}

window.grantStudentMic = grantStudentMic;
window.grantStudentAccess = grantStudentAccess;
window.giveAccessToWaitingStudents = giveAccessToWaitingStudents;
window.revokeStudentMic = revokeStudentMic;
window.grantStudentCamera = grantStudentCamera;
window.revokeStudentCamera = revokeStudentCamera;
window.loadClassroomStudents = loadClassroomStudents;
window.unlockClassAudio = unlockClassAudio;

function sxAllowSpeak(btn) {
  if (!btn) return;
  var uid = btn.getAttribute("data-user-id") || btn.getAttribute("data-uid");
  var name = btn.getAttribute("data-user-name") || btn.getAttribute("data-name") || "";
  if (!uid) {
    showClassroomToast("Could not identify student — refresh and try again.", true);
    return;
  }
  grantStudentMic(uid, name);
}
window.sxAllowSpeak = sxAllowSpeak;

function sxLowerHand(btn) {
  if (!btn) return;
  var uid = btn.getAttribute("data-user-id") || btn.getAttribute("data-uid");
  if (uid) lowerHandForStudent(uid);
}
window.sxLowerHand = sxLowerHand;

function sxMuteStudent(btn) {
  if (!btn) return;
  var uid = btn.getAttribute("data-user-id") || btn.getAttribute("data-uid");
  if (uid) revokeStudentMic(uid);
}
window.sxMuteStudent = sxMuteStudent;

function sxAllowCam(btn) {
  if (!btn) return;
  var uid = btn.getAttribute("data-user-id") || btn.getAttribute("data-uid");
  if (uid) grantStudentCamera(uid);
}
window.sxAllowCam = sxAllowCam;

function sxRevokeCam(btn) {
  if (!btn) return;
  var uid = btn.getAttribute("data-user-id") || btn.getAttribute("data-uid");
  if (uid) revokeStudentCamera(uid);
}
window.sxRevokeCam = sxRevokeCam;

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise(function (_, reject) {
      setTimeout(function () { reject(new Error(message)); }, ms);
    })
  ]);
}

function addChatMessage(name, text, isSystem, eventId) {
  if (eventId) {
    if (seenChatEventIds[eventId]) return;
    seenChatEventIds[eventId] = true;
    var keys = Object.keys(seenChatEventIds);
    if (keys.length > 200) {
      keys.slice(0, 80).forEach(function (k) { delete seenChatEventIds[k]; });
    }
  }
  var log = document.getElementById("chat-log");
  if (!log) return;
  var div = document.createElement("div");
  div.className = "chat-msg" + (isSystem ? " system" : "");
  if (eventId) div.setAttribute("data-event-id", eventId);
  if (isSystem) {
    div.textContent = text;
  } else {
    div.innerHTML =
      "<strong>" + escHtml(name) + "</strong><span class=\"chat-text\">" + escHtml(text) + "</span>";
  }
  log.appendChild(div);
  requestAnimationFrame(function () {
    log.scrollTop = log.scrollHeight;
  });
  if (!isSystem) bumpChatUnread();
}

function sendBoardEvent(action, data) {
  var payloadData = data || {};
  if (action === "image" && payloadData.url) {
    var imgUrl = String(payloadData.url);
    if (imgUrl.indexOf("blob:") === 0 || imgUrl.indexOf("data:") === 0) {
      return false;
    }
    payloadData = Object.assign({}, payloadData, { url: normalizeBoardImageUrl(imgUrl) });
  }
  var payload = JSON.stringify({ event: "whiteboard", action: action, data: payloadData });
  if (liveSocket && liveSocket.readyState === WebSocket.OPEN) {
    try {
      liveSocket.send(payload);
      return true;
    } catch (e) {
      return false;
    }
  }
  // Queue briefly so clear/image/text are not lost while chat reconnects
  window.__boardEventQueue = window.__boardEventQueue || [];
  window.__boardEventQueue.push(payload);
  if (window.__boardEventQueue.length > 80) {
    window.__boardEventQueue = window.__boardEventQueue.slice(-80);
  }
  return false;
}

function flushBoardEventQueue() {
  if (!liveSocket || liveSocket.readyState !== WebSocket.OPEN) return;
  var q = window.__boardEventQueue || [];
  window.__boardEventQueue = [];
  q.forEach(function (payload) {
    try {
      liveSocket.send(payload);
    } catch (e) { /* ignore */ }
  });
}

function syncMainStageLayers() {
  var remote = document.getElementById("video-remote");
  var overlay = document.getElementById("board-overlay");
  var screenOn = remote && remote.classList.contains("screen-active");
  if (overlay) {
    var boardVisible = board.open && !overlay.classList.contains("hidden") && !screenOn;
    overlay.classList.toggle("stage-visible", boardVisible);
    overlay.classList.toggle("stage-on-top", boardVisible);
  }
  if (remote) {
    remote.classList.toggle("stage-on-top", screenOn);
  }
  document.body.classList.toggle("classroom-board-open", board.open && !screenOn);
  if (board.open && !screenOn && typeof hideVideoPlaceholder === "function") hideVideoPlaceholder();
}
window.syncMainStageLayers = syncMainStageLayers;

function showBoardForStudent(forceOpen) {
  if (isTeacherRole()) return;
  var overlay = document.getElementById("board-overlay");
  if (!overlay) return;
  if (forceOpen === false) {
    hideBoardForStudent();
    return;
  }
  board.open = true;
  overlay.classList.remove("hidden");
  hideVideoPlaceholder();
  resizeBoardCanvas();
  syncMainStageLayers();
  if (typeof syncRemoteSubscriptions === "function") syncRemoteSubscriptions();
}

function hideBoardForStudent() {
  if (isTeacherRole()) return;
  board.open = false;
  var overlay = document.getElementById("board-overlay");
  if (overlay) overlay.classList.add("hidden");
  syncMainStageLayers();
  if (typeof syncRemoteSubscriptions === "function") syncRemoteSubscriptions();
  if (typeof window.remoteTeacherScreenActive === "function" && window.remoteTeacherScreenActive()) {
    return;
  }
  if (typeof reattachTeacherMainStage === "function") reattachTeacherMainStage();
}
window.pauseStudentBoardSyncForScreenShare = pauseStudentBoardSyncForScreenShare;
window.resumeStudentBoardSyncAfterScreenShare = resumeStudentBoardSyncAfterScreenShare;
window.hideBoardForStudent = hideBoardForStudent;
window.showBoardForStudent = showBoardForStudent;

function syncBoardToRoom() {
  if (!isTeacherRole() || !liveSocket || liveSocket.readyState !== WebSocket.OPEN) return;
  sendBoardEvent("board_open", { open: board.open });
  for (var i = 0; i < board.history.length; i++) {
    var item = board.history[i];
    sendBoardEvent(item.type, item.data);
  }
  if (board.liveText) {
    sendBoardEvent("text_stream", {
      id: board.liveTextId || boardLiveTextId(),
      x: board.textX,
      y: board.textY,
      text: board.liveText,
      size: board.fontSize,
    });
  }
}

function initWhiteboard() {
  if (!WHITEBOARD_ENABLED) return;
  board.canvas = document.getElementById("whiteboard");
  if (!board.canvas) return;
  board.ctx = board.canvas.getContext("2d");
  board.canDraw = isTeacherRole();
  resizeBoardCanvas();
  window.addEventListener("resize", resizeBoardCanvas);

  board.canvas.addEventListener("mousedown", onBoardPointerDown);
  board.canvas.addEventListener("mousemove", onBoardPointerMove);
  board.canvas.addEventListener("mouseup", onBoardPointerUp);
  board.canvas.addEventListener("mouseleave", onBoardPointerUp);
  board.canvas.addEventListener("touchstart", onBoardTouchStart, { passive: false });
  board.canvas.addEventListener("touchmove", onBoardTouchMove, { passive: false });
  board.canvas.addEventListener("touchend", onBoardPointerUp);

  var typeInput = document.getElementById("board-type-input");
  if (typeInput) {
    typeInput.addEventListener("input", onBoardTypeInput);
    typeInput.addEventListener("keydown", onBoardTypeKeydown);
  }

  var imageInput = document.getElementById("board-image-input");
  if (imageInput) {
    imageInput.addEventListener("change", onBoardImageSelected);
  }

  var overlay = document.getElementById("board-overlay");
  if (overlay && !board.canDraw) overlay.classList.add("view-only");

  if (isTeacherRole()) {
    var subj = (liveSession.subject || "mathematics").toLowerCase();
    var key = "mathematics";
    if (subj.indexOf("phys") >= 0) key = "physics";
    else if (subj.indexOf("chem") >= 0) key = "chemistry";
    else if (subj.indexOf("eng") >= 0) key = "english";
    else if (subj.indexOf("igbo") >= 0) key = "igbo";
    else if (subj.indexOf("yoruba") >= 0 || subj.indexOf("yor") >= 0) key = "yoruba";
    else if (subj.indexOf("hausa") >= 0) key = "hausa";
    else if (subj.indexOf("math") >= 0) key = "mathematics";
    var sel = document.getElementById("subject-keyboard");
    if (sel) sel.value = key;
    renderSymbolPalette();
    setBoardTool("type");
  }
  flushBoardWsQueue();
  if (!isTeacherRole()) {
    var ovStudent = document.getElementById("board-overlay");
    if (ovStudent) ovStudent.classList.add("view-only");
    hideStudentSelfPreview();
    startStudentBoardHttpSync();
  }
}

function redrawBoard() {
  if (!board.ctx || !board.canvas) return;
  var idx = 0;
  var CHUNK = 80;
  board.ctx.clearRect(0, 0, board.canvas.width, board.canvas.height);

  function finishRedraw() {
    if (board.liveText) {
      drawBoardTextWrapped({
        x: board.textX,
        y: board.textY,
        text: board.liveText,
        size: board.fontSize
      }, false);
    } else {
      cacheBoardHistoryBitmap();
    }
    updateBoardCursor();
  }

  function processNext() {
    if (idx >= board.history.length) {
      finishRedraw();
      return;
    }
    var item = board.history[idx];
    if (item.type === "image") {
      var imgData = item.data;
      idx++;
      loadBoardImage(imgData.url, function (img) {
        board.ctx.drawImage(img, imgData.x, imgData.y, imgData.w, imgData.h);
        processNext();
      }, processNext);
      return;
    }
    var processed = 0;
    while (idx < board.history.length && processed < CHUNK) {
      var it = board.history[idx];
      if (it.type === "image") break;
      if (it.type === "draw") applyDrawStroke(it.data, false);
      else if (it.type === "erase") applyEraseStroke(it.data, false);
      else if (it.type === "text") applyBoardText(it.data, false);
      idx++;
      processed++;
    }
    if (idx < board.history.length) {
      requestAnimationFrame(processNext);
    } else {
      finishRedraw();
    }
  }

  processNext();
}

function normalizeBoardImageUrl(url) {
  var u = String(url || "").trim();
  if (!u) return u;
  if (u.indexOf("blob:") === 0 || u.indexOf("data:") === 0) return u;
  if (u.indexOf("http") === 0) return u;
  var base = (typeof API_BASE === "string" && API_BASE) || "https://scholaxia1.onrender.com";
  base = base.replace(/\/$/, "");
  if (u.charAt(0) === "/") return base + u;
  return base + "/" + u;
}

function loadBoardImage(url, onLoad, onError) {
  if (!url) {
    if (onError) onError();
    return;
  }
  var abs = normalizeBoardImageUrl(url);
  if (board.imageCache[abs] || board.imageCache[url]) {
    onLoad(board.imageCache[abs] || board.imageCache[url]);
    return;
  }
  var img = new Image();
  // Prefer without CORS taint first — board display does not need canvas export
  img.onload = function () {
    board.imageCache[abs] = img;
    board.imageCache[url] = img;
    onLoad(img);
  };
  img.onerror = function () {
    // Retry once with crossOrigin for CDNs that require it
    var img2 = new Image();
    img2.crossOrigin = "anonymous";
    img2.onload = function () {
      board.imageCache[abs] = img2;
      board.imageCache[url] = img2;
      onLoad(img2);
    };
    img2.onerror = function () {
      if (onError) onError();
    };
    img2.src = abs;
  };
  img.src = abs;
}

function fitImageOnBoard(img) {
  var cw = board.canvas.width;
  var ch = board.canvas.height;
  var maxW = cw * 0.88;
  var maxH = ch * 0.5;
  var scale = Math.min(maxW / img.width, maxH / img.height, 1);
  var w = img.width * scale;
  var h = img.height * scale;
  return {
    x: (cw - w) / 2,
    y: 20,
    w: w,
    h: h
  };
}

function pickBoardImage() {
  if (!board.canDraw) return;
  var input = document.getElementById("board-image-input");
  if (input) input.click();
}

function onBoardImageSelected(ev) {
  var file = ev.target.files && ev.target.files[0];
  ev.target.value = "";
  if (!file || !board.canDraw) return;
  if (!file.type || file.type.indexOf("image/") !== 0) {
    addChatMessage("", "Please choose a JPEG, PNG, or WebP image.", true);
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    addChatMessage("", "Image is too large. Maximum size is 10MB.", true);
    return;
  }
  uploadBoardImage(file);
}

async function uploadBoardImage(file) {
  try {
    addChatMessage("", "Uploading image to the board…", true);
    var uploaded = await apiUpload("/api/v1/community/upload", file);
    if (!uploaded || !uploaded.file_url) throw new Error("No image URL returned");
    await placeBoardImage(uploaded.file_url, true);
    addChatMessage("", "Image is on the board — students can see it.", true);
  } catch (e) {
    addChatMessage("", "Image upload failed: " + e.message, true);
  }
}

function placeBoardImage(url, broadcast) {
  var canonical = normalizeBoardImageUrl(url);
  return new Promise(function (resolve, reject) {
    loadBoardImage(canonical, function (img) {
      var box = fitImageOnBoard(img);
      addBoardImage(
        { url: canonical, x: box.x, y: box.y, w: box.w, h: box.h },
        broadcast
      ).then(resolve).catch(reject);
    }, function () {
      reject(new Error("Could not load image"));
    });
  });
}

function addBoardImage(data, broadcast) {
  return new Promise(function (resolve, reject) {
    loadBoardImage(data.url, function (img) {
      var dup = board.history.some(function (h) {
        return h.type === "image" && h.data
          && h.data.url === data.url
          && h.data.x === data.x && h.data.y === data.y
          && h.data.w === data.w && h.data.h === data.h;
      });
      if (!dup) board.history.push({ type: "image", data: data });
      board.ctx.drawImage(img, data.x, data.y, data.w, data.h);
      if (broadcast !== false) sendBoardEvent("image", data);
      resolve();
    }, function () {
      reject(new Error("Could not load image"));
    });
  });
}

function updateBoardCursor() {
  var cursor = document.getElementById("board-cursor");
  var canvas = board.canvas;
  var overlay = document.getElementById("board-overlay");
  if (!cursor || !canvas || !overlay) return;
  if (!board.open || board.tool !== "type" || !board.canDraw) {
    cursor.classList.add("hidden");
    return;
  }
  var rect = canvas.getBoundingClientRect();
  var overlayRect = overlay.getBoundingClientRect();
  var scaleX = rect.width / canvas.width;
  var scaleY = rect.height / canvas.height;
  cursor.style.left = (rect.left - overlayRect.left + board.textX * scaleX) + "px";
  cursor.style.top = (rect.top - overlayRect.top + (board.textY - board.fontSize) * scaleY) + "px";
  cursor.style.height = (board.fontSize * scaleY) + "px";
  cursor.classList.remove("hidden");
}

function onBoardTypeInput() {
  if (!board.canDraw) return;
  var inp = document.getElementById("board-type-input");
  board.liveText = inp ? inp.value : "";
  board.liveTextId = boardLiveTextId();
  scheduleRedrawBoard();
  ensureBoardCanvasFitsForLiveText();
  if (_boardTypeSendTimer) return;
  _boardTypeSendTimer = requestAnimationFrame(function () {
    _boardTypeSendTimer = null;
    var streamPayload = JSON.stringify({
      id: board.liveTextId,
      x: board.textX,
      y: board.textY,
      text: board.liveText,
      size: board.fontSize,
    });
    if (streamPayload === _lastBoardTypeStream) return;
    _lastBoardTypeStream = streamPayload;
    sendBoardEvent("text_stream", JSON.parse(streamPayload));
  });
}

function onBoardTypeKeydown(e) {
  if (!board.canDraw) return;
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    commitBoardLine();
    return;
  }
  if (e.key === "ArrowDown") {
    var inp = document.getElementById("board-type-input");
    if (inp && inp.selectionStart === inp.value.length && inp.selectionEnd === inp.value.length) {
      e.preventDefault();
      commitBoardLine();
    }
  }
}

function commitBoardLine() {
  var inp = document.getElementById("board-type-input");
  var text = inp ? inp.value.trim() : "";
  var committedLineCount = text
    ? wrapBoardTextLines(text, getBoardTextMaxWidth(), board.fontSize).length
    : 1;
  if (text) {
    var data = {
      id: newBoardTextId(),
      x: board.textX,
      y: board.textY,
      text: text,
      size: board.fontSize
    };
    _lastOwnTextId = data.id;
    board.history.push({ type: "text", data: data });
    invalidateBoardCache();
    sendBoardEvent("text", data);
  }
  // Clear the live stream marker so remotes drop the in-progress line.
  sendBoardEvent("text_stream", {
    id: board.liveTextId || boardLiveTextId(),
    x: board.textX,
    y: board.textY,
    text: "",
    size: board.fontSize
  });
  if (inp) inp.value = "";
  board.liveText = "";
  board.textY += board.lineHeight * committedLineCount;
  board.liveTextId = boardLiveTextId();
  ensureBoardCanvasFitsContent();
  redrawBoard();
  scrollBoardToTypingCursor();
  sendBoardEvent("text_stream", {
    id: board.liveTextId,
    x: board.textX,
    y: board.textY,
    text: "",
    size: board.fontSize
  });
  if (inp) inp.focus();
}

// Canvas growth must NEVER wipe existing ink: assigning canvas.height clears
// every pixel, which (a) erased committed content while typing on slow phones
// and (b) forced a full history replay after every keystroke. Copy the current
// bitmap into an offscreen canvas first, then paste it back after the resize.
function growBoardCanvasTo(nextH) {
  if (!board.canvas || !board.ctx) return false;
  nextH = Math.max(getBoardMinCanvasHeight(), Math.floor(nextH));
  if (nextH <= board.canvas.height) return false;
  var keep = null;
  try {
    keep = document.createElement("canvas");
    keep.width = board.canvas.width;
    keep.height = board.canvas.height;
    keep.getContext("2d").drawImage(board.canvas, 0, 0);
  } catch (eKeep) { keep = null; }
  board.canvas.height = nextH;
  if (keep) {
    try {
      board.ctx.drawImage(keep, 0, 0);
    } catch (ePaste) { /* full redraw will restore ink */ }
  }
  return true;
}

function ensureBoardCanvasFitsForLiveText() {
  if (!board.canvas || !board.ctx) return;
  var lines = wrapBoardTextLines(board.liveText || "", getBoardTextMaxWidth(), board.fontSize);
  var need = board.textY + lines.length * board.lineHeight + board.lineHeight * 2;
  growBoardCanvasTo(need);
}

function ensureBoardCanvasFitsPoint(y) {
  if (!board.canvas || typeof y !== "number" || !isFinite(y)) return;
  growBoardCanvasTo(y + board.lineHeight * 3);
}

function getBoardMinCanvasHeight() {
  var stage = document.getElementById("video-stage");
  var minH = BOARD_BASE_MIN_HEIGHT;
  if (stage) {
    var rect = stage.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      var scaled = Math.floor(BOARD_BASE_WIDTH * (rect.height / rect.width));
      minH = Math.max(BOARD_BASE_MIN_HEIGHT, scaled);
    }
  }
  return minH;
}

// Coordinates expect the canvas top-left as (0, 0), so the needed height is
// relative to the top of the CURRENT canvas, not its bottom: keep the largest
// height seen so far.
function ensureBoardCanvasFitsContent(minBottomY) {
  if (!board.canvas) return;
  var need = Math.max(
    board.textY + board.lineHeight * 3,
    (typeof minBottomY === "number" ? minBottomY : 0),
    board.canvas.height || 0
  );
  growBoardCanvasTo(need);
}

function scrollBoardToTypingCursor() {
  var scroller = document.getElementById("board-scroll");
  if (!scroller || !board.canvas) return;
  var scale = scroller.clientWidth > 0 ? scroller.clientWidth / board.canvas.width : 1;
  var cursorY = (board.textY + board.lineHeight) * scale;
  if (isTeacherRole()) {
    var target = Math.max(0, board.textY * scale - scroller.clientHeight * 0.55);
    scroller.scrollTop = target;
    return;
  }
  if (cursorY > scroller.scrollTop + scroller.clientHeight - 48) {
    scroller.scrollTop = Math.max(0, cursorY - scroller.clientHeight * 0.35);
  }
}

function resizeBoardCanvas() {
  if (!board.canvas) return;
  var stage = document.getElementById("video-stage");
  if (!stage) return;
  var rect = stage.getBoundingClientRect();
  if (rect.width < 40 || rect.height < 40) {
    requestAnimationFrame(function () { resizeBoardCanvas(); });
    return;
  }
  board.canvas.width = BOARD_BASE_WIDTH;
  var minH = getBoardMinCanvasHeight();
  board.canvas.height = Math.max(minH, board.textY + board.lineHeight * 3, board.canvas.height || 0);
  if (board.ctx) {
    board.ctx.lineCap = "round";
    board.ctx.lineJoin = "round";
    board.ctx.strokeStyle = "#e8f5ec";
    board.ctx.lineWidth = 6;
  }
  redrawBoard();
  scrollBoardToTypingCursor();
  syncMainStageLayers();
}

function boardCoords(ev) {
  var rect = board.canvas.getBoundingClientRect();
  return {
    x: (ev.clientX - rect.left) * (board.canvas.width / rect.width),
    y: (ev.clientY - rect.top) * (board.canvas.height / rect.height)
  };
}

function onBoardTouchStart(ev) {
  if (!board.canDraw || ev.touches.length !== 1) return;
  ev.preventDefault();
  var t = ev.touches[0];
  onBoardPointerDown({ clientX: t.clientX, clientY: t.clientY, preventDefault: function () {} });
}

function onBoardTouchMove(ev) {
  if (!board.canDraw || ev.touches.length !== 1) return;
  ev.preventDefault();
  var t = ev.touches[0];
  onBoardPointerMove({ clientX: t.clientX, clientY: t.clientY });
}

function onBoardPointerDown(ev) {
  if (!board.open || !board.canDraw) return;
  var p = boardCoords(ev);
  if (board.tool === "type") {
    commitBoardLine();
    board.textX = p.x;
    board.textY = p.y;
    board.liveTextId = boardLiveTextId();
    var inp = document.getElementById("board-type-input");
    if (inp) { inp.focus(); }
    updateBoardCursor();
    sendBoardEvent("text_stream", {
      id: board.liveTextId,
      x: board.textX,
      y: board.textY,
      text: board.liveText,
      size: board.fontSize
    });
    return;
  }
  if (board.tool !== "draw" && board.tool !== "erase") return;
  board.drawing = true;
  board.lastX = p.x;
  board.lastY = p.y;
}

function onBoardPointerMove(ev) {
  if (!board.drawing || !board.ctx) return;
  var p = boardCoords(ev);
  if (board.tool === "erase") {
    if (board.liveText) {
      board.liveText = "";
      sendBoardEvent("text_stream", {
        id: board.liveTextId || boardLiveTextId(),
        x: board.textX,
        y: board.textY,
        text: "",
        size: board.fontSize,
      });
    }
    var eraseStroke = {
      x0: board.lastX, y0: board.lastY, x1: p.x, y1: p.y, width: 28
    };
    ensureBoardCanvasFitsPoint(Math.max(eraseStroke.y0, eraseStroke.y1));
    invalidateBoardCache();
    applyEraseStroke(eraseStroke, false);
    sendBoardEvent("erase", eraseStroke);
    board.history.push({ type: "erase", data: eraseStroke });
    board.lastX = p.x;
    board.lastY = p.y;
    return;
  }
  var stroke = {
    x0: board.lastX, y0: board.lastY, x1: p.x, y1: p.y,
    color: "#e8f5ec", width: 6
  };
  ensureBoardCanvasFitsPoint(Math.max(stroke.y0, stroke.y1));
  applyDrawStroke(stroke, false);
  sendBoardEvent("draw", stroke);
  board.history.push({ type: "draw", data: stroke });
  invalidateBoardCache();
  board.lastX = p.x;
  board.lastY = p.y;
}

function onBoardPointerUp() {
  board.drawing = false;
}

function applyEraseStroke(data, save) {
  if (!board.ctx || !data) return;
  board.ctx.save();
  board.ctx.globalCompositeOperation = "destination-out";
  board.ctx.lineCap = "round";
  board.ctx.lineJoin = "round";
  board.ctx.strokeStyle = "rgba(0,0,0,1)";
  board.ctx.lineWidth = data.width || 28;
  board.ctx.beginPath();
  board.ctx.moveTo(data.x0, data.y0);
  board.ctx.lineTo(data.x1, data.y1);
  board.ctx.stroke();
  board.ctx.restore();
  if (save !== false) board.history.push({ type: "erase", data: data });
}

function applyDrawStroke(data, save) {
  if (!board.ctx || !data) return;
  board.ctx.strokeStyle = data.color || "#e8f5ec";
  board.ctx.lineWidth = data.width || 6;
  board.ctx.beginPath();
  board.ctx.moveTo(data.x0, data.y0);
  board.ctx.lineTo(data.x1, data.y1);
  board.ctx.stroke();
  if (save !== false) board.history.push({ type: "draw", data: data });
}

function placeSymbol(x, y, text, broadcast) {
  if (!board.ctx) return;
  var data = { x: x, y: y, text: text, size: board.fontSize };
  applyBoardText(data, false);
  board.history.push({ type: "text", data: data });
  if (broadcast !== false) sendBoardEvent("text", data);
}

function getBoardTextMaxWidth(fromX) {
  if (!board.canvas) return 400;
  var x = typeof fromX === "number" ? fromX : board.textX;
  return Math.max(160, board.canvas.width - x - 32);
}

function wrapBoardTextLines(text, maxWidth, fontSize) {
  if (!board.ctx || !text) return [];
  var size = fontSize || board.fontSize;
  board.ctx.font = "600 " + size + "px Inter, sans-serif";
  var lines = [];
  var line = "";
  for (var i = 0; i < text.length; i++) {
    var ch = text[i];
    if (ch === "\n") {
      lines.push(line);
      line = "";
      continue;
    }
    var test = line + ch;
    if (board.ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = ch;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function drawBoardTextWrapped(data, save) {
  if (!board.ctx || !data) return;
  var size = data.size || board.fontSize;
  board.ctx.font = "600 " + size + "px Inter, sans-serif";
  board.ctx.fillStyle = "#e8f5ec";
  var maxW = getBoardTextMaxWidth(data.x);
  var lines = wrapBoardTextLines(data.text || "", maxW, size);
  var lh = board.lineHeight;
  lines.forEach(function (ln, i) {
    board.ctx.fillText(ln, data.x, data.y + i * lh);
  });
  if (save !== false) board.history.push({ type: "text", data: data });
}

function applyBoardText(data, save) {
  drawBoardTextWrapped(data, save);
}

function clearBoardCanvas(broadcast) {
  if (!board.ctx || !board.canvas) return;
  invalidateBoardCache();
  board.history = [];
  board.liveText = "";
  board.liveTextId = "";
  board.textX = 24;
  board.textY = 48;
  _lastRemoteTextStream = "";
  _lastBoardTypeStream = "";
  var inp = document.getElementById("board-type-input");
  if (inp) inp.value = "";
  board.canvas.height = getBoardMinCanvasHeight();
  try {
    board.ctx.clearRect(0, 0, board.canvas.width, board.canvas.height);
  } catch (e) { /* ignore */ }
  redrawBoard();
  var scroller = document.getElementById("board-scroll");
  if (scroller) scroller.scrollTop = 0;
  if (broadcast !== false && board.canDraw) {
    sendBoardEvent("clear", { ts: Date.now() });
    // Also clear any in-progress live typing on remotes
    sendBoardEvent("text_stream", {
      id: "cleared",
      x: board.textX || 40,
      y: board.textY || 40,
      text: "",
      size: board.fontSize,
    });
  }
}

function clearBoard() {
  clearBoardCanvas(true);
}

function setBoardTool(tool) {
  board.tool = tool;
  board.pendingSymbol = null;
  document.querySelectorAll(".sym-btn.active").forEach(function (b) { b.classList.remove("active"); });
  var typeBtn = document.getElementById("btn-board-type");
  var drawBtn = document.getElementById("btn-board-draw");
  var eraseBtn = document.getElementById("btn-board-erase");
  if (typeBtn) typeBtn.classList.toggle("active", tool === "type");
  if (drawBtn) drawBtn.classList.toggle("active", tool === "draw");
  if (eraseBtn) eraseBtn.classList.toggle("active", tool === "erase");
  if (tool === "type") {
    var inp = document.getElementById("board-type-input");
    if (inp && board.canDraw) inp.focus();
    updateBoardCursor();
  } else {
    var cursor = document.getElementById("board-cursor");
    if (cursor) cursor.classList.add("hidden");
  }
}

function renderSymbolPalette() {
  var sel = document.getElementById("subject-keyboard");
  var palette = document.getElementById("symbol-palette");
  if (!sel || !palette) return;
  var key = sel.value || "mathematics";
  var pack = SUBJECT_SYMBOLS[key] || SUBJECT_SYMBOLS.mathematics;
  palette.innerHTML = pack.symbols.map(function (sym, i) {
    return '<button type="button" class="sym-btn" data-sym-idx="' + i + '">' + escHtml(sym) + "</button>";
  }).join("");
  palette.querySelectorAll(".sym-btn").forEach(function (btn, i) {
    btn.addEventListener("click", function () { pickSymbol(pack.symbols[i]); });
  });
}

function pickSymbol(sym) {
  setBoardTool("type");
  var inp = document.getElementById("board-type-input");
  if (!inp) return;
  inp.value += sym;
  inp.focus();
  onBoardTypeInput();
  document.querySelectorAll(".sym-btn").forEach(function (b) {
    b.classList.toggle("active", b.textContent === sym);
  });
  setTimeout(function () {
    document.querySelectorAll(".sym-btn.active").forEach(function (b) { b.classList.remove("active"); });
  }, 300);
}

function toggleBoard(forceOpen) {
  var overlay = document.getElementById("board-overlay");
  if (!overlay) return;
  var open = typeof forceOpen === "boolean" ? forceOpen : !board.open;
  board.open = open;
  overlay.classList.toggle("hidden", !open);
  syncMainStageLayers();
  if (open) {
    hideVideoPlaceholder();
    if (isTeacherRole() && typeof applySpotlight === "function") applySpotlight("board", false);
    requestAnimationFrame(function () {
      resizeBoardCanvas();
      setTimeout(function () { resizeBoardCanvas(); }, 120);
    });
    if (board.canDraw) {
      setBoardTool("type");
      var inp = document.getElementById("board-type-input");
      if (inp) setTimeout(function () { inp.focus(); }, 100);
    }
  } else if (isTeacherRole() && typeof applySpotlight === "function") {
    applySpotlight("teacher", false);
  }
  if (!board.canDraw) return;

  function pushBoardState() {
    sendBoardEvent("board_open", { open: open });
    if (open) {
      // Push current strokes so late / missed students catch up
      setTimeout(function () { syncBoardToRoom(); }, 250);
    }
  }

  if (!liveSocket || liveSocket.readyState !== WebSocket.OPEN) {
    try { connectChat(); } catch (e) { /* ignore */ }
    setTimeout(pushBoardState, 600);
  } else {
    pushBoardState();
  }
}

function handleBoardMessage(msg) {
  if (!msg) return;
  var data = msg.data || {};
  if (msg.action === "board_open") {
    if (!isTeacherRole() && data.open && isStudentScreenShareActive()) {
      window._boardOpenDeferred = true;
      return;
    }
    board.open = !!data.open;
    var wasOpen = !!window._sxBoardWasOpen;
    window._sxBoardWasOpen = board.open;
    var overlay = document.getElementById("board-overlay");
    if (overlay) overlay.classList.toggle("hidden", !board.open);
    syncMainStageLayers();
    if (board.open) {
      hideVideoPlaceholder();
      requestAnimationFrame(function () {
        resizeBoardCanvas();
        redrawBoard();
      });
      if (!isTeacherRole()) {
        // The teacher's own heartbeat re-sends board_open every ~12s — only
        // announce the close→open transition, repeated status must not spam chat.
        if (!wasOpen) addChatMessage("", "Teacher opened the board.", true);
        if (liveSocket && liveSocket.readyState === WebSocket.OPEN) {
          try {
            liveSocket.send(JSON.stringify({ event: "request_board_sync" }));
          } catch (eSync) { /* ignore */ }
        }
      }
    } else if (!isTeacherRole()) {
      hideBoardForStudent();
      invalidateBoardCache();
      if (typeof syncRemoteSubscriptions === "function") syncRemoteSubscriptions();
      setTimeout(function () {
        if (typeof window.reattachTeacherScreenShare === "function" && window.remoteTeacherScreenActive && window.remoteTeacherScreenActive()) {
          reattachTeacherScreenShare();
        } else if (typeof reattachTeacherMainStage === "function") {
          reattachTeacherMainStage();
        }
        if (typeof attachExistingRemoteTracks === "function") attachExistingRemoteTracks();
        if (typeof applySpotlight === "function") applySpotlight("teacher", true);
      }, 80);
    }
    return;
  }
  if (!isTeacherRole()) showBoardForStudent(true);
  if (msg.action === "draw") {
    var drData = msg.data || {};
    ensureBoardCanvasFitsPoint(Math.max(drData.y0 || 0, drData.y1 || 0));
    var dupDraw = board.history.some(function (h) {
      return h.type === "draw" && h.data
        && h.data.x0 === drData.x0 && h.data.y0 === drData.y0
        && h.data.x1 === drData.x1 && h.data.y1 === drData.y1;
    });
    if (!dupDraw) {
      invalidateBoardCache();
      applyDrawStroke(drData, false);
      board.history.push({ type: "draw", data: drData });
    }
    return;
  }
  if (msg.action === "erase") {
    var erData = msg.data || {};
    ensureBoardCanvasFitsPoint(Math.max(erData.y0 || 0, erData.y1 || 0));
    if (!board.history.some(function (h) {
      return h.type === "erase" && h.data
        && h.data.x0 === erData.x0 && h.data.y0 === erData.y0
        && h.data.x1 === erData.x1 && h.data.y1 === erData.y1;
    })) {
      board.history.push({ type: "erase", data: erData });
    }
    board.liveText = "";
    applyEraseStroke(erData, false);
    return;
  }
  if (msg.action === "text") {
    /* Server broadcasts every whiteboard message back to ALL room members
       (echo), and periodic replay syncs re-send old messages. Without a
       dedupe, the teacher's own committed line was appended to board.history
       again on every echo — history grew forever (canvas got slower and
       slower to redraw, the spam the teacher saw boil up after a few
       minutes). Draw and erase already dedupe; text must too. */
    var dupText = data.id
      ? board.history.some(function (h) {
          return h.type === "text" && h.data && h.data.id === data.id;
        })
      : board.history.some(function (h) {
          return h.type === "text" && h.data
            && h.data.y === data.y && h.data.text === data.text;
        });
    var textLines = (data.text ? wrapBoardTextLines(data.text, getBoardTextMaxWidth(data.x), data.size || board.fontSize).length : 1);
    ensureBoardCanvasFitsPoint(data.y + textLines * board.lineHeight);
    invalidateBoardCache();
    applyBoardText(data, false);
    if (!dupText && !(isTeacherRole() && data.id && data.id === _lastOwnTextId)) {
      board.history.push({ type: "text", data: data });
    }
    board.liveText = "";
    if (data && typeof data.y === "number") {
      board.textY = Math.max(board.textY, data.y + board.lineHeight);
    }
    ensureBoardCanvasFitsContent();
    redrawBoard();
    scrollBoardToTypingCursor();
    return;
  }
  if (msg.action === "text_stream") {
    var streamKey = (data.x || 0) + "|" + (data.y || 0) + "|" + (data.text || "");
    if (streamKey === _lastRemoteTextStream) return;
    _lastRemoteTextStream = streamKey;
    board.textX = data.x;
    board.textY = data.y;
    board.liveText = data.text || "";
    if (!board.liveText) ensureBoardCanvasFitsContent();
    else ensureBoardCanvasFitsForLiveText();
    scheduleRedrawBoard();
    scrollBoardToTypingCursor();
    return;
  }
  if (msg.action === "image") {
    var imgData = msg.data || {};
    if (imgData.url) imgData.url = normalizeBoardImageUrl(imgData.url);
    if (!isTeacherRole()) showBoardForStudent(true);
    addBoardImage(imgData, false).then(function () {
      redrawBoard();
    }).catch(function () {
      addChatMessage("", "Could not load a board image from the teacher.", true);
    });
    return;
  }
  if (msg.action === "clear") {
    invalidateBoardCache();
    board.history = [];
    board.liveText = "";
    board.liveTextId = "";
    board.textX = 24;
    board.textY = 48;
    _lastRemoteTextStream = "";
    var inpClear = document.getElementById("board-type-input");
    if (inpClear) inpClear.value = "";
    if (board.canvas) board.canvas.height = getBoardMinCanvasHeight();
    if (board.ctx && board.canvas) {
      try {
        board.ctx.clearRect(0, 0, board.canvas.width, board.canvas.height);
      } catch (e) { /* ignore */ }
    }
    var scClear = document.getElementById("board-scroll");
    if (scClear) scClear.scrollTop = 0;
    return;
  }
}

// Client→server heartbeat: NATs/proxies drop idle sockets and receive-only
// relays stall, which reads as a dead chat link. The server ignores unknown
// events, so a lightweight "ping" keeps the path alive without side effects.
function startChatHeartbeat() {
  stopChatHeartbeat();
  window._sxChatPingTimer = setInterval(function () {
    if (!liveSocket || liveSocket.readyState !== WebSocket.OPEN) return;
    try { liveSocket.send(JSON.stringify({ event: "ping" })); } catch (ePing) { /* ignore */ }
  }, 15000);
}

function stopChatHeartbeat() {
  if (window._sxChatPingTimer) {
    clearInterval(window._sxChatPingTimer);
    window._sxChatPingTimer = null;
  }
}

async function connectChat(isReconnect) {
  if (!liveSession || !liveSession.room_id) {
    setStatus("No room id — rejoin the class");
    return;
  }
  if (liveSocket) {
    if (liveSocket.readyState === WebSocket.OPEN) return;
    if (liveSocket.readyState === WebSocket.CONNECTING && !isReconnect) {
      var startedAt = liveSocket._siaOpenedAt || 0;
      if (startedAt && Date.now() - startedAt < 8000) return;
    }
    try { liveSocket.close(); } catch (e) { /* ignore */ }
    liveSocket = null;
  }
  var payload = parseJwt(getAuthToken());
  var userId = payload.sub || liveSession.user_id || liveSession.identity || "user";
  window.__myChatUserId = userId;
  var role = isClassroomHost() ? "teacher" : "student";
  var displayName = localStorage.getItem("sia_name") || "";
  if (!displayName && liveSession && liveSession.student_name) {
    displayName = liveSession.student_name;
  }
  if (!displayName) {
    try {
      var u = typeof api !== "undefined" && api.getUser ? api.getUser() : null;
      if (u && (u.full_name || u.name)) displayName = u.full_name || u.name;
    } catch (eU) { /* ignore */ }
  }
  if (!displayName) {
    displayName = (liveSession.teacher_name && isClassroomHost()) ? liveSession.teacher_name : "Student";
  }
  // Chat WS must reach the SAME backend the REST proxy targets. The bridge
  // resolves /backend-origin (desktop-server knows the real SCHOLAXIA_API);
  // static deploys without the bridge just use the module-level API_WS.
  var wsBase = API_WS;
  try {
    wsBase = (window.__wsBaseReady ? await window.__wsBaseReady : (window.API_WS || API_WS)) || API_WS;
  } catch (eWs) { /* keep API_WS */ }
  var url = wsBase + "/ws/live-class/" + encodeURIComponent(liveSession.room_id)
    + "?user_id=" + encodeURIComponent(userId)
    + "&role=" + encodeURIComponent(role)
    + "&display_name=" + encodeURIComponent(displayName);

  setStatus("Connecting chat…");
  try {
    liveSocket = new WebSocket(url);
    liveSocket._siaOpenedAt = Date.now();
  } catch (e) {
    setStatus("Chat blocked — check network");
    return;
  }
  liveSocket.onopen = function () {
    window._sxChatReconnectAttempts = 0;
    showReconnectBanner(false);
    startChatHeartbeat();
    var videoOk = window.LiveClassMedia && LiveClassMedia.isJoined && LiveClassMedia.isJoined();
    setStatus(videoOk ? "Connected — video + chat" : "Connected — chat ready");
    if (!isReconnect) {
      addChatMessage("", "You joined the class. Use the chat to talk with everyone.", true);
    } else {
      // Note the first reconnect only — a flapping link must not flood the log.
      if (!window._sxChatReconnectNoted) {
        window._sxChatReconnectNoted = true;
        addChatMessage("", "Reconnected to class chat.", true);
      }
      try {
        liveSocket.send(JSON.stringify({ event: "request_room_snapshot" }));
      } catch (eSnap) { /* ignore */ }
    }
    maybeHideJoinOverlay();
    flushBoardEventQueue();
    if (WHITEBOARD_ENABLED && !isTeacherRole()) {
      if (isReconnect) {
        board.history = [];
        board.liveText = "";
        if (board.ctx && board.canvas) {
          try {
            board.ctx.clearRect(0, 0, board.canvas.width, board.canvas.height);
          } catch (eClr) { /* ignore */ }
        }
      }
      liveSocket.send(JSON.stringify({ event: "request_board_sync" }));
      pullBoardStateFromServer();
      if (window._sxBoardSyncPoll) clearInterval(window._sxBoardSyncPoll);
      window._sxBoardSyncPoll = setInterval(function () {
        if (!liveSocket || liveSocket.readyState !== WebSocket.OPEN) return;
        if (isStudentScreenShareActive()) return;
        if (board.open) return;
        try {
          liveSocket.send(JSON.stringify({ event: "request_board_sync" }));
        } catch (ePoll) { /* ignore */ }
      }, 25000);
    } else if (board.open) {
      setTimeout(function () { syncBoardToRoom(); }, 400);
    }
    updateAudienceStats();
    var studBadge = document.getElementById("audience-badge");
    if (studBadge && !isTeacherRole()) {
      studBadge.textContent = "";
      studBadge.classList.add("hidden");
    }
  };
  liveSocket.onmessage = function (ev) {
    try {
      var msg = JSON.parse(ev.data);
      if (msg.event === "chat") {
        var who = msg.name || (msg.role === "teacher" ? "Teacher" : "Student");
        addChatMessage(who, msg.text || "", false, msg.eventId);
      } else if (msg.event === "room_snapshot") {
        applyRoomSnapshot(msg);
      } else if (msg.event === "participant_joined" || msg.event === "participant_reconnected") {
        var pj = msg.participant || {};
        var pjId = pj.userId || msg.user_id;
        var pjName = pj.name || msg.name || "Student";
        if (pjId && pjName) {
          window.__participantNames = window.__participantNames || {};
          window.__participantNames[String(pjId)] = pjName;
        }
        if (isTeacherRole() && String(pj.role || msg.role || "").toLowerCase().indexOf("teacher") < 0) {
          ensureParticipantCardForStudent(pjId, pjName);
          setTimeout(function () {
            loadClassroomStudents(true);
          }, 200);
        }
        if (msg.event === "participant_joined") {
          addChatMessage("", (pjName || "Someone") + " joined the class.", true);
        }
        updateAudienceStats();
      } else if (msg.event === "participant_updated" && msg.participant) {
        var pu = msg.participant;
        var puId = pu.userId || pu.participantId;
        if (isTeacherRole() && puId) {
          window.__participantNames = window.__participantNames || {};
          if (pu.name) window.__participantNames[String(puId)] = pu.name;
          ensureParticipantCardForStudent(puId, pu.name);
          var cardPu = findParticipantCard(puId);
          if (cardPu) {
            var prevCam = cardPu.getAttribute("data-camera-on") === "1";
            var camOn = !!(pu.cameraAllowed || pu.cameraEnabled);
            updateParticipantCardContent(cardPu, {
              student_id: puId,
              name: pu.name,
              mic_allowed: !!(pu.micAllowed || pu.microphoneEnabled),
              camera_allowed: camOn,
              camera_enabled: camOn,
            });
            cardPu.setAttribute("data-camera-on", camOn ? "1" : "0");
            if (camOn && !prevCam && typeof window.reattachParticipantVideos === "function") {
              window.reattachParticipantVideos();
            }
          }
        }
      } else if (msg.event === "participant_left") {
        if (msg.role === "student" && wsStudentCount > 0) wsStudentCount--;
        updateAudienceStats();
        addChatMessage("", (msg.name || "Someone") + " left the class.", true);
        if (isTeacherRole()) loadClassroomStudents(true);
      } else if (msg.event === "user_joined") {
        if (msg.role === "student") wsStudentCount++;
        updateAudienceStats();
        var joinedName = msg.name || "Someone";
        // Prefer participant_joined for toast; skip duplicate if we already handled it
        if (!msg._fromParticipant) {
          /* legacy path kept for older servers */
        }
        if (isTeacherRole() && msg.role === "student") {
          ensureParticipantCardForStudent(msg.user_id, joinedName);
          setTimeout(function () {
            loadClassroomStudents(true);
          }, 300);
        }
      } else if (msg.event === "user_left") {
        if (msg.role === "student" && wsStudentCount > 0) wsStudentCount--;
        updateAudienceStats();
        if (isTeacherRole()) loadClassroomStudents(true);
      } else if (msg.event === "request_board_sync") {
        if (isTeacherRole() && board.open) sendBoardHeartbeat();
      } else if (msg.event === "class_ended") {
        handleClassEnded(msg.message || "The teacher ended the class.");
      } else if (msg.event === "class_started") {
        applySessionStatus("LIVE");
        if (!isTeacherRole()) {
          addChatMessage("", msg.message || "Class is live — video connecting…", true);
          showClassroomToast("Class is live!");
          if (!LiveClassMedia.isJoined()) tryConnectLiveVideo(true);
        }
      } else if (msg.event === "raise_hand") {
        if (isClassroomHost()) {
          if (Array.isArray(msg.raisedHands) && msg.raisedHands.length) {
            raisedHands = {};
            window.raisedHands = raisedHands;
            msg.raisedHands.forEach(function (h) {
              if (!h || !h.userId) return;
              var hk = normalizeStudentId(h.userId);
              var hn = (h.name || "").trim() || "Student";
              raisedHands[hk] = { name: hn, at: h.handRaisedAt || Date.now() };
              if (hn.toLowerCase() !== "student") {
                window.__participantNames = window.__participantNames || {};
                window.__participantNames[hk] = hn;
              }
            });
            renderRaisedHands();
            renderRaisedHandToolbarBadge();
            renderHostParticipantList(lastClassroomStudents);
            var panelQ = document.getElementById("raise-hand-panel");
            if (panelQ) panelQ.classList.remove("hidden");
            addChatMessage("", (msg.name || "A student") + " raised their hand.", true);
            showClassroomToast((msg.name || "A student") + " raised their hand");
            return;
          }
          var rhUid = msg.user_id || (msg.participant && msg.participant.userId) || "";
          var rosterStudent = rhUid ? findStudentInRoster(rhUid) : null;
          var signalOnly = msg.signal_only || (rosterStudent && rosterStudent.mic_allowed);
          if (signalOnly) {
            var sigName = msg.name || (rosterStudent && resolveStudentDisplayName(rosterStudent)) || "Student";
            showClassroomToast(sigName + " ✋");
            showReactionBurst("🙋", sigName, rhUid);
            return;
          }
          if (!isMobileClassroomView()) {
            try {
              switchMeetTab("hands");
              toggleHostSidebar(true);
            } catch (eChrome) {}
          }
          var rhName = msg.name || (msg.participant && msg.participant.name) || "";
          if (rhName) {
            window.__participantNames = window.__participantNames || {};
            window.__participantNames[normalizeStudentId(msg.user_id)] = rhName;
          }
          addRaisedHand(msg.user_id, rhName);
          renderHostParticipantList(lastClassroomStudents);
          addChatMessage("", (msg.name || "A student") + " raised their hand.", true);
          showClassroomToast((msg.name || "A student") + " raised their hand");
          var panel = document.getElementById("raise-hand-panel");
          if (panel) panel.classList.remove("hidden");
        }
      } else if (msg.event === "lower_hand") {
        removeRaisedHand(msg.user_id);
        if (!isTeacherRole() && isMicEventForMe(msg)) {
          var handBtn = document.getElementById("btn-hand");
          if (handBtn) handBtn.classList.remove("active");
          showClassroomToast("Your raised hand was lowered");
        }
      } else if (msg.event === "lower_all_hands") {
        raisedHands = {};
        window.raisedHands = raisedHands;
        renderRaisedHands();
        renderRaisedHandToolbarBadge();
        if (!isTeacherRole()) {
          var handBtnAll = document.getElementById("btn-hand");
          if (handBtnAll) handBtnAll.classList.remove("active");
        }
      } else if (msg.event === "spotlight" && msg.mode) {
        applySpotlight(msg.mode, true, msg.userId || msg.user_id || "");
      } else if (msg.event === "reaction") {
        var reactUser = msg.user_id || msg.userId || "";
        showReactionBurst(msg.emoji || "👍", msg.name || "", reactUser);
        if (isTeacherRole()) {
          showClassroomToast((msg.name || "Student") + " " + (msg.emoji || "👍"));
        }
      } else if (msg.event === "permission_changed" && msg.permissions) {
        applyClassPermissions(msg.permissions);
        if (!isTeacherRole() && !classPermissions.studentsCanWriteBoard) {
          board.canDraw = false;
          var ovPerm = document.getElementById("board-overlay");
          if (ovPerm) ovPerm.classList.add("view-only");
        }
        showClassroomToast("Class permissions updated");
      } else if (msg.event === "error" && msg.message) {
        showClassroomToast(msg.message, true);
        addChatMessage("", msg.message, true);
      } else if (msg.event === "mic_access_granted") {
        if (!isTeacherRole() && isMicEventForMe(msg)) {
          var handBtnGrant = document.getElementById("btn-hand");
          if (handBtnGrant) handBtnGrant.classList.remove("active");
          showClassroomToast("You may speak now");
          var turnOnMic = function () {
            if (typeof enableStudentMic === "function") {
              enableStudentMic({ silent: true }).catch(function () { /* student can tap Mic */ });
            }
          };
          if (typeof refreshLiveKitToken === "function") {
            refreshLiveKitToken().then(turnOnMic).catch(turnOnMic);
          } else {
            turnOnMic();
          }
        }
      } else if (msg.event === "mic_access_update") {
        if (!isTeacherRole() && isMicEventForMe(msg) && msg.has_mic) {
          if (typeof isLocalMicPublished === "function" && isLocalMicPublished()) {
            /* already on */
          } else if (typeof enableStudentMic === "function") {
            enableStudentMic({ silent: true }).catch(function () { /* retry on poll */ });
          }
        }
        if (!isTeacherRole() && isMicEventForMe(msg) && !msg.has_mic && typeof disableStudentMic === "function") {
          disableStudentMic();
        }
        if (isTeacherRole() && msg.has_mic) {
          if (typeof ensureRoomAudioPlayback === "function") ensureRoomAudioPlayback();
          if (typeof reattachRemoteClassAudio === "function") reattachRemoteClassAudio();
        }
      } else if (msg.event === "mic_access_revoked") {
        if (!isTeacherRole() && isMicEventForMe(msg) && typeof disableStudentMic === "function") {
          disableStudentMic();
          addChatMessage("", msg.message || "Your mic was turned off by the teacher.", true);
        }
      } else if (msg.event === "camera_access_granted") {
        if (!isTeacherRole() && isMicEventForMe(msg) && typeof enableStudentCamera === "function") {
          enableStudentCamera({ silent: true }).catch(function () { /* tap Cam */ });
        }
        if (isTeacherRole()) {
          if (typeof window.scheduleReattachParticipantVideos === "function") {
            window.scheduleReattachParticipantVideos();
          } else if (typeof reattachParticipantVideos === "function") {
            reattachParticipantVideos();
          }
        }
      } else if (msg.event === "camera_access_update") {
        if (!isTeacherRole() && msg.has_camera && isMicEventForMe(msg) && typeof enableStudentCamera === "function") {
          if (typeof isLocalCamPublished === "function" && isLocalCamPublished()) {
            /* already on */
          } else {
            enableStudentCamera({ silent: true }).catch(function () { /* tap Cam */ });
          }
        }
        if (isTeacherRole() && msg.has_camera) {
          if (typeof reattachParticipantVideos === "function") reattachParticipantVideos();
        }
      } else if (msg.event === "camera_access_revoked") {
        if (!isTeacherRole() && isMicEventForMe(msg) && typeof disableStudentCamera === "function") {
          disableStudentCamera();
          showClassroomToast(msg.message || "Camera turned off by teacher");
        } else if (isTeacherRole()) {
          addChatMessage("", msg.message || "Student camera access removed.", true);
        }
      } else if (msg.event === "screen_share") {
        if (msg.active) {
          if (typeof applySpotlight === "function") applySpotlight("screen", true);
        } else if (typeof applySpotlight === "function") {
          applySpotlight("teacher", true);
        }
        if (!isTeacherRole()) {
          if (msg.active) {
            pauseStudentBoardSyncForScreenShare();
            hideBoardForStudent();
          } else {
            resumeStudentBoardSyncAfterScreenShare();
            addChatMessage("", "Screen share ended.", true);
            window._teacherScreenSharing = false;
            window._teacherScreenSharePublished = false;
            var remoteWrap = document.getElementById("video-remote");
            if (remoteWrap) remoteWrap.classList.remove("screen-active");
          }
          syncMainStageLayers();
          hideVideoPlaceholder();
          if (typeof syncRemoteSubscriptions === "function") syncRemoteSubscriptions();
          if (msg.active) {
            if (typeof reattachTeacherScreenShare === "function") reattachTeacherScreenShare();
          } else if (typeof attachExistingRemoteTracks === "function") {
            attachExistingRemoteTracks();
          } else if (window.LiveClassMedia && LiveClassMedia.reattachRemoteTracks) {
            LiveClassMedia.reattachRemoteTracks();
          }
          if (!msg.active && typeof reattachTeacherMainStage === "function") {
            setTimeout(function () { reattachTeacherMainStage(); }, 300);
          }
          if (!msg.active && window._boardOpenDeferred && board.open) {
            window._boardOpenDeferred = false;
            showBoardForStudent(true);
            scheduleRedrawBoard();
          }
        }
      } else if (msg.event === "whiteboard") {
        queueBoardMessage(msg);
        if (!isTeacherRole() && msg.action === "board_open" && msg.data) {
          if (msg.data.open && typeof applySpotlight === "function") {
            applySpotlight("board", true);
          } else if (!msg.data.open && typeof applySpotlight === "function") {
            applySpotlight("teacher", true);
          }
        }
      } else if (msg.event === "whiteboard_access_granted") {
        board.canDraw = true;
        var ov = document.getElementById("board-overlay");
        if (ov) ov.classList.remove("view-only");
        addChatMessage("", msg.message || "You can use the board now.", true);
      }
    } catch (e) { /* ignore */ }
  };
  liveSocket.onclose = function () {
    stopChatHeartbeat();
    if (!window._sxChatReconnectAttempts) window._sxChatReconnectAttempts = 0;
    window._sxChatReconnectAttempts += 1;
    showReconnectBanner(true, "Connection lost. Reconnecting…");
    if (window._sxChatReconnectAttempts > 12) {
      setStatus("Chat disconnected — refresh the page");
      showReconnectBanner(true, "Could not reconnect. Refresh the page.");
      return;
    }
    setStatus(isTeacherRole() ? "Reconnecting chat…" : "Reconnecting…");
    setTimeout(function () {
      try { connectChat(true); } catch (eRc) { /* ignore */ }
    }, Math.min(4000, 800 + window._sxChatReconnectAttempts * 400));
  };
  liveSocket.onerror = function () {
    setStatus("Chat connection error");
  };
}

function sendChatMessage(e) {
  if (e && e.preventDefault) e.preventDefault();
  if (!classPermissions.studentsCanChat && !isTeacherRole()) {
    showClassroomToast("Chat is disabled by the teacher", true);
    return false;
  }
  var input = document.getElementById("chat-input");
  var text = input ? input.value.trim() : "";
  if (!text) return false;
  if (!liveSocket || liveSocket.readyState !== WebSocket.OPEN) {
    showClassroomToast("Chat still connecting — try again", true);
    return false;
  }
  collapseMeetChatPanel(false);
  switchMeetTab("chat");
  try {
    (window.__ownRecentChat = window.__ownRecentChat || []).push(text);
    if (window.__ownRecentChat.length > 50) window.__ownRecentChat.shift();
    liveSocket.send(JSON.stringify({ event: "chat", text: text }));
    addChatMessage("You", text);
    input.value = "";
  } catch (err) {
    showClassroomToast("Could not send message", true);
  }
  return false;
}
window.sendChatMessage = sendChatMessage;

function raiseHand() {
  if (!classPermissions.studentsCanRaiseHand && !isTeacherRole()) {
    showClassroomToast("Raise hand is disabled by the teacher", true);
    return;
  }
  if (!liveSocket || liveSocket.readyState !== WebSocket.OPEN) {
    showClassroomToast("Still connecting — try raise hand again", true);
    return;
  }
  if (isTeacherRole()) {
    addChatMessage("", "Students raise their hand — you are the teacher.", true);
    return;
  }
  var alreadyMic = window.studentMicAllowed === true ||
    (liveSession && liveSession.mic_allowed === true);
  if (alreadyMic) {
    liveSocket.send(JSON.stringify({
      event: "raise_hand",
      name: getStudentName(),
      signal_only: true,
    }));
    var pulseBtn = document.getElementById("btn-hand");
    if (pulseBtn) {
      pulseBtn.classList.add("hand-pulse");
      setTimeout(function () {
        pulseBtn.classList.remove("hand-pulse", "active");
      }, 700);
    }
    return;
  }
  if (document.getElementById("btn-hand") && document.getElementById("btn-hand").classList.contains("active")) {
    showClassroomToast("Hand already raised — waiting for teacher");
    return;
  }
  liveSocket.send(JSON.stringify({ event: "raise_hand", name: getStudentName() }));
  addChatMessage("", "You raised your hand. Wait for the teacher to allow you to speak.", true);
  showClassroomToast("Hand raised — waiting for teacher");
  var btn = document.getElementById("btn-hand");
  if (btn) btn.classList.add("active");
}

window.raiseHand = raiseHand;

function sendReaction(emoji) {
  if (!emoji) return;
  if (!classPermissions.studentsCanReact && !isTeacherRole()) {
    showClassroomToast("Reactions are disabled by the teacher", true);
    return;
  }
  if (!liveSocket || liveSocket.readyState !== WebSocket.OPEN) {
    showClassroomToast("Still connecting — try again", true);
    return;
  }
  var payload = {
    event: "reaction",
    emoji: emoji,
    name: isTeacherRole() ? (liveSession && liveSession.teacher_name) || "Teacher" : getStudentName(),
  };
  liveSocket.send(JSON.stringify(payload));
  var myId = typeof getMyClassroomUserId === "function" ? getMyClassroomUserId() : "";
  showReactionBurst(emoji, payload.name, myId);
  toggleReactionSheet(false);
}

function showReactionBurst(emoji, name, userId) {
  var stage = document.getElementById("video-stage") || document.getElementById("reaction-overlay");
  var overlay = document.getElementById("reaction-overlay");
  if (overlay) overlay.setAttribute("aria-hidden", "false");
  if (!overlay && stage) {
    overlay = document.createElement("div");
    overlay.id = "reaction-overlay";
    overlay.className = "reaction-overlay";
    stage.appendChild(overlay);
  }
  if (overlay) {
    var el = document.createElement("div");
    el.className = "reaction-burst";
    el.textContent = emoji || "👍";
    el.style.left = (18 + Math.random() * 64) + "%";
    el.style.bottom = (12 + Math.random() * 30) + "%";
    if (name) el.title = name;
    overlay.appendChild(el);
    setTimeout(function () {
      try { el.remove(); } catch (e) { /* ignore */ }
    }, 1700);
  }
  if (userId) {
    var tile = document.getElementById("participant-reaction-" + userId);
    if (!tile) {
      var card = findParticipantCard(userId);
      if (card) tile = card.querySelector(".participant-reaction");
    }
    if (tile) {
      tile.textContent = emoji || "👍";
      tile.classList.remove("hidden");
      clearTimeout(tile._hideT);
      tile._hideT = setTimeout(function () {
        tile.classList.add("hidden");
      }, 2800);
    }
  }
}
window.sendReaction = sendReaction;
window.showReactionBurst = showReactionBurst;

function showVideoPlaceholder(text) {
  if (window.board && board.open) return;
  var remote = document.getElementById("video-remote");
  if (remote && remote.classList.contains("screen-active")) return;
  if (remote && remote.querySelector("video")) return;
  var ph = document.getElementById("video-placeholder");
  var txt = document.getElementById("video-placeholder-text");
  if (txt) txt.textContent = text;
  if (ph) ph.classList.remove("hidden");
}

function hideVideoPlaceholder() {
  var ph = document.getElementById("video-placeholder");
  if (ph) ph.classList.add("hidden");
}

function clearLocalPreviewStream() {
  if (localPreviewStream) {
    localPreviewStream.getTracks().forEach(function (t) { t.stop(); });
    localPreviewStream = null;
  }
  window.localPreviewStream = null;
  if (typeof stopSelfHear === "function") stopSelfHear();
  if (typeof stopMicMonitor === "function") stopMicMonitor();
}
window.clearLocalPreviewStream = clearLocalPreviewStream;

async function startLocalPreviewOnly() {
  if (!isTeacherRole()) return;
  window.localPreviewStream = localPreviewStream;
  if (localPreviewStream) {
    restoreLocalCameraPreview();
    if (!LiveClassMedia.isJoined()) setVideoControlsEnabled(true);
    return;
  }
  try {
    localPreviewStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    // Never play local mic into speakers — that causes teacher echo.
    try {
      localPreviewStream.getAudioTracks().forEach(function (t) {
        t.enabled = true;
      });
    } catch (e) { /* ignore */ }
    window.localPreviewStream = localPreviewStream;
    if (LiveClassMedia.isJoined()) {
      localPreviewStream.getTracks().forEach(function (t) { t.stop(); });
      localPreviewStream = null;
      window.localPreviewStream = null;
      return;
    }
    var localEl = document.getElementById("video-local");
    var vid = document.createElement("video");
    vid.srcObject = localPreviewStream;
    vid.autoplay = true;
    vid.muted = true;
    vid.playsInline = true;
    localEl.innerHTML = "";
    localEl.appendChild(vid);
    localEl.classList.remove("hidden");
    hideVideoPlaceholder();
    if (LiveClassMedia.setMicState) LiveClassMedia.setMicState(true);
    if (LiveClassMedia.setCamState) LiveClassMedia.setCamState(true);
    updateMediaButton(document.getElementById("btn-cam"), true);
    updateMediaButton(document.getElementById("btn-mic"), true);
    setVideoControlsEnabled(true);
    startMicMonitor(localPreviewStream);
    if (!LiveClassMedia.isJoined()) {
      setStatus("Camera on — connecting live video for students…");
      addChatMessage(
        "",
        "You can see yourself. Students will see you when live video connects (top right should say Connected — video + chat).",
        true
      );
    }
  } catch (e) {
    addChatMessage("", "Camera/mic: " + e.message + " — allow camera & microphone in Windows Settings → Privacy.", true);
  }
}

function restoreLocalCameraPreview() {
  if (!localPreviewStream) return;
  var localEl = document.getElementById("video-local");
  var vid = document.createElement("video");
  vid.srcObject = localPreviewStream;
  vid.autoplay = true;
  vid.muted = true;
  vid.playsInline = true;
  localEl.innerHTML = "";
  localEl.appendChild(vid);
  localEl.classList.remove("hidden");
  if (LiveClassMedia.setCamState) LiveClassMedia.setCamState(true);
  updateMediaButton(document.getElementById("btn-cam"), true);
}

function parseClassEndTime(iso) {
  if (typeof parseUtcIso === "function") return parseUtcIso(iso);
  if (!iso) return null;
  var s = String(iso).trim();
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) s += "Z";
  var d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

async function syncLiveSessionFromServer() {
  if (!liveSession) return;
  var classId = liveSession.class_id || liveSession.classId;
  if (!classId || typeof api !== "function") return;
  try {
    var detail = await api("/api/v1/live-classes/" + classId);
    if (!detail) return;
    if (detail.room_id) liveSession.room_id = detail.room_id;
    if (detail.teacher_id) liveSession.teacher_id = detail.teacher_id;
    if (detail.teacher_name) liveSession.teacher_name = detail.teacher_name;
    if (detail.is_live === false) {
      handleClassEnded("This class has ended.");
      return;
    }
    if (detail.end_time) {
      var endAt = parseClassEndTime(detail.end_time);
      if (endAt && endAt.getTime() > Date.now()) {
        liveSession.end_time = detail.end_time;
      } else if (detail.is_live) {
        liveSession.end_time = null;
      }
    } else {
      liveSession.end_time = null;
    }
    saveLiveSession(liveSession);
  } catch (e) { /* keep local session */ }
}

function scheduleClassAutoEnd() {
  if (!liveSession || !liveSession.end_time) return;
  var endAt = parseClassEndTime(liveSession.end_time);
  if (!endAt) return;
  var endMs = endAt.getTime() - Date.now();
  if (classAutoEndTimer) clearTimeout(classAutoEndTimer);
  if (endMs <= 0) {
    if (isTeacherRole()) autoEndClassSession();
    return;
  }
  classAutoEndTimer = setTimeout(function () {
    if (isTeacherRole()) autoEndClassSession();
    else handleClassEnded("Class ended at the scheduled time.");
  }, endMs);
  if (isTeacherRole()) {
    addChatMessage(
      "",
      "Class scheduled to end at " + new Date(liveSession.end_time).toLocaleString() + " (like Zoom/Meet).",
      true
    );
  }
}

function handleClassEnded(message) {
  try { localStorage.setItem("sia_stop_live_ring", String(Date.now())); } catch (e) { /* ignore */ }
  addChatMessage("", message || "Class has ended.", true);
  setStatus("Class ended");
  setTimeout(function () { leaveClassroom(); }, 2500);
}

async function autoEndClassSession() {
  if (!isTeacherRole() || !liveSession) return;
  var classId = liveSession.class_id || liveSession.classId;
  try {
    await api("/api/v1/live-classes/" + classId + "/end", {
      method: "POST",
      preferXhr: true,
      timeout: 60000,
      retries: 2,
    });
    setStatus("Class ended");
    addChatMessage("", "Scheduled end time reached — class closed for all students.", true);
    setTimeout(function () { leaveClassroom({ skipConfirm: true, ended: true }); }, 2500);
  } catch (e) {
    addChatMessage("", "Could not auto-end: " + e.message, true);
  }
}

async function endLiveClass() {
  if (!isTeacherRole() || !liveSession) return;
  var classId = liveSession.class_id || liveSession.classId;
  if (!classId) {
    showClassroomToast("Missing class id — cannot end.", true);
    return;
  }
  if (!confirm("End this class for everyone? Students will be disconnected.")) return;
  var btn = document.getElementById("btn-end-class");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Ending…";
  }
  setStatus("Ending class…");
  try {
    await api("/api/v1/live-classes/" + encodeURIComponent(classId) + "/end", {
      method: "POST",
      preferXhr: true,
      timeout: 60000,
      retries: 2,
    });
    try {
      if (liveSocket && liveSocket.readyState === WebSocket.OPEN) {
        liveSocket.send(JSON.stringify({
          event: "class_ended",
          message: "Class ended by the teacher.",
        }));
      }
    } catch (wsErr) { /* server broadcast is primary */ }
    showClassroomToast("Class ended");
    setStatus("Class ended");
    addChatMessage("", "You ended the class for everyone.", true);
    setTimeout(function () { leaveClassroom({ skipConfirm: true, ended: true }); }, 800);
  } catch (e) {
    showClassroomToast(e.message || "Could not end class", true);
    setStatus("Could not end class");
    if (btn) {
      btn.disabled = false;
      btn.textContent = "End class";
    }
  }
}

window.toggleSaveLive = toggleSaveLive;
window.endLiveClass = endLiveClass;

async function leaveClassroom(opts) {
  opts = opts || {};
  if (isTeacherRole() && !opts.skipConfirm && !opts.ended) {
    var justLeave = confirm(
      "Leave without ending?\n\nOK = Leave (class stays LIVE for students)\nCancel = Stay in class\n\nTo close for everyone, tap the red End class button."
    );
    if (!justLeave) return;
  }
  if (classStudentsPollTimer) {
    clearInterval(classStudentsPollTimer);
    classStudentsPollTimer = null;
  }
  if (liveSaveWaitTimer) {
    clearInterval(liveSaveWaitTimer);
    liveSaveWaitTimer = null;
  }
  if (liveSaveActive) {
    await stopLiveSaveAndStore(true);
  }
  try {
    if (liveSession && liveSession.class_id && liveSession.role === "student") {
      await api("/api/v1/live-classes/" + liveSession.class_id + "/leave", { method: "POST" });
    }
  } catch (e) { /* ignore */ }

  if (localPreviewStream) {
    localPreviewStream.getTracks().forEach(function (t) { t.stop(); });
    localPreviewStream = null;
    window.localPreviewStream = null;
  }
  if (typeof disconnectLiveVideo === "function") {
    await disconnectLiveVideo();
  }
  stopMicMonitor();
  stopSelfHear();
  if (liveSocket) {
    try { liveSocket.close(); } catch (e) { /* ignore */ }
  }
  if (typeof clearLiveSession === "function") clearLiveSession();
  else localStorage.removeItem("live_session");
  if (liveSession && (liveSession.role === "teacher" || liveSession.role === "admin")) {
    window.location.href = "teacher.html#live";
  } else if (liveSession && liveSession.role === "kind") {
    window.location.href = "kind.html";
  } else {
    window.location.href = "student.html#live";
  }
}

window.leaveClassroom = leaveClassroom;

window.onload = function () {
  if (!getAuthToken()) {
    window.location.href = "auth.html";
    return;
  }
  liveSession = loadLiveSession();
  if (liveSession) {
    if (!liveSession.livekit_token) {
      liveSession.livekit_token = liveSession.agora_token || liveSession.token || "";
    }
    if (!liveSession.livekit_url) liveSession.livekit_url = "";
    // Keep room id even if only channel_id was stored.
    if (!liveSession.room_id && liveSession.channel_id) {
      liveSession.room_id = liveSession.channel_id;
    }
    if (!liveSession.channel_id && liveSession.room_id) {
      liveSession.channel_id = liveSession.room_id;
    }
  }
  window.liveSession = liveSession;
  window.board = board;
  if (!liveSession || !liveSession.room_id) {
    setStatus("Missing class session — go back and join again");
    var role = (localStorage.getItem("sia_role") || "").toLowerCase();
    setTimeout(function () {
      window.location.href = role === "teacher" || role === "admin" ? "teacher.html#live" : "student.html#live";
    }, 1200);
    return;
  }

  window.studentMicAllowed = studentMicAllowed;
  window.studentCameraAllowed = studentCameraAllowed;
  if (!isTeacherRole() && liveSession) {
    studentMicAllowed = liveSession.mic_allowed === true;
    studentCameraAllowed = liveSession.camera_allowed === true;
    window.studentMicAllowed = studentMicAllowed;
    window.studentCameraAllowed = studentCameraAllowed;
    if (typeof syncStudentMicState === "function") syncStudentMicState(studentMicAllowed);
    syncStudentMediaControls();
  }
  document.getElementById("cr-title").textContent = liveSession.title || "Live Class";
  document.getElementById("cr-meta").textContent =
    (liveSession.subject || "Subject") + " · " + (liveSession.teacher_name || liveSession.role || "Class");

  setVideoControlsEnabled(false);
  setStatus("Connecting…");
  if (isTeacherRole()) {
    setJoinOverlay(true, "Joining class…");
  } else {
    setJoinOverlay(true, "Joining class…");
    setTimeout(function () { maybeHideJoinOverlay(); }, 1800);
  }
  if (liveSession.session_status) {
    applySessionStatus(liveSession.session_status);
  }
  if (typeof showVideoPlaceholder === "function") {
    showVideoPlaceholder("Joining live video…");
  }

  if (WHITEBOARD_ENABLED) {
    // Whiteboard must be ready before chat — early WS replay otherwise misses the canvas.
    try {
      initWhiteboard();
    } catch (boardErr) { /* non-fatal */ }
  } else {
    ["board-overlay", "btn-board"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.classList.add("hidden");
    });
    document.querySelectorAll('[data-spot="board"]').forEach(function (el) {
      el.classList.add("hidden");
    });
  }

  try {
    connectChat();
  } catch (chatErr) {
    setStatus("Chat error — still joining video…");
  }
  if (typeof initLiveVideo === "function") {
    try { initLiveVideo(); } catch (vErr) {
      setStatus("Video init error — tap Retry video");
    }
  }

  if (WHITEBOARD_ENABLED && !isTeacherRole()) {
    startStudentBoardHttpSync();
  }

  if (isTeacherRole()) {
    showHostTools(true);
    var rhPanel = document.getElementById("raise-hand-panel");
    if (rhPanel) rhPanel.classList.remove("hidden");
    renderRaisedHandToolbarBadge();
    var audBadge = document.getElementById("audience-badge");
    if (audBadge) audBadge.classList.remove("hidden");
    startClassElapsedTimer();
    startClassroomStudentsPoll();
    bindClassroomAudioUnlock();
  } else {
    showStudentTools(true);
    var studBadge = document.getElementById("audience-badge");
    if (studBadge) studBadge.classList.add("hidden");
    startClassElapsedTimer();
    startClassroomStudentsPoll();
    startStudentMicPermissionPoll();
    bindClassroomAudioUnlock();
  }

  setTimeout(function () {
    maybeHideJoinOverlay();
  }, 4000);

  // If chat never opens, keep retrying so status does not freeze on Connecting…
  var chatRetry = 0;
  var chatRetryTimer = setInterval(function () {
    chatRetry += 1;
    if (liveSocket && liveSocket.readyState === WebSocket.OPEN) {
      clearInterval(chatRetryTimer);
      return;
    }
    if (chatRetry > 12) {
      clearInterval(chatRetryTimer);
      if (!(window.LiveClassMedia && LiveClassMedia.isJoined && LiveClassMedia.isJoined())) {
        setStatus("Still connecting — tap Retry video");
      }
      return;
    }
    setStatus("Reconnecting chat… (" + chatRetry + ")");
    try {
      connectChat();
    } catch (e) { /* ignore */ }
    if (typeof tryConnectLiveVideo === "function") {
      tryConnectLiveVideo(true);
    }
  }, 4000);

  (async function () {
    try {
      await syncLiveSessionFromServer();
      scheduleClassAutoEnd();
      if (isTeacherRole()) {
        var startClassId = liveSession.class_id || liveSession.classId;
        if (startClassId && !liveSession.already_live) {
          api("/api/v1/live-classes/" + startClassId + "/start", { method: "POST" })
            .then(function () {
              addChatMessage("", "Students can now see this class on Live Class and tap Join.", true);
            })
            .catch(function () { /* already live or network */ });
        }
      }
      // Refresh token after sync and reconnect video if needed.
      if (typeof refreshLiveKitToken === "function") {
        await refreshLiveKitToken();
      }
      if (typeof tryConnectLiveVideo === "function") {
        tryConnectLiveVideo(true);
      }
    } catch (e) {
      setStatus("Connected locally — retrying server sync…");
      if (typeof tryConnectLiveVideo === "function") {
        tryConnectLiveVideo(true);
      }
    }
  })();
};


function toggleClassroomChrome(forceHidden) {
  if (typeof forceHidden === "boolean") toggleParticipantStrip(!forceHidden);
  else toggleParticipantStrip();
}
window.toggleClassroomChrome = toggleClassroomChrome;
(function initMeetV2Layout() {
  document.body.classList.add("meet-v2");
  document.body.classList.remove("classroom-chrome-hidden");
  try {
    if (sessionStorage.getItem("sx_meet_strip_hidden") === "1") toggleParticipantStrip(false);
    if (sessionStorage.getItem("sx_meet_chat_collapsed") === "1") collapseMeetChatPanel(true);
  } catch (e) { /* ignore */ }
  function scrollChatLog() {
    var log = document.getElementById("chat-log");
    if (log) log.scrollTop = log.scrollHeight;
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", scrollChatLog);
    window.visualViewport.addEventListener("scroll", scrollChatLog);
  }
  var chatInput = document.getElementById("chat-input");
  if (chatInput) {
    chatInput.addEventListener("focus", function () {
      collapseMeetChatPanel(false);
      switchMeetTab("chat");
      setTimeout(scrollChatLog, 80);
    });
  }
})();

function showReconnectBanner(show, text) {
  if (!isTeacherRole()) {
    show = false;
  }
  var el = document.getElementById("reconnect-banner");
  var txt = document.getElementById("reconnect-banner-text");
  if (!el) return;
  if (show) {
    var wsOk = liveSocket && liveSocket.readyState === WebSocket.OPEN;
    var videoOk = window.LiveClassMedia && LiveClassMedia.isJoined && LiveClassMedia.isJoined();
    if (wsOk && videoOk) {
      show = false;
    } else if (wsOk && !videoOk && text && text.indexOf("Connection lost") >= 0) {
      text = "Video reconnecting…";
    }
  }
  if (txt && text) txt.textContent = text;
  el.classList.toggle("hidden", !show);
}

function toggleStageFullscreen(force) {
  var on = typeof force === "boolean" ? force : !document.body.classList.contains("meet-stage-fullscreen");
  document.body.classList.toggle("meet-stage-fullscreen", on);
  var btn = document.getElementById("btn-stage-fullscreen");
  if (btn) {
    btn.classList.toggle("active", on);
    btn.textContent = on ? "Exit full" : "Full screen";
  }
}
window.toggleStageFullscreen = toggleStageFullscreen;

function onScreenShareStageChange(active) {
  var btn = document.getElementById("btn-stage-fullscreen");
  if (btn) btn.classList.toggle("hidden", !active);
  if (!active) toggleStageFullscreen(false);
}
window.onScreenShareStageChange = onScreenShareStageChange;

function applySpotlight(mode, fromServer, userId) {
  currentSpotlight = mode || "teacher";
  if (userId) spotlightUserId = String(userId);
  if (currentSpotlight !== "student") spotlightUserId = "";
  window.spotlightUserId = spotlightUserId;
  var stage = document.getElementById("video-stage");
  if (stage) {
    stage.setAttribute("data-spotlight", currentSpotlight);
    if (spotlightUserId) stage.setAttribute("data-spotlight-user", spotlightUserId);
    else stage.removeAttribute("data-spotlight-user");
  }
  document.querySelectorAll(".spot-btn").forEach(function (btn) {
    btn.classList.toggle("is-active", btn.getAttribute("data-spot") === currentSpotlight);
  });
  document.querySelectorAll(".participant-card[data-student-id]").forEach(function (card) {
    var sid = card.getAttribute("data-student-id") || "";
    card.classList.toggle("spotlight-target", currentSpotlight === "student" && sid === spotlightUserId);
  });
  if (!fromServer && currentSpotlight === "board" && typeof toggleBoard === "function" && !(window.board && board.open)) {
    try { toggleBoard(); } catch (e) { /* ignore */ }
  }
  updateSpotlightStudentStage();
  if (typeof syncMainStageLayers === "function") syncMainStageLayers();
  if (isTeacherRole() && typeof refreshTeacherVideoLayout === "function") {
    refreshTeacherVideoLayout();
  }
}
window.applySpotlight = applySpotlight;

function spotlightStudent(studentId) {
  if (!isTeacherRole() || !studentId) return;
  spotlightUserId = String(studentId);
  window.spotlightUserId = spotlightUserId;
  applySpotlight("student", false, spotlightUserId);
  if (liveSocket && liveSocket.readyState === WebSocket.OPEN) {
    try {
      liveSocket.send(JSON.stringify({
        event: "spotlight",
        mode: "student",
        userId: spotlightUserId,
      }));
    } catch (e) { /* ignore */ }
  }
  showClassroomToast("Spotlighting student");
}
window.spotlightStudent = spotlightStudent;

function updateSpotlightStudentStage() {
  var stageEl = document.getElementById("spotlight-student-stage");
  if (!stageEl) return;
  var show = isTeacherRole() && currentSpotlight === "student" && spotlightUserId;
  stageEl.classList.toggle("hidden", !show);
  if (!show) {
    stageEl.innerHTML = "";
    return;
  }
  var pending = window.__pendingStudentVideos && window.__pendingStudentVideos[spotlightUserId];
  var slot = document.getElementById("participant-video-" + spotlightUserId);
  var existingVid = slot && slot.querySelector("video");
  if (existingVid) {
    stageEl.innerHTML = "";
    var clone = existingVid.cloneNode(true);
    clone.className = "spotlight-student-video";
    stageEl.appendChild(clone);
    try {
      var p = clone.play && clone.play();
      if (p && p.catch) p.catch(function () {});
    } catch (e) { /* ignore */ }
    return;
  }
  if (pending && pending.attach) {
    stageEl.innerHTML = "";
    var el = pending.attach();
    el.className = "spotlight-student-video";
    el.muted = true;
    el.autoplay = true;
    el.playsInline = true;
    stageEl.appendChild(el);
  }
}
window.updateSpotlightStudentStage = updateSpotlightStudentStage;

function setSpotlight(mode) {
  applySpotlight(mode, false, mode === "student" ? spotlightUserId : "");
  if (liveSocket && liveSocket.readyState === WebSocket.OPEN && isTeacherRole()) {
    try {
      liveSocket.send(JSON.stringify({
        event: "spotlight",
        mode: currentSpotlight,
        userId: spotlightUserId || undefined,
      }));
    } catch (e) { /* ignore */ }
  }
}
window.setSpotlight = setSpotlight;

function syncSheetBackdrop() {
  var backdrop = document.getElementById("sheet-backdrop");
  if (!backdrop) return;
  var open = false;
  ["more-menu", "reaction-sheet", "controls-sheet"].forEach(function (id) {
    var el = document.getElementById(id);
    if (el && !el.classList.contains("hidden")) open = true;
  });
  backdrop.classList.toggle("hidden", !open);
}

function closeAllSheets() {
  toggleMoreMenu(false);
  toggleReactionSheet(false);
  toggleControlsSheet(false);
}
window.closeAllSheets = closeAllSheets;

function toggleReactionSheet(force) {
  var sheet = document.getElementById("reaction-sheet");
  if (!sheet) return;
  if (typeof force === "boolean") {
    sheet.classList.toggle("hidden", !force);
  } else {
    sheet.classList.toggle("hidden");
  }
  var more = document.getElementById("more-menu");
  if (more && !sheet.classList.contains("hidden")) more.classList.add("hidden");
  syncSheetBackdrop();
}
window.toggleReactionSheet = toggleReactionSheet;

function toggleMoreMenu(force) {
  var sheet = document.getElementById("more-menu");
  if (!sheet) return;
  if (typeof force === "boolean") {
    sheet.classList.toggle("hidden", !force);
  } else {
    sheet.classList.toggle("hidden");
  }
  var react = document.getElementById("reaction-sheet");
  if (react && !sheet.classList.contains("hidden")) react.classList.add("hidden");
  syncSheetBackdrop();
}
window.toggleMoreMenu = toggleMoreMenu;

function applyClassPermissions(perms) {
  if (!perms) return;
  Object.keys(perms).forEach(function (k) {
    classPermissions[k] = !!perms[k];
  });
  window.classPermissions = classPermissions;
  var map = {
    studentsCanUseCamera: "perm-camera",
    studentsCanUseMicrophone: "perm-mic",
    studentsCanChat: "perm-chat",
    studentsCanReact: "perm-react",
    studentsCanRaiseHand: "perm-hand",
    studentsCanWriteBoard: "perm-board",
    studentsCanShareScreen: "perm-screen",
  };
  Object.keys(map).forEach(function (k) {
    var el = document.getElementById(map[k]);
    if (el) el.checked = !!classPermissions[k];
  });
  if (!isTeacherRole()) {
    var cam = document.getElementById("btn-cam");
    var mic = document.getElementById("btn-mic");
    var hand = document.getElementById("btn-hand");
    var chat = document.getElementById("btn-chat");
    var react = document.getElementById("btn-react");
    var micOk = window.studentMicAllowed === true;
    var camOk = window.studentCameraAllowed === true;
    if (cam) {
      cam.disabled = !camOk;
      cam.classList.toggle("media-locked", !camOk);
    }
    if (mic) {
      mic.disabled = !micOk;
      mic.classList.toggle("media-locked", !micOk);
    }
    if (hand) hand.disabled = !classPermissions.studentsCanRaiseHand;
    if (chat) chat.classList.toggle("disabled", !classPermissions.studentsCanChat);
    if (react) react.disabled = !classPermissions.studentsCanReact;
    return;
  }
}
window.applyClassPermissions = applyClassPermissions;

function toggleClassPermission(key, on) {
  if (!isTeacherRole()) return;
  classPermissions[key] = !!on;
  if (liveSocket && liveSocket.readyState === WebSocket.OPEN) {
    liveSocket.send(JSON.stringify({
      event: "set_permissions",
      permissions: classPermissions,
    }));
  }
  showClassroomToast("Permission updated");
}
window.toggleClassPermission = toggleClassPermission;

function showPermissionsPanel() {
  toggleControlsSheet(true);
  toggleHostSidebar(true);
  loadClassAttendance();
}
window.showPermissionsPanel = showPermissionsPanel;

function toggleControlsSheet(forceOpen) {
  var sheet = document.getElementById("controls-sheet");
  if (!sheet) return;
  var open = typeof forceOpen === "boolean" ? forceOpen : sheet.classList.contains("hidden");
  sheet.classList.toggle("hidden", !open);
  syncSheetBackdrop();
}
window.toggleControlsSheet = toggleControlsSheet;

function showSpotlightBarIfHost() {
  var bar = document.getElementById("spotlight-bar");
  if (bar && isTeacherRole()) bar.classList.remove("hidden");
}

document.addEventListener("DOMContentLoaded", function () {
  try { showSpotlightBarIfHost(); } catch (e) { /* ignore */ }
  try { bindRaisedHandActions(); } catch (e2) { /* ignore */ }
  setTimeout(showSpotlightBarIfHost, 800);
});
