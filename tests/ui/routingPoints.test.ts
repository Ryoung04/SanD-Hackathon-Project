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

// Regression (road walking): before the fix this trip walked 267 m down the State Street
// centerline although its sidewalk is mapped; 80% of random routes used roads.
test("real map: 9th Ave/Broadway area -> State St trip does not walk down the road centerline", { skip: !HAVE_GRAPH && "no graph file" }, (t) => {
  const g = loadGraph()!;
  const r = routeOnGraph(g, { lon: -117.156766, lat: 32.721589 }, { lon: -117.166767, lat: 32.725537 }, "pedestrian");
  soft(t, r.ok, `no route: ${!r.ok && r.reason}`);
  if (!r.ok) return;
  const road = r.route_features.road_with_sidewalk_m + r.route_features.road_no_sidewalk_m;
  t.diagnostic(`${r.distance_m} m total, ${road} m on road centerlines`);
  soft(t, road < 100, `walks ${road} m on road centerlines`);
});

test("real map: across 100 fixed random trips, under 10% of walking distance is on road centerlines", { skip: !HAVE_GRAPH && "no graph file" }, (t) => {
  const g = loadGraph()!;
  const [w, s, e, n] = [-117.175, 32.712, -117.15, 32.73];
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let total = 0, road = 0;
  for (let i = 0; i < 100; i++) {
    const a = { lon: w + rnd() * (e - w), lat: s + rnd() * (n - s) }, b = { lon: w + rnd() * (e - w), lat: s + rnd() * (n - s) };
    const r = routeOnGraph(g, a, b, "pedestrian");
    if (!r.ok) continue;
    total += r.distance_m;
    road += r.route_features.road_with_sidewalk_m + r.route_features.road_no_sidewalk_m;
  }
  const pct = (100 * road) / Math.max(1, total);
  t.diagnostic(`road share ${pct.toFixed(1)}% of ${total} m (remaining use is mostly streets whose sidewalks aren't mapped in OSM)`);
  soft(t, pct < 10, `road share ${pct.toFixed(1)}%`);
});
