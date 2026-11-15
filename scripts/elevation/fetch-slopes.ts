// Derive sidewalk/path slope estimates from USGS 3DEP 1 m lidar elevation (bare earth)
// -> public/data/downtown-slopes.geojson (access contract v1, method "inferred").
//
// Run:  npx tsx scripts/elevation/fetch-slopes.ts            (uses cached samples if present)
//       npx tsx scripts/elevation/fetch-slopes.ts --refresh  (re-query USGS)
// Needs public/data/downtown-access.geojson (scripts/osm/fetch-downtown.ts) first.
//
// What this is and is NOT:
//  - Average running slope over ~20 m windows along mapped OSM paths, computed from
//    ground elevation. It is an ESTIMATE: no curb-ramp slope, no cross slope, and
//    no short dips or lips. It is never proof that a path is or isn't accessible.
//  - Bridges/tunnels/covered/indoor paths are skipped (ground elevation doesn't describe them).
//  - Very steep windows (>12%) on paths not tagged as steps are flagged as
//    "possibly unmapped stairs or a steep ramp" (unconfirmed).
//  - Mapped stairs get an estimated height change (rise_m), not a step count.
//
// Tunables are in CONFIG. Elevation service: USGS National Map 3DEP ImageServer getSamples.
import fs from "node:fs";
import path from "node:path";

const CONFIG = {
  service: process.env.ELEVATION_URL || "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/getSamples",
  spacingM: 8, // sample spacing along each path
  windowM: 20, // slope is computed over windows of about this length
  minWayM: 10, // shorter paths are too noisy to estimate
  batch: 1000, // points per request (service max 2000)
  retries: 4,
  kinds: ["sidewalk", "footway", "pedestrian_area", "ramp"], // crossings are road surface: skipped
  maxPlausiblePct: 35, // above this on a non-steps path, the DEM probably caught a wall/structure: dropped
};

const ROOT = process.cwd();
const IN = path.join(ROOT, "public", "data", "downtown-access.geojson");
const OUT = path.join(ROOT, "public", "data", "downtown-slopes.geojson");
const CACHE = path.join(ROOT, "data", "raw", "elevation-samples.json"); // gitignored
const SOURCE = "USGS 3DEP 1 m lidar elevation (bare earth)";
const SOURCE_URL = "https://www.usgs.gov/3d-elevation-program";

type LL = [number, number];
const kx = 111_320 * Math.cos((32.72 * Math.PI) / 180), ky = 110_540;
const dist = (a: LL, b: LL) => Math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * ky);
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
/** Same thresholds as SLOPE_BANDS in src/lib/map/accessContract.ts. */
const band = (pct: number) => (pct <= 2 ? 0 : pct <= 5 ? 1 : pct <= 8.33 ? 2 : pct <= 12 ? 3 : 4);
const key = (p: LL) => `${r6(p[0])},${r6(p[1])}`;

/** Points every `step` metres along a line (always includes both ends), with distance from start. */
function resample(line: LL[], step: number): { p: LL; d: number }[] {
  const out = [{ p: line[0], d: 0 }];
  let acc = 0, next = step;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], L = dist(a, b);
    while (next <= acc + L && L > 0) {
      const t = (next - acc) / L;
      out.push({ p: [r6(a[0] + t * (b[0] - a[0])), r6(a[1] + t * (b[1] - a[1]))], d: next });
      next += step;
    }
    acc += L;
  }
  if (acc - out[out.length - 1].d > 1) out.push({ p: line[line.length - 1], d: acc });
  return out;
}

async function sampleBatch(points: LL[]): Promise<(number | null)[]> {
  const body = new URLSearchParams({
    geometry: JSON.stringify({ points, spatialReference: { wkid: 4326 } }),
    geometryType: "esriGeometryMultipoint",
    returnFirstValueOnly: "true",
    f: "json",
  });
  for (let attempt = 1; attempt <= CONFIG.retries; attempt++) {
    try {
      const res = await fetch(CONFIG.service, { method: "POST", body, signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j: any = await res.json();
      if (!Array.isArray(j.samples)) throw new Error(j.error?.message ?? "no samples");
      const vals: (number | null)[] = points.map(() => null);
      for (const s of j.samples) {
        const v = parseFloat(s.value);
        if (Number.isFinite(s.locationId) && Number.isFinite(v) && v > -100) vals[s.locationId] = v;
      }
      return vals;
    } catch (e) {
      console.warn(`  batch attempt ${attempt} failed: ${e instanceof Error ? e.message : e}`);
      await new Promise((r) => setTimeout(r, 4000 * attempt));
    }
  }
  throw new Error("Elevation service failed repeatedly; re-run later (cached batches are kept).");
}

async function main() {
  const fc = JSON.parse(fs.readFileSync(IN, "utf8"));
  const ways = (fc.features as any[]).filter((f) => f.geometry.type === "LineString" && (CONFIG.kinds.includes(f.properties.kind) || f.properties.kind === "steps"));
  const skipped = ways.filter((f) => f.properties.structure);
  const usable = ways.filter((f) => !f.properties.structure);

  // 1. Sample points.
  const plan = usable.map((f) => ({ f, pts: resample(f.geometry.coordinates, f.properties.kind === "steps" ? 1e9 : CONFIG.spacingM) }));
  const cache: Record<string, number | null> = !process.argv.includes("--refresh") && fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, "utf8")) : {};
  const todo = [...new Set(plan.flatMap((x) => x.pts.map((q) => key(q.p))))].filter((k) => !(k in cache));
  console.log(`${usable.length} paths (${skipped.length} bridge/tunnel skipped), ${todo.length} points to sample, ${Object.keys(cache).length} cached`);
  for (let i = 0; i < todo.length; i += CONFIG.batch) {
    const keys = todo.slice(i, i + CONFIG.batch);
    const t0 = Date.now();
    const vals = await sampleBatch(keys.map((k) => k.split(",").map(Number) as LL));
    keys.forEach((k, j) => (cache[k] = vals[j]));
    fs.mkdirSync(path.dirname(CACHE), { recursive: true });
    fs.writeFileSync(CACHE, JSON.stringify(cache)); // checkpoint after every batch
    console.log(`  batch ${i / CONFIG.batch + 1}/${Math.ceil(todo.length / CONFIG.batch)} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }

  // 2. Slope windows.
  const features: any[] = [];
  const stepsRise: Record<string, number> = {};
  let dropped = 0, steepCandidates = 0;
  for (const { f, pts } of plan) {
    const id = f.properties.osm_id;
    const h = pts.map((q) => cache[key(q.p)] ?? null);
    const total = pts[pts.length - 1].d;
    if (f.properties.kind === "steps") {
      if (h[0] !== null && h[h.length - 1] !== null) stepsRise[id] = Math.round(Math.abs(h[h.length - 1]! - h[0]!) * 10) / 10;
      continue;
    }
    if (total < CONFIG.minWayM) continue;
    // Split into ~windowM pieces on sample boundaries.
    const n = Math.max(1, Math.round(total / CONFIG.windowM));
    const per = Math.max(1, Math.round((pts.length - 1) / n));
    // Windows first, then merge neighbours in the same slope band (keeps the file small).
    type Win = { s: number; e: number; len: number; pct: number; rise: number };
    const wins: Win[] = [];
    for (let s = 0; s < pts.length - 1; s += per) {
      const e = Math.min(pts.length - 1, s + per);
      const len = pts[e].d - pts[s].d;
      if (len < 5 || h[s] === null || h[e] === null) { wins.push({ s, e, len, pct: NaN, rise: NaN }); continue; }
      const rise = Math.abs(h[e]! - h[s]!);
      const pct = (rise / len) * 100;
      if (pct > CONFIG.maxPlausiblePct) { dropped++; wins.push({ s, e, len, pct: NaN, rise: NaN }); continue; }
      wins.push({ s, e, len, pct, rise });
    }
    const merged: Win[] = [];
    for (const w of wins) {
      const last = merged[merged.length - 1];
      if (last && Number.isFinite(w.pct) && Number.isFinite(last.pct) && band(w.pct) === band(last.pct) && last.e === w.s) {
        last.pct = (last.pct * last.len + w.pct * w.len) / (last.len + w.len); // length-weighted mean of |slope|
        last.rise += w.rise; last.len += w.len; last.e = w.e;
      } else merged.push({ ...w });
    }
    merged.forEach((w, i) => {
      if (!Number.isFinite(w.pct)) return;
      const steep = w.pct > 12;
      if (steep) steepCandidates++;
      features.push({
        type: "Feature",
        id: `dem/${id}/${i}`,
        geometry: { type: "LineString", coordinates: pts.slice(w.s, w.e + 1).map((q) => q.p) },
        // Shared fields (source, method, status, generic note) are in metadata.defaults.
        properties: {
          kind: "slope_segment",
          slope_pct: Math.round(w.pct * 10) / 10,
          rise_m: Math.round(w.rise * 10) / 10,
          confidence: w.len >= 15 ? "medium" : "low",
          ...(steep ? { note: `Ground rises ~${Math.round(w.pct)}% over ${Math.round(w.len)} m along OSM ${id}: possibly unmapped stairs or a steep ramp. Unconfirmed.` } : {}),
        },
      });
    });
  }
  const out = {
    type: "FeatureCollection",
    features,
    metadata: {
      contract_version: "1",
      source: SOURCE,
      source_url: SOURCE_URL,
      method: `Elevation sampled every ${CONFIG.spacingM} m along OpenStreetMap paths; slope = |height change| / length over ~${CONFIG.windowM} m windows.`,
      license: "USGS 3DEP: public domain. Path geometry: ODbL © OpenStreetMap contributors.",
      generated_at: new Date().toISOString(),
      steps_rise_m: stepsRise,
      /** Applied to every feature by the map's access store (accessStore.ts) before normalizing. */
      defaults: {
        method: "inferred",
        verification_status: "unknown",
        source: SOURCE,
        source_url: SOURCE_URL,
        source_date: null,
        note: "Average slope along this path from lidar ground elevation. Estimate only: not a curb-ramp or cross-slope measurement.",
      },
      counts: { segments: features.length, steep_over_12pct: steepCandidates, dropped_implausible: dropped, skipped_structures: skipped.length, stairs_with_rise: Object.keys(stepsRise).length },
    },
  };
  fs.writeFileSync(OUT, JSON.stringify(out));
  const bands = { "<2": 0, "2-5": 0, "5-8.3": 0, "8.3-12": 0, ">12": 0 } as Record<string, number>;
  for (const f of features) { const s = f.properties.slope_pct; bands[s < 2 ? "<2" : s < 5 ? "2-5" : s < 8.33 ? "5-8.3" : s < 12 ? "8.3-12" : ">12"]++; }
  console.log("Wrote", path.relative(ROOT, OUT), `${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`, JSON.stringify(out.metadata.counts), JSON.stringify(bands));
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
