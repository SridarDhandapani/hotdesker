# Webstore Screenshot Guide

The Webstore needs screenshots before publish. Specs and what each one
should show.

## Required dimensions

- **Screenshots:** 1280×800 or 640×400. Up to 5 shots, at least 1 required.
- **Small promo tile (required):** 440×280 PNG/JPG.
- **Marquee promo tile (optional, but used in featured placements):** 1400×560 PNG/JPG.
- **Icon:** 128×128. Already in `icons/icon128.png`.

The popup itself is 380px wide. For 1280×800 screenshots, composite the
popup onto a backdrop — a soft gradient or a screenshot of the WeWork
member portal works well. The popup as the centrepiece, the WeWork tab
visible behind it for context.

## Suggested shots, in order

### 1. Calendar with several days assigned (the headliner)

The single most useful shot. Should show:

- A calendar with 5–8 days assigned across two locations (different
  coloured dots).
- The legend below the calendar with location names and counts.
- The Start booking button visible.

This is the "I get it" shot. People scrolling the Webstore should
understand the product from this one frame.

### 2. Location picker open (the differentiator)

- Calendar in the background, location picker modal open over it.
- 1–2 favorite hearts filled in red at the top of the list.
- Search box with a few characters typed, filtering visibly.

Demonstrates server-synced favorites and the per-day picker model.

### 3. Mid-run progress

- Progress bar showing e.g. 3 / 6.
- Status pane with a few `✓ 2026-05-05 — booked at 30 Churchill Place` lines.
- One in-progress line showing the current day.

Shows the "live execution" feel, which is the obvious "is this thing
actually doing what I think" question.

### 4. Cancel mode

- Calendar with several amber (booked) days visible.
- A couple of them showing the red checkmark + outline of cancel-mode
  selection.
- The orange "N selected" bar visible at the bottom.

Demonstrates that bulk cancel exists. This is a feature the existing
competing extension doesn't have; worth highlighting.

### 5. City picker

- City picker modal open showing London, San Francisco, Tokyo,
  New York etc with the current city selected.
- Search filtering live.

Shows the multi-city support, which matters for international users.

## Promo tiles

### Small (440×280)

Background: dark (`#0f1419`, matching the popup header). Big white
"Hotdesker" wordmark. Single-line tagline: "Five clicks instead of fifty."
Tiny WeWork logo somewhere with "works with" prefix.

### Marquee (1400×560)

Same colour scheme. Calendar visual on the right (faked/illustrated, not
a real screenshot — promo tiles need polish that real screenshots
don't have). Wordmark + tagline on the left. The same "works with WeWork"
small mark.

## Tips

- Use a fake/test calendar with neat-looking date assignments. Real
  screenshots tend to have lopsided distributions and look messy.
- Mute or anonymise any real booking IDs and names visible in the status
  pane (replace with `Sridar D.` or similar).
- macOS users can use `Cmd-Shift-5` to capture exact pixel dimensions,
  or `Cmd-Shift-4` then space to capture the popup window itself.
- Don't use system dark mode for screenshots — the popup is built for
  the dark header on light body, and looks more legible that way for
  unfamiliar users.
