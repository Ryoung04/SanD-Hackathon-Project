// Import blind photo-review verdicts (TSV) into imagery checks + ai_candidate observations.
// Usage: npm run ai:import-review -- <manifest.json> <results.tsv>... [--reviewer "<label>"] [--save]
// TSV (5 or 7 fields): photo \t ramp \t [ramps_seen \t no_ramp_corners \t] walkway \t object \t note
//   ramp: visible|not_visible|cant_tell; walkway: clear|obstructed|cant_tell
// Several photos per intersection are tallied into one check. Earlier AI flags for the SAME
// intersections are marked outdated (hidden, kept for audit). City records are never modified.
import fs from "node:fs";
import { listObservations, upsertObservations } from "@/lib/data/observations";
import { STUDY_BBOX } from "@/lib/data/studyArea";
import { readImageryChecks, writeImageryChecks, type ImageryCheck } from "@/lib/ai/imageryChecks";
import { candidateGate, imageToObservations } from "@/lib/ai/imageObservations";
import { MAPILLARY_LICENSE } from "@/lib/ai/mapillary";
import type { AnalyzeImageResponse } from "@/lib/ai/gemini";
import type { BarrierObservation } from "@/lib/data/types";

const RAMP = { visible: "visibly_present", not_visible: "not_visible", cant_tell: "not_determinable" } as const;
type Verdict = keyof typeof RAMP;
interface ManifestRow { photo: string; barrier_id: string; image: string; captured_at?: string; pano?: boolean; page_url?: string; distance_m?: number }
interface Row { m: ManifestRow; ramp: Verdict; seen: number; noRamp: number; walkway: string; object: string; note: string }

async function cameraPoint(imageId: string): Promise<{ lat: number; lon: number } | null> {
  const r = await fetch(`https://graph.mapillary.com/${encodeURIComponent(imageId)}?fields=computed_geometry`, {
    headers: { Authorization: `OAuth ${process.env.MAPILLARY_TOKEN}` }, signal: AbortSignal.timeout(15_000),
  });
  const c = ((await r.json().catch(() => null)) as any)?.computed_geometry?.coordinates;
  return Array.isArray(c) ? { lon: Number(c[0]), lat: Number(c[1]) } : null;
}

function parse(line: string, byPhoto: Map<string, ManifestRow>): Row | null {
  const f = line.split("\t").map((s) => (s ?? "").trim());
  const [photo, ramp] = f;
  const seven = f.length >= 7;
  const [seen, noRamp, walkway, object, note] = seven ? [Number(f[2]), Number(f[3]), f[4], f[5], f[6]] : [0, 0, f[2], f[3], f[4]];
  const m = byPhoto.get(photo);
  if (!m || !(ramp in RAMP) || !["clear", "obstructed", "cant_tell"].includes(walkway)) return null;
  return { m, ramp: ramp as Verdict, seen: Number.isFinite(seen) ? seen : 0, noRamp: Number.isFinite(noRamp) ? noRamp : 0, walkway, object: object ?? "-", note: note ?? "" };
}

async function main() {
  const args = process.argv.slice(2);
  const save = args.includes("--save");
  const ri = args.indexOf("--reviewer");
  const reviewer = ri >= 0 ? args[ri + 1] : "claude-haiku-5-5 (Claude Code subagent, blind photo review)";
  const [manifestPath, ...tsvs] = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--reviewer");
  const manifest: ManifestRow[] = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const byPhoto = new Map(manifest.map((m) => [m.photo, m]));
  const store = readImageryChecks();

  const rows: Row[] = [];
  let bad = 0;
  for (const line of tsvs.flatMap((f) => fs.readFileSync(f, "utf8").split("\n")).map((l) => l.trim()).filter(Boolean)) {
    const r = parse(line, byPhoto);
    if (r) rows.push(r); else bad++;
  }
  const groups = new Map<string, Row[]>();
  for (const r of rows) groups.set(r.m.barrier_id, [...(groups.get(r.m.barrier_id) ?? []), r]);

  const checks: ImageryCheck[] = [];
  const newObs: BarrierObservation[] = [];
  const tally: Record<string, number> = {};
  for (const [barrierId, rs] of groups) {
    const prev = store.checks[barrierId];
    const info = (r: Row) => ({
      page_url: r.m.page_url ?? prev?.image?.page_url ?? `https://www.mapillary.com/app/?pKey=${r.m.image.split(":")[1]}`,
      captured_at: r.m.captured_at ?? prev?.image?.captured_at ?? "",
    });
    const count = (v: Verdict) => rs.filter((r) => r.ramp === v).length;
    const overall: Verdict = count("visible") ? "visible" : count("not_visible") ? "not_visible" : "cant_tell";
    tally[`intersection_${overall}`] = (tally[`intersection_${overall}`] ?? 0) + 1;
    // Evidence photo: a decisive one (pano preferred), else the first.
    const best = rs.filter((r) => r.ramp === overall).sort((a, b) => Number(!!b.m.pano) - Number(!!a.m.pano))[0] ?? rs[0];
    const years = rs.map((r) => info(r).captured_at.slice(0, 4)).filter(Boolean).sort();

    const candidates: { category: "sidewalk_obstruction"; model_confidence: "possible"; explanation: string }[] = [];
    const obsIds: string[] = [];
    for (const r of rs.filter((x) => x.walkway === "obstructed" && x.object && x.object !== "-")) {
      const c = { category: "sidewalk_obstruction" as const, model_confidence: "possible" as const, explanation: `${r.object} on the sidewalk${r.note ? ` (${r.note})` : ""}`.slice(0, 300) };
      if (candidateGate(c)) continue;
      candidates.push(c);
      const cam = await cameraPoint(r.m.image.split(":")[1]);
      const analysis = {
        status: "candidate", image_reference: r.m.image, captured_at: info(r).captured_at || null,
        candidate_observations: [{ ...c, verification_status: "ai_candidate", routing_impact: "unknown" }],
        curb_ramp_visibility: RAMP[r.ramp], no_clear_evidence: false, image_quality_notes: r.note,
        dropped_for_unsupported_claims: 0, requires_human_review: true, model: reviewer, analyzed_at: new Date().toISOString(),
      } as AnalyzeImageResponse;
      const ref = { image_reference: r.m.image, source: "mapillary" as const, page_url: info(r).page_url, license: MAPILLARY_LICENSE,
        attribution: `Mapillary contributor, ${MAPILLARY_LICENSE}`, captured_at: info(r).captured_at || null, camera_location: cam };
      const obs = imageToObservations(analysis, ref, cam ? { ...cam, basis: "mapillary_computed" } : null);
      newObs.push(...obs);
      obsIds.push(...obs.map((o) => o.id));
    }
    if (candidates.length) tally.obstruction_photos = (tally.obstruction_photos ?? 0) + candidates.length;

    checks.push({
      barrier_id: barrierId, checked_at: new Date().toISOString(), status: "analyzed",
      image: {
        reference: best.m.image, page_url: info(best).page_url, captured_at: info(best).captured_at, license: MAPILLARY_LICENSE,
        attribution: `Mapillary contributor, ${MAPILLARY_LICENSE}`, distance_m: best.m.distance_m ?? prev?.image?.distance_m ?? 0, heading_off_deg: null,
      },
      curb_ramp_visibility: RAMP[overall], no_clear_evidence: overall === "cant_tell",
      candidates, observation_ids: obsIds, image_quality_notes: best.note || null, model: reviewer, error: null,
      photo_votes: {
        total: rs.length, visible: count("visible"), not_visible: count("not_visible"), cant_tell: count("cant_tell"),
        ramps_seen_max: Math.max(0, ...rs.map((r) => r.seen)), no_ramp_corners_max: Math.max(0, ...rs.map((r) => r.noRamp)),
        years: years.length ? [years[0], years[years.length - 1]] : null,
        photos: rs.map((r) => ({ ...info(r), pano: !!r.m.pano, verdict: r.ramp })),
      },
    });
  }
  console.log(`photos=${rows.length} (${bad} unusable) intersections=${checks.length}`, JSON.stringify(tally), `new ai_candidate obs=${newObs.length}`);
  if (!save) return console.log("(dry run: not saved)");

  // Supersede earlier AI flags only for the intersections updated here.
  const old = new Set(checks.flatMap((c) => store.checks[c.barrier_id]?.observation_ids ?? []));
  const keep = new Set(newObs.map((o) => o.id));
  const all: BarrierObservation[] = [];
  let cursor: string | undefined;
  do {
    const r: any = await listObservations({ bbox: STUDY_BBOX, limit: 500, cursor });
    all.push(...r.data);
    cursor = r.next_cursor ?? r.meta?.next_cursor ?? undefined;
  } while (cursor);
  const superseded = all.filter((o) => old.has(o.id) && !keep.has(o.id))
    .map((o) => ({ ...o, verification_status: "outdated" as const, metadata: { ...o.metadata, superseded_by: reviewer } }));
  const a = newObs.length ? await upsertObservations(newObs) : { inserted: 0, updated: 0, rejected: 0, errors: [] };
  const b = superseded.length ? await upsertObservations(superseded) : { updated: 0 };
  writeImageryChecks(checks);
  console.log(`saved: obs inserted=${a.inserted} updated=${a.updated} rejected=${a.rejected}; superseded→outdated=${b.updated}; checks=${checks.length}`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
