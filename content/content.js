// content.js — runs on members.wework.com.
//
// Implements the exact 3-step booking flow captured from DevTools:
//   1. GET  /workplaceone/api/common-booking/inventory-details   (find SpaceID/WeWorkSpaceID)
//   2. POST /workplaceone/api/common-booking/quote               (validate + price)
//   3. POST /workplaceone/api/common-booking/                    (create the booking)
//
// Auth is a Bearer JWT pulled from the page. The token is in localStorage on
// members.wework.com — Auth0 stashes it under a key that contains the
// substring "auth0spajs" or similar. We find it by scanning entries.

(() => {
  if (window.__hotdeskerInjected) return;
  window.__hotdeskerInjected = true;

  let cancelled = false;

  // ---- logging ----------------------------------------------------------
  function log(text, kind = "") {
    console.log(`[Hotdesker] ${text}`);
    chrome.runtime.sendMessage({ type: "WW_LOG", text, kind }).catch(() => {});
  }

  // ---- auth -------------------------------------------------------------
  // Pull the JWT, weworkuuid, and accountUUID out of the page. Token lives
  // in Auth0 SDK cache entries in localStorage; accountUUID lives nearby in
  // the user-profile cache (Segment uses it as `accountUuid` trait).
  function findAuth() {
    let bestToken = null;
    let bestExp = 0;
    let accountUUID = null;

    const tryParseJwt = (jwt) => {
      try {
        const [, payload] = jwt.split(".");
        if (!payload) return null;
        const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
        return JSON.parse(json);
      } catch {
        return null;
      }
    };

    const considerToken = (tok) => {
      if (typeof tok !== "string" || !tok.startsWith("eyJ")) return;
      const claims = tryParseJwt(tok);
      if (!claims) return;
      const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      if (!aud.includes("wework")) return;
      if ((claims.exp || 0) > bestExp) {
        bestExp = claims.exp;
        bestToken = tok;
      }
    };

    // Walk a parsed object looking for both tokens and accountUUID.
    const walk = (obj) => {
      if (!obj || typeof obj !== "object") return;
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === "string") {
          considerToken(v);
          // accountUUID is usually under key "accountUuid" / "accountUUID"
          // and looks like a UUID string.
          if (
            !accountUUID &&
            /^account(_)?uuid$/i.test(k) &&
            /^[0-9a-f-]{36}$/i.test(v)
          ) {
            accountUUID = v;
          }
        } else if (typeof v === "object") {
          walk(v);
        }
      }
    };

    // localStorage scan
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const v = localStorage.getItem(k);
      if (!v) continue;
      if (v.startsWith("eyJ")) considerToken(v);
      try {
        walk(JSON.parse(v));
      } catch {
        /* not JSON, ignore */
      }
    }

    if (!bestToken) return null;
    const claims = tryParseJwt(bestToken);
    const uuid = claims["https://wework.com/user_uuid"] || claims.sub?.replace(/^auth0\|/, "");
    const expiresInSec = (claims.exp || 0) - Math.floor(Date.now() / 1000);
    return { token: bestToken, uuid, accountUUID, expiresInSec };
  }

  // ---- common request setup --------------------------------------------
  function commonHeaders(auth) {
    return {
      accept: "application/json, text/plain, */*",
      authorization: `Bearer ${auth.token}`,
      "cache-control": "no-cache",
      "fe-pg": "/workplaceone/content2/bookings/desks",
      pragma: "no-cache",
      "request-source": "MemberWeb/WorkplaceOne/Prod",
      weworkmembertype: "2",
      weworkuuid: auth.uuid,
    };
  }

  // ---- date helpers -----------------------------------------------------
  // The API uses "MM/DD/YYYY" for inventory-details and ISO Z timestamps in
  // POST bodies. The captured booking ran 06:00–23:59 local (Europe/London,
  // BST = UTC+1), so the UTC times sent were 05:00Z–22:59Z.
  function formatMMDDYYYY(iso) {
    const [y, m, d] = iso.split("-");
    return `${m}/${d}/${y}`;
  }

  // Compute the UTC offset string ("+01:00" / "-05:00") for the local date.
  // WeWork's API wants the offset of the location's timezone — for London
  // members this matches local browser time, which is what we use.
  function localOffsetForDate(iso) {
    const d = new Date(iso + "T12:00:00"); // midday avoids DST edge weirdness
    const offsetMin = -d.getTimezoneOffset(); // minutes east of UTC
    const sign = offsetMin >= 0 ? "+" : "-";
    const abs = Math.abs(offsetMin);
    const hh = String(Math.floor(abs / 60)).padStart(2, "0");
    const mm = String(abs % 60).padStart(2, "0");
    return `${sign}${hh}:${mm}`;
  }

  // Build the start/end ISO timestamps in UTC, given a local date and the
  // 06:00 / 23:59 anchors used in the captured booking.
  function localTimesToUtcISO(iso) {
    const start = new Date(`${iso}T06:00:00`); // local 06:00
    const end = new Date(`${iso}T23:59:00`); // local 23:59
    return {
      startUTC: start.toISOString().replace(/\.\d{3}Z$/, "Z"),
      endUTC: end.toISOString().replace(/\.\d{3}Z$/, "Z"),
    };
  }

  // ---- API calls --------------------------------------------------------
  //
  // The booking flow turns out to be FOUR steps, not three:
  //   1. GET /spaces/get-spaces        — list bookable spaces for a location/date
  //   2. GET /common-booking/inventory-details?spaceId=<uuid>&useInventoryUuid=true
  //                                     — get pricing/SpaceID for one specific space
  //   3. POST /common-booking/quote   — validate
  //   4. POST /common-booking/        — actually book
  //
  // The captured DevTools trace skipped step 1 because the user clicked a
  // space on the UI's map; the UI already had the list cached in memory. We
  // have to re-do step 1 ourselves.

  async function fetchSpaces({ auth, locationId, dateISO }) {
    const offset = encodeURIComponent(localOffsetForDate(dateISO));
    const url =
      `https://members.wework.com/workplaceone/api/spaces/get-spaces` +
      `?locationUUIDs=${locationId}` +
      `&closestCity=&type=0&offset=0&limit=500` +
      `&roomTypeFilter=&date=${dateISO}&duration=0` +
      `&locationOffset=${offset}` +
      `&isWeb=false&capacity=0&endDate=&locationType=0` +
      `&isFromWp=false&platFormType=1`;
    const res = await fetch(url, {
      method: "GET",
      credentials: "include",
      headers: commonHeaders(auth),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`get-spaces HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`get-spaces returned non-JSON (HTTP ${res.status})`);
    }
  }

  // Walk the get-spaces response and pull the first available space's UUID
  // for the given location. The response shape isn't documented, but the
  // captured URL was scoped by `locationUUIDs=`, so we expect each space to
  // carry a `locationUUID` and a `uuid` (or `spaceUUID`).
  function pickSpaceUUID(data, locationId, debugLog) {
    if (!data || typeof data !== "object") return null;
    const candidates = [];
    function walk(node, path) {
      if (!node || typeof node !== "object") return;
      // Each space-like entry usually has both a uuid and a locationUUID/locationUuid.
      const uuid = node.uuid || node.UUID || node.spaceUUID || node.SpaceUUID;
      const locUuid =
        node.locationUUID || node.locationUuid || node.LocationUUID ||
        (node.location && (node.location.uuid || node.location.UUID));
      if (uuid && typeof uuid === "string" && UUID_RE_LOCAL.test(uuid)) {
        candidates.push({
          path, uuid, locUuid: locUuid || null,
          available: node.availableSeats ?? node.AvailableSeats,
        });
      }
      if (Array.isArray(node)) node.forEach((v, i) => walk(v, `${path}[${i}]`));
      else for (const [k, v] of Object.entries(node)) {
        if (typeof v === "object") walk(v, path ? `${path}.${k}` : k);
      }
    }
    walk(data, "");

    if (debugLog) {
      debugLog(
        `get-spaces: found ${candidates.length} uuid candidates, ${
          candidates.filter((c) => c.locUuid === locationId).length
        } match the location`
      );
    }

    // Prefer ones whose locationUUID matches our target location, then ones
    // with availability > 0.
    const matching = candidates.filter((c) => c.locUuid === locationId);
    const pool = matching.length > 0 ? matching : candidates;
    pool.sort((a, b) => {
      const aFree = (a.available ?? 1) > 0 ? 0 : 1;
      const bFree = (b.available ?? 1) > 0 ? 0 : 1;
      return aFree - bFree;
    });
    return pool[0]?.uuid || null;
  }

  const UUID_RE_LOCAL =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  async function fetchInventory({ auth, locationId, dateISO, spaceUuid }) {
    const offset = encodeURIComponent(localOffsetForDate(dateISO));
    const dateParam = encodeURIComponent(formatMMDDYYYY(dateISO));
    const url =
      `https://members.wework.com/workplaceone/api/common-booking/inventory-details` +
      `?propertyType=2&propertyId=${locationId}&spaceType=0` +
      `&startDate=${dateParam}&endDate=&duration=0&roomTypeFilter=` +
      `&locationOffset=${offset}&capacity=0&limit=0&offset=0&floorId=0` +
      `&spaceId=${spaceUuid}&useInventoryUuid=true&platFormType=1`;
    const res = await fetch(url, {
      method: "GET",
      credentials: "include",
      headers: commonHeaders(auth),
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`inventory-details returned non-JSON (HTTP ${res.status})`);
    }
    if (!res.ok) {
      throw new Error(`inventory-details HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    return data;
  }

  // Pull a usable {SpaceID, WeWorkSpaceID, locationName} out of the
  // inventory-details response.
  //
  // The captured booking used SpaceID="2293" (a numeric string) and
  // WeWorkSpaceID="1c8df6c4-2011-11ea-96f8-0ab26917b63b". Both look like
  // they identify a specific *desk inventory item*, not the location.
  // Past response shapes seen:
  //   - Top-level `inventoryUuid` was a photo asset, not the booking UUID.
  //   - `inventory` was an object, not a scalar.
  // So we need to look inside `inventory` (or wherever the real data lives).
  function asString(v, fallback = "") {
    if (v == null) return fallback;
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    if (typeof v === "object") {
      return (
        v.line1 || v.Line1 || v.address || v.Address ||
        v.name || v.Name || v.value || v.Value || fallback
      );
    }
    return fallback;
  }

  // Heuristic helpers retired — we now use the confirmed inventory.{id,uuid}
  // shape directly.

  function extractInventory(data, locationName, debugLog) {
    if (!data || typeof data !== "object") return null;

    // Confirmed shape (April 2026):
    //   { location: {name, address, city, country, ...},
    //     inventory: { id, uuid, capacity, ... },
    //     kubeSpaceId: "16515",       <-- THIS is the SpaceID for booking
    //     inventoryUuid: "...",       <-- per-day reservation UUID, not used in body
    //     price }
    //
    // The captured booking sent SpaceID="2293" — a numeric string. The only
    // numeric-string field in the live response is `kubeSpaceId`, which has
    // the right look. `inventory.id` is `0` here (placeholder). The
    // `inventory.uuid` is the WeWorkSpaceID.
    const invObj = data.inventory || data.Inventory;
    const loc = data.location || data.Location || {};
    const kubeSpaceId = data.kubeSpaceId ?? data.KubeSpaceId ?? data.kubeSpaceID;
    const spaceUuid = invObj && (invObj.uuid || invObj.UUID);

    if (kubeSpaceId != null && spaceUuid) {
      const name = asString(loc.name || loc.Name, locationName);
      return {
        spaceId: String(kubeSpaceId),
        weworkSpaceId: String(spaceUuid),
        locationName: name,
        address: name,
        city: asString(loc.city || loc.City),
        country: asString(loc.country || loc.Country),
      };
    }

    if (debugLog) {
      debugLog(
        `extractor: kubeSpaceId=${kubeSpaceId}, inventory.uuid=${spaceUuid ? "yes" : "no"}, inventory.id=${invObj?.id}`
      );
    }
    return null;
  }

  function buildBookingBody({ inventory, locationId, dateISO, includeCreditCharged }) {
    const { startUTC, endUTC } = localTimesToUtcISO(dateISO);
    const offset = localOffsetForDate(dateISO);
    const dateObj = new Date(`${dateISO}T12:00:00`);
    const dayFormatted = dateObj.toLocaleDateString("en-GB", {
      weekday: "long", month: "long", day: "numeric"
    });

    const body = {
      ApplicationType: "WorkplaceOne",
      SpaceType: 4,
      ReservationID: "",
      TriggerCalendarEvent: true,
      Notes: {
        locationAddress: inventory.address || inventory.locationName,
        locationCity: inventory.city || "",
        locationState: "",
        locationCountry: inventory.country || "",
        locationName: inventory.locationName,
      },
      MailData: {
        dayFormatted,
        startTimeFormatted: "06:00 AM",
        endTimeFormatted: "23:59 PM",
        locationAddress: inventory.address || inventory.locationName,
        creditsUsed: "0",
        Capacity: "1",
        TimezoneUsed: `GMT ${offset}`,
        TimezoneIana: "Europe/London",
        startDateTime: `${dateISO} 06:00`,
        endDateTime: `${dateISO} 23:59`,
        locationName: inventory.locationName,
        locationCity: inventory.city || "",
        locationCountry: inventory.country || "",
        locationState: "",
      },
      LocationType: 2,
      UTCOffset: offset,
      Currency: "com.wework.credits",
      SpaceTypeID: 0,
      LocationID: locationId,
      SpaceID: inventory.spaceId,
      WeWorkSpaceID: inventory.weworkSpaceId,
      StartTime: startUTC,
      EndTime: endUTC,
      PlatFormTypeEnum: 1,
    };
    if (includeCreditCharged) body.CreditCharged = 0;
    return body;
  }

  async function postQuote({ auth, body }) {
    const res = await fetch(
      "https://members.wework.com/workplaceone/api/common-booking/quote",
      {
        method: "POST",
        credentials: "include",
        headers: { ...commonHeaders(auth), "content-type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { _raw: text }; }
    if (!res.ok) {
      throw new Error(`/quote HTTP ${res.status}: ${text.slice(0, 250)}`);
    }
    // Some APIs return 200 with an error envelope; surface that.
    if (data && (data.error || data.Error || data.success === false)) {
      throw new Error(`/quote rejected: ${JSON.stringify(data).slice(0, 250)}`);
    }
    return data;
  }

  async function fetchUpcomingBookings({ auth }) {
    const url =
      "https://members.wework.com/workplaceone/api/common-booking/get-app-upcoming-bookings" +
      "?isPastBooking=false&platFormType=1&startDate=&endDate=";
    const res = await fetch(url, {
      method: "GET",
      credentials: "include",
      headers: commonHeaders(auth),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`upcoming-bookings HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`upcoming-bookings returned non-JSON`);
    }
  }

  // Walk an upcoming-bookings response and pull out a list of
  // { dateISO, locationId, locationName } entries. The response shape isn't
  // documented, so we look for any node carrying a date-like string and a
  // nearby location reference. We accept several common field names.
  function extractBookedDays(data) {
    const found = [];
    const seen = new Set();
    const ISO_DATE_RE = /^(\d{4}-\d{2}-\d{2})/;
    const MMDDYYYY_RE = /^(\d{2})\/(\d{2})\/(\d{4})/;

    function pickDate(node) {
      const candidates = [
        node.startDate, node.StartDate, node.startTime, node.StartTime,
        node.bookingDate, node.BookingDate, node.date, node.Date,
        node.localStartDate, node.LocalStartDate, node.startDateTime,
        node.StartDateTime, node.start_date, node.start_time,
      ];
      for (const c of candidates) {
        if (typeof c !== "string") continue;
        const iso = c.match(ISO_DATE_RE);
        if (iso) return iso[1];
        const us = c.match(MMDDYYYY_RE);
        if (us) return `${us[3]}-${us[1]}-${us[2]}`;
      }
      return null;
    }

    function pickLocation(node) {
      const loc = node.location || node.Location || {};
      const id =
        node.locationUUID || node.LocationUUID ||
        node.locationId || node.LocationID ||
        node.locationUuid || loc.uuid || loc.UUID || loc.id || loc.Id ||
        node.locationID;
      const name =
        loc.name || loc.Name || node.locationName || node.LocationName ||
        node.location_name || "";
      return { id: id ? String(id) : null, name: String(name || "") };
    }

    function walk(node) {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      const date = pickDate(node);
      if (date) {
        const { id, name } = pickLocation(node);
        const key = `${date}|${id || ""}`;
        if (!seen.has(key)) {
          seen.add(key);
          found.push({ dateISO: date, locationId: id, locationName: name });
        }
      }
      for (const v of Object.values(node)) {
        if (v && typeof v === "object") walk(v);
      }
    }
    walk(data);
    return found;
  }

  async function postBooking({ auth, body }) {
    const res = await fetch(
      "https://members.wework.com/workplaceone/api/common-booking/",
      {
        method: "POST",
        credentials: "include",
        headers: { ...commonHeaders(auth), "content-type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { _raw: text }; }
    if (!res.ok) {
      throw new Error(`/common-booking HTTP ${res.status}: ${text.slice(0, 250)}`);
    }
    // Verify it actually committed. We look for an order/reservation ID — the
    // captured success had `order_status: FULFILLED` with an order_uuid.
    const orderId =
      data.OrderUUID || data.orderUuid || data.order_uuid ||
      data.ReservationUUID || data.reservationUuid || data.ReservationID ||
      data.OrderID || data.orderId || data.id || data.Id;
    const status =
      data.Status || data.status || data.OrderStatus || data.order_status || "";
    const looksFulfilled =
      orderId || /fulfilled|confirmed|success/i.test(String(status));
    if (!looksFulfilled) {
      throw new Error(
        `/common-booking returned 200 but no order id. Body: ${JSON.stringify(data).slice(0, 250)}`
      );
    }
    return { data, orderId, status };
  }

  // ---- one day ----------------------------------------------------------
  async function bookOneDay({ auth, dateISO, location, dryRun }) {
    if (cancelled) throw new Error("cancelled");

    // Step 1: discover bookable space UUID for this location/date.
    // The live locations API doesn't expose inventoryUuid (the static
    // member-portal list did), so we fall back to the get-spaces endpoint.
    const spacesResp = await fetchSpaces({
      auth, locationId: location.id, dateISO,
    });
    if (cancelled) throw new Error("cancelled");
    const spaceUuid = pickSpaceUUID(spacesResp, location.id, (m) =>
      log(`  ${m}`, "info")
    );
    if (!spaceUuid) {
      const peek = JSON.stringify(spacesResp).slice(0, 600);
      log(`  get-spaces response (first 600 chars): ${peek}`, "warn");
      throw new Error("no bookable space returned for this location/date");
    }

    // Step 2: get pricing/SpaceID for that specific space.
    const inventoryResp = await fetchInventory({
      auth, locationId: location.id, dateISO, spaceUuid,
    });
    if (cancelled) throw new Error("cancelled");

    if (inventoryResp && typeof inventoryResp === "object") {
      const topKeys = Object.keys(inventoryResp).join(", ");
      log(`  inventory keys: ${topKeys}`, "info");
    }

    const inv = extractInventory(inventoryResp, location.name, (m) =>
      log(`  ${m}`, "info")
    );
    if (!inv) {
      const peek = JSON.stringify(inventoryResp).slice(0, 800);
      log(`  inventory response (first 800 chars): ${peek}`, "warn");
      throw new Error("no usable space in inventory response");
    }
    log(
      `  resolved SpaceID=${inv.spaceId} WeWorkSpaceID=${inv.weworkSpaceId.slice(0, 8)}…`,
      "info"
    );

    // Step 3: Quote
    const body = buildBookingBody({
      inventory: inv, locationId: location.id, dateISO,
      includeCreditCharged: false,
    });
    await postQuote({ auth, body });
    if (cancelled) throw new Error("cancelled");

    if (dryRun) {
      log(`  DRY RUN: quote ok, would book.`, "ok");
      return { location: inv.locationName, dryRun: true };
    }

    // Step 4: Real booking
    const bookBody = buildBookingBody({
      inventory: inv, locationId: location.id, dateISO,
      includeCreditCharged: true,
    });
    const result = await postBooking({ auth, body: bookBody });
    log(
      `  booked (order ${result.orderId || "?"}, ${result.status || "ok"})`,
      "ok"
    );
    return { location: inv.locationName, orderId: result.orderId };
  }

  // Interruptible sleep — resolves early if cancellation is requested.
  function cancellableSleep(ms) {
    return new Promise((resolve) => {
      const t = setInterval(() => {
        if (cancelled) {
          clearInterval(t);
          resolve();
        }
      }, 100);
      setTimeout(() => {
        clearInterval(t);
        resolve();
      }, ms);
    });
  }

  // ---- main loop --------------------------------------------------------
  async function run(cfg) {
    cancelled = false;

    const auth = findAuth();
    if (!auth) {
      log("Could not find auth token. Make sure you're logged in.", "err");
      chrome.runtime.sendMessage({ type: "WW_DONE" }).catch(() => {});
      return;
    }
    log(
      `Auth ok, token expires in ~${Math.floor(auth.expiresInSec / 60)} min`,
      "info"
    );

    // Fetch existing bookings so we can skip days we've already booked
    // and verify new ones afterwards.
    let existing = [];
    let existingDates = new Set();
    if (window.WW_BOOKINGS) {
      const r = await window.WW_BOOKINGS.fetchUpcoming(commonHeaders(auth));
      if (r.ok) {
        existing = r.bookings;
        existingDates = window.WW_BOOKINGS.dateSet(existing);
        log(`Loaded ${existing.length} existing booking(s) for skip-check`, "info");
      } else {
        log(`Couldn't load existing bookings (${r.error}), continuing anyway`, "warn");
      }
    }

    // Each item is { dateISO, location } — distinct location per date.
    const items = Array.isArray(cfg.items) ? cfg.items : [];
    log(`Will book ${items.length} day(s):`, "info");
    for (const it of items) {
      log(`  ${it.dateISO} → ${it.location?.name || "??"}`, "info");
    }

    const results = [];
    let stopped = false;
    const total = items.length;

    chrome.runtime.sendMessage({ type: "WW_PROGRESS", done: 0, total }).catch(() => {});

    for (const { dateISO, location } of items) {
      if (cancelled) {
        log("Stopped before this day.", "warn");
        stopped = true;
        break;
      }
      log(`→ ${dateISO} (${location.name})`);

      // Skip if already booked.
      if (existingDates.has(dateISO)) {
        const dup = window.WW_BOOKINGS?.findByDate(existing, dateISO);
        const where = dup
          ? `${dup.locationName}${dup.spaceName ? ` (${dup.spaceName})` : ""}`
          : "elsewhere";
        log(`  already booked at ${where}, skipping`, "warn");
        results.push({
          dateISO, ok: true, skipped: true,
          location: dup?.locationName || "",
          spaceName: dup?.spaceName || "",
          orderId: dup?.bookingId || "",
        });
        chrome.runtime.sendMessage({
          type: "WW_PROGRESS", done: results.length, total,
        }).catch(() => {});
        continue;
      }

      try {
        const r = await bookOneDay({
          auth, dateISO, location, dryRun: cfg.dryRun,
        });
        results.push({ dateISO, ok: true, ...r });
      } catch (e) {
        if (e.message === "cancelled") {
          log(`  stop received mid-booking — interrupted at ${dateISO}`, "warn");
          stopped = true;
          break;
        }
        log(`✗ ${dateISO}: ${e.message}`, "err");
        results.push({ dateISO, ok: false, error: e.message });
        log(`Stopping: a day failed and 'stop on failure' is the configured behaviour.`, "err");
        stopped = true;
        break;
      }
      chrome.runtime.sendMessage({
        type: "WW_PROGRESS", done: results.length, total,
      }).catch(() => {});
      // Polite gap between requests, but break early if Stop is pressed.
      await cancellableSleep(1200);
    }

    // After a real run, re-fetch the bookings list and try to verify each
    // newly-created booking turned up. Skip verification if the user pressed
    // Stop — they want it stopped, not delayed by another fetch.
    if (!cfg.dryRun && !cancelled && window.WW_BOOKINGS) {
      const newlyBookedDates = results
        .filter((r) => r.ok && !r.skipped && !r.dryRun)
        .map((r) => r.dateISO);
      if (newlyBookedDates.length > 0) {
        log(`Verifying ${newlyBookedDates.length} new booking(s)…`, "info");
        await cancellableSleep(1500);
        const after = await window.WW_BOOKINGS.fetchUpcoming(commonHeaders(auth));
        if (after.ok) {
          for (const r of results) {
            if (r.skipped || !r.ok || r.dryRun) continue;
            const verified = window.WW_BOOKINGS.findByDate(after.bookings, r.dateISO);
            if (verified) {
              r.verifiedBookingId = verified.bookingId;
              r.verifiedLocation = verified.locationName;
              r.verifiedSpace = verified.spaceName;
            } else {
              r.verifyFailed = true;
            }
          }
        } else {
          log(`Couldn't re-fetch bookings to verify (${after.error})`, "warn");
        }
      }
    }

    // Summary
    const ok = results.filter((r) => r.ok && !r.skipped).length;
    const skipped = results.filter((r) => r.skipped).length;
    const fail = results.filter((r) => !r.ok).length;
    const notAttempted = items.length - results.length;
    log(`──────── Summary ────────`, "info");
    log(
      `Booked: ${ok}, skipped (already booked): ${skipped}, failed: ${fail}, not attempted: ${notAttempted}`,
      fail ? "warn" : "ok"
    );
    for (const r of results) {
      if (r.skipped) {
        const where = r.location
          ? `${r.location}${r.spaceName ? ` / ${r.spaceName}` : ""}`
          : "(existing)";
        log(
          `  ${r.dateISO}  SKIP  already at ${where}${r.orderId ? `  (#${r.orderId})` : ""}`,
          "warn"
        );
      } else if (r.ok && r.dryRun) {
        log(`  ${r.dateISO}  DRY   ${r.location}`, "ok");
      } else if (r.ok && r.verifiedBookingId) {
        log(
          `  ${r.dateISO}  OK    #${r.verifiedBookingId}  ${r.verifiedLocation}${
            r.verifiedSpace ? ` / ${r.verifiedSpace}` : ""
          }`,
          "ok"
        );
      } else if (r.ok && r.verifyFailed) {
        log(
          `  ${r.dateISO}  OK?   booked but not seen in upcoming list (#${r.orderId || "?"})`,
          "warn"
        );
      } else if (r.ok) {
        log(
          `  ${r.dateISO}  OK    #${r.orderId || "?"}  ${r.location}`,
          "ok"
        );
      } else {
        log(`  ${r.dateISO}  FAIL  ${r.error}`, "err");
      }
    }
    chrome.runtime.sendMessage({ type: "WW_DONE" }).catch(() => {});
  }

  // ---- message bridge ---------------------------------------------------
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "WW_START") {
      run(msg.config).catch((e) => log(`Fatal: ${e.message}`, "err"));
      sendResponse({ ok: true });
    } else if (msg?.type === "WW_STOP") {
      cancelled = true;
      sendResponse({ ok: true });
    } else if (msg?.type === "WW_GET_BOOKINGS") {
      // Async response — return true to keep the channel open.
      (async () => {
        try {
          const auth = findAuth();
          if (!auth) {
            sendResponse({ ok: false, error: "no auth token on page" });
            return;
          }
          if (!window.WW_BOOKINGS) {
            sendResponse({ ok: false, error: "bookings module not loaded" });
            return;
          }
          const r = await window.WW_BOOKINGS.fetchUpcoming(commonHeaders(auth));
          if (!r.ok) {
            sendResponse({ ok: false, error: r.error });
            return;
          }
          // Strip `raw` (large) but forward the cancel-relevant fields so
          // the popup can ask to cancel without another fetch.
          const slim = r.bookings.map((b) => ({
            bookingId: b.bookingId,
            dateISO: b.dateISO,
            locationId: b.locationId,
            locationName: b.locationName,
            locationAddress: b.locationAddress,
            locationCity: b.locationCity,
            locationCountry: b.locationCountry,
            locationType: b.locationType,
            spaceName: b.spaceName,
            spaceId: b.spaceId,
            reservationId: b.reservationId,
            startDate: b.startDate,
            endDate: b.endDate,
            creditCost: b.creditCost,
          }));
          sendResponse({ ok: true, bookings: slim });
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
      })();
      return true; // keep channel open for async sendResponse
    } else if (msg?.type === "WW_CANCEL_BOOKINGS") {
      // Cancel one or more bookings. Bookings are passed in directly so we
      // don't have to re-fetch the upcoming list. Returns per-booking
      // results so the popup can show partial-success.
      (async () => {
        try {
          const auth = findAuth();
          if (!auth) {
            sendResponse({ ok: false, error: "no auth token on page" });
            return;
          }
          if (!window.WW_BOOKINGS) {
            sendResponse({ ok: false, error: "bookings module not loaded" });
            return;
          }
          const headers = commonHeaders(auth);
          const bookings = Array.isArray(msg.bookings) ? msg.bookings : [];
          const results = [];
          for (const b of bookings) {
            const r = await window.WW_BOOKINGS.cancelBooking(headers, b);
            results.push({ bookingId: b.bookingId, dateISO: b.dateISO, ...r });
            // Small gap between cancel calls.
            await new Promise((res) => setTimeout(res, 600));
          }
          sendResponse({ ok: true, results });
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
      })();
      return true;
    } else if (msg?.type === "WW_GET_LOCATIONS") {
      // Fetch the live locations for the requested city + server-side
      // favorites in parallel. msg.city is { name, latitude, longitude };
      // omitted = default (London).
      (async () => {
        try {
          const auth = findAuth();
          if (!auth) {
            sendResponse({ ok: false, error: "no auth token on page" });
            return;
          }
          if (!window.WW_LOCATIONS) {
            sendResponse({ ok: false, error: "locations module not loaded" });
            return;
          }
          const headers = commonHeaders(auth);
          const [locsR, favsR] = await Promise.all([
            window.WW_LOCATIONS.fetchLocations(
              headers, auth.accountUUID, msg.city
            ),
            window.WW_LOCATIONS.fetchFavorites(headers),
          ]);
          if (!locsR.ok) {
            sendResponse({ ok: false, error: `locations: ${locsR.error}` });
            return;
          }
          // Favorites failing is non-fatal. Map → array of pairs for IPC.
          const favorites = favsR.ok
            ? Array.from(favsR.favorites.entries())
            : [];
          sendResponse({
            ok: true,
            locations: locsR.locations,
            favorites,
            favoritesError: favsR.ok ? null : favsR.error,
          });
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
      })();
      return true;
    } else if (msg?.type === "WW_GET_CITIES") {
      (async () => {
        try {
          const auth = findAuth();
          if (!auth) {
            sendResponse({ ok: false, error: "no auth token on page" });
            return;
          }
          const headers = commonHeaders(auth);
          const r = await window.WW_LOCATIONS.fetchCities(headers);
          sendResponse(r);
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
      })();
      return true;
    } else if (msg?.type === "WW_TOGGLE_FAVORITE") {
      // action: "add" | "remove"
      // location: { id, name, image, ... }
      // favoriteId: required for "remove" only
      // Returns { ok, favoriteId?, error? } — popup updates state on success.
      (async () => {
        try {
          const auth = findAuth();
          if (!auth) {
            sendResponse({ ok: false, error: "no auth token on page" });
            return;
          }
          if (!window.WW_LOCATIONS) {
            sendResponse({ ok: false, error: "locations module not loaded" });
            return;
          }
          const headers = commonHeaders(auth);
          let r;
          if (msg.action === "remove") {
            r = await window.WW_LOCATIONS.removeFavorite(
              headers, msg.location, msg.favoriteId
            );
          } else {
            r = await window.WW_LOCATIONS.addFavorite(headers, msg.location);
          }
          sendResponse(r);
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
      })();
      return true;
    }
    return false;
  });
})();
