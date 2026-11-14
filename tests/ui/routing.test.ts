import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decodePolyline,
  parseRouteRequest,
  buildValhallaBody,
  parseValhalla,
  fetchRoute,
  MAX_TRIP_M,
  type RouteRequest,
} from "../../src/lib/routing/provider";

const TOL = 1e-6;

function assertCoordsClose(actual: [number, number][], expected: [number, number][]) {
  assert.equal(actual.length, expected.length, "coordinate count");
  actual.forEach(([lon, lat], i) => {
    assert.ok(Math.abs(lon - expected[i][0]) <= TOL, `lon[${i}] ${lon} != ${expected[i][0]}`);
    assert.ok(Math.abs(lat - expected[i][1]) <= TOL, `lat[${i}] ${lat} != ${expected[i][1]}`);
  });
}

/** Minimal Google-style polyline encoder (precision 6) for building test fixtures. Input is [lon, lat]. */
function encodeInt(n: number): string {
  let v = n < 0 ? ~(n << 1) : n << 1;
  let out = "";
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  return out + String.fromCharCode(v + 63);
}

function encodePrecision6(pts: [number, number][]): string {
  let prevLat = 0;
  let prevLon = 0;
  let out = "";
  for (const [lon, lat] of pts) {
    const iLat = Math.round(lat * 1e6);
    const iLon = Math.round(lon * 1e6);
    out += encodeInt(iLat - prevLat) + encodeInt(iLon - prevLon);
    prevLat = iLat;
    prevLon = iLon;
  }
  return out;
}

const SF = { lat: 32.7157, lon: -117.1611 };
const NEAR = { lat: 32.7203, lon: -117.1550 };
const FAR = { lat: 33.5, lon: -117.1611 }; // ~89 km north of SF

// ---------- decodePolyline ----------

test("decodePolyline decodes the classic precision-5 example", () => {
  const out = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@", 5);
  assertCoordsClose(out, [
    [-120.2, 38.5],
    [-120.95, 40.7],
    [-126.453, 43.252],
  ]);
});

test("decodePolyline round-trips precision-6 input", () => {
  const pts: [number, number][] = [
    [-117.1611, 32.7157],
    [-117.1550, 32.7203],
    [-117.1500, 32.7250],
  ];
  assertCoordsClose(decodePolyline(encodePrecision6(pts), 6), pts);
});

// ---------- parseRouteRequest ----------

test("parseRouteRequest accepts a valid body and defaults profile to wheelchair_preference", () => {
  const r = parseRouteRequest({ start: SF, end: NEAR });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.req.profile, "wheelchair_preference");
  assert.deepEqual(r.req.start, { lat: SF.lat, lon: SF.lon });
  assert.deepEqual(r.req.end, { lat: NEAR.lat, lon: NEAR.lon });
});

test("parseRouteRequest accepts an explicit pedestrian profile", () => {
  const r = parseRouteRequest({ start: SF, end: NEAR, profile: "pedestrian" });
  assert.equal(r.ok && r.req.profile, "pedestrian");
});

test("parseRouteRequest rejects missing or non-numeric coordinates", () => {
  assert.equal(parseRouteRequest({ end: NEAR }).ok, false);
  assert.equal(parseRouteRequest({ start: SF }).ok, false);
  assert.equal(parseRouteRequest({ start: { lat: NaN, lon: -117 }, end: NEAR }).ok, false);
  assert.equal(parseRouteRequest({ start: SF, end: { lat: 32.7, lon: "x" } }).ok, false);
  assert.equal(parseRouteRequest({ start: { lat: 91, lon: 0 }, end: NEAR }).ok, false);
  assert.equal(parseRouteRequest(null).ok, false);
});

test("parseRouteRequest rejects an unknown profile", () => {
  const r = parseRouteRequest({ start: SF, end: NEAR, profile: "driving" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.message, /profile must be/);
});

test("parseRouteRequest rejects trips longer than MAX_TRIP_M", () => {
  const r = parseRouteRequest({ start: SF, end: FAR });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.message, /Trip longer than/);
  assert.equal(MAX_TRIP_M, 15_000);
});

// ---------- buildValhallaBody ----------

const baseReq = (profile: RouteRequest["profile"]): RouteRequest => ({ start: SF, end: NEAR, profile });

test("buildValhallaBody sets wheelchair type for wheelchair_preference", () => {
  const body = buildValhallaBody(baseReq("wheelchair_preference"));
  assert.equal(body.costing, "pedestrian");
  assert.equal((body.costing_options.pedestrian as any).type, "wheelchair");
  assert.equal(body.locations.length, 2);
});

test("buildValhallaBody does not set wheelchair type for pedestrian", () => {
  const body = buildValhallaBody(baseReq("pedestrian"));
  assert.equal((body.costing_options.pedestrian as any).type, undefined);
  assert.deepEqual(body.costing_options.pedestrian, {});
});

// ---------- parseValhalla ----------

test("parseValhalla joins two legs without duplicating the joint point", () => {
  const legA: [number, number][] = [
    [-117.1611, 32.7157],
    [-117.1580, 32.7180],
  ];
  const legB: [number, number][] = [
    [-117.1580, 32.7180], // shared joint point
    [-117.1550, 32.7203],
  ];
  const res = parseValhalla({
    trip: {
      summary: { length: 0.88, time: 650 },
      legs: [{ shape: encodePrecision6(legA) }, { shape: encodePrecision6(legB) }],
    },
  });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.provider, "valhalla");
  assert.equal(res.distance_m, 880);
  assert.equal(res.duration_s, 650);
  assert.equal(res.route.type, "LineString");
  assertCoordsClose(res.route.coordinates, [...legA, legB[1]]);
});

test("parseValhalla returns ok:false when trip is missing", () => {
  const res = parseValhalla({ error: "Something" });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, "Something");
  const res2 = parseValhalla({});
  assert.equal(res2.ok, false);
  assert.ok(!("route" in res2));
});

// ---------- fetchRoute ----------

const fakeFetchResponse = (status: number, body: unknown): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;

test("fetchRoute returns the provider error reason on HTTP 400", async () => {
  const res = await fetchRoute(baseReq("wheelchair_preference"), fakeFetchResponse(400, { error: "No path" }));
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, "No path");
  assert.ok(!("route" in res));
});

test("fetchRoute returns 'Provider unreachable' when fetch throws", async () => {
  const throwing = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
  const res = await fetchRoute(baseReq("pedestrian"), throwing);
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, "Provider unreachable");
  assert.ok(!("route" in res));
});

test("fetchRoute parses a successful response", async () => {
  const leg = [[-117.1611, 32.7157], [-117.1550, 32.7203]] as [number, number][];
  const res = await fetchRoute(
    baseReq("pedestrian"),
    fakeFetchResponse(200, { trip: { summary: { length: 1.5, time: 900 }, legs: [{ shape: encodePrecision6(leg) }] } }),
  );
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.distance_m, 1500);
    assert.equal(res.duration_s, 900);
  }
});
