/** CBT annual packages — Paystack (aligned with student website). */

async function loadCbtPackagesPage() {
  var el = document.getElementById("cbt-packages-root");
  if (!el) return;
  el.innerHTML = '<div class="loading">Loading CBT packages…</div>';
  try {
    var guest = !isStudentLoggedIn();
    var access = guest ? null : await api("/api/v1/payments/paystack/cbt-access");
    var catalog = await api(
      guest
        ? "/api/v1/cbt/packages"
        : "/api/v1/payments/paystack/cbt-packages"
    );
    var packages = (catalog && catalog.packages) || [];
    var html = "";
    if (access && access.has_access) {
      html +=
        '<div class="info-banner success">You have active CBT access' +
        (access.expires_at ? " until " + escHtml(String(access.expires_at).slice(0, 10)) : "") +
        ".</div>";
    }
    html += '<div class="sx-page-hero"><h2>CBT Packages</h2><p>Annual access — pay with Paystack. Or tap Start exam and redeem a coupon there.</p></div>';
    if (guest) {
      html += '<label class="field"><span class="field-label">Email for Paystack receipt</span><input type="email" id="guest-cbt-package-email" autocomplete="email" placeholder="you@example.com" required /></label>';
    }
    if (!packages.length) {
      html += '<div class="empty-state">No packages available.</div>';
    } else {
      html += '<div class="card-grid">';
      packages.forEach(function (p) {
        var id = p.id || p.package_id || "";
        var name = p.name || p.title || id;
        var price = Number(p.price || p.amount || 0);
        html +=
          '<div class="sx-card cp-card">' +
          "<h3>" + escHtml(name) + "</h3>" +
          '<p class="cp-desc">' + escHtml(p.description || "1 year CBT + Sia support") + "</p>" +
          '<div class="cp-card-foot">' +
          '<strong class="cp-price">₦' + price.toLocaleString("en-NG") + "</strong>" +
          '<button type="button" class="btn-action" onclick="buyCbtPackage(\'' + escHtml(id) + '\')">Pay with Paystack</button>' +
          "</div></div>";
      });
      html += "</div>";
    }
    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '<div class="empty-state">' + escHtml(e.message || "Could not load packages.") + "</div>";
  }
}

async function buyCbtPackage(packageId) {
  if (!packageId) return;
  if (typeof paystackPurchase !== "function") {
    alert("Payment module not loaded.");
    return;
  }
  try {
    var guest = !isStudentLoggedIn();
    var emailInput = document.getElementById("cbt-unlock-pay-email");
    if (!emailInput && guest) emailInput = document.getElementById("guest-cbt-package-email");
    var email = emailInput && emailInput.value ? emailInput.value.trim() : "";
    if (guest && !email) throw new Error("Enter an email address for the Paystack receipt.");
    var ok = await paystackPurchase({
      productType: "cbt_package",
      productId: packageId,
      email: email,
      guestCbt: guest,
    });
    if (ok) {
      if (guest) {
        var guestNext = cbtUnlockAfter;
        closeCbtUnlockModal(true);
        await loadCbtHubPage();
        alert("Payment successful! CBT access is unlocked on this device.");
        if (typeof guestNext === "function") setTimeout(guestNext, 400);
        return;
      }
      try { sessionStorage.setItem("sia_cbt_just_unlocked", String(Date.now())); } catch (s) {}
      var next = cbtUnlockAfter;
      closeCbtUnlockModal(true);
      alert("Payment successful! CBT access unlocked.");
      loadCbtPackagesPage();
      if (typeof loadCbtHubPage === "function") loadCbtHubPage();
      if (typeof next === "function") setTimeout(function () { next(); }, 400);
    } else {
      alert("Payment was not completed.");
    }
  } catch (e) {
    alert(cbtUnlockErrorMessage(e));
  }
}

function escHtml(s) {
  var d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
}

window.loadCbtPackagesPage = loadCbtPackagesPage;
window.buyCbtPackage = buyCbtPackage;

var cbtUnlockAfter = null;
var cbtUnlockOpenedAt = 0;

function closeCbtUnlockModal(force) {
  if (!force && cbtUnlockOpenedAt && Date.now() - cbtUnlockOpenedAt < 700) return;
  cbtUnlockOpenedAt = 0;
  var modal = document.getElementById("cbt-unlock-modal");
  if (modal) modal.classList.add("hidden");
  cbtUnlockAfter = null;
  var choice = document.getElementById("cbt-unlock-choice");
  var coupon = document.getElementById("cbt-unlock-coupon");
  var pay = document.getElementById("cbt-unlock-pay");
  if (choice) choice.classList.remove("hidden");
  if (coupon) coupon.classList.add("hidden");
  if (pay) pay.classList.add("hidden");
  var msg = document.getElementById("cbt-unlock-msg");
  if (msg) msg.textContent = "";
  var input = document.getElementById("cbt-unlock-code");
  if (input) input.value = "";
  var payEmail = document.getElementById("cbt-unlock-pay-email");
  if (payEmail) payEmail.value = "";
}

function openCbtUnlockModal(afterUnlock) {
  cbtUnlockAfter = afterUnlock;
  var modal = document.getElementById("cbt-unlock-modal");
  if (!modal) {
    if (typeof showPage === "function") showPage("cbt-packages");
    return;
  }
  var choice = document.getElementById("cbt-unlock-choice");
  var coupon = document.getElementById("cbt-unlock-coupon");
  var pay = document.getElementById("cbt-unlock-pay");
  var payEmailWrap = document.getElementById("cbt-unlock-pay-email-wrap");
  if (payEmailWrap) {
    if (isStudentLoggedIn()) payEmailWrap.classList.add("hidden");
    else payEmailWrap.classList.remove("hidden");
  }
  if (choice) choice.classList.remove("hidden");
  if (coupon) coupon.classList.add("hidden");
  if (pay) pay.classList.add("hidden");
  var msg = document.getElementById("cbt-unlock-msg");
  if (msg) msg.textContent = "";
  cbtUnlockOpenedAt = Date.now();
  setTimeout(function () {
    cbtUnlockOpenedAt = Date.now();
    modal.classList.remove("hidden");
  }, 60);
}

function cbtUnlockPick(which) {
  var choice = document.getElementById("cbt-unlock-choice");
  var coupon = document.getElementById("cbt-unlock-coupon");
  var pay = document.getElementById("cbt-unlock-pay");
  var msg = document.getElementById("cbt-unlock-msg");
  if (msg) msg.textContent = "";
  if (choice) choice.classList.remove("hidden");
  if (which === "coupon") {
    if (coupon) coupon.classList.remove("hidden");
    if (pay) pay.classList.add("hidden");
  } else {
    if (coupon) coupon.classList.add("hidden");
    if (pay) pay.classList.remove("hidden");
    loadCbtUnlockPackages();
  }
}

function cbtUnlockErrorMessage(error) {
  if (
    error &&
    error.status === 404 &&
    /API route not found/i.test(error.message || "")
  ) {
    return "Guest CBT coupon and payment routes are not available on the connected server yet. The backend update must be deployed.";
  }
  return (error && error.message) || "Could not complete this request.";
}

async function loadCbtUnlockPackages() {
  var list = document.getElementById("cbt-unlock-pay-list");
  if (!list) return;
  list.innerHTML = "Loading…";
  try {
    var catalog = await api(
      isStudentLoggedIn()
        ? "/api/v1/payments/paystack/cbt-packages"
        : "/api/v1/cbt/packages"
    );
    var packages = (catalog && catalog.packages) || [];
    if (!packages.length) {
      list.innerHTML = "No packages listed yet.";
      return;
    }
    list.innerHTML = packages.map(function (p) {
      var id = p.id || p.package_id || "";
      var price = Number(p.price || p.amount || 0);
      return (
        '<div class="cp-card-foot" style="margin:8px 0">' +
        "<strong>" + escHtml(p.name || p.title || id) + " · ₦" + price.toLocaleString("en-NG") + "</strong> " +
        '<button type="button" class="btn-action" onclick="buyCbtPackage(\'' + escHtml(id) + '\')">Pay</button></div>'
      );
    }).join("");
  } catch (e) {
    list.innerHTML = escHtml(cbtUnlockErrorMessage(e));
  }
}

async function cbtUnlockRedeem() {
  var input = document.getElementById("cbt-unlock-code");
  var msg = document.getElementById("cbt-unlock-msg");
  var code = ((input && input.value) || "").trim().replace(/\s+/g, "").toUpperCase();
  if (!code) {
    if (msg) msg.textContent = "Enter your coupon code.";
    return;
  }
  if (msg) msg.textContent = "Checking coupon…";
  try {
    var guest = !isStudentLoggedIn();
    var body = { code: code };
    var res = await api(
      guest ? "/api/v1/cbt/coupons/guest/redeem" : "/api/v1/cbt/coupons/redeem",
      { method: "POST", body: body }
    );
    if (guest && res && res.guest_token) {
      localStorage.setItem("sia_cbt_guest_token", res.guest_token);
    }
    var next = cbtUnlockAfter;
    try {
      sessionStorage.setItem("sia_cbt_just_unlocked", String(Date.now()));
      if (res && res.package_id) sessionStorage.setItem("sia_cbt_package_id", String(res.package_id));
      if (res && res.boards) sessionStorage.setItem("sia_cbt_boards", JSON.stringify(res.boards));
    } catch (s) {}
    closeCbtUnlockModal(true);
    if (typeof loadCbtPackagesPage === "function") loadCbtPackagesPage();
    if (typeof loadCbtHubPage === "function") loadCbtHubPage();
    if (typeof next === "function") setTimeout(function () { next(); }, 400);
  } catch (e) {
    if (msg) msg.textContent = cbtUnlockErrorMessage(e);
  }
}

async function ensureCbtAccessThen(thenFn) {
  var justUnlocked = 0;
  try { justUnlocked = Number(sessionStorage.getItem("sia_cbt_just_unlocked") || 0); } catch (e) {}
  if (justUnlocked && Date.now() - justUnlocked < 120000) {
    thenFn();
    return;
  }
  try {
    var access = await api("/api/v1/payments/paystack/cbt-access");
    if (access && access.has_access) {
      try { sessionStorage.setItem("sia_cbt_just_unlocked", String(Date.now())); } catch (s) {}
      thenFn();
      return;
    }
  } catch (e) { /* show unlock */ }
  openCbtUnlockModal(thenFn);
}

window.closeCbtUnlockModal = closeCbtUnlockModal;
window.openCbtUnlockModal = openCbtUnlockModal;
window.cbtUnlockPick = cbtUnlockPick;
window.cbtUnlockRedeem = cbtUnlockRedeem;
window.ensureCbtAccessThen = ensureCbtAccessThen;
