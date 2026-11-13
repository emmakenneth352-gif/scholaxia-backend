/**
 * Refer & Earn (affiliate) — shared by the student app and the teacher portal.
 *
 * Renders into #affiliate-content so both portals show the same page without
 * duplicating markup. Uses the page's own API helper (api / teacherApi) so the
 * correct bearer token is sent.
 */
(function () {
  function isTeacherPortal() {
    return /teacher\.html$/i.test((window.location && window.location.pathname) || "");
  }

  function affApi(path, options) {
    options = options || {};
    if (isTeacherPortal() && typeof teacherApi === "function") {
      var body = options.body;
      if (body != null && typeof body === "object") body = JSON.stringify(body);
      return teacherApi(path, { method: options.method || "GET", body: body });
    }
    return api(path, options);
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function money(n) {
    return "\u20a6" + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    return isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString();
  }

  function ratesOf(state) {
    var r = state.rates || {};
    return {
      signup: Number(r.signup != null ? r.signup : state.commission_per_referral || 0),
      subscription: Number(r.subscription || 0),
      percent: Number(r.purchase_percent || 0),
      first: Number(r.first_payment_bonus || 0),
    };
  }

  function html(state) {
    var rates = ratesOf(state);
    var refs = state.referrals || [];
    var earnings = state.earnings || [];
    var pays = state.payouts || [];

    var refsRows = refs.length
      ? refs.map(function (r, i) {
          return "<tr><td>" + (i + 1) + "</td><td>" + esc(r.name) + "</td><td>" +
            money(r.commission) + "</td><td>" + fmtDate(r.created_at) + "</td></tr>";
        }).join("")
      : "";

    var earnRows = earnings.length
      ? earnings.map(function (e) {
          var label = e.source === "subscription" ? "Subscription"
            : e.source === "purchase" ? "Purchase"
            : e.source === "first_payment_bonus" ? "First payment bonus"
            : "Signup";
          return "<tr><td>" + esc(label) + "</td><td>" + money(e.amount) + "</td><td>" +
            fmtDate(e.created_at) + "</td></tr>";
        }).join("")
      : "";

    var payRows = pays.length
      ? pays.map(function (p) {
          return "<tr><td>" + money(p.amount) + "</td><td>" + esc(p.bank_name) + " · " +
            esc(p.account_number) + "<br><small>" + esc(p.account_name) + "</small></td>" +
            '<td><span class="aff-status ' + esc(p.status) + '">' + esc(p.status) + "</span></td>" +
            "<td>" + fmtDate(p.requested_at) + "</td><td>" + esc(p.admin_note || "—") + "</td></tr>";
        }).join("")
      : "";

    return (
      '<div class="aff-hero">' +
        "<div>" +
          "<h2>Refer &amp; Earn \uD83D\uDC9C</h2>" +
          "<p>Share your link with classmates, parents or fellow teachers. You earn when they join, " +
            "when they subscribe monthly, and on anything they buy — plus a one-time bonus on their " +
            "very first payment.</p>" +
        "</div>" +
        '<div class="aff-code-box">' +
          '<span class="aff-code-label">Your code</span>' +
          '<strong class="aff-code">' + esc(state.code || "—") + "</strong>" +
        "</div>" +
      "</div>" +

      '<div class="aff-stats">' +
        '<div class="aff-stat"><strong>' + money(state.balance) + "</strong><span>Available balance</span></div>" +
        '<div class="aff-stat"><strong>' + money(state.total_earned) + "</strong><span>Total earned</span></div>" +
        '<div class="aff-stat"><strong>' + (state.referrals_count || 0) + "</strong><span>People referred</span></div>" +
        '<div class="aff-stat"><strong>' + money(rates.subscription) + "</strong><span>Per subscription</span></div>" +
      "</div>" +

      '<div class="aff-card">' +
        "<h3>Your referral link</h3>" +
        '<div class="aff-link-row">' +
          '<input id="aff-link" type="text" readonly value="' + esc(state.link || "") + '" />' +
          '<button type="button" class="btn-action btn-sm" id="aff-copy">Copy link</button>' +
          '<button type="button" class="btn-secondary btn-sm" id="aff-share">Share</button>' +
        "</div>" +
        '<p class="aff-hint">When someone signs up with your link, they are tied to you for good — every ' +
          "subscription and purchase they make earns you money.</p>" +
      "</div>" +

      '<div class="aff-card">' +
        "<h3>What you earn</h3>" +
        '<ul class="aff-rates">' +
          "<li><span>New signup</span><strong>" + money(rates.signup) + "</strong></li>" +
          "<li><span>Every monthly subscription</span><strong>" + money(rates.subscription) + "</strong></li>" +
          "<li><span>Anything they buy</span><strong>" + rates.percent + "% of the price</strong></li>" +
          "<li><span>Their first payment bonus</span><strong>" + money(rates.first) + " (once)</strong></li>" +
        "</ul>" +
        '<p class="aff-hint">Amounts are set by the admin and may change — your balance always shows what you actually earned.</p>' +
      "</div>" +

      '<div class="aff-card">' +
        "<h3>Earnings</h3>" +
        (earnRows
          ? '<div class="aff-table-wrap"><table class="aff-table"><thead><tr><th>Type</th><th>Amount</th><th>Date</th></tr></thead><tbody>' +
            earnRows + "</tbody></table></div>"
          : '<p class="aff-empty">No earnings yet — share your link to start.</p>') +
      "</div>" +

      '<div class="aff-card">' +
        "<h3>People you referred</h3>" +
        (refsRows
          ? '<div class="aff-table-wrap"><table class="aff-table"><thead><tr><th>#</th><th>Name</th><th>Signup commission</th><th>Joined</th></tr></thead><tbody>' +
            refsRows + "</tbody></table></div>"
          : '<p class="aff-empty">No referrals yet.</p>') +
      "</div>" +

      '<div class="aff-card">' +
        "<h3>Withdraw your earnings</h3>" +
        '<p class="aff-hint">Payouts are paid manually by our team. Submit your bank details and we send ' +
          money(state.balance) + " to that account, then mark the request paid.</p>" +
        '<form id="aff-payout-form" class="aff-form">' +
          '<label><span>Bank name</span><input id="aff-bank" type="text" required placeholder="e.g. GTBank" /></label>' +
          '<label><span>Account number</span><input id="aff-acct-num" type="text" inputmode="numeric" required placeholder="0123456789" /></label>' +
          '<label><span>Account name</span><input id="aff-acct-name" type="text" required placeholder="Name on the account" /></label>' +
          '<button type="submit" class="btn-action" id="aff-payout-btn">Request payout</button>' +
        "</form>" +
        '<div id="aff-payout-msg"></div>' +
      "</div>" +

      '<div class="aff-card">' +
        "<h3>Payout history</h3>" +
        (payRows
          ? '<div class="aff-table-wrap"><table class="aff-table"><thead><tr><th>Amount</th><th>Bank</th><th>Status</th><th>Requested</th><th>Note</th></tr></thead><tbody>' +
            payRows + "</tbody></table></div>"
          : '<p class="aff-empty">No payout requests yet.</p>') +
      "</div>"
    );
  }

  function bind(state) {
    var copyBtn = document.getElementById("aff-copy");
    if (copyBtn) {
      copyBtn.addEventListener("click", function () {
        var link = (document.getElementById("aff-link") || {}).value || "";
        var done = function () {
          copyBtn.textContent = "Copied!";
          setTimeout(function () { copyBtn.textContent = "Copy link"; }, 1600);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(link).then(done).catch(function () {
            window.prompt("Copy your referral link:", link);
          });
        } else {
          window.prompt("Copy your referral link:", link);
        }
      });
    }

    var shareBtn = document.getElementById("aff-share");
    if (shareBtn) {
      shareBtn.addEventListener("click", function () {
        var link = (document.getElementById("aff-link") || {}).value || "";
        var text = "Learn smarter on Scholaxia — live classes, CBT practice and an AI tutor. Join with my link: " + link;
        if (navigator.share) {
          navigator.share({ title: "Scholaxia", text: text, url: link }).catch(function () {});
        } else {
          window.open("https://wa.me/?text=" + encodeURIComponent(text), "_blank", "noopener");
        }
      });
    }

    var form = document.getElementById("aff-payout-form");
    if (form) {
      form.addEventListener("submit", async function (ev) {
        ev.preventDefault();
        var btn = document.getElementById("aff-payout-btn");
        var msg = document.getElementById("aff-payout-msg");
        if (msg) msg.innerHTML = "";
        if (btn) { btn.disabled = true; btn.textContent = "Submitting…"; }
        try {
          var next = await affApi("/api/v1/affiliate/payout", {
            method: "POST",
            body: {
              bank_name: (document.getElementById("aff-bank") || {}).value || "",
              account_number: (document.getElementById("aff-acct-num") || {}).value || "",
              account_name: (document.getElementById("aff-acct-name") || {}).value || "",
            },
          });
          render(next, (next && next.message) || "Payout request submitted.");
        } catch (e) {
          if (msg) {
            msg.innerHTML = '<div class="aff-msg err">' + esc((e && e.message) || "Could not submit payout.") + "</div>";
          }
          if (btn) { btn.disabled = false; btn.textContent = "Request payout"; }
        }
      });
    }
  }

  function render(state, note) {
    var el = document.getElementById("affiliate-content");
    if (!el) return;
    el.innerHTML =
      (note ? '<div class="aff-msg ok">' + esc(note) + "</div>" : "") + html(state);
    bind(state);
  }

  async function loadAffiliatePage() {
    var el = document.getElementById("affiliate-content");
    if (!el) return;
    el.innerHTML = '<div class="loading">Loading Refer &amp; Earn…</div>';
    try {
      var state = await affApi("/api/v1/affiliate/me");
      if (!state) {
        el.innerHTML = '<div class="aff-msg err">Sign in again to see your referral link.</div>';
        return;
      }
      if (!state.joined) {
        state = await affApi("/api/v1/affiliate/join", { method: "POST" });
        if (!state || !state.joined) state = await affApi("/api/v1/affiliate/me");
      }
      if (!state) {
        el.innerHTML = '<div class="aff-msg err">Could not open Refer &amp; Earn. Try again.</div>';
        return;
      }
      render(state);
    } catch (e) {
      el.innerHTML = '<div class="aff-msg err">' +
        esc((e && e.message) || "Could not load Refer & Earn. Check your connection.") + "</div>";
    }
  }

  window.loadAffiliatePage = loadAffiliatePage;
})();
