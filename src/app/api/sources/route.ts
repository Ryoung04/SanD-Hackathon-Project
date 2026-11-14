import { NextResponse } from 'next/server';
import { listSources } from '@/lib/data/sources';
import { parseBbox } from '@/lib/data/geo';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const err = (status: number, code: string, message: string) =>
  NextResponse.json({ error: { code, message } }, { status });

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get('bbox');
  let bbox: [number, number, number, number] | undefined;
  if (raw) {
    const b = parseBbox(raw);
    if (!b.ok) return err(400, 'INVALID_BBOX', b.message);
    bbox = b.bbox;
  }
  try {
    return NextResponse.json(await listSources({ bbox }));
  } catch {
    return err(503, 'SOURCE_UNAVAILABLE', 'Source summary is unavailable');
  }
}
