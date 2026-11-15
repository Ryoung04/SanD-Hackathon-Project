// GET /api/access-features?bbox=w,s,e,n — curb ramps seen in street-photo review, as
// unverified AI candidates in Owner B's access contract (src/lib/map/accessContract.ts).
import { NextResponse } from "next/server";
import { parseBbox } from "@/lib/data/geo";
import { listObservations } from "@/lib/data/observations";
import { readImageryChecks } from "@/lib/ai/imageryChecks";
import { buildAccessFeatures } from "@/lib/map/accessFeatures";
import type { BarrierObservation } from "@/lib/data/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const err = (status: number, code: string, message: string) =>
  NextResponse.json({ error: { code, message } }, { status });

export async function GET(req: Request) {
  const b = parseBbox(new URL(req.url).searchParams.get("bbox"));
  if (!b.ok) return err(400, "INVALID_BBOX", b.message);
  try {
    const obs: BarrierObservation[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 20; i++) {
      const r = await listObservations({ bbox: b.bbox, categories: ["missing_curb_ramp"], limit: 500, cursor });
      obs.push(...r.data);
      if (!r.next_cursor) break;
      cursor = r.next_cursor;
    }
    return NextResponse.json(buildAccessFeatures(readImageryChecks().checks, obs, b.bbox));
  } catch {
    return err(503, "SOURCE_UNAVAILABLE", "Access feature sources are unavailable");
  }
}
