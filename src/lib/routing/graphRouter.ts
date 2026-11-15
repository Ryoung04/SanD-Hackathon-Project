/**
 * AccessPath pedestrian router (Owner B): A* over the downtown OSM walking graph
 * (data/derived/downtown-graph.json, built by scripts/osm/fetch-graph.ts).
 *
 * Why our own router: it can cross open plazas, use building passages/corridors, and
 * apply our own accessibility rules (stairs, curbs, elevation slope), which Valhalla can't.
 * Valhalla stays as the fallback (see src/app/api/route/route.ts).
 *
 * Profiles (tune ONLY in PROFILES):
 *  - pedestrian: everything walkable, stairs included (slightly penalised).
 *  - wheelchair_preference / avoid_stairs: stairs are NEVER used. If no step-free path
 *    exists in the mapped data, there is no route (we never fall back to stairs).
 * All of it is community-mapped data: a route is never "verified accessible".
 */
import fs from "node:fs";
import path from "node:path";
import { metres, type RoutingGraph, type WayKind } from "./graphBuild";
import type { LatLon, RouteProfile, RouteStep } from "./provider";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface ProfileCost {
  /** Cost multiplier per way kind; Infinity = not allowed. */
  kind: Record<WayKind, number>;
  /** [minimum slope %, multiplier]; highest matching entry wins. Infinity = blocked. */
  slope: [number, number][];
  /** Extra cost in metres when passing a curb node of this type. Infinity = blocked. */
  kerb: { raised: number; unknown: number; lowered: number };
  /** Ways tagged wheelchair=no are blocked. */
  blockWheelchairNo: boolean;
  speedMps: number;
}

const WALK: Record<WayKind, number> = {
  sidewalk: 1, footway: 1, path: 1.1, crossing: 1, steps: 1.15, pedestrian: 1, area_link: 1,
  corridor: 1, passage: 1, road_sidewalk: 1.1, road_unknown: 1.5, road_separate: 3, service: 1.3,
};
const WHEELS: Record<WayKind, number> = { ...WALK, steps: Infinity, path: 1.3, corridor: 1.2, passage: 1.2, road_unknown: 2, service: 1.5 };

export const PROFILES: Record<RouteProfile, ProfileCost> = {
  pedestrian: { kind: WALK, slope: [], kerb: { raised: 0, unknown: 0, lowered: 0 }, blockWheelchairNo: false, speedMps: 1.3 },
  wheelchair_preference: {
    kind: WHEELS, slope: [[5, 1.3], [8.33, 2], [12, 5]], kerb: { raised: 300, unknown: 40, lowered: 0 }, blockWheelchairNo: true, speedMps: 1.0,
  },
  avoid_stairs: {
    kind: WHEELS, slope: [[5, 1.5], [8.33, 3], [12, 10]], kerb: { raised: Infinity, unknown: 60, lowered: 0 }, blockWheelchairNo: true, speedMps: 1.0,
  },
};

/** Max distance (m) from a requested point to the walking network. */
export const SNAP_MAX_M = 150;
/** Wheelchair profiles: fail if the nearest usable way is this much farther than the nearest way of any kind. */
export const STEP_FREE_SNAP_SLACK_M = 25;
export const GRAPH_PATH = () => process.env.ROUTING_GRAPH_PATH || path.join(process.cwd(), "data", "derived", "downtown-graph.json");

// ---------------------------------------------------------------------------
// Graph loading + adjacency
// ---------------------------------------------------------------------------

export interface LoadedGraph extends RoutingGraph {
  edge_slope?: (number | null)[];
  /** adjacency: node -> list of edge indexes */
  adj: number[][];
}

export function prepareGraph(g: RoutingGraph & { edge_slope?: (number | null)[] }): LoadedGraph {
  const adj: number[][] = g.nodes.map(() => []);
  g.edges.forEach(([a, b], i) => { adj[a].push(i); adj[b].push(i); });
  return { ...g, adj };
}

let cached: LoadedGraph | null | undefined;
/** Loads once per server process. Returns null if the graph file is missing or broken. */
export function loadGraph(): LoadedGraph | null {
  if (cached !== undefined) return cached;
  try { cached = prepareGraph(JSON.parse(fs.readFileSync(GRAPH_PATH(), "utf8"))); } catch { cached = null; }
  return cached;
}

// ---------------------------------------------------------------------------
// Cost
// ---------------------------------------------------------------------------

export function edgeAllowed(g: LoadedGraph, e: number, p: ProfileCost): boolean {
  const w = g.ways[g.edges[e][3]];
  if (!Number.isFinite(p.kind[w.kind])) return false;
  if (p.blockWheelchairNo && w.wheelchair === "no") return false;
  return Number.isFinite(slopeFactor(g.edge_slope?.[e] ?? null, p));
}
function slopeFactor(pct: number | null, p: ProfileCost): number {
  if (pct === null) return 1;
  let f = 1;
  for (const [min, mult] of p.slope) if (pct > min) f = mult;
  return f;
}
function kerbCost(g: LoadedGraph, node: number, p: ProfileCost): number {
  const k = g.kerbs[node];
  return k ? p.kerb[k] : 0;
}
function edgeCost(g: LoadedGraph, e: number, toNode: number, p: ProfileCost): number {
  const [, , len, wi] = g.edges[e];
  return len * p.kind[g.ways[wi].kind] * slopeFactor(g.edge_slope?.[e] ?? null, p) + kerbCost(g, toNode, p);
}

// ---------------------------------------------------------------------------
// Snapping (nearest allowed edge, split with a virtual node)
// ---------------------------------------------------------------------------

type Snap = { edge: number; point: [number, number]; t: number; dist: number };
/** Nearest edge usable by the profile (or by anyone, if `p` is null), within maxM. */
export function snap(g: LoadedGraph, pt: LatLon, p: ProfileCost | null, maxM = SNAP_MAX_M): Snap | null {
  const P: [number, number] = [pt.lon, pt.lat];
  const kx = 111_320 * Math.cos((pt.lat * Math.PI) / 180), ky = 110_540;
  const pad = maxM / 90_000;
  let best: Snap | null = null;
  for (let e = 0; e < g.edges.length; e++) {
    const [a, b] = g.edges[e];
    const A = g.nodes[a], B = g.nodes[b];
    if (Math.min(A[0], B[0]) > P[0] + pad * 1.3 || Math.max(A[0], B[0]) < P[0] - pad * 1.3 || Math.min(A[1], B[1]) > P[1] + pad || Math.max(A[1], B[1]) < P[1] - pad) continue;
    if (g.ways[g.edges[e][3]].kind === "area_link") continue; // snap to real ways only
    if (p && !edgeAllowed(g, e, p)) continue;
    const ax = (A[0] - P[0]) * kx, ay = (A[1] - P[1]) * ky, bx = (B[0] - P[0]) * kx, by = (B[1] - P[1]) * ky;
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d <= maxM && (!best || d < best.dist)) best = { edge: e, t, dist: d, point: [A[0] + t * (B[0] - A[0]), A[1] + t * (B[1] - A[1])] };
  }
  return best;
}

// ---------------------------------------------------------------------------
// A*
// ---------------------------------------------------------------------------

class Heap {
  private k: number[] = []; private v: number[] = [];
  get size() { return this.k.length; }
  push(key: number, val: number) {
    const k = this.k, v = this.v; k.push(key); v.push(val);
    let i = k.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= k[i]) break; [k[p], k[i]] = [k[i], k[p]]; [v[p], v[i]] = [v[i], v[p]]; i = p; }
  }
  pop(): number {
    const k = this.k, v = this.v, top = v[0], lk = k.pop()!, lv = v.pop()!;
    if (k.length) {
      k[0] = lk; v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < k.length && k[l] < k[m]) m = l;
        if (r < k.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]]; [v[m], v[i]] = [v[i], v[m]]; i = m;
      }
    }
    return top;
  }
}

export interface GraphRouteFeatures { stairs: number; passages: number; open_areas: number; corridors: number; road_no_sidewalk_m: number }
export type GraphRouteResult =
  | { ok: true; provider: "accesspath-osm-graph"; route: { type: "LineString"; coordinates: [number, number][] }; distance_m: number; duration_s: number; steps: RouteStep[]; route_features: GraphRouteFeatures; ways_used: string[] }
  | { ok: false; provider: "accesspath-osm-graph"; reason: string; code: "NO_GRAPH" | "SNAP_FAILED" | "NO_PATH" };

/** Route between two points. Edges are traversed in either direction. */
export function routeOnGraph(g: LoadedGraph, start: LatLon, end: LatLon, profile: RouteProfile): GraphRouteResult {
  const p = PROFILES[profile];
  const fail = (code: "SNAP_FAILED" | "NO_PATH", reason: string): GraphRouteResult => ({ ok: false, provider: "accesspath-osm-graph", code, reason });
  const s = snap(g, start, p), t = snap(g, end, p);
  if (!s || !t) return fail("SNAP_FAILED", `${!s ? "Start" : "Destination"} is more than ${SNAP_MAX_M} m from any mapped path${profile === "pedestrian" ? "" : " usable without stairs"}`);
  // If the point sits on a stair/blocked way and the nearest usable way is much farther,
  // say so instead of quietly routing to a different place.
  if (profile !== "pedestrian") {
    for (const [name, pt, sn] of [["Start", start, s], ["Destination", end, t]] as const) {
      const any = snap(g, pt, null);
      if (any && sn.dist - any.dist > STEP_FREE_SNAP_SLACK_M) {
        return fail("NO_PATH", `${name} appears reachable only by stairs or a blocked path in the mapped data (nearest step-free path is ~${Math.round(sn.dist)} m away)`);
      }
    }
  }

  // Virtual nodes: S = N, T = N+1, connected to the ends of their snapped edges.
  const N = g.nodes.length, S = N, T = N + 1;
  const pos = (i: number): [number, number] => (i === S ? s.point : i === T ? t.point : g.nodes[i]);
  const virt = new Map<number, { to: number; cost: number; len: number; edge: number }[]>();
  const addV = (from: number, to: number, len: number, edge: number, cost: number) => (virt.get(from) ?? virt.set(from, []).get(from)!).push({ to, cost, len, edge });
  for (const [V, sn] of [[S, s], [T, t]] as const) {
    const [a, b, len] = g.edges[sn.edge];
    const f = len ? edgeCost(g, sn.edge, -1, p) / len : 1; // per-metre cost of that edge (no kerb)
    const la = len * sn.t, lb = len * (1 - sn.t);
    addV(V, a, la, sn.edge, la * f + kerbCost(g, a, p)); addV(a, V, la, sn.edge, la * f);
    addV(V, b, lb, sn.edge, lb * f + kerbCost(g, b, p)); addV(b, V, lb, sn.edge, lb * f);
  }
  if (s.edge === t.edge) { // same edge: direct link
    const [, , elen] = g.edges[s.edge];
    const len = elen * Math.abs(s.t - t.t);
    addV(S, T, len, s.edge, elen ? (len * edgeCost(g, s.edge, -1, p)) / elen : len);
  }

  const minF = Math.min(...Object.values(p.kind));
  const goal = pos(T);
  const h = (i: number) => metres(pos(i), goal) * minF;
  const dist = new Map<number, number>([[S, 0]]);
  const prev = new Map<number, { from: number; edge: number }>();
  const heap = new Heap();
  heap.push(h(S), S);
  const done = new Set<number>();
  while (heap.size) {
    const u = heap.pop();
    if (done.has(u)) continue;
    done.add(u);
    if (u === T) break;
    const du = dist.get(u)!;
    const relax = (v: number, c: number, edge: number) => {
      const nd = du + c;
      if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, { from: u, edge }); heap.push(nd + h(v), v); }
    };
    for (const vv of virt.get(u) ?? []) if (Number.isFinite(vv.cost)) relax(vv.to, vv.cost, vv.edge);
    if (u < N) for (const e of g.adj[u]) {
      if (!edgeAllowed(g, e, p)) continue;
      const [a, b] = g.edges[e];
      const v = a === u ? b : a;
      const c = edgeCost(g, e, v, p);
      if (Number.isFinite(c)) relax(v, c, e);
    }
  }
  if (!prev.has(T)) {
    return fail("NO_PATH", profile === "pedestrian" ? "No walking path found in the mapped data" : "No step-free route found in the mapped data (stairs are never used for this preference)");
  }

  // Reconstruct.
  const nodesSeq: number[] = [T];
  const edgesSeq: number[] = [];
  for (let c = T; c !== S;) { const pr = prev.get(c)!; edgesSeq.push(pr.edge); nodesSeq.push(pr.from); c = pr.from; }
  nodesSeq.reverse(); edgesSeq.reverse();
  const coords = nodesSeq.map((i) => pos(i));
  let distance = 0;
  for (let i = 1; i < coords.length; i++) distance += metres(coords[i - 1], coords[i]);
  const { steps, features, waysUsed } = describe(g, coords, edgesSeq);
  return {
    ok: true, provider: "accesspath-osm-graph",
    route: { type: "LineString", coordinates: coords.map((c) => [Math.round(c[0] * 1e6) / 1e6, Math.round(c[1] * 1e6) / 1e6] as [number, number]) },
    distance_m: Math.round(distance), duration_s: Math.round(distance / p.speedMps), steps, route_features: features, ways_used: waysUsed,
  };
}

// ---------------------------------------------------------------------------
// Instructions
// ---------------------------------------------------------------------------

const bearing = (a: [number, number], b: [number, number]) => {
  const k = Math.cos((a[1] * Math.PI) / 180);
  return (Math.atan2((b[0] - a[0]) * k, b[1] - a[1]) * 180) / Math.PI;
};
function turnWord(prev: number, next: number): string {
  let d = next - prev;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  if (d > 135 || d < -135) return "Turn around and ";
  if (d > 30) return "Turn right and ";
  if (d < -30) return "Turn left and ";
  return "";
}
function stepText(kind: WayKind, name: string | null, len: number, stepCount: number | null): string {
  const m = `${Math.max(1, Math.round(len))} m`;
  switch (kind) {
    case "steps": return `take the stairs${stepCount ? ` (${stepCount} steps)` : ""}`;
    case "crossing": return `cross ${name ? name : "the street"} at the crosswalk`;
    case "area_link": return `cross the open plaza${name ? ` (${name})` : ""} for ${m}`;
    case "passage": return `go through the building passage${name ? ` (${name})` : ""} for ${m}`;
    case "corridor": return `go through the indoor corridor${name ? ` (${name})` : ""} for ${m}`;
    case "pedestrian": return `walk ${m} along ${name ?? "the pedestrian street"}`;
    case "road_unknown": case "road_separate": case "service": return `walk ${m} along ${name ?? "the street"} (no sidewalk mapped)`;
    case "road_sidewalk": return `walk ${m} along ${name ?? "the street"}`;
    case "sidewalk": return `walk ${m} on the sidewalk${name ? ` of ${name}` : ""}`;
    default: return `walk ${m} on the ${kind === "path" ? "path" : "footpath"}${name ? ` (${name})` : ""}`;
  }
}

function describe(g: LoadedGraph, coords: [number, number][], edges: number[]) {
  const steps: RouteStep[] = [];
  const features: GraphRouteFeatures = { stairs: 0, passages: 0, open_areas: 0, corridors: 0, road_no_sidewalk_m: 0 };
  const waysUsed: string[] = [];
  let i = 0;
  let lastBearing: number | null = null;
  while (i < edges.length) {
    const w = g.ways[g.edges[edges[i]][3]];
    let j = i, len = 0;
    while (j < edges.length) {
      const wj = g.ways[g.edges[edges[j]][3]];
      if (wj.kind !== w.kind || wj.name !== w.name) break;
      len += metres(coords[j], coords[j + 1]);
      j++;
    }
    if (len < 0.5) { i = j; continue; } // zero-length piece from snapping exactly onto a node
    const b0 = bearing(coords[i], coords[Math.min(i + 1, coords.length - 1)]);
    const text = stepText(w.kind, w.name, len, w.step_count);
    const prefix = lastBearing === null ? "" : turnWord(lastBearing, b0);
    const sentence = prefix ? prefix + text : text.charAt(0).toUpperCase() + text.slice(1);
    steps.push({ instruction: sentence.charAt(0).toUpperCase() + sentence.slice(1) + ".", distance_m: Math.round(len), begin_index: i, street: w.name });
    if (w.kind === "steps") features.stairs++;
    if (w.kind === "passage") features.passages++;
    if (w.kind === "corridor") features.corridors++;
    if (w.kind === "area_link") features.open_areas++;
    if (w.kind === "road_unknown" || w.kind === "road_separate" || w.kind === "service") features.road_no_sidewalk_m += Math.round(len);
    if (!waysUsed.includes(w.osm_id)) waysUsed.push(w.osm_id);
    lastBearing = bearing(coords[Math.max(i, j - 1)], coords[j]);
    i = j;
  }
  steps.push({ instruction: "You have arrived.", distance_m: 0, begin_index: coords.length - 1, street: null });
  return { steps, features, waysUsed };
}
