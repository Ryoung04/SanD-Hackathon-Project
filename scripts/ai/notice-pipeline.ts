// Live end-to-end check for one article: Bright Data fetch -> Gemini
// extraction -> city permit match -> candidate observation.
// Usage: npm run ai:notice -- "<article url>" [out.json] [--save]
//        npm run ai:notice -- --refresh        (bounded search over default queries)
import { writeFileSync } from "node:fs";
import { processArticle, refreshNotices } from "../../src/lib/web/noticePipeline";
import { permitsNear, NOTICE_BBOX } from "../../src/lib/web/permits";
import { upsertObservations } from "../../src/lib/data/observations";

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--refresh")) {
    const r = await refreshNotices({ save: args.includes("--save") });
    console.log(JSON.stringify({ cards: r.cards.map((c) => [c.notice.page_title.slice(0, 60), c.observation_id]), saved: r.saved, errors: r.errors }, null, 1));
    return;
  }
  const save = args.includes("--save");
  const [url, outPath] = args.filter((a) => !a.startsWith("--"));
  if (!url) throw new Error("usage: notice-pipeline.ts <article url> [out.json] [--save] | --refresh [--save]");

  const permits = await permitsNear(NOTICE_BBOX, "2026-09-01");
  const { card, matches, observation } = await processArticle(url, permits);
  console.log("notice:", JSON.stringify({ ...card.notice, pedestrian_impact_language: card.notice.pedestrian_impact_language.length }, null, 1));
  console.log(`permits in bbox: ${permits.length}; matches: ${matches.length}`);
  for (const m of matches) console.log(" -", m.permit.approval_id, m.date_overlap, m.permit.block_information?.slice(0, 50));
  console.log(observation ? `observation ${observation.id} (${observation.evidence.length - 1} permits cited)` : "no overlapping permit -> notice card only, no map marker");
  if (observation && save) console.log("upsert:", await upsertObservations([observation]));
  if (outPath) writeFileSync(outPath, JSON.stringify({ notice: card.notice, matches, observation }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
