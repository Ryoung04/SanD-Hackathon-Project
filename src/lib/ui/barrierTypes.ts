/**
 * OWNER B consumer copy of the shared contract (PROJECT_MASTER.md §4.1–4.2).
 *
 * SHELL / PENDING OWNER A: the canonical types live in `src/lib/data/types.ts`
 * (Owner A). Once A lands that file, replace this module's body with:
 *   export type { BarrierObservation, ... } from "../data/types";
 * Do not add fields here without proposing the diff to A first.
 */

export type Category =
  | "missing_curb_ramp"
  | "noncompliant_curb_ramp"
  | "missing_sidewalk"
  | "sidewalk_obstruction"
  | "sidewalk_damage"
  | "construction_warning"
  | "stairs"
  | "crossing_issue"
  | "other";

export type GeometryPrecision =
  | "sidewalk_edge"
  | "corner"
  | "intersection"
  | "approximate_point"
  | "unknown";

export type SourceKind =
  | "city_gis"
  | "county_gis"
  | "city_311"
  | "traffic_control"
  | "web_notice"
  | "street_imagery_ai"
  | "community_report"
  | "other";

export type VerificationStatus =
  | "official_inventory"
  | "unverified_report"
  | "ai_candidate"
  | "community_confirmed"
  | "human_reviewed"
  | "outdated"
  | "unknown";

export type RoutingImpact =
  | "confirmed_blocking_edge"
  | "possible_obstacle"
  | "informational"
  | "unknown";

export type Severity = "low" | "medium" | "high" | "unknown";

/** GeoJSON, coordinates are [lon, lat]. */
export type BarrierGeometry =
  | { type: "Point"; coordinates: [number, number] }
  | { type: "LineString"; coordinates: [number, number][] }
  | { type: "MultiLineString"; coordinates: [number, number][][] };

export interface BarrierObservation {
  id: string;
  category: Category;
  label: string;
  geometry: BarrierGeometry;
  geometry_precision: GeometryPrecision;
  source_kind: SourceKind;
  source_record_id: string | null;
  source_url: string | null;
  source_observed_at: string | null;
  source_updated_at: string | null;
  ingested_at: string | null;
  verification_status: VerificationStatus;
  routing_impact: RoutingImpact;
  severity: Severity;
  /** Untrusted text. Render as text only, never as HTML. */
  description: string | null;
  evidence: unknown[];
  metadata: Record<string, unknown>;
}

export type DataMode = "live_import" | "demo_fixture" | string;

export interface BarriersResponse {
  data: BarrierObservation[];
  meta: {
    count: number;
    bbox: [number, number, number, number];
    generated_at: string;
    data_mode: DataMode;
    limit?: number;
    next_cursor?: string | null;
  };
}

export interface ApiError {
  error: { code: string; message: string };
}

/** [west, south, east, north] */
export type BBox = [number, number, number, number];
