/**
 * Student Library — admin books with tabs + search (matches mobile LibraryScreen).
 */

var _libraryBooksCache = [];
var _libraryActiveTab = "all";
var _librarySearchQ = "";
var _libraryLoadError = ""; // shown instead of a fake "No books yet" state
var _libraryLoadError = ""; // shown instead of a fake "No books yet" state

var LIBRARY_TABS = [
  { id: "all", label: "All" },
  { id: "books", label: "Books" },
  { id: "study", label: "Study Materials" },
  { id: "scheme", label: "Scheme of Work" },
  { id: "notes", label: "Lesson Notes" },
];

function libraryPriceTag(item) {
  if (item.is_free || item.has_access) {
    return item.is_free
      ? '<span class="material-price free">Free</span>'
      : '<span class="material-price free">Unlocked</span>';
  }
  return '<span class="material-price">₦' + Number(item.price || 0).toLocaleString("en-NG") + "</span>";
}

function libraryCategory(book) {
  var hay = ((book.category || "") + " " + (book.subject || "") + " " + (book.title || "")).toLowerCase();
  if (/scheme|syllabus/.test(hay)) return "scheme";
  if (/note|handout|summary/.test(hay)) return "notes";
  if (/study\s*material|material/.test(hay)) return "study";
  return "books";
}

function libraryMatchesSearch(book, q) {
  if (!q) return true;
  var hay = [
    book.title,
    book.author,
    book.subject,
    book.category,
    book.description,
  ]
    .join(" ")
    .toLowerCase();
  return hay.indexOf(q) >= 0;
}

function filteredLibraryBooks() {
  return (_libraryBooksCache || []).filter(function (b) {
    if (_libraryActiveTab !== "all" && libraryCategory(b) !== _libraryActiveTab) return false;
    return libraryMatchesSearch(b, _librarySearchQ);
  });
}

function renderLibraryChrome() {
  var tabsEl = document.getElementById("library-tabs");
  var searchEl = document.getElementById("library-search");
  if (tabsEl) {
    tabsEl.innerHTML = LIBRARY_TABS.map(function (t) {
      return (
        '<button type="button" class="lib-tab' +
        (_libraryActiveTab === t.id ? " active" : "") +
        '" data-lib-tab="' +
        t.id +
        '">' +
        t.label +
        "</button>"
      );
    }).join("");
    tabsEl.querySelectorAll("[data-lib-tab]").forEach(function (btn) {
      btn.onclick = function () {
        _libraryActiveTab = btn.getAttribute("data-lib-tab") || "all";
        renderLibraryList();
        renderLibraryChrome();
      };
    });
  }
  if (searchEl && !searchEl._bound) {
    searchEl._bound = true;
    searchEl.addEventListener("input", function () {
      _librarySearchQ = (searchEl.value || "").trim().toLowerCase();
      renderLibraryList();
    });
  }
}

async function openLibraryBookStudent(bookId, item) {
  item = item || {};
  if (!item.is_free && !item.has_access) {
    var pay = await payForBook(bookId);
    if (pay && pay.redirecting) return;
  }
  try {
    var token = localStorage.getItem("sia_token") || localStorage.getItem("sia_teacher_token") || "";
    var res = await fetch((window.API_BASE || "") + "/api/v1/library/" + encodeURIComponent(bookId) + "/file", {
      headers: { Authorization: "Bearer " + token },
    });
    if (res.ok) {
      var blob = await res.blob();
      var url = URL.createObjectURL(blob);
      var modal = document.getElementById("library-reader-modal");
      var frame = document.getElementById("library-reader-frame");
      var title = document.getElementById("library-reader-title");
      if (modal && frame) {
        if (title) title.textContent = item.title || "Library";
        frame.src = url;
        modal.classList.remove("hidden");
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    var data = await api("/api/v1/library/" + encodeURIComponent(bookId) + "/read");
    if (data && data.read_url) {
      window.open(data.read_url, "_blank", "noopener,noreferrer");
    } else {
      throw new Error("Could not open this PDF.");
    }
  } catch (e) {
    if (e.message && e.message.indexOf("402") >= 0) {
      var r = await payForBook(bookId);
      if (r && r.redirecting) return;
    }
    alert(e.message || "Could not open book.");
  }
}

function closeLibraryReader() {
  var modal = document.getElementById("library-reader-modal");
  var frame = document.getElementById("library-reader-frame");
  if (frame) frame.src = "about:blank";
  if (modal) modal.classList.add("hidden");
}

function libTitle(t) {
  if (typeof stripYearLabel === "function") return stripYearLabel(t);
  return String(t || "").replace(/\b(19|20)\d{2}\b/g, "").replace(/\s{2,}/g, " ").trim();
}

function renderLibraryList() {
  var el = document.getElementById("library-list");
  var stats = document.getElementById("library-stats");
  if (!el) return;

  /* HARD ERROR state beats everything — never show "No books yet" when the
     request itself failed (was the reported bug: library "not showing"). */
  if (_libraryLoadError) {
    if (stats) stats.innerHTML = "";
    el.innerHTML =
      '<div class="empty-state-premium">' +
      '<div class="empty-icon">⚠️</div>' +
      "<h3>Library could not load</h3>" +
      '<p>' + escHtml(_libraryLoadError) + "</p>" +
      '<button type="button" class="btn-sm primary" id="libraryRetryBtn">Retry</button>' +
      "</div>";
    var retry = document.getElementById("libraryRetryBtn");
    if (retry) retry.onclick = function () { loadLibrary(); };
    return;
  }

  var books = filteredLibraryBooks();

  if (stats) {
    stats.innerHTML =
      '<div class="stat-pill"><strong>' +
      books.length +
      "</strong> of " +
      _libraryBooksCache.length +
      " items</div>";
  }

  if (!_libraryBooksCache.length) {
    el.innerHTML =
      '<div class="empty-state-premium">' +
      '<div class="empty-icon">&#128218;</div>' +
      "<h3>No books yet</h3>" +
      "<p>When Scholaxia admin adds books, they will appear here.</p>" +
      "</div>";
    return;
  }

  if (!books.length) {
    el.innerHTML =
      '<div class="empty-state-premium">' +
      "<h3>No matches</h3>" +
      "<p>Try another tab or search word.</p>" +
      "</div>";
    return;
  }

  el.innerHTML = books
    .map(function (b) {
      var actions = "";
      if (b.has_access || b.is_free) {
        actions =
          '<button type="button" class="btn-sm primary" data-lib-action="open-book" data-id="' +
          escHtml(b.id) +
          '">Read</button>';
      } else {
        actions =
          '<button type="button" class="btn-sm primary" data-lib-action="pay-book" data-id="' +
          escHtml(b.id) +
          '">Pay &amp; unlock</button>';
      }
      return (
        '<article class="material-card" data-book-id="' +
        escHtml(b.id) +
        '">' +
        (b.cover_image_url
          ? '<div class="material-cover" style="background-image:url(\'' +
            escHtml(b.cover_image_url) +
            "')\"></div>"
          : '<div class="material-icon">&#128218;</div>') +
        '<div class="material-body">' +
        "<h4>" +
        escHtml(libTitle(b.title)) +
        "</h4>" +
        '<p class="material-meta">' +
        escHtml(b.subject || "General") +
        " · " +
        escHtml((b.category || libraryCategory(b)).toString()) +
        "</p>" +
        '<p class="material-desc">' +
        escHtml(libTitle(b.description || "By " + (b.author || "Scholaxia"))) +
        "</p>" +
        '<div class="material-actions">' +
        libraryPriceTag(b) +
        " " +
        actions +
        "</div>" +
        "</div></article>"
      );
    })
    .join("");

  el.querySelectorAll("[data-lib-action]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var action = btn.dataset.libAction;
      var id = btn.dataset.id;
      var book = _libraryBooksCache.find(function (b) {
        return b.id === id;
      });
      if (action === "open-book") {
        openLibraryBookStudent(id, book);
        return;
      }
      if (action === "pay-book") {
        payForBook(id)
          .then(function (r) {
            if (r && r.redirecting) return;
            loadLibrary();
          })
          .catch(function (e) {
            alert(e.message);
          });
      }
    });
  });
}

async function loadLibrary() {
  var el = document.getElementById("library-list");
  if (!el) return;
  // Library is FREE for everyone now (owner request): the material shop must be
  // visible so students can buy individual items — no subscription gate here.
  var gate = document.querySelector("#page-library .study-gate");
  if (gate) gate.hidden = true;
  el.innerHTML = '<div class="loading">Loading library…</div>';
  renderLibraryChrome();

  var books = [];
  _libraryLoadError = "";
  try {
    books = (await api("/api/v1/library/student")) || [];
  } catch (e) {
    books = [];
    // Surface the real failure (network down, session expired, server 500…)
    // instead of the misleading "No books yet" empty state.
    var m = (e && e.message) || "";
    _libraryLoadError = m || "Could not load the library. Check your connection and try again.";
    if (e && (e.status === 401 || String(m).toLowerCase().indexOf("401") >= 0)) {
      _libraryLoadError = "Your session expired — sign in again to see your library.";
    }
    renderLibraryChrome();
    renderLibraryList();
    return;
  }
  books = Array.isArray(books) ? books : [];
  // Past Questions live on their own page — keep them out of the Library.
  books = books.filter(function (b) {
    var cat = String(b.category || b.type || "").toLowerCase();
    var title = String(b.title || "").toLowerCase();
    if (cat.indexOf("past") >= 0 && cat.indexOf("question") >= 0) return false;
    if (cat === "past_questions" || cat === "past question" || cat === "pastquestions") return false;
    if (title.indexOf("past question") >= 0 && (cat === "" || cat === "library")) return false;
    return true;
  });
  _libraryBooksCache = books;
  renderLibraryChrome();
  renderLibraryList();
}

window.loadLibrary = loadLibrary;
