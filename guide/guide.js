// Apply persisted theme as early as possible to avoid a flash. Must
// run before paint, so the matching <script src> tag is in <head>.
(function () {
  try {
    var t = localStorage.getItem("theme");
    if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
  } catch (e) {}
})();

// Wire the Auto/Light/Dark toggle and pull the version label from the
// manifest at runtime. Defers the body work via DOMContentLoaded so the
// targets are guaranteed to exist regardless of script position.
document.addEventListener("DOMContentLoaded", function () {
  var root = document.documentElement;
  var buttons = document.querySelectorAll(".theme-toggle [data-set]");
  function paint(value) {
    buttons.forEach(function (b) {
      b.setAttribute("aria-pressed", b.dataset.set === value ? "true" : "false");
    });
  }
  var stored = null;
  try { stored = localStorage.getItem("theme"); } catch (e) {}
  paint(stored === "light" || stored === "dark" ? stored : "auto");
  buttons.forEach(function (b) {
    b.addEventListener("click", function () {
      var v = b.dataset.set;
      if (v === "auto") {
        try { localStorage.removeItem("theme"); } catch (e) {}
        delete root.dataset.theme;
      } else {
        try { localStorage.setItem("theme", v); } catch (e) {}
        root.dataset.theme = v;
      }
      paint(v);
    });
  });

  var version = "";
  try {
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getManifest) {
      version = chrome.runtime.getManifest().version;
    }
  } catch (e) {}
  if (version) {
    var label = "v" + version;
    var top = document.getElementById("versionLabel");
    var foot = document.getElementById("footerVersion");
    if (top) top.textContent = label;
    if (foot) foot.textContent = label;
  }
});
