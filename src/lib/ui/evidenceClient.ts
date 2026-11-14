/**
 * Client shells for Owner C endpoints. Every call degrades to a typed
 * "unavailable" result; AI/news failures must never block the map or routing.
 * Shapes mirror docs/OWNER_B_REQUESTS.md ("From Owner C → B").
 */

export type Unavailable = { ok: false; code: string; message: string };
const unavailable = (code: string, message: string): Unavailable => ({ ok: false, code, message });

async function readError(res: Response): Promise<Unavailable> {
  const j = await res.json().catch(() => null);
  return unavailable(j?.error?.code ?? `HTTP_${res.status}`, j?.error?.message ?? `Service error (HTTP ${res.status})`);
}

// ---- GET /api/notices -------------------------------------------------------

export interface NoticeCard {
  notice: {
    source_url: string;
    page_title: string;
    published_at: string | null;
    retrieved_at: string;
    cross_streets: string[];
    location_text?: string | null;
    date_start?: string | null;
    date_end?: string | null;
    pedestrian_impact_found: boolean;
    pedestrian_impact_language: string[];
    source_name?: string;
  };
  matched_permit_ids: string[];
  observation_id: string | null;
}
export type NoticesResult =
  | { ok: true; cards: NoticeCard[]; refreshed_at: string | null; data_mode: string; source_note: string }
  | Unavailable;

export async function fetchNotices(fetchImpl: typeof fetch = fetch): Promise<NoticesResult> {
  try {
    const res = await fetchImpl("/api/notices");
    if (!res.ok) return readError(res);
    const j = await res.json();
    if (!Array.isArray(j?.data)) return unavailable("BAD_SHAPE", "Unexpected notices response");
    return {
      ok: true,
      cards: j.data,
      refreshed_at: j.meta?.refreshed_at ?? null,
      data_mode: j.meta?.data_mode ?? "unknown",
      source_note: j.meta?.source_note ?? "Third-party reports; not official city records.",
    };
  } catch {
    return unavailable("NETWORK", "Could not reach the notices service");
  }
}

// ---- POST /api/analyze-image ------------------------------------------------

export interface ImageCandidate {
  category: string;
  explanation: string;
  model_confidence: string;
  verification_status: string; // expected "ai_candidate"
  routing_impact: string; // expected "unknown"
}
export type AnalyzeResult =
  | {
      ok: true;
      candidates: ImageCandidate[];
      requires_human_review: boolean;
      location_note: string;
      observation_ids: string[];
      saved: boolean;
      image_reference: string;
    }
  | Unavailable;

export interface AnalyzeInput {
  file: Blob;
  permissionConfirmed: boolean;
  location?: { lat: number; lon: number } | null;
}

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Client-side checks mirror the server so the user gets fast feedback. Returns an error message or null. */
export function validateUpload(input: AnalyzeInput): string | null {
  if (!input.permissionConfirmed) return "Confirm you took this photo or have the right to submit it.";
  if (!input.file || input.file.size === 0) return "Choose an image file.";
  if (input.file.size > MAX_UPLOAD_BYTES) return "Image must be 5 MB or smaller.";
  if (input.file.type && !input.file.type.startsWith("image/")) return "File must be an image.";
  return null;
}

export async function analyzeImage(input: AnalyzeInput, fetchImpl: typeof fetch = fetch): Promise<AnalyzeResult> {
  const invalid = validateUpload(input);
  if (invalid) return unavailable("CLIENT_VALIDATION", invalid);
  const form = new FormData();
  form.set("image", input.file);
  form.set("permission_confirmed", "true");
  if (input.location) {
    form.set("lat", String(input.location.lat));
    form.set("lon", String(input.location.lon));
  }
  try {
    const res = await fetchImpl("/api/analyze-image", { method: "POST", body: form });
    if (!res.ok) return readError(res);
    const j = await res.json();
    return {
      ok: true,
      candidates: Array.isArray(j?.candidate_observations) ? j.candidate_observations : [],
      requires_human_review: j?.requires_human_review !== false, // default to true if missing
      location_note: j?.location_note ?? "No location: result is not placed on the map.",
      observation_ids: Array.isArray(j?.observation_ids) ? j.observation_ids : [],
      saved: !!j?.saved,
      image_reference: j?.image?.image_reference ?? j?.image_reference ?? "unknown",
    };
  } catch {
    return unavailable("NETWORK", "Could not reach the image analysis service");
  }
}

// ---- POST /api/investigate, /api/speak (not built yet: shells) --------------

export type InvestigateResult = { ok: true; explanation: string; sources: string[] } | Unavailable;

/** 404 means the endpoint isn't deployed yet; the UI hides the feature instead of erroring. */
export async function investigate(observationId: string, fetchImpl: typeof fetch = fetch): Promise<InvestigateResult> {
  try {
    const res = await fetchImpl("/api/investigate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ observation_id: observationId }),
    });
    if (res.status === 404) return unavailable("NOT_DEPLOYED", "Explanations are not available yet");
    if (!res.ok) return readError(res);
    const j = await res.json();
    if (typeof j?.explanation !== "string") return unavailable("BAD_SHAPE", "Unexpected explanation response");
    return { ok: true, explanation: j.explanation, sources: Array.isArray(j.sources) ? j.sources : [] };
  } catch {
    return unavailable("NETWORK", "Could not reach the explanation service");
  }
}

export type SpeakResult = { ok: true; audio: Blob } | Unavailable;

/** Only text already on screen is sent (OWNER_B §7). */
export async function speak(text: string, fetchImpl: typeof fetch = fetch): Promise<SpeakResult> {
  const t = text.trim().slice(0, 1000);
  if (!t) return unavailable("EMPTY", "Nothing to read");
  try {
    const res = await fetchImpl("/api/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: t }),
    });
    if (res.status === 404) return unavailable("NOT_DEPLOYED", "Read-aloud is not available yet");
    if (!res.ok) return readError(res);
    return { ok: true, audio: await res.blob() };
  } catch {
    return unavailable("NETWORK", "Could not reach the voice service");
  }
}
