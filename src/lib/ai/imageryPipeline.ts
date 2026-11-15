// Mapillary -> Gemini cross-check for official records (Owner C). Server-only.
import "server-only";
import type { BarrierObservation } from "@/lib/data/types";
import { analyzeImage } from "./gemini";
import { imageToObservations } from "./imageObservations";
import { downloadThumb, findImagesNear, mapillaryReference } from "./mapillary";
import type { ImageryCheck } from "./imageryChecks";

/** Max camera-facing error to accept a photo as "looking at" the intersection. */
const MAX_HEADING_OFF = 75;

export async function checkRecord(
  o: BarrierObservation,
): Promise<{ check: ImageryCheck; observations: BarrierObservation[] }> {
  const [lon, lat] = o.geometry.type === "Point" ? o.geometry.coordinates : o.geometry.coordinates[0];
  const base = {
    barrier_id: o.id, checked_at: new Date().toISOString(), image: null, curb_ramp_visibility: null,
    no_clear_evidence: null, candidates: [], observation_ids: [], image_quality_notes: null, model: null, error: null,
  } satisfies Omit<ImageryCheck, "status">;
  try {
    const imgs = (await findImagesNear(lat, lon, 30)).filter((i) => i.heading_off_deg === null || i.heading_off_deg <= MAX_HEADING_OFF);
    const img = imgs[0];
    if (!img) return { check: { ...base, status: "no_imagery" }, observations: [] };
    const ref = mapillaryReference(img);
    const { bytes, mimeType } = await downloadThumb(img);
    const a = await analyzeImage({ bytes, mimeType, imageReference: ref.image_reference, capturedAt: img.captured_at });
    const observations = imageToObservations(a, ref, { lat: img.lat, lon: img.lon, basis: "mapillary_computed" });
    return {
      check: {
        ...base,
        status: "analyzed",
        image: {
          reference: ref.image_reference, page_url: ref.page_url!, captured_at: img.captured_at,
          license: ref.license!, attribution: ref.attribution!, distance_m: img.distance_m, heading_off_deg: img.heading_off_deg,
        },
        curb_ramp_visibility: a.curb_ramp_visibility,
        no_clear_evidence: a.no_clear_evidence,
        candidates: a.candidate_observations.map((c) => ({ category: c.category, model_confidence: c.model_confidence, explanation: c.explanation })),
        observation_ids: observations.map((x) => x.id),
        image_quality_notes: a.image_quality_notes,
        model: a.model,
      },
      observations,
    };
  } catch (e) {
    return { check: { ...base, status: "error", error: (e as Error).message.slice(0, 200) }, observations: [] };
  }
}
