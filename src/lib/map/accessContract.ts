/**
 * Access-detail contract (Owner B) — ONE place that defines how slope / ramp /
 * accessibility-detail features reach the map, whatever their origin:
 *   - the static OSM snapshot (public/data/downtown-access.geojson), and
 *   - Owner C's `GET /api/access-features` (dataset import or AI estimate).
 *
 * Everything is normalized into `AccessFeatureV1`, then flattened by `toMapProps`
 * for MapLibre (which can only style flat properties).
 *
 * To adapt to a future difference, edit ONLY the config blocks below:
 *   - FIELD_ALIASES   another field name, or a ratio instead of percent
 *   - KIND_ALIASES    another feature-type vocabulary
 *   - METHOD_ALIASES  another provenance vocabulary
 *   - SLOPE_BANDS     other slope thresholds or labels (colors: `--map-slope-*` in globals.css)
 * Bump ACCESS_CONTRACT_VERSION if the wire shape changes incompatibly.
 *
 * Safety rules enforced here (PROJECT_MASTER / CLAUDE.md):
 *   - Missing values stay null / "unknown"; nothing is ever assumed accessible.
 *   - A slope band is a description, never "ADA compliant" or "safe".
 *   - AI estimates can never claim `official_inventory` status (downgraded to `ai_candidate`).
 *   - Every feature keeps source, source date (or null), method, verification status, confidence.
 */
import { VERIFICATION_STATUSES, type VerificationStatus } from "../data/types"; // A-owned enum (relative import so node:test resolves it)
import type { AccessFeature as OsmFeature } from "./osmAccess";

export const ACCESS_CONTRACT_VERSION = "1";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** Kinds the map knows how to draw. Unknown incoming kinds become "other" (drawn as a generic dot). */
export const ACCESS_KINDS = [
  // from OSM today
  "sidewalk", "footway", "pedestrian_area", "crossing_line", "crossing", "steps", "ramp",
  "kerb_lowered", "kerb_raised", "kerb_unknown", "elevator", "entrance", "ramp_candidate",
  // expected from Owner C
  "curb_ramp", "slope_segment",
  "other",
] as const;
export type AccessKindV1 = (typeof ACCESS_KINDS)[number];

/** How a value was obtained. Drives line style: solid = measured/official, dashed = everything else. */
export const ACCESS_METHODS = ["measured", "official_dataset", "community_tag", "ai_estimate", "inferred", "unknown"] as const;
export type AccessMethod = (typeof ACCESS_METHODS)[number];

export const CONFIDENCES = ["high", "medium", "low", "uncertain", "unknown"] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export type YNU = "yes" | "no" | "unknown";
export const RAMP_TYPES = ["curb_ramp", "building_ramp", "path_ramp", "stair_ramp", "unknown"] as const;
export type RampType = (typeof RAMP_TYPES)[number];
export const SURFACE_CONDITIONS = ["good", "fair", "poor", "unknown"] as const;
export type SurfaceCondition = (typeof SURFACE_CONDITIONS)[number];

// ---------------------------------------------------------------------------
// Config: edit here when a data source differs
// ---------------------------------------------------------------------------

/** Incoming kind spellings -> canonical kind. */
export const KIND_ALIASES: Record<string, AccessKindV1> = {
  curbramp: "curb_ramp", curb_cut: "curb_ramp", kerb_ramp: "curb_ramp",
  slope: "slope_segment", grade_segment: "slope_segment", sidewalk_slope: "slope_segment",
  ramp_way: "ramp", possible_ramp: "ramp_candidate", stairs: "steps", stairway: "steps",
};

/** Incoming method spellings -> canonical method. */
export const METHOD_ALIASES: Record<string, AccessMethod> = {
  survey: "measured", field_measured: "measured", lidar: "measured",
  dataset: "official_dataset", city_gis: "official_dataset", county_gis: "official_dataset", official: "official_dataset",
  osm: "community_tag", openstreetmap: "community_tag",
  ai: "ai_estimate", gemini: "ai_estimate", model: "ai_estimate", dem: "inferred", elevation_model: "inferred",
};

/**
 * Field-name aliases, checked in order. A `[name, factor]` entry multiplies the value
 * (e.g. a 0.06 ratio becomes 6 %). Lookup covers top-level props plus nested
 * `detail` / `provenance` objects.
 */
type Alias = string | [string, number];
export const FIELD_ALIASES: Record<string, Alias[]> = {
  slope_pct: ["slope_pct", "running_slope_pct", "grade_pct", "incline_pct", "slope_percent", ["slope_ratio", 100], ["running_slope", 100], ["grade", 100]],
  cross_slope_pct: ["cross_slope_pct", "cross_slope_percent", ["cross_slope_ratio", 100], ["cross_slope", 100]],
  width_m: ["width_m", "clear_width_m", ["width_cm", 0.01], ["width_in", 0.0254], ["width_ft", 0.3048]],
  kerb_height_cm: ["kerb_height_cm", "curb_height_cm", ["curb_height_in", 2.54], ["kerb_height_m", 100]],
  step_count: ["step_count", "steps"],
  rise_m: ["rise_m", "height_change_m", ["rise_cm", 0.01], ["rise_ft", 0.3048]],
  surface: ["surface", "surface_type"],
  surface_condition: ["surface_condition", "condition"],
  ramp_type: ["ramp_type"],
  handrail: ["handrail", "handrails"],
  landing: ["landing", "has_landing", "top_landing"],
  tactile_paving: ["tactile_paving", "detectable_warning", "truncated_domes"],
  wheelchair: ["wheelchair"],
  signals: ["signals"],
  incline_raw: ["incline_raw", "incline"],
  source: ["source", "source_name", "source_kind"],
  source_url: ["source_url", "url"],
  source_date: ["source_date", "captured_at", "observed_at", "retrieved_at"],
  method: ["method", "measurement_method", "estimation_method"],
  verification_status: ["verification_status", "status"],
  confidence: ["confidence", "model_confidence"],
  note: ["note", "notes", "explanation"],
};

/**
 * Slope bands for display. 5 % and 8.33 % (1:12) are common design reference points,
 * but a band is a DESCRIPTION, not a compliance verdict. Unknown slope gets no band.
 * Colors: `--map-slope-<key>` tokens in globals.css.
 */
export const SLOPE_BANDS = [
  { key: "level", maxPct: 2, label: "about level (≤2%)" },
  { key: "gentle", maxPct: 5, label: "gentle (2–5%)" },
  { key: "moderate", maxPct: 8.33, label: "ramp-like (5–8.3%)" },
  { key: "steep", maxPct: 12, label: "steep (8.3–12%)" },
  { key: "very_steep", maxPct: Infinity, label: "very steep (>12%)" },
] as const;
export type SlopeBand = (typeof SLOPE_BANDS)[number]["key"] | "unknown";

// ---------------------------------------------------------------------------
// Contract types
// ---------------------------------------------------------------------------

export interface AccessDetail {
  slope_pct: number | null; // running slope along travel direction, absolute %
  cross_slope_pct: number | null;
  width_m: number | null;
  kerb_height_cm: number | null;
  step_count: number | null;
  /** Height change along the feature (m), e.g. a stair's total rise. Estimate unless method says otherwise. */
  rise_m: number | null;
  surface: string | null;
  surface_condition: SurfaceCondition;
  ramp_type: RampType;
  handrail: YNU;
  landing: YNU;
  tactile_paving: YNU;
  wheelchair: "yes" | "no" | "limited" | "unknown"; // raw tag only, never a safety claim
  signals: YNU;
  incline_raw: string | null;
}

export interface AccessProvenance {
  source: string; // human-readable, e.g. "OpenStreetMap", "City of San Diego PROWAG", "Gemini estimate"
  source_url: string | null;
  source_date: string | null; // ISO date; null = unknown
  method: AccessMethod;
  verification_status: VerificationStatus;
  confidence: Confidence;
  note: string | null;
}

/** Where a feature entered the map: OSM snapshot, Owner C's API, or a B-derived static file (e.g. DEM slopes). */
export type AccessOrigin = "osm_snapshot" | "api" | "derived";

export interface AccessFeatureV1 {
  type: "Feature";
  id: string;
  geometry: { type: "Point"; coordinates: [number, number] } | { type: "LineString"; coordinates: [number, number][] };
  properties: { kind: AccessKindV1; detail: AccessDetail; provenance: AccessProvenance; origin: AccessOrigin };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};
const ynu = (v: unknown): YNU => {
  if (v === true || v === "yes" || v === "true") return "yes";
  if (v === false || v === "no" || v === "false") return "no";
  return "unknown";
};
const oneOf = <T extends string>(list: readonly T[], v: unknown, fallback: T): T =>
  typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : fallback;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** OSM `incline` -> absolute %. "up"/"down"/"yes" carry no number -> null. Degrees ("5°") converted. */
export function parseIncline(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  if (s.endsWith("°")) return Math.abs(Math.tan((n * Math.PI) / 180) * 100);
  return Math.abs(n); // "6%" or "6" (OSM default unit is %)
}

export function slopeBand(pct: number | null): SlopeBand {
  if (pct === null || !Number.isFinite(pct)) return "unknown";
  return SLOPE_BANDS.find((b) => Math.abs(pct) <= b.maxPct)!.key;
}
export const slopeBandLabel = (b: SlopeBand) => SLOPE_BANDS.find((x) => x.key === b)?.label ?? "slope unknown";

function pick(bag: Record<string, unknown>, field: string): unknown {
  for (const a of FIELD_ALIASES[field] ?? [field]) {
    const [name, factor] = Array.isArray(a) ? a : [a, 1];
    const v = bag[name];
    if (v === undefined || v === null || v === "") continue;
    if (factor !== 1) { const n = num(v); return n === null ? null : n * factor; }
    return v;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Normalizers
// ---------------------------------------------------------------------------

/**
 * Normalize one raw GeoJSON Feature from Owner C's endpoint (or any future source).
 * Returns null for unusable geometry. Tolerant of flat or nested (detail/provenance) props.
 */
export function normalizeAccessFeature(raw: any, fallbackId: string, origin: AccessOrigin = "api"): AccessFeatureV1 | null {
  const g = raw?.geometry;
  const okPoint = g?.type === "Point" && Array.isArray(g.coordinates) && g.coordinates.length >= 2 && g.coordinates.every(Number.isFinite);
  const okLine = g?.type === "LineString" && Array.isArray(g.coordinates) && g.coordinates.length >= 2;
  if (!okPoint && !okLine) return null;
  const p = raw.properties ?? {};
  const bag: Record<string, unknown> = { ...p, ...(p.detail ?? {}), ...(p.provenance ?? {}) };

  const rawKind = String(bag.kind ?? bag.feature_type ?? "other").toLowerCase();
  const kind = (ACCESS_KINDS as readonly string[]).includes(rawKind) ? (rawKind as AccessKindV1) : KIND_ALIASES[rawKind] ?? "other";
  const rawMethod = String(pick(bag, "method") ?? "unknown").toLowerCase();
  const method = (ACCESS_METHODS as readonly string[]).includes(rawMethod) ? (rawMethod as AccessMethod) : METHOD_ALIASES[rawMethod] ?? "unknown";
  let status = oneOf(VERIFICATION_STATUSES, pick(bag, "verification_status"), "unknown");
  if (method === "ai_estimate" && status === "official_inventory") status = "ai_candidate"; // guardrail

  const incline_raw = str(pick(bag, "incline_raw"));
  const slope = num(pick(bag, "slope_pct"));
  const detail: AccessDetail = {
    slope_pct: slope !== null ? Math.abs(slope) : parseIncline(incline_raw),
    cross_slope_pct: (() => { const n = num(pick(bag, "cross_slope_pct")); return n === null ? null : Math.abs(n); })(),
    width_m: num(pick(bag, "width_m")),
    kerb_height_cm: num(pick(bag, "kerb_height_cm")),
    step_count: num(pick(bag, "step_count")),
    rise_m: num(pick(bag, "rise_m")),
    surface: str(pick(bag, "surface")),
    surface_condition: oneOf(SURFACE_CONDITIONS, pick(bag, "surface_condition"), "unknown"),
    ramp_type: oneOf(RAMP_TYPES, pick(bag, "ramp_type"), kind === "curb_ramp" ? "curb_ramp" : "unknown"),
    handrail: ynu(pick(bag, "handrail")),
    landing: ynu(pick(bag, "landing")),
    tactile_paving: ynu(pick(bag, "tactile_paving")),
    wheelchair: oneOf(["yes", "no", "limited", "unknown"] as const, pick(bag, "wheelchair"), "unknown"),
    signals: ynu(pick(bag, "signals")),
    incline_raw,
  };
  const provenance: AccessProvenance = {
    source: str(pick(bag, "source")) ?? "unknown source",
    source_url: str(pick(bag, "source_url")),
    source_date: str(pick(bag, "source_date")),
    method,
    verification_status: status,
    confidence: oneOf(CONFIDENCES, pick(bag, "confidence"), "unknown"),
    note: str(pick(bag, "note")),
  };
  const id = String(raw.id ?? p.id ?? fallbackId);
  return { type: "Feature", id, geometry: g, properties: { kind, detail, provenance, origin } };
}

/** Adapter for the static OSM snapshot (osmAccess.ts output). OSM = community_tag / unverified_report. */
export function fromOsm(f: OsmFeature, retrievedAt: string | null): AccessFeatureV1 {
  const p = f.properties;
  const inferred = p.kind === "ramp_candidate";
  return {
    type: "Feature",
    id: p.osm_id + (inferred ? "#candidate" : ""),
    geometry: f.geometry,
    properties: {
      kind: p.kind,
      origin: "osm_snapshot",
      detail: {
        slope_pct: parseIncline(p.incline),
        cross_slope_pct: null, width_m: p.width_m ?? null, kerb_height_cm: null,
        step_count: p.step_count, rise_m: null, surface: p.surface, surface_condition: "unknown",
        ramp_type: p.ramp_type ?? (p.kind === "kerb_lowered" ? "curb_ramp" : "unknown"),
        handrail: p.handrail, landing: "unknown", tactile_paving: p.tactile_paving,
        wheelchair: p.wheelchair, signals: p.signals, incline_raw: p.incline,
      },
      provenance: {
        source: "OpenStreetMap", source_url: `https://www.openstreetmap.org/${p.osm_id}`, source_date: retrievedAt,
        method: inferred ? "inferred" : "community_tag",
        verification_status: inferred ? "unknown" : "unverified_report",
        confidence: inferred ? "low" : "unknown",
        note: inferred ? (p.reason ?? "Inferred from nearby tags; no ramp is mapped here.") : null,
      },
    },
  };
}

/** Flatten for MapLibre styling. Null stays null so expressions can test it. */
export function toMapProps(f: AccessFeatureV1): Record<string, unknown> {
  const { kind, detail: d, provenance: v, origin } = f.properties;
  const estimated = !(v.method === "measured" || v.method === "official_dataset");
  return {
    id: f.id, kind, origin, ...d, ...v,
    slope_band: slopeBand(d.slope_pct),
    estimated: estimated ? 1 : 0,
    // Short map label, e.g. "~6%" (tilde = not measured). Empty when unknown.
    slope_label: d.slope_pct === null ? "" : `${estimated ? "~" : ""}${Math.round(d.slope_pct * 10) / 10}%`,
  };
}

/**
 * Merge policy: an incoming feature whose id matches a base feature REPLACES it
 * (lets C enrich an OSM way by reusing its id, e.g. "way/123"); others are appended.
 */
export function mergeById(base: AccessFeatureV1[], incoming: AccessFeatureV1[]): AccessFeatureV1[] {
  const byId = new Map(incoming.map((f) => [f.id, f]));
  const out = base.map((f) => byId.get(f.id) ?? f);
  const used = new Set(base.map((f) => f.id));
  for (const f of incoming) if (!used.has(f.id)) out.push(f);
  return out;
}
