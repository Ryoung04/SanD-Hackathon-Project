import { NextResponse } from "next/server";
import { parseRouteRequest } from "@/lib/routing/provider";
import { planRoute, ROUTERS, type RouterChoice } from "@/lib/routing/planRoute";
import { findNearRoute } from "@/lib/data/observations";
import { STUDY_BBOX } from "@/lib/data/studyArea";

export const dynamic = "force-dynamic";

/** Approximate "nearby" radius. Proximity is not proof the user will encounter the barrier. */
const NEARBY_THRESHOLD_M = 30;
const COVERAGE_NOTE = "Pedestrian route — accessibility not verified";
const GRAPH_NOTE = "Routed on community-mapped OpenStreetMap paths (stairs, curbs, passages and plazas as mapped; slopes estimated from elevation data). Missing data is unknown.";

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

  const rawRouter = (body as any)?.router ?? "auto";
  if (!ROUTERS.includes(rawRouter)) return err(400, "INVALID_ROUTE_REQUEST", `router must be one of ${ROUTERS.join(", ")}`);
  const router = rawRouter as RouterChoice;

  // For preference profiles, also route standard walking (same router) so the UI can show a
  // REAL difference between two computed routes (never an invented metric).
  const wantBaseline = parsed.req.profile !== "pedestrian";
  const [r, base] = await Promise.all([
    planRoute(parsed.req, router),
    wantBaseline ? planRoute({ ...parsed.req, profile: "pedestrian" }, router) : Promise.resolve(null),
  ]);
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
    profile: parsed.req.profile,
    router,
    steps: r.steps,
    route_features: r.route_features,
    fallback_reason: r.fallback_reason,
    data_note: r.provider === "accesspath-osm-graph" ? GRAPH_NOTE : null,
    // Only compare like with like (same provider), so the difference is meaningful.
    comparison: base && base.ok && base.provider === r.provider ? { profile: "pedestrian", distance_m: base.distance_m, duration_s: base.duration_s } : null,
    nearby_barriers: nearby.map((n) => n.id),
    nearby_details: nearby,
    nearby_status,
    nearby_threshold_m: NEARBY_THRESHOLD_M,
    coverage_note: COVERAGE_NOTE,
    verified_accessible: false,
    rerouting: "disabled_warning_only",
  });
}
