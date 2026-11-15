/**
 * Real-map checks on data/derived/downtown-graph.json (OSM, changes often).
 *
 * These NEVER fail the run: a mismatch is reported as a TODO with a note, because the
 * live map data can change (a stair re-mapped, a sidewalk added). Investigate notes by hand.
 * Skipped entirely if the graph file is missing (run scripts/osm/fetch-graph.ts).
 *
 * Points are the two ends of real OSM stairways (picked 2026-11-14), where regular walking
 * should take the stairs and wheelchair profiles must detour without them.
 */
import { test, type TestContext } from "node:test";
import fs from "node:fs";
import { GRAPH_PATH, loadGraph, routeOnGraph } from "../../src/lib/routing/graphRouter";
import type { RouteProfile } from "../../src/lib/routing/provider";

const HAVE_GRAPH = fs.existsSync(GRAPH_PATH());

const STAIR_CASES = [
  { name: "stairs way/884953143 (near 32.7243,-117.1592)", a: [-117.159139, 32.72429], b: [-117.159286, 32.724258] },
  { name: "stairs way/1074064259 (near 32.7182,-117.1518)", a: [-117.151848, 32.718181], b: [-117.151851, 32.718259] },
  { name: "stairs way/706727961 (near 32.7294,-117.1529)", a: [-117.152719, 32.729211], b: [-117.153097, 32.729662] },
  { name: "stairs way/1074064250 (near 32.7177,-117.1526)", a: [-117.15269, 32.717692], b: [-117.15254, 32.717692] },
] as const;

/** Soft assertion: on failure mark the test TODO (does not fail the run) and log the note. */
function soft(t: TestContext, ok: boolean, note: string) {
  if (ok) return;
  t.diagnostic(`MAP DATA NOTE: ${note}`);
  t.todo(note);
  throw new Error(note);
}

const ll = (p: readonly number[]) => ({ lon: p[0], lat: p[1] });

for (const c of STAIR_CASES) {
  test(`real map: ${c.name}: walking uses stairs, wheelchair does not`, { skip: !HAVE_GRAPH && "no graph file" }, (t) => {
    const g = loadGraph();
    soft(t, !!g, "graph failed to load");
    const walk = routeOnGraph(g!, ll(c.a), ll(c.b), "pedestrian");
    soft(t, walk.ok, `walking route failed: ${!walk.ok && walk.reason}`);
    if (!walk.ok) return;
    soft(t, walk.route_features.stairs >= 1, `walking route no longer uses stairs (${walk.distance_m} m)`);
    for (const profile of ["wheelchair_preference", "avoid_stairs"] as RouteProfile[]) {
      const chair = routeOnGraph(g!, ll(c.a), ll(c.b), profile);
      soft(t, chair.ok, `${profile}: no step-free route (${!chair.ok && chair.reason})`);
      if (!chair.ok) continue;
      soft(t, chair.route_features.stairs === 0, `${profile}: route uses ${chair.route_features.stairs} stairway(s)`);
      soft(t, chair.distance_m > walk.distance_m, `${profile}: not longer than walking (${chair.distance_m} vs ${walk.distance_m} m)`);
    }
  });
}

test("real map: sample trip Santa Fe Depot -> Horton Plaza Park routes for all profiles, wheelchair without stairs", { skip: !HAVE_GRAPH && "no graph file" }, (t) => {
  const g = loadGraph()!;
  const a = { lat: 32.717246, lon: -117.169838 }, b = { lat: 32.715101, lon: -117.161538 };
  for (const profile of ["pedestrian", "wheelchair_preference", "avoid_stairs"] as RouteProfile[]) {
    const r = routeOnGraph(g, a, b, profile);
    soft(t, r.ok, `${profile}: ${!r.ok && r.reason}`);
    if (r.ok && profile !== "pedestrian") soft(t, r.route_features.stairs === 0, `${profile} used stairs`);
    if (r.ok) t.diagnostic(`${profile}: ${r.distance_m} m, features ${JSON.stringify(r.route_features)}`);
  }
});
