/* Scholaxia — in-class subject & language keyboard.
 *
 * A floating panel that lives INSIDE the live class (no pop-up window, so it
 * works on phones, tablets and the desktop app). Teachers tap keys for Maths,
 * Physics, Chemistry, Igbo, Hausa and Yoruba; the text can be copied straight
 * into plugNmeet chat/whiteboard, or sent to the class chat / whiteboard here.
 *
 * Exposes window.SXClassKeyboard = { open, close, toggle, isOpen }.
 */
(function () {
  "use strict";

  if (window.SXClassKeyboard) return;

  /* ── Character sets ────────────────────────────────────────────────
     Each key is either a string (inserted as-is) or {label, ins}.        */
  var SETS = [
    {
      id: "maths",
      title: "Maths",
      rows: [
        ["√", "π", "∑", "∏", "∫", "∞", "∂", "∇", "Δ", "θ", "α", "β", "γ", "λ", "μ", "ω"],
        ["≈", "≠", "≤", "≥", "±", "×", "÷", "…", "%", "∝", "ℝ", "ℕ", "ℤ"],
        ["→", "⇒", "⇔", "↔", "∈", "∉", "∅", "⊂", "∪", "∩", "∀", "∃", "∴", "∵"],
        [{ label: "x²", ins: "x²" }, { label: "x³", ins: "x³" }, { label: "xⁿ", ins: "xⁿ" },
         { label: "y=mx+c", ins: "y = mx + c" }, { label: "x = ", ins: "x = " },
         { label: "f(x)", ins: "f(x)" }, { label: "dy/dx", ins: "dy/dx" },
         { label: "sin", ins: "sin" }, { label: "cos", ins: "cos" }, { label: "tan", ins: "tan" },
         { label: "log", ins: "log" }, { label: "ln", ins: "ln" }, { label: "lim", ins: "lim" }],
        ["²", "³", "ⁿ", "⁻", "⁺", "½", "⅓", "¼", "¾", "⅔", "⁄", "°", "′", "″", "∠", "⌲"],
        ["7", "8", "9", "4", "5", "6", "1", "2", "3", "0", ".", ","],
        ["+", "−", "=", "<", ">", "(", ")", "[", "]", "{", "}", ":"]
      ]
    },
    {
      id: "physics",
      title: "Physics",
      rows: [
        ["Δ", "∇", "∂", "∞", "≈", "≠", "±", "≤", "≥", "×", "÷", "∝", "→", "↑", "↓"],
        ["λ", "ν", "ħ", "Ω", "φ", "ψ", "θ", "ω", "α", "β", "γ", "μ", "ρ", "ε", "σ"],
        [{ label: "×10ⁿ", ins: "×10" }, { label: "ε₀", ins: "ε₀" }, { label: "μ₀", ins: "μ₀" },
         { label: "v₀", ins: "v₀" }, { label: "x₀", ins: "x₀" }, { label: "t₀", ins: "t₀" },
         { label: "E₀", ins: "E₀" }, { label: "B₀", ins: "B₀" }, { label: "q₀", ins: "q₀" }],
        [{ label: "F = ma", ins: "F = ma" }, { label: "V = IR", ins: "V = IR" },
         { label: "P = IV", ins: "P = IV" }, { label: "E = mc²", ins: "E = mc²" },
         { label: "v²=u²+2as", ins: "v² = u² + 2as" }, { label: "W = Fd", ins: "W = Fd" },
         { label: "p = mv", ins: "p = mv" }, { label: "KE", ins: "KE" }, { label: "PE", ins: "PE" }],
        ["kg", "m/s", "m/s²", "N", "J", "W", "Hz", "eV", "Ω", "Pa", "kWh", "mol", "C", "T", "F"],
        ["₀", "₁", "₂", "₃", "₄", "₅", "₆", "₇", "₈", "₉", "⁰", "¹", "²", "³", "⁴", "⁵", "⁶", "⁷", "⁸", "⁹", "⁻", "⁺"],
        ["7", "8", "9", "4", "5", "6", "1", "2", "3", "0", ".", ",", "=", "×", "÷", "(", ")"]
      ]
    },
    {
      id: "chemistry",
      title: "Chemistry",
      rows: [
        [{ label: "H₂O", ins: "H₂O" }, { label: "CO₂", ins: "CO₂" }, { label: "O₂", ins: "O₂" },
         { label: "H₂", ins: "H₂" }, { label: "H₂SO₄", ins: "H₂SO₄" }, { label: "CH₄", ins: "CH₄" },
         { label: "NH₃", ins: "NH₃" }, { label: "HCl", ins: "HCl" }, { label: "NaCl", ins: "NaCl" },
         { label: "NaOH", ins: "NaOH" }, { label: "SO₂", ins: "SO₂" }, { label: "CO", ins: "CO" }],
        ["₀", "₁", "₂", "₃", "₄", "₅", "₆", "₇", "₈", "₉", "⁰", "¹", "²", "³", "⁴", "⁵", "⁶", "⁷", "⁸", "⁹"],
        ["→", "⇌", "⇄", "↔", "↑", "↓", "Δ", "e⁻", "⁺", "⁻", "·H₂O", "°C", "℃", "mol", "M", "aq"],
        ["H", "C", "N", "O", "Na", "Cl", "S", "Fe", "Cu", "Zn", "Ca", "Mg", "K", "Al", "Ag", "Pb"],
        [{ label: "(s)", ins: "(s)" }, { label: "(l)", ins: "(l)" }, { label: "(g)", ins: "(g)" },
         { label: "(aq)", ins: "(aq)" }, { label: "pH", ins: "pH" }, { label: "ΔH", ins: "ΔH" },
         { label: "ΔG", ins: "ΔG" }, { label: "Ksp", ins: "Ksp" }],
        ["7", "8", "9", "4", "5", "6", "1", "2", "3", "0", ".", ",", "=", "+", "−", "(", ")", "[", "]"]
      ]
    },
    {
      id: "igbo",
      title: "Igbo",
      rows: [
        ["ị", "Ị", "ọ", "Ọ", "ụ", "Ụ", "ṅ", "Ṅ", "a", "A", "e", "E", "i", "I", "o", "O", "u", "U"],
        ["á", "à", "é", "è", "í", "ì", "ó", "ò", "ú", "ù"],
        ["ị́", "ị̀", "ọ́", "ọ̀", "ụ́", "ụ̀", "Á", "À", "É", "È", "Í", "Ì", "Ó", "Ò", "Ú", "Ù"],
        [{ label: "gb", ins: "gb" }, { label: "GB", ins: "GB" }, { label: "kp", ins: "kp" },
         { label: "KP", ins: "KP" }, { label: "ch", ins: "ch" }, { label: "CH", ins: "CH" },
         { label: "sh", ins: "sh" }, { label: "SH", ins: "SH" }, { label: "nw", ins: "nw" },
         { label: "NW", ins: "NW" }, { label: "ny", ins: "ny" }, { label: "NY", ins: "NY" },
         { label: "gw", ins: "gw" }, { label: "gh", ins: "gh" }, { label: "kw", ins: "kw" }],
        [{ label: "kedu", ins: "Kedu" }, { label: "biko", ins: "Biko" },
         { label: "daalụ", ins: "Daalụ" }, { label: "nno", ins: "Nno" },
         { label: "ọ dị mma", ins: "Ọ dị mma" }, { label: "sị", ins: "sị" }],
        ["a", "b", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "r", "s", "t", "u", "v", "w", "y", "z", "?"]
      ]
    },
    {
      id: "hausa",
      title: "Hausa",
      rows: [
        ["ɓ", "Ɓ", "ɗ", "Ɗ", "ƙ", "Ƙ", "ʼ", "a", "A", "b", "B", "c", "C", "d", "D", "e", "E"],
        [{ label: "ʼy", ins: "ʼy" }, { label: "ʼY", ins: "ʼY" }, { label: "ʼn", ins: "ʼn" },
         { label: "ʼs", ins: "ʼs" }, { label: "ʼt", ins: "ʼt" }, { label: "sh", ins: "sh" },
         { label: "Sh", ins: "Sh" }, { label: "ts", ins: "ts" }, { label: "Ts", ins: "Ts" },
         { label: "gw", ins: "gw" }, { label: "kw", ins: "kw" }],
        ["á", "à", "é", "è", "í", "ì", "ó", "ò", "ú", "ù", "ā", "ē", "ī", "ō", "ū"],
        ["Á", "À", "É", "È", "Í", "Ì", "Ó", "Ò", "Ú", "Ù", "Ā", "Ē", "Ī", "Ō", "Ū"],
        [{ label: "sannu", ins: "Sannu" }, { label: "na gode", ins: "Na gode" },
         { label: "don Allah", ins: "Don Allah" }, { label: "yaya", ins: "Yaya" }],
        ["f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "r", "s", "t", "u", "w", "y", "z", "?"]
      ]
    },
    {
      id: "yoruba",
      title: "Yoruba",
      rows: [
        ["ẹ", "Ẹ", "ọ", "Ọ", "ṣ", "Ṣ", "ń", "ḿ", "m̀", "a", "A", "b", "B", "d", "D", "e", "E"],
        ["á", "à", "é", "è", "í", "ì", "ó", "ò", "ú", "ù", "ā", "ē", "ī", "ō", "ū"],
        ["ẹ́", "ẹ̀", "ẹ̄", "ọ́", "ọ̀", "ọ̄", "Á", "À", "É", "È", "Ẹ́", "Ẹ̀", "Ọ́", "Ọ̀"],
        [{ label: "gb", ins: "gb" }, { label: "GB", ins: "GB" }, { label: "gbà", ins: "gbà" },
         { label: "jọ̀wọ́", ins: "Jọ̀wọ́" }, { label: "ẹ jọ", ins: "Ẹ jọ" },
         { label: "o ṣe", ins: "O ṣe" }, { label: "bawo", ins: "Bawo" }],
        ["f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "r", "s", "t", "u", "w", "y", "?"]
      ]
    }
  ];

  var STYLE_ID = "sx-kb-style";
  var PANEL_ID = "sx-class-keyboard";
  var current = "maths";
  var built = false;
  var panel = null;
  var out = null;

  var CSS = ""
    + "#" + PANEL_ID + "{position:fixed;right:14px;bottom:78px;z-index:2147483000;"
    + "width:min(420px,calc(100vw - 24px));max-height:min(68vh,600px);display:flex;"
    + "flex-direction:column;background:#120c20;color:#f3e8ff;border:1px solid #6d28d9;"
    + "border-radius:14px;box-shadow:0 18px 48px rgba(0,0,0,.55);overflow:hidden;"
    + "font-family:'Segoe UI','Noto Sans',Arial,sans-serif;}"
    + "#" + PANEL_ID + ".hidden{display:none;}"
    + "#" + PANEL_ID + " .sxkb-head{display:flex;align-items:center;gap:8px;padding:8px 10px;"
    + "background:#1a1228;border-bottom:1px solid #3b2a5c;font-size:.82rem;font-weight:700;}"
    + "#" + PANEL_ID + " .sxkb-head span{flex:1 1 auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}"
    + "#" + PANEL_ID + " .sxkb-x{appearance:none;border:0;background:none;color:#c4b5fd;"
    + "font-size:1rem;line-height:1;cursor:pointer;padding:2px 6px;border-radius:6px;}"
    + "#" + PANEL_ID + " .sxkb-x:hover{background:#2a1c40;color:#fff;}"
    + "#" + PANEL_ID + " .sxkb-tabs{display:flex;gap:6px;padding:7px 10px;overflow-x:auto;"
    + "scrollbar-width:thin;border-bottom:1px solid #26183a;}"
    + "#" + PANEL_ID + " .sxkb-tab{appearance:none;flex:0 0 auto;border:1px solid #3b2a5c;"
    + "background:#1a1228;color:#c4b5fd;font:700 .72rem/1 inherit;padding:6px 10px;"
    + "border-radius:999px;cursor:pointer;}"
    + "#" + PANEL_ID + " .sxkb-tab.is-active{background:#6d28d9;border-color:#8b5cf6;color:#fff;}"
    + "#" + PANEL_ID + " .sxkb-buf{padding:7px 10px 3px;}"
    + "#" + PANEL_ID + " #sxkb-out{width:100%;min-height:52px;max-height:110px;resize:vertical;"
    + "border:1px solid #3b2a5c;border-radius:9px;background:#0d0a17;color:#f3e8ff;"
    + "font:400 .95rem/1.4 inherit;padding:7px 9px;outline:none;}"
    + "#" + PANEL_ID + " #sxkb-out:focus{border-color:#8b5cf6;}"
    + "#" + PANEL_ID + " .sxkb-keys{flex:1 1 auto;overflow-y:auto;padding:5px 10px 8px;"
    + "display:flex;flex-direction:column;gap:5px;min-height:96px;}"
    + "#" + PANEL_ID + " .sxkb-row{display:flex;flex-wrap:wrap;gap:5px;}"
    + "#" + PANEL_ID + " .sxkb-key{appearance:none;min-width:32px;min-height:32px;border:1px solid #3b2a5c;"
    + "border-radius:8px;background:#1a1228;color:#f3e8ff;font:600 .95rem/1.2 inherit;"
    + "padding:4px 7px;cursor:pointer;}"
    + "#" + PANEL_ID + " .sxkb-key:hover{background:#231736;border-color:#8b5cf6;}"
    + "#" + PANEL_ID + " .sxkb-key:active{transform:scale(.94);background:#6d28d9;}"
    + "#" + PANEL_ID + " .sxkb-key.is-word{font:500 .78rem/1.2 inherit;color:#ddd6fe;}"
    + "#" + PANEL_ID + " .sxkb-foot{display:flex;flex-wrap:wrap;gap:6px;padding:8px 10px;"
    + "border-top:1px solid #3b2a5c;background:#160f26;}"
    + "#" + PANEL_ID + " .sxkb-foot .sxkb-key{flex:1 1 auto;font-size:.78rem;}"
    + "#" + PANEL_ID + " .sxkb-foot .sxkb-key.primary{background:#6d28d9;border-color:#8b5cf6;color:#fff;}"
    + "#" + PANEL_ID + " .sxkb-foot .sxkb-key.primary:active{background:#8b5cf6;}"
    + "#" + PANEL_ID + " .sxkb-foot .sxkb-key.ok{background:#16a34a;border-color:#22c55e;color:#fff;}"
    + "@media (max-width:520px){#" + PANEL_ID + "{right:0;left:0;bottom:0;width:100%;"
    + "max-height:74vh;border-radius:14px 14px 0 0;border-left:0;border-right:0;border-bottom:0;}"
    + "#" + PANEL_ID + " .sxkb-key{min-width:30px;min-height:30px;font-size:.9rem;padding:3px 6px;}}";

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function focusTarget() {
    return out;
  }

  function insertAtCaret(text) {
    var input = focusTarget();
    if (!input) return;
    var start = typeof input.selectionStart === "number" ? input.selectionStart : input.value.length;
    var end = typeof input.selectionEnd === "number" ? input.selectionEnd : start;
    if (typeof input.setRangeText === "function") {
      input.setRangeText(text, start, end, "end");
    } else {
      input.value = input.value.slice(0, start) + text + input.value.slice(end);
    }
    input.focus();
    try { input.dispatchEvent(new Event("input", { bubbles: true })); } catch (e) {}
  }

  function backspace() {
    var input = focusTarget();
    if (!input) return;
    var s = input.selectionStart, e = input.selectionEnd;
    if (typeof s !== "number") { input.value = input.value.slice(0, -1); input.focus(); return; }
    if (s === e) s = Math.max(0, s - 1);
    if (typeof input.setRangeText === "function") input.setRangeText("", s, e, "end");
    else input.value = input.value.slice(0, s) + input.value.slice(e);
    input.selectionStart = input.selectionEnd = s;
    input.focus();
  }

  function copyText(text) {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function () { legacyCopy(text); });
      return;
    }
    legacyCopy(text);
  }

  function legacyCopy(text) {
    var t = document.createElement("textarea");
    t.value = text;
    t.style.position = "fixed";
    t.style.opacity = "0";
    document.body.appendChild(t);
    t.select();
    try { document.execCommand("copy"); } catch (e) {}
    t.remove();
  }

  function appendToInput(input, text) {
    if (!input) return false;
    input.focus();
    input.value = (input.value ? input.value + text : text);
    try { input.dispatchEvent(new Event("input", { bubbles: true })); } catch (e) {}
    return true;
  }

  // When the panel runs INSIDE plugNmeet (desktop injection or the bookmarklet)
  // an adapter registers itself here and types into the field the teacher was
  // last using — chat, whiteboard note, rename boxes… — so nothing to paste.
  function hostInsert(text) {
    var host = window.SXClassKeyboardHost;
    if (!host || typeof host.insert !== "function") return false;
    try { return host.insert(text) === true; } catch (e) { return false; }
  }

  function toChat() {
    var text = out && out.value ? out.value : "";
    if (!text) { flash("Type something first"); return; }
    if (hostInsert(text)) {
      out.value = "";
      flash("Typed into the class");
      return;
    }
    var chatInput = document.getElementById("chat-input");
    if (!chatInput) { copyText(text); flash("Copied — paste in chat"); return; }
    appendToInput(chatInput, text);
    out.value = "";
    flash("Added to chat box");
  }

  function toBoard() {
    var text = out && out.value ? out.value : "";
    if (!text) { flash("Type something first"); return; }
    var overlay = document.getElementById("board-overlay");
    if (overlay && overlay.classList.contains("hidden") && typeof window.toggleBoard === "function") {
      window.toggleBoard(true);
    }
    if (typeof window.setBoardTool === "function") window.setBoardTool("type");
    var boardInput = document.getElementById("board-type-input");
    if (!boardInput) { copyText(text); flash("Copied — paste on the board"); return; }
    appendToInput(boardInput, text);
    if (typeof window.onBoardTypeInput === "function") {
      try { window.onBoardTypeInput(); } catch (e) {}
    }
    out.value = "";
    flash("Added to board");
  }

  function flash(msg) {
    if (!built || !panel) return;
    var note = panel.querySelector(".sxkb-note");
    if (!note) return;
    note.textContent = msg;
    note.classList.remove("hidden");
    clearTimeout(flash._t);
    flash._t = setTimeout(function () { note.classList.add("hidden"); }, 1600);
  }

  function renderKeys() {
    var holder = panel.querySelector(".sxkb-keys");
    holder.textContent = "";
    var set = null;
    for (var i = 0; i < SETS.length; i++) { if (SETS[i].id === current) { set = SETS[i]; break; } }
    if (!set) set = SETS[0];
    set.rows.forEach(function (row) {
      var rowEl = el("div", "sxkb-row");
      row.forEach(function (key) {
        var isObj = key && typeof key === "object";
        var label = isObj ? key.label : key;
        var ins = isObj ? key.ins : key;
        var btn = el("button", "sxkb-key", String(label));
        btn.type = "button";
        if (String(label).length > 2) btn.classList.add("is-word");
        btn.title = ins;
        btn.addEventListener("click", function () {
          insertAtCaret(ins);
        });
        rowEl.appendChild(btn);
      });
      holder.appendChild(rowEl);
    });
  }

  function markTabs() {
    var tabs = panel.querySelectorAll(".sxkb-tab");
    Array.prototype.forEach.call(tabs, function (b) {
      b.classList.toggle("is-active", b.getAttribute("data-set") === current);
    });
  }

  function openWindowKeyboard() {
    // Desktop app: use its floating keyboard window (it stays above the
    // plugNmeet room). Browser: a small separate window next to plugNmeet.
    if (window.scholaxiaDesktop && typeof window.scholaxiaDesktop.openClassroomKeyboard === "function") {
      try { window.scholaxiaDesktop.openClassroomKeyboard(); return; } catch (e) { /* fall through */ }
    }
    var url = "keyboard.html?embed=1";
    var w = window.open(url, "sxClassKeyboard",
      "width=440,height=672,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes");
    if (w) { try { w.focus(); } catch (e) {} }
    else flash("Allow pop-ups to open the window");
  }

  function build() {
    if (built) return;
    injectStyle();

    panel = el("div", "");
    panel.id = PANEL_ID;
    panel.className = "hidden";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Class keyboard");

    var head = el("div", "sxkb-head");
    head.appendChild(el("span", "", "⌨ Class keyboard — maths, science & languages"));
    var x = el("button", "sxkb-x", "✕");
    x.type = "button";
    x.setAttribute("aria-label", "Close keyboard");
    x.addEventListener("click", function () { close(); });
    head.appendChild(x);
    panel.appendChild(head);

    var tabs = el("div", "sxkb-tabs");
    tabs.setAttribute("role", "tablist");
    SETS.forEach(function (set) {
      var b = el("button", "sxkb-tab", set.title);
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("data-set", set.id);
      b.addEventListener("click", function () {
        current = set.id;
        markTabs();
        renderKeys();
        try { localStorage.setItem("sia_kb_set", current); } catch (e) {}
        if (out) out.focus();
      });
      tabs.appendChild(b);
    });
    panel.appendChild(tabs);

    var buf = el("div", "sxkb-buf");
    out = document.createElement("textarea");
    out.id = "sxkb-out";
    out.rows = 2;
    out.spellcheck = false;
    out.setAttribute("placeholder", "Tap keys — then Copy, send to chat, or write on the board…");
    out.setAttribute("aria-label", "Keyboard output");
    buf.appendChild(out);
    panel.appendChild(buf);

    var note = el("p", "sxkb-note hidden");
    note.style.cssText = "margin:0 10px 4px;font-size:.72rem;color:#86efac;";
    panel.appendChild(note);

    var keys = el("div", "sxkb-keys");
    panel.appendChild(keys);

    var foot = el("div", "sxkb-foot");
    var mk = function (label, cls, handler, title) {
      var b = el("button", "sxkb-key" + (cls ? " " + cls : ""), label);
      b.type = "button";
      if (title) b.title = title;
      b.addEventListener("click", handler);
      return b;
    };
    foot.appendChild(mk("⌫", "", backspace, "Delete last character"));
    foot.appendChild(mk("Clear", "", function () {
      if (out) { out.value = ""; out.focus(); }
    }, "Clear the box"));
    foot.appendChild(mk("Copy", "ok", function () {
      copyText(out ? out.value : "");
      flash("Copied — paste into plugNmeet");
    }, "Copy everything"));
    foot.appendChild(mk("To chat", "", toChat, "Add to the class chat box"));
    foot.appendChild(mk("To board", "", toBoard, "Write on the whiteboard"));
    foot.appendChild(mk("↗", "primary", openWindowKeyboard, "Open in its own window (for plugNmeet)"));
    panel.appendChild(foot);

    document.body.appendChild(panel);

    try {
      var saved = localStorage.getItem("sia_kb_set");
      var known = SETS.some(function (s) { return s.id === saved; });
      if (known) current = saved;
    } catch (e) {}

    markTabs();
    renderKeys();
    built = true;

    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && panel && !panel.classList.contains("hidden")) close();
    });
  }

  function open() {
    build();
    panel.classList.remove("hidden");
    markTabs();
    renderKeys();
    if (out) { try { out.focus(); } catch (e) {} }
  }

  function close() {
    if (panel) panel.classList.add("hidden");
  }

  function toggle(force) {
    var shouldOpen = typeof force === "boolean" ? force : !isOpen();
    if (shouldOpen) open(); else close();
  }

  function isOpen() {
    return !!(panel && !panel.classList.contains("hidden"));
  }

  window.SXClassKeyboard = { open: open, close: close, toggle: toggle, isOpen: isOpen };
})();
