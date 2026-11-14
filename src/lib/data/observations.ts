import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { getSql } from '@/lib/db/client';
import { validateObservation } from './normalizers';
import { bboxOfGeometry, intersectsBbox, geometryDistanceToLine, padBbox } from './geo';
import type { BarrierObservation, Bbox, Category, ListResult, LineStringGeometry } from './types';

export const DEFAULT_LIMIT = 200;
export const MAX_LIMIT = 500;

const RESTRICTED_KINDS = ['street_imagery_ai', 'web_notice', 'community_report', 'other'];

function storePath(): string {
  return process.env.OBS_STORE_PATH || path.join(process.cwd(), 'data', 'observations.json');
}

interface FileStore { data_mode: 'live_import' | 'demo_fixture'; updated_at: string; observations: BarrierObservation[] }

function readStore(): FileStore {
  try {
    const raw = JSON.parse(fs.readFileSync(storePath(), 'utf8'));
    if (raw && Array.isArray(raw.observations)) return raw as FileStore;
  } catch { /* missing or unreadable: empty */ }
  return { data_mode: 'live_import', updated_at: new Date(0).toISOString(), observations: [] };
}

function writeStore(s: FileStore) {
  const p = storePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(s));
}

function clampLimit(n?: number) {
  if (!n || !Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(n)));
}

function rowToObs(r: any): BarrierObservation {
  const iso = (v: any) => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString());
  return {
    id: r.id, category: r.category, label: r.label, geometry: r.geometry_json,
    geometry_precision: r.geometry_precision, source_kind: r.source_kind, source_record_id: r.source_record_id,
    source_url: r.source_url, source_observed_at: iso(r.source_observed_at), source_updated_at: iso(r.source_updated_at),
    ingested_at: iso(r.ingested_at) as string, verification_status: r.verification_status,
    routing_impact: r.routing_impact, severity: r.severity, description: r.description,
    evidence: r.evidence_json ?? [], metadata: r.metadata_json ?? {},
  };
}

export async function listObservations(opts: { bbox: Bbox; categories?: Category[]; limit?: number; cursor?: string }): Promise<ListResult> {
  const { bbox, categories, cursor } = opts;
  const limit = clampLimit(opts.limit);
  const sql = getSql();
  let matched: BarrierObservation[] = [];
  let dataMode: ListResult['data_mode'] = 'live_import';

  if (sql) {
    let after = cursor ?? '';
    const batch = limit + 1;
    for (let guard = 0; guard < 20 && matched.length < limit + 1; guard++) {
      const rows = (await sql(
        `SELECT * FROM barrier_observations
         WHERE min_lon <= $3 AND max_lon >= $1 AND min_lat <= $4 AND max_lat >= $2
           AND ($5::text[] IS NULL OR category = ANY($5::text[]))
           AND id > $6
         ORDER BY id LIMIT $7`,
        [bbox[0], bbox[1], bbox[2], bbox[3], categories && categories.length ? categories : null, after, batch],
      )) as any[];
      for (const r of rows) {
        const o = rowToObs(r);
        if (intersectsBbox(o.geometry, bbox)) matched.push(o);
      }
      if (rows.length < batch) break;
      after = rows[rows.length - 1].id;
    }
  } else {
    const s = readStore();
    dataMode = s.data_mode;
    matched = s.observations
      .filter((o) => (!cursor || o.id > cursor) && (!categories?.length || categories.includes(o.category)) && intersectsBbox(o.geometry, bbox))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  const page = matched.slice(0, limit);
  const res: ListResult = { data: page, data_mode: dataMode };
  if (matched.length > limit) res.next_cursor = page[page.length - 1].id;
  return res;
}

function guardrail(o: BarrierObservation): string | null {
  if (RESTRICTED_KINDS.includes(o.source_kind)) {
    if (o.verification_status === 'human_reviewed' || o.verification_status === 'official_inventory')
      return `${o.source_kind} cannot be ${o.verification_status} via ingest`;
    if (o.routing_impact === 'confirmed_blocking_edge') return `${o.source_kind} cannot set confirmed_blocking_edge via ingest`;
  }
  return null;
}

export async function upsertObservations(obs: BarrierObservation[]): Promise<{ inserted: number; updated: number; rejected: number; errors: string[] }> {
  const errors: string[] = [];
  let rejected = 0, inserted = 0, updated = 0;
  const good: BarrierObservation[] = [];
  for (const o of obs) {
    const v = validateObservation(o);
    if (!v.ok) { rejected++; errors.push(`${o?.id ?? '?'}: ${v.errors.join('; ')}`); continue; }
    const g = guardrail(o);
    if (g) { rejected++; errors.push(`${o.id}: ${g}`); continue; }
    good.push(o);
  }

  const sql = getSql();
  if (sql) {
    for (let i = 0; i < good.length; i += 25) {
      const rows = await Promise.all(good.slice(i, i + 25).map(async (o) => {
        const [minLon, minLat, maxLon, maxLat] = bboxOfGeometry(o.geometry);
        const r = (await sql(
          `INSERT INTO barrier_observations
            (id, category, label, geometry_json, geometry_precision, source_kind, source_record_id, source_url,
             source_observed_at, source_updated_at, ingested_at, verification_status, routing_impact, severity,
             description, evidence_json, metadata_json, min_lon, min_lat, max_lon, max_lat)
           VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17::jsonb,$18,$19,$20,$21)
           ON CONFLICT (id) DO UPDATE SET
             category=EXCLUDED.category, label=EXCLUDED.label, geometry_json=EXCLUDED.geometry_json,
             geometry_precision=EXCLUDED.geometry_precision, source_kind=EXCLUDED.source_kind,
             source_record_id=EXCLUDED.source_record_id, source_url=EXCLUDED.source_url,
             source_observed_at=EXCLUDED.source_observed_at, source_updated_at=EXCLUDED.source_updated_at,
             ingested_at=NOW(), verification_status=EXCLUDED.verification_status,
             routing_impact=EXCLUDED.routing_impact, severity=EXCLUDED.severity, description=EXCLUDED.description,
             evidence_json=EXCLUDED.evidence_json, metadata_json=EXCLUDED.metadata_json,
             min_lon=EXCLUDED.min_lon, min_lat=EXCLUDED.min_lat, max_lon=EXCLUDED.max_lon, max_lat=EXCLUDED.max_lat
           RETURNING (xmax = 0) AS inserted`,
          [o.id, o.category, o.label, JSON.stringify(o.geometry), o.geometry_precision, o.source_kind, o.source_record_id,
           o.source_url, o.source_observed_at, o.source_updated_at, o.ingested_at, o.verification_status, o.routing_impact,
           o.severity, o.description, JSON.stringify(o.evidence), JSON.stringify(o.metadata), minLon, minLat, maxLon, maxLat],
        )) as any[];
        return r[0]?.inserted === true;
      }));
      for (const ins of rows) ins ? inserted++ : updated++;
    }
  } else {
    const s = readStore();
    const idx = new Map(s.observations.map((o, i) => [o.id, i] as const));
    for (const o of good) {
      const i = idx.get(o.id);
      if (i === undefined) { idx.set(o.id, s.observations.length); s.observations.push(o); inserted++; }
      else { s.observations[i] = o; updated++; }
    }
    s.data_mode = 'live_import';
    s.updated_at = new Date().toISOString();
    writeStore(s);
  }
  return { inserted, updated, rejected, errors };
}

export async function findNearRoute(line: LineStringGeometry, thresholdM = 30): Promise<{ id: string; distance_m: number; match_method: string }[]> {
  const raw = bboxOfGeometry(line);
  const bbox = padBbox(raw, thresholdM);
  const out: { id: string; distance_m: number; match_method: string }[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 50; guard++) {
    const res = await listObservations({ bbox, limit: MAX_LIMIT, cursor });
    for (const o of res.data) {
      const d = geometryDistanceToLine(o.geometry, line.coordinates);
      if (d <= thresholdM) out.push({ id: o.id, distance_m: Math.round(d * 10) / 10, match_method: `within_${thresholdM}m_approximate` });
    }
    if (!res.next_cursor) break;
    cursor = res.next_cursor;
  }
  return out.sort((a, b) => a.distance_m - b.distance_m);
}

/** All observations in the store (file store or DB), used by coverage script. */
export async function countByKindCategory(): Promise<{ source_kind: string; category: string; n: number }[]> {
  const sql = getSql();
  if (sql) {
    const rows = (await sql(`SELECT source_kind, category, COUNT(*)::int AS n FROM barrier_observations GROUP BY 1,2 ORDER BY 1,2`)) as any[];
    return rows as any;
  }
  const m = new Map<string, number>();
  for (const o of readStore().observations) { const k = `${o.source_kind}|${o.category}`; m.set(k, (m.get(k) ?? 0) + 1); }
  return [...m.entries()].sort().map(([k, n]) => { const [source_kind, category] = k.split('|'); return { source_kind, category, n }; });
}
