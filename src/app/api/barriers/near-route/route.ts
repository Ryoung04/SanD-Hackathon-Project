import { NextResponse } from 'next/server';
import { findNearRoute } from '@/lib/data/observations';
import type { LineStringGeometry } from '@/lib/data/types';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const err = (status: number, code: string, message: string) =>
  NextResponse.json({ error: { code, message } }, { status });

export async function POST(req: Request) {
  let body: any;
  try { body = await req.json(); } catch { return err(400, 'INVALID_BODY', 'Body must be JSON'); }
  const r = body?.route;
  if (!r || r.type !== 'LineString' || !Array.isArray(r.coordinates) || r.coordinates.length < 2 || r.coordinates.length > 5000 ||
      !r.coordinates.every((c: any) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]) && Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90))
    return err(400, 'INVALID_ROUTE', 'route must be a GeoJSON LineString with valid [lon,lat] positions');
  let t = 30;
  if (body.threshold_m !== undefined) {
    t = body.threshold_m;
    if (typeof t !== 'number' || !Number.isFinite(t) || t < 5 || t > 100) return err(400, 'INVALID_THRESHOLD', 'threshold_m must be a number 5..100');
  }
  const line: LineStringGeometry = { type: 'LineString', coordinates: r.coordinates.map((c: number[]) => [c[0], c[1]] as [number, number]) };
  try {
    const data = await findNearRoute(line, t);
    return NextResponse.json({
      data,
      meta: { count: data.length, threshold_m: t, generated_at: new Date().toISOString(), note: 'near the route, not confirmed on the pedestrian edge' },
    });
  } catch {
    return err(503, 'SOURCE_UNAVAILABLE', 'Observation store is unavailable');
  }
}
