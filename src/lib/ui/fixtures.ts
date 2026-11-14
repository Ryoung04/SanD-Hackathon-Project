import type { BarriersResponse, BBox } from "./barrierTypes";

/**
 * DEMO FIXTURE — NOT REAL DATA.
 * Used only when GET /api/barriers (Owner A) is unreachable. Every record is
 * labelled as a fixture and the response carries data_mode "demo_fixture",
 * which the UI shows as a prominent banner. Never present these as evidence,
 * and remove from the live demo once A's real records are available.
 */

/** Placeholder study area near 6th Ave / Ash St, Downtown San Diego.
 *  PENDING OWNER A: replace with A's confirmed bbox. */
export const DEFAULT_STUDY_BBOX: BBox = [-117.168, 32.715, -117.152, 32.728];
export const DEFAULT_CENTER: [number, number] = [32.7213, -117.1597]; // [lat, lon] for Leaflet

const FIXTURE_NOTE = "FIXTURE — placeholder for UI development, not a real record about this location.";

export function fixtureResponse(bbox: BBox): BarriersResponse {
  const data: BarriersResponse["data"] = [
    {
      id: "fixture:ramp-1",
      category: "missing_curb_ramp",
      label: "[Fixture] Curb-ramp deficit",
      geometry: { type: "Point", coordinates: [-117.1597, 32.7213] },
      geometry_precision: "intersection",
      source_kind: "city_gis",
      source_record_id: null,
      source_url: null,
      source_observed_at: null,
      source_updated_at: null,
      ingested_at: null,
      verification_status: "unknown",
      routing_impact: "unknown",
      severity: "unknown",
      description: FIXTURE_NOTE,
      evidence: [],
      metadata: { fixture: true },
    },
    {
      id: "fixture:311-1",
      category: "sidewalk_obstruction",
      label: "[Fixture] Possible sidewalk obstruction",
      geometry: { type: "Point", coordinates: [-117.1612, 32.7198] },
      geometry_precision: "approximate_point",
      source_kind: "city_311",
      source_record_id: null,
      source_url: null,
      source_observed_at: null,
      source_updated_at: null,
      ingested_at: null,
      verification_status: "unverified_report",
      routing_impact: "unknown",
      severity: "unknown",
      description: FIXTURE_NOTE,
      evidence: [],
      metadata: { fixture: true },
    },
    {
      id: "fixture:tc-1",
      category: "construction_warning",
      label: "[Fixture] Traffic control notice",
      geometry: {
        type: "LineString",
        coordinates: [
          [-117.1580, 32.7230],
          [-117.1565, 32.7230],
        ],
      },
      geometry_precision: "approximate_point",
      source_kind: "traffic_control",
      source_record_id: null,
      source_url: null,
      source_observed_at: null,
      source_updated_at: null,
      ingested_at: null,
      verification_status: "unknown",
      routing_impact: "unknown",
      severity: "unknown",
      description: FIXTURE_NOTE,
      evidence: [],
      metadata: { fixture: true },
    },
  ];
  return {
    data,
    meta: { count: data.length, bbox, generated_at: new Date().toISOString(), data_mode: "demo_fixture" },
  };
}
