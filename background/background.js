// The popup already receives messages sent via chrome.runtime.sendMessage
// from the content script directly — runtime.sendMessage broadcasts to all
// extension contexts (background + every open popup). So this background
// worker has nothing to relay. We keep it around only to satisfy the
// manifest's `background.service_worker` field.

self.addEventListener("install", () => {
  // No-op; nothing to set up.
});

