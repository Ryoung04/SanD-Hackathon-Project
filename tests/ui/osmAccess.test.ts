import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyNode,
  classifyWay,
  overpassToAccess,
  overpassQuery,
} from "../../src/lib/map/osmAccess";

const RETRIEVED = "2026-11-14T00:00:00Z";
const BBOX = [-117.175, 32.712, -117.15, 32.73];

/** Wrap raw Overpass elements; the element shapes are exercised, not typed here. */
function run(elements: any[]) {
  return overpassToAccess({ elements }, BBOX, RETRIEVED);
}

test("classifyNode: highway=elevator -> elevator", () => {
  assert.equal(classifyNode({ highway: "elevator" }), "elevator");
});

test("classifyNode: elevator wins over crossing tags", () => {
  assert.equal(classifyNode({ highway: "elevator", crossing: "traffic_signals" }), "elevator");
  assert.equal(classifyNode({ highway: "elevator", barrier: "kerb", kerb: "lowered" }), "elevator");
});

test("classifyNode: barrier=kerb with lowered/flush/no -> kerb_lowered", () => {
  for (const kerb of ["lowered", "flush", "no"]) {
    assert.equal(classifyNode({ barrier: "kerb", kerb }), "kerb_lowered", `kerb=${kerb}`);
  }
});

test("classifyNode: kerb=raised/regular -> kerb_raised", () => {
  for (const kerb of ["raised", "regular"]) {
    assert.equal(classifyNode({ barrier: "kerb", kerb }), "kerb_raised", `kerb=${kerb}`);
  }
});

test("classifyNode: barrier=kerb with no kerb tag or kerb=rolled -> kerb_unknown", () => {
  assert.equal(classifyNode({ barrier: "kerb" }), "kerb_unknown");
  assert.equal(classifyNode({ barrier: "kerb", kerb: "rolled" }), "kerb_unknown");
});

test("classifyNode: highway=crossing -> crossing", () => {
  assert.equal(classifyNode({ highway: "crossing" }), "crossing");
});

test("classifyNode: unrelated tags -> null", () => {
  assert.equal(classifyNode({}), null);
  assert.equal(classifyNode({ amenity: "bench" }), null);
  assert.equal(classifyNode({ highway: "bus_stop" }), null);
});

test("classifyWay: highway=steps -> steps", () => {
  assert.equal(classifyWay({ highway: "steps" }), "steps");
});

test("classifyWay: highway=pedestrian -> pedestrian_area", () => {
  assert.equal(classifyWay({ highway: "pedestrian" }), "pedestrian_area");
});

test("classifyWay: footway + footway=sidewalk -> sidewalk", () => {
  assert.equal(classifyWay({ highway: "footway", footway: "sidewalk" }), "sidewalk");
});

test("classifyWay: footway + footway=crossing -> crossing_line", () => {
  assert.equal(classifyWay({ highway: "footway", footway: "crossing" }), "crossing_line");
});

test("classifyWay: plain footway or path -> footway", () => {
  assert.equal(classifyWay({ highway: "footway" }), "footway");
  assert.equal(classifyWay({ highway: "path" }), "footway");
});

test("classifyWay: highway=residential -> null", () => {
  assert.equal(classifyWay({ highway: "residential" }), null);
});

test("overpassToAccess: node becomes Point with coordinates [lon, lat] rounded to 6 dp", () => {
  const out = run([
    { type: "node", id: 1, lat: 32.7123456789, lon: -117.1612345678, tags: { barrier: "kerb", kerb: "lowered" } },
  ]);
  assert.equal(out.features.length, 1);
  const f = out.features[0];
  assert.equal(f.geometry.type, "Point");
  assert.deepEqual(f.geometry.coordinates, [-117.161235, 32.712346]);
  assert.equal(f.properties.kind, "kerb_lowered");
  assert.equal(f.properties.osm_id, "node/1");
});

test("overpassToAccess: way becomes LineString from geometry, osm_id way/2", () => {
  const out = run([
    {
      type: "way",
      id: 2,
      geometry: [
        { lat: 32.72, lon: -117.16 },
        { lat: 32.7201234567, lon: -117.1601234567 },
      ],
      tags: { highway: "footway", footway: "sidewalk" },
    },
  ]);
  assert.equal(out.features.length, 1);
  const f = out.features[0];
  assert.equal(f.geometry.type, "LineString");
  assert.deepEqual(f.geometry.coordinates, [
    [-117.16, 32.72],
    [-117.160123, 32.720123],
  ]);
  assert.equal(f.properties.kind, "sidewalk");
  assert.equal(f.properties.osm_id, "way/2");
});

test("overpassToAccess: skips ways with fewer than 2 geometry points or no geometry", () => {
  const out = run([
    { type: "way", id: 3, geometry: [{ lat: 32.72, lon: -117.16 }], tags: { highway: "steps" } },
    { type: "way", id: 4, tags: { highway: "steps" } },
  ]);
  assert.equal(out.features.length, 0);
});

test("overpassToAccess: skips unclassified nodes and ways", () => {
  const out = run([
    { type: "node", id: 5, lat: 32.72, lon: -117.16, tags: { amenity: "bench" } },
    { type: "node", id: 6, lat: 32.72, lon: -117.16 },
    {
      type: "way",
      id: 7,
      geometry: [
        { lat: 32.72, lon: -117.16 },
        { lat: 32.721, lon: -117.161 },
      ],
      tags: { highway: "residential" },
    },
  ]);
  assert.equal(out.features.length, 0);
});

test("overpassToAccess: missing tags give unknown for wheelchair/tactile/handrail/ramp/signals, never yes", () => {
  const out = run([
    { type: "node", id: 10, lat: 32.72, lon: -117.16, tags: { highway: "crossing" } },
    { type: "way", id: 11, geometry: [{ lat: 32.72, lon: -117.16 }, { lat: 32.721, lon: -117.161 }], tags: { highway: "steps" } },
  ]);
  assert.equal(out.features.length, 2);
  for (const f of out.features) {
    const p = f.properties;
    assert.equal(p.wheelchair, "unknown", `${p.osm_id} wheelchair`);
    assert.equal(p.tactile_paving, "unknown", `${p.osm_id} tactile_paving`);
    assert.equal(p.handrail, "unknown", `${p.osm_id} handrail`);
    assert.equal(p.ramp, "unknown", `${p.osm_id} ramp`);
    assert.equal(p.signals, "unknown", `${p.osm_id} signals`);
    assert.equal(p.step_count, null, `${p.osm_id} step_count`);
    assert.equal(p.surface, null);
    assert.equal(p.name, null);
  }
});

test("overpassToAccess: step_count '12' -> 12, 'abc' -> null", () => {
  const out = run([
    { type: "way", id: 20, geometry: [{ lat: 32.72, lon: -117.16 }, { lat: 32.721, lon: -117.161 }], tags: { highway: "steps", step_count: "12" } },
    { type: "way", id: 21, geometry: [{ lat: 32.72, lon: -117.16 }, { lat: 32.721, lon: -117.161 }], tags: { highway: "steps", step_count: "abc" } },
  ]);
  assert.equal(out.features[0].properties.step_count, 12);
  assert.equal(out.features[1].properties.step_count, null);
});

test("overpassToAccess: handrail:left=yes -> handrail yes", () => {
  const out = run([
    { type: "way", id: 30, geometry: [{ lat: 32.72, lon: -117.16 }, { lat: 32.721, lon: -117.161 }], tags: { highway: "steps", "handrail:left": "yes" } },
  ]);
  assert.equal(out.features[0].properties.handrail, "yes");
});

test("overpassToAccess: crossing=traffic_signals -> signals yes; crossing=unmarked -> signals no", () => {
  const out = run([
    { type: "node", id: 40, lat: 32.72, lon: -117.16, tags: { highway: "crossing", crossing: "traffic_signals" } },
    { type: "node", id: 41, lat: 32.72, lon: -117.16, tags: { highway: "crossing", crossing: "unmarked" } },
  ]);
  assert.equal(out.features[0].properties.signals, "yes");
  assert.equal(out.features[1].properties.signals, "no");
});

test("overpassToAccess: metadata carries ODbL license, unverified source, retrieved_at and bbox", () => {
  const out = run([]);
  assert.match(out.metadata.license, /ODbL/);
  assert.match(out.metadata.source, /unverified/);
  assert.equal(out.metadata.retrieved_at, RETRIEVED);
  assert.deepEqual(out.metadata.bbox, BBOX);
  assert.equal(out.type, "FeatureCollection");
  assert.deepEqual(out.features, []);
});

test("overpassQuery: contains 'out geom'", () => {
  assert.match(overpassQuery(BBOX), /out geom/);
});

test("overpassQuery: bbox [w,s,e,n] is emitted as (south,west,north,east)", () => {
  const q = overpassQuery([-117.175, 32.712, -117.15, 32.73]);
  assert.ok(q.includes("(32.712,-117.175,32.73,-117.15)"), "bbox string in (s,w,n,e) order");
});

test("classifyWay: ramp only when explicitly tagged ramp or non-flat incline; untagged is not assumed flat or ramp", () => {
  assert.equal(classifyWay({ highway: "footway", ramp: "yes" }), "ramp");
  assert.equal(classifyWay({ highway: "footway", footway: "sidewalk", incline: "6%" }), "ramp");
  assert.equal(classifyWay({ highway: "path", incline: "up" }), "ramp");
  assert.equal(classifyWay({ highway: "footway", footway: "sidewalk", incline: "0%" }), "sidewalk");
  assert.equal(classifyWay({ highway: "footway", footway: "sidewalk" }), "sidewalk");
  assert.equal(classifyWay({ highway: "steps", ramp: "yes" }), "steps");
});
