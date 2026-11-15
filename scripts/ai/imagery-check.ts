// Mapillary -> Gemini imagery cross-check of official records.
// Usage: npm run ai:imagery -- [--limit 10] [--category missing_curb_ramp] [--save] [--force] | --regate
//   --save  writes data/imagery_checks.json and upserts ai_candidate observations via A's store.
//   Already-checked records are skipped unless --force. Sequential (gentle on free quotas).
import { listObservations, upsertObservations } from "@/lib/data/observations";
import { STUDY_BBOX } from "@/lib/data/studyArea";
import type { Category } from "@/lib/data/types";
import { checkRecord } from "@/lib/ai/imageryPipeline";
import { readImageryChecks, writeImageryChecks, type ImageryCheck } from "@/lib/ai/imageryChecks";
import { candidateGate } from "@/lib/ai/imageObservations";

/** Re-apply the quality gate to saved checks; failing AI records are marked outdated (hidden, kept for audit). */
async function regate() {
  const store = readImageryChecks();
  const fail = new Map<string, string>();
  const updated: ImageryCheck[] = [];
  for (const c of Object.values(store.checks)) {
    const keep: string[] = [];
    for (const id of c.observation_ids) {
      const cand = c.candidates[Number(id.split(":").pop())];
      const why = cand ? candidateGate(cand) : "missing_candidate";
      if (why) fail.set(id, why);
      else keep.push(id);
    }
    if (keep.length !== c.observation_ids.length) updated.push({ ...c, observation_ids: keep });
  }
  const all: any[] = [];
  let cursor: string | undefined;
  do {
    const r: any = await listObservations({ bbox: STUDY_BBOX, limit: 500, cursor });
    all.push(...r.data);
    cursor = r.next_cursor ?? r.meta?.next_cursor ?? undefined;
  } while (cursor);
  const toHide = all.filter((o) => fail.has(o.id)).map((o) => ({ ...o, verification_status: "outdated", metadata: { ...o.metadata, hidden_by_quality_gate: fail.get(o.id) } }));
  const r = toHide.length ? await upsertObservations(toHide) : { updated: 0, rejected: 0, errors: [] as string[] };
  writeImageryChecks(updated);
  const why: Record<string, number> = {};
  for (const v of fail.values()) why[v] = (why[v] ?? 0) + 1;
  const kept = all.filter((o) => o.source_kind === "street_imagery_ai" && !fail.has(o.id)).length;
  console.log("regate:", JSON.stringify(why), `hidden=${r.updated} rejected=${r.rejected} kept_ai_candidates=${kept}`);
}

const arg = (k: string, d?: string) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : d;
};

async function main() {
  if (process.argv.includes("--regate")) return regate();
  const limit = Math.min(Number(arg("--limit", "10")) || 10, 100);
  const category = arg("--category", "missing_curb_ramp") as Category;
  const save = process.argv.includes("--save");
  const force = process.argv.includes("--force");

  const all = [];
  let cursor: string | undefined;
  do {
    const r: any = await listObservations({ bbox: STUDY_BBOX, categories: [category], limit: 500, cursor });
    all.push(...r.data);
    cursor = r.next_cursor ?? r.meta?.next_cursor ?? undefined;
  } while (cursor);
  const done = readImageryChecks().checks;
  const todo = all.filter((o) => o.source_kind === "city_gis" && (force || !done[o.id])).slice(0, limit);
  console.log(`${category}: ${all.length} records, ${todo.length} to check`);

  const checks: ImageryCheck[] = [];
  let obsCount = 0;
  for (const o of todo) {
    const { check, observations } = await checkRecord(o);
    checks.push(check);
    console.log(
      `${o.id}: ${check.status}` +
        (check.image ? ` ${check.image.reference} ${check.image.captured_at} ${check.image.distance_m}m off${check.image.heading_off_deg}° ramp=${check.curb_ramp_visibility} cands=${check.candidates.length}` : "") +
        (check.error ? ` ERR ${check.error}` : ""),
    );
    if (save && observations.length) {
      const r = await upsertObservations(observations);
      obsCount += r.inserted + r.updated;
      if (r.rejected) console.log("  rejected:", r.errors.slice(0, 2));
    }
  }
  if (save) writeImageryChecks(checks);
  const tally: Record<string, number> = {};
  for (const c of checks) {
    const k = c.status === "analyzed" ? `ramp_${c.curb_ramp_visibility}` : c.status;
    tally[k] = (tally[k] ?? 0) + 1;
  }
  console.log("summary", JSON.stringify(tally), save ? `saved ${checks.length} checks, ${obsCount} ai_candidate obs` : "(dry run: not saved)");
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
