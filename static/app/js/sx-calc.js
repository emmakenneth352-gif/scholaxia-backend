/* Scholaxia popup calculator — shared by school exams + CBT (web & desktop).
   No dependencies, no eval(): expression evaluated with a small
   tokenizer + shunting-yard parser (+ - * / % ^ √ parentheses). */
(function () {
  if (window.SxCalc) return;
  var OPEN_HTML =
    '<div id="sxCalcBtn" title="Open calculator">🧮<span>Calculator</span></div>' +
    '<div id="sxCalcPop" hidden>' +
    '<div id="sxCalcHead"><b>🧮 Calculator</b><span><button id="sxCalcMin" title="Hide">—</button>' +
    '<button id="sxCalcClose" title="Close">✕</button></span></div>' +
    '<input id="sxCalcDisp" readonly value="0" />' +
    '<div id="sxCalcKeys">' +
    ["C", "⌫", "%", "÷", "7", "8", "9", "×", "4", "5", "6", "−", "1", "2", "3", "+", "±", "0", ".", "="]
      .map(function (k) { return '<button data-k="' + k + '">' + k + "</button>"; })
      .join("") +
    "</div></div>";
  var CSS =
    "#sxCalcBtn{position:fixed;right:14px;bottom:14px;z-index:99990;background:#7B61FF;color:#fff;" +
    "border-radius:999px;padding:10px 16px;font-weight:700;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.3);" +
    "display:flex;gap:8px;align-items:center;font-size:15px;border:none}" +
    "#sxCalcBtn:hover{background:#6449e0}" +
    "#sxCalcPop{position:fixed;right:14px;bottom:64px;z-index:99991;width:248px;background:#fff;border-radius:14px;" +
    "box-shadow:0 10px 30px rgba(0,0,0,.35);overflow:hidden;border:1px solid #d9d4f5}" +
    "#sxCalcHead{background:#7B61FF;color:#fff;padding:8px 10px;display:flex;justify-content:space-between;align-items:center;cursor:move}" +
    "#sxCalcHead button{background:rgba(255,255,255,.2);border:none;color:#fff;border-radius:6px;width:26px;height:24px;cursor:pointer;margin-left:4px}" +
    "#sxCalcDisp{width:100%;box-sizing:border-box;border:none;background:#f4f2ff;color:#1c1a2e;font-size:24px;font-weight:700;" +
    "text-align:right;padding:10px 12px;outline:none}" +
    "#sxCalcKeys{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:10px}" +
    "#sxCalcKeys button{border:1px solid #e2ddf7;background:#faf9ff;border-radius:9px;font-size:17px;font-weight:700;" +
    "padding:10px 0;cursor:pointer;color:#2b2750}" +
    "#sxCalcKeys button:hover{background:#efeBff}" +
    '#sxCalcKeys button[data-k=\"=\"]{background:#7B61FF;color:#fff}';

  function tokenize(s) {
    var t = [], i = 0, n = s.length, prev = null;
    function pushNum(v) { t.push({ t: "n", v: v }); prev = "n"; }
    while (i < n) {
      var c = s[i];
      if (c === " " || c === ",") { i++; continue; }
      if (/[0-9.]/.test(c)) {
        var j = i;
        while (j < n && /[0-9.]/.test(s[j])) j++;
        var num = parseFloat(s.slice(i, j));
        if (!isFinite(num)) throw new Error("bad");
        pushNum(num); i = j; continue;
      }
      if (c === "(") { t.push({ t: "(" }); prev = "("; i++; continue; }
      if (c === ")") { t.push({ t: ")" }); prev = ")"; i++; continue; }
      if ("+-*/%^".indexOf(c) >= 0) {
        if ((c === "-" || c === "+") && (prev == null || prev === "(" || prev === "op")) {
          t.push({ t: "n", v: 0 }); // unary → 0−x
        }
        t.push({ t: "op", v: c }); prev = "op"; i++; continue;
      }
      throw new Error("bad");
    }
    return t;
  }
  function evaluate(expr) {
    var prec = { "+": 1, "−": 1, "-": 1, "+": 1, "×": 2, "*": 2, "÷": 2, "/": 2, "%": 2, "^": 3 };
    var toks = tokenize(expr.replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-"));
    var vals = [], ops = [];
    function apply() {
      var op = ops.pop(), b = vals.pop(), a = vals.pop();
      if (a == null || b == null) throw new Error("bad");
      var r = op === "+" ? a + b : op === "-" ? a - b : op === "*" ? a * b
        : op === "/" ? (b === 0 ? NaN : a / b) : op === "%" ? a % b : Math.pow(a, b);
      if (!isFinite(r)) throw new Error("bad");
      vals.push(r);
    }
    toks.forEach(function (tk) {
      if (tk.t === "n") vals.push(tk.v);
      else if (tk.t === "(") ops.push("(");
      else if (tk.t === ")") { while (ops.length && ops[ops.length - 1] !== "(") apply(); ops.pop(); }
      else {
        while (ops.length && ops[ops.length - 1] !== "(" && prec[ops[ops.length - 1]] >= prec[tk.v]) apply();
        ops.push(tk.v);
      }
    });
    while (ops.length) { if (ops[ops.length - 1] === "(") throw new Error("bad"); apply(); }
    if (vals.length !== 1) throw new Error("bad");
    return Math.round(vals[0] * 1e10) / 1e10;
  }

  function mount() {
    if (document.getElementById("sxCalcBtn")) return;
    var st = document.createElement("style");
    st.textContent = CSS;
    document.head.appendChild(st);
    var box = document.createElement("div");
    box.innerHTML = OPEN_HTML;
    document.body.appendChild(box);
    var expr = "", fresh = true;
    var pop = document.getElementById("sxCalcPop"),
      disp = document.getElementById("sxCalcDisp");
    function show(v) { disp.value = v; }
    document.getElementById("sxCalcBtn").onclick = function () {
      pop.hidden = !pop.hidden;
    };
    document.getElementById("sxCalcClose").onclick = function () { pop.hidden = true; };
    document.getElementById("sxCalcMin").onclick = function () { pop.hidden = true; };
    document.getElementById("sxCalcKeys").addEventListener("click", function (e) {
      var k = e.target && e.target.getAttribute("data-k");
      if (!k) return;
      if (k === "C") { expr = ""; show("0"); fresh = true; return; }
      if (k === "%") { if (!expr || fresh) expr = ""; fresh = false; expr += "/100"; show(expr); return; }
      if (k === "⌫") { expr = expr.slice(0, -1); show(expr || "0"); return; }
      if (k === "±") {
        var m = expr.match(/(\d+\.?\d*)\s*$/);
        if (m) expr = expr.slice(0, -m[1].length) + "(-" + m[1] + ")";
        show(expr || "0"); return;
      }
      if (k === "=") {
        if (!expr) return;
        try { var r = evaluate(expr); show(String(r)); expr = String(r); fresh = true; }
        catch (_) { show("Error"); expr = ""; fresh = true; }
        return;
      }
      if (fresh && /[0-9.]/.test(k)) { expr = ""; fresh = false; }
      else fresh = false;
      expr += k;
      show(expr);
    });
    // drag by header
    (function () {
      var head = document.getElementById("sxCalcHead"), sx, sy, ox, oy, drag = false;
      head.addEventListener("pointerdown", function (e) {
        if (e.target.tagName === "BUTTON") return;
        drag = true; sx = e.clientX; sy = e.clientY;
        var r = pop.getBoundingClientRect(); ox = r.left; oy = r.top;
        pop.style.left = ox + "px"; pop.style.top = oy + "px";
        pop.style.right = "auto"; pop.style.bottom = "auto";
        head.setPointerCapture(e.pointerId);
      });
      head.addEventListener("pointermove", function (e) {
        if (!drag) return;
        pop.style.left = Math.max(0, ox + e.clientX - sx) + "px";
        pop.style.top = Math.max(0, oy + e.clientY - sy) + "px";
      });
      head.addEventListener("pointerup", function () { drag = false; });
    })();
  }
  window.SxCalc = { mount: mount };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
