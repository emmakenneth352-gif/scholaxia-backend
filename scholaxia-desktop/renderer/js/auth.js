// API_BASE, fetchTimeout, getToken, saveSession — from api.js (loaded first)

var selectedAccountRole = "student";

var ROLE_CONFIG = {
  student: {
    portalTitle: { login: "STUDENT PORTAL", signup: "CREATE ACCOUNT" },
    portalSub: {
      login: "Sign in to access live classes, exams & CBT",
      signup: "Join Scholaxia — free for all students",
    },
    signupBtn: "CREATE ACCOUNT",
    expectedRole: "student",
    allowSignup: true,
  },
  teacher: {
    portalTitle: { login: "TEACHER PORTAL", signup: "TEACHER PORTAL" },
    portalSub: {
      login: "Sign in to host live classes and manage students",
      signup: "Teachers are added by admin — use Log in",
    },
    signupBtn: "CREATE ACCOUNT",
    expectedRole: "teacher",
    allowSignup: false,
  },
  kind: {
    portalTitle: { login: "KID PORTAL", signup: "KID SIGN UP" },
    portalSub: {
      login: "Young learners ages 3–12 — kid-safe AI & games",
      signup: "Create a Scholaxia Kids account",
    },
    signupBtn: "CREATE KID ACCOUNT",
    expectedRole: "kind",
    allowSignup: true,
  },
  exam: {
    portalTitle: { login: "EXAM PORTAL", signup: "EXAM PORTAL" },
    portalSub: {
      login: "School Examination — registration number + access code",
      signup: "School Examination — registration number + access code",
    },
    signupBtn: "CREATE ACCOUNT",
    expectedRole: "exam",
    allowSignup: false,
  },
};

document.addEventListener("DOMContentLoaded", function () {
  try {
    initAuthPage();
  } catch (err) {
    console.error("Auth init error:", err);
    alert("App failed to load: " + err.message);
  }
});

function initAuthPage() {
  if (typeof getToken !== "function") {
    throw new Error("api.js did not load — check js/api.js file");
  }

  // Deep link from the exam portal's "← Portal" link: keep the exam-only view
  // open even when a normal student/teacher session already exists.
  var bootParams0 = new URLSearchParams(window.location.search);
  var examDeepLink = bootParams0.get("exam") === "1" && !!document.getElementById("tab-exam");

  if (!examDeepLink && getToken()) {
    redirectIfAlreadyLoggedIn();
    return;
  }

  var remembered = localStorage.getItem("sia_remember_email");
  if (remembered) {
    var loginEmailEl = document.getElementById("login-email");
    if (loginEmailEl) loginEmailEl.value = remembered;
    document.getElementById("remember-me").checked = true;
  }

  initRoleSelector();

  document.getElementById("tab-login").addEventListener("click", function () { switchTab("login"); });
  document.getElementById("tab-signup").addEventListener("click", function () { switchTab("signup"); });
  document.getElementById("tab-exam").addEventListener("click", function () { switchTab("exam"); });
  document.getElementById("go-signup").addEventListener("click", function () { switchTab("signup"); });
  document.getElementById("go-login").addEventListener("click", function () { switchTab("login"); });
  document.getElementById("form-login").addEventListener("submit", login);
  document.getElementById("form-signup").addEventListener("submit", signup);
  var examForm = document.getElementById("form-exam");
  if (examForm) examForm.addEventListener("submit", examLogin);

  document.querySelectorAll(".toggle-pw").forEach(function (btn) {
    btn.addEventListener("click", function () { togglePw(btn.dataset.target, btn); });
  });

  initIntroPage();

  if (examDeepLink) {
    // Exam deep link: the card shows ONLY registration number + access code.
    setAccountRole("exam");
    return;
  }

  updatePortalCopy();

  var params = new URLSearchParams(window.location.search);
  var ret = params.get("return");
  var joinClass = params.get("class") || params.get("join");
  var roleParam = params.get("role");
  if (roleParam && ROLE_CONFIG[roleParam]) {
    setAccountRole(roleParam);
  }
  if (joinClass) {
    if (typeof savePendingJoin === "function") {
      savePendingJoin({ class_id: joinClass, code: null });
    } else {
      sessionStorage.setItem("sia_pending_join", JSON.stringify({ class_id: joinClass, code: null }));
    }
    setTimeout(function () { scrollToAuth("login"); }, 400);
  } else if (ret) {
    sessionStorage.setItem("sia_login_return", ret);
    setTimeout(function () { scrollToAuth("login"); }, 400);
  }
}

function redirectIfAlreadyLoggedIn() {
  var joinParams = new URLSearchParams(window.location.search);
  var joinClass = joinParams.get("class") || joinParams.get("join");
  var role = localStorage.getItem("sia_role") || "student";
  var teacherTok = localStorage.getItem("sia_teacher_token");

  if (teacherTok && (role === "teacher" || role === "admin")) {
    window.location.href = "teacher.html";
    return;
  }
  if (role === "kind") {
    window.location.href = "kind.html";
    return;
  }
  if (joinClass) {
    window.location.href = "app.html?join=" + encodeURIComponent(joinClass);
    return;
  }
  var pending = typeof consumePendingJoin === "function" ? consumePendingJoin() : null;
  if (pending && pending.class_id) {
    window.location.href = "app.html?join=" + encodeURIComponent(pending.class_id);
    return;
  }
  if (localStorage.getItem("sia_app_resume_mode") === "league") {
    try { localStorage.removeItem("sia_app_resume_mode"); } catch (e) { /* ignore */ }
  }
  window.location.href = "app.html";
}

function initRoleSelector() {
  var grid = document.getElementById("role-select-grid");
  if (!grid) return;
  grid.querySelectorAll(".role-select-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      setAccountRole(btn.getAttribute("data-role"));
    });
  });
}

function markRoleGrid(role) {
  var grid = document.getElementById("role-select-grid");
  if (!grid) return;
  grid.querySelectorAll(".role-select-btn").forEach(function (btn) {
    btn.classList.toggle("active", btn.getAttribute("data-role") === role);
  });
}

function setAccountRole(role) {
  if (!ROLE_CONFIG[role]) role = "student";
  selectedAccountRole = role;
  markRoleGrid(role);
  var examTab = document.getElementById("tab-exam");
  if (role === "exam") {
    // The Exam role IS the exam-only view: registration number + access code.
    if (examTab && !examTab.classList.contains("active")) switchTab("exam");
    else updatePortalCopy();
  } else if (examTab && examTab.classList.contains("active")) {
    // Picking a normal role while the exam-only view is open returns to Log in.
    switchTab("login");
  } else {
    updatePortalCopy();
  }
}

function updatePortalCopy() {
  var cfg = ROLE_CONFIG[selectedAccountRole] || ROLE_CONFIG.student;
  var examTabEl = document.getElementById("tab-exam");
  var examActive = examTabEl && examTabEl.classList.contains("active");
  var tabLogin = document.getElementById("tab-login").classList.contains("active");
  var mode = tabLogin ? "login" : "signup";

  if (examActive) {
    document.getElementById("portal-title").textContent = "EXAM PORTAL";
    document.getElementById("portal-sub").textContent = "School Examination — registration number + access code";
  } else {
    document.getElementById("portal-title").textContent = cfg.portalTitle[mode];
    document.getElementById("portal-sub").textContent = cfg.portalSub[mode];
  }
  document.getElementById("btn-signup").textContent =
    selectedAccountRole === "kind" ? "SEND EMAIL CODE" : cfg.signupBtn === "CREATE ACCOUNT" ? "SEND EMAIL CODE" : cfg.signupBtn;

  var kindFields = document.getElementById("signup-kind-fields");
  if (kindFields) {
    kindFields.classList.toggle("hidden", selectedAccountRole !== "kind" || mode === "login");
  }

  var signupTab = document.getElementById("tab-signup");
  if ((selectedAccountRole === "teacher" || selectedAccountRole === "exam") && signupTab) {
    signupTab.style.opacity = "0.5";
  } else if (signupTab) {
    signupTab.style.opacity = "1";
  }
}

function scrollToAuth(tab) {
  var panel = document.getElementById("auth");
  if (panel) panel.scrollIntoView({ behavior: "smooth", block: "center" });
  if (tab) switchTab(tab);
}

function initIntroPage() {
  var heroLogin = document.getElementById("hero-login");
  var heroRegister = document.getElementById("hero-register");
  var navLogin = document.getElementById("nav-login");
  var navRegister = document.getElementById("nav-register");
  var contactForm = document.getElementById("contact-form");

  if (heroLogin) heroLogin.addEventListener("click", function () { scrollToAuth("login"); });
  if (heroRegister) heroRegister.addEventListener("click", function () { scrollToAuth("signup"); });
  if (navLogin) navLogin.addEventListener("click", function (e) {
    e.preventDefault();
    scrollToAuth("login");
  });
  if (navRegister) navRegister.addEventListener("click", function () { scrollToAuth("signup"); });

  if (contactForm) {
    contactForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var ok = document.getElementById("contact-success");
      if (ok) ok.classList.remove("hidden");
      contactForm.reset();
      setTimeout(function () {
        if (ok) ok.classList.add("hidden");
      }, 6000);
    });
  }

  if ("IntersectionObserver" in window) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15, rootMargin: "0px 0px -40px 0px" });

    document.querySelectorAll(".reveal").forEach(function (el) {
      observer.observe(el);
    });
  } else {
    document.querySelectorAll(".reveal").forEach(function (el) {
      el.classList.add("visible");
    });
  }
}

function switchTab(tab) {
  var isLogin = tab === "login";
  var isExam = tab === "exam";
  var cfg = ROLE_CONFIG[selectedAccountRole] || ROLE_CONFIG.student;

  if (!isLogin && !isExam && selectedAccountRole === "teacher") {
    alert("Teacher accounts are created by your school admin. Please use Log in.");
    return;
  }

  document.getElementById("tab-login").classList.toggle("active", isLogin);
  document.getElementById("tab-signup").classList.toggle("active", !isLogin && !isExam);
  document.getElementById("tab-exam").classList.toggle("active", isExam);
  // Exam view is exam-only: the email/Student-ID login tabs stay out of sight,
  // so the card shows just the Registration Number + Access Code form.
  document.getElementById("tab-login").classList.toggle("hidden", isExam);
  document.getElementById("tab-signup").classList.toggle("hidden", isExam);
  document.getElementById("form-login").classList.toggle("hidden", !isLogin);
  document.getElementById("form-signup").classList.toggle("hidden", isLogin || isExam);
  var examForm = document.getElementById("form-exam");
  if (examForm) examForm.classList.toggle("hidden", !isExam);
  document.getElementById("login-error").textContent = "";
  document.getElementById("signup-error").textContent = "";
  var examErr = document.getElementById("exam-error");
  if (examErr) examErr.textContent = "";
  if (typeof backToSignupDetails === "function") backToSignupDetails();

  // Role ↔ tab stay in sync: opening the Exam tab selects the Exam role, and
  // leaving it returns any stale Exam selection to Student (the email/Student-ID
  // login form is for normal accounts).
  if (isExam) {
    if (selectedAccountRole !== "exam") {
      selectedAccountRole = "exam";
      markRoleGrid("exam");
    }
  } else if (selectedAccountRole === "exam") {
    selectedAccountRole = "student";
    markRoleGrid("student");
  }
  updatePortalCopy();
}

/* Exam tab: reg number + access code → the School Examination portal.
   Separate session keys (sia_exam_token/user) so an exam session never mixes
   with the student/teacher app session. The portal page (exam.html) keeps its
   own offline engine — packages downloaded there work with no internet. */
async function examLogin(e) {
  if (e) e.preventDefault();
  var reg = (document.getElementById("exam-reg").value || "").trim();
  var code = (document.getElementById("exam-code").value || "").trim();
  var err = document.getElementById("exam-error");
  var btn = document.getElementById("btn-exam-login");
  err.textContent = "";
  if (!reg || !code) {
    err.textContent = "Enter the registration number and access code from your exam slip.";
    return;
  }
  btn.disabled = true;
  btn.textContent = "LOGGING IN...";
  try {
    var res = await fetch(API_BASE + "/api/v1/school-cbt/student/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reg_number: reg, access_code: code }),
      signal: fetchTimeout(45000),
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      err.textContent = typeof data.detail === "string" ? data.detail : "Login failed. Check your registration number and access code.";
      return;
    }
    if (!data.access_token || !data.student) {
      err.textContent = "Unexpected server response. Try again.";
      return;
    }
    localStorage.setItem("sia_exam_token", data.access_token);
    localStorage.setItem("sia_exam_user", JSON.stringify(data.student));
    localStorage.setItem("sia_exam_login_typed", JSON.stringify({ reg: reg, code: code }));
    // Durable offline identity — packages downloaded in any later session need
    // the access code to silently re-login when a sealed submission syncs.
    try { localStorage.setItem("sia_exam_identity", JSON.stringify({ reg_number: reg, access_code: code })); } catch (e) {}
    window.location.href = "exam.html";
  } catch (ex) {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      err.textContent = "You are offline. Open the Exam tab on a connection once to download your exam — after that it works offline inside the portal.";
    } else {
      err.textContent = "Network error. Check your connection and try again.";
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "LOGIN TO EXAMINATION";
  }
}
window.examLogin = examLogin;

function togglePw(id, btn) {
  var input = document.getElementById(id);
  var show = input.type === "password";
  input.type = show ? "text" : "password";
  btn.style.opacity = show ? "1" : "0.45";
}

function roleMismatchMessage(selected, actual) {
  if (selected === "teacher") return "This account is not a teacher. Pick the correct role above.";
  if (selected === "kind") return "This account is not a Kid account. Pick Student or create a Kid account.";
  if (selected === "student") {
    if (actual === "teacher") return "This is a teacher account. Select Teacher above.";
    if (actual === "kind") return "This is a Kid account. Select Kid above.";
  }
  return "Account type does not match. Check the role you selected.";
}

async function routeAfterAuth(accessToken, role, email, nameOverride) {
  if (selectedAccountRole === "teacher") {
    if (typeof saveTeacherSession === "function") {
      saveTeacherSession({ access_token: accessToken, user: { full_name: nameOverride } }, email, nameOverride);
    } else {
      localStorage.setItem("sia_teacher_token", accessToken);
      localStorage.setItem("sia_teacher_email", email);
      if (nameOverride) localStorage.setItem("sia_teacher_name", nameOverride);
    }
    localStorage.setItem("sia_role", role);
    window.location.href = "teacher.html";
    return;
  }

  if (role === "kind") {
    saveSession({ access_token: accessToken, role: role }, email, nameOverride);
    try {
      var kp = await fetch(API_BASE + "/api/v1/kind/me", {
        headers: { Authorization: "Bearer " + accessToken },
        signal: fetchTimeout(30000),
      });
      if (kp.ok) {
        var kd = await kp.json();
        localStorage.setItem("sia_name", kd.full_name || nameOverride || email);
        localStorage.setItem("sia_age_group", kd.age_group || "");
      }
    } catch (e) { /* ignore */ }
    window.location.href = "kind.html";
    return;
  }

  try {
    var p = await fetch(API_BASE + "/api/v1/students/me", {
      headers: { Authorization: "Bearer " + accessToken },
      signal: fetchTimeout(30000),
    });
    if (p.ok) {
      var pd = await p.json();
      localStorage.setItem("sia_name", pd.full_name || nameOverride || email);
      localStorage.setItem("sia_exam_type", pd.exam_type || "");
      localStorage.setItem("sia_subjects", JSON.stringify(pd.selected_subjects || []));
    } else {
      localStorage.setItem("sia_name", nameOverride || email);
    }
  } catch (e) {
    localStorage.setItem("sia_name", nameOverride || email);
  }

  saveSession({ access_token: accessToken, role: role }, email, nameOverride);

  localStorage.removeItem("sia_app_resume_mode");

  var ret = sessionStorage.getItem("sia_login_return");
  sessionStorage.removeItem("sia_login_return");
  try { sessionStorage.setItem("sia_skip_splash", "1"); } catch (e) { /* ignore */ }

  var pending = typeof consumePendingJoin === "function" ? consumePendingJoin() : null;
  if (!pending) {
    try {
      var raw = sessionStorage.getItem("sia_pending_join");
      sessionStorage.removeItem("sia_pending_join");
      if (raw) pending = JSON.parse(raw);
    } catch (e) { /* ignore */ }
  }
  if (pending && pending.class_id) {
    window.location.href = "app.html?join=" + encodeURIComponent(pending.class_id);
    return;
  }

  if (ret) {
    window.location.href = "app.html?open=" + encodeURIComponent(ret);
  } else {
    window.location.href = "app.html";
  }
}

async function login(e) {
  e.preventDefault();
  var email = document.getElementById("login-email").value.trim();
  var password = document.getElementById("login-password").value;
  // A value without "@" is a school Student ID / reg number, not an email
  var isEmailId = email.indexOf("@") >= 0;
  var err = document.getElementById("login-error");
  var btn = document.getElementById("btn-login");
  var cfg = ROLE_CONFIG[selectedAccountRole] || ROLE_CONFIG.student;
  err.textContent = "";
  btn.disabled = true;
  btn.textContent = "LOGGING IN...";

  if (document.getElementById("remember-me").checked) {
    localStorage.setItem("sia_remember_email", email);
  } else {
    localStorage.removeItem("sia_remember_email");
  }

  try {
    var loginBody = {};
    if (isEmailId) { loginBody.email = email; } else { loginBody.email_or_id = email; }
    loginBody.password = password;
    var res = await fetch(API_BASE + "/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(loginBody),
      signal: fetchTimeout(45000),
    });
    var data = await res.json();
    if (!res.ok) {
      // Unverified email: backend auto-sends an OTP and asks us to verify.
      if (res.status === 403 && data.detail && data.detail.code === "EMAIL_NOT_VERIFIED") {
        pendingSignupEmail = (data.detail.email || (isEmailId ? email : "")).toLowerCase();
        showSignupOtpStep(pendingSignupEmail);
        document.getElementById("signup-otp-error").textContent =
          data.detail.message || "We sent a code to your email. Verify it to continue.";
        try { document.getElementById("signup-otp").focus(); } catch (e1) {}
        return; // finally re-enables the login button
      }
      err.textContent = typeof data.detail === "string" ? data.detail : "Login failed.";
      return;
    }
    if (selectedAccountRole !== "exam" && data.role !== cfg.expectedRole) {
      err.textContent = roleMismatchMessage(selectedAccountRole, data.role);
      return;
    }
    var label = (data.user && data.user.email) || email;
    await routeAfterAuth(data.access_token, data.role, label, data.user && data.user.full_name);
  } catch (ex) {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      err.textContent = "There is no internet on your data.";
    } else if (ex.name === "TimeoutError" || ex.name === "AbortError" || /failed to fetch/i.test(ex.message || "")) {
      err.textContent = "There is no internet on your data.";
    } else {
      err.textContent = "Network error. Check your connection.";
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "LOG IN";
  }
}

var pendingSignupEmail = "";

function showSignupOtpStep(email) {
  pendingSignupEmail = email;
  document.getElementById("signup-step-details").classList.add("hidden");
  document.getElementById("signup-step-otp").classList.remove("hidden");
  document.getElementById("signup-otp-email-label").textContent = email;
  document.getElementById("signup-otp").value = "";
  document.getElementById("signup-otp-error").textContent = "";
}

function backToSignupDetails() {
  document.getElementById("signup-step-otp").classList.add("hidden");
  document.getElementById("signup-step-details").classList.remove("hidden");
  pendingSignupEmail = "";
}

async function signup(e) {
  e.preventDefault();
  e.stopPropagation();
  var cfg = ROLE_CONFIG[selectedAccountRole] || ROLE_CONFIG.student;
  if (!cfg.allowSignup) {
    document.getElementById("signup-error").textContent = "Signup is not available for this account type.";
    return;
  }

  var name = document.getElementById("signup-name").value.trim();
  var email = document.getElementById("signup-email").value.trim();
  var password = document.getElementById("signup-password").value;
  var err = document.getElementById("signup-error");
  var btn = document.getElementById("btn-signup");
  err.textContent = "";

  if (!name || !email || !password) {
    err.textContent = "Please fill in name, email and password.";
    return;
  }
  if (password.length < 8) {
    err.textContent = "Password must be at least 8 characters.";
    return;
  }

  btn.disabled = true;
  btn.textContent = "SENDING EMAIL...";

  try {
    var body = {
      email: email,
      password: password,
      full_name: name,
      role: selectedAccountRole === "kind" ? "kind" : "student",
    };
    if (selectedAccountRole === "kind") {
      body.age_group = document.getElementById("signup-age-group").value;
    }

    var res = await fetch(API_BASE + "/api/v1/auth/signup/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: fetchTimeout(90000),
    });
    var data = {};
    try {
      data = await res.json();
    } catch (parseErr) {
      data = {};
    }
    if (!res.ok) {
      var detail = data.detail;
      err.textContent =
        typeof detail === "string"
          ? detail
          : Array.isArray(detail)
            ? detail.map(function (d) { return d.msg || d; }).join("; ")
            : "Could not send OTP. Try again.";
      return;
    }
    showSignupOtpStep(data.email || email);
    if (data.debug_otp) {
      document.getElementById("signup-otp").value = data.debug_otp;
      document.getElementById("signup-otp-error").textContent =
        "Email delayed by Gmail — use this code: " + data.debug_otp;
    } else {
      document.getElementById("signup-otp-error").textContent =
        "Check your inbox (and spam) for the code.";
    }
  } catch (ex) {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      err.textContent = "There is no internet on your data.";
    } else if (ex.name === "TimeoutError" || ex.name === "AbortError") {
      err.textContent = "Request timed out. The server may be waking up — try again.";
    } else if (/failed to fetch/i.test(ex.message || "")) {
      err.textContent = "There is no internet on your data.";
    } else {
      err.textContent = "Network error. Check your connection and try again.";
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "SEND EMAIL CODE";
  }
}

async function verifySignupOtp() {
  var otp = document.getElementById("signup-otp").value.trim();
  var err = document.getElementById("signup-otp-error");
  var btn = document.getElementById("btn-verify-otp");
  var cfg = ROLE_CONFIG[selectedAccountRole] || ROLE_CONFIG.student;
  err.textContent = "";
  if (!otp || !pendingSignupEmail) {
    err.textContent = "Enter the code we emailed you.";
    return;
  }
  btn.disabled = true;
  btn.textContent = "VERIFYING...";
  try {
    var res = await fetch(API_BASE + "/api/v1/auth/signup/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: pendingSignupEmail, otp: otp }),
      signal: fetchTimeout(45000),
    });
    var data = await res.json();
    if (!res.ok) {
      err.textContent = typeof data.detail === "string" ? data.detail : "Invalid OTP.";
      return;
    }
    var label = (data.user && data.user.email) || pendingSignupEmail;
    await routeAfterAuth(data.access_token, data.role || cfg.expectedRole, label, data.user && data.user.full_name);
  } catch (ex) {
    err.textContent = "Network error. Check your connection.";
  } finally {
    btn.disabled = false;
    btn.textContent = "VERIFY & CREATE ACCOUNT";
  }
}

async function resendSignupOtp() {
  var err = document.getElementById("signup-otp-error");
  err.textContent = "";
  if (!pendingSignupEmail) return;
  try {
    var res = await fetch(API_BASE + "/api/v1/auth/otp/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: pendingSignupEmail, purpose: "signup" }),
      signal: fetchTimeout(45000),
    });
    var data = await res.json();
    if (!res.ok) {
      err.textContent = typeof data.detail === "string" ? data.detail : "Could not resend.";
      return;
    }
    err.textContent = "New code sent.";
  } catch (ex) {
    err.textContent = "Network error.";
  }
}

if (typeof window !== "undefined") {
  window.verifySignupOtp = verifySignupOtp;
  window.resendSignupOtp = resendSignupOtp;
  window.backToSignupDetails = backToSignupDetails;
}
