// Locations and favorites are fetched live from WeWork's APIs at popup
// open time (see WW_GET_LOCATIONS message). We expose them via getters
// over state.locations so the rest of the file can keep using
// LONDON_LOCATIONS without caring about the source.
const LONDON_LOCATIONS = {
  find(predicate) {
    return state.locations.find(predicate);
  },
  filter(predicate) {
    return state.locations.filter(predicate);
  },
};

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = "hotdeskerConfig";
const LEGACY_STORAGE_KEY = "weworkAutobookConfig";

// One-time migration: if the new key is empty but the legacy key has data,
// copy it over and remove the legacy entry. Safe to leave in indefinitely;
// becomes a no-op once everyone has migrated.
async function migrateStorage() {
  const items = await chrome.storage.local.get([STORAGE_KEY, LEGACY_STORAGE_KEY]);
  if (!items[STORAGE_KEY] && items[LEGACY_STORAGE_KEY]) {
    await chrome.storage.local.set({ [STORAGE_KEY]: items[LEGACY_STORAGE_KEY] });
    await chrome.storage.local.remove(LEGACY_STORAGE_KEY);
  }
}

// ---- date helpers ---------------------------------------------------------

function todayLocalISO() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function isoFromYMD(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function todayMidnight() {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t;
}

const MAX_BOOKING_HORIZON_DAYS = 30;
function maxBookableDate() {
  const d = todayMidnight();
  d.setDate(d.getDate() + MAX_BOOKING_HORIZON_DAYS);
  return d;
}

// ---- color palette --------------------------------------------------------
// A small fixed palette, colors picked deterministically per location id.
// Distinct enough to read at 6px while staying restrained.
const COLOR_PALETTE = [
  "#0f1419", // near-black
  "#3b82f6", // blue
  "#16a34a", // green
  "#a855f7", // purple
  "#f97316", // orange
  "#0891b2", // teal
  "#dc2626", // red
  "#65a30d", // olive
  "#9333ea", // violet
  "#ea580c", // amber
  "#0369a1", // sky
  "#be185d", // pink
];
function colorForLocationId(id) {
  // Stable hash → palette index.
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  return COLOR_PALETTE[h % COLOR_PALETTE.length];
}

// ---- escape ---------------------------------------------------------------
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// ---- state ----------------------------------------------------------------

const state = {
  // Live locations from /get-locations-by-geo. Empty until fetched.
  locations: [],
  // Current city. Per-session: defaults to London, no persistence.
  currentCity: { name: "London", latitude: 51.5074, longitude: -0.1278 },
  // Cities list, fetched lazily when the picker first opens.
  cities: null,
  // Map<dateISO, locationId> — what the user wants to book.
  // NOT persisted: cleared on every popup open.
  assignments: new Map(),
  // Map<dateISO, {bookingId, locationId, locationName, spaceName, ...}>
  // From the upcoming-bookings API. Locked from re-assignment.
  bookedDates: new Map(),
  // Server-side favorites: Map<locationId, favoriteId>. Need the favoriteId
  // to send the unfavorite request. Read-only-via-app no longer applies —
  // hearts are clickable now.
  favorites: new Map(),
  cursor: (() => {
    const t = new Date();
    return { year: t.getFullYear(), month: t.getMonth() };
  })(),
  searchTerm: "",
  // The date the modal is currently editing (or null when modal closed).
  editingDate: null,
  // Cancel mode: when true, tapping a booked day toggles its selection
  // for bulk cancel. Clear/exit via the bar at the bottom of the calendar.
  cancelMode: false,
  cancelSelected: new Set(), // Set<bookingId>
};

// ---- calendar -------------------------------------------------------------

function renderCalendar() {
  const { year, month } = state.cursor;
  const monthName = new Date(year, month, 1).toLocaleString("default", {
    month: "long",
    year: "numeric",
  });
  $("monthLabel").textContent = monthName;

  // Disable nav buttons that would leave bookable territory.
  const today = todayMidnight();
  const max = maxBookableDate();
  const prevMonthLast = new Date(year, month, 0); // last day of prev month
  $("prevMonth").disabled = prevMonthLast < today;
  const nextMonthFirst = new Date(year, month + 1, 1);
  $("nextMonth").disabled = nextMonthFirst > max;

  const cal = $("calendar");
  cal.innerHTML = "";

  const dows = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  for (const dow of dows) {
    const h = document.createElement("div");
    h.className = "cal-dow";
    h.textContent = dow;
    cal.appendChild(h);
  }

  const firstOfMonth = new Date(year, month, 1);
  const startCol = (firstOfMonth.getDay() + 6) % 7; // Mon-first
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayISO = todayLocalISO();

  for (let i = 0; i < startCol; i++) {
    const blank = document.createElement("div");
    blank.className = "cal-day empty";
    cal.appendChild(blank);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const cell = document.createElement("div");
    const iso = isoFromYMD(year, month, d);
    const cellDate = new Date(year, month, d);
    const isWeekend = cellDate.getDay() === 0 || cellDate.getDay() === 6;
    const isPast = cellDate < today;
    const isBeyond = cellDate > max;
    const existingBooking = state.bookedDates.get(iso);
    const assignedLocId = state.assignments.get(iso);

    cell.className = "cal-day";
    cell.textContent = d;
    cell.dataset.iso = iso;

    if (isPast) cell.classList.add("past");
    if (isBeyond) cell.classList.add("out-of-range");
    if (isWeekend) cell.classList.add("weekend");
    if (iso === todayISO) cell.classList.add("today");

    if (existingBooking) {
      cell.classList.add("booked");
      cell.title = `Already booked at ${existingBooking.locationName}${
        existingBooking.spaceName ? ` (${existingBooking.spaceName})` : ""
      } — #${existingBooking.bookingId}`;
      const dot = document.createElement("span");
      dot.className = "cell-dot";
      cell.appendChild(dot);
      // Visual marker for cancel-mode selections.
      if (state.cancelMode && state.cancelSelected.has(existingBooking.bookingId)) {
        cell.classList.add("cancel-pick");
      }
    } else if (assignedLocId) {
      const loc = LONDON_LOCATIONS.find((l) => l.id === assignedLocId);
      if (loc) {
        cell.classList.add("assigned");
        cell.style.setProperty("--cell-color", colorForLocationId(loc.id));
        cell.title = `${loc.name}${loc.address ? ` — ${loc.address}` : ""}`;
        const dot = document.createElement("span");
        dot.className = "cell-dot";
        cell.appendChild(dot);
      }
    } else if (isBeyond) {
      cell.title = `WeWork only allows bookings up to ${MAX_BOOKING_HORIZON_DAYS} days ahead`;
    }

    // Click behaviour:
    //   - Past / out-of-range → not clickable
    //   - Booked + cancel-mode → toggle inclusion in cancel selection
    //   - Booked + normal     → open details modal
    //   - Empty + bookable    → open location picker
    if (!isPast && !isBeyond) {
      if (existingBooking) {
        cell.addEventListener("click", () => {
          // Re-check live state at click time (race-safe).
          const live = state.bookedDates.get(iso);
          if (!live) {
            openPicker(iso);
            return;
          }
          if (state.cancelMode) {
            toggleCancelSelection(live.bookingId);
          } else {
            openDetails(live);
          }
        });
      } else {
        cell.addEventListener("click", () => {
          if (state.bookedDates.has(iso)) return;
          openPicker(iso);
        });
      }
    }
    cal.appendChild(cell);
  }
}

function updateSummary() {
  const n = state.assignments.size;
  $("selectedSummary").textContent =
    n === 0
      ? "No days assigned."
      : `${n} day${n === 1 ? "" : "s"} ready to book.`;
  renderLegend();
}

function renderLegend() {
  const legend = $("legend");
  legend.innerHTML = "";
  // Group dates by location so we can show e.g. "30 Churchill Place (3 days)"
  const grouped = new Map();
  for (const [iso, locId] of state.assignments) {
    if (!grouped.has(locId)) grouped.set(locId, []);
    grouped.get(locId).push(iso);
  }
  if (grouped.size === 0) {
    const empty = document.createElement("div");
    empty.className = "legend-empty";
    empty.textContent = "Tap a day to assign a location.";
    legend.appendChild(empty);
    return;
  }
  for (const [locId, dates] of grouped) {
    const loc = LONDON_LOCATIONS.find((l) => l.id === locId);
    if (!loc) continue;
    const item = document.createElement("span");
    item.className = "legend-item";
    const dot = document.createElement("span");
    dot.className = "legend-dot";
    dot.style.background = colorForLocationId(locId);
    item.appendChild(dot);
    const txt = document.createElement("span");
    txt.textContent = `${loc.name} (${dates.length})`;
    item.appendChild(txt);
    legend.appendChild(item);
  }
}

$("prevMonth").addEventListener("click", () => {
  if (state.cursor.month === 0) {
    state.cursor.month = 11;
    state.cursor.year--;
  } else {
    state.cursor.month--;
  }
  renderCalendar();
});
$("nextMonth").addEventListener("click", () => {
  const max = maxBookableDate();
  const nextFirst = new Date(state.cursor.year, state.cursor.month + 1, 1);
  if (nextFirst > max) return;
  if (state.cursor.month === 11) {
    state.cursor.month = 0;
    state.cursor.year++;
  } else {
    state.cursor.month++;
  }
  renderCalendar();
});

// ---- booking details modal & cancel flow --------------------------------

function openDetails(booking) {
  const dateLabel = new Date(booking.dateISO + "T12:00:00").toLocaleDateString(
    "en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }
  );
  $("detailsSubtitle").textContent = dateLabel;
  const grid = $("detailsGrid");
  grid.innerHTML = "";
  const rows = [
    ["Location", booking.locationName || "—"],
    ["Address", booking.locationAddress || "—"],
    ["Desk", booking.spaceName || "—"],
    ["Booking #", booking.bookingId || "—"],
  ];
  for (const [k, v] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = k;
    const dd = document.createElement("dd");
    dd.textContent = v;
    grid.append(dt, dd);
  }
  $("detailsCancelBtn").dataset.bookingId = booking.bookingId;
  $("detailsBackdrop").hidden = false;
}
function closeDetails() {
  $("detailsBackdrop").hidden = true;
}

function findBookingById(bookingId) {
  for (const b of state.bookedDates.values()) {
    if (b.bookingId === bookingId) return b;
  }
  return null;
}

function setCancelMode(on) {
  state.cancelMode = on;
  document.body.classList.toggle("cancel-mode", on);
  $("cancelModeBtn").textContent = on
    ? "Done selecting"
    : "Select to cancel bookings…";
  $("cancelBar").hidden = !on;
  if (!on) state.cancelSelected.clear();
  renderCancelBar();
  renderCalendar();
}

function toggleCancelSelection(bookingId) {
  if (state.cancelSelected.has(bookingId)) state.cancelSelected.delete(bookingId);
  else state.cancelSelected.add(bookingId);
  renderCancelBar();
  renderCalendar();
}

function renderCancelBar() {
  const n = state.cancelSelected.size;
  $("cancelBarLabel").textContent = `${n} selected`;
  $("cancelGoBtn").disabled = n === 0;
}

let confirmingBookings = [];

function openConfirm(bookings) {
  confirmingBookings = bookings;
  const n = bookings.length;
  $("confirmMsg").textContent =
    n === 1 ? "Cancel this booking?" : `Cancel ${n} bookings?`;
  const list = $("confirmList");
  list.innerHTML = "";
  const sorted = [...bookings].sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  for (const b of sorted) {
    const li = document.createElement("li");
    const dateLabel = new Date(b.dateISO + "T12:00:00").toLocaleDateString(
      "en-GB", { weekday: "short", day: "numeric", month: "short" }
    );
    li.textContent = `${dateLabel} — ${b.locationName}${
      b.spaceName ? ` (${b.spaceName})` : ""
    } #${b.bookingId}`;
    list.appendChild(li);
  }
  $("confirmBackdrop").hidden = false;
}
function closeConfirm() {
  confirmingBookings = [];
  $("confirmBackdrop").hidden = true;
  $("confirmGoBtn").disabled = false;
  $("confirmGoBtn").textContent = "Cancel bookings";
}

async function runCancellations(bookings) {
  clearStatus();
  appendStatus(`Cancelling ${bookings.length} booking(s)…`, "info");
  const tab = await getActiveTab();
  if (!tab?.url || !/members\.wework\.com/.test(tab.url)) {
    appendStatus("Open members.wework.com in this tab first.", "err");
    return;
  }
  let r;
  try {
    r = await chrome.tabs.sendMessage(tab.id, {
      type: "WW_CANCEL_BOOKINGS",
      bookings,
    });
  } catch (err) {
    appendStatus(`Could not reach the page: ${err.message}`, "err");
    return;
  }
  if (!r?.ok) {
    appendStatus(`Cancel request failed: ${r?.error || "unknown"}`, "err");
    return;
  }
  let okCount = 0;
  let failCount = 0;
  for (const res of r.results) {
    if (res.ok) {
      okCount++;
      appendStatus(`✓ ${res.dateISO} — cancelled #${res.bookingId}`, "ok");
    } else {
      failCount++;
      appendStatus(`✗ ${res.dateISO} #${res.bookingId} — ${res.error}`, "err");
    }
  }
  appendStatus(`Done: ${okCount} cancelled, ${failCount} failed.`,
    failCount ? "warn" : "ok");

  setCancelMode(false);
  loadExistingBookings();
}

// Wire up details + cancel-mode + confirm dialog handlers. We can do this at
// module load — the elements exist in the static HTML.
$("detailsClose").addEventListener("click", closeDetails);
$("detailsCloseBtn").addEventListener("click", closeDetails);
$("detailsBackdrop").addEventListener("click", (e) => {
  if (e.target === $("detailsBackdrop")) closeDetails();
});
$("detailsCancelBtn").addEventListener("click", () => {
  const id = $("detailsCancelBtn").dataset.bookingId;
  const booking = findBookingById(id);
  if (!booking) return;
  closeDetails();
  openConfirm([booking]);
});

$("cancelModeBtn").addEventListener("click", () => setCancelMode(!state.cancelMode));
$("cancelClearBtn").addEventListener("click", () => {
  state.cancelSelected.clear();
  renderCancelBar();
  renderCalendar();
});
$("cancelGoBtn").addEventListener("click", () => {
  if (state.cancelSelected.size === 0) return;
  const bookings = Array.from(state.cancelSelected)
    .map((id) => findBookingById(id))
    .filter(Boolean);
  if (bookings.length === 0) return;
  openConfirm(bookings);
});

$("confirmCancelBtn").addEventListener("click", closeConfirm);
$("confirmBackdrop").addEventListener("click", (e) => {
  if (e.target === $("confirmBackdrop")) closeConfirm();
});
$("confirmGoBtn").addEventListener("click", async () => {
  const toCancel = confirmingBookings;
  if (toCancel.length === 0) return;
  $("confirmGoBtn").disabled = true;
  $("confirmGoBtn").textContent = "Cancelling…";
  await runCancellations(toCancel);
  closeConfirm();
});

// Esc closes whichever modal is open.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!$("confirmBackdrop").hidden) closeConfirm();
  else if (!$("detailsBackdrop").hidden) closeDetails();
  else if (!$("cityBackdrop").hidden) closeCityPicker();
  else if (!$("pickerBackdrop").hidden) closePicker();
});

// ---- city picker ---------------------------------------------------------

function updateCityLabel() {
  $("cityLabel").textContent = state.currentCity.name;
}

async function openCityPicker() {
  $("citySearch").value = "";
  $("cityBackdrop").hidden = false;
  // Focus search after the slide-up settles.
  setTimeout(() => $("citySearch").focus(), 200);
  // Lazy-fetch the city list on first open.
  if (state.cities === null) {
    renderCityList(null);
    const tab = await getActiveTab();
    let r;
    try {
      r = await chrome.tabs.sendMessage(tab.id, { type: "WW_GET_CITIES" });
    } catch (e) {
      r = { ok: false, error: e.message };
    }
    if (r?.ok && Array.isArray(r.cities)) {
      state.cities = r.cities;
    } else {
      state.cities = [];
      appendStatus(`Couldn't load cities: ${r?.error || "unknown"}`, "warn");
    }
  }
  renderCityList($("citySearch").value);
}

function closeCityPicker() {
  $("cityBackdrop").hidden = true;
}

function renderCityList(searchTerm) {
  const list = $("cityList");
  list.innerHTML = "";
  // null = still loading (initial state on first open).
  if (state.cities === null) {
    const empty = document.createElement("div");
    empty.className = "loc-empty";
    empty.textContent = "Loading…";
    list.appendChild(empty);
    return;
  }
  const term = (searchTerm || "").trim().toLowerCase();
  const matches = state.cities.filter(
    (c) => !term || c.name.toLowerCase().includes(term)
  );
  if (matches.length === 0) {
    const empty = document.createElement("div");
    empty.className = "loc-empty";
    empty.textContent = "No cities match.";
    list.appendChild(empty);
    return;
  }
  for (const c of matches) {
    const item = document.createElement("div");
    item.className = "loc-item";
    if (c.name === state.currentCity.name) item.classList.add("selected");
    const text = document.createElement("div");
    text.className = "loc-text";
    const name = document.createElement("div");
    name.className = "loc-name";
    name.textContent = c.name;
    text.appendChild(name);
    if (c.country) {
      const addr = document.createElement("div");
      addr.className = "loc-address";
      addr.textContent = c.country;
      text.appendChild(addr);
    }
    item.appendChild(text);
    item.addEventListener("click", () => selectCity(c));
    list.appendChild(item);
  }
}

async function selectCity(c) {
  closeCityPicker();
  if (c.name === state.currentCity.name) return;
  state.currentCity = c;
  state.cityAutoDetected = false;
  // User explicitly picked — remember across popup opens.
  persistPreferredCity(c).catch(() => {});
  state.locations = [];
  state.assignments.clear();
  state.cancelSelected.clear();
  if (state.cancelMode) setCancelMode(false);
  updateCityLabel();
  renderCalendar();
  updateSummary();
  appendStatus(`Switching to ${c.name}…`, "info");
  // Re-fetch locations + favorites for the new city.
  const tab = await getActiveTab();
  let r;
  try {
    r = await chrome.tabs.sendMessage(tab.id, {
      type: "WW_GET_LOCATIONS",
      city: state.currentCity,
    });
  } catch (e) {
    r = { ok: false, error: e.message };
  }
  if (!r?.ok) {
    appendStatus(`Couldn't load locations for ${c.name}: ${r?.error || "unknown"}`, "err");
    return;
  }
  state.locations = r.locations || [];
  state.favorites = new Map(r.favorites || []);
  if (state.locations.length === 0) {
    appendStatus(`No locations available in ${c.name}.`, "warn");
  } else {
    appendStatus(`Loaded ${state.locations.length} location(s) in ${c.name}.`, "ok");
  }
}

$("cityBtn").addEventListener("click", openCityPicker);
$("cityClose").addEventListener("click", closeCityPicker);
$("cityBackdrop").addEventListener("click", (e) => {
  if (e.target === $("cityBackdrop")) closeCityPicker();
});
$("citySearch").addEventListener("input", (e) => renderCityList(e.target.value));

$("cityAutoBtn").addEventListener("click", async () => {
  closeCityPicker();
  await clearPreferredCity();
  // Re-run detection from currently-loaded bookings.
  const sorted = Array.from(state.bookedDates.values()).sort(
    (a, b) => a.dateISO.localeCompare(b.dateISO)
  );
  const firstWithCity = sorted.find((b) => b.locationCity);
  let target;
  if (firstWithCity) {
    target = {
      name: firstWithCity.locationCity,
      latitude: null,
      longitude: null,
    };
  } else {
    // No bookings to detect from — use the WW_LOCATIONS default (London).
    target = { name: "London", latitude: 51.5074, longitude: -0.1278 };
  }
  if (target.name === state.currentCity.name) {
    appendStatus(`Already on ${target.name}.`, "info");
    return;
  }
  // Selecting via selectCity() would persist it as preferred — bypass that
  // by inlining the relevant work and skipping the persist call.
  state.currentCity = target;
  state.cityAutoDetected = true;
  state.locations = [];
  state.assignments.clear();
  state.cancelSelected.clear();
  if (state.cancelMode) setCancelMode(false);
  updateCityLabel();
  renderCalendar();
  updateSummary();
  appendStatus(`Auto-detected ${target.name}…`, "info");
  const tab = await getActiveTab();
  let r;
  try {
    r = await chrome.tabs.sendMessage(tab.id, {
      type: "WW_GET_LOCATIONS",
      city: state.currentCity,
    });
  } catch (e) {
    r = { ok: false, error: e.message };
  }
  if (!r?.ok) {
    appendStatus(`Couldn't load locations: ${r?.error || "unknown"}`, "err");
    return;
  }
  state.locations = r.locations || [];
  state.favorites = new Map(r.favorites || []);
});

// ---- modal picker ---------------------------------------------------------

function openPicker(dateISO) {
  state.editingDate = dateISO;
  const dateLabel = new Date(dateISO + "T12:00:00").toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
  $("pickerSubtitle").textContent = dateLabel;
  $("locationSearch").value = "";
  state.searchTerm = "";
  renderLocationList();
  // Show / hide Remove button based on whether this date is currently assigned.
  $("removeAssignBtn").hidden = !state.assignments.has(dateISO);
  $("pickerBackdrop").hidden = false;
  // Scroll picker to top when it opens.
  $("locationList").scrollTop = 0;
  // Focus search after the slide-up settles.
  setTimeout(() => $("locationSearch").focus(), 200);
}

function closePicker() {
  state.editingDate = null;
  $("pickerBackdrop").hidden = true;
}

$("pickerClose").addEventListener("click", closePicker);
$("pickerBackdrop").addEventListener("click", (e) => {
  if (e.target === $("pickerBackdrop")) closePicker();
});

$("removeAssignBtn").addEventListener("click", () => {
  if (state.editingDate) {
    state.assignments.delete(state.editingDate);
    renderCalendar();
    updateSummary();
  }
  closePicker();
});

// ---- location list (inside modal) -----------------------------------------

function renderLocationList() {
  const list = $("locationList");
  list.innerHTML = "";

  const term = state.searchTerm.trim().toLowerCase();
  const matches = (loc) =>
    !term ||
    loc.name.toLowerCase().includes(term) ||
    (loc.address || "").toLowerCase().includes(term);

  const favs = LONDON_LOCATIONS.filter(
    (l) => state.favorites.has(l.id) && matches(l)
  );
  const others = LONDON_LOCATIONS.filter(
    (l) => !state.favorites.has(l.id) && matches(l)
  );

  if (favs.length === 0 && others.length === 0) {
    const empty = document.createElement("div");
    empty.className = "loc-empty";
    empty.textContent = "No locations match.";
    list.appendChild(empty);
    return;
  }

  const currentLocId = state.editingDate
    ? state.assignments.get(state.editingDate)
    : null;

  if (favs.length > 0) {
    const head = document.createElement("div");
    head.className = "loc-divider";
    head.textContent = "★ Favorites";
    list.appendChild(head);
    for (const loc of favs) list.appendChild(renderLocItem(loc, currentLocId));
  }
  if (others.length > 0) {
    if (favs.length > 0) {
      const head = document.createElement("div");
      head.className = "loc-divider";
      head.textContent = "All locations";
      list.appendChild(head);
    }
    for (const loc of others) list.appendChild(renderLocItem(loc, currentLocId));
  }
}

function renderLocItem(loc, currentLocId) {
  const item = document.createElement("div");
  item.className = "loc-item";
  if (loc.id === currentLocId) item.classList.add("selected");
  item.dataset.id = loc.id;
  item.setAttribute("role", "option");

  // Favorites are server-managed. Clicking the heart toggles via API,
  // with optimistic UI update and revert-on-failure.
  const fav = document.createElement("button");
  fav.className = "loc-fav" + (state.favorites.has(loc.id) ? " is-fav" : "");
  fav.type = "button";
  fav.textContent = state.favorites.has(loc.id) ? "♥" : "♡";
  fav.title = state.favorites.has(loc.id) ? "Unfavorite" : "Favorite";
  fav.addEventListener("click", async (e) => {
    e.stopPropagation();
    await toggleFavorite(loc, fav);
  });

  const text = document.createElement("div");
  text.className = "loc-text";
  const name = document.createElement("div");
  name.className = "loc-name";
  name.textContent = loc.name;
  const addr = document.createElement("div");
  addr.className = "loc-address";
  addr.textContent = loc.address || "";
  text.append(name);
  if (loc.address) text.append(addr);

  item.append(fav, text);
  item.addEventListener("click", () => {
    if (!state.editingDate) return;
    state.assignments.set(state.editingDate, loc.id);
    renderCalendar();
    updateSummary();
    closePicker();
  });
  return item;
}

$("locationSearch").addEventListener("input", (e) => {
  state.searchTerm = e.target.value;
  renderLocationList();
});

// Toggle a location's favorite state via the WeWork API. Optimistic: we
// update state immediately so the UI feels snappy, then revert if the
// request fails. For removes we need the existing favoriteId; for adds we
// store the new favoriteId from the response so a subsequent unfavorite
// works without a re-fetch.
async function toggleFavorite(loc, btnEl) {
  const wasFav = state.favorites.has(loc.id);
  const action = wasFav ? "remove" : "add";
  const existingFavoriteId = wasFav ? state.favorites.get(loc.id) : null;

  // Optimistic flip. For an add, we don't know the favoriteId yet — store a
  // placeholder so the UI shows the heart filled. We'll replace it with the
  // real Id from the response (or revert) below.
  if (wasFav) state.favorites.delete(loc.id);
  else state.favorites.set(loc.id, "pending");
  if (btnEl) btnEl.disabled = true;
  renderLocationList();

  let r;
  try {
    const tab = await getActiveTab();
    r = await chrome.tabs.sendMessage(tab.id, {
      type: "WW_TOGGLE_FAVORITE",
      action,
      location: loc,
      favoriteId: existingFavoriteId,
    });
  } catch (e) {
    r = { ok: false, error: e.message };
  }

  if (!r?.ok) {
    // Revert optimistic change.
    if (wasFav) state.favorites.set(loc.id, existingFavoriteId);
    else state.favorites.delete(loc.id);
    appendStatus(
      `Couldn't ${action} favorite for ${loc.name}: ${r?.error || "unknown"}`,
      "warn"
    );
    renderLocationList();
  } else if (action === "add" && r.favoriteId != null) {
    // Replace placeholder with the real favoriteId.
    state.favorites.set(loc.id, r.favoriteId);
  }
  if (btnEl) btnEl.disabled = false;
}

// ---- persistence ----------------------------------------------------------
// Persist: dryRun + preferredCity. Favorites are server-sourced;
// assignments are per-session.

async function persist() {
  const stored =
    (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] || {};
  await chrome.storage.local.set({
    [STORAGE_KEY]: {
      ...stored,
      dryRun: $("dryRun").checked,
    },
  });
}

async function persistPreferredCity(city) {
  const stored =
    (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] || {};
  await chrome.storage.local.set({
    [STORAGE_KEY]: {
      ...stored,
      preferredCity: city,
    },
  });
}

async function clearPreferredCity() {
  const stored =
    (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] || {};
  delete stored.preferredCity;
  await chrome.storage.local.set({ [STORAGE_KEY]: stored });
}

async function loadConfig() {
  await migrateStorage();
  const stored = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] || {};
  $("dryRun").checked = stored.dryRun ?? true;

  // Decide which city to start with:
  //   1. Persisted preferredCity (user explicitly chose a city before)
  //   2. Auto-detect from most recent upcoming booking
  //   3. Fall back to London
  // We can't auto-detect until checkReadiness has fetched the bookings,
  // so the assignment happens there.
  if (stored.preferredCity) {
    state.currentCity = stored.preferredCity;
    state.cityAutoDetected = false;
  } else {
    state.cityAutoDetected = true; // tells checkReadiness to detect from bookings
  }

  // Run the readiness check before showing the main UI.
  const ready = await checkReadiness();
  if (!ready) return;
  showMain();
  updateCityLabel();
  renderCalendar();
  updateSummary();
  loadExistingBookings();
}

// Decide whether to show the main UI or the "not ready" info screen.
// Returns true if ready (main shown), false if blocked (info shown).
async function checkReadiness() {
  const tab = await getActiveTab();
  const onWework = !!(tab?.url && /^https:\/\/members\.wework\.com\//.test(tab.url));

  if (!onWework) {
    showNotReady({
      title: "Open WeWork to get started",
      bodyHtml:
        "This extension works alongside the WeWork member portal. Open " +
        "<strong>members.wework.com</strong>, sign in, and try again.",
      showOpenBtn: true,
    });
    return false;
  }

  // We're on members.wework.com — see if the content script can find an
  // auth token. The bookings probe doubles as a reachability check.
  let resp;
  try {
    resp = await chrome.tabs.sendMessage(tab.id, { type: "WW_GET_BOOKINGS" });
  } catch (e) {
    // Content script not yet injected — usually means the page hasn't
    // finished loading after a fresh sign-in/redirect.
    showNotReady({
      title: "Page still loading",
      bodyHtml:
        "Couldn't reach the WeWork tab yet. Wait for the page to finish " +
        "loading, then click <strong>Check again</strong>.",
      showOpenBtn: false,
    });
    return false;
  }

  if (resp && resp.ok === false && /no auth/i.test(resp.error || "")) {
    showNotReady({
      title: "Sign in to WeWork",
      bodyHtml:
        "We couldn't find a valid login token on this page. Please sign in " +
        "to <strong>members.wework.com</strong> and click <strong>Check again</strong>.",
      showOpenBtn: false,
    });
    return false;
  }

  // Hand the bookings we just got over to the renderer (so we don't
  // re-fetch them in loadExistingBookings — they're already current).
  if (resp?.ok && Array.isArray(resp.bookings)) {
    state.bookedDates.clear();
    for (const b of resp.bookings) state.bookedDates.set(b.dateISO, b);
  }

  // Auto-detect city from upcoming bookings if no preference is set.
  // Sorted by date so we pick the soonest booking's city — that's almost
  // certainly where the user is currently working.
  if (state.cityAutoDetected && resp?.ok && Array.isArray(resp.bookings)) {
    const sorted = [...resp.bookings].sort(
      (a, b) => a.dateISO.localeCompare(b.dateISO)
    );
    const firstWithCity = sorted.find((b) => b.locationCity);
    if (firstWithCity) {
      state.currentCity = {
        name: firstWithCity.locationCity,
        // Coordinates unknown — the locations API works without them. The
        // city picker can fill them in later if the user opens the cities
        // list.
        latitude: null,
        longitude: null,
      };
    }
    // If detection failed, leave state.currentCity at its default (London).
  }

  // Fetch live locations + favorites. Failure is fatal — show a loud error
  // rather than fall back to a stale list.
  let locResp;
  try {
    locResp = await chrome.tabs.sendMessage(tab.id, {
      type: "WW_GET_LOCATIONS",
      city: state.currentCity,
    });
  } catch (e) {
    showNotReady({
      title: "Couldn't load locations",
      bodyHtml:
        "Tried to fetch the WeWork locations list but the page didn't " +
        "respond. Refresh <strong>members.wework.com</strong> and click " +
        "<strong>Check again</strong>.",
      showOpenBtn: false,
    });
    return false;
  }
  if (!locResp?.ok) {
    showNotReady({
      title: "Couldn't load locations",
      bodyHtml:
        "WeWork's location API returned an error: <code>" +
        escapeHtml(locResp?.error || "unknown") +
        "</code>. Try refreshing the WeWork tab and clicking " +
        "<strong>Check again</strong>.",
      showOpenBtn: false,
    });
    return false;
  }
  state.locations = locResp.locations || [];
  state.favorites = new Map(locResp.favorites || []);
  if (state.locations.length === 0) {
    showNotReady({
      title: "No locations found",
      bodyHtml:
        "WeWork's API returned an empty locations list. This usually clears " +
        "up after refreshing the page.",
      showOpenBtn: false,
    });
    return false;
  }
  return true;
}

function showNotReady({ title, bodyHtml, showOpenBtn }) {
  $("checkingScreen").hidden = true;
  $("mainPanel").hidden = true;
  $("notReadyScreen").hidden = false;
  $("notReadyTitle").textContent = title;
  $("notReadyBody").innerHTML = bodyHtml;
  $("openWeworkBtn").hidden = !showOpenBtn;
}

function showMain() {
  $("checkingScreen").hidden = true;
  $("notReadyScreen").hidden = true;
  $("mainPanel").hidden = false;
}

function showChecking() {
  $("checkingScreen").hidden = false;
  $("notReadyScreen").hidden = true;
  $("mainPanel").hidden = true;
}

$("openWeworkBtn").addEventListener("click", async () => {
  await chrome.tabs.create({ url: "https://members.wework.com/" });
  // Close the popup so the user can deal with the page.
  window.close();
});

$("recheckBtn").addEventListener("click", () => {
  showChecking();
  // Re-run init from scratch.
  loadConfig();
});

async function loadExistingBookings() {
  try {
    const tab = await getActiveTab();
    if (!tab?.url || !/members\.wework\.com/.test(tab.url)) return;
    const r = await chrome.tabs.sendMessage(tab.id, { type: "WW_GET_BOOKINGS" });
    if (!r?.ok || !Array.isArray(r.bookings)) return;
    state.bookedDates.clear();
    for (const b of r.bookings) {
      state.bookedDates.set(b.dateISO, b);
    }
    // If a date became booked while the popup was open, drop any pending
    // assignment for it — can't double-book.
    for (const iso of Array.from(state.assignments.keys())) {
      if (state.bookedDates.has(iso)) state.assignments.delete(iso);
    }
    renderCalendar();
    updateSummary();
  } catch (e) {
    // Content script not yet injected, or message failed — ignore.
  }
}

$("dryRun").addEventListener("change", persist);

// ---- status pane ----------------------------------------------------------

function appendStatus(msg, kind = "") {
  const status = $("status");
  const line = document.createElement("p");
  line.className = "status-line" + (kind ? " " + kind : "");
  const time = new Date().toLocaleTimeString();
  line.textContent = `[${time}] ${msg}`;
  status.appendChild(line);
  status.scrollTop = status.scrollHeight;
}

function clearStatus() {
  $("status").innerHTML = "";
}

// ---- run ------------------------------------------------------------------

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

$("startBtn").addEventListener("click", async () => {
  clearStatus();

  if (state.assignments.size === 0) {
    appendStatus("Tap days on the calendar to assign locations first.", "err");
    return;
  }

  const tab = await getActiveTab();
  if (!tab?.url || !/members\.wework\.com/.test(tab.url)) {
    appendStatus("Open members.wework.com in this tab first.", "err");
    return;
  }

  // Build the per-date list the content script expects.
  const items = Array.from(state.assignments.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateISO, locId]) => {
      const loc = LONDON_LOCATIONS.find((l) => l.id === locId);
      return { dateISO, location: loc };
    })
    .filter((x) => !!x.location);

  const dryRun = $("dryRun").checked;

  $("startBtn").disabled = true;
  $("stopBtn").disabled = false;
  $("stopBtn").textContent = "Stop";
  showProgress(0, items.length);
  appendStatus(`Starting${dryRun ? " (DRY RUN)" : ""}…`, "info");

  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: "WW_START",
      config: { items, dryRun },
    });
  } catch (err) {
    appendStatus(`Could not reach the page: ${err.message}`, "err");
    appendStatus("Reload the WeWork tab and try again.", "warn");
    $("startBtn").disabled = false;
    $("stopBtn").disabled = true;
    hideProgress();
  }
});

$("stopBtn").addEventListener("click", async () => {
  const tab = await getActiveTab();
  $("stopBtn").disabled = true;
  $("stopBtn").textContent = "Stopping…";
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "WW_STOP" });
  } catch (e) {
    /* ignore */
  }
  appendStatus("Stop requested. Will stop after the current step.", "warn");
});

function showProgress(done, total) {
  const row = $("progressRow");
  row.hidden = false;
  updateProgress(done, total);
}
function updateProgress(done, total) {
  $("progressLabel").textContent = `${done} / ${total}`;
  const fill = $("progressFill");
  fill.classList.remove("done");
  fill.style.width = total > 0 ? `${(done / total) * 100}%` : "0%";
}
function finishProgress() {
  $("progressFill").classList.add("done");
}
function hideProgress() {
  $("progressRow").hidden = true;
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "WW_LOG") {
    appendStatus(msg.text, msg.kind || "");
  }
  if (msg?.type === "WW_PROGRESS") {
    updateProgress(msg.done, msg.total);
  }
  if (msg?.type === "WW_DONE") {
    $("startBtn").disabled = false;
    $("stopBtn").disabled = true;
    $("stopBtn").textContent = "Stop";
    finishProgress();
    // Refresh booked dates so newly-booked days lock immediately.
    loadExistingBookings();
  }
});

document.addEventListener("DOMContentLoaded", loadConfig);
