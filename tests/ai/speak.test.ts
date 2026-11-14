import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { prepareSpeechText, speak, _resetSpeakState, MAX_SPEAK_CHARS } from "@/lib/voice/elevenlabs";
import { POST } from "@/app/api/speak/route";

const fetchMock = vi.fn();
beforeEach(() => {
  _resetSpeakState();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response(new Uint8Array([0xff, 0xfb, 1, 2]), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  process.env.ELEVENLABS_API_KEY = "test-key";
  delete process.env.ELEVENLABS_VOICE_ID;
});
afterEach(() => vi.unstubAllGlobals());

describe("prepareSpeechText", () => {
  it("normalizes whitespace and control chars", () => {
    expect(prepareSpeechText("  a\n\tb\u0000c  ")).toBe("a b c");
  });
  it.each([[undefined], [5], [""], ["   "], ["x".repeat(MAX_SPEAK_CHARS + 1)]])("rejects %j", (v) => {
    expect(() => prepareSpeechText(v)).toThrow();
  });
  it("rejects forbidden accessibility claims", () => {
    expect(() => prepareSpeechText("This route is wheelchair safe.")).toThrow(/claim/);
  });
});

describe("speak", () => {
  it("calls ElevenLabs once and caches identical text", async () => {
    const a = await speak("A city record lists a missing curb ramp.");
    const b = await speak("A city record lists a missing curb ramp.");
    expect(a.cached).toBe(false);
    expect(b.cached).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("api.elevenlabs.io/v1/text-to-speech/");
    expect(init.headers["xi-api-key"]).toBe("test-key");
    expect(JSON.parse(init.body).model_id).toBe("eleven_flash_v2_5");
  });
  it("enforces the daily character budget", async () => {
    let i = 0;
    await expect(async () => {
      for (;;) await speak(`${i++} `.padEnd(590, "x"));
    }).rejects.toMatchObject({ code: "BUDGET" });
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(5); // 3000 / 590
  });
  it("maps upstream errors, never leaks the key", async () => {
    fetchMock.mockResolvedValueOnce(new Response("quota_exceeded", { status: 401 }));
    const e = await speak("hello").catch((x) => x);
    expect(e.code).toBe("UPSTREAM");
    expect(e.message).not.toContain("test-key");
  });
  it("CONFIG when key missing", async () => {
    delete process.env.ELEVENLABS_API_KEY;
    await expect(speak("hello")).rejects.toMatchObject({ code: "CONFIG" });
  });
});

describe("POST /api/speak", () => {
  let n = 0;
  const call = (body: unknown, ip = `10.8.0.${++n}`) =>
    POST(new Request("http://localhost/api/speak", { method: "POST", headers: { "x-forwarded-for": ip }, body: typeof body === "string" ? body : JSON.stringify(body) }));

  it("200 audio/mpeg", async () => {
    const res = await call({ text: "Nearby resident reports mention sidewalk damage." });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(res.headers.get("x-speech-cached")).toBe("0");
    expect((await res.arrayBuffer()).byteLength).toBe(4);
  });
  it.each([
    ["nope", 400, "BAD_REQUEST"],
    [{}, 400, "BAD_REQUEST"],
    [{ text: "This path is fully accessible" }, 422, "FORBIDDEN_CLAIM"],
  ])("%j -> %i", async (body, status, code) => {
    const res = await call(body);
    expect(res.status).toBe(status);
    expect((await res.json()).error.code).toBe(code);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("502 on upstream failure", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    expect((await call({ text: "hello there" })).status).toBe(502);
  });
  it("rate limits per IP", async () => {
    let last = 0;
    for (let i = 0; i < 6; i++) last = (await call({ text: "same text" }, "10.8.9.9")).status;
    expect(last).toBe(429);
  });
});
