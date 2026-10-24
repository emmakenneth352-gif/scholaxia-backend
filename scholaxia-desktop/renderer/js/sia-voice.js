/**
 * Sia voice — reads the AI Teacher's replies aloud.
 *
 * SPEED FIX: the one-shot TTS call used to synthesize the WHOLE answer before
 * any audio played (a full reply took ~50s of silence). We now split the text
 * into short chunks and ask the voice service for them one at a time — the
 * first chunk starts playing within a couple of seconds and the rest chain
 * seamlessly. Same Sia voice throughout.
 */

var siaVoiceEnabled = true; // ON by default — the AI teacher speaks every answer
// (tap 🔊 Voice off on a page to mute; the choice is remembered).
var siaVoiceAudio = null;
var siaVoiceObjectUrl = null;
var siaVoiceGen = 0; // generation counter — starting/stopping invalidates queued chunks

function siaVoiceClean(text) {
  return String(text || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^#+\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1400);
}

/** Split cleaned speech into ~maxLen chunks, always cutting at sentence ends. */
function siaSplitChunks(text, maxLen) {
  var s = String(text || "").replace(/\s+/g, " ").trim();
  if (!s) return [];
  if (s.length <= maxLen) return [s];
  var sentences = s.match(/[^.!?;]+[.!?;]*\s*/g) || [s];
  var parts = [];
  var buf = "";
  for (var i = 0; i < sentences.length; i++) {
    var sen = sentences[i].trim();
    if (!sen) continue;
    if (!buf) {
      buf = sen;
    } else if ((buf + " " + sen).length > maxLen) {
      if (buf.length > maxLen && sen.length > maxLen) {
        // A single over-long sentence: hard-split at a word boundary.
        var combined = buf + " " + sen;
        while (combined.length > maxLen) {
          var cut = combined.lastIndexOf(" ", maxLen);
          if (cut < 40) break;
          parts.push(combined.slice(0, cut).trim());
          combined = combined.slice(cut).trim();
        }
        buf = combined;
      } else {
        buf = sen;
      }
    } else {
      buf = buf + " " + sen;
    }
    if (buf.length >= maxLen) { parts.push(buf.trim()); buf = ""; }
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts.length ? parts : [s.slice(0, maxLen)];
}

function siaVoiceRevokeUrl() {
  if (siaVoiceObjectUrl) {
    try { URL.revokeObjectURL(siaVoiceObjectUrl); } catch (e) { /* ignore */ }
    siaVoiceObjectUrl = null;
  }
}

function siaStopVoice() {
  siaVoiceGen++; // any queued chunks become stale
  if (siaVoiceAudio) {
    try {
      siaVoiceAudio.pause();
      siaVoiceAudio.currentTime = 0;
    } catch (e) { /* ignore */ }
    siaVoiceAudio = null;
  }
  siaVoiceRevokeUrl();
  if (typeof window !== "undefined" && window.speechSynthesis) {
    try { window.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
  }
}

function siaSpeakBrowser(text) {
  if (!window.speechSynthesis) return false;
  try {
    window.speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95;
    u.pitch = 1.02;
    u.lang = "en-US";
    var voices = window.speechSynthesis.getVoices();
    var pick = voices.find(function (v) {
      var n = (v.name || "").toLowerCase();
      return n.indexOf("zira") >= 0 || n.indexOf("samantha") >= 0 || n.indexOf("jenny") >= 0 || n.indexOf("female") >= 0;
    });
    if (pick) u.voice = pick;
    window.speechSynthesis.speak(u);
    return true;
  } catch (e) {
    return false;
  }
}

/** Fetch audio MP3 bytes for one chunk from the server voice service. */
async function siaFetchChunkAudio(chunk) {
  var base = typeof API_BASE !== "undefined" ? API_BASE : "";
  var token = typeof getToken === "function" ? getToken() : "";
  if (!base || !token) return null;
  try {
    var res = await fetch(base + "/api/v1/sia/speak", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({ text: chunk, language: "english" }),
    });
    if (!res.ok) return null;
    var blob = await res.blob();
    if (!blob || blob.size < 100) return null;
    return URL.createObjectURL(blob);
  } catch (e) {
    return null;
  }
}

function siaPlayUrl(url, gen) {
  return new Promise(function (resolve) {
    try {
      var audio = new Audio(url);
      siaVoiceAudio = audio;
      var done = function () {
        if (siaVoiceAudio === audio) siaVoiceAudio = null;
        try { audio.pause(); } catch (e) { /* ignore */ }
        try { audio.currentTime = 0; } catch (e2) { /* ignore */ }
        URL.revokeObjectURL(url);
        if (siaVoiceObjectUrl === url) siaVoiceObjectUrl = null;
        resolve();
      };
      audio.onended = done;
      audio.onerror = done;
      audio.onpause = function () {
        // Started by us being stopped via siaStopVoice → resolve quickly.
        if (siaVoiceAudio !== audio) resolve();
      };
      if (gen !== siaVoiceGen) { resolve(); return; }
      audio.play().catch(done);
    } catch (e) {
      resolve();
    }
  });
}

async function siaSpeak(text) {
  if (!siaVoiceEnabled) return;
  var cleaned = siaVoiceClean(text);
  var chunks = siaSplitChunks(cleaned, 280);
  if (!chunks.length) return;
  siaStopVoice();
  var gen = siaVoiceGen;

  for (var i = 0; i < chunks.length; i++) {
    if (gen !== siaVoiceGen) return; // user interrupted / new speech started
    var url = await siaFetchChunkAudio(chunks[i]);
    if (gen !== siaVoiceGen) { if (url) URL.revokeObjectURL(url); return; }
    if (!url) {
      // Voice service hiccup — fall back to the browser voice for what's left.
      var rest = chunks.slice(i).join(" ");
      siaSpeakBrowser(rest);
      return;
    }
    await siaPlayUrl(url, gen);
    // Wait only while there is still something to say.
  }
}

function siaToggleVoice() {
  siaVoiceEnabled = !siaVoiceEnabled;
  try { localStorage.setItem("sia_voice_on", siaVoiceEnabled ? "1" : "0"); } catch (e) { /* ignore */ }
  if (!siaVoiceEnabled) siaStopVoice();
  document.querySelectorAll(".sia-voice-toggle").forEach(function (btn) {
    btn.textContent = siaVoiceEnabled ? "🔊 Voice on" : "🔇 Voice off";
    btn.setAttribute("aria-pressed", siaVoiceEnabled ? "true" : "false");
  });
}

/* Init saved preference — default ON, only an explicit "0" mutes it. */
try {
  if (localStorage.getItem("sia_voice_on") === "0") siaVoiceEnabled = false;
} catch (e) { /* ignore */ }

if (typeof window !== "undefined") {
  window.siaSpeak = siaSpeak;
  window.siaStopVoice = siaStopVoice;
  window.siaToggleVoice = siaToggleVoice;
  if (window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = function () { /* preload voices */ };
  }
}
