// ElevenLabs text-to-speech (Owner C, OWNER_C §7). Server-only.
// Speaks text that is ALREADY shown on screen (e.g. the evidence brief summary). It never
// generates content. Free tier = 10k chars/month, so: length cap, in-memory cache (same text
// is never billed twice), and a daily character budget per server process.
import "server-only";
import { createHash } from "node:crypto";
import { noForbiddenClaim } from "@/lib/ai/validate";

export const MAX_SPEAK_CHARS = 600;
const DAILY_CHAR_BUDGET = Number(process.env.ELEVENLABS_DAILY_CHARS) || 3000;
const DEFAULT_VOICE = "SAz9YHcvj6GT2YYXdXww"; // "River" premade: neutral, informative
const MODEL = "eleven_flash_v2_5";
const TIMEOUT_MS = 20_000;

export class SpeakError extends Error {
  constructor(public code: "CONFIG" | "BAD_INPUT" | "FORBIDDEN_CLAIM" | "BUDGET" | "UPSTREAM", message: string) {
    super(message);
  }
}

const cache = new Map<string, ArrayBuffer>();
let budget = { day: "", used: 0 };

/** Collapse whitespace and strip control chars; validate. */
export function prepareSpeechText(raw: unknown): string {
  if (typeof raw !== "string") throw new SpeakError("BAD_INPUT", "text (string) required");
  const text = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!text) throw new SpeakError("BAD_INPUT", "text is empty");
  if (text.length > MAX_SPEAK_CHARS) throw new SpeakError("BAD_INPUT", `text exceeds ${MAX_SPEAK_CHARS} characters`);
  if (!noForbiddenClaim(text)) throw new SpeakError("FORBIDDEN_CLAIM", "text makes an accessibility/safety claim this app does not make");
  return text;
}

export function _resetSpeakState() {
  cache.clear();
  budget = { day: "", used: 0 };
}

/** Returns MP3 bytes. `cached` = served without an API call. */
export async function speak(rawText: unknown): Promise<{ audio: ArrayBuffer; cached: boolean }> {
  const text = prepareSpeechText(rawText);
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new SpeakError("CONFIG", "ELEVENLABS_API_KEY not set");
  const voice = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE;

  const h = createHash("sha256").update(`${voice}|${text}`).digest("hex");
  const hit = cache.get(h);
  if (hit) return { audio: hit, cached: true };

  const today = new Date().toISOString().slice(0, 10);
  if (budget.day !== today) budget = { day: today, used: 0 };
  if (budget.used + text.length > DAILY_CHAR_BUDGET) throw new SpeakError("BUDGET", "Daily speech budget reached; read the text on screen");

  let res: Response;
  try {
    res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_64`, {
      method: "POST",
      headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: MODEL }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new SpeakError("UPSTREAM", `ElevenLabs unreachable: ${(e as Error).message.slice(0, 100)}`);
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 150);
    throw new SpeakError("UPSTREAM", `ElevenLabs ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  const audio = await res.arrayBuffer();
  budget.used += text.length;
  if (cache.size > 200) cache.clear();
  cache.set(h, audio);
  return { audio, cached: false };
}
