import {
  BarrierObservation, CATEGORIES, GEOMETRY_PRECISIONS, SOURCE_KINDS, VERIFICATION_STATUSES,
  ROUTING_IMPACTS, SEVERITIES, Category,
} from './types';
import { SOURCES } from './sourceRegistry';

// ---------- shared helpers ----------

export function sanitizeText(input: unknown, maxLen = 300): string {
  if (input === null || input === undefined) return '';
  let s = String(input);
  s = s.replace(/<[^>]*>/g, ' ');
  s = s.replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g, ' ');
  s = s.replace(/[<>]/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length > maxLen) s = s.slice(0, maxLen).trimEnd();
  return s;
}

function isoOrNull(ms: unknown): string | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function validLonLat(lon: unknown, lat: unknown): lon is number {
  return (
    typeof lon === 'number' && typeof lat === 'number' &&
    Number.isFinite(lon) && Number.isFinite(lat) &&
    Math.abs(lon) <= 180 && Math.abs(lat) <= 90 && !(lon === 0 && lat === 0) && lon !== 0 && lat !== 0
  );
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export interface ArcGisFeature {
  attributes?: Record<string, unknown>;
  geometry?: { x?: number; y?: number } | null;
}

// ---------- PROWAG ----------

export function normalizeProwagRamp(feature: ArcGisFeature, layerLastEditIso: string | null, now: Date = new Date()): BarrierObservation | null {
  const a = feature.attributes ?? {};
  const g = feature.geometry;
  const x = g?.x, y = g?.y;
  if (!validLonLat(x, y)) return null;
  const objectId = a.OBJECTID;
  if (objectId === null || objectId === undefined) return null;
  const rampDef = num(a.RAMP_DEFICIT) ?? 0;
  const apsDef = num(a.APS_DEFICIT) ?? 0;
  let category: Category;
  let label: string;
  if (rampDef > 0) {
    category = 'missing_curb_ramp';
    const req = num(a.RAMPS_REQUIRED);
    label = req !== null
      ? `Intersection missing ${rampDef} of ${req} required curb ramps (corner unknown)`
      : `Intersection missing ${rampDef} required curb ramps (corner unknown)`;
  } else if (apsDef > 0) {
    category = 'crossing_issue';
    label = `Intersection lacks accessible pedestrian signal (${apsDef})`;
  } else {
    return null;
  }
  const src = SOURCES.prowag;
  return {
    id: `city_gis:prowag2:${objectId}`,
    category,
    label,
    geometry: { type: 'Point', coordinates: [x as number, y as number] },
    geometry_precision: 'intersection',
    source_kind: 'city_gis',
    source_record_id: String(objectId),
    source_url: src.source_url,
    source_observed_at: null,
    source_updated_at: layerLastEditIso,
    ingested_at: now.toISOString(),
    verification_status: 'official_inventory',
    routing_impact: 'unknown',
    severity: 'unknown',
    description: label,
    evidence: [],
    metadata: {
      NODE_ID: a.NODE_ID ?? null,
      APPROACH_COUNT: num(a.APPROACH_COUNT),
      RAMPS_REQUIRED: num(a.RAMPS_REQUIRED),
      RAMPS_EXISTING: num(a.RAMPS_EXISTING),
      RAMP_DEFICIT: rampDef,
      APS_DEFICIT: apsDef,
      cpname: a.cpname ?? null,
    },
  };
}

export const PROWAG_APS_URL =
  'https://services8.arcgis.com/WunV6yKxvEXfsV4W/ArcGIS/rest/services/CSD_PROWAG_FINAL_V2_WFL1/FeatureServer/1';

/** PROWAG layer 1 "Missing APS": intersections lacking accessible pedestrian signals (audible/vibrotactile).
 *  Same schema as layer 2; separate id namespace so an intersection can carry both a ramp and an APS record. */
export function normalizeProwagAps(feature: ArcGisFeature, layerLastEditIso: string | null, now: Date = new Date()): BarrierObservation | null {
  const a = feature.attributes ?? {};
  const x = feature.geometry?.x, y = feature.geometry?.y;
  if (!validLonLat(x, y)) return null;
  const objectId = a.OBJECTID;
  if (objectId === null || objectId === undefined) return null;
  const apsDef = num(a.APS_DEFICIT) ?? 0;
  if (apsDef <= 0) return null;
  const label = `Intersection missing accessible pedestrian signals at ${apsDef} crossing${apsDef === 1 ? '' : 's'} (which crossings unknown)`;
  return {
    id: `city_gis:prowag1:${objectId}`,
    category: 'crossing_issue',
    label,
    geometry: { type: 'Point', coordinates: [x as number, y as number] },
    geometry_precision: 'intersection',
    source_kind: 'city_gis',
    source_record_id: String(objectId),
    source_url: PROWAG_APS_URL,
    source_observed_at: null,
    source_updated_at: layerLastEditIso,
    ingested_at: now.toISOString(),
    verification_status: 'official_inventory',
    routing_impact: 'informational',
    severity: 'unknown',
    description: label,
    evidence: [],
    metadata: {
      layer: 'missing_aps',
      NODE_ID: a.NODE_ID ?? null,
      APPROACH_COUNT: num(a.APPROACH_COUNT),
      APS_DEFICIT: apsDef,
      cpname: a.cpname ?? null,
    },
  };
}

// ---------- Traffic control ----------

export function normalizeTrafficControl(feature: ArcGisFeature, now: Date = new Date()): BarrierObservation | null {
  const a = feature.attributes ?? {};
  let x: unknown = feature.geometry?.x;
  let y: unknown = feature.geometry?.y;
  if (!validLonLat(x, y)) {
    x = a.LONGITUDE; y = a.LATITUDE;
    if (!validLonLat(x, y)) return null;
  }
  const objectId = a.OBJECTID;
  if (objectId === null || objectId === undefined) return null;
  const label = 'Permitted traffic control nearby (not confirmed sidewalk closure)';
  return {
    id: `traffic_control:${objectId}`,
    category: 'construction_warning',
    label,
    geometry: { type: 'Point', coordinates: [x as number, y as number] },
    geometry_precision: 'approximate_point',
    source_kind: 'traffic_control',
    source_record_id: String(objectId),
    source_url: SOURCES.traffic.source_url,
    source_observed_at: null,
    source_updated_at: isoOrNull(a.DATE_LAST_UPDATED),
    ingested_at: now.toISOString(),
    verification_status: 'official_inventory',
    routing_impact: 'unknown',
    severity: 'unknown',
    description: sanitizeText(a.BLOCK_INFORMATION, 300),
    evidence: [],
    metadata: {
      approval_id: a.APPROVAL_ID ?? null,
      type: a.TRAFFIC_CONTROL_TYPE ?? null,
      date_start: isoOrNull(a.DATE_START),
      date_end: isoOrNull(a.DATE_END),
    },
  };
}

// ---------- 311 ----------

/** Convert 'YYYY-MM-DD HH:MM:SS(.fff)' America/Los_Angeles local time to UTC ISO. */
export function pacificToUtcIso(local: unknown): string | null {
  if (typeof local !== 'string') return null;
  const m = local.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [Y, Mo, D, H, Mi, S] = m.slice(1).map(Number);
  const wall = Date.UTC(Y, Mo - 1, D, H, Mi, S);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const offsetAt = (utcMs: number) => {
    const p: Record<string, number> = {};
    for (const part of fmt.formatToParts(new Date(utcMs))) if (part.type !== 'literal') p[part.type] = Number(part.value);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - utcMs;
  };
  let utc = wall - offsetAt(wall);
  utc = wall - offsetAt(utc);
  const d = new Date(utc);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const norm = (v: unknown) => String(v ?? '').trim().toLowerCase();

export function classify311(serviceName: unknown, detail: unknown): { category: Category; label: string } | null {
  const s = norm(serviceName), d = norm(detail);
  if (s === 'sidewalk repair issue') return { category: 'sidewalk_damage', label: 'Resident-reported sidewalk damage' };
  if (s === 'pavement maintenance' && d === 'concrete curb ramps repair issue')
    return { category: 'noncompliant_curb_ramp', label: 'Resident-reported curb ramp repair issue' };
  if (s === 'traffic engineering' && d === 'curb ramp eval for new ada')
    return { category: 'missing_curb_ramp', label: 'Resident-requested curb ramp evaluation (possible missing ramp)' };
  if (s === 'tree maintenance' && d === 'sidewalk encroachment')
    return { category: 'sidewalk_obstruction', label: 'Resident-reported tree encroaching on sidewalk' };
  if (s === 'parks issue' && d === 'sidewalk/pathway')
    return { category: 'sidewalk_damage', label: 'Resident-reported park sidewalk/pathway issue' };
  return null;
}

export function normalize311Row(row: Record<string, string | undefined>, now: Date = new Date()): BarrierObservation | null {
  const cls = classify311(row.service_name, row.service_name_detail);
  if (!cls) return null;
  const id = (row.service_request_id ?? '').trim();
  if (!id) return null;
  const lat = Number(row.lat), lng = Number(row.lng);
  if (!(row.lat ?? '').trim() || !(row.lng ?? '').trim() || !validLonLat(lng, lat)) return null;
  const desc = sanitizeText(row.public_description, 200);
  return {
    id: `city_311:${id}`,
    category: cls.category,
    label: cls.label,
    geometry: { type: 'Point', coordinates: [lng, lat] },
    geometry_precision: 'approximate_point',
    source_kind: 'city_311',
    source_record_id: id,
    source_url: SOURCES.get_it_done.source_url,
    source_observed_at: pacificToUtcIso(row.date_requested),
    source_updated_at: null,
    ingested_at: now.toISOString(),
    verification_status: 'unverified_report',
    routing_impact: 'possible_obstacle',
    severity: 'unknown',
    description: 'Resident report (unverified): ' + desc,
    evidence: [],
    metadata: {
      service_name: (row.service_name ?? '').trim(),
      service_name_detail: (row.service_name_detail ?? '').trim(),
      status: (row.status ?? '').trim(),
      date_closed: (row.date_closed ?? '').trim() || null,
      comm_plan_name: (row.comm_plan_name ?? '').trim() || null,
    },
  };
}

// ---------- validation ----------

const inSet = (arr: readonly string[], v: unknown) => typeof v === 'string' && arr.includes(v);
const isoOk = (v: unknown) => v === null || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v)));
const posOk = (c: unknown) =>
  Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]) &&
  Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90;

export function validateObservation(o: any): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!o || typeof o !== 'object') return { ok: false, errors: ['not an object'] };
  for (const k of ['id', 'label', 'source_record_id', 'source_url', 'description'] as const) {
    if (typeof o[k] !== 'string' || (k !== 'description' && o[k] === '')) errors.push(`missing/invalid ${k}`);
  }
  if (!inSet(CATEGORIES, o.category)) errors.push('invalid category');
  if (!inSet(GEOMETRY_PRECISIONS, o.geometry_precision)) errors.push('invalid geometry_precision');
  if (!inSet(SOURCE_KINDS, o.source_kind)) errors.push('invalid source_kind');
  if (!inSet(VERIFICATION_STATUSES, o.verification_status)) errors.push('invalid verification_status');
  if (!inSet(ROUTING_IMPACTS, o.routing_impact)) errors.push('invalid routing_impact');
  if (!inSet(SEVERITIES, o.severity)) errors.push('invalid severity');
  const g = o.geometry;
  if (!g || typeof g !== 'object') errors.push('missing geometry');
  else if (g.type === 'Point') {
    if (!posOk(g.coordinates)) errors.push('invalid Point coordinates');
  } else if (g.type === 'LineString') {
    if (!Array.isArray(g.coordinates) || g.coordinates.length < 2 || !g.coordinates.every(posOk)) errors.push('invalid LineString coordinates');
  } else errors.push('geometry type must be Point or LineString');
  for (const k of ['source_observed_at', 'source_updated_at'] as const) if (!isoOk(o[k])) errors.push(`${k} must be ISO string or null`);
  if (typeof o.ingested_at !== 'string' || !isoOk(o.ingested_at)) errors.push('ingested_at must be ISO string');
  if (!Array.isArray(o.evidence)) errors.push('evidence must be array');
  if (!o.metadata || typeof o.metadata !== 'object' || Array.isArray(o.metadata)) errors.push('metadata must be object');
  return { ok: errors.length === 0, errors };
}
