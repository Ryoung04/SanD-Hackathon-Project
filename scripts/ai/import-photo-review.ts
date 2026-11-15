// Import blind photo-review verdicts (TSV) into imagery checks + ai_candidate observations.
// Usage: npm run ai:import-review -- <manifest.json> <results.tsv>... [--reviewer "<label>"] [--save]
// TSV line: photo \t ramp(visible|not_visible|cant_tell) \t walkway(clear|obstructed|cant_tell) \t object \t note
// Replaces earlier AI flags for the same checks; superseded street_imagery_ai records are marked
// outdated (hidden, kept for audit). City records are never modified.
import fs from "node:fs";
import { listObservations, upsertObservations } from "@/lib/data/observations";
import { STUDY_BBOX } from "@/lib/data/studyArea";
import { readImageryChecks, writeImageryChecks, type ImageryCheck } from "@/lib/ai/imageryChecks";
import { candidateGate, imageToObservations } from "@/lib/ai/imageObservations";
import type { AnalyzeImageResponse } from "@/lib/ai/gemini";
import type { BarrierObservation } from "@/lib/data/types";

const RAMP = { visible: "visibly_present", not_visible: "not_visible", cant_tell: "not_determinable" } as const;

async function cameraPoint(imageId: string): Promise<{ lat: number; lon: number } | null> {
  const r = await fetch(`https://graph.mapillary.com/${encodeURIComponent(imageId)}?fields=computed_geometry`, {
    headers: { Authorization: `OAuth ${process.env.MAPILLARY_TOKEN}` },
    signal: AbortSignal.timeout(15_000),
  });
  const c = ((await r.json().catch(() => null)) as any)?.computed_geometry?.coordinates;
  return Array.isArray(c) ? { lon: Number(c[0]), lat: Number(c[1]) } : null;
}

async function main() {
  const args = process.argv.slice(2);
  const save = args.includes("--save");
  const ri = args.indexOf("--reviewer");
  const reviewer = ri >= 0 ? args[ri + 1] : "claude-haiku-5-5 (Claude Code subagent, blind photo review)";
  const files = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--reviewer");
  const [manifestPath, ...tsvs] = files;
  const manifest: { photo: string; barrier_id: string; image: string }[] = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const byPhoto = new Map(manifest.map((m) => [m.photo, m]));
  const store = readImageryChecks();

  const checks: ImageryCheck[] = [];
  const newObs: BarrierObservation[] = [];
  const tally: Record<string, number> = {};
  let bad = 0;
  for (const line of tsvs.flatMap((f) => fs.readFileSync(f, "utf8").split("\n")).map((l) => l.trim()).filter(Boolean)) {
    const [photo, ramp, walkway, object, note] = line.split("\t").map((s) => (s ?? "").trim());
    const m = byPhoto.get(photo);
    const prev = m && store.checks[m.barrier_id];
    if (!m || !prev?.image || !(ramp in RAMP) || !["clear", "obstructed", "cant_tell"].includes(walkway)) {
      bad++;
      continue;
    }
    const candidates =
      walkway === "obstructed" && object && object !== "-"
        ? [{ category: "sidewalk_obstruction" as const, model_confidence: "possible" as const, explanation: `${object} on the sidewalk${note ? ` (${note})` : ""}`.slice(0, 300) }]
        : [];
    const kept = candidates.filter((c) => !candidateGate(c));
    tally[`ramp_${ramp}`] = (tally[`ramp_${ramp}`] ?? 0) + 1;
    if (kept.length) tally.obstruction = (tally.obstruction ?? 0) + 1;

    let obsIds: string[] = [];
    if (kept.length) {
      const cam = await cameraPoint(m.image.split(":")[1]);
      const analysis = {
        status: "candidate", image_reference: m.image, captured_at: prev.image.captured_at,
        candidate_observations: kept.map((c) => ({ ...c, verification_status: "ai_candidate", routing_impact: "unknown" })),
        curb_ramp_visibility: RAMP[ramp as keyof typeof RAMP], no_clear_evidence: false, image_quality_notes: note ?? "",
        dropped_for_unsupported_claims: 0, requires_human_review: true, model: reviewer, analyzed_at: new Date().toISOString(),
      } as AnalyzeImageResponse;
      const ref = { image_reference: m.image, source: "mapillary" as const, page_url: prev.image.page_url, license: prev.image.license,
        attribution: prev.image.attribution, captured_at: prev.image.captured_at, camera_location: cam };
      const obs = imageToObservations(analysis, ref, cam ? { ...cam, basis: "mapillary_computed" } : null);
      newObs.push(...obs);
      obsIds = obs.map((o) => o.id);
    }
    checks.push({
      ...prev, checked_at: new Date().toISOString(), curb_ramp_visibility: RAMP[ramp as keyof typeof RAMP],
      no_clear_evidence: ramp === "cant_tell" && walkway === "cant_tell", candidates: kept, observation_ids: obsIds,
      image_quality_notes: note || null, model: reviewer, error: null,
    });
  }
  console.log(`parsed ${checks.length} verdicts (${bad} unusable lines)`, JSON.stringify(tally), `new ai_candidate obs=${newObs.length}`);
  if (!save) return console.log("(dry run: not saved)");

  const keep = new Set(newObs.map((o) => o.id));
  const all: BarrierObservation[] = [];
  let cursor: string | undefined;
  do {
    const r: any = await listObservations({ bbox: STUDY_BBOX, limit: 500, cursor });
    all.push(...r.data);
    cursor = r.next_cursor ?? r.meta?.next_cursor ?? undefined;
  } while (cursor);
  const superseded = all
    .filter((o) => o.source_kind === "street_imagery_ai" && o.source_record_id.startsWith("mapillary:") && !keep.has(o.id))
    .map((o) => ({ ...o, verification_status: "outdated" as const, metadata: { ...o.metadata, superseded_by: reviewer } }));
  const a = newObs.length ? await upsertObservations(newObs) : { inserted: 0, updated: 0, rejected: 0, errors: [] };
  const b = superseded.length ? await upsertObservations(superseded) : { updated: 0, rejected: 0, errors: [] };
  writeImageryChecks(checks);
  console.log(`saved: obs inserted=${a.inserted} updated=${a.updated} rejected=${a.rejected}; superseded→outdated=${b.updated}; checks=${checks.length}`);
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
