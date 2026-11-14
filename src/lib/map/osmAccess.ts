/**
 * Convert an Overpass JSON response (OSM pedestrian infrastructure) into a compact
 * GeoJSON FeatureCollection for map context. OSM is community-mapped: these are
 * CONTEXT features, not barrier observations, and are never treated as verified.
 * Missing tags become "unknown" (never assumed accessible).
 */

export type AccessKind =
  | "steps" | "sidewalk" | "crossing_line" | "footway" | "pedestrian_area"
  | "kerb_lowered" | "kerb_raised" | "kerb_unknown"
  | "crossing" | "elevator";

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
  if (t.barrier === "kerb" || t.kerb) {
    if (t.kerb === "lowered" || t.kerb === "flush" || t.kerb === "no") return "kerb_lowered";
    if (t.kerb === "raised" || t.kerb === "regular" || t.kerb === "yes") return "kerb_raised";
    return "kerb_unknown"; // includes "rolled" and untagged kerbs
  }
  if (t.highway === "crossing" || t.crossing) return "crossing";
  return null;
}

export function classifyWay(t: Tags): AccessKind | null {
  if (t.highway === "steps") return "steps";
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
    name: t.name ?? null,
  };
}

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

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
);out geom;`;
}
