// Snapshot of the downtown pedestrian network -> data/derived/downtown-graph.json (server-side routing).
// Run: npx tsx scripts/osm/fetch-graph.ts      Re-run after scripts/elevation/fetch-slopes.ts to attach slopes.
// Overpass can 502/504: the script retries; set OVERPASS_URL to use a mirror.
import fs from "node:fs";
import path from "node:path";
import { STUDY_BBOX } from "../../src/lib/data/studyArea";
import { buildGraph, graphQuery, type RoutingGraph } from "../../src/lib/routing/graphBuild";

const URL = process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter";
const OUT = path.join(process.cwd(), "data", "derived", "downtown-graph.json");
const SLOPES = path.join(process.cwd(), "public", "data", "downtown-slopes.geojson");
/** Routing margin around the study area so routes near the edge aren't cut off (degrees, ~300 m). */
const PAD = 0.003;

async function overpass(q: string): Promise<any> {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(URL, { method: "POST", body: new URLSearchParams({ data: q }), headers: { "User-Agent": "accesspath-sd-hackathon" }, signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      console.warn(`attempt ${attempt}: ${e instanceof Error ? e.message : e}`);
      await new Promise((r) => setTimeout(r, 5000 * attempt));
    }
  }
  throw new Error("Overpass failed repeatedly");
}

/** Attach DEM slope (from fetch-slopes.ts) to each way: per-edge nearest segment of the same OSM way. */
function attachSlopes(g: RoutingGraph): number {
  if (!fs.existsSync(SLOPES)) return 0;
  const fc = JSON.parse(fs.readFileSync(SLOPES, "utf8"));
  const byWay = new Map<string, { mid: [number, number]; pct: number }[]>();
  for (const f of fc.features ?? []) {
    const m = /^dem\/(way\/\d+)\//.exec(String(f.id));
    const c = f.geometry?.coordinates;
    if (!m || !Array.isArray(c) || c.length < 2) continue;
    const mid = c[Math.floor(c.length / 2)];
    (byWay.get(m[1]) ?? byWay.set(m[1], []).get(m[1])!).push({ mid, pct: Number(f.properties.slope_pct) });
  }
  // Store the slope on a per-edge basis via a parallel array (edges stay compact tuples).
  const edgeSlope: (number | null)[] = g.edges.map(([a, b, , wi]) => {
    const segs = byWay.get(g.ways[wi].osm_id);
    if (!segs?.length) return null;
    const mx = (g.nodes[a][0] + g.nodes[b][0]) / 2, my = (g.nodes[a][1] + g.nodes[b][1]) / 2;
    let best = segs[0], bd = Infinity;
    for (const s of segs) { const d = (s.mid[0] - mx) ** 2 + (s.mid[1] - my) ** 2; if (d < bd) { bd = d; best = s; } }
    return Number.isFinite(best.pct) ? best.pct : null;
  });
  (g as any).edge_slope = edgeSlope;
  g.meta.slope_source = "USGS 3DEP 1 m lidar via scripts/elevation/fetch-slopes.ts (estimates)";
  return edgeSlope.filter((x) => x !== null).length;
}

async function main() {
  const [w, s, e, n] = STUDY_BBOX;
  const bbox = [w - PAD, s - PAD, e + PAD, n + PAD];
  const json = await overpass(graphQuery(bbox));
  const g = buildGraph(json.elements ?? [], bbox, new Date().toISOString());
  const sloped = attachSlopes(g);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(g));
  console.log("Wrote", path.relative(process.cwd(), OUT), `${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`, JSON.stringify(g.meta.counts), `edges with slope: ${sloped}`);
}

main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
