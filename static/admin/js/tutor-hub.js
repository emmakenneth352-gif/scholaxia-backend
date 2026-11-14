/* ── Tutor Hub ────────────────────────────────────────────────────────────
   The platform admin sends study material straight to a tutor (or to every
   tutor), and checks the lesson notes tutors submit. Separate from any
   school portal. */

var TH_NOTES = [];
var TH_MATERIALS = [];

function thEsc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

async function loadTutorHub() {
  await loadTutorList();
  loadTutorMaterials();
  loadTutorNotes();
}

async function loadTutorList() {
  var sel = document.getElementById("thTutor");
  if (!sel) return;
  try {
    var d = await adminApi("/api/v1/tutor-hub/tutors");
    var tutors = d.tutors || [];
    sel.innerHTML = '<option value="">Every tutor (' + tutors.length + ')</option>' +
      tutors.map(function (t) {
        return '<option value="' + thEsc(t.id) + '">' + thEsc(t.name || t.email) + (t.email ? " — " + thEsc(t.email) : "") + "</option>";
      }).join("");
  } catch (e) {
    sel.innerHTML = '<option value="">Could not load tutors</option>';
  }
}

async function loadTutorMaterials() {
  var box = document.getElementById("thMaterials");
  if (!box) return;
  try {
    var d = await adminApi("/api/v1/tutor-hub/materials");
    TH_MATERIALS = d.materials || [];
    if (!TH_MATERIALS.length) { box.innerHTML = '<div class="loading">No material sent yet.</div>'; return; }
    box.innerHTML =
      '<table><thead><tr><th>Title</th><th>Sent to</th><th>Subject / Class</th><th>Link</th><th>Sent</th><th></th></tr></thead><tbody>' +
      TH_MATERIALS.map(function (m) {
        var sc = [m.subject, m.class_name].filter(Boolean).join(" · ") || "—";
        return "<tr><td><strong>" + thEsc(m.title) + "</strong>" +
          (m.description ? '<div class="cbt-hint small">' + thEsc(m.description) + "</div>" : "") + "</td>" +
          "<td>" + thEsc(m.tutor_name || (m.teacher_id ? "One tutor" : "Every tutor")) + "</td>" +
          "<td>" + thEsc(sc) + "</td>" +
          "<td>" + (m.link_url ? '<a href="' + thEsc(m.link_url) + '" target="_blank" rel="noopener">Open</a>' : "—") + "</td>" +
          "<td>" + thEsc((m.created_at || "").slice(0, 10)) + "</td>" +
          '<td><button class="btn-sm secondary" onclick="deleteTutorMaterial(\'' + m.id + '\')">Delete</button></td></tr>';
      }).join("") + "</tbody></table>";
  } catch (e) {
    box.innerHTML = '<div class="loading">' + thEsc(e.message || "Could not load materials") + "</div>";
  }
}

async function sendTutorMaterial() {
  var title = (document.getElementById("thTitle").value || "").trim();
  var msg = document.getElementById("thMsg");
  if (!title) { msg.textContent = "Give the material a title."; return; }
  var btn = document.getElementById("thSend");
  btn.disabled = true; msg.textContent = "Sending…";
  try {
    await adminApi("/api/v1/tutor-hub/materials", {
      method: "POST",
      body: JSON.stringify({
        title: title,
        teacher_id: document.getElementById("thTutor").value || null,
        subject: (document.getElementById("thSubject").value || "").trim() || null,
        class_name: (document.getElementById("thClass").value || "").trim() || null,
        link_url: (document.getElementById("thLink").value || "").trim() || null,
        description: (document.getElementById("thDesc").value || "").trim() || null,
      }),
    });
    msg.textContent = "✓ Sent to the tutor";
    ["thTitle", "thSubject", "thClass", "thLink", "thDesc"].forEach(function (id) {
      var el = document.getElementById(id); if (el) el.value = "";
    });
    loadTutorMaterials();
  } catch (e) {
    msg.textContent = e.message || "Could not send it";
  }
  btn.disabled = false;
}

async function deleteTutorMaterial(id) {
  if (!confirm("Remove this material for the tutor?")) return;
  try {
    await adminApi("/api/v1/tutor-hub/materials/" + encodeURIComponent(id), { method: "DELETE" });
    loadTutorMaterials();
  } catch (e) {
    alert(e.message || "Could not delete it");
  }
}

async function loadTutorNotes() {
  var box = document.getElementById("thNotes");
  if (!box) return;
  try {
    var d = await adminApi("/api/v1/tutor-hub/notes");
    TH_NOTES = d.notes || [];
    if (!TH_NOTES.length) { box.innerHTML = '<div class="loading">No lesson notes yet.</div>'; return; }
    box.innerHTML =
      '<table><thead><tr><th>Tutor</th><th>Lesson note</th><th>Subject / Class</th><th>Status</th><th>Submitted</th><th></th></tr></thead><tbody>' +
      TH_NOTES.map(function (n) {
        var sc = [n.subject, n.class_name].filter(Boolean).join(" · ") || "—";
        var pill = n.status === "approved" ? "background:#e7f8ee;color:#137a3a" :
          n.status === "needs_work" ? "background:#fdecec;color:#b3261e" : "background:#fff4e5;color:#a15c00";
        return "<tr><td><strong>" + thEsc(n.tutor_name || "Tutor") + "</strong></td>" +
          "<td>" + thEsc(n.title) + '<div class="cbt-hint small">' + thEsc((n.content || "").slice(0, 120)) + ((n.content || "").length > 120 ? "…" : "") + "</div></td>" +
          "<td>" + thEsc(sc) + "</td>" +
          '<td><span style="' + pill + ';padding:3px 9px;border-radius:20px;font-size:12px;font-weight:600">' + thEsc(n.status) + "</span></td>" +
          "<td>" + thEsc((n.created_at || "").slice(0, 10)) + "</td>" +
          '<td style="white-space:nowrap"><button class="btn-sm secondary" onclick="openTutorNote(\'' + n.id + '\')">Read</button> ' +
          '<button class="btn-sm" onclick="reviewTutorNote(\'' + n.id + '\',\'approved\')">Approve</button> ' +
          '<button class="btn-sm secondary" onclick="reviewTutorNote(\'' + n.id + '\',\'needs_work\')">Needs work</button></td></tr>';
      }).join("") + "</tbody></table>";
  } catch (e) {
    box.innerHTML = '<div class="loading">' + thEsc(e.message || "Could not load lesson notes") + "</div>";
  }
}

function openTutorNote(id) {
  var n = TH_NOTES.filter(function (x) { return x.id === id; })[0];
  if (!n) return;
  var w = window.open("", "_blank", "width=720,height=760");
  if (!w) { alert(n.title + "\n\n" + n.content); return; }
  w.document.write(
    "<!doctype html><html><head><meta charset='utf-8'><title>" + thEsc(n.title) + "</title>" +
    "<style>body{font-family:system-ui,Arial,sans-serif;margin:28px;line-height:1.65;color:#111}h1{font-size:20px;margin:0 0 4px}" +
    ".m{color:#64748b;font-size:13px;margin:0 0 18px}.c{white-space:pre-wrap;font-size:15px;border-top:1px solid #e2e8f0;padding-top:16px}" +
    ".cm{margin-top:20px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px;font-size:14px}</style></head><body>" +
    "<h1>" + thEsc(n.title) + "</h1>" +
    "<p class='m'>" + thEsc(n.tutor_name || "Tutor") + " · " + thEsc([n.subject, n.class_name, n.week, n.term].filter(Boolean).join(" · ")) + "</p>" +
    "<div class='c'>" + thEsc(n.content) + "</div>" +
    (n.attachment_url ? "<p><a href='" + thEsc(n.attachment_url) + "' target='_blank'>Attachment</a></p>" : "") +
    (n.admin_comment ? "<div class='cm'><strong>Your comment:</strong><br/>" + thEsc(n.admin_comment) + "</div>" : "") +
    "</body></html>"
  );
  w.document.close();
}

async function reviewTutorNote(id, status) {
  var label = status === "approved" ? "Approve this lesson note?" : "Send it back for more work?";
  if (!confirm(label)) return;
  var comment = prompt("Comment for the tutor (optional):", "") || "";
  try {
    await adminApi("/api/v1/tutor-hub/notes/" + encodeURIComponent(id), {
      method: "PATCH",
      body: JSON.stringify({ status: status, admin_comment: comment || null }),
    });
    loadTutorNotes();
  } catch (e) {
    alert(e.message || "Could not update the note");
  }
}
