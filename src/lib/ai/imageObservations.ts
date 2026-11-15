// AI image candidates -> BarrierObservation (ai_candidate). Owner C.
// Only when a location exists (camera GPS or user-supplied point); never
// invent one. Location is the camera, so precision is approximate_point.
import type { BarrierObservation } from "@/lib/data/types";
import type { AnalyzeImageResponse } from "./gemini";
import type { ImageReference } from "./imageSources";

const LABELS: Record<string, string> = {
  missing_curb_ramp: "AI candidate: curb ramp not visible",
  noncompliant_curb_ramp: "AI candidate: possible curb ramp issue",
  sidewalk_obstruction: "AI candidate: possible sidewalk obstruction",
  sidewalk_damage: "AI candidate: possible sidewalk damage",
  stairs: "AI candidate: visible steps",
  crossing_issue: "AI candidate: possible crossing issue",
  construction_warning: "AI candidate: possible construction",
  other: "AI candidate: possible barrier",
};

/** Hedged / non-observations: the model itself says it cannot see the thing it flags. */
const HEDGED = /\b(unclear|uncertain whether|not (possible|able) to (verify|determine|confirm|see)|cannot be (verified|determined|confirmed|seen)|can ?not (verify|determine|see)|not clearly visible|is not visible|obstructing the view|view (of|is) (obstructed|blocked))\b/i;
/** Vehicles are only an obstruction if explicitly ON the sidewalk/walkway. */
const VEHICLE = /\b(car|cars|vehicle|vehicles|truck|suv|sedan|van|jeep|bus|motorcycle)\b/i;
const ON_WALK = /\b(on|across|onto|blocking) (the )?(sidewalk|walkway|curb ramp|ramp|pedestrian path)\b/i;
/** Never pin people, encampments or belongings on a public map (privacy / safety of vulnerable people). */
const PEOPLE = /\b(tent|tents|encampment|homeless|unhoused|person|people|pedestrian(s)? (is|are)|belongings|sleeping|shopping cart)\b/i;

export type GateReason = "hedged" | "vehicle_not_on_walkway" | "people_or_belongings" | "low_confidence";

/** Deterministic quality gate before an AI candidate may become a map record. */
export function candidateGate(c: { category: string; explanation: string; model_confidence: string }): GateReason | null {
  if (PEOPLE.test(c.explanation)) return "people_or_belongings";
  if (HEDGED.test(c.explanation)) return "hedged";
  if (VEHICLE.test(c.explanation) && !ON_WALK.test(c.explanation)) return "vehicle_not_on_walkway";
  if (c.model_confidence === "uncertain") return "low_confidence";
  return null;
}

export function imageToObservations(
  analysis: AnalyzeImageResponse,
  image: ImageReference,
  location: { lat: number; lon: number; basis: "camera_gps_metadata" | "user_supplied" | "mapillary_computed" } | null,
): BarrierObservation[] {
  if (!location) return [];
  const refId = image.image_reference.replace(/[^A-Za-z0-9:._-]/g, "_").slice(0, 120);
  return analysis.candidate_observations.flatMap((c, i) => (candidateGate(c) ? [] : [{
    id: `street_imagery_ai:${refId}:${i}`,
    category: c.category,
    label: LABELS[c.category] ?? LABELS.other,
    geometry: { type: "Point", coordinates: [location.lon, location.lat] },
    geometry_precision: "approximate_point",
    source_kind: "street_imagery_ai",
    source_record_id: image.image_reference,
    source_url: image.page_url ?? image.image_reference,
    source_observed_at: image.captured_at ? `${image.captured_at}T00:00:00Z` : null,
    source_updated_at: null,
    ingested_at: analysis.analyzed_at,
    verification_status: "ai_candidate",
    routing_impact: "unknown",
    severity: "unknown",
    description: `${c.explanation} (model confidence: ${c.model_confidence}; requires human review)`,
    evidence: [
      {
        kind: "image_analysis",
        image_reference: image.image_reference,
        image_source: image.source,
        license: image.license,
        attribution: image.attribution,
        captured_at: image.captured_at,
        model: analysis.model,
        analyzed_at: analysis.analyzed_at,
      },
    ],
    metadata: {
      location_basis: location.basis,
      location_is_camera_not_barrier: true,
      model_confidence: c.model_confidence,
      curb_ramp_visibility: analysis.curb_ramp_visibility,
    },
  }]));
}
