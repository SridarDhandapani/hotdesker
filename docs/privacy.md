---
title: Hotdesker Privacy Policy
---

# Hotdesker Privacy Policy

_Last updated: 29 April 2026_

Hotdesker is a Chrome extension that bulk-books hot desks via the WeWork
member portal. This page describes what data the extension touches and what
happens to it.

## Short version

Hotdesker doesn't collect, transmit, or store any of your data outside your
own browser. It talks only to `members.wework.com`, using the session you're
already signed into. There is no Hotdesker server, no analytics, no
telemetry, no third-party services.

## What the extension reads

When the popup is open, Hotdesker reads:

- **Your WeWork JWT** from the `localStorage` of the open WeWork tab. Used
  to authenticate the API calls Hotdesker makes on your behalf.
- **Your account UUID** from the same `localStorage`. Required by the
  WeWork locations endpoint.
- **Your upcoming bookings, locations, and favorites** via authenticated
  calls to `members.wework.com`. Used to populate the calendar, the
  location picker, and the favorites stars.

These are exactly the same calls the WeWork web app itself makes — the
extension does not access anything that isn't already available to a
logged-in WeWork user.

## What the extension stores locally

Hotdesker uses Chrome's `chrome.storage.local` API to remember:

- **Your dry-run preference** (whether the dry-run checkbox is on by
  default).
- **Your preferred city**, once you've explicitly picked one via the city
  picker. Used so the popup opens on your usual city next time.

That's the entire list. This data lives on your machine and is never sent
anywhere. You can clear it at any time by removing the extension or by
clearing site data in Chrome's settings.

## What the extension does NOT do

- Does not collect personal information, browsing history, or any data
  outside `members.wework.com`.
- Does not transmit any data to any server other than WeWork's own.
- Does not include analytics, tracking pixels, error reporting, or any
  third-party SDK.
- Does not share data with the developer or anyone else.
- Does not run on any site other than `members.wework.com`.

## Permissions explained

Chrome shows a list of permissions when you install the extension:

- **`activeTab` / `tabs`** — needed to talk to the WeWork tab from the
  popup.
- **`scripting`** — needed to inject the booking logic into the WeWork
  page.
- **`storage`** — for the local preferences described above.
- **Host permission for `https://members.wework.com/*`** — restricts the
  extension to that single site. It cannot run anywhere else.

## Open source

Hotdesker is open source under the MIT license. The full source code is
available at <https://github.com/SridarDhandapani/hotdesker>. Anything
this policy says can be verified by reading the code.

## Not affiliated with WeWork

WeWork is a trademark of WeWork Inc. Hotdesker is built and maintained
independently and is not endorsed by, sponsored by, or otherwise
affiliated with WeWork.

## Contact

Questions, concerns, or bug reports: open an issue at
<https://github.com/SridarDhandapani/hotdesker/issues>.
