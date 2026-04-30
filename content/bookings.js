// content/bookings.js — fetches and parses the upcoming bookings list.
//
// Endpoint: configurable via UPCOMING_BOOKINGS_URL below.
// Replace the URL with the exact path you see in DevTools → Network when
// the bookings page loads. Common names for this endpoint include:
//   /workplaceone/api/common-booking/upcoming-bookings
//   /workplaceone/api/common-booking/upcoming-reservations
//   /workplaceone/api/common-booking/all-bookings
//   /workplaceone/api/common-booking/booking-history
//
// Until the right URL is set, the bookings features (skip already-booked,
// post-booking verification, "already booked" badge in the calendar) will
// be silently skipped — the booker still works without them.

window.WW_BOOKINGS = (() => {
  // Endpoint confirmed from DevTools (April 2026):
  //   GET /workplaceone/api/common-booking/get-app-upcoming-bookings
  //       ?isPastBooking=false&platFormType=1&startDate=&endDate=
  // Returns a flat array of booking objects with .bookingDate, .location, etc.
  const UPCOMING_BOOKINGS_URL =
    "https://members.wework.com/workplaceone/api/common-booking/get-app-upcoming-bookings" +
    "?isPastBooking=false&platFormType=1&startDate=&endDate=";

  function isoDateOnly(s) {
    // "2026-04-30T06:00:00Z"  →  "2026-04-30"
    if (typeof s !== "string") return null;
    return s.slice(0, 10);
  }

  // Normalise a raw booking object into the minimum shape the rest of the
  // code uses. Defensive against shape drift — only the fields we actually
  // need are extracted.
  function normalise(b) {
    if (!b || typeof b !== "object") return null;
    const dateISO =
      isoDateOnly(b.bookingDate) ||
      isoDateOnly(b.startDate) ||
      isoDateOnly(b.start_date);
    if (!dateISO) return null;
    return {
      bookingId: String(b.bookingId ?? b.BookingId ?? b.id ?? ""),
      dateISO,
      locationId: b.location?.id || b.location?.Id || b.locationId || "",
      locationName: b.location?.name || b.location?.Name || b.locationName || "",
      locationAddress:
        b.location?.address?.line1 || b.location?.address?.Line1 || "",
      locationCity:
        b.location?.address?.city || b.location?.address?.City || "",
      locationCountry:
        b.location?.address?.country || b.location?.address?.Country || "",
      locationType: b.location?.type ?? b.locationType ?? 2,
      spaceName: b.spaceName || b.SpaceName || "",
      spaceId: b.spaceId || b.SpaceId || b.spaceExternalReference || "",
      // The cancel endpoint wants this as `reservationId`. The upcoming list
      // exposes it as `kubeBookingExternalReference`.
      reservationId:
        b.kubeBookingExternalReference || b.KubeBookingExternalReference || "",
      // Times in the booking, used to populate the cancel body.
      startDate: b.startDate || b.bookingDate || b.start_date || "",
      endDate: b.endDate || b.end_date || "",
      creditCost: b.creditCost ?? b.CreditCost ?? 0,
      isCancelled: !!(b.isCancelled || b.IsCancelled),
      raw: b,
    };
  }

  async function fetchUpcoming(authHeaders) {
    try {
      const res = await fetch(UPCOMING_BOOKINGS_URL, {
        method: "GET",
        credentials: "include",
        headers: authHeaders,
      });
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}` };
      }
      const data = await res.json();
      const list = Array.isArray(data)
        ? data
        : Array.isArray(data?.bookings)
        ? data.bookings
        : Array.isArray(data?.Bookings)
        ? data.Bookings
        : Array.isArray(data?.data)
        ? data.data
        : [];
      const bookings = list
        .map(normalise)
        .filter((b) => b && !b.isCancelled);
      return { ok: true, bookings };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // Convenience: build a Set of date strings for which the user already
  // has a booking. Used to mark already-booked dates in the calendar and
  // to skip them at run time.
  function dateSet(bookings) {
    const s = new Set();
    for (const b of bookings) s.add(b.dateISO);
    return s;
  }

  function findByDate(bookings, dateISO) {
    return bookings.find((b) => b.dateISO === dateISO) || null;
  }

  // Cancel a single booking. Mirrors the body the WeWork web UI sends.
  // Pass a normalised booking (the shape returned by fetchUpcoming).
  async function cancelBooking(authHeaders, booking) {
    const url =
      "https://members.wework.com/workplaceone/api/common-booking/cancel" +
      "?isOnDemand=false&platFormType=1";

    // Build the mailParams chunk. The cancel UI sends a "human" version of
    // the date for the email; we generate it from the start time.
    const start = new Date(booking.startDate || `${booking.dateISO}T06:00:00Z`);
    const dayFormatted = start.toLocaleDateString("en-GB", {
      weekday: "long", month: "long", day: "numeric",
    });

    const body = {
      bookingId: booking.bookingId,
      bookingLocationType: booking.locationType ?? 2,
      creditsUsed: booking.creditCost ?? 0,
      // Strip trailing 'Z' to match the captured request, which sent
      // "2026-05-05T06:00:00.000" not "...Z".
      startTime: stripZ(booking.startDate),
      endTime: stripZ(booking.endDate),
      locationId: booking.locationId,
      reservableId: booking.spaceId,
      isBookingApprovalOn: false,
      bookingType: 4,            // SharedWorkspace, matches captured request
      spaceId: booking.spaceId,
      cancellationNote: "",
      mailParams: {
        workspaceType: 1,
        dayFormatted,
        startTimeFormatted: stripZ(booking.startDate),
        endTimeFormatted: stripZ(booking.endDate),
        floorAddress: "",
        locationAddress: booking.locationAddress || booking.locationName || "",
        locationCountry: booking.locationCountry || "",
      },
      reservationId: booking.reservationId || "",
    };

    try {
      const res = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: { ...authHeaders, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
      }
      // Captured response was the literal string "true". Accept that, plus
      // any JSON-shaped success.
      if (text.trim() === "true") return { ok: true };
      try {
        const data = JSON.parse(text);
        if (data === true || data?.success === true || data?.ok === true) {
          return { ok: true, data };
        }
        // Some endpoints return a body even on success; treat 2xx as ok.
        return { ok: true, data };
      } catch {
        return { ok: true, raw: text };
      }
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  function stripZ(s) {
    if (typeof s !== "string") return s;
    return s.endsWith("Z") ? s.slice(0, -1) : s;
  }

  return {
    fetchUpcoming, dateSet, findByDate, cancelBooking, UPCOMING_BOOKINGS_URL,
  };
})();
