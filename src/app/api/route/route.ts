import { NextResponse } from "next/server";
import { fetchRoute, parseRouteRequest } from "@/lib/routing/provider";
import { findNearRoute } from "@/lib/data/observations";
import { STUDY_BBOX } from "@/lib/data/studyArea";

export const dynamic = "force-dynamic";

/** Approximate "nearby" radius. Proximity is not proof the user will encounter the barrier. */
const NEARBY_THRESHOLD_M = 30;
const COVERAGE_NOTE = "Pedestrian route — accessibility not verified";

const err = (status: number, code: string, message: string) => NextResponse.json({ error: { code, message } }, { status });

export async function POST(req: Request) {
  let body: unknown;
  try { body = await req.json(); } catch { return err(400, "INVALID_BODY", "Body must be JSON"); }
  const parsed = parseRouteRequest(body);
  if (!parsed.ok) return err(400, "INVALID_ROUTE_REQUEST", parsed.message);
  const [w, s, e, n] = STUDY_BBOX;
  const inside = (p: { lat: number; lon: number }) => p.lon >= w && p.lon <= e && p.lat >= s && p.lat <= n;
  if (!inside(parsed.req.start) || !inside(parsed.req.end))
    return err(400, "OUTSIDE_STUDY_AREA", "Start and destination must be inside the downtown study area");

  const r = await fetchRoute(parsed.req);
  if (!r.ok) {
    // No fabricated geometry/distance on failure.
    return NextResponse.json({ status: "unavailable", provider: r.provider, reason: r.reason, verified_accessible: false, coverage_note: COVERAGE_NOTE });
  }

  // Warning overlay only; avoid_barrier_ids is intentionally ignored (no precise edge matching yet).
  let nearby: { id: string; distance_m: number; match_method: string }[] = [];
  let nearby_status: "ok" | "unavailable" = "ok";
  try { nearby = await findNearRoute(r.route, NEARBY_THRESHOLD_M); } catch { nearby_status = "unavailable"; }

  return NextResponse.json({
    status: "route_available",
    provider: r.provider,
    route: r.route,
    distance_m: r.distance_m,
    duration_s: r.duration_s,
    nearby_barriers: nearby.map((n) => n.id),
    nearby_details: nearby,
    nearby_status,
    nearby_threshold_m: NEARBY_THRESHOLD_M,
    coverage_note: COVERAGE_NOTE,
    verified_accessible: false,
    rerouting: "disabled_warning_only",
  });
}
