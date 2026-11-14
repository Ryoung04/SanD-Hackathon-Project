export const CATEGORIES = ['missing_curb_ramp','noncompliant_curb_ramp','missing_sidewalk','sidewalk_obstruction','sidewalk_damage','construction_warning','stairs','crossing_issue','other'] as const;
export const GEOMETRY_PRECISIONS = ['sidewalk_edge','corner','intersection','approximate_point','unknown'] as const;
export const SOURCE_KINDS = ['city_gis','county_gis','city_311','traffic_control','web_notice','street_imagery_ai','community_report','other'] as const;
export const VERIFICATION_STATUSES = ['official_inventory','unverified_report','ai_candidate','community_confirmed','human_reviewed','outdated','unknown'] as const;
export const ROUTING_IMPACTS = ['confirmed_blocking_edge','possible_obstacle','informational','unknown'] as const;
export const SEVERITIES = ['low','medium','high','unknown'] as const;

export type Category = (typeof CATEGORIES)[number];
export type GeometryPrecision = (typeof GEOMETRY_PRECISIONS)[number];
export type SourceKind = (typeof SOURCE_KINDS)[number];
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];
export type RoutingImpact = (typeof ROUTING_IMPACTS)[number];
export type Severity = (typeof SEVERITIES)[number];

export type PointGeometry = { type: 'Point'; coordinates: [number, number] };
export type LineStringGeometry = { type: 'LineString'; coordinates: [number, number][] };
export type Geometry = PointGeometry | LineStringGeometry;

export interface BarrierObservation {
  id: string;
  category: Category;
  label: string;
  geometry: Geometry;
  geometry_precision: GeometryPrecision;
  source_kind: SourceKind;
  source_record_id: string;
  source_url: string;
  source_observed_at: string | null;
  source_updated_at: string | null;
  ingested_at: string;
  verification_status: VerificationStatus;
  routing_impact: RoutingImpact;
  severity: Severity;
  description: string;
  evidence: unknown[];
  metadata: Record<string, unknown>;
}

export type DataMode = 'live_import' | 'demo_fixture';

export interface ListResult {
  data: BarrierObservation[];
  next_cursor?: string;
  data_mode: DataMode;
}

export type Bbox = [number, number, number, number];
