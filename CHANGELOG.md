# Changelog

All notable changes to Hotdesker.

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
