import fs from 'node:fs';
import path from 'node:path';
import { STUDY_BBOX } from '../../src/lib/data/studyArea';
import { upsertObservations, markOutdated } from '../../src/lib/data/observations';
import { getSql } from '../../src/lib/db/client';
import type { BarrierObservation } from '../../src/lib/data/types';
import { ingestProwag } from './sd-prowag';
import { ingestTraffic } from './sd-traffic';
import { ingest311 } from './sd-311';

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
    try {
      console.log(`Ingesting ${name}...`);
      const { fetched, obs } = await fn();
      const r = await upsertObservations(obs);
      // Only expire after a successful, non-empty fetch (markOutdated also refuses an empty list).
      const outdated = await markOutdated(kind, obs.map((o) => o.id));
      console.log(`${name}: fetched=${fetched} normalized=${obs.length} rejected=${r.rejected} inserted=${r.inserted} updated=${r.updated} marked_outdated=${outdated}`);
      for (const e of r.errors.slice(0, 3)) console.log('  reject:', e);
    } catch (e) {
      failed++;
      console.error(`${name}: FAILED - ${(e as Error).message}`);
    }
  }
  if (failed) process.exitCode = 1;
}
main();
