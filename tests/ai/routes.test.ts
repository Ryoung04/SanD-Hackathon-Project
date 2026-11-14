import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("@/lib/ai/gemini", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/gemini")>("@/lib/ai/gemini");
  return { ...actual, analyzeImage: vi.fn() };
});
vi.mock("@/lib/ai/imageSources", () => ({ fetchCommonsImage: vi.fn() }));
vi.mock("@/lib/data/observations", () => ({ upsertObservations: vi.fn() }));
vi.mock("@/lib/web/noticePipeline", () => ({ refreshNotices: vi.fn() }));

import { analyzeImage, GeminiError, MAX_IMAGE_BYTES } from "@/lib/ai/gemini";
import { fetchCommonsImage } from "@/lib/ai/imageSources";
import { upsertObservations } from "@/lib/data/observations";
import { refreshNotices } from "@/lib/web/noticePipeline";
import { POST as analyzePost } from "@/app/api/analyze-image/route";
import { GET as noticesGet } from "@/app/api/notices/route";
import { POST as refreshPost } from "@/app/api/notices/refresh/route";

const mAnalyze = vi.mocked(analyzeImage);
const mCommons = vi.mocked(fetchCommonsImage);
const mUpsert = vi.mocked(upsertObservations);
const mRefresh = vi.mocked(refreshNotices);

let ipN = 0;
const nextIp = () => `10.0.0.${++ipN}`;

const jpeg = (size = 16) => new File([new Uint8Array(size).fill(0xff)], "p.jpg", { type: "image/jpeg" });

function req(form: FormData | null, ip = nextIp()) {
  return new Request("http://localhost/api/analyze-image", {
    method: "POST",
    headers: { "x-forwarded-for": ip },
    body: form ?? undefined,
  });
}
function uploadForm(extra: Record<string, string> = {}, file: File = jpeg()) {
  const f = new FormData();
  f.set("image", file);
  f.set("permission_confirmed", "true");
  for (const [k, v] of Object.entries(extra)) f.set(k, v);
  return f;
}
const analysis = (n = 1) => ({
  status: "candidate" as const,
  image_reference: "x",
  captured_at: null,
  candidate_observations: Array.from({ length: n }, () => ({
    category: "missing_curb_ramp" as const,
    explanation: "No ramp visible.",
    model_confidence: "possible" as const,
    verification_status: "ai_candidate" as const,
    routing_impact: "unknown" as const,
  })),
  curb_ramp_visibility: "not_visible" as never,
  no_clear_evidence: n === 0,
  image_quality_notes: "",
  requires_human_review: true as const,
  model: "test-model",
  dropped_for_unsupported_claims: 0,
  analyzed_at: "2026-01-01T00:00:00Z",
});

beforeEach(() => {
  vi.resetAllMocks();
  mAnalyze.mockResolvedValue(analysis(1));
  mUpsert.mockResolvedValue({ inserted: 1, updated: 0, rejected: [] } as never);
});

describe("POST /api/analyze-image", () => {
  it("400 BAD_REQUEST with no image or title", async () => {
    const res = await analyzePost(req(new FormData()));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("BAD_REQUEST");
  });

  it("400 for non-multipart body", async () => {
    const r = new Request("http://localhost/api/analyze-image", {
      method: "POST",
      headers: { "x-forwarded-for": nextIp(), "content-type": "application/json" },
      body: JSON.stringify({ a: 1 }),
    });
    const res = await analyzePost(r);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("BAD_REQUEST");
  });

  it("400 PERMISSION_REQUIRED without permission_confirmed", async () => {
    const f = new FormData();
    f.set("image", jpeg());
    const res = await analyzePost(req(f));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("PERMISSION_REQUIRED");
    expect(mAnalyze).not.toHaveBeenCalled();
  });

  it("413 IMAGE_TOO_LARGE when over MAX_IMAGE_BYTES", async () => {
    const res = await analyzePost(req(uploadForm({}, jpeg(MAX_IMAGE_BYTES + 1))));
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe("IMAGE_TOO_LARGE");
  });

  it("400 INVALID_LOCATION for lat/lon outside San Diego County", async () => {
    const res = await analyzePost(req(uploadForm({ lat: "40.7", lon: "-74.0" })));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_LOCATION");
    expect(mAnalyze).not.toHaveBeenCalled();
  });

  it("upload without lat/lon: 200, no observations, upsert not called, captured_at null", async () => {
    const res = await analyzePost(req(uploadForm()));
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b.observation_ids).toEqual([]);
    expect(b.location).toBeNull();
    expect(b.saved).toBeNull();
    expect(b.image.captured_at).toBeNull();
    expect(mUpsert).not.toHaveBeenCalled();
  });

  it("upload with SD lat/lon saves one ai_candidate observation", async () => {
    const res = await analyzePost(req(uploadForm({ lat: "32.7157", lon: "-117.1611" })));
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b.location.basis).toBe("user_supplied");
    expect(b.observation_ids).toHaveLength(1);
    expect(b.saved).toEqual({ inserted: 1, updated: 0, rejected: [] });
    expect(mUpsert).toHaveBeenCalledTimes(1);
    const obs = mUpsert.mock.calls[0][0] as unknown as Array<Record<string, unknown>>;
    expect(obs).toHaveLength(1);
    expect(obs[0]).toMatchObject({
      verification_status: "ai_candidate",
      routing_impact: "unknown",
      source_kind: "street_imagery_ai",
    });
  });

  it("save=false does not persist", async () => {
    const res = await analyzePost(req(uploadForm({ lat: "32.7157", lon: "-117.1611", save: "false" })));
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b.observation_ids).toHaveLength(1);
    expect(b.saved).toBeNull();
    expect(mUpsert).not.toHaveBeenCalled();
  });

  it("commons path with camera_location -> camera_gps_metadata", async () => {
    mCommons.mockResolvedValue({
      bytes: new Uint8Array(8),
      mimeType: "image/jpeg",
      ref: {
        image_reference: "commons:File:X.jpg",
        source: "wikimedia_commons",
        page_url: "https://commons.wikimedia.org/wiki/File:X.jpg",
        license: "CC BY-SA 4.0",
        attribution: "Someone",
        captured_at: "2020-05-01",
        camera_location: { lat: 32.72, lon: -117.16 },
      },
    } as never);
    const f = new FormData();
    f.set("commons_title", "File:X.jpg");
    const res = await analyzePost(req(f));
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b.location.basis).toBe("camera_gps_metadata");
    expect(mCommons).toHaveBeenCalledWith("File:X.jpg");
    expect(mUpsert).toHaveBeenCalledTimes(1);
  });

  it("fetchCommonsImage throws -> 400 IMAGE_SOURCE_REJECTED", async () => {
    mCommons.mockRejectedValue(new Error("license not allowed"));
    const f = new FormData();
    f.set("commons_title", "File:Bad.jpg");
    const res = await analyzePost(req(f));
    expect(res.status).toBe(400);
    const b = await res.json();
    expect(b.error.code).toBe("IMAGE_SOURCE_REJECTED");
    expect(b.error.message).toContain("license not allowed");
  });

  it("GeminiError UPSTREAM -> 502 AI_UPSTREAM", async () => {
    mAnalyze.mockRejectedValue(new GeminiError("UPSTREAM", "gemini down"));
    const res = await analyzePost(req(uploadForm()));
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("AI_UPSTREAM");
  });

  it("GeminiError CONFIG -> 500 without leaking details", async () => {
    mAnalyze.mockRejectedValue(new GeminiError("CONFIG", "GEMINI_API_KEY=secret-abc missing"));
    const res = await analyzePost(req(uploadForm()));
    expect(res.status).toBe(500);
    const b = await res.json();
    expect(b.error.code).toBe("AI_CONFIG");
    expect(JSON.stringify(b)).not.toContain("secret-abc");
    expect(JSON.stringify(b)).not.toContain("GEMINI_API_KEY");
  });

  it("429 on the 11th request from one IP", async () => {
    const ip = nextIp();
    for (let i = 0; i < 10; i++) {
      const r = await analyzePost(req(uploadForm(), ip));
      expect(r.status).toBe(200);
    }
    const res = await analyzePost(req(uploadForm(), ip));
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("RATE_LIMITED");
  });
});

describe("GET /api/notices", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "notices-"));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("empty store -> data [] and data_mode empty", async () => {
    process.env.NOTICE_STORE_PATH = path.join(tmp, "missing.json");
    const b = await (await noticesGet()).json();
    expect(b.data).toEqual([]);
    expect(b.meta.count).toBe(0);
    expect(b.meta.data_mode).toBe("empty");
  });

  it("populated store -> cached_live with matching count", async () => {
    const p = path.join(tmp, "n.json");
    fs.writeFileSync(
      p,
      JSON.stringify({
        refreshed_at: "2026-01-01T00:00:00Z",
        queries: [],
        errors: [],
        cards: [
          { notice: { source_url: "https://a" }, matched_permit_ids: [], observation_id: null },
          { notice: { source_url: "https://b" }, matched_permit_ids: ["P1"], observation_id: "o1" },
        ],
      }),
    );
    process.env.NOTICE_STORE_PATH = p;
    const res = await noticesGet();
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b.data).toHaveLength(2);
    expect(b.meta.count).toBe(2);
    expect(b.meta.data_mode).toBe("cached_live");
  });
});

describe("POST /api/notices/refresh", () => {
  const call = (headers: Record<string, string> = {}, body?: unknown) =>
    refreshPost(
      new Request("http://localhost/api/notices/refresh", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  const result = (cards: Array<{ observation_id: string | null }>) =>
    ({ refreshed_at: "2026-01-01T00:00:00Z", cards, saved: { inserted: 1 }, errors: [] }) as never;

  beforeEach(() => {
    process.env.ADMIN_TOKEN = "good-token";
  });

  it("401 with no token", async () => {
    const res = await call();
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHORIZED");
    expect(mRefresh).not.toHaveBeenCalled();
  });

  it("401 with wrong token (same and different length)", async () => {
    expect((await call({ "x-admin-token": "bad-token!" })).status).toBe(401);
    expect((await call({ "x-admin-token": "nope" })).status).toBe(401);
    expect(mRefresh).not.toHaveBeenCalled();
  });

  it("401 when ADMIN_TOKEN is unset even with a header", async () => {
    delete process.env.ADMIN_TOKEN;
    const res = await call({ "x-admin-token": "anything" });
    expect(res.status).toBe(401);
    expect(mRefresh).not.toHaveBeenCalled();
  });

  it("200 with computed cards/with_map_marker", async () => {
    mRefresh.mockResolvedValue(result([{ observation_id: "a" }, { observation_id: null }, { observation_id: "b" }]));
    const res = await call({ "x-admin-token": "good-token" }, {});
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b.cards).toBe(3);
    expect(b.with_map_marker).toBe(2);
    expect(b.refreshed_at).toBe("2026-01-01T00:00:00Z");
    expect(mRefresh).toHaveBeenCalledWith({ days: 60, save: true });
  });

  it("502 PIPELINE_FAILED when refreshNotices throws", async () => {
    mRefresh.mockRejectedValue(new Error("brightdata down"));
    const res = await call({ "x-admin-token": "good-token" }, {});
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("PIPELINE_FAILED");
  });

  it("clamps days to 120 (and floors to 1)", async () => {
    mRefresh.mockResolvedValue(result([]));
    await call({ "x-admin-token": "good-token" }, { days: 9999, save: false });
    expect(mRefresh).toHaveBeenLastCalledWith({ days: 120, save: false });
    await call({ "x-admin-token": "good-token" }, { days: -5 });
    expect(mRefresh).toHaveBeenLastCalledWith({ days: 1, save: true });
  });

  it("treats a JSON null / non-object body as defaults (not 500)", async () => {
    mRefresh.mockResolvedValue(result([]));
    for (const body of [null, 42, "x"]) {
      const res = await call({ "x-admin-token": "good-token" }, body);
      expect(res.status).toBe(200);
      expect(mRefresh).toHaveBeenLastCalledWith({ days: 60, save: true });
    }
  });
});
