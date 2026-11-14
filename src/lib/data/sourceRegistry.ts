import type { SourceKind } from './types';

export interface SourceInfo {
  key: string;
  source_kind: SourceKind;
  endpoint: string;
  source_url: string;
  attribution: string;
  notes: string;
}

export const SOURCES = {
  prowag: {
    key: 'prowag',
    source_kind: 'city_gis',
    endpoint: 'https://services8.arcgis.com/WunV6yKxvEXfsV4W/ArcGIS/rest/services/CSD_PROWAG_FINAL_V2_WFL1/FeatureServer/2',
    source_url: 'https://services8.arcgis.com/WunV6yKxvEXfsV4W/ArcGIS/rest/services/CSD_PROWAG_FINAL_V2_WFL1/FeatureServer/2',
    attribution: 'City of San Diego PROWAG assessment (ArcGIS Online); license unresolved',
    notes: 'One point per intersection node; deficit counts only, corner unknown. No record-level dates.',
  },
  traffic: {
    key: 'traffic',
    source_kind: 'traffic_control',
    endpoint: 'https://webmaps.sandiego.gov/arcgis/rest/services/DoIT_Public/DSDPermits/MapServer/5',
    source_url: 'https://webmaps.sandiego.gov/arcgis/rest/services/DoIT_Public/DSDPermits/MapServer/5',
    attribution: 'City of San Diego Development Services traffic control permits; terms unresolved',
    notes: 'Permit existence only; location may be permit centroid; not a confirmed sidewalk closure.',
  },
  get_it_done: {
    key: 'get_it_done',
    source_kind: 'city_311',
    endpoint: 'https://seshat.datasd.org/get_it_done_reports/get_it_done_requests_open_datasd.csv',
    source_url: 'https://data.sandiego.gov/datasets/get-it-done-reports/',
    attribution: 'City of San Diego open data, Get It Done reports',
    notes: 'Resident reports, unverified; closed status does not mean repaired. Free text is untrusted.',
  },
} as const satisfies Record<string, SourceInfo>;
