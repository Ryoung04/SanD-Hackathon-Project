/**
 * Shared, load-once store of accessibility context features (client side).
 * Used by the map (MapView3D) and the route panel (route context warnings) so both see
 * the SAME normalized data: OSM snapshot + Owner C's optional /api/access-features,
 * merged by id (see mergeById in accessContract.ts).
 */
import { fromOsm, mergeById, normalizeAccessFeature, type AccessFeatureV1 } from "./accessContract";
import { fetchAccessFeatures, type AccessFetchResult } from "./accessClient";
import { STUDY_BBOX } from "../data/studyArea";

export const ACCESS_SNAPSHOT_URL = "/data/downtown-access.geojson";
/** B-derived slope estimates from USGS 3DEP lidar (scripts/elevation/fetch-slopes.ts). Optional. */
export const SLOPES_URL = "/data/downtown-slopes.geojson";

export interface AccessData {
  /** OSM snapshot only (empty if the file failed to load). */
  osm: AccessFeatureV1[];
  /** OSM merged with the API feed; equals `osm` when the feed is unavailable. */
  merged: AccessFeatureV1[];
  /** Raw snapshot features, used for 3D stair blocks. */
  osmRaw: any[];
  snapshotError: string | null;
  api: AccessFetchResult;
  /** Number of elevation-derived slope segments loaded (0 if the file is missing). */
  derivedSlopes: number;
}

let osmPromise: Promise<{ norm: AccessFeatureV1[]; raw: any[]; derivedCount: number; error: string | null }> | null = null;
let fullPromise: Promise<AccessData> | null = null;

/** OSM snapshot only (fast, local). Resolves even on failure. */
export function loadOsmSnapshot() {
  osmPromise ??= Promise.all([
    fetch(ACCESS_SNAPSHOT_URL).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))),
    fetch(SLOPES_URL).then((r) => (r.ok ? r.json() : null)).catch(() => null), // optional
  ])
    .then(([fc, slopes]) => {
      const norm: AccessFeatureV1[] = (fc.features ?? []).map((f: any) => fromOsm(f, fc.metadata?.retrieved_at ?? null));
      // Stair height from elevation: attach to the OSM stair as an estimate (keeps OSM provenance).
      const rise: Record<string, number> = slopes?.metadata?.steps_rise_m ?? {};
      for (const f of norm) if (f.properties.kind === "steps" && Number.isFinite(rise[f.id])) f.properties.detail.rise_m = rise[f.id];
      const defaults = slopes?.metadata?.defaults ?? {};
      const derived = ((slopes?.features ?? []) as any[]).map((r, i) => normalizeAccessFeature({ ...r, properties: { ...defaults, ...r.properties } }, `dem-${i}`, "derived")).filter((f): f is AccessFeatureV1 => !!f);
      return { raw: fc.features ?? [], norm: [...norm, ...derived], derivedCount: derived.length, error: null as string | null };
    })
    .catch((e) => { osmPromise = null; return { raw: [], norm: [], derivedCount: 0, error: e instanceof Error ? e.message : String(e) }; });
  return osmPromise;
}

/** Snapshot + API feed. Cached for the page load; the API part never blocks on failure. */
export function loadAccessData(): Promise<AccessData> {
  fullPromise ??= Promise.all([loadOsmSnapshot(), fetchAccessFeatures(STUDY_BBOX as [number, number, number, number])]).then(([o, api]) => ({
    osm: o.norm,
    osmRaw: o.raw,
    merged: api.ok ? mergeById(o.norm, api.features) : o.norm,
    snapshotError: o.error,
    api,
    derivedSlopes: o.derivedCount,
  }));
  return fullPromise;
}
