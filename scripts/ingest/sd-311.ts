import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parse } from 'csv-parse';
import { SOURCES } from '../../src/lib/data/sourceRegistry';
import { normalize311Row } from '../../src/lib/data/normalizers';
import type { BarrierObservation, Bbox } from '../../src/lib/data/types';

async function download(dest: string) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const res = await fetch(SOURCES.get_it_done.endpoint);
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} downloading Get It Done CSV`);
  await pipeline(Readable.fromWeb(res.body as any), fs.createWriteStream(dest));
}

export async function ingest311(bbox: Bbox): Promise<{ fetched: number; obs: BarrierObservation[] }> {
  const dest = path.join(process.cwd(), 'data', 'raw', 'get_it_done_requests_open.csv');
  await download(dest);
  const parser = fs.createReadStream(dest).pipe(parse({ columns: true, relax_quotes: true, relax_column_count: true, skip_empty_lines: true }));
  let rows = 0, inBbox = 0;
  const obs: BarrierObservation[] = [];
  for await (const row of parser as AsyncIterable<Record<string, string>>) {
    rows++;
    const lat = Number(row.lat), lng = Number(row.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lng < bbox[0] || lng > bbox[2] || lat < bbox[1] || lat > bbox[3]) continue;
    inBbox++;
    const o = normalize311Row(row);
    if (o) obs.push(o);
  }
  console.log(`  [311] csv rows ${rows}, in bbox ${inBbox}`);
  return { fetched: inBbox, obs };
}
