# Changelog

All notable changes to Hotdesker.

## [4.2.0] — 2026-05-20

### Added

- **Built-in user guide.** A new help page (`guide/index.html`) ships
  inside the extension. It opens automatically in a new tab on first
  install, and is reachable any time via the `?` button in the popup
  header. Covers the 90-second tour, the 30-day booking horizon,
  dry-run mode, cancel mode, switching cities, and troubleshooting the
  common HTTP errors. No new permissions and nothing leaves the
  machine — the guide is served from `chrome-extension://` so it works
  offline.

## [4.1.0] — 2026-05-16

### Added

- **Firefox support.** Hotdesker now ships as a Firefox add-on
  alongside the Chrome extension. The same source tree builds both:
  the manifest carries `background.scripts` for Firefox event-page
  loading alongside `background.service_worker` for Chrome (Firefox
  121+ uses `scripts` when both are present), and a
  `browser_specific_settings.gecko` block declares the AMO add-on id
  and minimum Firefox version. No source code changes were required —
  every `chrome.*` API the extension uses is aliased verbatim by
  Firefox.
- Release workflow now also lints with `web-ext`, builds and signs an
  XPI via AMO's listed channel, and attaches it to the GitHub
  Release alongside the existing Chrome `.zip`.
- `web-ext-config.mjs` keeps the Chrome zip and Firefox xpi
  exclusion lists in lockstep.

### Changed

- Replaced every `innerHTML` assignment with `replaceChildren()` for
  container clears and `createElement` + `textContent` for the one
  templated case (`showNotReady`). Removes AMO's
  `UNSAFE_VAR_ASSIGNMENT` warning ahead of human review and makes the
  flow safe-by-construction — user-controlled strings can no longer
  reach an HTML parser.

## [4.0.4] — 2026-04-30

### Fixed

- Removing a server-side favorite that was already present when the popup
  opened now works. The unfavorite endpoint expects the favorite's
  numeric Yardi row id (`Hmy`) as `Id`; we were sending the entry's UUID
  `Id` field and getting a 400.

### Removed

- Dropped the `scripting` and `activeTab` permissions. We never call
  `chrome.scripting`; static content_scripts handle injection. And
  `activeTab` was redundant with our explicit `members.wework.com` host
  permission. Resolves a Webstore "requesting but not using" violation
  and narrows the install-time permission prompt.

## [4.0.3] — 2026-04-30

### Fixed

- Popup subtitle now reads the version from `manifest.json` at runtime via
  `chrome.runtime.getManifest()`, so the version no longer needs to be
  edited in two places per release.

## [4.0.2] — 2026-04-30

### Removed

- Dropped the `tabs` permission. `activeTab` covers what we need and gives
  users a cleaner permission story at install time.

## [4.0.1] — 2026-04-30

### Changed

- Replaced WeWork logo with a Hotdesker-original icon (a desk with five
  booking dots, three filled, in orange). Avoids the trademark concern of
  shipping a third-party logo to the Webstore.

## [4.0.0] — 2026-04-29

### Renamed

- "WeWork Desk Booker" → **Hotdesker**. Storage key migrates automatically
  from the old name on first popup open.

### Documentation

- New README, privacy policy, screenshot guide, Webstore listing copy.
- MIT license, GitHub Actions release workflow.

## [3.7.0] — 2026-04-29

### Added

- City auto-detection on first run from the user's most recent upcoming
  booking. Persists once the user explicitly picks a city. "Use
  auto-detect" link in the city picker resets the preference.

## [3.6.x]

### Added

- City picker (per-session). Tappable city label above the calendar.

### Fixed

- Logo invisible in dark mode — header is always dark, so always show
  the white-fill SVG regardless of system colour scheme.

## [3.5.0]

### Added

- Favorite write support. Hearts in the location picker are now clickable
  to add or remove favorites; syncs both ways with WeWork.

## [3.4.0]

### Added

- Server-side favorites integration (read-only at first), filtered to
  desk-level favorites only.

## [3.3.0]

### Changed

- Location list moves from a hardcoded London-only list to live API
  fetches from `get-locations-by-geo`. Fails loudly if the API breaks
  rather than serving stale data.

## [3.2.x]

### Added

- Cancel single bookings via tap on a booked day.
- Bulk cancel via Select mode.
- Readiness check screen — extension only shows the main UI when on
  members.wework.com with a valid auth token.
- Loading state while the readiness check runs.

## [3.1.0]

### Added

- Live progress bar during multi-day runs.
- Stop button now actually stops mid-flight (cancel checks between
  every API call inside `bookOneDay`).

## [3.0.0]

### Changed

- **Calendar-first UX**. Tap a day, pick a location for it. Different
  locations on different days. Replaces the previous "one location +
  many dates" model.

## [2.x] — earlier

- API-driven booking flow (replaced v1's fragile DOM-walking).
- Auth via WeWork's localStorage JWT.
- Existing bookings shown on the calendar in amber, not re-assignable.
