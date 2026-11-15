/**
 * Client for Owner C's access-detail endpoint (slope, ramp, width, surface...).
 *
 *   GET {ACCESS_FEATURES_URL}?bbox=west,south,east,north
 *   -> { data: GeoJSON Feature[], meta: { contract_version, count, data_mode, generated_at, source_note } }
 *
 * Full wire spec: docs/OWNER_B_REQUESTS.md ("Access-detail endpoint").
 * Field-name and unit differences are absorbed by FIELD_ALIASES in accessContract.ts.
 *
 * Optional by design: 404 (not deployed yet), a network error or bad JSON all
 * return `{ ok: false }` and the map keeps the OSM snapshot only.
 */
import { ACCESS_CONTRACT_VERSION, normalizeAccessFeature, type AccessFeatureV1 } from "./accessContract";

/** Change here (or set NEXT_PUBLIC_ACCESS_FEATURES_URL) if C serves it elsewhere. */
export const ACCESS_FEATURES_URL = process.env.NEXT_PUBLIC_ACCESS_FEATURES_URL || "/api/access-features";

export type AccessFetchResult =
  | { ok: true; features: AccessFeatureV1[]; dropped: number; sourceNote: string | null; dataMode: string; versionWarning: string | null }
  | { ok: false; code: string; message: string };

export async function fetchAccessFeatures(bbox: [number, number, number, number], fetchImpl: typeof fetch = fetch): Promise<AccessFetchResult> {
  try {
    const res = await fetchImpl(`${ACCESS_FEATURES_URL}?bbox=${bbox.join(",")}`);
    if (res.status === 404) return { ok: false, code: "NOT_DEPLOYED", message: "Access-detail endpoint not available yet." };
    if (!res.ok) return { ok: false, code: `HTTP_${res.status}`, message: `Access-detail service error (HTTP ${res.status}).` };
    const j = await res.json();
    // Accept {data:[...]}, a FeatureCollection {features:[...]}, or a bare array.
    const rows: unknown[] = Array.isArray(j) ? j : Array.isArray(j?.data) ? j.data : Array.isArray(j?.features) ? j.features : [];
    const features: AccessFeatureV1[] = [];
    rows.forEach((r, i) => { const f = normalizeAccessFeature(r, `api-${i}`); if (f) features.push(f); });
    const v = j?.meta?.contract_version;
    return {
      ok: true,
      features,
      dropped: rows.length - features.length,
      sourceNote: typeof j?.meta?.source_note === "string" ? j.meta.source_note : null,
      dataMode: typeof j?.meta?.data_mode === "string" ? j.meta.data_mode : "unknown",
      versionWarning: v && String(v) !== ACCESS_CONTRACT_VERSION ? `Access data uses contract v${v}; map expects v${ACCESS_CONTRACT_VERSION}.` : null,
    };
  } catch (e) {
    return { ok: false, code: "NETWORK", message: e instanceof Error ? e.message : String(e) };
  }
}
