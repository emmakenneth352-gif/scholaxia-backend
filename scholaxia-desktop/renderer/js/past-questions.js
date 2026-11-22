/** Past Questions — site-parity: library-backed PDFs/papers with search,
 *  exam-category filters, pay-to-unlock and instant open. */

var _pqCache = [];
var _pqCat = "all";
var _pqSearch = "";
// Browsing is open to everyone; opening or buying a paper needs an account.
var _pqGuest = false;

function pqEsc(s) {
  var d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
}

function pqCatLabel(cat) {
  if (cat === "jamb") return "JAMB / UTME";
  if (cat === "waec") return "WAEC";
  if (cat === "neco") return "NECO";
  if (cat === "post") return "Post-UTME";
  if (cat === "common") return "Common Entrance";
  return "All papers";
}

function pqMatchesCat(it, cat) {
  if (cat === "all") return true;
  var hay = ((it.exam_type || "") + " " + (it.title || "") + " " + (it.subject || "") + " " + (it.category || "")).toLowerCase();
  if (cat === "post") return hay.indexOf("utme") > -1 || hay.indexOf("post-utme") > -1;
  if (cat === "common") return hay.indexOf("common entrance") > -1 || hay.indexOf("common_entrance") > -1;
  return hay.indexOf(cat) > -1;
}

async function loadPastQuestionsPage() {
  var root = document.getElementById("past-questions-root");
  if (!root) return;
  root.innerHTML = '<div class="loading">Loading past question papers…</div>';

  _pqGuest = !(getToken && getToken());

  try {
    var data = await api(
      "/api/v1/library/" + (_pqGuest ? "public" : "student") + "?category=Past%20Questions",
      { timeout: 45000, retries: 1, preferXhr: true }
    );
    _pqCache = [];
    var push = function (arr) {
      (arr || []).forEach(function (x) {
        if (x && x.id && !_pqCache.some(function (y) { return y.id === x.id; })) _pqCache.push(x);
      });
    };
    if (Array.isArray(data)) push(data);
    else {
      push(data.items); push(data.results); push(data.library); push(data.books);
    }
    renderPastQuestionsPage();
  } catch (e) {
    root.innerHTML = '<div class="as-empty"><h3>Could not load</h3><p>' + pqEsc(e.message) + "</p></div>";
  }
}

function renderPastQuestionsPage() {
  var root = document.getElementById("past-questions-root");
  if (!root) return;

  var cats = ["all", "jamb", "waec", "neco", "post", "common"];
  var items = _pqCache.filter(function (it) { return pqMatchesCat(it, _pqCat); });
  if (_pqSearch) {
    var q = _pqSearch.toLowerCase();
    items = items.filter(function (it) {
      var hay = ((it.exam_type || "") + " " + (it.title || "") + " " + (it.subject || "") + " " + (it.category || "") + " " + (it.description || "")).toLowerCase();
      return hay.indexOf(q) > -1;
    });
  }

  var html =
    (_pqGuest
      ? '<p class="pq-guest-note">Browsing as a guest — you can look through every paper. Sign in only when you want to open or buy one.</p>'
      : "") +
    '<div class="pq-toolbar">' +
    '<input type="search" id="pq-page-search" class="library-search" placeholder="Search subject, title, exam type…" value="' + pqEsc(_pqSearch) + '" />' +
    "</div>" +
    '<div class="pq-tabs-row">' +
    cats.map(function (c) {
      return '<button type="button" class="mp-tab' + (_pqCat === c ? " active" : "") + '" data-pq-cat="' + c + '">' + pqEsc(pqCatLabel(c)) + "</button>";
    }).join("") +
    "</div>" +
    '<p class="pq-count"><strong>' + items.length + "</strong> of " + _pqCache.length + " papers</p>" +
    '<div class="pq-grid">';

  if (!items.length) {
    html += '<div class="empty-state-premium" style="grid-column:1/-1"><div class="empty-icon">&#128196;</div><h3>No past-question papers match</h3><p>Try another subject, title, or exam category.</p></div>';
  } else {
    html += items.map(function (it, i) {
      var price = Number(it.price || 0);
      var hasAccess = !!(it.has_access || it.is_free || price <= 0);
      var catTag = (it.exam_type || it.category || "Past paper");
      var title = typeof stripYearLabel === "function" ? stripYearLabel(it.title || it.name || "Past paper") : (it.title || "Past paper");
      var desc = typeof stripYearLabel === "function" ? stripYearLabel(it.description || it.subject || "") : (it.description || it.subject || "");
      var foot;
      if (_pqGuest) {
        foot =
          (hasAccess ? "" : '<strong class="pq-price">₦' + price.toLocaleString("en-NG") + "</strong>") +
          '<button type="button" class="btn-action btn-sm" data-pq-signin="' + pqEsc(it.id) + '">' +
          (hasAccess ? "Sign in to read" : "Sign in to buy") +
          "</button>";
      } else if (hasAccess) {
        foot = '<button type="button" class="btn-action btn-sm" data-pq-open="' + pqEsc(it.id) + '">Read now</button>';
      } else {
        foot =
          '<strong class="pq-price">₦' + price.toLocaleString("en-NG") + "</strong>" +
          '<button type="button" class="btn-action btn-sm" data-pq-pay="' + pqEsc(it.id) + '">Pay &amp; unlock</button>';
      }
      return (
        '<article class="pq-card" style="animation-delay:' + Math.min(i, 14) * 0.05 + 's">' +
        '<div class="pq-card-cover">' +
        (it.cover_image_url
          ? '<img src="' + pqEsc(it.cover_image_url) + '" alt="" loading="lazy" onerror="this.parentNode.classList.add(\'pq-cover-fallback\');this.remove()" />'
          : "") +
        '</div>' +
        '<span class="pq-card-tag">' + pqEsc(catTag) + "</span>" +
        "<h4>" + pqEsc(title) + "</h4>" +
        (desc ? '<p class="pq-card-desc">' + pqEsc(desc) + "</p>" : "") +
        '<div class="pq-card-foot">' + foot +
        (it.download_path || it.file_url ? '<span class="pq-downloadable">Downloadable</span>' : "") +
        "</div></article>"
      );
    }).join("");
  }
  html += "</div>";
  root.innerHTML = html;

  var search = document.getElementById("pq-page-search");
  if (search) {
    search.addEventListener("input", function () {
      _pqSearch = (search.value || "").trim();
      renderPastQuestionsPage();
      var s2 = document.getElementById("pq-page-search");
      if (s2) { s2.focus(); s2.setSelectionRange(s2.value.length, s2.value.length); }
    });
  }
  root.querySelectorAll("[data-pq-cat]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      _pqCat = btn.getAttribute("data-pq-cat");
      renderPastQuestionsPage();
    });
  });
  root.querySelectorAll("[data-pq-open]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var it = _pqCache.find(function (x) { return String(x.id) === btn.getAttribute("data-pq-open"); });
      if (it && typeof openLibraryBookStudent === "function") openLibraryBookStudent(it.id, it);
    });
  });
  root.querySelectorAll("[data-pq-signin]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (typeof goToLogin === "function") goToLogin("past-questions");
      else window.location.href = "index.html";
    });
  });
  root.querySelectorAll("[data-pq-pay]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var it = _pqCache.find(function (x) { return String(x.id) === btn.getAttribute("data-pq-pay"); });
      if (!it) return;
      if (typeof payForBook === "function") payForBook(it.id);
      else alert("Payment is unavailable right now. Please restart the app.");
    });
  });
}

window.loadPastQuestionsPage = loadPastQuestionsPage;
window.renderPastQuestionsPage = renderPastQuestionsPage;
