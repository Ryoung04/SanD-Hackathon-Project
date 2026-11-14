import type { BarrierObservation, VerificationStatus } from "./barrierTypes";

export type LatLon = { lat: number; lon: number };
export type RouteProfile = "wheelchair_preference" | "pedestrian";
export type NearbyDetail = { id: string; distance_m: number; match_method: string };

export type RouteResult =
  | {
      status: "route_available";
      provider: string;
      route: { type: "LineString"; coordinates: [number, number][] };
      distance_m: number;
      duration_s: number;
      nearby_barriers: string[];
      nearby_details?: NearbyDetail[];
      nearby_status?: "ok" | "unavailable";
      nearby_threshold_m?: number;
      coverage_note: string;
      verified_accessible: false;
    }
  | { status: "unavailable"; reason: string; coverage_note?: string };

/** Parse "32.718, -117.164" (lat, lon). Returns null if invalid. */
export function parseLatLon(text: string): LatLon | null {
  const m = text.trim().match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]), lon = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

export const formatLatLon = (p: LatLon) => `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;

export async function requestRoute(
  start: LatLon,
  end: LatLon,
  profile: RouteProfile,
  fetchImpl: typeof fetch = fetch,
): Promise<RouteResult> {
  try {
    const res = await fetchImpl("/api/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start, end, profile, avoid_barrier_ids: [] }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) return { status: "unavailable", reason: json?.error?.message ?? `Route service error (HTTP ${res.status})` };
    if (json?.status === "route_available" && Array.isArray(json.route?.coordinates) && json.route.coordinates.length >= 2) return json;
    return { status: "unavailable", reason: json?.reason ?? "Route provider returned no route" };
  } catch {
    return { status: "unavailable", reason: "Could not reach the route service" };
  }
}

/** Evidence groups shown separately in the route warnings. Order = display order. */
export const EVIDENCE_GROUPS = [
  { key: "official", label: "From official City records", statuses: ["official_inventory"] },
  { key: "resident", label: "Resident-reported (311, unverified)", statuses: ["unverified_report", "community_confirmed"] },
  { key: "ai", label: "AI candidates (unverified)", statuses: ["ai_candidate"] },
  { key: "other", label: "Other / status unknown", statuses: [] },
] as const satisfies readonly { key: string; label: string; statuses: readonly VerificationStatus[] }[];

export type EvidenceGroupKey = (typeof EVIDENCE_GROUPS)[number]["key"];
export type NearbyItem = { id: string; distance_m: number; obs: BarrierObservation | null };

/** Group nearby IDs by evidence type. Observations not loaded client-side go to "other" with obs=null. */
export function groupNearby(details: NearbyDetail[], observations: BarrierObservation[]): Record<EvidenceGroupKey, NearbyItem[]> {
  const byId = new Map(observations.map((o) => [o.id, o]));
  const out: Record<EvidenceGroupKey, NearbyItem[]> = { official: [], resident: [], ai: [], other: [] };
  for (const d of details) {
    const obs = byId.get(d.id) ?? null;
    const g = EVIDENCE_GROUPS.find((g) => obs && (g.statuses as readonly string[]).includes(obs.verification_status));
    out[g?.key ?? "other"].push({ id: d.id, distance_m: d.distance_m, obs });
  }
  return out;
}

export const formatDistance = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);
export const formatDuration = (s: number) => `${Math.max(1, Math.round(s / 60))} min`;
