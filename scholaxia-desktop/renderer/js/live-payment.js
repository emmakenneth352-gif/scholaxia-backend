/**
 * Flutterwave checkout for Scholaxia One-on-One Live Class monthly plans.
 */
var _livePayBusy = false;

function loadFlutterwaveScript() {
  return new Promise(function (resolve, reject) {
    if (window.FlutterwaveCheckout) {
      resolve();
      return;
    }
    var s = document.createElement("script");
    s.src = "https://checkout.flutterwave.com/v3.js";
    s.onload = function () { resolve(); };
    s.onerror = function () { reject(new Error("Could not load Flutterwave checkout")); };
    document.head.appendChild(s);
  });
}

function formatNaira(amount) {
  return "₦" + Number(amount).toLocaleString("en-NG");
}

function paymentReturnUrl(ctx) {
  var base = window.location.origin + "/payment-return.html";
  if (ctx.type === "material" && ctx.material_id) {
    return base + "?ctx=material&material_id=" + encodeURIComponent(ctx.material_id);
  }
  if (ctx.type === "book" && ctx.book_id) {
    return base + "?ctx=book&book_id=" + encodeURIComponent(ctx.book_id);
  }
  if (ctx.type === "skill" && ctx.skill_id) {
    return base + "?ctx=skill&skill_id=" + encodeURIComponent(ctx.skill_id);
  }
  var q = "?ctx=live&plan_id=" + encodeURIComponent(ctx.plan_id || "");
  if (ctx.class_id) q += "&class_id=" + encodeURIComponent(ctx.class_id);
  return base + q;
}

function savePaymentReturnContext(ctx) {
  var raw = JSON.stringify(ctx);
  sessionStorage.setItem("sia_pay_return", raw);
  localStorage.setItem("sia_pay_return", raw);
  if (ctx.tx_ref) {
    localStorage.setItem("sia_plan_pending_verify", JSON.stringify({
      tx_ref: ctx.tx_ref,
      plan_id: ctx.plan_id || "",
      class_id: ctx.class_id || "",
    }));
  }
}

function clearPlanPaymentPending() {
  localStorage.removeItem("sia_plan_pending_verify");
  try { sessionStorage.removeItem("sia_live_plans_cache"); } catch (e) { /* ignore */ }
  if (typeof window._livePlansCache !== "undefined") window._livePlansCache = null;
}

async function reconcilePendingPlanPayment() {
  var raw = localStorage.getItem("sia_plan_pending_verify");
  var txRef = null;
  if (raw) {
    try { txRef = JSON.parse(raw).tx_ref || null; } catch (e) { /* ignore */ }
  }
  try {
    var result = await api("/api/v1/payments/flutterwave/reconcile-plan", {
      method: "POST",
      body: JSON.stringify({ tx_ref: txRef }),
    });
    if (result && (result.paid || result.reconciled)) {
      clearPlanPaymentPending();
      return true;
    }
  } catch (e) { /* ignore */ }
  return false;
}

function startFlutterwaveRedirect(init, ctx) {
  savePaymentReturnContext(ctx);
  var user = typeof getUser === "function" ? getUser() : { name: "Student", email: "" };
  var customer = init.customer || {};
  var email = customer.email || localStorage.getItem("sia_email") || "student@scholaxia.local";
  var name = customer.name || user.name || "Student";

  window.FlutterwaveCheckout({
    public_key: init.public_key,
    tx_ref: init.tx_ref,
    amount: init.amount,
    currency: init.currency || "NGN",
    payment_options: "card, banktransfer, ussd",
    customer: { email: email, name: name },
    customizations: {
      title: ctx.custom_title || "Scholaxia Live Class",
      description: ctx.custom_description || "Monthly live class plan",
      logo: window.location.origin + "/assets/logo.png",
    },
    meta: ctx.meta || {},
    redirect_url: paymentReturnUrl(ctx),
  });
  return { redirecting: true };
}

function setJoinButtonBusy(btn, busy, label) {
  if (!btn) return;
  btn.disabled = !!busy;
  if (busy) {
    if (!btn.dataset.prevLabel) btn.dataset.prevLabel = btn.textContent;
    btn.textContent = label || "Please wait…";
  } else if (btn.dataset.prevLabel) {
    btn.textContent = btn.dataset.prevLabel;
  }
}

async function refreshLivePlanAccessAfterPayment() {
  if (typeof clearPlansCache === "function") clearPlansCache();
  else {
    try { sessionStorage.removeItem("sia_live_plans_cache"); } catch (e) { /* ignore */ }
    window._livePlansCache = null;
  }
  try {
    sessionStorage.setItem("sia_live_plan_just_paid", String(Date.now()));
  } catch (e) { /* ignore */ }
  if (typeof loadLivePlans === "function") {
    try {
      await loadLivePlans(null, false);
    } catch (e) { /* ignore */ }
  }
}

async function payForLivePlan(planId, classId, btn) {
  if (_livePayBusy) return;
  if (!planId) {
    alert("Plan not found. Refresh the page and try again.");
    return;
  }
  _livePayBusy = true;
  setJoinButtonBusy(btn, true, "Opening payment…");
  try {
    // Prefer Paystack (same as student website).
    if (typeof paystackPurchase !== "function") {
      throw new Error("Paystack payment module not loaded. Restart the app and try again.");
    }
    var paid = await paystackPurchase({
      productType: "class_package",
      productId: String(planId),
    });
    if (!paid) throw new Error("Payment was not completed.");
    await refreshLivePlanAccessAfterPayment();
    if (classId) await completeJoinClass(classId, null);
    else {
      alert("Payment successful. Your live class subscription is active — you can join classes now.");
    }
    return { paid: true };
  } catch (e) {
    alert(e.message || "Payment could not start.");
    throw e;
  } finally {
    _livePayBusy = false;
    setJoinButtonBusy(btn, false);
  }
}

async function completeJoinClass(classId, card) {
  if (!classId) throw new Error("Class not found.");
  var data = await api("/api/v1/live-classes/" + classId + "/join", { method: "POST" });
  if (!data) throw new Error("Could not join class.");
  // plugNmeet room ready → same behaviour as the website: enter its own client.
  if (data.pnm_join_url) {
    try { localStorage.setItem("sia_stop_live_ring", String(Date.now())); } catch (e) { /* ignore */ }
    if (typeof launchPnmRoom === "function" && launchPnmRoom(data.pnm_join_url)) {
      return;
    }
    window.location.href = data.pnm_join_url;
    return;
  }
  var endTime = data.end_time || (card && card.dataset && card.dataset.end) || null;
  if (typeof normalizeLiveEndTime === "function") {
    endTime = normalizeLiveEndTime(endTime, data.is_live !== false);
  }
  var sess = {
    class_id: classId,
    classId: classId,
    room_id: data.room_id,
    channel_id: data.channel_id,
    livekit_token: data.livekit_token,
    livekit_url: data.livekit_url,
    identity: data.identity,
    teacher_id: data.teacher_id || "",
    title: data.title || (card && card.dataset && card.dataset.title) || "Live Class",
    subject: data.subject || (card && card.dataset && card.dataset.subject) || "",
    teacher_name: data.teacher_name || (card && card.dataset && card.dataset.teacher) || "",
    mic_allowed: !!data.mic_allowed,
    camera_allowed: !!data.camera_allowed,
    role: String(localStorage.getItem("sia_role") || "").toLowerCase() === "kind" ? "kind" : "student",
    end_time: endTime,
  };
  if (!sess.room_id) throw new Error("Could not join — missing class room. Refresh and try again.");
  if (typeof persistLiveSession === "function") persistLiveSession(sess);
  else localStorage.setItem("live_session", JSON.stringify(sess));
  window.location.href = "classroom.html";
}

async function joinClassWithAccessCode(code) {
  if (_livePayBusy) return;
  var normalized = String(code || "").trim().toUpperCase();
  if (!normalized) throw new Error("Enter an access code.");
  _livePayBusy = true;
  try {
    var preview = null;
    if (typeof fetchJoinPreview === "function") {
      preview = await fetchJoinPreview({ code: normalized });
    } else {
      preview = await api("/api/v1/live-classes/join-preview?code=" + encodeURIComponent(normalized));
    }
    if (!preview || !preview.id) throw new Error("Invalid code. Check Access Code tab.");
    var classId = preview.id;
    var access = await api("/api/v1/payments/live-class/" + encodeURIComponent(classId) + "/access");
    var vis = ((access && access.visibility) || (preview && preview.visibility) || "").toLowerCase();
    var isFree = !!(access && (access.is_free || access.requires_payment === false)) ||
      vis === "private" || vis === "public" || vis === "school_group" ||
      !!(preview && (preview.is_free || preview.requires_payment === false));
    var needsPlan = !isFree && !!(access && (access.need_plan || access.requires_payment));
    var canJoin = isFree || !!(access && (access.paid || access.can_join));
    if (access && needsPlan && !canJoin) {
      alert("You need an active subscription for this class. Open Subscription in the menu to pay, then join again.");
      if (typeof showPage === "function") showPage("subscription");
      else if (typeof loadLivePlans === "function") loadLivePlans(classId, false);
      return;
    }
    var data = await api("/api/v1/live-classes/join-by-code", {
      method: "POST",
      body: JSON.stringify({ code: normalized }),
    });
    if (!data) throw new Error("Could not join class.");
    // plugNmeet room ready → open the room (same as the website).
    if (data.pnm_join_url) {
      try { localStorage.setItem("sia_stop_live_ring", String(Date.now())); } catch (e) { /* ignore */ }
      if (typeof launchPnmRoom === "function" && launchPnmRoom(data.pnm_join_url)) return;
      window.location.href = data.pnm_join_url;
      return;
    }
    var endTime = data.end_time || null;
    if (typeof normalizeLiveEndTime === "function") {
      endTime = normalizeLiveEndTime(endTime, data.is_live !== false);
    }
    var sess = {
      class_id: classId,
      classId: classId,
      room_id: data.room_id,
      channel_id: data.channel_id,
      livekit_token: data.livekit_token,
      livekit_url: data.livekit_url,
      identity: data.identity,
      teacher_id: data.teacher_id || "",
      title: data.title || preview.title || "Live Class",
      subject: data.subject || preview.subject || "",
      teacher_name: data.teacher_name || preview.teacher_name || "",    mic_allowed: !!data.mic_allowed,
    camera_allowed: !!data.camera_allowed,
    role: String(localStorage.getItem("sia_role") || "").toLowerCase() === "kind" ? "kind" : "student",
    end_time: endTime,
  };
  if (typeof persistLiveSession === "function") persistLiveSession(sess);
    else localStorage.setItem("live_session", JSON.stringify(sess));
    window.location.href = "classroom.html";
  } finally {
    _livePayBusy = false;
  }
}

window.joinClassWithAccessCode = joinClassWithAccessCode;

async function joinClassWithPayment(btn) {
  if (_livePayBusy) return;
  var classId = typeof btn === "string" ? btn : (btn && (btn.getAttribute("data-id") || btn.dataset.id));
  var card = typeof btn === "string" ? null : btn;
  if (!classId) {
    alert("Class not found. Refresh and try again.");
    return;
  }

  _livePayBusy = true;
  setJoinButtonBusy(card, true, "Joining…");
  try {
    var reconciled = await reconcilePendingPlanPayment();
    if (reconciled) {
      if (typeof clearPlansCache === "function") clearPlansCache();
      else {
        try { sessionStorage.removeItem("sia_live_plans_cache"); } catch (e) { /* ignore */ }
      }
    }
    var access = await api("/api/v1/payments/live-class/" + encodeURIComponent(classId) + "/access");
    var vis = ((access && access.visibility) || "").toLowerCase();
    var isFree = !!(access && access.is_free) ||
      vis === "private" || vis === "public" || vis === "school_group" ||
      (access && access.requires_payment === false && access.need_plan === false);
    var canJoin = isFree || !!(access && (access.paid || access.can_join));
    if (!access || !canJoin) {
      if (isFree || (access && access.visibility && access.visibility !== "subject")) {
        await completeJoinClass(classId, card);
        return;
      }
      var plansData = typeof fetchLivePlansFromApi === "function"
        ? await fetchLivePlansFromApi()
        : await api("/api/v1/payments/live-class/plans");
      var planId = (plansData && plansData.suggested_plan_ids && plansData.suggested_plan_ids[0])
        || (plansData && plansData.plans && plansData.plans[0] && plansData.plans[0].id);
      if (!planId) {
        alert("No subscription plan is available right now. Open Subscription in the menu or contact support.");
        return;
      }
      var payResult = await payForLivePlan(planId, classId, card);
      if (payResult && payResult.redirecting) return;
      if (!(payResult && payResult.paid)) return;
    }
    await completeJoinClass(classId, card);
  } catch (e) {
    var msg = e.message || "Could not join class.";
    if (msg.toLowerCase().indexOf("plan") >= 0 || msg.indexOf("402") >= 0) {
      alert("You need an active subscription to join. Open Subscription in the menu to choose a plan.");
    } else {
      alert(msg);
    }
  } finally {
    _livePayBusy = false;
    setJoinButtonBusy(card, false);
  }
}

function bindLivePageClickHandlers() {
  if (window._livePageClicksBound) return;
  window._livePageClicksBound = true;

  document.addEventListener("click", function (e) {
    var planBtn = e.target.closest(".live-plan-pay");
    if (planBtn && planBtn.closest("#page-live, #page-subscription, #live-plans-grid, #live-plans-section")) {
      e.preventDefault();
      e.stopPropagation();
      var planId = planBtn.getAttribute("data-plan-id");
      var classId = planBtn.getAttribute("data-class-id") ||
        (typeof getPendingJoinClassId === "function" ? getPendingJoinClassId() : "") || "";
      payForLivePlan(planId, classId || null, planBtn);
      return;
    }

    var joinBtn = e.target.closest(".btn-join[data-id]");
    if (joinBtn && joinBtn.closest(
      "#page-live, #page-subscription, #page-skills, #page-dashboard, #dash-platform-live, #notifications-list"
    )) {
      e.preventDefault();
      e.stopPropagation();
      joinClassWithPayment(joinBtn);
    }
  }, true);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bindLivePageClickHandlers);
} else {
  bindLivePageClickHandlers();
}

window.joinClassWithPayment = joinClassWithPayment;
window.completeJoinClass = completeJoinClass;
window.payForLivePlan = payForLivePlan;
window.refreshLivePlanAccessAfterPayment = refreshLivePlanAccessAfterPayment;
window.reconcilePendingPlanPayment = reconcilePendingPlanPayment;
window.clearPlanPaymentPending = clearPlanPaymentPending;

async function payForMaterial(materialId) {
  if (typeof paystackPurchase !== "function") {
    throw new Error("Paystack payment module not loaded. Restart the app and try again.");
  }
  var paid = await paystackPurchase({
    productType: "library_book",
    productId: String(materialId),
  });
  if (!paid) throw new Error("Payment was not completed.");
  return { paid: true, has_access: true };
}

window.payForMaterial = payForMaterial;

async function payForBook(bookId) {
  if (typeof paystackPurchase !== "function") {
    throw new Error("Paystack payment module not loaded. Restart the app and try again.");
  }
  var paid = await paystackPurchase({
    productType: "library_book",
    productId: String(bookId),
  });
  if (!paid) throw new Error("Payment was not completed.");
  return { paid: true, has_access: true };
}

window.payForBook = payForBook;

async function payForSkillEnrollment(skillId, form, btn) {
  if (!skillId) throw new Error("Program not found.");
  if (typeof paystackPurchase !== "function") {
    throw new Error("Paystack is not available. Refresh and try again.");
  }

  var paid = await paystackPurchase({
    productType: "skill_enrollment",
    productId: skillId,
    payment_mode: (form && form.payment_mode) || "half",
    installment: (form && form.installment) || 1,
    full_name: (form && form.full_name) || "",
    phone: (form && form.phone) || "",
    email: (form && form.email) || "",
    preferred_start: (form && form.preferred_start) || "",
    notes: (form && form.notes) || "",
    location: (form && form.location) || "",
  });
  if (paid) {
    alert("Payment successful! Your skills enrollment is active.");
    if (typeof loadSkills === "function") loadSkills();
  }
  return !!paid;
}

window.payForSkillEnrollment = payForSkillEnrollment;
