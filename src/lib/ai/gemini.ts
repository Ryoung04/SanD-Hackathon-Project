// Gemini calls (server-only). Owner C.
import "server-only";
// - Structured JSON via responseSchema, then Zod validation (validate.ts).
// - Model fallback chain: some models 404 for our key or 503 under load.
import {
  VISION_RESPONSE_SCHEMA,
  VisionModelOutput,
  NOTICE_RESPONSE_SCHEMA,
  NoticeModelOutput,
  groundNotice,
} from "./validate";

const API = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODELS = ["gemini-3.5-flash", "gemini-3.1-flash-lite"];
const RETRYABLE = new Set([404, 429, 500, 502, 503, 504]);

export class GeminiError extends Error {
  constructor(public code: "CONFIG" | "UPSTREAM" | "INVALID_OUTPUT" | "BAD_INPUT", message: string) {
    super(message);
  }
}

function models(): string[] {
  const env = process.env.GEMINI_MODELS;
  return env ? env.split(",").map((s) => s.trim()).filter(Boolean) : DEFAULT_MODELS;
}

type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

/** Call Gemini with JSON output; try each model in the chain on retryable errors. */
export async function generateJson(
  parts: Part[],
  responseSchema: object,
  opts: { timeoutMs?: number; maxOutputTokens?: number } = {},
): Promise<{ json: unknown; model: string }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new GeminiError("CONFIG", "GEMINI_API_KEY not set");
  const errors: string[] = [];
  for (const model of models()) {
    let res: Response;
    try {
      res = await fetch(`${API}/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema,
            temperature: 0.1,
            maxOutputTokens: opts.maxOutputTokens ?? 2048,
          },
        }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 45_000),
      });
    } catch (e) {
      errors.push(`${model}: ${(e as Error).name}`);
      continue; // timeout / network -> next model
    }
    if (!res.ok) {
      errors.push(`${model}: HTTP ${res.status}`);
      if (RETRYABLE.has(res.status)) continue;
      throw new GeminiError("UPSTREAM", errors.join("; "));
    }
    const body = await res.json();
    const text: string | undefined = body?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      errors.push(`${model}: empty response (${body?.candidates?.[0]?.finishReason ?? "unknown"})`);
      continue;
    }
    try {
      return { json: JSON.parse(text), model: body.modelVersion ?? model };
    } catch {
      throw new GeminiError("INVALID_OUTPUT", `${model}: non-JSON output`);
    }
  }
  throw new GeminiError("UPSTREAM", `all models failed: ${errors.join("; ")}`);
}

// ---------- Image analysis ----------

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const VISION_PROMPT =
  "You review a street photo for POTENTIAL pedestrian accessibility barriers. Describe only what is visible. " +
  "Do not state location, street names, dates, or sources. Do not claim ADA compliance, safety, or passability, and do not measure slope or width. " +
  "A ramp that is not visible is not proof of absence. Fencing, cones, vehicles, poles, or debris on or beside the walking path are worth flagging as possible obstructions. " +
  "If nothing is clearly visible, return an empty candidate list and no_clear_evidence=true. " +
  "Keep each explanation to one sentence and say what cannot be verified from the photo.";

export interface AnalyzeImageInput {
  bytes: Uint8Array;
  mimeType: string;
  imageReference: string; // upload id or permitted source id
  capturedAt: string | null; // from source metadata only; never upload time
}

/** Response shape for POST /api/analyze-image (PROJECT_MASTER §4.4). */
export interface AnalyzeImageResponse {
  status: "candidate";
  image_reference: string;
  captured_at: string | null;
  candidate_observations: Array<{
    category: VisionModelOutput["candidate_observations"][number]["category"];
    explanation: string;
    model_confidence: "uncertain" | "possible" | "likely";
    verification_status: "ai_candidate";
    routing_impact: "unknown";
  }>;
  curb_ramp_visibility: VisionModelOutput["curb_ramp_visibility"];
  no_clear_evidence: boolean;
  image_quality_notes: string;
  requires_human_review: true;
  model: string;
  analyzed_at: string;
}

export async function analyzeImage(input: AnalyzeImageInput): Promise<AnalyzeImageResponse> {
  if (!ALLOWED_MIME.has(input.mimeType)) throw new GeminiError("BAD_INPUT", "unsupported image type");
  if (input.bytes.byteLength === 0 || input.bytes.byteLength > MAX_IMAGE_BYTES)
    throw new GeminiError("BAD_INPUT", "image size out of range");

  const { json, model } = await generateJson(
    [
      { inline_data: { mime_type: input.mimeType, data: Buffer.from(input.bytes).toString("base64") } },
      { text: VISION_PROMPT },
    ],
    VISION_RESPONSE_SCHEMA,
  );
  const parsed = VisionModelOutput.safeParse(json);
  if (!parsed.success) throw new GeminiError("INVALID_OUTPUT", parsed.error.issues.map((i) => i.message).join("; "));
  const out = parsed.data;
  return {
    status: "candidate",
    image_reference: input.imageReference,
    captured_at: input.capturedAt,
    candidate_observations: out.candidate_observations.map((c) => ({
      ...c,
      verification_status: "ai_candidate",
      routing_impact: "unknown",
    })),
    curb_ramp_visibility: out.curb_ramp_visibility,
    no_clear_evidence: out.no_clear_evidence,
    image_quality_notes: out.image_quality_notes,
    requires_human_review: true,
    model,
    analyzed_at: new Date().toISOString(),
  };
}

// ---------- Notice extraction ----------

const NOTICE_PROMPT =
  "Extract construction information from the article below. Use ONLY the article text. " +
  "cross_streets: names of the streets that locate the construction, ONE street per array entry (e.g. [\"25th Street\", \"C Street\"], never \"25th and C streets\"). " +
  "date_start/date_end: YYYY-MM-DD only if the article states the construction dates explicitly, else null. " +
  "pedestrian_impact_quotes: verbatim sentences from the article that mention sidewalks, pedestrians, walkways, crosswalks, or pedestrian detours; " +
  "empty if none. Parking or traffic-lane impacts alone are NOT pedestrian impacts. Do not paraphrase quotes.\n\nARTICLE:\n";

export async function extractNotice(articleText: string) {
  const text = articleText.split(/\s+/).slice(0, 6000).join(" ");
  const { json, model } = await generateJson([{ text: NOTICE_PROMPT + text }], NOTICE_RESPONSE_SCHEMA);
  const parsed = NoticeModelOutput.safeParse(json);
  if (!parsed.success) throw new GeminiError("INVALID_OUTPUT", parsed.error.issues.map((i) => i.message).join("; "));
  return { ...groundNotice(parsed.data, text), model };
}
