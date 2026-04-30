// content/locations.js — fetches the live location list + favorites from
// WeWork's APIs. Replaces the previously hardcoded list.

window.WW_LOCATIONS = (() => {
  // Default city (London). The popup can override this per-session via
  // the city picker — it passes a {name, latitude, longitude} object to
  // fetchLocations.
  const DEFAULT_CITY = {
    name: "London",
    latitude: 51.5074,
    longitude: -0.1278,
  };

  function buildLocationsUrl(accountUUID, city) {
    const c = city || DEFAULT_CITY;
    const p = new URLSearchParams({
      isAuthenticated: "true",
      city: c.name,
      isOnDemandUser: "false",
      accountUUID: accountUUID || "",
    });
    // Lat/lon aren't strictly required (the captured request omitted them)
    // but including them helps when `city` alone is ambiguous (e.g. two
    // "San Francisco" entries in the city list).
    if (c.latitude != null && c.longitude != null) {
      p.set("userLatitude", String(c.latitude));
      p.set("userLongitude", String(c.longitude));
    }
    return (
      "https://members.wework.com/workplaceone/api/wework-yardi/ondemand/" +
      "get-locations-by-geo?" + p.toString()
    );
  }

  const FAVORITES_URL =
    "https://members.wework.com/workplaceone/api/recent-and-favorite/v2/" +
    "get-recents-and-favorite-location-data?requestType=1&spaceType=0";

  // Same endpoint handles both add and remove — IsDeleted in the body
  // selects which.
  const FAVORITE_TOGGLE_URL =
    "https://members.wework.com/workplaceone/api/recent-and-favorite/" +
    "mark-as-favorite-location";

  const CITIES_URL =
    "https://members.wework.com/workplaceone/api/wework-yardi/location/" +
    "get-city-details";

  // Normalise a location entry from /get-locations-by-geo into the shape
  // the popup expects (id, name, address as string).
  function normaliseLocation(loc) {
    if (!loc || typeof loc !== "object") return null;
    const id = loc.uuid || loc.UUID || loc.id;
    if (!id) return null;
    const a = loc.address || {};
    const addressParts = [
      a.line1, a.line2, a.city, a.zip,
    ].filter(Boolean).map((s) => String(s).trim()).filter(Boolean);
    return {
      id,
      name: String(loc.name || loc.Name || ""),
      address: addressParts.join(", "),
      image: String(loc.image || loc.Image || ""),
    };
  }

  async function fetchLocations(authHeaders, accountUUID, city) {
    try {
      const res = await fetch(buildLocationsUrl(accountUUID, city), {
        method: "GET",
        credentials: "include",
        headers: authHeaders,
      });
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}` };
      }
      const data = await res.json();
      const list = Array.isArray(data?.locationsByGeo)
        ? data.locationsByGeo
        : Array.isArray(data) ? data : [];
      const locations = list.map(normaliseLocation).filter(Boolean);
      // Sort alphabetically by name. Default API ordering is by distance,
      // which is meaningless once we widen the bounding box.
      locations.sort((a, b) => a.name.localeCompare(b.name));
      return { ok: true, locations };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // Fetch the list of cities the user has access to. Each entry has
  // { name, marketgeo: { latitude, longitude, name } }. We surface the
  // bare minimum the popup needs.
  async function fetchCities(authHeaders) {
    try {
      const res = await fetch(CITIES_URL, {
        method: "GET",
        credentials: "include",
        headers: authHeaders,
      });
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}` };
      }
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];
      // City list can have duplicates (e.g. "San Francisco" appears twice).
      // Dedupe by name+country, keeping the first.
      const seen = new Set();
      const cities = [];
      for (const c of list) {
        if (!c || typeof c !== "object") continue;
        const name = c.name || c.Name || "";
        if (!name) continue;
        const country = c.countrygeo?.iso || c.countrygeo?.name || "";
        const key = `${name}|${country}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const lat = c.marketgeo?.latitude;
        const lon = c.marketgeo?.longitude;
        cities.push({
          name,
          country,
          latitude: typeof lat === "number" ? lat : null,
          longitude: typeof lon === "number" ? lon : null,
        });
      }
      cities.sort((a, b) => a.name.localeCompare(b.name));
      return { ok: true, cities };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // Returns Map<locationId, favoriteId> of desk-level favorites only. The
  // favorites endpoint also returns room-level favorites (SpaceType 2) that
  // point at a specific reservable; those don't apply to desk-booking. We
  // filter to SpaceType 0 (desks).
  //
  // We need the favoriteId (`Id`) to unfavorite — the unfavorite endpoint
  // takes the same body shape as add-favorite plus `Id` and IsDeleted: true.
  async function fetchFavorites(authHeaders) {
    try {
      const res = await fetch(FAVORITES_URL, {
        method: "GET",
        credentials: "include",
        headers: authHeaders,
      });
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}` };
      }
      const data = await res.json();
      const list = Array.isArray(data?.FavoriteLocations)
        ? data.FavoriteLocations
        : Array.isArray(data?.favoriteLocations)
        ? data.favoriteLocations
        : [];
      const favorites = new Map();
      for (const f of list) {
        const spaceType = f.SpaceType ?? f.spaceType;
        if (spaceType !== 0) continue;
        const locationId = f.LocationId || f.locationId;
        const favoriteId = f.Id ?? f.id;
        if (locationId && favoriteId != null) {
          favorites.set(locationId, favoriteId);
        }
      }
      return { ok: true, favorites };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // Add a desk-level favorite for a location. Body shape mirrors the
  // captured request: location-only favorite (SpaceId: 0, SpaceType: 0).
  // Returns the new favorite's Id on success so the caller can track it
  // without re-fetching the whole favorites list.
  async function addFavorite(authHeaders, location) {
    if (!location?.id || !location?.name) {
      return { ok: false, error: "missing location id/name" };
    }
    const body = {
      LocationId: location.id,
      SpaceType: 0,
      IsDeleted: false,
      LocationType: 2,
      LocationAccountType: 2,
      SpaceId: 0,
      InventoryName: location.name,
      InventoryImageURL: location.image || "",
      PlatformType: "WEB",
      ApplicationType: "WorkplaceOne",
      FloorId: 0,
    };
    try {
      const res = await fetch(FAVORITE_TOGGLE_URL, {
        method: "POST",
        credentials: "include",
        headers: { ...authHeaders, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
      }
      try {
        const data = JSON.parse(text);
        if (data?.status === false) {
          return { ok: false, error: data.message || "rejected" };
        }
        // Response includes FavoriteId at the top level (e.g. 164389).
        const favoriteId = data?.FavoriteId ?? data?.favoriteId;
        return { ok: true, favoriteId, data };
      } catch {
        return { ok: true };
      }
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // Remove a desk-level favorite. Same endpoint as add-favorite, but with
  // IsDeleted:true and the favorite's Id included in the body.
  async function removeFavorite(authHeaders, location, favoriteId) {
    if (!location?.id || !location?.name) {
      return { ok: false, error: "missing location id/name" };
    }
    if (favoriteId == null) {
      return { ok: false, error: "missing favoriteId" };
    }
    const body = {
      Id: favoriteId,
      LocationId: location.id,
      SpaceType: 0,
      IsDeleted: true,
      LocationType: 2,
      LocationAccountType: 2,
      SpaceId: 0,
      InventoryName: location.name,
      InventoryImageURL: location.image || "",
      PlatformType: "WEB",
      ApplicationType: "WorkplaceOne",
      FloorId: 0,
    };
    try {
      const res = await fetch(FAVORITE_TOGGLE_URL, {
        method: "POST",
        credentials: "include",
        headers: { ...authHeaders, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
      }
      try {
        const data = JSON.parse(text);
        if (data?.status === false) {
          return { ok: false, error: data.message || "rejected" };
        }
        return { ok: true, data };
      } catch {
        return { ok: true };
      }
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  return {
    fetchLocations, fetchFavorites, addFavorite, removeFavorite,
    fetchCities, DEFAULT_CITY,
  };
})();
