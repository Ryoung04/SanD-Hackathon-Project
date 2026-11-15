import { test } from "node:test";
import assert from "node:assert/strict";
import { routeContext, distanceToRoute, CONTEXT_RULES } from "../../src/lib/map/routeContext";
import { normalizeAccessFeature, type AccessFeatureV1 } from "../../src/lib/map/accessContract";

// Route: straight east-west line along lat 32.715 (~93 m long).
const ROUTE: [number, number][] = [[-117.1610, 32.7150], [-117.1600, 32.7150]];
const D = 1 / 110_540; // ~1 m of latitude in degrees

const pt = (id: string, kind: string, lat: number, lon = -117.1605, extra: any = {}): AccessFeatureV1 =>
  normalizeAccessFeature({ type: "Feature", id, geometry: { type: "Point", coordinates: [lon, lat] }, properties: { kind, ...extra } }, id)!;
const line = (id: string, kind: string, coords: [number, number][], extra: any = {}): AccessFeatureV1 =>
  normalizeAccessFeature({ type: "Feature", id, geometry: { type: "LineString", coordinates: coords }, properties: { kind, ...extra } }, id)!;

test("distanceToRoute: point ~5 m off the line", () => {
  const { d } = distanceToRoute({ type: "Point", coordinates: [-117.1605, 32.7150 + 5 * D] }, ROUTE);
  assert.ok(Math.abs(d - 5) < 0.3, String(d));
});

test("distanceToRoute: a line crossing the route between its vertices has ~0 distance", () => {
  const { d } = distanceToRoute({ type: "LineString", coordinates: [[-117.1605, 32.7150 - 20 * D], [-117.1605, 32.7150 + 20 * D]] }, ROUTE);
  assert.ok(d < 0.5, String(d));
});

test("routeContext: groups by rule, respects radius, sorts by distance, skips far features", () => {
  const feats = [
    line("stairs-cross", "steps", [[-117.1606, 32.7150 - 15 * D], [-117.1606, 32.7150 + 15 * D]], { step_count: 12 }),
    pt("raised-near", "kerb_raised", 32.7150 + 4 * D),
    pt("raised-far", "kerb_raised", 32.7150 + 30 * D),
    pt("ramp2", "kerb_lowered", 32.7150 + 6 * D),
    pt("ramp1", "kerb_lowered", 32.7150 + 2 * D),
    line("steep", "slope_segment", [[-117.1609, 32.7150], [-117.1608, 32.7150]], { slope_pct: 10, method: "ai_estimate" }),
    pt("gentle", "slope_segment", 32.7150, -117.1601, { slope_pct: 3 }),
    pt("crossing", "crossing", 32.7150),
  ];
  const g = Object.fromEntries(routeContext(ROUTE, feats).map((x) => [x.key, x]));
  assert.deepEqual(Object.keys(g), ["stairs", "steep", "raised_kerb", "curb_ramp"]);
  assert.equal(g.stairs.hits[0].step_count, 12);
  assert.deepEqual(g.raised_kerb.hits.map((h) => h.id), ["raised-near"]);
  assert.deepEqual(g.curb_ramp.hits.map((h) => h.id), ["ramp1", "ramp2"]);
  assert.equal(g.steep.hits[0].method, "ai_estimate");
  assert.equal(g.stairs.tone, "caution");
  assert.equal(g.curb_ramp.tone, "info");
});

test("routeContext: empty for a degenerate route; every rule has a positive radius", () => {
  assert.deepEqual(routeContext([[-117.16, 32.715]], [pt("a", "steps", 32.715)]), []);
  for (const r of CONTEXT_RULES) assert.ok(r.radiusM > 0, r.key);
});
