import 'server-only';
import { getSql } from '@/lib/db/client';
import { SOURCES } from './sourceRegistry';
import { CURRENT_SQL, isCurrent, readFileStoreObservations } from './observations';
import { intersectsBbox } from './geo';
import type { Bbox, DataMode } from './types';

export interface SourceSummary {
  source_kind: string;
  name: string;
  publisher: string;
  source_url: string;
  what_it_proves: string;
  what_it_does_not_prove: string;
  geometry_precision: string;
  default_verification_status: string;
  license_note: string;
  count_current: number;
  count_outdated: number;
  source_layer_updated_at: string | null;
  last_successful_ingest_at: string | null;
  last_run: { status: string; started_at: string; fetched: number | null; normalized: number | null; rejected: number | null; marked_outdated: number | null } | null;
}

export interface SourcesResult { data: SourceSummary[]; meta: { generated_at: string; bbox: Bbox | null; data_mode: DataMode; history_available: boolean } }

const iso = (v: any): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString());

interface Agg { current: number; outdated: number; updated: string | null; url?: string }

/** Registry entries for the three synced sources, plus a generic entry for any other source_kind present. */
export function describeSources(present: Iterable<string>) {
  const known: Omit<SourceSummary, 'count_current' | 'count_outdated' | 'source_layer_updated_at' | 'last_successful_ingest_at' | 'last_run'>[] = Object.values(SOURCES).map((s) => ({
    source_kind: s.source_kind as string, name: s.name, publisher: s.publisher, source_url: s.source_url,
    what_it_proves: s.what_it_proves, what_it_does_not_prove: s.what_it_does_not_prove,
    geometry_precision: s.geometry_precision, default_verification_status: s.default_verification_status, license_note: s.license_note,
  }));
  const have = new Set(known.map((k) => k.source_kind));
  for (const kind of present) {
    if (have.has(kind)) continue;
    have.add(kind);
    known.push({
      source_kind: kind, name: kind, publisher: 'Unspecified', source_url: '',
      what_it_proves: 'A record from this source exists at this location.', what_it_does_not_prove: 'That the record is verified or still accurate.',
      geometry_precision: 'unknown', default_verification_status: 'unknown', license_note: 'No license information recorded.',
    });
  }
  return known;
}

export async function listSources(opts: { bbox?: Bbox } = {}): Promise<SourcesResult> {
  const bbox = opts.bbox ?? null;
  const agg = new Map<string, Agg>();
  const bump = (kind: string, outdated: boolean, upd: string | null) => {
    const a = agg.get(kind) ?? { current: 0, outdated: 0, updated: null };
    if (outdated) a.outdated++; else a.current++;
    if (upd && (!a.updated || upd > a.updated)) a.updated = upd;
    agg.set(kind, a);
  };
  const runs = new Map<string, SourceSummary['last_run']>();
  const lastOk = new Map<string, string | null>();
  let dataMode: DataMode = 'live_import';
  let history = false;
  const sql = getSql();

  if (sql) {
    const where = bbox ? `WHERE geom && ST_MakeEnvelope($1,$2,$3,$4,4326) AND ST_Intersects(geom, ST_MakeEnvelope($1,$2,$3,$4,4326))` : '';
    const rows = (await sql(
      `SELECT source_kind, (${CURRENT_SQL}) AS is_current, COUNT(*)::int AS n, MAX(source_updated_at) AS upd
       FROM barrier_observations ${where} GROUP BY 1,2`,
      bbox ? [...bbox] : [],
    )) as any[];
    for (const r of rows) {
      const a = agg.get(r.source_kind) ?? { current: 0, outdated: 0, updated: null };
      if (r.is_current) a.current += r.n; else a.outdated += r.n;
      const u = iso(r.upd);
      if (u && (!a.updated || u > a.updated)) a.updated = u;
      agg.set(r.source_kind, a);
    }
    try {
      const rr = (await sql(
        `SELECT DISTINCT ON (source_kind) source_kind, status, started_at, fetched, normalized, rejected, marked_outdated
         FROM ingest_runs ORDER BY source_kind, started_at DESC`,
      )) as any[];
      for (const r of rr) runs.set(r.source_kind, { status: r.status, started_at: iso(r.started_at) as string, fetched: r.fetched, normalized: r.normalized, rejected: r.rejected, marked_outdated: r.marked_outdated });
      const ok = (await sql(`SELECT source_kind, MAX(finished_at) AS t FROM ingest_runs WHERE status = 'ok' GROUP BY 1`)) as any[];
      for (const r of ok) lastOk.set(r.source_kind, iso(r.t));
      history = true;
    } catch { history = false; }
  } else {
    const st = readFileStoreObservations();
    dataMode = st.data_mode;
    for (const o of st.observations) {
      if (bbox && !intersectsBbox(o.geometry, bbox)) continue;
      bump(o.source_kind, !isCurrent(o), o.source_updated_at);
    }
  }

  const data: SourceSummary[] = describeSources(agg.keys()).map((d) => {
    const a = agg.get(d.source_kind);
    return {
      ...d,
      count_current: a?.current ?? 0,
      count_outdated: a?.outdated ?? 0,
      source_layer_updated_at: a?.updated ?? null,
      last_successful_ingest_at: lastOk.get(d.source_kind) ?? null,
      last_run: runs.get(d.source_kind) ?? null,
    };
  });
  return { data, meta: { generated_at: new Date().toISOString(), bbox, data_mode: dataMode, history_available: history } };
}
