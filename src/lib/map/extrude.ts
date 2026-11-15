/**
 * Turn OSM stairway lines into small extruded "step" blocks for a 3D staircase look.
 * Visual only: block count/height are illustrative, not measured riser data
 * (OSM rarely has step_count; when present it sets the block count, capped).
 */

type P = [number, number]; // [lon, lat]
const M_PER_DEG_LAT = 111_320;

function toLocal(p: P, lat0: number): P {
  return [p[0] * M_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180), p[1] * M_PER_DEG_LAT];
}
function fromLocal(p: P, lat0: number): P {
  return [p[0] / (M_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180)), p[1] / M_PER_DEG_LAT];
}

/** Total length of a line in meters (equirectangular; fine at stair scale). */
export function lineLengthM(line: P[]): number {
  if (line.length < 2) return 0;
  const lat0 = line[0][1];
  let d = 0;
  for (let i = 1; i < line.length; i++) {
    const a = toLocal(line[i - 1], lat0), b = toLocal(line[i], lat0);
    d += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return d;
}

/** Point at distance t (meters) along the line, in local meters. */
function pointAt(local: P[], t: number): { p: P; dir: P } {
  let acc = 0;
  for (let i = 1; i < local.length; i++) {
    const a = local[i - 1], b = local[i];
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (seg > 0 && acc + seg >= t) {
      const f = (t - acc) / seg;
      return { p: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], dir: [(b[0] - a[0]) / seg, (b[1] - a[1]) / seg] };
    }
    acc += seg;
  }
  const a = local[local.length - 2], b = local[local.length - 1];
  const seg = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return { p: b, dir: [(b[0] - a[0]) / seg, (b[1] - a[1]) / seg] };
}

export interface StepBlock {
  type: "Feature";
  geometry: { type: "Polygon"; coordinates: P[][] };
  properties: { osm_id: string; base: number; height: number };
}

/**
 * Split a stair line into `n` rectangles of width `widthM`, heights rising from riserM to n*riserM.
 * n = step_count (capped at 24) if known, else ~1 block per 1.2 m (min 3, max 12).
 */
export function stairBlocks(line: P[], osmId: string, stepCount: number | null, widthM = 2.2, riserM = 0.35): StepBlock[] {
  const len = lineLengthM(line);
  if (len < 0.5) return [];
  const lat0 = line[0][1];
  const local = line.map((p) => toLocal(p, lat0));
  const n = stepCount ? Math.min(24, Math.max(2, Math.round(stepCount))) : Math.min(12, Math.max(3, Math.round(len / 1.2)));
  const out: StepBlock[] = [];
  const half = widthM / 2;
  for (let i = 0; i < n; i++) {
    const s = pointAt(local, (len * i) / n), e = pointAt(local, (len * (i + 1)) / n);
    const nx = -s.dir[1] * half, ny = s.dir[0] * half; // perpendicular offset
    const ring: P[] = [
      [s.p[0] + nx, s.p[1] + ny], [e.p[0] + nx, e.p[1] + ny],
      [e.p[0] - nx, e.p[1] - ny], [s.p[0] - nx, s.p[1] - ny],
    ].map((q) => fromLocal(q as P, lat0));
    ring.push(ring[0]);
    out.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: { osm_id: osmId, base: 0, height: riserM * (i + 1) } });
  }
  return out;
}
