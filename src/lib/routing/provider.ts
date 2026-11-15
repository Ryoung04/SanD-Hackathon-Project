/**
 * Real pedestrian routing adapter (Valhalla). No straight-line fallback:
 * on any failure the caller gets { ok: false } and must report "unavailable".
 * Server-side only (called from /api/route).
 */

export type LatLon = { lat: number; lon: number };
export type RouteProfile = "wheelchair_preference" | "avoid_stairs" | "pedestrian";
export const ROUTE_PROFILES: RouteProfile[] = ["wheelchair_preference", "avoid_stairs", "pedestrian"];

/**
 * Valhalla pedestrian costing options per profile. These are PREFERENCES applied to
 * community-mapped OSM data: stairs that aren't mapped can't be avoided, and nothing
 * here certifies a route as accessible. Tune values here only.
 *  - type "wheelchair": Valhalla's wheelchair walking speed/edge preferences.
 *  - step_penalty (s): extra cost per flight of mapped steps; 3600 = avoid unless no other way.
 *  - use_hills 0..1: 0 = avoid hills where elevation data allows.
 */
export const PROFILE_COSTING: Record<RouteProfile, Record<string, unknown>> = {
  wheelchair_preference: { type: "wheelchair" },
  avoid_stairs: { type: "wheelchair", step_penalty: 3600, use_hills: 0 },
  pedestrian: {},
};

/** One turn instruction from the provider. begin_index points into route.coordinates. */
export type RouteStep = { instruction: string; distance_m: number; begin_index: number; street: string | null };
export type RouteLine = { type: "LineString"; coordinates: [number, number][] };

export interface RouteRequest {
  start: LatLon;
  end: LatLon;
  profile: RouteProfile;
}

export type ProviderResult =
  | { ok: true; provider: "valhalla"; route: RouteLine; distance_m: number; duration_s: number; steps: RouteStep[] }
  | { ok: false; provider: "valhalla"; reason: string };

export const VALHALLA_URL = process.env.VALHALLA_URL || "https://valhalla1.openstreetmap.de/route";
export const PROVIDER_TIMEOUT_MS = 12_000;
/** Reject trips longer than this (straight-line); this is a neighborhood demo, not a city planner. */
export const MAX_TRIP_M = 15_000;

const validCoord = (p: any): p is LatLon =>
  p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;

/** Validate an untrusted request body. Returns a message on failure. */
export function parseRouteRequest(body: any): { ok: true; req: RouteRequest } | { ok: false; message: string } {
  if (!body || typeof body !== "object") return { ok: false, message: "Body must be a JSON object" };
  if (!validCoord(body.start) || !validCoord(body.end)) return { ok: false, message: "start and end need numeric lat/lon" };
  const profile = body.profile ?? "wheelchair_preference";
  if (!ROUTE_PROFILES.includes(profile))
    return { ok: false, message: `profile must be one of ${ROUTE_PROFILES.join(", ")}` };
  if (straightLineM(body.start, body.end) > MAX_TRIP_M) return { ok: false, message: `Trip longer than ${MAX_TRIP_M / 1000} km` };
  return { ok: true, req: { start: { lat: body.start.lat, lon: body.start.lon }, end: { lat: body.end.lat, lon: body.end.lon }, profile } };
}

export function straightLineM(a: LatLon, b: LatLon): number {
  const R = 6371008.8, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Decode a Google-style encoded polyline (Valhalla uses precision 6) into GeoJSON [lon, lat]. */
export function decodePolyline(str: string, precision = 6): [number, number][] {
  const factor = 10 ** precision;
  const out: [number, number][] = [];
  let i = 0, lat = 0, lon = 0;
  while (i < str.length) {
    for (const which of [0, 1]) {
      let shift = 0, result = 0, b: number;
      do {
        b = str.charCodeAt(i++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20 && i < str.length);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += delta; else lon += delta;
    }
    out.push([lon / factor, lat / factor]);
  }
  return out;
}

export function buildValhallaBody(req: RouteRequest) {
  return {
    locations: [req.start, req.end].map((p) => ({ lat: p.lat, lon: p.lon })),
    costing: "pedestrian",
    // Preferences only (see PROFILE_COSTING); they do not certify accessibility.
    costing_options: { pedestrian: PROFILE_COSTING[req.profile] },
    units: "kilometers",
    directions_type: "instructions", // text turn-by-turn, the text equivalent of the route line
  };
}

/** Parse a Valhalla /route response. Exported for tests. */
export function parseValhalla(json: any): ProviderResult {
  const legs = json?.trip?.legs;
  const summary = json?.trip?.summary;
  if (!Array.isArray(legs) || !legs.length || !summary) return { ok: false, provider: "valhalla", reason: json?.error ?? "No route in provider response" };
  const steps: RouteStep[] = [];
  let offset = 0;
  const coords = legs.flatMap((l: any, idx: number) => {
    const c = typeof l?.shape === "string" ? decodePolyline(l.shape, 6) : [];
    for (const m of Array.isArray(l?.maneuvers) ? l.maneuvers : []) {
      if (typeof m?.instruction !== "string" || !m.instruction.trim()) continue;
      steps.push({
        instruction: m.instruction.trim(),
        distance_m: Math.round(Number(m.length) * 1000) || 0,
        begin_index: Math.max(0, offset + (Number(m.begin_shape_index) || 0) - (idx > 0 ? 1 : 0)),
        street: Array.isArray(m.street_names) && typeof m.street_names[0] === "string" ? m.street_names[0] : null,
      });
    }
    const kept = idx > 0 ? c.slice(1) : c; // drop duplicated joint point between legs
    offset += kept.length;
    return kept;
  });
  const km = Number(summary.length), s = Number(summary.time);
  if (coords.length < 2 || !Number.isFinite(km) || !Number.isFinite(s)) return { ok: false, provider: "valhalla", reason: "Malformed provider route" };
  return { ok: true, provider: "valhalla", route: { type: "LineString", coordinates: coords }, distance_m: Math.round(km * 1000), duration_s: Math.round(s), steps };
}

export async function fetchRoute(req: RouteRequest, fetchImpl: typeof fetch = fetch): Promise<ProviderResult> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const res = await fetchImpl(VALHALLA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "accesspath-sd-hackathon" },
      body: JSON.stringify(buildValhallaBody(req)),
      signal: ctrl.signal,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, provider: "valhalla", reason: json?.error ?? `Provider HTTP ${res.status}` };
    return parseValhalla(json);
  } catch (e: any) {
    return { ok: false, provider: "valhalla", reason: e?.name === "AbortError" ? "Provider timed out" : "Provider unreachable" };
  } finally {
    clearTimeout(t);
  }
}
