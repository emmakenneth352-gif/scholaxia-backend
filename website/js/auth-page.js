(function () {
  var api = window.ScholaxiaAPI;
  var role = "student";
  var mode = "login";
  var pendingEmail = "";
  var nextUrl = "";
  var marketMode = false;

  var ROLE_META = {
    student: {
      subLogin: "Student portal — log in with your email or school Student ID",
      subSignup: "Create a free student account",
      allowSignup: true,
    },
    teacher: {
      subLogin: "Teacher portal — host classes & manage students",
      subSignup: "Create teacher account (admin approval required)",
      allowSignup: true,
    },
    kind: {
      subLogin: "Kids portal — safe learning for ages 3–12",
      subSignup: "Create a Scholaxia Kids account",
      allowSignup: true,
    },
    vendor: {
      subLogin: "Vendor portal — sell on Scholaxia Market",
      subSignup: "Register your store (admin approval required)",
      allowSignup: true,
    },
  };

  var MARKET_ROLE_META = {
    student: {
      subLogin: "Buyer login — checkout your Scholaxia Market cart",
      subSignup: "Create a free buyer account to checkout & track orders",
      allowSignup: true,
    },
    vendor: {
      subLogin: "Vendor login — manage your Scholaxia Market store",
      subSignup: "Register as a vendor (admin approval required)",
      allowSignup: true,
    },
  };

  function $(id) {
    return document.getElementById(id);
  }

  function showErr(el, msg) {
    if (!el) return;
    if (!msg) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent = msg;
  }

  function setVisible(el, on) {
    if (!el) return;
    el.hidden = !on;
    el.classList.toggle("is-off", !on);
  }

  function safeNext(url) {
    if (!url) return "";
    try {
      var u = String(url);
      if (u.indexOf("://") >= 0 || u.indexOf("//") === 0) return "";
      if (u.charAt(0) === "/" || u.indexOf("..") >= 0) return "";
      if (
        !/\.html(\?|#|$)/.test(u) &&
        u.indexOf("marketplace") < 0 &&
        u.indexOf("vendor") < 0
      ) {
        return "";
      }
      return u;
    } catch (e) {
      return "";
    }
  }

  function redirectAfterAuth(actual) {
    if (nextUrl) {
      window.location.href = nextUrl;
      return;
    }
    window.location.href = api.dashboardForRole(actual);
  }

  function updateCopy() {
    var metaMap = marketMode ? MARKET_ROLE_META : ROLE_META;
    var meta = metaMap[role] || metaMap.student || ROLE_META.student;
    if (mode === "reset") {
      $("portalSub").textContent = "We will email an OTP so you can set a new password";
    } else {
      $("portalSub").textContent = mode === "login" ? meta.subLogin : meta.subSignup;
    }
    setVisible($("kindFields"), role === "kind" && mode === "signup");
    setVisible($("teacherFields"), role === "teacher" && mode === "signup");
    setVisible($("vendorFields"), role === "vendor" && mode === "signup");
    setVisible($("teacherHint"), role === "teacher");
    setVisible($("vendorHint"), role === "vendor");
    $("btnSignup").disabled = false;
    $("tabSignup").disabled = false;
    $("gotoSignup").disabled = false;
  }

  var COUNTRIES = [
    "Nigeria", "Ghana", "Kenya", "South Africa", "Egypt", "Morocco",
    "United States", "United Kingdom", "Canada", "Ireland", "France",
    "Germany", "Spain", "Portugal", "Italy", "Netherlands", "Belgium",
    "Brazil", "Cameroon", "Côte d'Ivoire",
    "Senegal", "Mali", "Burkina Faso", "Benin", "Togo", "Niger",
    "Chad", "Sudan", "Ethiopia", "Tanzania", "Uganda", "Rwanda",
    "Zambia", "Zimbabwe", "Botswana", "Namibia", "Mozambique", "Angola",
    "Liberia", "Sierra Leone", "Gambia", "Guinea", "Other"
  ];

  var COUNTRY_LANG = {
    Nigeria: "en", Ghana: "en", Kenya: "en", "South Africa": "en",
    Cameroon: "en", Liberia: "en", "Sierra Leone": "en", Gambia: "en",
    Egypt: "ar", Sudan: "ar", Morocco: "ar",
    France: "fr", Senegal: "fr", Mali: "fr", "Burkina Faso": "fr",
    Benin: "fr", Togo: "fr", Niger: "fr", Chad: "fr",
    "Côte d'Ivoire": "fr", Belgium: "fr",
    Brazil: "pt", Portugal: "pt", Angola: "pt", Mozambique: "pt"
  };

  function populateCountries() {
    var sel = $("signupCountry");
    if (!sel || sel.options.length > 1) return;
    COUNTRIES.forEach(function (c) {
      var o = document.createElement("option");
      o.value = c;
      o.textContent = c;
      sel.appendChild(o);
    });
    sel.addEventListener("change", function () {
      var langSel = $("signupLanguage");
      if (langSel && COUNTRY_LANG[sel.value]) langSel.value = COUNTRY_LANG[sel.value];
      var hint = $("langHint");
      if (hint) hint.hidden = !sel.value;
    });
  }

  function applyMarketMode() {
    if (!marketMode) return;
    document.body.classList.add("auth-market");
    var back = $("authBack");
    if (back) {
      back.href = "marketplace.html";
      back.textContent = "← Back to Market";
    }
    var studentBtn = $("roleStudentBtn");
    if (studentBtn) studentBtn.textContent = "Buyer";
    document.querySelectorAll("[data-hide-market]").forEach(function (btn) {
      btn.hidden = true;
      btn.style.display = "none";
    });
    document.querySelectorAll("[data-show-market]").forEach(function (btn) {
      btn.hidden = false;
      btn.style.display = "";
    });
    var row = $("roleRow");
    if (row) {
      row.classList.add("role-row-market");
      row.style.gridTemplateColumns = "1fr 1fr";
    }
    var kicker = $("authVisualKicker");
    var title = $("authVisualTitle");
    var lead = $("authVisualLead");
    var points = $("authVisualPoints");
    if (kicker) kicker.textContent = "Scholaxia Market";
    if (title) title.innerHTML = "Buy or sell.<br /><span>Campus ready.</span>";
    if (lead) lead.textContent = "Join as a buyer to checkout, or as a vendor to list products after approval.";
    if (points) {
      points.innerHTML =
        "<li>Browse free</li><li>Buyer checkout</li><li>Vendor approval</li>";
    }
    var img = $("authVisualImg");
    if (img) img.src = "media/feature-market.png";
  }

  function setRole(next) {
    role = next;
    document.querySelectorAll(".role-btn").forEach(function (btn) {
      var on = btn.dataset.role === role;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    updateCopy();
  }

  function switchMode(next) {
    mode = next;
    var login = mode === "login";
    var reset = mode === "reset";

    $("tabLogin").classList.toggle("is-active", login);
    $("tabSignup").classList.toggle("is-active", !login && !reset);
    $("tabLogin").setAttribute("aria-selected", login ? "true" : "false");
    $("tabSignup").setAttribute("aria-selected", login ? "false" : "true");
    var tabs = document.querySelector(".mode-tabs");
    if (tabs) tabs.classList.toggle("is-signup", !login && !reset);
    var title = $("authTitle");
    if (title) title.textContent = reset ? "Reset password" : login ? "Welcome back" : "Create account";

    setVisible($("formLogin"), login);
    setVisible($("formSignup"), !login && !reset);
    setVisible($("formReset"), reset);

    showErr($("loginError"));
    showErr($("signupError"));
    showErr($("otpError"));
    showErr($("resetError"));

    setVisible($("signupStepDetails"), true);
    setVisible($("signupStepOtp"), false);
    updateCopy();
  }

  function roleMismatch(selected, actual) {
    if (selected === "teacher") return "This account is not a teacher. Pick the correct role.";
    if (selected === "kind") return "This is not a Kid account. Choose Student or create a Kid account.";
    if (selected === "vendor") return "This is not a vendor account. Choose Vendor to sell on Market.";
    if (actual === "teacher") return "This is a teacher account. Select Teacher above.";
    if (actual === "kind") return "This is a Kid account. Select Kid above.";
    if (actual === "vendor") return "This is a vendor account. Select Vendor above.";
    return "Account type does not match the role you selected.";
  }

  async function afterAuth(data, email, name) {
    var actual = String((data && data.role) || "student")
      .replace(/^UserRole\./i, "")
      .toLowerCase();
    if (role === "teacher" && actual !== "teacher" && actual !== "admin") {
      throw new Error(roleMismatch(role, actual));
    }
    if (role === "kind" && actual !== "kind") {
      throw new Error(roleMismatch(role, actual));
    }
    if (role === "vendor" && actual !== "vendor") {
      throw new Error(roleMismatch(role, actual));
    }
    if (
      role === "student" &&
      actual &&
      actual !== "student" &&
      (actual === "teacher" || actual === "kind" || actual === "admin" || actual === "vendor")
    ) {
      throw new Error(roleMismatch(role, actual));
    }

    if (actual === "teacher" && data && data.user && data.user.is_approved === false) {
      showErr(
        $("otpError"),
        "Account created. Your teacher account is awaiting admin approval. You can log in after it is approved."
      );
      if ($("otpError")) $("otpError").style.color = "#166534";
      if ($("btnVerify")) {
        $("btnVerify").disabled = true;
        $("btnVerify").textContent = "Awaiting approval";
      }
      if ($("signupOtp")) $("signupOtp").disabled = true;
      return;
    }

    if (data) data.role = actual;

    api.saveSession(data, email, name);

    if (actual === "vendor") {
      if (!nextUrl || nextUrl.indexOf("marketplace") >= 0) {
        nextUrl = "vendor.html";
      }
      redirectAfterAuth(actual);
      return;
    }

    redirectAfterAuth(actual);
  }

  function esc(s) {
    return String(s || "").replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ── School private-link branding (divine-light.scholaxia.com or /school/<slug>/ or ?school=<slug>) ── */
  var schoolInfo = null;

  function currentSchoolSlug() {
    try {
      var qs = new URLSearchParams(window.location.search);
      var fromQuery = (qs.get("school") || qs.get("school_slug") || "").toLowerCase().replace(/[^a-z0-9-]/g, "");
      if (fromQuery) return fromQuery;
      if (window.SCHOLAXIA_SCHOOL_HOST) return window.SCHOLAXIA_SCHOOL_HOST;
      var m = String(window.location.pathname || "").match(/^\/school\/([a-z0-9-]+)/i);
      if (m) return m[1].toLowerCase();
    } catch (e) {}
    return null;
  }

  function applySchoolBranding() {
    var slug = currentSchoolSlug();
    if (!slug || !api || typeof api.api !== "function") return;
    var kicker = $("authVisualKicker");
    var title = $("authVisualTitle");
    var lead = $("authVisualLead");
    var sub = $("portalSub");
    var back = $("authBack");
    if (back) back.hidden = true; // no "main site" escape hatch inside a school portal
    if (sub) sub.textContent = "Loading your school…";
    api
      .api("/public/schools/by-slug/" + encodeURIComponent(slug), { method: "GET" })
      .then(function (data) {
        schoolInfo = data || null;
        var name = (data && (data.name || data.slug)) || "your school";
        var pretty = String(name).replace(/\b\w/g, function (c) { return c.toUpperCase(); });
        try { localStorage.setItem("sia_school_slug", slug); } catch (e) {}
        try { localStorage.setItem("sia_school_name", pretty); } catch (e2) {}
        if (kicker) kicker.textContent = pretty;
        if (title) title.innerHTML = "Welcome to<br /><span>" + esc(pretty) + "</span>";
        if (lead) lead.textContent = "Sign in with the Student ID and password from your school office.";
        if (sub) sub.textContent = ""; // updateCopy() fills the role-specific line
        if (data && data.logo_url) {
          var img = $("authVisualImg");
          var brand = document.querySelector(".auth-brand img");
          if (brand) brand.src = data.logo_url;
          if (img) img.src = data.logo_url;
          var fav = document.querySelector("link[rel='icon']");
          if (fav) fav.href = data.logo_url;
        }
        document.title = pretty + " — Sign in";
      })
      .catch(function () {
        if (sub) sub.textContent = "";
      });
  }

  async function onLogin(e) {
    e.preventDefault();
    var email = $("loginEmail").value.trim();
    var password = $("loginPassword").value;
    var btn = $("btnLogin");
    var errEl = $("loginError");
    showErr(errEl);
    if (!email || !password) {
      showErr(errEl, "Enter your email or Student ID, and your password.");
      return;
    }
    btn.disabled = true;
    btn.textContent = "Logging in…";
    showErr(errEl, "Connecting to server…");
    if (errEl) {
      errEl.hidden = false;
      errEl.style.color = "#334155";
    }

    var finished = false;
    var watchdog = setTimeout(function () {
      if (finished) return;
      finished = true;
      btn.disabled = false;
      btn.textContent = "Log in";
      showErr(errEl, "Login is taking too long. Check your internet, wait 20 seconds, then try again.");
      if (errEl) errEl.style.color = "";
    }, 30000);

    // Wake API in background (do not block login)
    if (api.wakeServer) {
      try {
        api.wakeServer(12000);
      } catch (w) {}
    }

    try {
      var data = api.loginApi
        ? await api.loginApi(email, password)
        : await api.api("/api/v1/auth/login", {
            method: "POST",
            noAuth: true,
            body: { email: email, password: password },
            timeout: 25000,
            retries: 0,
            preferXhr: true,
          });
      if (finished) return;
      if (!data || !data.access_token) {
        throw new Error("Login did not return a session. Try again.");
      }
      clearTimeout(watchdog);
      showErr(errEl, "Success — opening your portal…");
      if (errEl) errEl.style.color = "#166534";
      await afterAuth(data, email, data.user && data.user.full_name);
      finished = true;
    } catch (err) {
      if (finished) return;
      finished = true;
      clearTimeout(watchdog);
      var msg = (err && err.message) || "Login failed";
      var notVerified = err && err.data && err.data.detail && err.data.detail.code === "EMAIL_NOT_VERIFIED";
      if (notVerified) {
        pendingEmail = (err.data.detail.email || email).toLowerCase();
        switchMode("signup");
        try { $("signupEmail").value = pendingEmail; } catch (e1) {}
        setVisible($("signupStepDetails"), false);
        setVisible($("signupStepOtp"), true);
        showErr($("otpError"), err.data.detail.message || "We sent a code to your email. Verify it to continue.");
        try { $("signupOtp").focus(); } catch (e2) {}
        return; // keep button state — user is now on the OTP step
      }
      if (err && err.data && err.data.detail) {
        var d = err.data.detail;
        if (typeof d === "string") msg = d;
        else if (d && d.message) msg = d.message;
      }
      showErr(errEl, msg);
      if (errEl) errEl.style.color = "";
      btn.disabled = false;
      btn.textContent = "Log in";
    }
  }

  async function onSignup(e) {
    e.preventDefault();
    e.stopPropagation();
    var email = $("signupEmail").value.trim();
    var password = $("signupPassword").value;
    var fullName = $("signupName").value.trim();
    var btn = $("btnSignup");
    showErr($("signupError"));
    if (!fullName) {
      showErr($("signupError"), "Enter your full name");
      return;
    }
    if (!email) {
      showErr($("signupError"), "Enter your email");
      return;
    }
    if (!password || password.length < 8) {
      showErr($("signupError"), "Password must be at least 8 characters");
      return;
    }
    btn.disabled = true;
    btn.textContent = "Sending OTP…";
    try {
      var body = {
        email: email,
        password: password,
        full_name: fullName,
        role: role,
      };
      var cSel = $("signupCountry");
      var lSel = $("signupLanguage");
      if (cSel && cSel.value) body.country = cSel.value;
      if (lSel && lSel.value) body.language = lSel.value;
      if (role === "kind") {
        body.age_group = $("signupAge").value;
        var parent = $("signupParent").value.trim();
        if (parent) body.parent_email = parent;
      } else if (role === "teacher") {
        body.phone = $("signupPhone").value.trim();
        var subjects = $("signupSubjects").value
          .split(",")
          .map(function (s) { return s.trim(); })
          .filter(Boolean);
        body.subjects = subjects;
        if (!body.phone || body.phone.length < 7) {
          throw new Error("WhatsApp number is required");
        }
        if (!subjects.length) {
          throw new Error("Add at least one subject");
        }
      } else if (role === "vendor") {
        body.business_name = $("signupBusiness").value.trim();
        body.phone = $("signupVendorPhone").value.trim();
        body.location = $("signupVendorLocation").value.trim();
        body.address = $("signupVendorAddress").value.trim();
        if (!body.business_name) throw new Error("Business name is required");
        if (!body.phone || body.phone.length < 7) {
          throw new Error("WhatsApp number is required");
        }
        if (!body.location) throw new Error("Location is required");
        if (!body.address) throw new Error("Business address is required");
      }
      await api.api("/api/v1/auth/signup/start", {
        method: "POST",
        noAuth: true,
        body: body,
      });
      pendingEmail = email;
      setVisible($("signupStepDetails"), false);
      setVisible($("signupStepOtp"), true);
      $("signupOtp").focus();
    } catch (err) {
      showErr($("signupError"), err.message || "Signup failed");
    } finally {
      btn.disabled = false;
      btn.textContent = "Create account";
    }
  }

  async function onVerify() {
    var otp = $("signupOtp").value.trim();
    var btn = $("btnVerify");
    showErr($("otpError"));
    if (!otp) {
      showErr($("otpError"), "Enter the OTP from your email");
      return;
    }
    btn.disabled = true;
    btn.textContent = "Verifying…";
    try {
      var data = await api.api("/api/v1/auth/signup/verify", {
        method: "POST",
        noAuth: true,
        body: { email: pendingEmail || $("signupEmail").value.trim(), otp: otp },
      });
      // Switch the whole site to the language chosen at signup
      var chosenLang = ($("signupLanguage") && $("signupLanguage").value) || "";
      if (chosenLang && window.SxLang) {
        try { window.SxLang.apply(chosenLang); } catch (e) {}
      }
      await afterAuth(
        data,
        pendingEmail || $("signupEmail").value.trim(),
        $("signupName").value.trim()
      );
    } catch (err) {
      showErr($("otpError"), err.message || "Verification failed");
      btn.disabled = false;
      btn.textContent = "Verify & continue";
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    if (!api || typeof api.api !== "function") {
      showErr($("loginError"), "Auth scripts failed to load. Refresh the page.");
      showErr($("signupError"), "Auth scripts failed to load. Refresh the page.");
      return;
    }

    applySchoolBranding();

    applySchoolBranding();

    var params = new URLSearchParams(window.location.search);
    nextUrl = safeNext(params.get("next") || "");
    marketMode =
      params.get("market") === "1" ||
      (nextUrl && nextUrl.indexOf("marketplace") >= 0);

    applyMarketMode();
    populateCountries();

    if (api.getToken() && !params.get("force")) {
      var existingRole = (localStorage.getItem("sia_role") || "student")
        .toLowerCase()
        .replace(/^userrole\./, "");
      try {
        localStorage.setItem("sia_role", existingRole);
      } catch (e) {}
      var wantRole = (params.get("role") || "").toLowerCase();
      var wantFreshAuth =
        params.get("mode") === "login" ||
        params.get("mode") === "signup" ||
        params.get("switch") === "1" ||
        params.get("reason") === "session" ||
        params.get("reason") === "auth" ||
        params.get("reason") === "role" ||
        params.get("reason") === "logout";
      if (params.get("force") === "1" || params.get("reason") === "logout") {
        try {
          api.clearSession();
        } catch (clearErr) {}
      }
      // Allow market signup for a different role (e.g. vendor) by clearing the old session
      if (
        marketMode &&
        params.get("mode") === "signup" &&
        wantRole &&
        wantRole !== existingRole
      ) {
        api.clearSession();
      } else if (wantFreshAuth) {
        // User opened Sign in / Sign up on purpose — stay on the form.
        // Keep token until they successfully log in again (saveSession overwrites).
      } else if (existingRole === "vendor") {
        window.location.replace("vendor.html");
        return;
      } else if (nextUrl) {
        window.location.replace(nextUrl);
        return;
      } else {
        var dest = api.dashboardForRole(existingRole);
        var here = (location.pathname.split("/").pop() || "").toLowerCase();
        if (here !== String(dest || "").toLowerCase()) {
          window.location.replace(dest);
        }
        return;
      }
    }

    document.querySelectorAll(".role-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setRole(btn.dataset.role);
      });
    });

    $("tabLogin").addEventListener("click", function () {
      switchMode("login");
    });
    $("tabSignup").addEventListener("click", function () {
      switchMode("signup");
    });
    $("gotoSignup").addEventListener("click", function () {
      switchMode("signup");
    });
    $("gotoLogin").addEventListener("click", function () {
      switchMode("login");
    });
    if ($("gotoForgot")) {
      $("gotoForgot").addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        switchMode("reset");
        var em = ($("loginEmail") && $("loginEmail").value.trim()) || "";
        if (em && $("resetEmail")) $("resetEmail").value = em;
      });
    }
    if ($("gotoLoginFromReset")) {
      $("gotoLoginFromReset").addEventListener("click", function () {
        switchMode("login");
      });
    }
    if ($("btnResetSend")) {
      $("btnResetSend").addEventListener("click", async function () {
        var email = $("resetEmail").value.trim();
        var hint = $("resetHint");
        showErr($("resetError"));
        if (!email) {
          showErr($("resetError"), "Enter your email");
          return;
        }
        try {
          var data = await api.api("/api/v1/auth/otp/send", {
            method: "POST",
            noAuth: true,
            body: { email: email, purpose: "reset_password" },
          });
          if (hint) {
            hint.hidden = false;
            hint.textContent = (data && data.message) || "OTP sent to your email.";
          }
        } catch (err) {
          showErr($("resetError"), err.message || "Could not send OTP");
        }
      });
    }
    if ($("formReset")) {
      $("formReset").addEventListener("submit", async function (e) {
        e.preventDefault();
        var email = $("resetEmail").value.trim();
        var otp = $("resetOtp").value.trim();
        var password = $("resetPassword").value;
        showErr($("resetError"));
        if (!email || !otp || !password) {
          showErr($("resetError"), "Email, OTP and new password are required");
          return;
        }
        try {
          await api.api("/api/v1/auth/password/reset", {
            method: "POST",
            noAuth: true,
            body: { email: email, otp: otp, new_password: password },
          });
          switchMode("login");
          showErr($("loginError"), "Password updated. Log in with your new password.");
          $("loginError").hidden = false;
        } catch (err) {
          showErr($("resetError"), err.message || "Could not reset password");
        }
      });
    }

    $("formLogin").addEventListener("submit", onLogin);
    $("formSignup").addEventListener("submit", onSignup);
    $("btnVerify").addEventListener("click", onVerify);
    $("btnBackDetails").addEventListener("click", function () {
      setVisible($("signupStepDetails"), true);
      setVisible($("signupStepOtp"), false);
    });

    var roleParam = params.get("role");
    if (roleParam && (ROLE_META[roleParam] || MARKET_ROLE_META[roleParam])) {
      setRole(roleParam);
    } else if (marketMode) {
      setRole("student");
    }
    if (params.get("mode") === "signup" || (marketMode && params.get("mode") !== "login")) {
      switchMode("signup");
    } else {
      switchMode("login");
    }
  });
})();
