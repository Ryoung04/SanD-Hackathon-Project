/**
 * Convert an Overpass JSON response (OSM pedestrian infrastructure) into a compact
 * GeoJSON FeatureCollection for map context. OSM is community-mapped: these are
 * CONTEXT features, not barrier observations, and are never treated as verified.
 * Missing tags become "unknown" (never assumed accessible).
 */

export type AccessKind =
  | "steps" | "ramp" | "sidewalk" | "crossing_line" | "footway" | "pedestrian_area"
  | "kerb_lowered" | "kerb_raised" | "kerb_unknown"
  | "crossing" | "elevator"
  | "entrance"        // building entrance with a wheelchair or ramp tag
  | "ramp_candidate"; // INFERRED, not mapped: see inferRampCandidates()

export interface AccessProps {
  kind: AccessKind;
  osm_id: string; // "way/123" | "node/456"
  wheelchair: "yes" | "no" | "limited" | "unknown";
  tactile_paving: "yes" | "no" | "unknown";
  surface: string | null;
  step_count: number | null;
  handrail: "yes" | "no" | "unknown";
  ramp: "yes" | "no" | "unknown"; // ramp / ramp:wheelchair on steps
  signals: "yes" | "no" | "unknown"; // crossings
  incline: string | null; // raw OSM incline tag (e.g. "5%", "up"); slope is unverified
  width_m?: number | null; // OSM width tag (metres), unverified
  ramp_type?: "curb_ramp" | "building_ramp" | "path_ramp" | "stair_ramp" | "unknown";
  reason?: string; // why an inferred candidate exists
  /** Raised/sunken/indoor path: ground elevation data does not describe it (skipped for slope). */
  structure?: "bridge" | "tunnel" | "covered" | "indoor" | null;
  name: string | null;
}

export type AccessFeature = {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] } | { type: "LineString"; coordinates: [number, number][] };
  properties: AccessProps;
};
export type AccessCollection = { type: "FeatureCollection"; features: AccessFeature[]; metadata: { source: string; license: string; retrieved_at: string; bbox: number[] } };

type Tags = Record<string, string | undefined>;
type OsmEl =
  | { type: "node"; id: number; lat: number; lon: number; tags?: Tags }
  | { type: "way"; id: number; geometry?: { lat: number; lon: number }[]; tags?: Tags };

const yn = (v: string | undefined): "yes" | "no" | "unknown" => (v === "yes" ? "yes" : v === "no" ? "no" : "unknown");
const wc = (v: string | undefined): AccessProps["wheelchair"] => (v === "yes" || v === "no" || v === "limited" ? v : "unknown");

export function classifyNode(t: Tags): AccessKind | null {
  if (t.highway === "elevator") return "elevator";
  if (t.entrance && (t.wheelchair || t.ramp || t["ramp:wheelchair"])) return "entrance";
  if (t.barrier === "kerb" || t.kerb) {
    if (t.kerb === "lowered" || t.kerb === "flush" || t.kerb === "no") return "kerb_lowered";
    if (t.kerb === "raised" || t.kerb === "regular" || t.kerb === "yes") return "kerb_raised";
    return "kerb_unknown"; // includes "rolled" and untagged kerbs
  }
  if (t.highway === "crossing" || t.crossing) return "crossing";
  return null;
}

/** A path explicitly tagged as a ramp, or with a non-flat incline. Untagged paths are NOT assumed flat. */
export function isSloped(t: Tags): boolean {
  if (t.ramp === "yes" || t["ramp:wheelchair"] === "yes") return true;
  const i = (t.incline ?? "").trim().toLowerCase();
  if (!i || i === "no") return false;
  if (i === "up" || i === "down" || i === "yes") return true;
  const n = parseFloat(i);
  return Number.isFinite(n) && n !== 0;
}

export function classifyWay(t: Tags): AccessKind | null {
  if (t.highway === "steps") return "steps";
  if ((t.highway === "footway" || t.highway === "path" || t.highway === "pedestrian") && isSloped(t)) return "ramp";
  if (t.highway === "pedestrian") return "pedestrian_area";
  if (t.highway === "footway" || t.highway === "path") {
    if (t.footway === "sidewalk") return "sidewalk";
    if (t.footway === "crossing") return "crossing_line";
    return "footway";
  }
  return null;
}

function props(kind: AccessKind, osm_id: string, t: Tags): AccessProps {
  const n = Number(t.step_count);
  return {
    kind,
    osm_id,
    wheelchair: wc(t.wheelchair),
    tactile_paving: yn(t.tactile_paving),
    surface: t.surface ?? null,
    step_count: Number.isFinite(n) && n > 0 ? n : null,
    handrail: yn(t.handrail ?? (t["handrail:left"] === "yes" || t["handrail:right"] === "yes" ? "yes" : undefined)),
    ramp: yn(t["ramp:wheelchair"] ?? t.ramp),
    signals: t.crossing === "traffic_signals" || t["crossing:signals"] === "yes" ? "yes" : t["crossing:signals"] === "no" || t.crossing === "unmarked" ? "no" : "unknown",
    incline: t.incline ?? null,
    width_m: Number.isFinite(parseFloat(t.width ?? "")) ? parseFloat(t.width!) : null,
    ramp_type: rampType(kind, t),
    structure: t.bridge && t.bridge !== "no" ? "bridge" : t.tunnel && t.tunnel !== "no" ? "tunnel" : t.indoor === "yes" ? "indoor" : t.covered === "yes" ? "covered" : (Number(t.layer) || 0) !== 0 ? "bridge" : null,
    name: t.name ?? null,
  };
}

function rampType(kind: AccessKind, t: Tags): AccessProps["ramp_type"] {
  if (kind === "kerb_lowered") return "curb_ramp";
  if (kind === "entrance") return yn(t["ramp:wheelchair"] ?? t.ramp) === "yes" ? "building_ramp" : "unknown";
  if (kind === "steps") return yn(t["ramp:wheelchair"] ?? t.ramp) === "yes" ? "stair_ramp" : "unknown";
  if (kind === "ramp") return "path_ramp";
  return "unknown";
}

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

/** Rough metres between two lon/lat points (fine at city scale). */
function distM(a: [number, number], b: [number, number]): number {
  const k = 111_320;
  const dx = (a[0] - b[0]) * k * Math.cos((a[1] * Math.PI) / 180);
  const dy = (a[1] - b[1]) * k;
  return Math.hypot(dx, dy);
}

/**
 * Add UNCONFIRMED ramp candidates (kind "ramp_candidate", method "inferred"):
 *  1. Crossing nodes tagged tactile_paving=yes with no kerb node mapped within `radiusM`.
 *     Tactile paving at a crossing usually sits on a curb ramp, but nothing confirms it.
 *  2. Stairs tagged ramp=yes / ramp:wheelchair=yes: a ramp is said to run alongside;
 *     we mark the stair midpoint because the ramp itself is not mapped.
 * Candidates never replace mapped data and are labelled low confidence.
 */
export function inferRampCandidates(features: AccessFeature[], radiusM = 10): AccessFeature[] {
  const kerbs = features.filter((f) => f.properties.kind.startsWith("kerb") && f.geometry.type === "Point").map((f) => f.geometry.coordinates as [number, number]);
  const out: AccessFeature[] = [];
  for (const f of features) {
    const p = f.properties;
    if (p.kind === "crossing" && p.tactile_paving === "yes" && f.geometry.type === "Point") {
      const c = f.geometry.coordinates;
      if (kerbs.some((k) => distM(k, c) <= radiusM)) continue;
      out.push({ type: "Feature", geometry: f.geometry, properties: { ...p, kind: "ramp_candidate", ramp_type: "curb_ramp", reason: `Crossing has tactile paving but no curb is mapped within ${radiusM} m. A curb ramp is likely but unconfirmed.` } });
    }
    if (p.kind === "steps" && p.ramp === "yes" && f.geometry.type === "LineString") {
      const g = f.geometry.coordinates;
      out.push({ type: "Feature", geometry: { type: "Point", coordinates: g[Math.floor(g.length / 2)] }, properties: { ...p, kind: "ramp_candidate", ramp_type: "stair_ramp", reason: "These stairs are tagged as having a ramp, but the ramp itself is not mapped. Location is approximate." } });
    }
  }
  return out;
}

export function overpassToAccess(json: { elements?: OsmEl[] }, bbox: number[], retrievedAt: string): AccessCollection {
  const features: AccessFeature[] = [];
  for (const el of json.elements ?? []) {
    const t = el.tags ?? {};
    if (el.type === "node") {
      const k = classifyNode(t);
      if (!k || !Number.isFinite(el.lat) || !Number.isFinite(el.lon)) continue;
      features.push({ type: "Feature", geometry: { type: "Point", coordinates: [r6(el.lon), r6(el.lat)] }, properties: props(k, `node/${el.id}`, t) });
    } else if (el.type === "way") {
      const k = classifyWay(t);
      const g = el.geometry ?? [];
      if (!k || g.length < 2) continue;
      features.push({ type: "Feature", geometry: { type: "LineString", coordinates: g.map((p) => [r6(p.lon), r6(p.lat)] as [number, number]) }, properties: props(k, `way/${el.id}`, t) });
    }
  }
  features.push(...inferRampCandidates(features));
  return {
    type: "FeatureCollection",
    features,
    metadata: { source: "OpenStreetMap via Overpass API (community-mapped, unverified)", license: "ODbL © OpenStreetMap contributors", retrieved_at: retrievedAt, bbox },
  };
}

export function overpassQuery([w, s, e, n]: number[]): string {
  const b = `(${s},${w},${n},${e})`;
  return `[out:json][timeout:60];(
way["highway"="steps"]${b};
way["highway"~"^(footway|path|pedestrian)$"]${b};
node["barrier"="kerb"]${b};
node["kerb"]${b};
node["highway"="crossing"]${b};
node["highway"="elevator"]${b};
node["entrance"]["wheelchair"]${b};
node["entrance"]["ramp"]${b};
);out geom;`;
}
