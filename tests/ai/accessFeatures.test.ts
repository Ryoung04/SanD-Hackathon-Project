import { test, vi } from "vitest";
import assert from "node:assert/strict";
import { buildAccessFeatures } from "@/lib/map/accessFeatures";
import { normalizeAccessFeature } from "@/lib/map/accessContract";
import { noForbiddenClaim } from "@/lib/ai/validate";
import type { ImageryCheck } from "@/lib/ai/imageryChecks";
import type { BarrierObservation, Bbox } from "@/lib/data/types";

vi.mock("@/lib/data/observations", () => ({ listObservations: vi.fn(async () => ({ data: [], data_mode: "live_import" })) }));
vi.mock("@/lib/ai/imageryChecks", () => ({ readImageryChecks: vi.fn(() => ({ updated_at: null, checks: {} })) }));

const BBOX: Bbox = [-117.175, 32.705, -117.135, 32.735];
const obs = (id: string, lon: number, lat: number) => ({ id, geometry: { type: "Point", coordinates: [lon, lat] } }) as unknown as BarrierObservation;
const check = (id: string, vis: ImageryCheck["curb_ramp_visibility"], extra: Partial<ImageryCheck> = {}): ImageryCheck => ({
  barrier_id: id, checked_at: "2026-11-01T00:00:00Z", status: "analyzed",
  image: { reference: "r", page_url: "https://www.mapillary.com/app/?pKey=1", captured_at: "2022-05-01", license: "CC BY-SA 4.0", attribution: "a", distance_m: 5, heading_off_deg: null },
  curb_ramp_visibility: vis, no_clear_evidence: null, candidates: [], observation_ids: [], image_quality_notes: null, model: "gemini-test", error: null,
  photo_votes: { total: 4, visible: 3, not_visible: 0, cant_tell: 1, ramps_seen_max: 2, no_ramp_corners_max: 0, years: ["2019", "2023"],
    photos: [
      { page_url: "https://www.mapillary.com/app/?pKey=a", captured_at: "2023-03-02", pano: false, verdict: "visible" },
      { page_url: "https://www.mapillary.com/app/?pKey=b", captured_at: "2019-03-02", pano: false, verdict: "visible" },
      { page_url: "http://insecure.example/c", captured_at: "2021-01-01", pano: false, verdict: "visible" },
      { page_url: "https://www.mapillary.com/app/?pKey=d", captured_at: "2020-01-01", pano: false, verdict: "cant_tell" },
    ] },
  ...extra,
});

const checks = {
  a: check("a", "visibly_present"),
  b: check("b", "not_visible"),
  c: check("c", "not_determinable"),
  d: check("d", "visibly_present", { status: "error" }),
  e: check("e", "visibly_present"),
};
const observations = [obs("a", -117.16, 32.72), obs("b", -117.16, 32.72), obs("c", -117.16, 32.72), obs("d", -117.16, 32.72), obs("e", -118, 33)];

test("only visibly_present analyzed checks inside bbox are emitted", () => {
  const r = buildAccessFeatures(checks, observations, BBOX);
  assert.deepEqual(r.data.map((f) => f.id), ["c-curbramp/a"]);
  assert.equal(r.meta.count, 1);
  assert.equal(buildAccessFeatures(checks, observations, [-117.0, 32.0, -116.9, 32.1]).data.length, 0);
});

test("passes B's adapter with honest provenance", () => {
  const r = buildAccessFeatures(checks, observations, BBOX);
  const f = normalizeAccessFeature(r.data[0], "x")!;
  assert.equal(f.properties.kind, "curb_ramp");
  const p = f.properties.provenance;
  assert.equal(p.method, "ai_estimate");
  assert.equal(p.verification_status, "ai_candidate");
  assert.equal(p.confidence, "medium");
  assert.equal(p.source_date, "2023-03-02");
  assert.equal(p.source_url, "https://www.mapillary.com/app/?pKey=a");
  assert.match(p.note!, /3 of 4/);
  assert.equal(f.properties.detail.slope_pct, null);
  assert.equal(f.properties.detail.width_m, null);
  assert.equal(f.properties.detail.handrail, "unknown");
});

test("no forbidden claims; links only https", () => {
  const r = buildAccessFeatures(checks, observations, BBOX);
  const text = JSON.stringify(r.data[0].properties.provenance) + r.meta.source_note;
  assert.ok(noForbiddenClaim(text));
  const urls = text.match(/https?:\/\/[^"\s]+/g) ?? [];
  assert.ok(urls.length > 0 && urls.every((u) => u.startsWith("https://")));
  assert.ok(!text.includes("insecure.example"));
});

test("route: bad bbox -> 400 INVALID_BBOX; good bbox -> contract response", async () => {
  const { GET } = await import("@/app/api/access-features/route");
  const bad = await GET(new Request("http://x/api/access-features?bbox=nope"));
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error.code, "INVALID_BBOX");
  const ok = await GET(new Request("http://x/api/access-features?bbox=-117.175,32.705,-117.135,32.735"));
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.meta.contract_version, "1");
  assert.deepEqual(body.data, []);
});
