import { NextResponse } from 'next/server';
import { listObservations } from '@/lib/data/observations';
import { parseBbox } from '@/lib/data/geo';
import { parseQuery } from '@/lib/data/query';

export const dynamic = 'force-dynamic';

const err = (status: number, code: string, message: string) =>
  NextResponse.json({ error: { code, message } }, { status });

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const b = parseBbox(sp.get('bbox'));
  if (!b.ok) return err(400, 'INVALID_BBOX', b.message);
  const q = parseQuery(sp.get('categories'), sp.get('limit'));
  if (!q.ok) return err(400, q.code, q.message);
  try {
    const res = await listObservations({ bbox: b.bbox, categories: q.categories, limit: q.limit, cursor: sp.get('cursor') || undefined });
    return NextResponse.json({
      data: res.data,
      meta: { count: res.data.length, bbox: b.bbox, generated_at: new Date().toISOString(), data_mode: res.data_mode, limit: q.limit, next_cursor: res.next_cursor ?? null },
    });
  } catch {
    return err(503, 'SOURCE_UNAVAILABLE', 'Observation store is unavailable');
  }
}
