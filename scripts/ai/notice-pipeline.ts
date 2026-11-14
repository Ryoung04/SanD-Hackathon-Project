// Live end-to-end check: Bright Data news fetch -> Gemini extraction ->
// match to official city traffic-control permits -> candidate observation.
// Usage: npx tsx scripts/ai/notice-pipeline.ts "<article url>" [out.json]
// Permits are queried directly from the public city ArcGIS layer here ONLY
// as a stand-in until Owner A's /api/barriers exposes them.
import { writeFileSync } from "node:fs";
import { fetchArticle, buildNotice, noticeToObservation } from "../../src/lib/web/noticeExtractor";
import { matchNoticeToPermits, type PermitRecord } from "../../src/lib/web/permitMatch";

const PERMITS = "https://webmaps.sandiego.gov/arcgis/rest/services/DoIT_Public/DSDPermits/MapServer/5/query";

async function permitsNear(bbox: [number, number, number, number], sinceIso: string): Promise<PermitRecord[]> {
  const u = new URL(PERMITS);
  for (const [k, v] of Object.entries({
    where: `DATE_END >= DATE '${sinceIso}'`, geometry: bbox.join(","), geometryType: "esriGeometryEnvelope",
    inSR: "4326", spatialRel: "esriSpatialRelIntersects", returnGeometry: "false", f: "json",
    outFields: "APPROVAL_ID,TRAFFIC_CONTROL_TYPE,DATE_START,DATE_END,BLOCK_INFORMATION,LATITUDE,LONGITUDE",
  })) u.searchParams.set(k, v);
  const d = await (await fetch(u)).json();
  if (d.error) throw new Error(`ArcGIS: ${JSON.stringify(d.error)}`);
  const day = (ms: number | null) => (ms ? new Date(ms).toISOString().slice(0, 10) : null);
  return d.features.map(({ attributes: a }: any) => ({
    approval_id: a.APPROVAL_ID, traffic_control_type: a.TRAFFIC_CONTROL_TYPE, block_information: a.BLOCK_INFORMATION,
    date_start: day(a.DATE_START), date_end: day(a.DATE_END), lat: a.LATITUDE, lon: a.LONGITUDE,
  }));
}

const url = process.argv[2];
if (!url) throw new Error("usage: notice-pipeline.ts <article url> [out.json]");
const article = await fetchArticle(url);
const notice = await buildNotice(article);
console.log("notice:", JSON.stringify({ ...notice, pedestrian_impact_language: notice.pedestrian_impact_language.length }, null, 1));

// Central San Diego study bbox (downtown + Golden Hill). West,South,East,North.
const permits = await permitsNear([-117.175, 32.700, -117.125, 32.735], "2026-09-01");
const matches = matchNoticeToPermits(notice, permits);
console.log(`permits in bbox: ${permits.length}; matches: ${matches.length}`);
for (const m of matches) console.log(" -", m.permit.approval_id, m.date_overlap, m.permit.block_information?.slice(0, 50));

const best = matches.find((m) => m.date_overlap === "overlaps");
const observation = best ? noticeToObservation(notice, best) : null;
console.log(observation ? "observation created (map marker at permit point)" : "no overlapping permit -> notice card only, no map marker");
if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify({ notice, matches, observation }, null, 2));
