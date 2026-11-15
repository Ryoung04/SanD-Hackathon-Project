// Builds B's access-feature feed (see accessContract.ts) from Owner C's street-photo checks.
// Only checks where the reviewer saw a curb ramp are emitted. Everything is an unverified
// AI candidate; slope/width/cross-slope/handrail stay unknown (never measured).
import type { Bbox, BarrierObservation } from "@/lib/data/types";
import type { ImageryCheck } from "@/lib/ai/imageryChecks";
import { noForbiddenClaim } from "@/lib/ai/validate";

export const ACCESS_FEATURES_CONTRACT_VERSION = "1";
const SOURCE_NOTE =
  "AI review of Mapillary street photos (CC BY-SA 4.0). Unverified candidates: a ramp was seen in photos near the city's intersection point; which corner is not determined. Not measured.";

const httpsOnly = (u: unknown): u is string => typeof u === "string" && /^https:\/\//i.test(u);
const inBbox = (c: [number, number], b: Bbox) => c[0] >= b[0] && c[0] <= b[2] && c[1] >= b[1] && c[1] <= b[3];

function pointOf(o: BarrierObservation): [number, number] | null {
  const g = o.geometry;
  if (g.type === "Point") return g.coordinates;
  return null;
}

export function buildAccessFeatures(
  checks: Record<string, ImageryCheck>,
  observations: BarrierObservation[],
  bbox: Bbox,
  now: Date = new Date(),
) {
  const obsById = new Map(observations.map((o) => [o.id, o]));
  const data: any[] = [];
  for (const check of Object.values(checks)) {
    if (check.status !== "analyzed" || check.curb_ramp_visibility !== "visibly_present") continue;
    const obs = obsById.get(check.barrier_id);
    const pt = obs && pointOf(obs);
    if (!obs || !pt || !inBbox(pt, bbox)) continue;

    const votes = check.photo_votes;
    const visiblePhotos = (votes?.photos ?? []).filter((p) => p.verdict === "visible");
    let links = visiblePhotos.map((p) => p.page_url).filter(httpsOnly);
    if (!links.length && httpsOnly(check.image?.page_url)) links = [check.image!.page_url];
    links = [...new Set(links)].slice(0, 2);

    const dates = [...visiblePhotos.map((p) => p.captured_at), votes?.years?.[1], check.image?.captured_at]
      .filter((d): d is string => typeof d === "string" && d.length > 0)
      .sort();
    const sourceDate = dates.length ? dates[dates.length - 1] : null;

    const total = votes?.total ?? 1;
    const seen = votes?.visible ?? 1;
    const confidence = votes && seen >= 2 && seen / total >= 0.5 ? "medium" : "low";
    const note =
      `Ramp seen in ${seen} of ${total} street photo${total === 1 ? "" : "s"}; which corner is not determined. ` +
      `City inventory lists a ramp deficit here.`;
    if (!noForbiddenClaim(note)) continue;

    data.push({
      type: "Feature",
      id: `c-curbramp/${check.barrier_id}`,
      geometry: { type: "Point", coordinates: pt },
      properties: {
        kind: "curb_ramp",
        detail: {
          ramp_type: "curb_ramp",
          slope_pct: null, cross_slope_pct: null, width_m: null, kerb_height_cm: null,
          surface_condition: "unknown", handrail: "unknown", landing: "unknown",
          tactile_paving: "unknown", signals: "unknown",
        },
        provenance: {
          source: `Mapillary street photos (CC BY-SA 4.0); AI review${check.model ? ` by ${check.model}` : ""}`,
          source_url: links[0] ?? null,
          source_url_2: links[1] ?? null,
          source_date: sourceDate,
          method: "ai_estimate",
          verification_status: "ai_candidate",
          confidence,
          note,
        },
      },
    });
  }
  return {
    data,
    meta: {
      contract_version: ACCESS_FEATURES_CONTRACT_VERSION,
      count: data.length,
      data_mode: "ai_candidate",
      generated_at: now.toISOString(),
      source_note: SOURCE_NOTE,
    },
  };
}
