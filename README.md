# Hotdesker

A Chrome extension that lets you bulk-book hot desks for the week (or month)
ahead in a single click. Built for WeWork's member portal.

The official WeWork web app and mobile app only let you book one day at a
time. If you book five days a week you click through the same forms five
times. Hotdesker replaces that with: tap days on a calendar, pick a location
for each, click Start.

## Features

- **Calendar-first.** Tap a day, pick a location, repeat. Different
  locations on different days are no problem.
- **Bulk cancel** existing bookings — tap one day for single cancel, or
  enter Select mode to cancel several at once.
- **City switching.** Auto-detects from your most recent booking on first
  run; persists your choice afterwards. Works wherever WeWork operates.
- **Server-synced favorites.** The hearts in the location picker mirror
  what you've favorited in the WeWork app. Toggle in either place; both
  stay in sync.
- **Dry-run mode.** Calls the quote endpoint but skips the booking. Useful
  for sanity-checking your day picks before committing.
- **Live progress.** Bar + per-day status as the run proceeds. Stop button
  works mid-run.
- **Existing bookings are visible** as amber dots on the calendar; they
  can't be re-assigned (no double-booking).

## How it works

Three calls per day:

1. `GET /workplaceone/api/spaces/get-spaces` — find an available space at
   the chosen location for that date.
2. `GET /workplaceone/api/common-booking/inventory-details` — get the
   bookable space's pricing and IDs.
3. `POST /workplaceone/api/common-booking/quote` — validate the booking.
4. `POST /workplaceone/api/common-booking/` — create it.

Bookings are verified post-run by re-fetching the upcoming list and
matching against the requested dates.

Auth is via the JWT WeWork stores in `localStorage` after login. The
extension reads it from the live page rather than asking you to paste it.

## Install

Until it's on the Webstore:

1. Clone or download this folder.
2. Visit `chrome://extensions`.
3. Enable Developer Mode.
4. Click "Load unpacked" and pick the folder.

## Privacy

No data leaves your machine. The extension talks only to
`members.wework.com`, using the same auth as the page you're already
logged into. No analytics, no telemetry, no third-party endpoints.

## Status

This is an unaffiliated third-party tool. WeWork is a trademark of
WeWork Inc., used here only to identify the platform Hotdesker works
with. No endorsement implied.
