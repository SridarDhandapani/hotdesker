// The popup already receives messages sent via chrome.runtime.sendMessage
// from the content script directly — runtime.sendMessage broadcasts to all
// extension contexts (background + every open popup). So this background
// worker has nothing to relay. We keep it around only to satisfy the
// manifest's `background.service_worker` field.

self.addEventListener("install", () => {
  // No-op; nothing to set up.
});

// Open the user guide once, on first install. Skipped on `update` so
// existing users aren't pestered every patch release, and on
// `chrome_update` / `shared_module_update` for the same reason. Firefox
// reports `reason === "install"` for fresh installs too, so this works
// on both stores without a per-target branch.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("guide/index.html") });
  }
});

