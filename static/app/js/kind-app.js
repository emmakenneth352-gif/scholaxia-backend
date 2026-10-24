/* Scholaxia Kids website — Home, Sia, Live, Saved, Library, Videos, Games, CBT, Profile */
(function () {
  var api = window.ScholaxiaAPI;
  if (!api || typeof api.requireAuth !== "function") {
    console.error("ScholaxiaAPI failed to load");
    return;
  }
  if (!api.requireAuth(["kind"])) return;

  var TITLES = {
    home: "Home",
    sia: "Sia AI",
    live: "Live Class",
    saved: "Saved",
    library: "Library",
    videos: "Videos",
    games: "Games",
    cbt: "CBT",
    profile: "Profile",
  };

  var pageHistory = ["home"];
  var currentPage = "home";
  var siaHistory = [];
  var cbtState = { exam: null, session: null, answers: {}, index: 0 };
  var kindLibraryCache = [];
  var kindVideosCache = [];
  var kindActiveGame = null;
  var shell = document.getElementById("kindShell");

  function $(id) {
    return document.getElementById(id);
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setUserChip(name, ageGroup) {
    var first = (name || "Friend").split(" ")[0];
    var letter = first.charAt(0).toUpperCase() || "K";
    if ($("userName")) $("userName").textContent = first;
    if ($("userAv")) $("userAv").textContent = letter;
    if ($("hello")) $("hello").textContent = "Hi, " + first + "!";
    if ($("profileName")) $("profileName").textContent = name || first;
    if ($("profileAv")) $("profileAv").textContent = letter;
    if (ageGroup) {
      var label = "Ages " + ageGroup;
      if ($("userAge")) $("userAge").textContent = label;
      localStorage.setItem("sia_age_group", ageGroup);
    }
  }

  function closeMobileNav() {
    document.body.classList.remove("nav-open");
    var bd = $("sidebarBackdrop");
    if (bd) bd.hidden = true;
  }

  function openMobileNav() {
    document.body.classList.add("nav-open");
    var bd = $("sidebarBackdrop");
    if (bd) bd.hidden = false;
  }

  function updateBackBtn() {
    var btn = $("backBtn");
    if (!btn) return;
    var show = pageHistory.length > 1 || currentPage !== "home";
    btn.hidden = !show;
  }

  function showPage(id, opts) {
    id = String(id || "").trim();
    if (!TITLES[id]) return;
    opts = opts || {};
    if (!opts.replace && currentPage !== id) {
      pageHistory.push(id);
      if (pageHistory.length > 20) pageHistory.shift();
    }
    currentPage = id;

    document.querySelectorAll(".page").forEach(function (p) {
      var on = p.id === "page-" + id;
      p.classList.toggle("is-on", on);
    });
    document.querySelectorAll(".kind-nav-btn").forEach(function (b) {
      var page = b.getAttribute("data-page");
      b.classList.toggle("is-active", page === id);
    });
    if ($("pageTitle")) $("pageTitle").textContent = TITLES[id];
    updateBackBtn();
    closeMobileNav();

    // Keep sidebar usable after navigation
    if (shell) {
      shell.classList.remove("sidebar-collapsed");
      if ($("sidebarToggle")) {
        $("sidebarToggle").textContent = "‹";
        $("sidebarToggle").setAttribute("aria-label", "Hide menu");
      }
    }

    try {
      if (id === "home") loadHome();
      else if (id === "live") loadLive();
      else if (id === "saved") loadSaved();
      else if (id === "library") loadKindLibrary();
      else if (id === "videos") loadKindVideos();
      else if (id === "games") loadKindGames();
      else if (id === "cbt") loadCbt();
      else if (id === "profile") loadProfile();
      else if (id === "sia") renderSia();
    } catch (err) {
      console.error("Kids page load failed:", err);
    }
  }

  // Expose for debugging / inline handlers
  window.kindShowPage = showPage;

  function goBack() {
    if (currentPage === "games" && kindActiveGame) {
      exitKindGame();
      return;
    }
    if (currentPage === "cbt" && $("cbtPlay") && !$("cbtPlay").hidden) {
      exitCbtPlayer();
      return;
    }
    if (pageHistory.length > 1) {
      pageHistory.pop();
      var prev = pageHistory[pageHistory.length - 1] || "home";
      showPage(prev, { replace: true });
      return;
    }
    if (currentPage !== "home") showPage("home", { replace: true });
  }

  /* —— Home —— */
  async function loadHome() {
    try {
      var me = await api.api("/api/v1/kind/me");
      if (me && me.full_name) {
        setUserChip(me.full_name, me.age_group);
        localStorage.setItem("sia_name", me.full_name);
      }
      var live = await api.api("/api/v1/live-classes/?status=live").catch(function () {
        return [];
      });
      if (!Array.isArray(live)) live = live.classes || live.items || [];
      var count = live.filter(function (c) {
        return c.is_live;
      }).length;
      if ($("statLive")) $("statLive").textContent = String(count);
      var banner = $("homeBanner");
      if (banner) {
        banner.innerHTML = count
          ? '<div class="banner-card"><div><strong>' +
            count +
            " live class" +
            (count === 1 ? "" : "es") +
            "</strong> ready — join a lesson now!</div>" +
            '<button type="button" class="btn btn-primary" data-goto="live">View classes</button></div>'
          : '<div class="banner-card"><div>No live class right now. Talk to Sia or practise CBT while you wait.</div>' +
            '<button type="button" class="btn btn-primary" data-goto="sia">Talk to Sia</button></div>';
      }
    } catch (e) {
      /* keep chip from session */
    }
  }

  /* —— Sia —— */
  function renderSia() {
    var box = $("siaChat");
    if (!box) return;
    if (!siaHistory.length) {
      box.innerHTML =
        '<div class="sia-welcome"><div class="sia-orb sm">S</div><div><strong>Hi friend!</strong><p>What do you want to learn today?</p></div></div>';
      return;
    }
    box.innerHTML = siaHistory
      .map(function (m) {
        return '<div class="bubble ' + (m.isAi ? "bot" : "me") + '">' + esc(m.text) + "</div>";
      })
      .join("");
    box.scrollTop = box.scrollHeight;
  }

  async function sendSia(question) {
    var q = String(question || "").trim();
    if (!q) return;
    var err = $("siaError");
    if (err) {
      err.textContent = "";
      err.className = "form-status";
    }
    siaHistory.push({ isAi: false, text: q });
    renderSia();
    try {
      var history = siaHistory.slice(-10).map(function (m) {
        return { role: m.isAi ? "assistant" : "user", content: m.text };
      });
      var r = await api.api("/api/v1/kind/sia/chat", {
        method: "POST",
        body: { question: q, subject: "General", conversation_history: history },
      });
      var reply =
        (r && (r.sia_kind || r.text || r.response || r.answer || r.message || r.reply)) || "";
      if (!String(reply).trim()) {
        reply =
          "I'd love to help you learn! Tell me a subject (like English or Maths) and what you want to practise.";
      }
      siaHistory.push({ isAi: true, text: String(reply) });
      renderSia();
    } catch (e) {
      if (err) {
        err.textContent = e.message || "Sia is resting. Try again!";
        err.className = "form-status err";
      }
      siaHistory.push({
        isAi: true,
        text: "Hmm, I lost that answer. Try again — ask me something like “teach me nouns”.",
      });
      renderSia();
    }
  }

  /* —— Live —— */
  async function loadLive() {
    var el = $("liveList");
    if (!el) return;
    el.innerHTML = '<div class="loading">Loading live classes…</div>';
    try {
      var rows = await api.api("/api/v1/live-classes/?status=live");
      if (!Array.isArray(rows)) rows = rows.classes || rows.items || [];
      if (!rows.length) {
        el.innerHTML =
          '<div class="empty"><strong>No live class right now</strong><br/>Check back soon, or book a one-on-one tutor.</div>';
        return;
      }
      el.innerHTML = rows
        .map(function (c) {
          var live = !!c.is_live;
          return (
            '<article class="live-card' +
            (live ? " is-live" : "") +
            '">' +
            (live ? '<span class="badge-live">Live now</span>' : "") +
            "<strong>" +
            esc(c.title || c.subject || "Live class") +
            "</strong>" +
            "<span style='color:var(--muted);font-weight:700;font-size:0.86rem'>" +
            esc(c.teacher_name || "Teacher") +
            (c.subject ? " · " + esc(c.subject) : "") +
            "</span>" +
            (live
              ? '<button type="button" class="btn btn-primary" data-join-live="' +
                esc(String(c.id)) +
                '">Join class</button>'
              : "") +
            "</article>"
          );
        })
        .join("");
    } catch (e) {
      el.innerHTML = '<div class="empty">' + esc(e.message || "Could not load classes") + "</div>";
    }
  }

  async function joinLive(id) {
    try {
      if (api.wakeServer) {
        try {
          await api.wakeServer(20000);
        } catch (w) {}
      }
      var res = await api.api("/api/v1/live-classes/" + encodeURIComponent(id) + "/join", {
        method: "POST",
        preferXhr: true,
        awaitWake: true,
        timeout: 45000,
        retries: 2,
      });
      var classId = (res && (res.class_id || res.classId || res.id)) || id;
      var roomId = (res && (res.room_id || res.channel_id)) || "";
      var token = (res && (res.livekit_token || res.token)) || "";
      var url = (res && res.livekit_url) || "";
      // plugNmeet room ready: jump straight into its own classroom client.
      if (res && res.pnm_join_url) {
        window.location.href = res.pnm_join_url;
        return;
      }
      if (!roomId || !token) {
        var joinUrl = (res && (res.join_url || res.meeting_url || res.room_url || res.url)) || "";
        if (joinUrl) {
          window.open(joinUrl, "_blank", "noopener");
          return;
        }
        throw new Error("Joined, but classroom media was not ready. Ask the teacher to restart the class.");
      }
      var user = api.getUser ? api.getUser() : {};
      localStorage.setItem(
        "live_session",
        JSON.stringify({
          class_id: classId,
          classId: classId,
          room_id: roomId,
          channel_id: roomId,
          livekit_token: token,
          livekit_url: url,
          identity: (res && res.identity) || "",
          title: (res && res.title) || "Live Class",
          subject: (res && res.subject) || "",
          teacher_name: (res && res.teacher_name) || "",
          role: "student",
          student_name: (user && user.name) || "Student",
        })
      );
      window.location.href = "classroom.html";
    } catch (e) {
      alert(e.message || "Could not join class.");
    }
  }

  async function bookClass() {
    var status = $("bookStatus");
    var subject = (($("bookSubject") && $("bookSubject").value) || "").trim();    var topic = (( $("bookTopic") && $("bookTopic").value) || "").trim();
    var packageId = (( $("bookPackage") && $("bookPackage").value) || "nursery_school").trim();
    if (!subject) {
      if (status) {
        status.textContent = "Enter a subject.";
        status.className = "form-status err";
      }
      return;
    }
    if (status) {
      status.textContent = "Opening Paystack…";
      status.className = "form-status";
    }
    try {
      var paid = await window.paystackPurchase({
        productType: "class_package",
        productId: packageId,
        returnPage: "live",
        notes: topic || subject,
      });
      if (!paid) return;
      await api.api("/api/v1/live-classes/requests", {
        method: "POST",
        body: {
          subject: subject,
          topic: topic || undefined,
          message: "Kids website booking",
        },
      });
      if (status) {
        status.textContent = "Booked! We'll assign a teacher.";
        status.className = "form-status ok";
      }
    } catch (e) {
      if (status) {
        status.textContent = e.message || "Booking failed.";
        status.className = "form-status err";
      }
    }
  }

  /* —— Saved —— */
  async function loadSaved() {
    var el = $("savedList");
    if (!el) return;
    el.innerHTML = '<div class="loading">Loading saved lessons…</div>';
    try {
      var rows = await api.api("/api/v1/saved-live-classes");
      if (!Array.isArray(rows)) rows = rows.items || [];
      if (!rows.length) {
        el.innerHTML =
          '<div class="empty">No saved lessons yet. Save a live class replay to watch here!</div>';
        return;
      }
      el.innerHTML = rows
        .map(function (s) {
          return (
            '<article class="saved-card"><strong>' +
            esc(s.title || s.class_title || "Saved lesson") +
            "</strong>" +
            (s.subject
              ? '<span style="color:var(--muted);font-weight:700">' + esc(s.subject) + "</span>"
              : "") +
            (s.recording_url
              ? '<a class="btn btn-primary" href="' +
                esc(s.recording_url) +
                '" target="_blank" rel="noopener">Watch replay</a>'
              : '<span style="color:var(--muted);font-weight:700">Replay coming soon</span>') +
            "</article>"
          );
        })
        .join("");
    } catch (e) {
      el.innerHTML = '<div class="empty">' + esc(e.message || "Could not load saved") + "</div>";
    }
  }

  function firstArray(data, keys) {
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== "object") return [];
    for (var i = 0; i < keys.length; i++) {
      if (Array.isArray(data[keys[i]])) return data[keys[i]];
    }
    return [];
  }

  function youtubeEmbed(url) {
    var u = String(url || "").trim();
    var m = u.match(/(?:youtu\.be\/|v=)([A-Za-z0-9_-]{6,})/);
    if (m) return "https://www.youtube.com/embed/" + m[1];
    return u;
  }

  async function fetchKindLibraryPdf(id) {
    if (api.fetchBinary) {
      return api.fetchBinary("/api/v1/library/" + encodeURIComponent(id) + "/file", {
        timeout: 180000,
        retries: 3,
        headers: { Accept: "application/pdf" },
      });
    }
    var token = api.getToken();
    var url = api.API_BASE + "/api/v1/library/" + encodeURIComponent(id) + "/file";
    if (api.wakeServer) {
      try {
        await api.wakeServer(60000);
      } catch (e) {}
    }
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open("GET", url, true);
      xhr.responseType = "arraybuffer";
      xhr.timeout = 180000;
      xhr.setRequestHeader("Authorization", "Bearer " + token);
      xhr.setRequestHeader("Accept", "application/pdf");
      xhr.onload = function () {
        if (xhr.status === 402) {
          reject(new Error("Pay to unlock this book."));
          return;
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(new Uint8Array(xhr.response));
          return;
        }
        reject(new Error("Could not open this book (" + xhr.status + ")"));
      };
      xhr.onerror = function () {
        reject(new Error("Failed to fetch"));
      };
      xhr.ontimeout = function () {
        reject(new Error("The server took too long. Try again."));
      };
      xhr.send();
    });
  }

  async function openKindBook(id, btn) {
    if (!id) return;
    var prev = btn ? btn.textContent : "";
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Opening…";
    }
    try {
      if (api.wakeServer) {
        try {
          await api.wakeServer(45000);
        } catch (e) {}
      }
      var bytes = await fetchKindLibraryPdf(id);
      var blob = new Blob([bytes], { type: "application/pdf" });
      var blobUrl = URL.createObjectURL(blob);
      var win = window.open(blobUrl, "_blank", "noopener");
      if (!win) alert("Allow pop-ups to read this PDF, or try again.");
      setTimeout(function () {
        URL.revokeObjectURL(blobUrl);
      }, 60000);
    } catch (e) {
      var msg = e.message || "Could not open book.";
      if (/402|pay|unlock/i.test(msg)) {
        try {
          var paid = await window.paystackPurchase({
            productType: "library_book",
            productId: id,
            returnPage: "library",
          });
          if (paid) openKindBook(id, btn);
          return;
        } catch (payErr) {
          msg = payErr.message || msg;
        }
      }
      alert(msg);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = prev || "Read";
      }
    }
  }

  function renderKindLibrary(items) {
    var el = $("kindLibraryList");
    if (!el) return;
    if (!items.length) {
      el.innerHTML =
        '<div class="empty">No kids library books yet. Admin uploads them under Kids Library in the admin panel.</div>';
      return;
    }
    el.innerHTML = items
      .map(function (it) {
        var title = it.title || it.name || "Book";
        var cat = it.category || it.subject || "Library";
        var desc = it.description || it.author || "";
        var price = Number(it.price || 0);
        var hasAccess = !!(it.has_access || it.is_free || price <= 0);
        var foot;
        if (hasAccess) {
          foot =
            '<button type="button" class="btn btn-primary" data-open-book="' +
            esc(String(it.id)) +
            '">Read</button>';
        } else {
          foot =
            "<strong>₦" +
            price.toLocaleString("en-NG") +
            '</strong><button type="button" class="btn btn-primary" data-pay-book="' +
            esc(String(it.id)) +
            '">Buy with Paystack</button>';
        }
        return (
          '<article class="saved-card"><strong>' +
          esc(title) +
          '</strong><span style="color:var(--muted);font-weight:700">' +
          esc(cat) +
          "</span>" +
          (desc ? '<p style="margin:0.35rem 0 0.65rem;color:var(--muted)">' + esc(desc) + "</p>" : "") +
          foot +
          "</article>"
        );
      })
      .join("");
  }

  function filterKindLibrary() {
    var q = (($("kindLibrarySearch") && $("kindLibrarySearch").value) || "").trim().toLowerCase();
    if (!q) {
      renderKindLibrary(kindLibraryCache);
      return;
    }
    var filtered = kindLibraryCache.filter(function (it) {
      var blob = [it.title, it.author, it.subject, it.description, it.category]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return blob.indexOf(q) >= 0;
    });
    renderKindLibrary(filtered);
  }

  async function loadKindLibrary() {
    var el = $("kindLibraryList");
    if (!el) return;
    el.innerHTML = '<div class="loading">Loading library…</div>';
    try {
      if (api.wakeServer) {
        try {
          await api.wakeServer(30000);
        } catch (e) {}
      }
      var data = await api.api("/api/v1/library/kind", { timeout: 45000, retries: 1, preferXhr: true });
      kindLibraryCache = firstArray(data, ["items", "results", "library", "books"]);
      if (!Array.isArray(kindLibraryCache) && Array.isArray(data)) kindLibraryCache = data;
      filterKindLibrary();
    } catch (e) {
      el.innerHTML = '<div class="empty">' + esc(e.message || "Could not load library") + "</div>";
    }
  }

  function renderKindVideos(items) {
    var el = $("kindVideosList");
    if (!el) return;
    if (!items.length) {
      el.innerHTML =
        '<div class="empty">No kid videos yet. Admin uploads them under Kids Videos in the admin panel.</div>';
      return;
    }
    el.innerHTML = items
      .map(function (it) {
        var src = youtubeEmbed(it.video_url || it.url || "");
        var tutor = it.tutor_name || it.tutor || "";
        return (
          '<article class="saved-card">' +
          "<strong>" +
          esc(it.title || "Video lesson") +
          '</strong><span style="color:var(--muted);font-weight:700">' +
          esc(it.subject || "Video") +
          "</span>" +
          (tutor
            ? '<p style="margin:0.35rem 0 0.65rem;color:var(--muted)">Tutor: ' + esc(tutor) + "</p>"
            : "") +
          (src
            ? '<div class="video-frame"><iframe src="' +
              esc(src) +
              '" title="' +
              esc(it.title || "Video") +
              '" allowfullscreen loading="lazy"></iframe></div>'
            : '<a class="btn btn-primary" href="' +
              esc(it.video_url || "#") +
              '" target="_blank" rel="noopener">Watch</a>') +
          "</article>"
        );
      })
      .join("");
  }

  function filterKindVideos() {
    var q = (($("kindVideosSearch") && $("kindVideosSearch").value) || "").trim().toLowerCase();
    if (!q) {
      renderKindVideos(kindVideosCache);
      return;
    }
    var filtered = kindVideosCache.filter(function (it) {
      var blob = [it.title, it.subject, it.tutor_name, it.tutor, it.exam_type]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return blob.indexOf(q) >= 0;
    });
    renderKindVideos(filtered);
  }

  async function loadKindVideos() {
    var el = $("kindVideosList");
    if (!el) return;
    el.innerHTML = '<div class="loading">Loading videos…</div>';
    try {
      var data = await api.api("/api/v1/videos/kind", { timeout: 30000, retries: 1, preferXhr: true });
      kindVideosCache = firstArray(data, ["videos", "items", "results"]);
      filterKindVideos();
    } catch (e) {
      el.innerHTML = '<div class="empty">' + esc(e.message || "Could not load videos") + "</div>";
    }
  }

  /* —— Games —— */
  var KIND_SAMPLE_QUESTIONS = [
    { prompt: "What color is the sky on a sunny day?", options: ["Green", "Blue", "Red", "Yellow"], correct: 1 },
    { prompt: "How many legs does a dog have?", options: ["2", "4", "6", "8"], correct: 1 },
    { prompt: "Which animal says 'Meow'?", options: ["Dog", "Cat", "Cow", "Bird"], correct: 1 },
    { prompt: "What comes after 5?", options: ["4", "6", "7", "3"], correct: 1 },
    { prompt: "What do plants need to grow?", options: ["Ice", "Sunlight", "Darkness", "Salt"], correct: 1 },
  ];

  function kindSpeakText(text) {
    if (!text || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(String(text));
      u.rate = 0.95;
      window.speechSynthesis.speak(u);
    } catch (e) { /* ignore */ }
  }

  function kindSpeakQuestion(q) {
    if (!q) return;
    var text = q.speak_word || q.prompt || "";
    kindSpeakText(text);
  }

  async function loadKindGames() {
    var grid = $("kind-games-grid");
    var play = $("kind-game-play");
    if (!grid) return;
    if (play) play.classList.add("hidden");
    kindActiveGame = null;
    grid.classList.remove("hidden");
    grid.innerHTML = '<div class="loading">Loading games…</div>';
    try {
      var data = await api.api("/api/v1/kind/games/catalog");
      var games = (data && data.games) || [];
      if (!games.length) {
        grid.innerHTML = '<div class="empty">No games available yet.</div>';
        return;
      }
      grid.innerHTML = games
        .map(function (g) {
          var leaf = localStorage.getItem("kind_leaf_" + g.id) || "1";
          return (
            '<button type="button" class="kind-game-card" data-game-id="' +
            esc(g.id) +
            '" data-game-title="' +
            esc(g.title) +
            '">' +
            '<div class="kind-game-ico">🎮</div>' +
            "<strong>" +
            esc(g.title) +
            "</strong>" +
            '<div class="leaf">🍃 Leaf ' +
            esc(leaf) +
            "</div>" +
            "</button>"
          );
        })
        .join("");
    } catch (e) {
      grid.innerHTML = '<div class="empty">' + esc(e.message || "Could not load games") + "</div>";
    }
  }

  async function startKindGame(gameId, title) {
    kindActiveGame = { id: gameId, title: title, qi: 0, score: 0, questions: [], answered: false };
    var grid = $("kind-games-grid");
    var play = $("kind-game-play");
    if (grid) grid.classList.add("hidden");
    if (play) {
      play.classList.remove("hidden");
      play.innerHTML = '<div class="loading">Loading questions…</div>';
    }
    try {
      var data = await api.api("/api/v1/kind/games/" + encodeURIComponent(gameId) + "/questions");
      var qs = (data && data.questions) || [];
      kindActiveGame.questions = qs.length
        ? qs.map(function (q) {
            return {
              prompt: q.prompt,
              options: q.options,
              correct: q.correct_index,
              speak_word: q.speak_word || null,
            };
          })
        : KIND_SAMPLE_QUESTIONS.slice();
    } catch (e) {
      kindActiveGame.questions = KIND_SAMPLE_QUESTIONS.slice();
    }
    showKindGameQuestion();
  }

  function showKindGameQuestion() {
    var play = $("kind-game-play");
    if (!play || !kindActiveGame) return;
    var qs = kindActiveGame.questions;
    if (kindActiveGame.qi >= qs.length) {
      finishKindGame();
      return;
    }
    if (kindActiveGame.answered) return;
    var q = qs[kindActiveGame.qi];
    var progress = Math.round(((kindActiveGame.qi + 1) / qs.length) * 100);
    play.innerHTML =
      '<div class="kind-game-play-area">' +
      '<div class="kind-game-play-head">' +
      "<strong>" +
      esc(kindActiveGame.title) +
      "</strong>" +
      "<span>Question " +
      (kindActiveGame.qi + 1) +
      " of " +
      qs.length +
      " · Score " +
      kindActiveGame.score +
      "</span></div>" +
      '<div class="kind-game-progress"><div class="kind-game-progress-fill" style="width:' +
      progress +
      '%"></div></div>' +
      '<div class="kind-game-prompt-card">' +
      '<p class="kind-game-prompt">' +
      esc(q.prompt) +
      "</p>" +
      '<button type="button" class="kind-hear-btn" id="kindHearBtn">🔊 Hear question</button>' +
      "</div>" +
      '<div class="kind-game-options">' +
      q.options
        .map(function (opt, i) {
          return (
            '<button type="button" class="kind-game-opt" data-pick="' +
            i +
            '" data-correct="' +
            q.correct +
            '">' +
            esc(opt) +
            "</button>"
          );
        })
        .join("") +
      "</div>" +
      '<button type="button" class="btn btn-secondary" style="margin-top:16px" id="kindExitGame">← Back to games</button></div>';
    setTimeout(function () {
      kindSpeakQuestion(q);
    }, 300);
  }

  function answerKindGame(picked, correct) {
    if (!kindActiveGame || kindActiveGame.answered) return;
    kindActiveGame.answered = true;
    var ok = picked === correct;
    if (ok) kindActiveGame.score += 1;
    var play = $("kind-game-play");
    if (!play) return;
    var q = kindActiveGame.questions[kindActiveGame.qi];
    var feedback = ok ? "🎉 Correct! Great job!" : "💡 Good try!";
    var optsHtml = q.options
      .map(function (opt, i) {
        var cls = "kind-game-opt";
        if (i === correct) cls += " kind-opt-correct";
        else if (i === picked && !ok) cls += " kind-opt-wrong";
        return (
          '<button type="button" class="' +
          cls +
          '" disabled>' +
          esc(opt) +
          "</button>"
        );
      })
      .join("");
    play.innerHTML =
      '<div class="kind-game-play-area">' +
      '<div class="kind-game-play-head"><strong>' +
      esc(kindActiveGame.title) +
      "</strong></div>" +
      '<div class="kind-game-prompt-card"><p class="kind-game-prompt">' +
      esc(q.prompt) +
      "</p></div>" +
      '<div class="kind-game-options">' +
      optsHtml +
      "</div>" +
      '<p class="kind-game-feedback' +
      (ok ? " ok" : "") +
      '">' +
      feedback +
      "</p>" +
      '<button type="button" class="btn btn-primary" id="kindNextGame">' +
      (kindActiveGame.qi + 1 >= kindActiveGame.questions.length ? "See my score" : "Next") +
      "</button></div>";
  }

  function nextKindGameQuestion() {
    if (!kindActiveGame) return;
    kindActiveGame.qi += 1;
    kindActiveGame.answered = false;
    showKindGameQuestion();
  }

  function finishKindGame() {
    var play = $("kind-game-play");
    if (!kindActiveGame || !play) return;
    var leaf = parseInt(localStorage.getItem("kind_leaf_" + kindActiveGame.id) || "1", 10);
    if (kindActiveGame.score >= Math.ceil(kindActiveGame.questions.length * 0.6)) {
      leaf = Math.min(30, leaf + 1);
      localStorage.setItem("kind_leaf_" + kindActiveGame.id, String(leaf));
    }
    play.innerHTML =
      '<div class="kind-game-play-area" style="text-align:center;padding:40px">' +
      '<div style="font-size:3.5rem">🌟</div>' +
      '<h2 style="color:#7c3aed;margin:16px 0 8px">Great job!</h2>' +
      "<p style=\"font-size:1.1rem;margin-bottom:8px\">Score: <strong>" +
      kindActiveGame.score +
      "/" +
      kindActiveGame.questions.length +
      "</strong></p>" +
      '<p style="color:#10b981;font-weight:700">🍃 Leaf level ' +
      leaf +
      "</p>" +
      '<button type="button" class="btn btn-primary" style="margin-top:20px" id="kindExitGame">Play more games</button></div>';
  }

  function exitKindGame() {
    try {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
    } catch (e) { /* ignore */ }
    kindActiveGame = null;
    var grid = $("kind-games-grid");
    var play = $("kind-game-play");
    if (grid) grid.classList.remove("hidden");
    if (play) {
      play.classList.add("hidden");
      play.innerHTML = "";
    }
    loadKindGames();
  }

  /* —— CBT —— */
  var CE_SUBJECTS = [
    "Mathematics / Quantitative Reasoning",
    "English Language / Verbal Reasoning",
    "General Knowledge",
  ];

  function exitCbtPlayer() {
    cbtState = { exam: null, session: null, answers: {}, index: 0, attemptId: null };
    if ($("cbtPlay")) {
      $("cbtPlay").hidden = true;
      $("cbtPlay").innerHTML = "";
    }
    if ($("cbtBrowse")) $("cbtBrowse").hidden = false;
    if ($("cbtPayCard")) $("cbtPayCard").style.display = "";
  }

  async function loadCbt() {
    exitCbtPlayer();
    var list = $("cbtExamList");
    var banner = $("cbtAccessBanner");
    var payCard = $("cbtPayCard");
    if (list) list.innerHTML = '<div class="loading">Loading exams…</div>';

    var hasAccess = false;
    try {
      var access = await api.api("/api/v1/payments/paystack/cbt-access");
      var boards = ((access && access.boards) || []).map(function (b) {
        return String(b).toUpperCase();
      });
      hasAccess = boards.indexOf("COMMON_ENTRANCE") >= 0;
    } catch (e) {
      hasAccess = false;
    }

    if (banner) {
      if (hasAccess) {
        banner.style.display = "";
        banner.className = "info-banner";
        banner.textContent = "Access active — Common Entrance unlocked";
      } else {
        banner.style.display = "none";
      }
    }
    if (payCard) payCard.style.display = hasAccess ? "none" : "";

    if (!list) return;
    list.innerHTML =
      '<article class="cbt-card"><strong>Common Entrance CBT</strong>' +
      '<p style="color:var(--muted);margin:0.4rem 0 0.85rem;font-weight:600">One combined exam · all 3 papers together (like JAMB)</p>' +
      '<ol style="margin:0 0 1rem;padding-left:1.2rem;color:var(--muted);font-weight:600">' +
      CE_SUBJECTS.map(function (s) {
        return "<li>" + esc(s) + "</li>";
      }).join("") +
      "</ol>" +
      (hasAccess
        ? ""
        : '<p style="margin:0 0 0.85rem;font-size:0.9rem;color:#065f46">Unlock with coupon or Paystack when you tap Start.</p>') +
      '<button type="button" class="btn btn-primary" data-start-ce="1">Start Common Entrance</button></article>';
  }

  async function payCbt() {
    try {
      var paid = await window.paystackPurchase({
        productType: "cbt_package",
        productId: "common_entrance",
        returnPage: "cbt",
      });
      if (paid) {
        alert("Payment successful! Common Entrance CBT is unlocked.");
        loadCbt();
      }
    } catch (e) {
      alert(e.message || "Could not start payment.");
    }
  }

  async function redeemCbtCoupon() {
    var status = $("cbtUnlockStatus");
    var code = (($("cbtCouponCode") && $("cbtCouponCode").value) || "").trim();
    if (!code) {
      if (status) {
        status.textContent = "Enter a coupon code.";
        status.className = "form-status err";
      }
      return;
    }
    var btn = $("cbtCouponBtn");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Redeeming…";
    }
    if (status) {
      status.textContent = "Redeeming…";
      status.className = "form-status";
    }
    try {
      var res = await api.api("/api/v1/cbt/coupons/redeem", {
        method: "POST",
        body: { code: code },
        timeout: 90000,
        retries: 2,
        preferXhr: true,
      });
      if (status) {
        status.textContent = "Coupon redeemed — Common Entrance unlocked.";
        status.className = "form-status ok";
      }
      if ($("cbtCouponCode")) $("cbtCouponCode").value = "";
      await loadCbt();
      return res;
    } catch (e) {
      if (status) {
        status.textContent = e.message || "Could not redeem coupon.";
        status.className = "form-status err";
      }
      throw e;
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Redeem coupon";
      }
    }
  }

  async function unlockCbtThen(run) {
    var payCard = $("cbtPayCard");
    if (payCard) {
      payCard.style.display = "";
      payCard.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    var status = $("cbtUnlockStatus");
    if (status) {
      status.textContent = "Unlock with a coupon or Paystack, then Start again.";
      status.className = "form-status err";
    }
    if (typeof run === "function") {
      /* caller retries after unlock via loadCbt Start button */
    }
  }

  function _optKey(opt, oi) {
    if (opt && typeof opt === "object") {
      if (opt.key != null) return String(opt.key);
      if (opt.id != null) return String(opt.id);
    }
    return String.fromCharCode(65 + oi);
  }

  function _optText(opt) {
    if (opt && typeof opt === "object") return opt.text || opt.label || opt.value || "";
    return opt;
  }

  async function startCombinedCe(btn) {
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Starting…";
    }
    try {
      var attempt = await api.api("/api/v1/cbt/practice/start", {
        method: "POST",
        body: { exam_type: "COMMON_ENTRANCE", subjects: CE_SUBJECTS.slice() },
        timeout: 55000,
        retries: 0,
      });
      var attemptId = attempt && attempt.attempt_id;
      if (!attemptId) throw new Error("Could not start Common Entrance CBT.");
      var sections = attempt.sections || [];
      var allQs = [];
      for (var i = 0; i < sections.length; i++) {
        var sec = sections[i];
        if (!sec || !(sec.questions && sec.questions.length)) {
          sec = await api.api(
            "/api/v1/cbt/practice/attempts/" +
              encodeURIComponent(attemptId) +
              "/sections/" +
              i,
            { timeout: 55000, retries: 0 }
          );
        }
        (sec.questions || []).forEach(function (q) {
          allQs.push({
            id: q.id,
            question: q.question_text || q.question || q.prompt,
            options: (q.options || []).map(function (opt, oi) {
              return { id: _optKey(opt, oi), text: _optText(opt) };
            }),
            subject: sec.subject,
          });
        });
      }
      if (!allQs.length) {
        throw new Error(
          "No questions in the bank yet. Ask admin to upload COMMON_ENTRANCE practice papers for the 3 subjects."
        );
      }
      cbtState.exam = {
        title: "Common Entrance CBT",
        questions: allQs,
      };
      cbtState.session = { attempt_id: attemptId };
      cbtState.attemptId = attemptId;
      cbtState.answers = {};
      cbtState.index = 0;
      renderCbtPlayer();
    } catch (e) {
      var msg = e.message || "Could not start exam.";
      if (/402|cbt_package|package|paid|required/i.test(msg) || (e.status === 402)) {
        await unlockCbtThen();
      } else {
        alert(msg);
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Start Common Entrance";
      }
    }
  }

  async function startCbt(examId, btn) {
    if (!examId) return;
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Starting…";
    }
    try {
      var session = await api.api("/api/v1/cbt/sessions/" + encodeURIComponent(examId) + "/start", {
        method: "POST",
      });
      var pack = await api.api("/api/v1/cbt/exams/" + encodeURIComponent(examId) + "/download");
      if (!pack || !pack.questions || !pack.questions.length) {
        throw new Error("This exam has no questions yet.");
      }
      cbtState.exam = pack;
      cbtState.session = session;
      cbtState.attemptId = null;
      cbtState.answers = {};
      cbtState.index = 0;
      renderCbtPlayer();
    } catch (e) {
      var msg = e.message || "Could not start exam.";
      if (/402|cbt_package|package|paid|required/i.test(msg)) {
        await unlockCbtThen();
      } else {
        alert(msg);
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Start practice";
      }
    }
  }

  function renderCbtPlayer() {
    var play = $("cbtPlay");
    if (!play || !cbtState.exam) return;
    if ($("cbtBrowse")) $("cbtBrowse").hidden = true;
    if ($("cbtPayCard")) $("cbtPayCard").style.display = "none";
    if ($("cbtAccessBanner")) $("cbtAccessBanner").style.display = "none";
    play.hidden = false;

    var qs = cbtState.exam.questions || [];
    var i = cbtState.index;
    var q = qs[i] || {};
    var opts = q.options || q.choices || [];
    if (!Array.isArray(opts) && typeof opts === "object") {
      opts = Object.keys(opts).map(function (k) {
        return { id: k, text: opts[k] };
      });
    }
    var qid = String(q.id != null ? q.id : i);
    var selected = cbtState.answers[qid];

    play.innerHTML =
      '<div class="cbt-play-head"><strong>' +
      esc(cbtState.exam.title || "Common Entrance") +
      "</strong><span>Question " +
      (i + 1) +
      " / " +
      qs.length +
      '</span></div><div class="cbt-q">' +
      esc(q.question || q.text || q.prompt || "Question") +
      '</div><div class="cbt-opts">' +
      opts
        .map(function (opt, oi) {
          var val = _optText(opt);
          var key = _optKey(opt, oi);
          var on = String(selected) === key || String(selected) === String(val);
          return (
            '<button type="button" class="cbt-opt' +
            (on ? " is-on" : "") +
            '" data-cbt-opt="' +
            esc(key) +
            '">' +
            esc(String(val)) +
            "</button>"
          );
        })
        .join("") +
      '</div><div class="cbt-nav">' +
      '<button type="button" class="btn btn-mini" id="cbtPrev"' +
      (i === 0 ? " disabled" : "") +
      ">Previous</button>" +
      (i < qs.length - 1
        ? '<button type="button" class="btn btn-primary" id="cbtNext">Next</button>'
        : '<button type="button" class="btn btn-primary" id="cbtSubmit">Submit</button>') +
      "</div>";

    play.querySelectorAll("[data-cbt-opt]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        cbtState.answers[qid] = btn.getAttribute("data-cbt-opt");
        renderCbtPlayer();
      });
    });
    if ($("cbtPrev")) {
      $("cbtPrev").onclick = function () {
        if (cbtState.index > 0) {
          cbtState.index -= 1;
          renderCbtPlayer();
        }
      };
    }
    if ($("cbtNext")) {
      $("cbtNext").onclick = function () {
        cbtState.index += 1;
        renderCbtPlayer();
      };
    }
    if ($("cbtSubmit")) {
      $("cbtSubmit").onclick = submitCbt;
    }
    updateBackBtn();
  }

  async function submitCbt() {
    try {
      var attemptId = cbtState.attemptId || (cbtState.session && cbtState.session.attempt_id);
      var result;
      if (attemptId) {
        result = await api.api(
          "/api/v1/cbt/practice/attempts/" + encodeURIComponent(attemptId) + "/submit",
          { method: "POST", body: { answers: cbtState.answers } }
        );
      } else {
        var sessionId =
          (cbtState.session && (cbtState.session.id || cbtState.session.session_id)) || "";
        result = await api.api("/api/v1/cbt/sessions/submit", {
          method: "POST",
          body: { answers: cbtState.answers, session_id: sessionId },
        });
      }
      var score =
        result &&
        (result.percent != null
          ? result.percent
          : result.score != null
            ? result.score
            : result.percentage);
      alert(
        score != null
          ? "Great job! Score: " + score + (String(score).indexOf("%") >= 0 ? "" : "%")
          : "Answers submitted. Well done!"
      );
      exitCbtPlayer();
      loadCbt();
    } catch (e) {
      alert(e.message || "Could not submit. Try again.");
    }
  }

  /* —— Profile —— */
  async function loadProfile() {
    var user = api.getUser();
    setUserChip(user.name, user.ageGroup);
    if ($("profileText")) {
      $("profileText").textContent =
        (user.name || "Friend") +
        " · " +
        (user.email || "") +
        " · Kid" +
        (user.ageGroup ? " · Ages " + user.ageGroup : "");
    }
    try {
      var me = await api.api("/api/v1/kind/me");
      if (me) {
        setUserChip(me.full_name || user.name, me.age_group || user.ageGroup);
        if ($("profileText")) {
          $("profileText").textContent =
            (me.full_name || user.name) +
            " · " +
            (me.email || user.email) +
            " · Kid" +
            (me.age_group ? " · Ages " + me.age_group : "");
        }
      }
    } catch (e) {
      /* keep session data */
    }
  }

  /* —— Events (delegated so all tabs / tiles always work) —— */
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (!t || !t.closest) return;

    var navBtn = t.closest(".kind-nav-btn, [data-page]");
    if (navBtn && navBtn.getAttribute("data-page")) {
      e.preventDefault();
      e.stopPropagation();
      showPage(navBtn.getAttribute("data-page"));
      return;
    }

    var goto = t.closest("[data-goto]");
    if (goto && goto.getAttribute("data-goto")) {
      e.preventDefault();
      e.stopPropagation();
      showPage(goto.getAttribute("data-goto"));
      return;
    }

    var gameCard = t.closest(".kind-game-card[data-game-id]");
    if (gameCard) {
      e.preventDefault();
      startKindGame(gameCard.getAttribute("data-game-id"), gameCard.getAttribute("data-game-title") || "Game");
      return;
    }

    if (t.closest("#kindHearBtn") && kindActiveGame) {
      e.preventDefault();
      kindSpeakQuestion(kindActiveGame.questions[kindActiveGame.qi]);
      return;
    }

    var opt = t.closest(".kind-game-opt[data-pick]");
    if (opt && !opt.disabled) {
      e.preventDefault();
      answerKindGame(parseInt(opt.getAttribute("data-pick"), 10), parseInt(opt.getAttribute("data-correct"), 10));
      return;
    }

    if (t.closest("#kindNextGame")) {
      e.preventDefault();
      nextKindGameQuestion();
      return;
    }

    if (t.closest("#kindExitGame")) {
      e.preventDefault();
      exitKindGame();
      return;
    }

    var join = t.closest("[data-join-live]");
    if (join) {
      e.preventDefault();
      joinLive(join.getAttribute("data-join-live"));
      return;
    }

    var startCe = t.closest("[data-start-ce]");
    if (startCe) {
      e.preventDefault();
      startCombinedCe(startCe);
      return;
    }

    var start = t.closest("[data-start-cbt]");
    if (start) {
      e.preventDefault();
      startCbt(start.getAttribute("data-start-cbt"), start);
      return;
    }

    var openBook = t.closest("[data-open-book]");
    if (openBook) {
      e.preventDefault();
      openKindBook(openBook.getAttribute("data-open-book"), openBook);
      return;
    }

    var payBook = t.closest("[data-pay-book]");
    if (payBook) {
      e.preventDefault();
      openKindBook(payBook.getAttribute("data-pay-book"), payBook);
    }
  });

  if ($("logoutBtn")) {
    $("logoutBtn").addEventListener("click", function (e) {
      e.preventDefault();
      try {
        api.clearSession();
      } catch (err) {}
      window.location.replace("portal.html?force=1&reason=logout");
    });
  }

  if ($("siaForm")) {
    $("siaForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var input = $("siaInput");
      var text = (input && input.value.trim()) || "";
      if (!text) return;
      if (input) input.value = "";
      sendSia(text);
    });
  }

  document.querySelectorAll("[data-sia-q]").forEach(function (chip) {
    chip.addEventListener("click", function () {
      sendSia(chip.getAttribute("data-sia-q"));
    });
  });

  if ($("refreshLiveBtn")) $("refreshLiveBtn").addEventListener("click", loadLive);
  if ($("bookPayBtn")) $("bookPayBtn").addEventListener("click", bookClass);
  if ($("cbtPayBtn")) $("cbtPayBtn").addEventListener("click", payCbt);
  if ($("cbtCouponBtn")) $("cbtCouponBtn").addEventListener("click", function () {
    redeemCbtCoupon().catch(function () {});
  });
  if ($("kindLibrarySearch")) $("kindLibrarySearch").addEventListener("input", filterKindLibrary);
  if ($("kindLibraryRefresh")) $("kindLibraryRefresh").addEventListener("click", loadKindLibrary);
  if ($("kindVideosSearch")) $("kindVideosSearch").addEventListener("input", filterKindVideos);
  if ($("kindVideosRefresh")) $("kindVideosRefresh").addEventListener("click", loadKindVideos);

  if ($("mobileMenuBtn")) {
    $("mobileMenuBtn").addEventListener("click", function () {
      if (document.body.classList.contains("nav-open")) closeMobileNav();
      else openMobileNav();
    });
  }
  if ($("sidebarBackdrop")) {
    $("sidebarBackdrop").addEventListener("click", closeMobileNav);
  }
  if ($("sidebarCloseBtn")) {
    $("sidebarCloseBtn").addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (window.matchMedia("(max-width: 900px)").matches) {
        closeMobileNav();
      } else if (shell) {
        shell.classList.add("sidebar-collapsed");
        if ($("sidebarToggle")) {
          $("sidebarToggle").textContent = "›";
          $("sidebarToggle").setAttribute("aria-label", "Show menu");
        }
      }
    });
  }
  if ($("sidebarToggle")) {
    $("sidebarToggle").addEventListener("click", function () {
      if (!shell) return;
      var collapsed = !shell.classList.contains("sidebar-collapsed");
      shell.classList.toggle("sidebar-collapsed", collapsed);
      $("sidebarToggle").textContent = collapsed ? "›" : "‹";
      $("sidebarToggle").setAttribute("aria-label", collapsed ? "Show menu" : "Hide menu");
    });
  }
  if ($("backBtn")) $("backBtn").addEventListener("click", goBack);

  /* boot */
  var user = api.getUser();
  setUserChip(user.name, user.ageGroup);

  if (typeof window.resumePendingPaystack === "function") {
    window.resumePendingPaystack().then(function (res) {
      if (!res) return;
      var page = (res.pending && res.pending.returnPage) || "home";
      if (res.paid) {
        alert("Payment confirmed!");
        showPage(TITLES[page] ? page : "home", { replace: true });
      } else if (res.error) {
        alert((res.error && res.error.message) || "Payment could not be verified.");
      }
    });
  }

  var hash = (location.hash || "").replace("#", "");
  showPage(TITLES[hash] ? hash : "home", { replace: true });
})();
