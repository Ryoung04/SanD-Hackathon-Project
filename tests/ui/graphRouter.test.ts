import { test } from "node:test";
import assert from "node:assert/strict";
import { prepareGraph, routeOnGraph, PROFILES } from "../../src/lib/routing/graphRouter";
import { buildGraph, classifyGraphWay, visibilityPairs, type OverpassEl, type RoutingGraph, type WayKind } from "../../src/lib/routing/graphBuild";

// Tiny synthetic graphs in downtown coordinates. ~1e-4 deg ≈ 9-11 m.
const O = { lon: -117.16, lat: 32.715 };
const P = (x: number, y: number): [number, number] => [O.lon + x * 1e-4, O.lat + y * 1e-4];
const at = (x: number, y: number) => ({ lon: O.lon + x * 1e-4, lat: O.lat + y * 1e-4 });

function graph(nodes: [number, number][], ways: { kind: WayKind; path: number[]; name?: string; wheelchair?: "no" }[], kerbs: RoutingGraph["kerbs"] = {}, slopes?: Record<number, number>) {
  const g: RoutingGraph & { edge_slope?: (number | null)[] } = {
    meta: { source: "test", license: "", retrieved_at: "", bbox: [], slope_source: null, counts: {} },
    nodes: nodes.map(([x, y]) => P(x, y)), node_ids: nodes.map((_, i) => i), kerbs, ways: [], edges: [],
  };
  ways.forEach((w, wi) => {
    g.ways.push({ osm_id: `way/${wi}`, kind: w.kind, name: w.name ?? null, step_count: w.kind === "steps" ? 10 : null, wheelchair: w.wheelchair ?? "unknown", surface: null, incline: null });
    for (let i = 1; i < w.path.length; i++) {
      const a = w.path[i - 1], b = w.path[i];
      const [ax, ay] = nodes[a], [bx, by] = nodes[b];
      g.edges.push([a, b, Math.hypot((ax - bx) * 9.36, (ay - by) * 11.05), wi]);
    }
  });
  if (slopes) g.edge_slope = g.edges.map((_, i) => slopes[i] ?? null);
  return prepareGraph(g);
}
const kindsUsed = (g: ReturnType<typeof graph>, r: ReturnType<typeof routeOnGraph>) =>
  r.ok ? r.ways_used.map((id) => g.ways.find((w) => w.osm_id === id)!.kind) : [];

// Stairs shortcut A(0,0)->B(0,10) vs a sidewalk detour via (10,0),(10,10).
const STAIRS = graph(
  [[0, 0], [0, 10], [10, 0], [10, 10]],
  [{ kind: "steps", path: [0, 1] }, { kind: "sidewalk", path: [0, 2, 3, 1], name: "Detour St" }],
);

test("regular walking takes the stairs shortcut; wheelchair takes the step-free detour", () => {
  const walk = routeOnGraph(STAIRS, at(0, 0), at(0, 10), "pedestrian");
  const chair = routeOnGraph(STAIRS, at(0, 0), at(0, 10), "wheelchair_preference");
  assert.ok(walk.ok && chair.ok);
  assert.deepEqual(kindsUsed(STAIRS, walk), ["steps"]);
  assert.ok(!kindsUsed(STAIRS, chair).includes("steps"));
  assert.ok(chair.ok && walk.ok && chair.distance_m > walk.distance_m * 2, "detour is longer");
  assert.equal(walk.ok && walk.route_features.stairs, 1);
  assert.match(walk.ok ? walk.steps[0].instruction : "", /stairs \(10 steps\)/);
});

test("avoid_stairs also never uses stairs", () => {
  const r = routeOnGraph(STAIRS, at(0, 0), at(0, 10), "avoid_stairs");
  assert.ok(r.ok && !kindsUsed(STAIRS, r).includes("steps"));
});

test("wheelchair gets NO route when only stairs connect (never falls back to stairs)", () => {
  const g = graph([[0, 0], [0, 10], [0, 20]], [{ kind: "sidewalk", path: [0, 1] }, { kind: "steps", path: [1, 2] }]);
  const r = routeOnGraph(g, at(0, 0), at(0, 20), "wheelchair_preference");
  assert.ok(!r.ok && r.code === "NO_PATH" && /only by stairs/.test(r.reason), r.ok ? "routed" : r.reason);
  assert.ok(routeOnGraph(g, at(0, 0), at(0, 20), "pedestrian").ok);
});

test("open plaza: straight link across the area beats walking around its edge", () => {
  // Square plaza ring 0-1-2-3-0 (20x20); route from corner 0 to opposite corner 2.
  const els: OverpassEl[] = [
    ...[[0, 0], [20, 0], [20, 20], [0, 20]].map(([x, y], i) => ({ type: "node" as const, id: i + 1, lon: P(x, y)[0], lat: P(x, y)[1] })),
    { type: "way", id: 100, nodes: [1, 2, 3, 4, 1], tags: { highway: "pedestrian", area: "yes", name: "Test Plaza" } },
  ];
  const g = prepareGraph(buildGraph(els, [], ""));
  const r = routeOnGraph(g, at(0, 0), at(20, 20), "pedestrian");
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.ok(r.route_features.open_areas >= 1, "used a plaza link");
  // Units: 20 x 1e-4 deg ≈ 187 m east, 221 m north. Diagonal ≈ 290 m; around the edge ≈ 408 m.
  assert.ok(r.distance_m < 320, `diagonal ~290 m, got ${r.distance_m}`);
  assert.match(r.steps[0].instruction, /open plaza \(Test Plaza\)/);
});

test("building passage / corridor is used when it is the short way", () => {
  const g = graph(
    [[0, 0], [10, 0], [0, 30], [10, 30]],
    [{ kind: "passage", path: [0, 1], name: "Arcade" }, { kind: "sidewalk", path: [0, 2, 3, 1] }],
  );
  const r = routeOnGraph(g, at(0, 0), at(10, 0), "pedestrian");
  assert.ok(r.ok && r.route_features.passages === 1);
  assert.match(r.ok ? r.steps[0].instruction : "", /building passage \(Arcade\)/);
});

test("avoid_stairs refuses a raised curb; regular walking crosses it", () => {
  // Crossing via node 1 (raised kerb) vs a longer path via node 3.
  const g = graph(
    [[0, 0], [5, 0], [10, 0], [5, 15]],
    [{ kind: "crossing", path: [0, 1, 2] }, { kind: "sidewalk", path: [0, 3, 2] }],
    { 1: "raised" },
  );
  const walk = routeOnGraph(g, at(0, 0), at(10, 0), "pedestrian");
  const chair = routeOnGraph(g, at(0, 0), at(10, 0), "avoid_stairs");
  assert.ok(walk.ok && kindsUsed(g, walk).includes("crossing"));
  assert.ok(chair.ok && !kindsUsed(g, chair).includes("crossing"));
});

test("steep slope (>12%) is avoided by wheelchair profiles when a gentler way exists", () => {
  const g = graph([[0, 0], [0, 10], [10, 0], [10, 10]], [{ kind: "sidewalk", path: [0, 1] }, { kind: "sidewalk", path: [0, 2, 3, 1] }], {}, { 0: 15 });
  const walk = routeOnGraph(g, at(0, 0), at(0, 10), "pedestrian");
  const chair = routeOnGraph(g, at(0, 0), at(0, 10), "wheelchair_preference");
  assert.ok(walk.ok && chair.ok && chair.distance_m > walk.distance_m);
});

test("wheelchair=no ways are blocked for wheelchair profiles", () => {
  const g = graph([[0, 0], [0, 10], [10, 0], [10, 10]], [{ kind: "footway", path: [0, 1], wheelchair: "no" }, { kind: "sidewalk", path: [0, 2, 3, 1] }]);
  const chair = routeOnGraph(g, at(0, 0), at(0, 10), "wheelchair_preference");
  assert.ok(chair.ok && chair.ways_used.length === 1 && chair.ways_used[0] === "way/1");
});

test("snap fails far from the network", () => {
  const r = routeOnGraph(STAIRS, at(0, 0), at(500, 500), "pedestrian");
  assert.ok(!r.ok && r.code === "SNAP_FAILED");
});

test("classifyGraphWay basics", () => {
  assert.equal(classifyGraphWay({ highway: "steps" }), "steps");
  assert.equal(classifyGraphWay({ highway: "footway", tunnel: "building_passage" }), "passage");
  assert.equal(classifyGraphWay({ highway: "corridor" }), "corridor");
  assert.equal(classifyGraphWay({ highway: "residential", sidewalk: "separate" }), "road_separate");
  assert.equal(classifyGraphWay({ highway: "residential" }), "road_unknown");
  assert.equal(classifyGraphWay({ highway: "footway", access: "private" }), null);
  assert.equal(classifyGraphWay({ highway: "motorway" }), null);
});

test("visibilityPairs: square has both diagonals; an L-shape blocks the outside chord", () => {
  const sq: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
  assert.deepEqual(visibilityPairs(sq).sort(), [[0, 2], [1, 3]]);
  // L-shape: (0,0)(2,0)(2,1)(1,1)(1,2)(0,2). Chord from (2,1)[2] to (1,2)[4] passes outside.
  const L: [number, number][] = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2], [0, 0]];
  assert.ok(!visibilityPairs(L).some(([i, j]) => i === 2 && j === 4));
});

test("profile table: wheelchair profiles block steps", () => {
  assert.equal(PROFILES.wheelchair_preference.kind.steps, Infinity);
  assert.equal(PROFILES.avoid_stairs.kind.steps, Infinity);
  assert.ok(Number.isFinite(PROFILES.pedestrian.kind.steps));
});

// ---------- planRoute (router selection) ----------
import { planRoute } from "../../src/lib/routing/planRoute";

const valhallaCalls = () => {
  const calls: string[] = [];
  const f = (async (url: string) => { calls.push(String(url)); return new Response(JSON.stringify({ error: "offline in test" }), { status: 500 }); }) as unknown as typeof fetch;
  return { calls, f };
};

test("planRoute auto: graph result is used without calling Valhalla", async () => {
  const v = valhallaCalls();
  const r = await planRoute({ start: at(0, 0), end: at(0, 10), profile: "pedestrian" }, "auto", v.f, () => STAIRS);
  assert.ok(r.ok && r.provider === "accesspath-osm-graph" && r.route_features?.stairs === 1);
  assert.equal(v.calls.length, 0);
});

test("planRoute auto: wheelchair 'no step-free route' is final (never falls back to a router that may use stairs)", async () => {
  const g = graph([[0, 0], [0, 10], [0, 20]], [{ kind: "sidewalk", path: [0, 1] }, { kind: "steps", path: [1, 2] }]);
  const v = valhallaCalls();
  const r = await planRoute({ start: at(0, 0), end: at(0, 20), profile: "wheelchair_preference" }, "auto", v.f, () => g);
  assert.ok(!r.ok);
  assert.equal(v.calls.length, 0, "Valhalla must not be called");
});

test("planRoute auto: missing graph falls back to Valhalla and says why", async () => {
  const v = valhallaCalls();
  const r = await planRoute({ start: at(0, 0), end: at(0, 10), profile: "pedestrian" }, "auto", v.f, () => null);
  assert.equal(v.calls.length, 1);
  assert.ok(!r.ok && /graph not available/.test(r.reason) && /fallback also failed/.test(r.reason));
});

test("planRoute graph-only: off-network point fails without Valhalla", async () => {
  const v = valhallaCalls();
  const r = await planRoute({ start: at(0, 0), end: at(900, 900), profile: "pedestrian" }, "graph", v.f, () => STAIRS);
  assert.ok(!r.ok && v.calls.length === 0);
});

// ---------- regression: router must not prefer walking in the road ----------
// Layout (x east, y north; 1 unit ≈ 9-11 m):
//   sidewalk  (0,1) ------------------------------- (40,1)
//               |  crossing                             | crossing
//   road      (0,0) ------------------------------- (40,0)   <- centerline, tagged sidewalk=both
// The sidewalk bends away (setback) so it is ~15% longer than walking down the road; walking the
// road means walking in the street. This reproduced the bug (road_sidewalk cost was 1.1x).
const ROADSIDE = graph(
  [[0, 0], [40, 0], [0, 1], [40, 1], [20, 12]], // sidewalk bends out to (20,12): ~1.15x the road length
  [
    { kind: "road_sidewalk", path: [0, 1], name: "State Street" },
    { kind: "sidewalk", path: [2, 4, 3] },
    { kind: "crossing", path: [0, 2] },
    { kind: "crossing", path: [1, 3] },
  ],
);

test("regression: walking prefers the mapped sidewalk over a parallel road centerline", () => {
  for (const profile of ["pedestrian", "wheelchair_preference", "avoid_stairs"] as const) {
    const r = routeOnGraph(ROADSIDE, at(0, 1), at(40, 1), profile);
    assert.ok(r.ok, profile);
    assert.deepEqual(kindsUsed(ROADSIDE, r), ["sidewalk"], `${profile} walked in the road`);
  }
});

test("regression: a point closer to the road centerline still snaps to the nearby sidewalk", () => {
  // Point at y=0.3 (~3 m from road, ~8 m from sidewalk).
  const r = routeOnGraph(ROADSIDE, at(5, 0.3), at(35, 0.3), "pedestrian");
  assert.ok(r.ok);
  assert.ok(!kindsUsed(ROADSIDE, r).includes("road_sidewalk"), `used: ${kindsUsed(ROADSIDE, r)}`);
});

test("regression: road with sidewalk=separate is avoided even when the sidewalk detour is 2x longer", () => {
  const g = graph(
    [[0, 0], [20, 0], [0, 10], [20, 10]],
    [{ kind: "road_separate", path: [0, 1] }, { kind: "sidewalk", path: [0, 2, 3, 1] }],
  );
  const r = routeOnGraph(g, at(0, 0), at(20, 0), "pedestrian");
  assert.ok(r.ok && !kindsUsed(g, r).includes("road_separate"));
});

test("roads are still usable as a last resort when no walkway exists", () => {
  const g = graph([[0, 0], [30, 0]], [{ kind: "road_unknown", path: [0, 1], name: "Alley" }]);
  const r = routeOnGraph(g, at(0, 0), at(30, 0), "pedestrian");
  assert.ok(r.ok && r.route_features.road_no_sidewalk_m > 0);
});

// ---------- two-pass road policy: roads only when no walkway-only route exists ----------
test("two-pass: wheelchair takes a very steep sidewalk rather than a flat parallel road", () => {
  // Steep sidewalk (edge 0, 15%) vs flat road. Slope cost (x5/x10) must never be traded for road.
  const g = graph(
    [[0, 1], [30, 1], [0, 0], [30, 0]],
    [{ kind: "sidewalk", path: [0, 1] }, { kind: "road_sidewalk", path: [2, 3] }, { kind: "crossing", path: [0, 2] }, { kind: "crossing", path: [1, 3] }],
    {}, { 0: 15 },
  );
  for (const profile of ["wheelchair_preference", "avoid_stairs"] as const) {
    const r = routeOnGraph(g, at(0, 1), at(30, 1), profile);
    assert.ok(r.ok && r.road_policy === "walkways_only", profile);
    assert.ok(!kindsUsed(g, r).includes("road_sidewalk"), `${profile} used the road`);
  }
});

test("two-pass: a gentler walkway detour beats the steep sidewalk; the road is never used", () => {
  // Steep direct sidewalk (edge 0, 15%), gentle detour via (15,10), flat road below.
  const g = graph(
    [[0, 1], [30, 1], [15, 10], [0, 0], [30, 0]],
    [{ kind: "sidewalk", path: [0, 1] }, { kind: "footway", path: [0, 2, 1] }, { kind: "road_sidewalk", path: [3, 4] }, { kind: "crossing", path: [0, 3] }, { kind: "crossing", path: [1, 4] }],
    {}, { 0: 15 },
  );
  const r = routeOnGraph(g, at(0, 1), at(30, 1), "wheelchair_preference");
  assert.ok(r.ok && r.road_policy === "walkways_only");
  assert.deepEqual(kindsUsed(g, r), ["footway"]);
});

test("two-pass: road used only as last resort (e.g. a missing link) and reported with the reason", () => {
  // Sidewalks on both sides of a gap (think broken elevator); only a road bridges it.
  const g = graph(
    [[0, 1], [10, 1], [20, 1], [30, 1], [10, 0], [20, 0]],
    [{ kind: "sidewalk", path: [0, 1] }, { kind: "sidewalk", path: [2, 3] }, { kind: "road_unknown", path: [4, 5] }, { kind: "crossing", path: [1, 4] }, { kind: "crossing", path: [5, 2] }],
  );
  const r = routeOnGraph(g, at(0, 1), at(30, 1), "wheelchair_preference");
  assert.ok(r.ok && r.road_policy === "roads_last_resort", r.ok ? r.road_policy : r.reason);
  assert.ok(r.ok && /sidewalks and paths only/.test(r.road_reason ?? ""), r.ok ? String(r.road_reason) : "");
});

test("two-pass: last resort minimises road metres first, even if the whole route is longer", () => {
  // Option A: ~280 m of road, direct. Option B: ~700 m walkway detour with a ~19 m alley.
  const g = graph(
    [[0, 0], [30, 0], [0, 20], [14, 20], [16, 20], [30, 20]],
    [
      { kind: "road_sidewalk", path: [0, 1], name: "Long Road" },
      { kind: "sidewalk", path: [0, 2, 3] }, { kind: "service", path: [3, 4], name: "Short Alley" }, { kind: "sidewalk", path: [4, 5, 1] },
    ],
  );
  const r = routeOnGraph(g, at(0, 0), at(30, 0), "pedestrian");
  assert.ok(r.ok && r.road_policy === "roads_last_resort");
  assert.ok(r.ok && !kindsUsed(g, r).includes("road_sidewalk"), `used ${kindsUsed(g, r)}`);
  assert.ok(r.ok && r.route_features.road_no_sidewalk_m + r.route_features.road_with_sidewalk_m < 25);
});

test("two-pass: wheelchair stairs-only link is bridged by road as a last resort, never by stairs", () => {
  const g = graph(
    [[0, 1], [10, 1], [20, 1], [10, 0], [20, 0]],
    [{ kind: "sidewalk", path: [0, 1] }, { kind: "steps", path: [1, 2] }, { kind: "road_unknown", path: [3, 4] }, { kind: "crossing", path: [1, 3] }, { kind: "crossing", path: [4, 2] }],
  );
  const walk = routeOnGraph(g, at(0, 1), at(20, 1), "pedestrian");
  assert.ok(walk.ok && walk.road_policy === "walkways_only" && kindsUsed(g, walk).includes("steps"));
  const chair = routeOnGraph(g, at(0, 1), at(20, 1), "avoid_stairs");
  assert.ok(chair.ok && chair.road_policy === "roads_last_resort" && !kindsUsed(g, chair).includes("steps"));
});
