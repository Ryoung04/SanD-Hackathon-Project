/**
 * Build a compact pedestrian routing graph from an Overpass response (`out body; >; out skel qt;`).
 *
 * Owner B. Pure and testable; the script scripts/osm/fetch-graph.ts writes the result to
 * data/derived/downtown-graph.json, and graphRouter.ts routes over it.
 *
 * What is walkable:
 *   sidewalks, footways, paths, crossings, stairs, pedestrian streets, open pedestrian AREAS
 *   (plazas: straight "visibility" links across them), indoor corridors and building passages,
 *   and ordinary streets (sidewalk presence taken from tags; unknown stays unknown).
 * Excluded: motorways/trunk roads and ways tagged foot=no/access=private.
 *
 * Data caveat: OSM is community-mapped. Edge attributes come from tags; nothing is verified.
 */

type Tags = Record<string, string | undefined>;
export type OverpassEl =
  | { type: "node"; id: number; lat: number; lon: number; tags?: Tags }
  | { type: "way"; id: number; nodes?: number[]; tags?: Tags };

/** Edge classes. Cost factors per profile live in graphRouter.ts (PROFILES). */
export const WAY_KINDS = [
  "sidewalk", "footway", "path", "crossing", "steps", "pedestrian", "area_link",
  "corridor", "passage", "road_sidewalk", "road_unknown", "road_separate", "service",
] as const;
export type WayKind = (typeof WAY_KINDS)[number];

export interface GraphWay {
  osm_id: string; // "way/123", or "area/123" for synthetic plaza links
  kind: WayKind;
  name: string | null;
  step_count: number | null;
  wheelchair: "yes" | "no" | "limited" | "unknown";
  surface: string | null;
  incline: string | null;
  /** Max running slope (%) from elevation data, filled in by the script when available. */
  slope_pct?: number | null;
}

export interface RoutingGraph {
  meta: { source: string; license: string; retrieved_at: string; bbox: number[]; slope_source: string | null; counts: Record<string, number> };
  /** [lon, lat] per node index. */
  nodes: [number, number][];
  /** OSM node id per node index (for debugging / joins). */
  node_ids: number[];
  /** Curb type at node index (only nodes that have one). */
  kerbs: Record<number, "raised" | "lowered" | "unknown">;
  ways: GraphWay[];
  /** [from, to, length_m, way index]. Undirected. */
  edges: [number, number, number, number][];
}

const kx = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);
const KY = 110_540;
export function metres(a: [number, number], b: [number, number]): number {
  const k = kx((a[1] + b[1]) / 2);
  return Math.hypot((a[0] - b[0]) * k, (a[1] - b[1]) * KY);
}

const NO_FOOT = new Set(["no", "private"]);
const ROADS = new Set(["primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link", "unclassified", "residential", "living_street", "road"]);

/** Classify a way for walking, or null if not walkable. */
export function classifyGraphWay(t: Tags): WayKind | null {
  if (NO_FOOT.has(t.foot ?? "") || (NO_FOOT.has(t.access ?? "") && t.foot !== "yes" && t.foot !== "designated")) return null;
  const h = t.highway;
  if (h === "steps") return "steps";
  if (h === "corridor" || t.indoor === "corridor") return "corridor";
  if (h === "footway" || h === "path" || h === "cycleway" || h === "pedestrian" || h === "track" || h === "bridleway") {
    if (t.tunnel === "building_passage" || t.covered === "yes" && t.indoor === "yes") return "passage";
    if (h === "pedestrian") return "pedestrian";
    if (t.footway === "sidewalk") return "sidewalk";
    if (t.footway === "crossing" || t.path === "crossing") return "crossing";
    if (h === "cycleway" && t.foot !== "yes" && t.foot !== "designated") return null;
    return h === "footway" ? "footway" : "path";
  }
  if (h === "service") return t.tunnel === "building_passage" ? "passage" : "service";
  if (h && ROADS.has(h)) {
    if (t.tunnel === "building_passage") return "passage";
    const sw = t.sidewalk ?? t["sidewalk:both"] ?? (t["sidewalk:left"] || t["sidewalk:right"] ? "yes" : undefined);
    if (sw === "separate") return "road_separate"; // sidewalks are mapped as their own ways: prefer those
    if (sw === "both" || sw === "left" || sw === "right" || sw === "yes") return "road_sidewalk";
    if (h === "living_street") return "road_sidewalk";
    return "road_unknown";
  }
  return null;
}

/** Is this way a closed pedestrian area (plaza) that can be crossed in straight lines? */
export function isOpenArea(t: Tags, nodes: number[]): boolean {
  if (nodes.length < 4 || nodes[0] !== nodes[nodes.length - 1]) return false;
  if (t.area === "no") return false;
  return t.highway === "pedestrian" && (t.area === "yes" || t.area === undefined) || (t.highway === "footway" && t.area === "yes");
}

const yn = (v?: string) => (v === "yes" || v === "no" || v === "limited" ? v : "unknown") as GraphWay["wheelchair"];

// --- open-area visibility links ---
type XY = [number, number];
const cross = (o: XY, a: XY, b: XY) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
function properlyCross(a: XY, b: XY, c: XY, d: XY): boolean {
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
function pointInRing(p: XY, ring: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/**
 * Pairs of ring vertices (by position in `ring`) that can be joined by a straight line inside
 * the area: midpoint inside and no proper crossing of the boundary. Rings over `maxNodes`
 * vertices are thinned to keep the link count bounded.
 */
export function visibilityPairs(ring: XY[], maxNodes = 48): [number, number][] {
  const n = ring.length - 1; // last == first
  const step = Math.max(1, Math.ceil(n / maxNodes));
  const idx: number[] = [];
  for (let i = 0; i < n; i += step) idx.push(i);
  const pairs: [number, number][] = [];
  for (let a = 0; a < idx.length; a++) for (let b = a + 1; b < idx.length; b++) {
    const i = idx[a], j = idx[b];
    if (j - i === 1 || (i === 0 && j === n - 1)) continue; // ring neighbours: already an edge
    const p = ring[i], q = ring[j];
    if (!pointInRing([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], ring)) continue;
    let blocked = false;
    for (let k = 0; k < n && !blocked; k++) {
      if (k === i || k === j || (k + 1) % n === i || (k + 1) % n === j) continue;
      if (properlyCross(p, q, ring[k], ring[k + 1])) blocked = true;
    }
    if (!blocked) pairs.push([i, j]);
  }
  return pairs;
}

export function buildGraph(els: OverpassEl[], bbox: number[], retrievedAt: string): RoutingGraph {
  const nodeEl = new Map<number, { lon: number; lat: number; tags?: Tags }>();
  for (const e of els) if (e.type === "node" && Number.isFinite(e.lat) && Number.isFinite(e.lon)) nodeEl.set(e.id, { lon: e.lon, lat: e.lat, tags: e.tags });

  const index = new Map<number, number>();
  const nodes: [number, number][] = [];
  const node_ids: number[] = [];
  const kerbs: RoutingGraph["kerbs"] = {};
  const idx = (id: number): number => {
    let i = index.get(id);
    if (i !== undefined) return i;
    const n = nodeEl.get(id)!;
    i = nodes.length;
    index.set(id, i);
    nodes.push([Math.round(n.lon * 1e6) / 1e6, Math.round(n.lat * 1e6) / 1e6]);
    node_ids.push(id);
    const t = n.tags ?? {};
    if (t.barrier === "kerb" || t.kerb) {
      kerbs[i] = t.kerb === "lowered" || t.kerb === "flush" || t.kerb === "no" ? "lowered" : t.kerb === "raised" || t.kerb === "regular" || t.kerb === "yes" ? "raised" : "unknown";
    }
    return i;
  };

  const ways: GraphWay[] = [];
  const edges: RoutingGraph["edges"] = [];
  const counts: Record<string, number> = {};
  for (const e of els) {
    if (e.type !== "way" || !e.nodes || e.nodes.length < 2) continue;
    const t = e.tags ?? {};
    const kind = classifyGraphWay(t);
    if (!kind) continue;
    const ids = e.nodes.filter((id) => nodeEl.has(id));
    if (ids.length < 2) continue;
    const n = Number(t.step_count);
    const wi = ways.push({
      osm_id: `way/${e.id}`, kind, name: t.name ?? null, step_count: Number.isFinite(n) && n > 0 ? n : null,
      wheelchair: yn(t.wheelchair), surface: t.surface ?? null, incline: t.incline ?? null,
    }) - 1;
    counts[kind] = (counts[kind] ?? 0) + 1;
    for (let k = 1; k < ids.length; k++) {
      const a = idx(ids[k - 1]), b = idx(ids[k]);
      if (a !== b) edges.push([a, b, Math.round(metres(nodes[a], nodes[b]) * 10) / 10, wi]);
    }
    if (isOpenArea(t, e.nodes)) {
      const ring = ids.map((id) => [nodeEl.get(id)!.lon, nodeEl.get(id)!.lat] as XY);
      if (ring.length >= 4 && ids[0] === ids[ids.length - 1]) {
        const ai = ways.push({ osm_id: `area/${e.id}`, kind: "area_link", name: t.name ?? null, step_count: null, wheelchair: yn(t.wheelchair), surface: t.surface ?? null, incline: null }) - 1;
        for (const [i, j] of visibilityPairs(ring)) {
          const a = idx(ids[i]), b = idx(ids[j]);
          edges.push([a, b, Math.round(metres(nodes[a], nodes[b]) * 10) / 10, ai]);
          counts.area_link = (counts.area_link ?? 0) + 1;
        }
      }
    }
  }
  counts.nodes = nodes.length;
  counts.edges = edges.length;
  return {
    meta: { source: "OpenStreetMap via Overpass API (community-mapped, unverified)", license: "ODbL © OpenStreetMap contributors", retrieved_at: retrievedAt, bbox, slope_source: null, counts },
    nodes, node_ids, kerbs, ways, edges,
  };
}

export function graphQuery([w, s, e, n]: number[]): string {
  const b = `(${s},${w},${n},${e})`;
  return `[out:json][timeout:90];(
way["highway"~"^(footway|path|pedestrian|steps|corridor|cycleway|track|service|living_street|residential|unclassified|tertiary|tertiary_link|secondary|secondary_link|primary|primary_link|road)$"]${b};
way["indoor"="corridor"]${b};
);out body;>;out skel qt;
node["barrier"="kerb"]${b};out body;
node["kerb"]${b};out body;`;
}
