/**
 * Route context from accessibility features (OSM + optional Owner C feed).
 *
 * Finds stairs, steep slopes, raised/unknown curbs, curb-ramp candidates etc. close to a
 * route line. This is CONTEXT, separate from barrier records: OSM is community-mapped
 * and unverified, and "near the route" is approximate. It never changes the route.
 *
 * To change what is flagged or how close counts, edit CONTEXT_RULES only.
 */
import type { AccessFeatureV1 } from "./accessContract";

type LonLat = [number, number];

export interface ContextRule {
  key: string;
  label: string;
  /** "caution" = possible obstacle; "info" = helpful feature (shown as a count, never as a guarantee). */
  tone: "caution" | "info";
  radiusM: number;
  match: (f: AccessFeatureV1) => boolean;
}

const k = (f: AccessFeatureV1) => f.properties.kind;
const slope = (f: AccessFeatureV1) => f.properties.detail.slope_pct;

/** Order = display order. */
export const CONTEXT_RULES: ContextRule[] = [
  { key: "stairs", label: "Stairs on or next to the route", tone: "caution", radiusM: 10, match: (f) => k(f) === "steps" },
  // Very steep ground on a path not tagged as stairs: possibly unmapped stairs or a steep ramp.
  { key: "very_steep", label: "Very steep spots (over 12%): possibly unmapped stairs", tone: "caution", radiusM: 6, match: (f) => k(f) !== "steps" && (slope(f) ?? 0) > 12 },
  { key: "steep", label: "Steep slope (8.3–12%, where known)", tone: "caution", radiusM: 6, match: (f) => (slope(f) ?? 0) > 8.33 },
  { key: "raised_kerb", label: "Raised curbs (no ramp mapped)", tone: "caution", radiusM: 8, match: (f) => k(f) === "kerb_raised" },
  { key: "unknown_kerb", label: "Curbs of unknown type", tone: "caution", radiusM: 8, match: (f) => k(f) === "kerb_unknown" },
  { key: "ramp_candidate", label: "Possible curb ramps (unconfirmed)", tone: "info", radiusM: 8, match: (f) => k(f) === "ramp_candidate" },
  { key: "curb_ramp", label: "Mapped curb ramps (condition unverified)", tone: "info", radiusM: 8, match: (f) => k(f) === "kerb_lowered" || k(f) === "curb_ramp" },
  { key: "ramp", label: "Ramps / sloped paths", tone: "info", radiusM: 10, match: (f) => k(f) === "ramp" },
  { key: "elevator", label: "Elevators nearby", tone: "info", radiusM: 40, match: (f) => k(f) === "elevator" },
];

export interface ContextHit {
  id: string;
  kind: string;
  distance_m: number;
  /** Closest point of the feature to the route: where the map should pan. */
  at: LonLat;
  source: string;
  method: string;
  verification_status: string;
  slope_pct: number | null;
  step_count: number | null;
  rise_m: number | null;
}
export interface ContextGroup { key: string; label: string; tone: "caution" | "info"; radiusM: number; hits: ContextHit[] }

// --- geometry (local equirectangular metres; fine at neighbourhood scale) ---
function projector(lat0: number) {
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180), ky = 110_540;
  return (p: LonLat): [number, number] => [p[0] * kx, p[1] * ky];
}
function segDist(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
const lineDist = (p: [number, number], line: [number, number][]) => {
  let d = Infinity;
  for (let i = 1; i < line.length; i++) d = Math.min(d, segDist(p, line[i - 1], line[i]));
  return line.length === 1 ? Math.hypot(p[0] - line[0][0], p[1] - line[0][1]) : d;
};

type XY = [number, number];
const cross = (o: XY, a: XY, b: XY) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
/** Proper or touching intersection of segments ab and cd. */
function segmentsCross(a: XY, b: XY, c: XY, d: XY): boolean {
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0) || d1 === 0 || d2 === 0) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0) || d3 === 0 || d4 === 0);
}

/** Distance (m) from a feature to the route, and the feature vertex closest to it. */
export function distanceToRoute(geom: AccessFeatureV1["geometry"], route: LonLat[]): { d: number; at: LonLat } {
  const proj = projector(route[0][1]);
  const r = route.map(proj);
  const pts: LonLat[] = geom.type === "Point" ? [geom.coordinates] : geom.coordinates;
  let best = { d: Infinity, at: pts[0] };
  for (const p of pts) {
    const d = lineDist(proj(p), r);
    if (d < best.d) best = { d, at: p };
  }
  // A line feature can cross the route between vertices: an actual crossing is distance 0,
  // otherwise also test route vertices against the feature line.
  if (geom.type === "LineString" && pts.length > 1) {
    const g = pts.map(proj);
    for (let i = 1; i < g.length; i++) for (let j = 1; j < r.length; j++) {
      if (segmentsCross(g[i - 1], g[i], r[j - 1], r[j])) return { d: 0, at: pts[i - 1] };
    }
    for (const rp of r) { const d = lineDist(rp, g); if (d < best.d) best = { d, at: best.at }; }
  }
  return best;
}

export function routeContext(route: LonLat[], features: AccessFeatureV1[], rules: ContextRule[] = CONTEXT_RULES): ContextGroup[] {
  if (route.length < 2) return [];
  const maxR = Math.max(...rules.map((r) => r.radiusM));
  // Cheap bbox prefilter (degrees; ~1e-5 deg ≈ 1 m).
  const pad = (maxR + 5) / 90_000;
  const xs = route.map((c) => c[0]), ys = route.map((c) => c[1]);
  const [w, s, e, n] = [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
  const groups: ContextGroup[] = rules.map((r) => ({ key: r.key, label: r.label, tone: r.tone, radiusM: r.radiusM, hits: [] }));
  for (const f of features) {
    const pts = f.geometry.type === "Point" ? [f.geometry.coordinates] : f.geometry.coordinates;
    if (!pts.some((p) => p[0] >= w && p[0] <= e && p[1] >= s && p[1] <= n)) continue;
    const ri = rules.findIndex((r) => r.match(f));
    if (ri < 0) continue;
    const { d, at } = distanceToRoute(f.geometry, route);
    if (d > rules[ri].radiusM) continue;
    const v = f.properties.provenance;
    groups[ri].hits.push({
      id: f.id, kind: f.properties.kind, distance_m: Math.round(d), at, source: v.source, method: v.method,
      verification_status: v.verification_status, slope_pct: f.properties.detail.slope_pct, step_count: f.properties.detail.step_count, rise_m: f.properties.detail.rise_m,
    });
  }
  for (const g of groups) g.hits.sort((a, b) => a.distance_m - b.distance_m);
  return groups.filter((g) => g.hits.length);
}
