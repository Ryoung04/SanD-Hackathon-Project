import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { quantizeBBox, bboxParam, loadBarriers, clearBarrierCache, filterBySource } from "../../src/lib/ui/barrierClient";
import type { BarriersResponse, BBox, SourceKind } from "../../src/lib/ui/barrierTypes";

const BBOX: BBox = [-117.168, 32.715, -117.152, 32.728];

const okBody = (): BarriersResponse => ({
  data: [],
  meta: { count: 0, bbox: BBOX, generated_at: "2026-11-14T00:00:00Z", data_mode: "live_import" },
});

function mockFetch(impl: () => Promise<Response>) {
  const calls: string[] = [];
  const fn = (url: string) => {
    calls.push(url);
    return impl();
  };
  return { fn, calls };
}

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

beforeEach(() => clearBarrierCache());

test("quantizeBBox snaps outward", () => {
  const q = quantizeBBox(BBOX);
  assert.deepEqual(q, [-117.17, 32.715, -117.15, 32.73]);
  assert.ok(q[0] <= BBOX[0] && q[1] <= BBOX[1] && q[2] >= BBOX[2] && q[3] >= BBOX[3]);
});

test("nearby bboxes share a key", () => {
  const a = quantizeBBox([-117.1681, 32.7152, -117.1521, 32.7279]);
  const b = quantizeBBox([-117.1695, 32.7151, -117.1511, 32.7295]);
  assert.equal(bboxParam(a), bboxParam(b));
});

test("loadBarriers returns live response and caches", async () => {
  const m = mockFetch(() => json(okBody()));
  const r1 = await loadBarriers(BBOX, m.fn);
  assert.equal(r1.liveError, null);
  assert.equal(r1.response.meta.data_mode, "live_import");
  const r2 = await loadBarriers(BBOX, m.fn);
  assert.equal(r2.liveError, null);
  assert.equal(m.calls.length, 1);
  assert.match(m.calls[0], /^\/api\/barriers\?bbox=/);
});

test("HTTP 500 with error JSON falls back to fixture; retry refetches", async () => {
  const m = mockFetch(() => json({ error: { code: "DB_DOWN", message: "neon unavailable" } }, 500));
  const r = await loadBarriers(BBOX, m.fn);
  assert.equal(r.response.meta.data_mode, "demo_fixture");
  assert.ok(r.liveError?.includes("DB_DOWN"));
  assert.ok(r.response.data.length > 0);
  await loadBarriers(BBOX, m.fn);
  assert.equal(m.calls.length, 2);
});

test("failure then success: retry returns live", async () => {
  let n = 0;
  const m = mockFetch(() => (n++ === 0 ? json({ error: { code: "X", message: "y" } }, 500) : json(okBody())));
  const r1 = await loadBarriers(BBOX, m.fn);
  assert.equal(r1.response.meta.data_mode, "demo_fixture");
  const r2 = await loadBarriers(BBOX, m.fn);
  assert.equal(r2.liveError, null);
  assert.equal(r2.response.meta.data_mode, "live_import");
});

test("synchronously throwing fetch falls back", async () => {
  const calls: number[] = [];
  const throwing = (() => {
    calls.push(1);
    throw new Error("boom");
  }) as unknown as Parameters<typeof loadBarriers>[1];
  const r = await loadBarriers(BBOX, throwing);
  assert.equal(r.response.meta.data_mode, "demo_fixture");
  assert.ok(r.liveError?.includes("boom"));
  await loadBarriers(BBOX, throwing);
  assert.equal(calls.length, 2);
});

test("filterBySource keeps only enabled kinds", () => {
  const items = [
    { id: 1, source_kind: "city_gis" as SourceKind },
    { id: 2, source_kind: "city_311" as SourceKind },
    { id: 3, source_kind: "traffic_control" as SourceKind },
  ];
  const out = filterBySource(items, new Set<SourceKind>(["city_311", "traffic_control"]));
  assert.deepEqual(out.map((i) => i.id), [2, 3]);
  assert.deepEqual(filterBySource(items, new Set<SourceKind>()), []);
});
