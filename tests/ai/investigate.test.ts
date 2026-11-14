import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BarrierObservation } from "@/lib/data/types";

// Fake Mastra Agent: calls the real bound tools, then returns whatever draft the test sets.
const agentState: { draft: unknown; calls: { radius_m?: number } | null; throwMsg: string | null; tools: string[] } = {
  draft: null, calls: null, throwMsg: null, tools: [],
};
vi.mock("@mastra/core/agent", () => ({
  Agent: class {
    tools: Record<string, { execute: (a: unknown) => Promise<unknown> }>;
    constructor(o: { tools: Record<string, { execute: (a: unknown) => Promise<unknown> }> }) {
      this.tools = o.tools;
    }
    async generate() {
      if (agentState.throwMsg) throw new Error(agentState.throwMsg);
      agentState.tools = Object.keys(this.tools);
      await this.tools.get_barrier.execute({});
      await this.tools.get_nearby_records.execute(agentState.calls ?? { radius_m: 100 });
      await this.tools.get_construction_notices.execute({});
      return { object: agentState.draft, response: { modelId: "test-model" } };
    }
  },
}));
vi.mock("@/lib/data/observations", () => ({ listObservations: vi.fn() }));
vi.mock("@/lib/web/noticeStore", () => ({ readNoticeCache: () => ({ refreshed_at: null, queries: [], cards: [], errors: [] }) }));

import { listObservations } from "@/lib/data/observations";
import { finalizeBrief, BriefRejected, BASELINE_UNCERTAINTIES } from "@/lib/agents/brief";
import { investigateBarrier } from "@/lib/agents/investigate";
import { POST } from "@/app/api/investigate/route";

const mList = vi.mocked(listObservations);

const obs = (id: string, lon: number, lat: number, extra: Partial<BarrierObservation> = {}): BarrierObservation => ({
  id, category: "missing_curb_ramp", label: id, geometry: { type: "Point", coordinates: [lon, lat] },
  geometry_precision: "intersection", source_kind: "city_gis", source_record_id: id,
  source_url: `https://example.gov/${id}`, source_observed_at: null, source_updated_at: null,
  ingested_at: "2026-11-14T00:00:00Z", verification_status: "official_inventory", routing_impact: "possible_obstacle",
  severity: "unknown", description: "", evidence: [], metadata: {}, ...extra,
});

const BARRIER = obs("city_gis:1", -117.1674, 32.7188);
const NEAR = obs("city_311:9", -117.1675, 32.7189, { source_kind: "city_311", source_url: "https://data.sandiego.gov/x" });
const FAR = obs("city_311:far", -117.1600, 32.7188, { source_kind: "city_311" }); // ~690 m away

beforeEach(() => {
  agentState.draft = {
    summary: "A city record lists a missing curb ramp at this intersection.",
    supporting_observation_ids: ["city_gis:1", "city_311:9"],
    source_links: ["https://example.gov/city_gis:1"],
    conflicts: [],
    uncertainties: ["Specific corner is unknown"],
  };
  agentState.calls = null;
  agentState.throwMsg = null;
  mList.mockReset();
  mList.mockResolvedValue({ data: [BARRIER, NEAR, FAR], meta: {} } as any);
  process.env.GEMINI_API_KEY = "test";
});

describe("finalizeBrief", () => {
  const seen = [{ id: "a", source_url: "https://x.org/a" }, { id: "b", source_url: "upload:abc" }];
  const draft = { summary: "Record a lists a ramp issue.", supporting_observation_ids: [], source_links: [], conflicts: [], uncertainties: [] };

  it("drops ids and links not returned by tools", () => {
    const r = finalizeBrief("a", { ...draft, supporting_observation_ids: ["b", "invented:1"], source_links: ["https://evil.example/", "https://x.org/a"] }, seen);
    expect(r.supporting_observation_ids).toEqual(["a", "b"]);
    expect(r.source_links).toEqual(["https://x.org/a"]);
  });
  it("falls back to the barrier's own http link, never non-http source_url", () => {
    expect(finalizeBrief("a", draft, seen).source_links).toEqual(["https://x.org/a"]);
    expect(finalizeBrief("b", draft, seen).source_links).toEqual([]);
  });
  it("always adds the baseline uncertainty and fixes recommendation_type", () => {
    const r = finalizeBrief("a", draft, seen);
    expect(r.uncertainties).toEqual(BASELINE_UNCERTAINTIES);
    expect(r.recommendation_type).toBe("informational_only");
  });
  it("rejects a summary that claims accessibility", () => {
    expect(() => finalizeBrief("a", { ...draft, summary: "This crossing is wheelchair accessible." }, seen)).toThrow(BriefRejected);
    expect(() => finalizeBrief("a", { ...draft, summary: "Route is A.D.A.-compliant" }, seen)).toThrow(BriefRejected);
  });
  it("strips forbidden claims from conflicts/uncertainties", () => {
    const r = finalizeBrief("a", { ...draft, conflicts: ["safe for wheelchairs", "dates differ"] }, seen);
    expect(r.conflicts).toEqual(["dates differ"]);
  });
});

describe("investigateBarrier (fake agent, real tools)", () => {
  it("binds tools to the barrier, filters by radius, records a trace", async () => {
    const r = await investigateBarrier({ barrier_id: "city_gis:1", lat: 32.7188, lon: -117.1674 });
    expect(agentState.tools.sort()).toEqual(["get_barrier", "get_construction_notices", "get_nearby_records"]);
    expect(r.trace.map((t) => t.tool)).toEqual(["get_barrier", "get_nearby_records", "get_construction_notices"]);
    expect(r.trace[1].result_ids).toEqual(["city_311:9"]); // FAR excluded
    expect(r.brief.supporting_observation_ids).toEqual(["city_gis:1", "city_311:9"]);
    expect(r.model).toBe("test-model");
  });
  it("never searches beyond 200 m (Mastra schema rejects; clamp is a backstop)", async () => {
    agentState.calls = { radius_m: 99999 };
    const r = await investigateBarrier({ barrier_id: "city_gis:1", lat: 32.7188, lon: -117.1674 });
    const nearby = r.trace.filter((t) => t.tool === "get_nearby_records");
    for (const t of nearby) expect(t.input.radius_m as number).toBeLessThanOrEqual(200);
    expect(mList.mock.calls.every(([o]) => o.bbox[2] - o.bbox[0] < 0.01)).toBe(true); // ≤ ~400 m box
  });
  it("NOT_FOUND when id is not near the given point (no model call)", async () => {
    agentState.throwMsg = "should not be called";
    await expect(investigateBarrier({ barrier_id: "nope", lat: 32.7188, lon: -117.1674 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("ids of records outside the radius cannot be cited", async () => {
    agentState.draft = { ...(agentState.draft as object), supporting_observation_ids: ["city_311:far"] };
    const r = await investigateBarrier({ barrier_id: "city_gis:1", lat: 32.7188, lon: -117.1674 });
    expect(r.brief.supporting_observation_ids).toEqual(["city_gis:1"]);
  });
  it("maps abort to TIMEOUT and other failures to AI_UPSTREAM", async () => {
    agentState.throwMsg = "The operation was aborted due to timeout";
    await expect(investigateBarrier({ barrier_id: "city_gis:1", lat: 32.7188, lon: -117.1674 })).rejects.toMatchObject({ code: "TIMEOUT" });
    agentState.throwMsg = "503 overloaded";
    await expect(investigateBarrier({ barrier_id: "city_gis:1", lat: 32.7188, lon: -117.1674 })).rejects.toMatchObject({ code: "AI_UPSTREAM" });
  });
  it("INVALID_OUTPUT when the draft is malformed", async () => {
    agentState.draft = { summary: 5 };
    await expect(investigateBarrier({ barrier_id: "city_gis:1", lat: 32.7188, lon: -117.1674 })).rejects.toMatchObject({ code: "INVALID_OUTPUT" });
  });
});

describe("POST /api/investigate", () => {
  let n = 0;
  const call = (body: unknown, ip = `10.9.0.${++n}`) =>
    POST(new Request("http://localhost/api/investigate", { method: "POST", headers: { "x-forwarded-for": ip }, body: typeof body === "string" ? body : JSON.stringify(body) }));

  it("200 with brief + mastra meta", async () => {
    const res = await call({ barrier_id: "city_gis:1", lat: 32.7188, lon: -117.1674 });
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.recommendation_type).toBe("informational_only");
    expect(j.meta.agent).toBe("mastra");
    expect(j.meta.tool_calls).toHaveLength(3);
  });
  it.each([
    ["not json", 400, "BAD_REQUEST"],
    [{ lat: 32.7, lon: -117.1 }, 400, "BAD_REQUEST"],
    [{ barrier_id: "x", lat: 40.7, lon: -74 }, 400, "INVALID_LOCATION"],
    [{ barrier_id: "x", lat: "abc", lon: -117.1 }, 400, "INVALID_LOCATION"],
    [{ barrier_id: "missing", lat: 32.7188, lon: -117.1674 }, 404, "NOT_FOUND"],
  ])("%j -> %i %s", async (body, status, code) => {
    const res = await call(body);
    expect(res.status).toBe(status);
    expect((await res.json()).error.code).toBe(code);
  });
  it("504 on agent timeout", async () => {
    agentState.throwMsg = "aborted";
    const res = await call({ barrier_id: "city_gis:1", lat: 32.7188, lon: -117.1674 });
    expect(res.status).toBe(504);
  });
  it("rate limits per IP", async () => {
    let last = 0;
    for (let i = 0; i < 7; i++) last = (await call({ barrier_id: "missing", lat: 32.7188, lon: -117.1674 }, "10.9.9.9")).status;
    expect(last).toBe(429);
  });
});
