# CLAUDE.md

Notes for AI agents (or humans) picking up work on Hotdesker. Not a
feature list — read the README for that. This file captures decisions,
gotchas, and conventions that aren't obvious from the code alone.

## What this is

A browser extension (Manifest V3, Chrome + Firefox) that bulk-books hot
desks via the WeWork member portal's API. The extension reads the user's
auth token from the WeWork tab's localStorage and replays the same API
calls the WeWork web app makes — `members.wework.com` only, nothing else.

Distributed via the Chrome Web Store and Mozilla Add-ons (AMO). Firefox
support landed in v4.1.0; the same source tree ships to both stores
unchanged. Renamed from "WeWork Desk Booker" to "Hotdesker" at v4.0.0 to
dodge trademark issues.

## Architecture

Three layers, message-passed via `chrome.tabs.sendMessage`:

```
popup/popup.js        ── UI, calendar, modals, state
       │
       │ chrome.tabs.sendMessage  (typed messages, see below)
       ▼
content/content.js    ── orchestration, auth discovery, booking flow
       ├── content/locations.js   (locations + favorites APIs)
       └── content/bookings.js    (upcoming + cancel APIs)
       │
       │ fetch() from the page's origin (members.wework.com)
       ▼
WeWork API
```

Content scripts share a single window-scoped object per file:
`window.WW_LOCATIONS`, `window.WW_BOOKINGS`. Loaded in dependency order
in `manifest.json`'s `content_scripts.js` array — `locations.js`,
`bookings.js`, then `content.js` last (it depends on the other two).

`background/background.js` is a no-op service worker stub; it exists
because MV3 wants one but no background work happens here. If you need
to add cross-tab state, that's where it goes.

### Message types

All popup → content script messages go through `chrome.tabs.sendMessage`
with these `type` strings:

| Type                 | Purpose                                                      |
|----------------------|--------------------------------------------------------------|
| `WW_GET_BOOKINGS`    | Fetch the user's upcoming bookings list                      |
| `WW_GET_LOCATIONS`   | Fetch locations + favorites for a city                       |
| `WW_GET_CITIES`      | Fetch the global city list                                   |
| `WW_TOGGLE_FAVORITE` | Add or remove a favorite (`action: "add" \| "remove"`)       |
| `WW_START`           | Run a booking job over `{items: [{dateISO, location}]}`      |
| `WW_STOP`            | Cancel an in-flight booking job                              |
| `WW_CANCEL_BOOKINGS` | Cancel one or more existing bookings                         |

And content → popup notifications via `chrome.runtime.sendMessage`:

| Type           | Purpose                                       |
|----------------|-----------------------------------------------|
| `WW_LOG`       | Append a line to the popup status pane        |
| `WW_PROGRESS`  | Update progress bar (`{done, total}`)         |
| `WW_DONE`      | Run finished — re-enable Start, refresh data  |

Handlers in `content.js` use `return true` after sending an async
response — this keeps the message channel open. Forgetting to do this
returns `undefined` to the popup and silently breaks things.

## The WeWork API, briefly

The booking flow is **four** calls per day, not three:

1. `GET /workplaceone/api/spaces/get-spaces?locationUUIDs=…&date=YYYY-MM-DD`
   — discover bookable space UUIDs at a location
2. `GET /workplaceone/api/common-booking/inventory-details?propertyId=…&spaceId=…`
   — get pricing + the all-important `kubeSpaceId` (this is the
   `SpaceID` the booking endpoint wants, NOT `inventory.id` which is a
   placeholder)
3. `POST /workplaceone/api/common-booking/quote` — validate
4. `POST /workplaceone/api/common-booking/` — actually book

Step 2 is the easy place to get tripped up. The response has both
`inventory.id` (often `0`, a placeholder) and `kubeSpaceId` (the real
ID). Use `kubeSpaceId` as `SpaceID` and `inventory.uuid` as
`WeWorkSpaceID`. We had multiple debugging cycles here; see the
`extractInventory` function in `content.js` for the canonical mapping.

The booking body shape is also picky:
- `Notes` and `MailData.locationAddress` must be **strings**, never
  objects. Sending objects yields a 400.
- Times must be ISO-Z UTC even though the user-facing day is local.
  London BST = +01:00, so a 06:00 local start becomes `05:00:00.000Z`.
- `CreditCharged: 0` only on the final POST, not on `/quote`.

Cancellation uses one endpoint
(`/workplaceone/api/common-booking/cancel?isOnDemand=false&platFormType=1`)
that takes both `bookingId` (numeric) and `reservationId` (UUID,
sourced from `kubeBookingExternalReference` in the upcoming-bookings
response). The successful response is the literal string `true`.

Favorites: there's a single endpoint
(`/workplaceone/api/recent-and-favorite/mark-as-favorite-location`)
for both add and remove. The body's `IsDeleted` boolean toggles which.
Removes also need the favorite's numeric id as `Id` in the body — and
the field to read from the favorites list is **`Hmy`** (Yardi row id,
System.Int64), NOT the list entry's own `Id` field which is a UUID.
Sending the UUID gets a 400 with a JSON-to-Int64 conversion error.
The add response returns the same numeric as `FavoriteId`.

## Auth

`findAuth()` in `content.js` scans `localStorage` for any string
starting with `eyJ` whose decoded JWT payload claims `aud: "wework"`.
Picks the longest-expiry match. Also harvests `accountUUID` (separate
from the user's `weworkuuid`) by looking for keys matching
`/account_?uuid/i` whose values are UUIDs.

The `weworkuuid` HTTP header is the user's `sub` / `https://wework.com/user_uuid`
claim. The `accountUUID` query parameter on the locations endpoint is
the org-level UUID — not the user UUID. Don't confuse them.

If `accountUUID` is missing the locations API may return 4xx. The
heuristic-scan is fragile — Auth0 could change its localStorage layout
and break this. If it ever fails, the not-ready screen will show
"locations: HTTP 4xx" and that's the first thing to investigate.

## State management (popup)

Single `state` object at the top of `popup.js`. Most fields are
self-explanatory. Worth knowing:

- `state.assignments` is `Map<dateISO, locationId>` — the user's
  not-yet-booked plan. **Not persisted**: clears on every popup open.
- `state.bookedDates` is `Map<dateISO, booking>` — already-booked days
  loaded from the upcoming-bookings API. Drives the amber day rendering
  and the locked-cell behaviour.
- `state.favorites` is `Map<locationId, favoriteId>`. The favoriteId
  (numeric) is needed to send unfavorite requests.
- `state.currentCity` is `{name, latitude, longitude}`. Coordinates may
  be `null` when auto-detected from a booking.
- `state.cities` is `null` until first city-picker open; lazy-loaded.

Persisted to `chrome.storage.local` under key `hotdeskerConfig`:
- `dryRun` — checkbox state
- `preferredCity` — present only after the user explicitly picks a
  city; absent means "auto-detect."

There's a one-time migration from the old `weworkAutobookConfig` key
in `popup.js` `migrateStorage()`. Safe to leave indefinitely.

## Cross-browser (Chrome + Firefox)

We ship one source tree to both stores. The interesting bits:

- **Single combined `manifest.json`.** The `background` block carries
  both `service_worker` (which Chrome reads) and `scripts` +
  `type: "module"` (which Firefox 121+ reads — and Firefox prefers
  `scripts` when both keys are present). `browser_specific_settings.gecko`
  declares the AMO id and Firefox minimum version; Chrome ignores it.
  No per-target manifest split, no build step. Both stores consume the
  same zipped payload.
- **`strict_min_version` is `140.0`.** The lower bound is the Firefox
  version that introduced `browser_specific_settings.gecko.data_collection_permissions`
  (mandatory for new AMO submissions from Nov 2025). Don't lower this
  unless you're also willing to drop that field — older Firefox would
  silently ignore it and AMO would warn.
- **`chrome.*` everywhere on purpose.** Firefox aliases the `chrome.*`
  namespace to its WebExtensions APIs and supports both the
  callback-style and Promise-style signatures. There is no functional
  reason to swap to `browser.*` or add `webextension-polyfill` — the
  polyfill is largely vestigial in 2026 and would force a build step we
  don't want. Don't change this.
- **The gecko id (`hotdesker@sridar.dev`) is immutable.** AMO keys
  updates and reviews off it. Renaming it would mean an entirely new
  AMO listing.
- **Background script works in both.** The `self.addEventListener("install", …)`
  call is harmless in a Firefox event page (the event never fires there;
  the listener is dead code). It runs in a Chrome MV3 service worker as
  intended.
- **Firefox event-page caveat.** If you ever put real logic in
  `background/background.js`, remember the Firefox event page is a full
  DOM context (window, DOMParser available) while the Chrome service
  worker is not. Write to the SW's narrower surface to keep both happy.
- **Release signing.** The release workflow uses `web-ext sign --channel=listed`
  to push to AMO. It needs two repo secrets — `AMO_JWT_ISSUER` and
  `AMO_JWT_SECRET` — generated at
  https://addons.mozilla.org/developers/addon/api/key/.
- **`web-ext-config.mjs`** keeps the Chrome zip and Firefox xpi
  exclusion lists in sync (CLAUDE.md, docs/, AMO_LISTING.md, etc.).
  When adding a new dev-only file, update *both* this file *and* the
  matching `-x` list in `release.yml`.

## Subtle things that bit me during development

### `display: flex` overrides `[hidden]`

A modal-backdrop with `display: flex` won't be hidden by the `hidden`
HTML attribute alone — the browser's UA `[hidden] { display: none }`
rule loses to any explicit `display` value. Every modal-backdrop in
`popup.css` needs an explicit `.modal-backdrop[hidden] { display: none }`
companion rule. If you add a new modal, remember this.

### Async readiness gate vs click handlers

`loadExistingBookings()` runs asynchronously. The calendar renders
**before** bookings finish loading. Every cell's click handler closes
over the `state.bookedDates` value at render time, but bookings might
arrive afterwards. Click handlers must re-check `state.bookedDates` at
*click* time, not render time, otherwise tapping a freshly-arrived
amber day still opens the picker. See the click handler attachment in
`renderCalendar()` for the pattern.

### `node --check` doesn't catch ESM-specific errors

`popup/popup.js` is loaded as `<script type="module">`. Node's CLI
checks files as CommonJS by default, where top-level `return` is legal.
Top-level `return` is **not** legal in ESM, so a syntax error there
won't be caught by `node --check popup/popup.js`. The release workflow
sidesteps this by copying the file to `/tmp/popup-check.mjs` first —
the `.mjs` extension forces ESM parsing. Keep that pattern if you add
more JS files.

### Map → JSON over IPC

`chrome.tabs.sendMessage` serialises payloads via JSON, which turns
Maps into `{}` and Sets into `[]`-ish nothing. The favorites-Map and
state.bookedDates need `Array.from(map.entries())` on the send side and
`new Map(arr)` on the receive side. Same applies to Sets. Don't try to
send Maps directly — they arrive empty.

### MV3 service worker can be torn down

The background service worker has a no-op stub. If you start using it,
remember MV3 can suspend/restart it at any time, so don't store
anything in its module-scope state — use `chrome.storage` for anything
that needs to outlive the next idle period.

### CORS — we don't have one

Because content scripts run in the page's origin, all `fetch()` calls
to `members.wework.com` are same-origin. No CORS preflight, no extra
headers needed beyond the auth token. If we ever needed to call a
different origin, that'd require host_permissions changes and would
look much more like cross-origin code.

## Conventions

- **Naming.** User-facing strings say "WeWork" because that's what the
  user calls it. Internal identifiers say "hotdesker" or "Hotdesker".
  No third-party logos in the bundle (the orange-dot desk is original).
- **Logging.** Console logs from the content script are prefixed
  `[Hotdesker]` so they're easy to filter in DevTools. The popup
  status pane uses its own line types: `info`, `ok`, `warn`, `err`.
- **Comments.** Comments in this codebase explain *why* not *what*.
  If you find yourself writing "loop over the items" — delete it.
  If you're writing "we use the kubeSpaceId here because inventory.id
  is a placeholder," keep it.
- **Errors.** Fail loudly. We deliberately removed the hardcoded
  fallback list — if the WeWork API breaks, the not-ready screen
  surfaces the actual HTTP error code so it's debuggable. Don't add
  silent fallbacks; debugging stale-data behaviour is much harder than
  debugging a clear error.
- **No dependencies.** No npm install, no bundler, no transpiler. Just
  files on disk loaded by Chrome. Keep it that way unless there's a
  specific reason to add tooling.

## Things to know if you're adding features

- **The 30-day booking horizon** is a WeWork limit, not ours. The
  calendar disables days more than `MAX_BOOKING_HORIZON_DAYS` ahead.
  Don't try to book past it — the API will reject with a useful error
  but it's nicer to disable upfront.
- **Stop button responsiveness.** `cancellableSleep()` checks the
  `cancelled` flag every 100ms. There are explicit `if (cancelled)
  throw` checks between every `await` in `bookOneDay`. **In-flight
  fetches cannot be cancelled** without an `AbortController`, which
  hasn't been wired up yet. If a Stop happens mid-fetch, that one
  fetch completes (and might book a desk for that day) before the
  cancellation lands. Future improvement: AbortController for true
  mid-fetch cancellation.
- **Adding a new API call.** The pattern is: helper in
  `content/locations.js` or `content/bookings.js`, message handler in
  `content/content.js` that returns `true`, popup-side caller using
  `chrome.tabs.sendMessage`. Don't put fetch logic directly in
  `content.js` — keep the per-domain helpers separate.

## Release process

1. Update `CHANGELOG.md`.
2. Bump `manifest.json` version. The popup's subtitle is rendered from
   `chrome.runtime.getManifest().version` at runtime, so no second edit.
3. Tag: `git tag v4.x.y && git push --tags`.
4. The release workflow (`.github/workflows/release.yml`) verifies tag
   matches manifest, runs syntax checks, runs `web-ext lint`, builds
   the Chrome zip, then runs `web-ext sign --channel=listed` to push
   the signed XPI to AMO. Both `.zip` and `.xpi` are attached to the
   GitHub Release.
5. For Chrome Web Store updates: download the `.zip` from the Release
   and upload to the Webstore developer dashboard. The
   `WEBSTORE_LISTING.md` has the description copy.
6. For AMO: `web-ext sign --channel=listed` publishes the new version
   automatically. For the **first** AMO submission you must use the
   AMO Developer Hub UI manually (it needs the listing description,
   screenshots, categories — see `AMO_LISTING.md`). Subsequent versions
   land via CI.

Versioning is loose semver: patch for fixes, minor for features,
major for breaking storage-shape changes or naming. The 3.x → 4.x bump
was for the rename (storage key changed; auto-migrates).

## What I'd do next if I were continuing

- **AbortController for fetches** so Stop is truly instant.
- **Keyboard shortcuts** — Cmd-Enter to start, number keys to navigate
  the calendar, etc. The popup is mouse-only right now.
- **Test mode for a different city** to verify the city-only API
  call works for cities outside London. Tokyo / NYC are good targets.
  We've never proven the location list returns sensible results
  without lat/lon for those.
- **Better empty-state when a user has zero bookings.** Currently the
  city auto-detect falls through silently to London; might be worth
  showing a "Pick a city to get started" prompt instead.
- **Webstore publish.** Trademark search, privacy policy hosting,
  screenshots — see `SCREENSHOTS.md`.

## Quick reference

| File                             | What's in it                              |
|----------------------------------|-------------------------------------------|
| `manifest.json`                  | MV3 manifest, version, permissions        |
| `popup/popup.html`               | Static popup structure                    |
| `popup/popup.css`                | All popup styles                          |
| `popup/popup.js`                 | UI, calendar render, modals, state        |
| `content/content.js`             | Auth, booking flow, message router        |
| `content/locations.js`           | Locations + favorites + cities APIs       |
| `content/bookings.js`            | Upcoming-bookings + cancel APIs           |
| `background/background.js`       | MV3 service worker stub (no-op)           |
| `icons/icon.svg`                 | Master icon                               |
| `icons/icon{16,48,128}.png`      | Rasterised for manifest                   |
| `icons/logo-header.svg`          | Logo for dark backgrounds (popup header)  |
| `icons/logo-on-light.svg`        | Logo for light backgrounds (not-ready)    |
| `docs/`                          | GitHub Pages content (privacy + landing)  |
| `WEBSTORE_LISTING.md`            | Chrome Web Store listing copy             |
| `AMO_LISTING.md`                 | Mozilla Add-ons listing copy              |
| `SCREENSHOTS.md`                 | Screenshot specs and shot list            |
| `CHANGELOG.md`                   | Release history                           |
| `web-ext-config.mjs`             | Shared ignoreFiles for web-ext            |
| `.github/workflows/release.yml`  | Tag-triggered zip + xpi build + release   |
