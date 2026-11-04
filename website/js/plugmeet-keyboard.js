/* Scholaxia — class keyboard INSIDE plugNmeet.
 *
 * plugNmeet is a third-party page, so Scholaxia's own screens cannot add a
 * button to it. This adapter is loaded INTO that page instead:
 *   • desktop app — main.js injects it into the live-class window automatically;
 *   • browser — the bookmarklet on keyboard.html injects it with one click.
 *
 * Once loaded it shows the same subject/language panel (class-keyboard.js) and
 * teaches it to type into whatever plugNmeet field the teacher last clicked
 * (chat box, whiteboard note, rename box), firing real input events so
 * plugNmeet's React state updates — no copy/paste needed.
 */
(function () {
  "use strict";

  if (window.__sxPlugKeyboardHost) return;
  window.__sxPlugKeyboardHost = true;

  var PANEL_ID = "sx-class-keyboard";
  var lastEditable = null;
  var panelRef = null;

  function panelEl() {
    if (!panelRef) panelRef = document.getElementById(PANEL_ID);
    return panelRef;
  }

  function isEditable(node) {
    if (!node || !node.tagName) return false;
    var tag = node.tagName.toUpperCase();
    if (tag === "TEXTAREA") return true;
    if (tag === "INPUT") {
      var type = (node.type || "text").toLowerCase();
      return type === "text" || type === "search" || type === "url" ||
        type === "email" || type === "tel" || type === "";
    }
    return !!node.isContentEditable;
  }

  /* Remember the last plugNmeet field the teacher clicked. Our own panel is
   * ignored so its output box never steals the target. */
  document.addEventListener("focusin", function (ev) {
    var panel = panelEl();
    if (panel && panel.contains(ev.target)) return;
    if (isEditable(ev.target)) lastEditable = ev.target;
  }, true);

  function insertText(text) {
    if (!text) return false;
    var target = lastEditable;
    if (!target || !target.isConnected || !isEditable(target)) {
      // Nothing remembered yet: fall back to whatever the page has focused.
      var active = document.activeElement;
      var panel = panelEl();
      target = active && isEditable(active) && !(panel && panel.contains(active)) ? active : null;
    }
    if (!target) return false;

    try { target.focus(); } catch (e) {}

    if (target.isContentEditable) {
      // Put a caret back inside the box if tapping the panel dropped it.
      try {
        var sel = window.getSelection();
        if (!sel || !sel.rangeCount || !sel.anchorNode || !target.contains(sel.anchorNode)) {
          var range = document.createRange();
          range.selectNodeContents(target);
          range.collapse(false);
          if (sel) { sel.removeAllRanges(); sel.addRange(range); }
        }
      } catch (e) {}
      // Quill / React contenteditable: execCommand fires the events they listen to.
      var before = target.textContent || "";
      try { document.execCommand("insertText", false, text); } catch (e) {}
      if ((target.textContent || "") !== before) return true;

      // Nothing landed (no caret in the editor): write it ourselves and tell
      // the page an input happened so its state follows.
      try {
        var node = document.createTextNode(text);
        var range = document.createRange();
        range.selectNodeContents(target);
        range.collapse(false);
        range.insertNode(node);
        if (window.getSelection) {
          var after = document.createRange();
          after.setStartAfter(node);
          after.collapse(true);
          window.getSelection().removeAllRanges();
          window.getSelection().addRange(after);
        }
        target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
        return true;
      } catch (e) { return false; }
    }

    var proto = target.tagName === "TEXTAREA"
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    var start = typeof target.selectionStart === "number" ? target.selectionStart : target.value.length;
    var end = typeof target.selectionEnd === "number" ? target.selectionEnd : start;
    var next = target.value.slice(0, start) + text + target.value.slice(end);

    try {
      var desc = Object.getOwnPropertyDescriptor(proto, "value");
      if (desc && desc.set) desc.set.call(target, next);
      else target.value = next;
    } catch (e) {
      target.value = next;
    }
    try { target.selectionStart = target.selectionEnd = start + text.length; } catch (e) {}
    try { target.dispatchEvent(new Event("input", { bubbles: true })); } catch (e) {}
    return true;
  }

  window.SXClassKeyboardHost = {
    insert: insertText,
    hasTarget: function () { return !!(lastEditable && lastEditable.isConnected); }
  };

  /* ── Panel tuning for the plugNmeet layout ───────────────────────────── */
  function footButton(label) {
    var panel = panelEl();
    if (!panel) return null;
    var btns = panel.querySelectorAll(".sxkb-foot .sxkb-key");
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].textContent.trim() === label) return btns[i];
    }
    return null;
  }

  function tune() {
    var panel = panelEl();
    if (!panel) return false;

    // Compact, bottom-left: plugNmeet keeps its call controls at the bottom
    // centre and its participant list on the right.
    panel.style.right = "auto";
    panel.style.left = "14px";
    panel.style.bottom = "14px";
    panel.style.top = "auto";
    panel.style.width = "min(420px, 46vw)";
    panel.style.maxHeight = "72vh";

    var typeBtn = footButton("To chat");
    if (typeBtn) {
      typeBtn.textContent = "Type it";
      typeBtn.title = "Type into the plugNmeet box you last clicked (chat, notes…)";
    }
    var boardBtn = footButton("To board");
    if (boardBtn) boardBtn.style.display = "none";
    var winBtn = footButton("↗");
    if (winBtn) winBtn.style.display = "none";

    var head = panel.querySelector(".sxkb-head span");
    if (head) head.textContent = "⌨ Class keyboard — tap a box in the class first";

    makeDraggable(panel);
    return true;
  }

  /* Drag the panel by its header so it can be moved off plugNmeet controls. */
  function makeDraggable(panel) {
    var head = panel.querySelector(".sxkb-head");
    if (!head || head.dataset.sxDrag === "1") return;
    head.dataset.sxDrag = "1";
    head.style.cursor = "move";
    head.style.touchAction = "none";

    var dragging = false, dx = 0, dy = 0;

    head.addEventListener("pointerdown", function (ev) {
      if (ev.target && ev.target.closest && ev.target.closest("button")) return;
      var box = panel.getBoundingClientRect();
      dragging = true;
      dx = ev.clientX - box.left;
      dy = ev.clientY - box.top;
      panel.style.left = box.left + "px";
      panel.style.top = box.top + "px";
      panel.style.bottom = "auto";
      panel.style.right = "auto";
      try { head.setPointerCapture(ev.pointerId); } catch (e) {}
    });

    head.addEventListener("pointermove", function (ev) {
      if (!dragging) return;
      var w = panel.offsetWidth, h = panel.offsetHeight;
      var left = Math.min(Math.max(0, ev.clientX - dx), window.innerWidth - Math.min(w, 80));
      var top = Math.min(Math.max(0, ev.clientY - dy), window.innerHeight - Math.min(h, 48));
      panel.style.left = left + "px";
      panel.style.top = top + "px";
    });

    head.addEventListener("pointerup", function () { dragging = false; });
    head.addEventListener("pointercancel", function () { dragging = false; });
  }

  /* ── Little ⌨ launcher so the panel can be reopened after ✕ ──────────── */
  function addLauncher() {
    if (document.getElementById("sx-kb-launcher")) return;
    var btn = document.createElement("button");
    btn.id = "sx-kb-launcher";
    btn.type = "button";
    btn.textContent = "⌨";
    btn.title = "Class keyboard (maths, physics, chemistry, Igbo, Hausa, Yoruba)";
    btn.setAttribute("aria-label", "Open the class keyboard");
    btn.style.cssText = "position:fixed;left:14px;bottom:14px;z-index:2147483000;" +
      "width:44px;height:44px;border-radius:50%;border:1px solid #7c3aed;background:#1a1228;" +
      "color:#f3e8ff;font-size:20px;line-height:1;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.45);";
    btn.addEventListener("click", function () {
      if (!window.SXClassKeyboard) return;
      window.SXClassKeyboard.toggle();
    });
    document.body.appendChild(btn);

    var observer = new MutationObserver(function () {
      var panel = panelEl();
      if (!panel) return;
      btn.style.display = panel.classList.contains("hidden") ? "block" : "none";
    });
    var panel = panelEl();
    if (panel) observer.observe(panel, { attributes: true, attributeFilter: ["class"] });
  }

  /* ── Boot: wait for the panel script, then open it ───────────────────── */
  var tries = 0;
  function boot() {
    if (!window.SXClassKeyboard) {
      if (tries++ < 40) { setTimeout(boot, 125); }
      return;
    }
    // If a plugNmeet box already had focus when we arrived, keep it as target.
    var active = document.activeElement;
    if (active && isEditable(active)) lastEditable = active;
    window.SXClassKeyboard.open();
    tune();
    addLauncher();
    // Panel DOM is built on first open; re-tune after a subject switch rebuild.
    var panel = panelEl();
    if (panel) {
      panel.addEventListener("click", function () { setTimeout(tune, 0); });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
