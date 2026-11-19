/** Student Assignments + Notice Board — polished desktop UI */

async function loadAssignmentsPage() {
  var submitRoot = document.getElementById("assignments-submit-root");
  var noticeRoot = document.getElementById("assignments-notice-root");
  if (!submitRoot && !noticeRoot) return;
  if (!isStudentLoggedIn()) {
    if (submitRoot) {
      submitRoot.innerHTML =
        '<div class="as-empty"><div class="as-empty-icon">&#128274;</div><h3>Sign in required</h3><p>Log in to submit assignments and see your private scores.</p></div>';
    }
    return;
  }
  if (submitRoot) submitRoot.innerHTML = '<div class="loading">Loading assignments…</div>';
  if (noticeRoot) noticeRoot.innerHTML = '<div class="loading">Loading notice board…</div>';

  try {
    var teachers = [];
    var announcements = [];
    var mine = [];
    try {
      teachers = await api("/api/v1/profiles/teachers");
      if (!Array.isArray(teachers)) teachers = (teachers && teachers.teachers) || [];
    } catch (e) { teachers = []; }
    try {
      announcements = await api("/api/v1/community/announcements");
      if (!Array.isArray(announcements)) announcements = (announcements && announcements.posts) || [];
    } catch (e) { announcements = []; }
    try {
      mine = await api("/api/v1/community/assignments/mine");
      if (!Array.isArray(mine)) mine = (mine && mine.submissions) || [];
    } catch (e) { mine = []; }
    // Submission target channel (same rule the mobile app uses).
    try {
      var channels = await api("/api/v1/community/channels");
      if (!Array.isArray(channels)) channels = (channels && channels.channels) || [];
      for (var ci = 0; ci < channels.length; ci++) {
        var ch = channels[ci] || {};
        var marker = ((ch.name || "") + " " + (ch.channel_type || "")).toLowerCase();
        if (marker.indexOf("announcement") >= 0 || marker.indexOf("teacher") >= 0) {
          window._assignmentsChannelId = ch.id || "";
          break;
        }
      }
      if (!window._assignmentsChannelId && channels.length && channels[0].id) {
        window._assignmentsChannelId = channels[0].id;
      }
    } catch (e) { /* submit will surface the error */ }

    if (submitRoot) {
      var teacherOpts = teachers
        .map(function (t) {
          var id = t.user_id || t.id || "";
          var name = t.full_name || t.name || "Teacher";
          return '<option value="' + asEsc(id) + '">' + asEsc(name) + "</option>";
        })
        .join("");

      var pdfList = announcements.filter(function (a) {
        var m = (a.media_type || "").toLowerCase();
        var u = (a.media_url || "").toLowerCase();
        return m.indexOf("pdf") >= 0 || u.indexOf(".pdf") >= 0;
      });

      var pdfCards = pdfList.length
        ? '<div class="as-pdf-grid">' +
          pdfList
            .map(function (a) {
              var title = (a.content || "PDF assignment").trim().split("\n")[0].slice(0, 90);
              return (
                '<article class="as-pdf-card">' +
                '<div class="as-pdf-icon">&#128196;</div>' +
                '<div class="as-pdf-body">' +
                "<h4>" + asEsc(title || "PDF assignment") + "</h4>" +
                "<p>" + asEsc(a.author_name || "Teacher") + "</p>" +
                "</div>" +
                (a.media_url
                  ? '<a class="as-pdf-open" href="' + asEsc(resolveMedia(a.media_url)) + '" target="_blank" rel="noopener">Open PDF</a>'
                  : "") +
                "</article>"
              );
            })
            .join("") +
          "</div>"
        : '<div class="as-empty as-empty-sm"><div class="as-empty-icon">&#128196;</div><h3>No PDF assignments yet</h3><p>When a teacher posts a PDF notice, it will show up here.</p></div>';

      submitRoot.innerHTML =
        '<div class="as-layout">' +
        '<section class="as-panel">' +
        '<div class="as-panel-head"><span class="as-step">1</span><div><h3>Teacher assignments</h3><p>Download the PDF your teacher posted</p></div></div>' +
        pdfCards +
        "</section>" +
        '<section class="as-panel as-submit-panel">' +
        '<div class="as-panel-head"><span class="as-step">2</span><div><h3>Submit your work</h3><p>Tag a teacher and upload your completed PDF</p></div></div>' +
        '<div class="as-form">' +
        '<label class="as-field"><span>Tag teacher</span>' +
        '<select id="as-teacher"><option value="">Select teacher</option>' + teacherOpts + "</select></label>" +
        '<label class="as-field"><span>Title / note</span>' +
        '<input type="text" id="as-caption" placeholder="e.g. Mathematics homework — week 3" /></label>' +
        '<label class="as-drop" for="as-file">' +
        '<input type="file" id="as-file" hidden />' +
        '<span class="as-drop-icon">&#128228;</span>' +
        '<strong id="as-file-label">Choose completed work</strong>' +
        "<small>Any file: PDF, image, Word, Excel, PowerPoint… · private to you and your teacher</small>" +
        "</label>" +
        '<p id="as-error" class="error-msg"></p>' +
        '<button type="button" class="btn-action as-submit-btn" onclick="submitAssignmentDesktop()">Submit to teacher</button>' +
        "</div></section></div>";

      var fileInput = document.getElementById("as-file");
      if (fileInput) {
        fileInput.addEventListener("change", function () {
          var label = document.getElementById("as-file-label");
          if (label) {
            label.textContent =
              fileInput.files && fileInput.files[0]
                ? fileInput.files[0].name
                : "Choose completed work";
          }
        });
      }
    }

    if (noticeRoot) {
      if (!mine.length) {
        noticeRoot.innerHTML =
          '<div class="as-empty"><div class="as-empty-icon">&#128203;</div><h3>No submissions yet</h3><p>Your private scores and teacher feedback will appear here. Other students cannot see them.</p></div>';
      } else {
        noticeRoot.innerHTML =
          '<div class="as-notice-intro"><h3>Your private results</h3><p>Only you and your tagged teacher can see these.</p></div>' +
          '<div class="as-notice-list">' +
          mine
            .map(function (item) {
              var score = item.result_score;
              var feedback = item.result_feedback || "";
              var status = item.status || "submitted";
              var graded = !!score;
              return (
                '<article class="as-notice-card ' + (graded ? "is-graded" : "is-pending") + '">' +
                '<div class="as-notice-status">' + (graded ? "Graded" : asEsc(status)) + "</div>" +
                "<h4>" + asEsc(item.caption || "Assignment submission") + "</h4>" +
                (graded
                  ? '<p class="as-score">Score: <strong>' + asEsc(String(score)) + "</strong></p>"
                  : '<p class="as-pending-copy">Waiting for teacher feedback</p>') +
                (feedback ? '<p class="as-feedback">' + asEsc(feedback) + "</p>" : "") +
                "</article>"
              );
            })
            .join("") +
          "</div>";
      }
    }
  } catch (e) {
    if (submitRoot) {
      submitRoot.innerHTML =
        '<div class="as-empty"><h3>Could not load</h3><p>' + asEsc(e.message) + "</p></div>";
    }
  }
}

function asEsc(s) {
  var d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
}

function resolveMedia(url) {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return (typeof API_BASE !== "undefined" ? API_BASE : "") + (url.startsWith("/") ? url : "/" + url);
}

async function submitAssignmentDesktop() {
  var err = document.getElementById("as-error");
  var teacherId = (document.getElementById("as-teacher") || {}).value || "";
  var caption = ((document.getElementById("as-caption") || {}).value || "").trim();
  var fileInput = document.getElementById("as-file");
  var file = fileInput && fileInput.files && fileInput.files[0];
  if (!teacherId) {
    if (err) err.textContent = "Select a teacher.";
    return;
  }
  if (!file) {
    if (err) err.textContent = "Choose your completed work (any file type).";
    return;
  }
  if (err) err.textContent = "";
  try {
    var token = getToken();
    // 1) Upload the file (any type) — same endpoint the mobile app uses.
    var upForm = new FormData();
    upForm.append("file", file);
    var up = await fetch(API_BASE + "/api/v1/community/upload", {
      method: "POST",
      headers: token ? { Authorization: "Bearer " + token } : {},
      body: upForm,
    });
    var uploaded = await up.json().catch(function () { return {}; });
    if (!up.ok) throw new Error(uploaded.detail || uploaded.message || "Upload failed");
    var fileUrl = uploaded.file_url || uploaded.secure_url || uploaded.url;
    if (!fileUrl) throw new Error("Could not store the file. Try again.");
    // 2) Submit the assignment (JSON) with the uploaded file URL.
    var res = await api("/api/v1/community/assignments", {
      method: "POST",
      body: JSON.stringify({
        channel_id: (window._assignmentsChannelId || ""),
        tagged_teacher_id: teacherId,
        file_url: fileUrl,
        file_type: uploaded.file_type || "doc",
        caption: caption || null,
      }),
    });
    alert("Assignment submitted!");
    loadAssignmentsPage();
  } catch (e) {
    if (err) err.textContent = e.message || "Submit failed.";
  }
}

function switchAssignmentsTab(tab) {
  var submit = document.getElementById("assignments-submit-root");
  var notice = document.getElementById("assignments-notice-root");
  var tSubmit = document.getElementById("as-tab-submit");
  var tNotice = document.getElementById("as-tab-notice");
  if (!submit || !notice) return;
  var isSubmit = tab !== "notice";
  submit.classList.toggle("hidden", !isSubmit);
  notice.classList.toggle("hidden", isSubmit);
  if (tSubmit) tSubmit.classList.toggle("active", isSubmit);
  if (tNotice) tNotice.classList.toggle("active", !isSubmit);
}

window.loadAssignmentsPage = loadAssignmentsPage;
window.submitAssignmentDesktop = submitAssignmentDesktop;
window.switchAssignmentsTab = switchAssignmentsTab;
