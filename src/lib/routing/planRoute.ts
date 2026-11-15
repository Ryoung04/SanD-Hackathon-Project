/**
 * Router selection for POST /api/route (Owner B).
 *
 *   router "auto" (default): AccessPath OSM graph first (plazas, passages, stairs rules, our
 *                            slopes/curbs); falls back to Valhalla if the graph file is missing
 *                            or a point is off the mapped network.
 *   router "graph":          graph only.
 *   router "valhalla":       Valhalla only (previous behaviour).
 *
 * Safety rule: for wheelchair profiles, a graph result of "no step-free route" is FINAL.
 * We never fall back to another router that might use stairs.
 */
import { fetchRoute, type RouteRequest, type RouteStep } from "./provider";
import { loadGraph, routeOnGraph, type GraphRouteFeatures, type LoadedGraph } from "./graphRouter";

export const ROUTERS = ["auto", "graph", "valhalla"] as const;
export type RouterChoice = (typeof ROUTERS)[number];

export type PlannedRoute =
  | {
      ok: true;
      provider: string;
      route: { type: "LineString"; coordinates: [number, number][] };
      distance_m: number;
      duration_s: number;
      steps: RouteStep[];
      route_features: GraphRouteFeatures | null;
      /** Set when auto fell back to Valhalla; explains why. */
      fallback_reason: string | null;
    }
  | { ok: false; provider: string; reason: string };

export async function planRoute(req: RouteRequest, router: RouterChoice = "auto", fetchImpl: typeof fetch = fetch, graphImpl: () => LoadedGraph | null = loadGraph): Promise<PlannedRoute> {
  let fallback: string | null = null;
  if (router !== "valhalla") {
    const g = graphImpl();
    if (g) {
      const r = routeOnGraph(g, req.start, req.end, req.profile);
      if (r.ok) return { ...r, fallback_reason: null };
      const final = router === "graph" || (r.code === "NO_PATH" && req.profile !== "pedestrian");
      if (final) return { ok: false, provider: r.provider, reason: r.reason };
      fallback = r.reason;
    } else if (router === "graph") {
      return { ok: false, provider: "accesspath-osm-graph", reason: "Routing graph not available on this server" };
    } else {
      fallback = "Routing graph not available on this server";
    }
  }
  const v = await fetchRoute(req, fetchImpl);
  if (!v.ok) return { ok: false, provider: v.provider, reason: fallback ? `${fallback}; fallback also failed: ${v.reason}` : v.reason };
  return { ...v, route_features: null, fallback_reason: fallback };
}
