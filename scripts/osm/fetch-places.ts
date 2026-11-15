// One-time snapshot of downtown OSM named places + street intersections -> public/data/downtown-places.json
// Run: npx tsx scripts/osm/fetch-places.ts   (re-run to refresh; please don't hammer Overpass)
import fs from "node:fs";
import path from "node:path";
import { STUDY_BBOX } from "../../src/lib/data/studyArea";
import { buildPlacesFromOverpass } from "../../src/lib/ui/placeSearch";

const URL = process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter";
const OUT = path.join(process.cwd(), "public", "data", "downtown-places.json");

function query(bbox: readonly number[]): string {
  const b = `${bbox[1]},${bbox[0]},${bbox[3]},${bbox[2]}`; // south,west,north,east
  return `[out:json][timeout:90];
(
  nwr["name"]["amenity"](${b});
  nwr["name"]["tourism"](${b});
  nwr["name"]["leisure"](${b});
  nwr["name"]["shop"](${b});
  nwr["name"]["public_transport"](${b});
  nwr["name"]["railway"~"^(station|tram_stop)$"](${b});
  nwr["name"]["building"](${b});
);
out center tags;
way["name"]["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|pedestrian)$"](${b});
out body;
>;
out skel qt;`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchOverpass(bbox: readonly number[]): Promise<unknown> {
  let lastErr = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", "User-Agent": "accesspath-sd-hackathon" },
        body: new URLSearchParams({ data: query(bbox) }),
      });
      if (res.ok) return await res.json();
      lastErr = `Overpass HTTP ${res.status}`;
    } catch (e) {
      lastErr = (e as Error).message;
    }
    console.error(`attempt ${attempt}/3 failed: ${lastErr}`);
    if (attempt < 3) await sleep(5000 * attempt);
  }
  throw new Error(lastErr);
}

async function main() {
  const bbox = [...STUDY_BBOX] as [number, number, number, number];
  const places = buildPlacesFromOverpass(await fetchOverpass(bbox), bbox);
  const out = {
    metadata: {
      source: "OpenStreetMap via Overpass (community-mapped)",
      license: "ODbL © OpenStreetMap contributors",
      retrieved_at: new Date().toISOString(),
      bbox,
    },
    places,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));
  const nInt = places.filter((p) => p.kind === "intersection").length;
  console.log(`wrote ${places.length} places (${nInt} intersections, ${places.length - nInt} POIs), ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
