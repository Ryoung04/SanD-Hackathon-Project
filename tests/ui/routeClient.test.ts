import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseLatLon,
  requestRoute,
  groupNearby,
  formatDistance,
  formatDuration,
  type NearbyDetail,
  type RouteResult,
} from "../../src/lib/ui/routeClient";

const START = { lat: 32.7157, lon: -117.1611 };
const END = { lat: 32.72, lon: -117.15 };

/** Minimal observation fixture; cast because only id and verification_status matter for grouping. */
function obs(id: string, verification_status: string): any {
  return { id, category: "missing_curb_ramp", label: id, verification_status, routing_impact: "unknown", severity: "unknown" };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("parseLatLon accepts comma-separated lat, lon", () => {
  assert.deepEqual(parseLatLon("32.7157, -117.1611"), { lat: 32.7157, lon: -117.1611 });
});

test("parseLatLon accepts space-separated lat, lon", () => {
  assert.deepEqual(parseLatLon("32.7 -117.1"), { lat: 32.7, lon: -117.1 });
});

test("parseLatLon returns null for invalid input", () => {
  for (const bad of ["abc", "", "91,0", "0,181"]) {
    assert.equal(parseLatLon(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

test("requestRoute passes route_available JSON through and sends avoid_barrier_ids: []", async () => {
  const route: RouteResult = {
    status: "route_available",
    provider: "valhalla",
    route: { type: "LineString", coordinates: [[-117.1611, 32.7157], [-117.15, 32.72]] },
    distance_m: 1234,
    duration_s: 650,
    nearby_barriers: [],
    coverage_note: "test",
    verified_accessible: false,
  };
  let url = "";
  let body: any = null;
  const fake = (async (u: string, init: RequestInit) => {
    url = u;
    body = JSON.parse(String(init.body));
    return jsonResponse(route);
  }) as unknown as typeof fetch;

  const result = await requestRoute(START, END, "wheelchair_preference", fake);

  assert.deepEqual(result, route);
  assert.equal(url, "/api/route");
  assert.deepEqual(body.avoid_barrier_ids, []);
  assert.deepEqual(body.start, START);
  assert.deepEqual(body.end, END);
  assert.equal(body.profile, "wheelchair_preference");
});

test("requestRoute maps HTTP 400 error.message to unavailable reason", async () => {
  const fake = (async () => jsonResponse({ error: { message: "bad" } }, 400)) as unknown as typeof fetch;
  assert.deepEqual(await requestRoute(START, END, "pedestrian", fake), { status: "unavailable", reason: "bad" });
});

test("requestRoute falls back to HTTP status message when error body is not JSON", async () => {
  const fake = (async () => new Response("oops", { status: 500 })) as unknown as typeof fetch;
  assert.deepEqual(await requestRoute(START, END, "pedestrian", fake), {
    status: "unavailable",
    reason: "Route service error (HTTP 500)",
  });
});

test("requestRoute returns unavailable with provider reason on 200 unavailable", async () => {
  const fake = (async () =>
    jsonResponse({ status: "unavailable", reason: "No path within trip limit" })) as unknown as typeof fetch;
  assert.deepEqual(await requestRoute(START, END, "pedestrian", fake), {
    status: "unavailable",
    reason: "No path within trip limit",
  });
});

test("requestRoute treats a route with fewer than 2 coordinates as unavailable", async () => {
  const fake = (async () =>
    jsonResponse({
      status: "route_available",
      route: { type: "LineString", coordinates: [[-117.1611, 32.7157]] },
      distance_m: 0,
      duration_s: 0,
    })) as unknown as typeof fetch;
  const result = await requestRoute(START, END, "pedestrian", fake);
  assert.equal(result.status, "unavailable");
});

test("requestRoute returns unavailable when fetch throws", async () => {
  const fake = (async () => {
    throw new TypeError("network down");
  }) as unknown as typeof fetch;
  assert.deepEqual(await requestRoute(START, END, "pedestrian", fake), {
    status: "unavailable",
    reason: "Could not reach the route service",
  });
});

test("groupNearby buckets by evidence type and preserves order", () => {
  const observations = [
    obs("o1", "official_inventory"),
    obs("r1", "unverified_report"),
    obs("c1", "community_confirmed"),
    obs("a1", "ai_candidate"),
    obs("o2", "official_inventory"),
  ];
  const details: NearbyDetail[] = [
    { id: "o2", distance_m: 10, match_method: "x" },
    { id: "r1", distance_m: 20, match_method: "x" },
    { id: "o1", distance_m: 30, match_method: "x" },
    { id: "a1", distance_m: 40, match_method: "x" },
    { id: "c1", distance_m: 50, match_method: "x" },
  ];
  const g = groupNearby(details, observations);

  assert.deepEqual(g.official.map((i) => i.id), ["o2", "o1"]);
  assert.deepEqual(g.resident.map((i) => i.id), ["r1", "c1"]);
  assert.deepEqual(g.ai.map((i) => i.id), ["a1"]);
  assert.deepEqual(g.other, []);
  assert.equal(g.official[0].obs?.id, "o2");
  assert.equal(g.official[0].distance_m, 10);
});

test("groupNearby puts IDs without loaded observations into other with obs null", () => {
  const observations = [obs("o1", "official_inventory")];
  const details: NearbyDetail[] = [
    { id: "missing", distance_m: 5, match_method: "x" },
    { id: "o1", distance_m: 6, match_method: "x" },
  ];
  const g = groupNearby(details, observations);
  assert.deepEqual(g.other, [{ id: "missing", distance_m: 5, obs: null }]);
  assert.deepEqual(g.official.map((i) => i.id), ["o1"]);
});

test("formatDistance uses metres below 1000 and km with two decimals above", () => {
  assert.equal(formatDistance(880), "880 m");
  assert.equal(formatDistance(1234), "1.23 km");
});

test("formatDuration rounds to minutes with a minimum of 1", () => {
  assert.equal(formatDuration(650), "11 min");
  assert.equal(formatDuration(10), "1 min");
});
