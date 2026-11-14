import type { SourceKind } from './types';

export interface SourceInfo {
  key: string;
  source_kind: SourceKind;
  endpoint: string;
  source_url: string;
  attribution: string;
  notes: string;
  name: string;
  publisher: string;
  what_it_proves: string;
  what_it_does_not_prove: string;
  geometry_precision: string;
  default_verification_status: string;
  license_note: string;
}

export const SOURCES = {
  prowag: {
    key: 'prowag',
    source_kind: 'city_gis',
    endpoint: 'https://services8.arcgis.com/WunV6yKxvEXfsV4W/ArcGIS/rest/services/CSD_PROWAG_FINAL_V2_WFL1/FeatureServer/2',
    source_url: 'https://services8.arcgis.com/WunV6yKxvEXfsV4W/ArcGIS/rest/services/CSD_PROWAG_FINAL_V2_WFL1/FeatureServer/2',
    attribution: 'City of San Diego PROWAG assessment (ArcGIS Online); license unresolved',
    notes: 'One point per intersection node; deficit counts only, corner unknown. No record-level dates.',
    name: 'City PROWAG curb ramp and signal inventory',
    publisher: 'City of San Diego',
    what_it_proves: "The city's own inventory lists a missing curb ramp or missing accessible pedestrian signal deficit at this intersection.",
    what_it_does_not_prove: 'Which corner is affected, or that the deficit is still missing today.',
    geometry_precision: 'intersection',
    default_verification_status: 'official_inventory',
    license_note: 'No explicit reuse terms found; attributed to City of San Diego.',
  },
  traffic: {
    key: 'traffic',
    source_kind: 'traffic_control',
    endpoint: 'https://webmaps.sandiego.gov/arcgis/rest/services/DoIT_Public/DSDPermits/MapServer/5',
    source_url: 'https://webmaps.sandiego.gov/arcgis/rest/services/DoIT_Public/DSDPermits/MapServer/5',
    attribution: 'City of San Diego Development Services traffic control permits; terms unresolved',
    notes: 'Permit existence only; location may be permit centroid; not a confirmed sidewalk closure.',
    name: 'Traffic control permits',
    publisher: 'City of San Diego Development Services',
    what_it_proves: 'A permitted traffic-control plan exists for the permit window.',
    what_it_does_not_prove: 'That a sidewalk is actually closed. The point may be the permit centroid.',
    geometry_precision: 'approximate_point',
    default_verification_status: 'unverified_report',
    license_note: 'No explicit reuse terms found; attributed to City of San Diego.',
  },
  get_it_done: {
    key: 'get_it_done',
    source_kind: 'city_311',
    endpoint: 'https://seshat.datasd.org/get_it_done_reports/get_it_done_requests_open_datasd.csv',
    source_url: 'https://data.sandiego.gov/datasets/get-it-done-reports/',
    attribution: 'City of San Diego open data, Get It Done reports',
    notes: 'Resident reports, unverified; closed status does not mean repaired. Free text is untrusted.',
    name: 'Get It Done resident reports',
    publisher: 'City of San Diego',
    what_it_proves: 'A resident reported an issue at about this location.',
    what_it_does_not_prove: 'That the issue is verified, or that a closed report was repaired.',
    geometry_precision: 'approximate_point',
    default_verification_status: 'unverified_report',
    license_note: 'City of San Diego open data portal; attributed.',
  },
} as const satisfies Record<string, SourceInfo>;
