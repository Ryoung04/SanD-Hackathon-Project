import type { Bbox, Geometry } from './types';

export function bboxOfGeometry(g: Geometry): Bbox {
  const pts: [number, number][] = g.type === 'Point' ? [g.coordinates] : g.coordinates;
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const [lon, lat] of pts) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return [minLon, minLat, maxLon, maxLat];
}

type P = [number, number];

function pointInBbox(p: P, b: Bbox) {
  return p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
}

function ccw(a: P, b: P, c: P) {
  return (c[1] - a[1]) * (b[0] - a[0]) - (b[1] - a[1]) * (c[0] - a[0]);
}
function segsIntersect(a: P, b: P, c: P, d: P) {
  const d1 = ccw(a, b, c), d2 = ccw(a, b, d), d3 = ccw(c, d, a), d4 = ccw(c, d, b);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  const on = (p: P, q: P, r: P) =>
    Math.min(p[0], q[0]) <= r[0] && r[0] <= Math.max(p[0], q[0]) && Math.min(p[1], q[1]) <= r[1] && r[1] <= Math.max(p[1], q[1]);
  if (d1 === 0 && on(a, b, c)) return true;
  if (d2 === 0 && on(a, b, d)) return true;
  if (d3 === 0 && on(c, d, a)) return true;
  if (d4 === 0 && on(c, d, b)) return true;
  return false;
}

/** Segment vs rectangle: endpoint inside, or crosses any rectangle edge. */
export function segmentIntersectsBbox(a: P, b: P, bb: Bbox): boolean {
  if (pointInBbox(a, bb) || pointInBbox(b, bb)) return true;
  const [w, s, e, n] = bb;
  const corners: P[] = [[w, s], [e, s], [e, n], [w, n]];
  for (let i = 0; i < 4; i++) if (segsIntersect(a, b, corners[i], corners[(i + 1) % 4])) return true;
  return false;
}

export function intersectsBbox(g: Geometry, bb: Bbox): boolean {
  if (g.type === 'Point') return pointInBbox(g.coordinates, bb);
  const c = g.coordinates;
  if (c.length === 1) return pointInBbox(c[0], bb);
  for (let i = 0; i < c.length - 1; i++) if (segmentIntersectsBbox(c[i], c[i + 1], bb)) return true;
  return false;
}

export function haversineMeters(a: P, b: P): number {
  const R = 6371008.8, rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad, dLon = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Distance in meters from point p to segment ab, using a local equirectangular projection. */
export function pointToSegmentMeters(p: P, a: P, b: P): number {
  const rad = Math.PI / 180, R = 6371008.8;
  const lat0 = p[1] * rad;
  const proj = (q: P): P => [(q[0] - p[0]) * rad * Math.cos(lat0) * R, (q[1] - p[1]) * rad * R];
  const A = proj(a), B = proj(b);
  const dx = B[0] - A[0], dy = B[1] - A[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : (-A[0] * dx - A[1] * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(A[0] + t * dx, A[1] + t * dy);
}

export function distanceToLine(p: P, line: P[]): number {
  if (line.length === 0) return Infinity;
  if (line.length === 1) return haversineMeters(p, line[0]);
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) best = Math.min(best, pointToSegmentMeters(p, line[i], line[i + 1]));
  return best;
}

/** Distance from any geometry (Point or LineString) to a line, in meters (min over vertices+segments approx). */
export function geometryDistanceToLine(g: Geometry, line: P[]): number {
  if (g.type === 'Point') return distanceToLine(g.coordinates, line);
  let best = Infinity;
  for (const v of g.coordinates) best = Math.min(best, distanceToLine(v, line));
  for (const v of line) best = Math.min(best, distanceToLine(v, g.coordinates));
  return best;
}

export function padBbox(b: Bbox, meters: number): Bbox {
  const dLat = meters / 111320;
  const dLon = meters / (111320 * Math.cos(((b[1] + b[3]) / 2) * Math.PI / 180));
  return [b[0] - dLon, b[1] - dLat, b[2] + dLon, b[3] + dLat];
}

export type ParsedBbox = { ok: true; bbox: Bbox } | { ok: false; message: string };
export const MAX_BBOX_SPAN_DEG = 0.2;

export function parseBbox(raw: string | null | undefined): ParsedBbox {
  if (!raw) return { ok: false, message: 'bbox is required: west,south,east,north' };
  const parts = raw.split(',').map((s) => s.trim());
  if (parts.length !== 4 || parts.some((s) => s === '')) return { ok: false, message: 'bbox must have 4 comma-separated numbers' };
  const n = parts.map(Number);
  if (!n.every(Number.isFinite)) return { ok: false, message: 'bbox values must be finite numbers' };
  const [w, s, e, nn] = n;
  if (w < -180 || e > 180 || w > 180 || e < -180) return { ok: false, message: 'longitude must be within [-180,180]' };
  if (s < -90 || nn > 90 || s > 90 || nn < -90) return { ok: false, message: 'latitude must be within [-90,90]' };
  if (!(w < e) || !(s < nn)) return { ok: false, message: 'bbox must satisfy west<east and south<north' };
  if (e - w > MAX_BBOX_SPAN_DEG || nn - s > MAX_BBOX_SPAN_DEG) return { ok: false, message: `bbox span must be <= ${MAX_BBOX_SPAN_DEG} degrees` };
  return { ok: true, bbox: [w, s, e, nn] };
}
