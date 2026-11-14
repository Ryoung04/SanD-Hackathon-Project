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

export function imageToObservations(
  analysis: AnalyzeImageResponse,
  image: ImageReference,
  location: { lat: number; lon: number; basis: "camera_gps_metadata" | "user_supplied" } | null,
): BarrierObservation[] {
  if (!location) return [];
  const refId = image.image_reference.replace(/[^A-Za-z0-9:._-]/g, "_").slice(0, 120);
  return analysis.candidate_observations.map((c, i) => ({
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
  }));
}
