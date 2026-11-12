/* Scholaxia content guard - anti-copy / anti-capture deterrence.
 *
 * Browsers cannot truly block OS screenshots, and no website can stop a
 * second phone from photographing a screen. This script does everything the
 * web platform allows: removes text selection, blocks the context menu,
 * copy/cut/drag/print/save shortcuts, and hides the page while it is in the
 * background / app switcher. On phones it also shows a capture warning when
 * the page comes back from an app switch.
 */
(function (global) {
  "use strict";

  var MOBILE =
    (global.navigator && /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "")) ||
    (global.matchMedia && matchMedia("(max-width: 900px)").matches);

  function isEditable(target) {
    if (!target || !target.closest) return false;
    var el = target.closest(
      'input, textarea, select, [contenteditable="true"], [contenteditable=""], [data-allow-select], [data-allow-copy]'
    );
    if (!el) return false;
    if (el.tagName === "INPUT") {
      var type = String(el.type || "text").toLowerCase();
      return type !== "button" && type !== "submit" && type !== "reset" && type !== "checkbox" && type !== "radio";
    }
    return true;
  }

  function injectStyles() {
    if (document.getElementById("sx-guard-css")) return;
    var style = document.createElement("style");
    style.id = "sx-guard-css";
    style.textContent = [
      "html.sx-guard,html.sx-guard body{-webkit-touch-callout:none!important;-webkit-user-select:none!important;user-select:none!important;}",
      "html.sx-guard ::selection{background:transparent!important;color:inherit!important;}",
      "html.sx-guard img,html.sx-guard svg,html.sx-guard canvas{-webkit-user-drag:none!important;user-drag:none!important;}",
      "html.sx-guard input,html.sx-guard textarea,html.sx-guard select,html.sx-guard [contenteditable=\"true\"],html.sx-guard [data-allow-select],html.sx-guard [data-allow-copy]{-webkit-user-select:text!important;user-select:text!important;-webkit-touch-callout:default!important;}",
      "body.sx-screen-hidden .app-shell,body.sx-screen-hidden main,body.sx-screen-hidden .kind-shell{filter:blur(18px) saturate(.6);transition:filter .15s ease;}",
      "@media print{html.sx-guard body{display:none!important;visibility:hidden!important;}}",
      "#sx-guard-warn{position:fixed;left:50%;bottom:calc(18px + env(safe-area-inset-bottom,0px));transform:translateX(-50%) translateY(16px);z-index:2147482100;",
      "max-width:min(520px,calc(100vw - 24px));padding:14px 18px;border-radius:18px;background:linear-gradient(135deg,rgba(15,23,42,.96),rgba(49,46,129,.96));",
      "color:#fff;font:600 .88rem/1.45 system-ui,-apple-system,'Segoe UI',sans-serif;box-shadow:0 20px 50px rgba(2,6,23,.45);",
      "border:1px solid rgba(255,255,255,.16);opacity:0;pointer-events:none;transition:opacity .2s ease,transform .2s ease;display:flex;gap:10px;align-items:flex-start;}",
      "#sx-guard-warn.is-on{opacity:1;transform:translateX(-50%) translateY(0);}",
      "#sx-guard-warn .sx-gw-ico{font-size:1.15rem;line-height:1;}",
      "@media (prefers-reduced-motion:reduce){#sx-guard-warn{transition:none;}}",
    ].join("\n");
    document.documentElement.appendChild(style);
    document.documentElement.classList.add("sx-guard");
  }

  function showWarning(text) {
    injectStyles();
    var box = document.getElementById("sx-guard-warn");
    if (!box) {
      box = document.createElement("div");
      box.id = "sx-guard-warn";
      box.setAttribute("role", "status");
      box.setAttribute("aria-live", "polite");
      box.innerHTML = '<span class="sx-gw-ico" aria-hidden="true">\uD83D\uDD12</span><span></span>';
      document.body.appendChild(box);
    }
    box.lastElementChild.textContent = text;
    box.classList.add("is-on");
    clearTimeout(showWarning._timer);
    showWarning._timer = setTimeout(function () {
      box.classList.remove("is-on");
    }, 3600);
  }

  function blockSelect(event) {
    if (isEditable(event.target)) return;
    event.preventDefault();
  }

  function blockContext(event) {
    if (isEditable(event.target)) return;
    event.preventDefault();
    showWarning("Copying is disabled. This content is protected by Scholaxia.");
  }

  function blockDrag(event) {
    if (isEditable(event.target)) return;
    event.preventDefault();
  }

  function blockClipboard(event) {
    if (isEditable(event.target)) return;
    event.preventDefault();
    try {
      if (event.clipboardData) {
        event.clipboardData.setData("text/plain", "Copying is disabled on Scholaxia.");
      }
    } catch (e) { /* ignore */ }
    showWarning("Copying is disabled. Please study the material inside Scholaxia.");
  }

  function onKeyDown(event) {
    var key = String(event.key || "");
    var lower = key.toLowerCase();
    var mod = event.ctrlKey || event.metaKey;

    // Dev tools / view-source shortcuts are always blocked.
    if (
      key === "F12" ||
      (mod && event.shiftKey && (lower === "i" || lower === "j" || lower === "c" || lower === "k")) ||
      (mod && lower === "u")
    ) {
      event.preventDefault();
      event.stopPropagation();
      showWarning("Developer tools are disabled on this page.");
      return;
    }

    // Printing and saving are always blocked.
    if (mod && (lower === "p" || lower === "s")) {
      event.preventDefault();
      event.stopPropagation();
      showWarning("Printing and saving are disabled. This content is protected.");
      return;
    }

    if (isEditable(event.target)) return;

    // Text selection / clipboard shortcuts outside form fields.
    if (mod && (lower === "c" || lower === "x" || lower === "a")) {
      event.preventDefault();
      event.stopPropagation();
      showWarning("Copying is disabled. This content is protected by Scholaxia.");
    }
  }

  function onKeyUp(event) {
    if (String(event.key || "") !== "PrintScreen") return;
    // Best effort on Windows: overwrite the screenshot that the OS just put on
    // the clipboard. The OS still captured pixels; this only spoils a paste.
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText("Screenshots are disabled on Scholaxia.").catch(function () {});
      }
    } catch (e) { /* ignore */ }
    showWarning("Screenshots and screen recording are disabled on Scholaxia.");
  }

  function onVisibilityChange() {
    if (document.visibilityState === "hidden") {
      document.body.classList.add("sx-screen-hidden");
      onVisibilityChange._hiddenAt = Date.now();
      return;
    }
    document.body.classList.remove("sx-screen-hidden");
    if (!MOBILE) return;
    var hiddenFor = Date.now() - (onVisibilityChange._hiddenAt || 0);
    if (hiddenFor > 350 && hiddenFor < 10 * 60 * 1000) {
      try {
        var seen = sessionStorage.getItem("sx_capture_warned");
      } catch (e) {
        var seen = null;
      }
      if (!seen) {
        try { sessionStorage.setItem("sx_capture_warned", "1"); } catch (e2) { /* ignore */ }
        showWarning(
          "Screenshots and screen recording are not allowed. Scholaxia content is protected."
        );
      }
    }
  }

  function init() {
    injectStyles();
    // Remove selection that may exist from before the guard loaded.
    try {
      var sel = global.getSelection && global.getSelection();
      if (sel && sel.removeAllRanges) sel.removeAllRanges();
    } catch (e) { /* ignore */ }

    document.addEventListener("selectstart", blockSelect, true);
    document.addEventListener("contextmenu", blockContext, true);
    document.addEventListener("dragstart", blockDrag, true);
    document.addEventListener("copy", blockClipboard, true);
    document.addEventListener("cut", blockClipboard, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("keyup", onKeyUp, true);
    document.addEventListener("visibilitychange", onVisibilityChange, false);
    global.addEventListener("pagehide", function () {
      document.body.classList.add("sx-screen-hidden");
    });
    global.addEventListener("pageshow", function () {
      document.body.classList.remove("sx-screen-hidden");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  global.ScholaxiaGuard = { warn: showWarning };
})(window);
