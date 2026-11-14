// POST /api/speak — ElevenLabs TTS for text already visible in the UI (Owner C, OWNER_C §7).
// Body: { "text": string (≤600 chars) }  ->  200 audio/mpeg (header x-speech-cached: 1|0)
// Errors: { error: { code, message } } — BAD_REQUEST 400, FORBIDDEN_CLAIM 422, RATE_LIMITED 429,
//         BUDGET 429, UPSTREAM 502, CONFIG 500. Speech is never the only path: always show the text.
import { NextResponse } from "next/server";
import { speak, SpeakError } from "@/lib/voice/elevenlabs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const err = (status: number, code: string, message: string) => NextResponse.json({ error: { code, message } }, { status });

const hits = new Map<string, number[]>();
function rateLimited(ip: string, max = 5, windowMs = 60_000) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > max;
}

const STATUS: Record<SpeakError["code"], [number, string]> = {
  BAD_INPUT: [400, "BAD_REQUEST"], FORBIDDEN_CLAIM: [422, "FORBIDDEN_CLAIM"], BUDGET: [429, "BUDGET"],
  UPSTREAM: [502, "UPSTREAM"], CONFIG: [500, "CONFIG"],
};

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  if (rateLimited(ip)) return err(429, "RATE_LIMITED", "Too many speech requests; try again in a minute");
  const raw: unknown = await req.json().catch(() => null);
  if (!raw || typeof raw !== "object") return err(400, "BAD_REQUEST", "JSON body required");
  try {
    const { audio, cached } = await speak((raw as { text?: unknown }).text);
    return new Response(audio, {
      status: 200,
      headers: { "content-type": "audio/mpeg", "cache-control": "no-store", "x-speech-cached": cached ? "1" : "0" },
    });
  } catch (e) {
    if (e instanceof SpeakError) {
      const [status, code] = STATUS[e.code];
      return err(status, code, e.message);
    }
    return err(502, "UPSTREAM", "Speech failed");
  }
}
