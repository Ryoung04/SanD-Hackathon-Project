// One-time snapshot of downtown OSM pedestrian infrastructure -> public/data/downtown-access.geojson
// Run: npx tsx scripts/osm/fetch-downtown.ts   (re-run to refresh; please don't hammer Overpass)
import fs from "node:fs";
import path from "node:path";
import { STUDY_BBOX } from "../../src/lib/data/studyArea";
import { overpassQuery, overpassToAccess } from "../../src/lib/map/osmAccess";

const URL = process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter";
const OUT = path.join(process.cwd(), "public", "data", "downtown-access.geojson");

async function main() {
  const bbox = [...STUDY_BBOX];
  const res = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", "User-Agent": "accesspath-sd-hackathon" },
    body: new URLSearchParams({ data: overpassQuery(bbox) }),
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
  const fc = overpassToAccess(await res.json(), bbox, new Date().toISOString());
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(fc));
  const counts: Record<string, number> = {};
  for (const f of fc.features) counts[f.properties.kind] = (counts[f.properties.kind] ?? 0) + 1;
  console.log(`wrote ${fc.features.length} features (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`, counts);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
