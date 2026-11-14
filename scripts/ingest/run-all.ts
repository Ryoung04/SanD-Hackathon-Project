import fs from 'node:fs';
import path from 'node:path';
import { STUDY_BBOX } from '../../src/lib/data/studyArea';
import { upsertObservations, markOutdated } from '../../src/lib/data/observations';
import { getSql } from '../../src/lib/db/client';
import type { BarrierObservation } from '../../src/lib/data/types';
import { ingestProwag } from './sd-prowag';
import { ingestTraffic } from './sd-traffic';
import { ingest311 } from './sd-311';

export function sanitizeError(msg: string): string {
  return msg.replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[url]').replace(/\s+/g, ' ').slice(0, 300);
}

async function logRun(sql: ReturnType<typeof getSql>, row: { kind: string; started: Date; status: 'ok' | 'failed'; fetched?: number; normalized?: number; rejected?: number; inserted?: number; updated?: number; marked_outdated?: number; error?: string }) {
  if (!sql) return;
  try {
    await sql(
      `INSERT INTO ingest_runs (source_kind, started_at, finished_at, status, fetched, normalized, rejected, inserted, updated, marked_outdated, error, neon_branch)
       VALUES ($1,$2,NOW(),$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [row.kind, row.started.toISOString(), row.status, row.fetched ?? null, row.normalized ?? null, row.rejected ?? null, row.inserted ?? null, row.updated ?? null, row.marked_outdated ?? null, row.error ?? null, process.env.NEON_INGEST_BRANCH || 'main'],
    );
  } catch (e) {
    console.error(`could not record ingest run: ${sanitizeError((e as Error).message)}`);
  }
}

async function main() {
  const sql = getSql();
  if (sql) {
    const ddl = fs.readFileSync(path.join(process.cwd(), 'src/lib/db/schema.sql'), 'utf8');
    for (const stmt of ddl.split(';').map((s) => s.trim()).filter(Boolean)) await sql(stmt);
    console.log('Applied schema.sql to database');
  } else console.log('DATABASE_URL not set: using file store');

  const steps: [string, string, () => Promise<{ fetched: number; obs: BarrierObservation[] }>][] = [
    ['prowag', 'city_gis', () => ingestProwag(STUDY_BBOX)],
    ['traffic', 'traffic_control', () => ingestTraffic(STUDY_BBOX)],
    ['get_it_done', 'city_311', () => ingest311(STUDY_BBOX)],
  ];
  let failed = 0;
  for (const [name, kind, fn] of steps) {
    const started = new Date();
    try {
      console.log(`Ingesting ${name}...`);
      const { fetched, obs } = await fn();
      const r = await upsertObservations(obs);
      // Only expire after a successful, non-empty fetch (markOutdated also refuses an empty list).
      const outdated = await markOutdated(kind, obs.map((o) => o.id));
      console.log(`${name}: fetched=${fetched} normalized=${obs.length} rejected=${r.rejected} inserted=${r.inserted} updated=${r.updated} marked_outdated=${outdated}`);
      for (const e of r.errors.slice(0, 3)) console.log('  reject:', e);
      await logRun(sql, { kind, started, status: 'ok', fetched, normalized: obs.length, rejected: r.rejected, inserted: r.inserted, updated: r.updated, marked_outdated: outdated });
    } catch (e) {
      failed++;
      const msg = sanitizeError((e as Error).message);
      console.error(`${name}: FAILED - ${msg}`);
      await logRun(sql, { kind, started, status: 'failed', error: msg });
    }
  }
  if (failed) process.exitCode = 1;
}
if (!process.env.VITEST) main();
