import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_UPLOAD_BYTES,
  analyzeImage,
  fetchNotices,
  investigate,
  speak,
  validateUpload,
} from "../../src/lib/ui/evidenceClient";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function imageFile(size = 10, type = "image/png"): Blob {
  return new Blob([new Uint8Array(size)], { type });
}

// ---- fetchNotices -----------------------------------------------------------

test("fetchNotices maps cards, refreshed_at, data_mode and source_note", async () => {
  const card = {
    notice: {
      source_url: "https://example.test/n",
      page_title: "Notice",
      published_at: null,
      retrieved_at: "2026-11-01T00:00:00Z",
      cross_streets: ["A St", "B Ave"],
      pedestrian_impact_found: true,
      pedestrian_impact_language: ["sidewalk closed"],
    },
    matched_permit_ids: ["p1"],
    observation_id: null,
  };
  let url = "";
  const fake = (async (u: string) => {
    url = u;
    return jsonResponse({
      data: [card],
      meta: { refreshed_at: "2026-11-14T00:00:00Z", data_mode: "live", source_note: "note" },
    });
  }) as unknown as typeof fetch;

  const result = await fetchNotices(fake);

  assert.equal(url, "/api/notices");
  assert.deepEqual(result, {
    ok: true,
    cards: [card],
    refreshed_at: "2026-11-14T00:00:00Z",
    data_mode: "live",
    source_note: "note",
  });
});

test("fetchNotices returns ok with empty cards when data is empty", async () => {
  const fake = (async () => jsonResponse({ data: [] })) as unknown as typeof fetch;
  const result = await fetchNotices(fake);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.cards, []);
    assert.equal(result.refreshed_at, null);
    assert.equal(result.data_mode, "unknown");
  }
});

test("fetchNotices maps HTTP 500 error envelope to ok:false with its code and message", async () => {
  const fake = (async () =>
    jsonResponse({ error: { code: "X", message: "m" } }, 500)) as unknown as typeof fetch;
  const result = await fetchNotices(fake);
  assert.deepEqual(result, { ok: false, code: "X", message: "m" });
});

test("fetchNotices returns BAD_SHAPE when data is not an array", async () => {
  const fake = (async () => jsonResponse({ data: { not: "an array" } })) as unknown as typeof fetch;
  const result = await fetchNotices(fake);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "BAD_SHAPE");
});

test("fetchNotices returns NETWORK when fetch throws", async () => {
  const fake = (async () => {
    throw new TypeError("network down");
  }) as unknown as typeof fetch;
  const result = await fetchNotices(fake);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "NETWORK");
});

// ---- validateUpload ---------------------------------------------------------

test("validateUpload rejects when permission is not confirmed", () => {
  const msg = validateUpload({ file: imageFile(), permissionConfirmed: false });
  assert.equal(msg, "Confirm you took this photo or have the right to submit it.");
});

test("validateUpload rejects an empty file", () => {
  const msg = validateUpload({ file: new Blob([], { type: "image/png" }), permissionConfirmed: true });
  assert.equal(msg, "Choose an image file.");
});

test("validateUpload rejects files larger than 5 MB", () => {
  assert.equal(MAX_UPLOAD_BYTES, 5 * 1024 * 1024);
  const big = imageFile(MAX_UPLOAD_BYTES + 1);
  assert.equal(validateUpload({ file: big, permissionConfirmed: true }), "Image must be 5 MB or smaller.");
});

test("validateUpload accepts a file of exactly 5 MB", () => {
  const exact = imageFile(MAX_UPLOAD_BYTES);
  assert.equal(validateUpload({ file: exact, permissionConfirmed: true }), null);
});

test("validateUpload rejects non-image MIME types", () => {
  const pdf = imageFile(10, "application/pdf");
  assert.equal(validateUpload({ file: pdf, permissionConfirmed: true }), "File must be an image.");
});

test("validateUpload accepts a valid image/png", () => {
  assert.equal(validateUpload({ file: imageFile(10, "image/png"), permissionConfirmed: true }), null);
});

// ---- analyzeImage -----------------------------------------------------------

test("analyzeImage never calls fetch for invalid input", async () => {
  let calls = 0;
  const fake = (async () => {
    calls++;
    return jsonResponse({});
  }) as unknown as typeof fetch;

  const noPermission = await analyzeImage({ file: imageFile(), permissionConfirmed: false }, fake);
  const tooBig = await analyzeImage({ file: imageFile(MAX_UPLOAD_BYTES + 1), permissionConfirmed: true }, fake);

  assert.equal(calls, 0);
  assert.equal(noPermission.ok, false);
  assert.equal(tooBig.ok, false);
  if (!noPermission.ok) assert.equal(noPermission.code, "CLIENT_VALIDATION");
  if (!tooBig.ok) assert.equal(tooBig.code, "CLIENT_VALIDATION");
});

test("analyzeImage sends FormData with permission_confirmed and lat/lon when location given", async () => {
  let url = "";
  let init: any = null;
  const fake = (async (u: string, i: any) => {
    url = u;
    init = i;
    return jsonResponse({});
  }) as unknown as typeof fetch;

  await analyzeImage(
    { file: imageFile(), permissionConfirmed: true, location: { lat: 32.7, lon: -117.1 } },
    fake,
  );

  assert.equal(url, "/api/analyze-image");
  assert.equal(init.method, "POST");
  assert.ok(init.body instanceof FormData);
  const form = init.body as FormData;
  assert.equal(form.get("permission_confirmed"), "true");
  assert.equal(form.get("lat"), "32.7");
  assert.equal(form.get("lon"), "-117.1");
  assert.ok(form.get("image") instanceof Blob);
});

test("analyzeImage omits lat/lon from FormData when no location given", async () => {
  let form = null as FormData | null; // cast avoids TS narrowing to `never` (assigned in closure)
  const fake = (async (_u: string, i: any) => {
    form = i.body as FormData;
    return jsonResponse({});
  }) as unknown as typeof fetch;

  await analyzeImage({ file: imageFile(), permissionConfirmed: true, location: null }, fake);

  assert.ok(form);
  assert.equal(form!.get("permission_confirmed"), "true");
  assert.equal(form!.has("lat"), false);
  assert.equal(form!.has("lon"), false);
});

test("analyzeImage maps candidate observations and fields", async () => {
  const candidate = {
    category: "missing_curb_ramp",
    explanation: "possible ramp gap",
    model_confidence: "low",
    verification_status: "ai_candidate",
    routing_impact: "unknown",
  };
  const fake = (async () =>
    jsonResponse({
      candidate_observations: [candidate],
      requires_human_review: false,
      location_note: "placed",
      observation_ids: ["obs1"],
      saved: true,
      image: { image_reference: "img-1" },
    })) as unknown as typeof fetch;

  const result = await analyzeImage({ file: imageFile(), permissionConfirmed: true }, fake);

  assert.deepEqual(result, {
    ok: true,
    candidates: [candidate],
    requires_human_review: false,
    location_note: "placed",
    observation_ids: ["obs1"],
    saved: true,
    image_reference: "img-1",
  });
});

test("analyzeImage defaults requires_human_review to true when missing and falls back to safe defaults", async () => {
  const fake = (async () => jsonResponse({})) as unknown as typeof fetch;
  const result = await analyzeImage({ file: imageFile(), permissionConfirmed: true }, fake);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.requires_human_review, true);
    assert.deepEqual(result.candidates, []);
    assert.deepEqual(result.observation_ids, []);
    assert.equal(result.saved, false);
    assert.equal(result.image_reference, "unknown");
    assert.equal(result.location_note, "No location: result is not placed on the map.");
  }
});

test("analyzeImage maps HTTP 429 to RATE_LIMITED", async () => {
  const fake = (async () =>
    jsonResponse({ error: { code: "RATE_LIMITED", message: "slow down" } }, 429)) as unknown as typeof fetch;
  const result = await analyzeImage({ file: imageFile(), permissionConfirmed: true }, fake);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "RATE_LIMITED");
});

test("analyzeImage returns NETWORK when fetch throws", async () => {
  const fake = (async () => {
    throw new TypeError("network down");
  }) as unknown as typeof fetch;
  const result = await analyzeImage({ file: imageFile(), permissionConfirmed: true }, fake);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "NETWORK");
});

// ---- investigate ------------------------------------------------------------

test("investigate maps HTTP 404 to NOT_DEPLOYED", async () => {
  const fake = (async () => new Response("nope", { status: 404 })) as unknown as typeof fetch;
  const result = await investigate("obs1", fake);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "NOT_DEPLOYED");
});

test("investigate returns explanation and sources on success and posts observation_id", async () => {
  let url = "";
  let body: any = null;
  const fake = (async (u: string, init: any) => {
    url = u;
    body = JSON.parse(String(init.body));
    return jsonResponse({ explanation: "Because reasons", sources: ["src-a"] });
  }) as unknown as typeof fetch;

  const result = await investigate("obs1", fake);

  assert.equal(url, "/api/investigate");
  assert.deepEqual(body, { observation_id: "obs1" });
  assert.deepEqual(result, { ok: true, explanation: "Because reasons", sources: ["src-a"] });
});

test("investigate returns BAD_SHAPE when explanation is missing", async () => {
  const fake = (async () => jsonResponse({ sources: [] })) as unknown as typeof fetch;
  const result = await investigate("obs1", fake);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "BAD_SHAPE");
});

// ---- speak ------------------------------------------------------------------

test("speak returns EMPTY for empty or whitespace text without calling fetch", async () => {
  let calls = 0;
  const fake = (async () => {
    calls++;
    return new Response(new Blob(["x"]));
  }) as unknown as typeof fetch;

  for (const text of ["", "   \n\t "]) {
    const result = await speak(text, fake);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "EMPTY");
  }
  assert.equal(calls, 0);
});

test("speak truncates text to 1000 characters in the request body", async () => {
  let body: any = null;
  const fake = (async (_u: string, init: any) => {
    body = JSON.parse(String(init.body));
    return new Response(new Blob(["audio"]), { status: 200 });
  }) as unknown as typeof fetch;

  await speak("a".repeat(1500), fake);

  assert.equal(body.text.length, 1000);
  assert.equal(body.text, "a".repeat(1000));
});

test("speak maps HTTP 404 to NOT_DEPLOYED", async () => {
  const fake = (async () => new Response("nope", { status: 404 })) as unknown as typeof fetch;
  const result = await speak("hello", fake);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "NOT_DEPLOYED");
});

test("speak returns the response body as a Blob on success", async () => {
  const fake = (async () =>
    new Response(new Blob(["audio-bytes"], { type: "audio/mpeg" }), { status: 200 })) as unknown as typeof fetch;
  const result = await speak("hello", fake);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.ok(result.audio instanceof Blob);
    assert.equal(await result.audio.text(), "audio-bytes");
  }
});
