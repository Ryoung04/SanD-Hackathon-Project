// Live end-to-end check: Bright Data news fetch -> Gemini extraction ->
// match to official city traffic-control permits -> candidate observation.
// Usage: npm run ai:notice -- "<article url>" [out.json] [--save]
// Permits: queried from the public city ArcGIS layer for the article's area
// and normalized with Owner A's normalizeTrafficControl (A's STUDY_BBOX may
// not cover the article's neighborhood). --save writes via A's upsertObservations.
import { writeFileSync } from "node:fs";
import { fetchArticle, buildNotice, noticeToObservation } from "../../src/lib/web/noticeExtractor";
import { matchNoticeToPermits, permitFromObservation, type PermitRecord } from "../../src/lib/web/permitMatch";
import { normalizeTrafficControl } from "../../src/lib/data/normalizers";
import { SOURCES } from "../../src/lib/data/sourceRegistry";
import { upsertObservations } from "../../src/lib/data/observations";

async function permitsNear(bbox: [number, number, number, number], sinceIso: string): Promise<PermitRecord[]> {
  const u = new URL(`${SOURCES.traffic.endpoint}/query`);
  for (const [k, v] of Object.entries({
    where: `DATE_END >= DATE '${sinceIso}'`, geometry: bbox.join(","), geometryType: "esriGeometryEnvelope",
    inSR: "4326", outSR: "4326", spatialRel: "esriSpatialRelIntersects", returnGeometry: "true", f: "json", outFields: "*",
  })) u.searchParams.set(k, v);
  const d = await (await fetch(u)).json();
  if (d.error) throw new Error(`ArcGIS: ${JSON.stringify(d.error)}`);
  return d.features
    .map((f: any) => normalizeTrafficControl(f))
    .map((o: any) => (o ? permitFromObservation(o) : null))
    .filter(Boolean) as PermitRecord[];
}

async function main() {
  const args = process.argv.slice(2);
  const save = args.includes("--save");
  const [url, outPath] = args.filter((a) => a !== "--save");
  if (!url) throw new Error("usage: notice-pipeline.ts <article url> [out.json] [--save]");

  const article = await fetchArticle(url);
  const notice = await buildNotice(article);
  console.log("notice:", JSON.stringify({ ...notice, pedestrian_impact_language: notice.pedestrian_impact_language.length }, null, 1));

  // Central San Diego (downtown + Golden Hill). West,South,East,North.
  const permits = await permitsNear([-117.175, 32.7, -117.125, 32.735], "2026-09-01");
  const matches = matchNoticeToPermits(notice, permits);
  console.log(`permits in bbox: ${permits.length}; matches: ${matches.length}`);
  for (const m of matches) console.log(" -", m.permit.approval_id, m.date_overlap, m.permit.block_information?.slice(0, 50));

  const observation = noticeToObservation(notice, matches);
  console.log(observation ? `observation ${observation.id} (${observation.evidence.length - 1} permits cited)` : "no overlapping permit -> notice card only, no map marker");
  if (observation && save) console.log("upsert:", await upsertObservations([observation]));
  if (outPath) writeFileSync(outPath, JSON.stringify({ notice, matches, observation }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
