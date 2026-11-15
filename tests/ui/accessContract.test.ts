import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { normalizeAccessFeature, fromOsm, toMapProps, mergeById, slopeBand, parseIncline } from "../../src/lib/map/accessContract";
import { fetchAccessFeatures } from "../../src/lib/map/accessClient";
import { inferRampCandidates, type AccessFeature } from "../../src/lib/map/osmAccess";

const sample = JSON.parse(fs.readFileSync("docs/samples/access_features_v1.json", "utf8"));

test("sample: nested detail/provenance and flat aliased fields both normalize", () => {
  const [a, b] = sample.data.map((r: any, i: number) => normalizeAccessFeature(r, `x${i}`)!);
  assert.equal(a.properties.kind, "slope_segment");
  assert.equal(a.properties.detail.slope_pct, 7.4);
  assert.equal(a.properties.provenance.method, "ai_estimate");
  assert.equal(b.properties.kind, "curb_ramp");
  assert.ok(Math.abs(b.properties.detail.slope_pct! - 8.1) < 1e-9, "slope_ratio x100");
  assert.ok(Math.abs(b.properties.detail.width_m! - 1.2192) < 1e-9, "width_in -> m");
  assert.equal(b.properties.detail.tactile_paving, "yes");
  assert.equal(b.properties.provenance.source_date, "2024-06-30");
  assert.equal(b.properties.detail.ramp_type, "curb_ramp");
});

test("missing values stay unknown/null, never assumed accessible", () => {
  const f = normalizeAccessFeature({ type: "Feature", geometry: { type: "Point", coordinates: [-117.16, 32.72] }, properties: {} }, "z")!;
  assert.equal(f.properties.kind, "other");
  assert.equal(f.properties.detail.slope_pct, null);
  assert.equal(f.properties.detail.wheelchair, "unknown");
  assert.equal(f.properties.provenance.verification_status, "unknown");
  assert.equal(f.properties.provenance.source_date, null);
  assert.equal(toMapProps(f).slope_band, "unknown");
});

test("AI estimate cannot claim official_inventory", () => {
  const f = normalizeAccessFeature({ type: "Feature", geometry: { type: "Point", coordinates: [0, 0] }, properties: { method: "gemini", verification_status: "official_inventory" } }, "z")!;
  assert.equal(f.properties.provenance.method, "ai_estimate");
  assert.equal(f.properties.provenance.verification_status, "ai_candidate");
});

test("bad geometry is dropped", () => {
  assert.equal(normalizeAccessFeature({ geometry: { type: "Polygon", coordinates: [] } }, "z"), null);
  assert.equal(normalizeAccessFeature({ geometry: { type: "Point", coordinates: ["a", 1] } }, "z"), null);
});

test("slope bands and incline parsing", () => {
  assert.equal(slopeBand(null), "unknown");
  assert.equal(slopeBand(1), "level");
  assert.equal(slopeBand(-4), "gentle");
  assert.equal(slopeBand(8.33), "moderate");
  assert.equal(slopeBand(10), "steep");
  assert.equal(slopeBand(20), "very_steep");
  assert.equal(parseIncline("6%"), 6);
  assert.equal(parseIncline("-3%"), 3);
  assert.equal(parseIncline("up"), null);
  assert.ok(Math.abs(parseIncline("5°")! - 8.75) < 0.01);
});

test("estimated values get a ~ label; measured do not", () => {
  const [a, b] = sample.data.map((r: any, i: number) => toMapProps(normalizeAccessFeature(r, `x${i}`)!));
  assert.equal(a.slope_label, "~7.4%");
  assert.equal(a.estimated, 1);
  assert.equal(b.slope_label, "8.1%");
  assert.equal(b.estimated, 0);
});

const osmPt = (id: string, kind: any, coords: [number, number], extra: any = {}): AccessFeature => ({
  type: "Feature", geometry: { type: "Point", coordinates: coords },
  properties: { kind, osm_id: id, wheelchair: "unknown", tactile_paving: "unknown", surface: null, step_count: null, handrail: "unknown", ramp: "unknown", signals: "unknown", incline: null, name: null, ...extra },
});

test("fromOsm: community tag is unverified; inferred candidate is low confidence", () => {
  const k = fromOsm(osmPt("node/1", "kerb_lowered", [-117.16, 32.72]), "2026-11-14");
  assert.equal(k.properties.provenance.verification_status, "unverified_report");
  assert.equal(k.properties.detail.ramp_type, "curb_ramp");
  const c = fromOsm(osmPt("node/2", "ramp_candidate", [-117.16, 32.72], { reason: "r" }), null);
  assert.equal(c.properties.provenance.method, "inferred");
  assert.equal(c.properties.provenance.confidence, "low");
  assert.equal(c.id, "node/2#candidate");
});

test("inferRampCandidates: tactile crossing without nearby kerb becomes a candidate; with a kerb it does not", () => {
  const far = osmPt("node/10", "crossing", [-117.16, 32.72], { tactile_paving: "yes" });
  const near = osmPt("node/11", "crossing", [-117.17, 32.72], { tactile_paving: "yes" });
  const kerb = osmPt("node/12", "kerb_lowered", [-117.17003, 32.72]); // ~3 m away
  const out = inferRampCandidates([far, near, kerb]);
  assert.deepEqual(out.map((f) => f.properties.osm_id), ["node/10"]);
  assert.equal(out[0].properties.kind, "ramp_candidate");
});

test("mergeById: API replaces same id, appends new", () => {
  const base = [fromOsm(osmPt("way/123456789", "sidewalk", [0, 0]), null), fromOsm(osmPt("node/5", "crossing", [0, 0]), null)];
  const api = sample.data.map((r: any, i: number) => normalizeAccessFeature(r, `x${i}`)!);
  const m = mergeById(base, api);
  assert.equal(m.length, 4);
  assert.equal(m[0].properties.origin, "api");
  assert.equal(m[0].properties.detail.surface, "brick");
});

test("fetchAccessFeatures: 404 is NOT_DEPLOYED; sample body parses; version mismatch warns", async () => {
  const mk = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  const r404 = await fetchAccessFeatures([0, 0, 1, 1], mk(404, {}));
  assert.equal(r404.ok, false);
  assert.equal(!r404.ok && r404.code, "NOT_DEPLOYED");
  const ok = await fetchAccessFeatures([0, 0, 1, 1], mk(200, sample));
  assert.ok(ok.ok && ok.features.length === 3 && ok.versionWarning === null);
  const v2 = await fetchAccessFeatures([0, 0, 1, 1], mk(200, { ...sample, meta: { contract_version: "2" } }));
  assert.ok(v2.ok && v2.versionWarning);
  const net = await fetchAccessFeatures([0, 0, 1, 1], (async () => { throw new Error("offline"); }) as unknown as typeof fetch);
  assert.equal(net.ok, false);
});
