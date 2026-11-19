/** App-wide light / dark theme (Profile toggle). */
var APP_THEME_KEY = "sia_app_theme";

function getAppTheme() {
  try {
    return localStorage.getItem(APP_THEME_KEY) || localStorage.getItem("sia_community_theme") || "light";
  } catch (e) {
    return "light";
  }
}

function updateThemeToggleUi(theme) {
  var btn = document.getElementById("profile-theme-toggle");
  var icon = document.getElementById("profile-theme-icon");
  var label = document.getElementById("profile-theme-label");
  if (btn) btn.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
  if (icon) icon.textContent = theme === "dark" ? "\u2600\uFE0F" : "\uD83C\uDF19";
  if (label) label.textContent = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  var kindBtn = document.getElementById("kind-theme-btn");
  if (kindBtn) {
    kindBtn.innerHTML = theme === "dark" ? "&#9728;&#65039;" : "&#127769;";
    kindBtn.title = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  }
}

function applyAppTheme(theme) {
  theme = theme === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-app-theme", theme);
  if (document.body) document.body.setAttribute("data-app-theme", theme);
  try {
    localStorage.setItem(APP_THEME_KEY, theme);
  } catch (e) { /* ignore */ }
  updateThemeToggleUi(theme);
}

function toggleAppTheme() {
  applyAppTheme(getAppTheme() === "light" ? "dark" : "light");
}

function initAppTheme() {
  applyAppTheme(getAppTheme());
}

function bindThemeToggle() {
  var btn = document.getElementById("profile-theme-toggle");
  if (!btn || btn.dataset.themeBound === "1") return;
  btn.dataset.themeBound = "1";
  btn.addEventListener("click", function (e) {
    e.preventDefault();
    toggleAppTheme();
  });
  updateThemeToggleUi(getAppTheme());
}

document.addEventListener("DOMContentLoaded", function () {
  initAppTheme();
  bindThemeToggle();
});

if (typeof window !== "undefined") window.bindThemeToggle = bindThemeToggle;

(function applyThemeEarly() {
  var theme = getAppTheme();
  document.documentElement.setAttribute("data-app-theme", theme);
})();

if (typeof window !== "undefined") {
  window.getAppTheme = getAppTheme;
  window.applyAppTheme = applyAppTheme;
  window.toggleAppTheme = toggleAppTheme;
  window.initAppTheme = initAppTheme;
  window.updateThemeToggleUi = updateThemeToggleUi;
}
