/* External Exam — school CBT that does not belong to the student's own account.
   Moved out of the login screen: the student opens it from this tab, enters the
   Registration Number and Access Code from the exam slip, and lands in the
   exam portal (exam.html). Its session uses its own keys (sia_exam_*), so it
   never mixes with the normal student login. */
(function () {
  function el(id) {
    return document.getElementById(id);
  }
  function apiBase() {
    try {
      if (typeof API_BASE !== "undefined" && API_BASE) return API_BASE;
    } catch (e) { /* ignore */ }
    return "https://scholaxia1.onrender.com";
  }
  function fetchTimeout(ms) {
    if (typeof AbortController === "undefined") return undefined;
    var ctrl = new AbortController();
    setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, ms);
    return ctrl.signal;
  }
  function say(text, ok) {
    var m = el("xexam-msg");
    if (!m) return;
    m.textContent = text || "";
    m.className = "xexam-msg" + (ok ? " is-ok" : text ? " is-err" : "");
  }
  function signedInIdentity() {
    try {
      var user = JSON.parse(localStorage.getItem("sia_exam_user") || "null");
      if (!user) return null;
      var typed = JSON.parse(localStorage.getItem("sia_exam_login_typed") || "null");
      return { user: user, typed: typed || {} };
    } catch (e) {
      return null;
    }
  }

  function paintSignedIn() {
    var box = el("xexam-signed");
    var identity = signedInIdentity();
    var hasToken = false;
    try { hasToken = !!localStorage.getItem("sia_exam_token"); } catch (e) {}
    if (!box) return;
    if (!identity || !hasToken) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    box.hidden = false;
    box.innerHTML =
      '<p class="xexam-signed-line">Signed in as <strong>' +
      String(identity.user.full_name || "Exam student").replace(/[<>&]/g, "") +
      "</strong>" +
      (identity.typed.reg ? " · " + String(identity.typed.reg).replace(/[<>&]/g, "") : "") +
      "</p>" +
      '<div class="xexam-actions">' +
      '<button type="button" class="btn-primary" onclick="location.href=\'exam.html\'">Open my exam</button>' +
      '<button type="button" class="btn-secondary" onclick="externalExamSignOut()">Use another slip</button>' +
      "</div>";
  }

  window.refreshExternalExam = paintSignedIn;

  window.externalExamSignOut = function () {
    ["sia_exam_token", "sia_exam_user", "sia_exam_login_typed", "sia_exam_identity"].forEach(function (k) {
      try { localStorage.removeItem(k); } catch (e) {}
    });
    paintSignedIn();
    say("Signed out of the exam. Enter another slip to continue.");
  };

  window.externalExamLogin = async function (event) {
    if (event && event.preventDefault) event.preventDefault();
    var reg = (el("xexam-reg").value || "").trim();
    var code = (el("xexam-code").value || "").trim();
    var btn = el("xexam-btn");
    say("");
    if (!reg || !code) {
      say("Enter the registration number and access code from your exam slip.");
      return;
    }
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Checking…";
    }
    try {
      var res = await fetch(apiBase() + "/api/v1/school-cbt/student/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reg_number: reg, access_code: code }),
        signal: fetchTimeout(45000),
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        say(typeof data.detail === "string" ? data.detail : "That registration number or access code did not work. Check your exam slip.");
        return;
      }
      if (!data.access_token || !data.student) {
        say("Unexpected reply from the server. Try again.");
        return;
      }
      localStorage.setItem("sia_exam_token", data.access_token);
      localStorage.setItem("sia_exam_user", JSON.stringify(data.student));
      localStorage.setItem("sia_exam_login_typed", JSON.stringify({ reg: reg, code: code }));
      // Needed to re-open a downloaded package later, even offline.
      try { localStorage.setItem("sia_exam_identity", JSON.stringify({ reg_number: reg, access_code: code })); } catch (e) {}
      window.location.href = "exam.html";
    } catch (ex) {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        say("You are offline. Open this tab once with internet so your exam downloads — after that it works offline.");
      } else {
        say("Network error. Check your connection and try again.");
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Open Exam";
      }
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", paintSignedIn);
  } else {
    paintSignedIn();
  }
})();
