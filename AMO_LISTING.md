# AMO Listing Copy

Adapted from `WEBSTORE_LISTING.md` for addons.mozilla.org. The Chrome
Web Store and AMO have slightly different field limits and category
taxonomies; the body copy is kept aligned with the Chrome listing so
both stores tell the same story.

## Add-on name

```
Hotdesker — bulk hot desk booking
```

(AMO allows up to 50 characters; this is 34.)

## Summary (250 char max)

```
Bulk-book hot desks for the week ahead in one click. Calendar UI, multi-location, bulk cancel. Works with WeWork's member portal.
```

## Description

```
Hotdesker turns hot desk booking from a chore into a thirty-second job. If you book the same desk five days a week, or different desks on different days, you've felt the friction of doing it one click at a time. Hotdesker replaces that with a calendar.

WORKS WITH WEWORK. This is an unofficial, independently-built tool that uses your existing WeWork member portal session. No separate login, no credentials shared, no third-party servers — your data stays on your machine.

WHAT IT DOES

• Calendar-first booking. Tap a day, pick a location. Repeat for as many days as you want — they can all be different locations. Hit Start. Hotdesker books them sequentially, with a live progress bar and per-day status.

• Bulk cancel. Tap any existing booking to see details and cancel it. Or enter Select mode to mark several days at once and cancel them in one go.

• City switching. Auto-detects your current city from your most recent booking on first open. Switch cities anytime via the picker — coordinates, locations, and favorites refresh together. Works wherever WeWork operates.

• Server-synced favorites. The hearts in the location picker mirror what you've favorited in the WeWork app. Star a location here, it shows up there. Star one in the app, it's here next time you open the popup.

• Dry-run mode. Validates everything via WeWork's quote endpoint without actually booking. Useful for sanity-checking your day picks first.

• Cancel anytime. Stop button works mid-run; cancellation lands within a couple of seconds.

PRIVACY

Hotdesker only talks to members.wework.com — the same site you're already logged into. It reads your WeWork JWT from the page, makes the API calls the WeWork web app would make, and that's it. Nothing else is sent anywhere. No analytics. No telemetry. No external services.

SETUP

1. Install the add-on.
2. Open members.wework.com and sign in (if you aren't already).
3. Click the Hotdesker icon in your toolbar.

That's it. The first popup open detects your current city from your bookings and you're ready to go.

NOT AFFILIATED WITH WEWORK

Hotdesker is built and maintained independently. WeWork is a trademark of WeWork Inc., used here solely to identify the platform Hotdesker is built to work with. No endorsement, sponsorship, or affiliation is implied.
```

## Categories

- Primary: `Productivity & Workflow` (closest AMO equivalent to Chrome's
  `Productivity`)
- Tags: `desk booking`, `wework`, `productivity`, `calendar`, `coworking`

## Support URL

```
https://github.com/SridarDhandapani/hotdesker/issues
```

## Homepage URL

```
https://sridardhandapani.github.io/hotdesker/
```

## Privacy policy URL

```
https://sridardhandapani.github.io/hotdesker/privacy/
```

## License

MIT — same as the source repository.

## Data collection (required answer in AMO submission flow)

Hotdesker collects no data. The manifest declares this explicitly via
`browser_specific_settings.gecko.data_collection_permissions.required = ["none"]`.

## First-version submission notes (for AMO review)

- Single host permission: `https://members.wework.com/*`. The extension
  only contacts WeWork's member portal.
- The `storage` permission is used solely for `chrome.storage.local`
  to persist the user's dry-run toggle and preferred-city choice.
- No remote code, no bundlers, no minification. The source uploaded
  matches what is shipped: plain JS, HTML, CSS, and PNG/SVG assets.
- The same source ships to the Chrome Web Store at
  https://chromewebstore.google.com/detail/hotdesker/hobjmhjbmhgocoffijifcenldiciclpc.
