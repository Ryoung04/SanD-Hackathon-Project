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

// ---- POST /api/investigate (Owner C, Mastra agent) --------------------------
// Contract: docs/OWNER_B_REQUESTS.md "From Owner C -> B" and src/app/api/investigate/route.ts.
// Request {barrier_id, lat, lon}: lat/lon is the record's marker point (A has no get-by-id,
// so the server looks the record up within 60 m). Typical latency 8-20 s, capped at 45 s.

export interface Investigation {
  barrier_id: string;
  summary: string;
  supporting_observation_ids: string[];
  source_links: string[];
  conflicts: string[];
  uncertainties: string[];
  /** Always "informational_only": the agent never recommends a route. */
  recommendation_type: string;
  /** Caveat to show with the summary (e.g. "AI summary of the cited records; unverified"). */
  note: string | null;
}
/**
 * The record's marker point for /api/investigate: the Point itself, or the first vertex of a
 * line (where the map pans to). Null if the geometry has no usable coordinate.
 */
export function investigateTarget(obs: { id: string; geometry: { type: string; coordinates: any } }): { id: string; lat: number; lon: number } | null {
  const g = obs.geometry;
  const pt = g.type === "Point" ? g.coordinates : g.type === "LineString" ? g.coordinates?.[0] : g.coordinates?.[0]?.[0];
  if (!Array.isArray(pt) || !Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) return null;
  return { id: obs.id, lon: pt[0], lat: pt[1] };
}

export type InvestigateResult = ({ ok: true } & Investigation) | Unavailable;

const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/**
 * A bare 404 (no JSON error body) means the route isn't deployed, so the UI hides the button.
 * A 404 with `{error:{code:"NOT_FOUND"}}` means this record wasn't found and is shown as a message.
 */
export async function investigate(target: { id: string; lat: number; lon: number }, fetchImpl: typeof fetch = fetch): Promise<InvestigateResult> {
  try {
    const res = await fetchImpl("/api/investigate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ barrier_id: target.id, lat: target.lat, lon: target.lon }),
    });
    if (res.status === 404) {
      const e = await readError(res);
      return e.code === "HTTP_404" ? unavailable("NOT_DEPLOYED", "Explanations are not available yet") : e;
    }
    if (!res.ok) return readError(res);
    const j = await res.json();
    if (typeof j?.summary !== "string") return unavailable("BAD_SHAPE", "Unexpected explanation response");
    return {
      ok: true,
      barrier_id: String(j.barrier_id ?? target.id),
      summary: j.summary,
      supporting_observation_ids: strArr(j.supporting_observation_ids),
      // Only http(s) links are rendered as links; anything else is dropped.
      source_links: strArr(j.source_links).filter((u) => /^https?:\/\//.test(u)),
      conflicts: strArr(j.conflicts),
      uncertainties: strArr(j.uncertainties),
      recommendation_type: typeof j.recommendation_type === "string" ? j.recommendation_type : "informational_only",
      note: typeof j?.meta?.note === "string" ? j.meta.note : null,
    };
  } catch {
    return unavailable("NETWORK", "Could not reach the explanation service");
  }
}

// ---- POST /api/speak (Owner C, ElevenLabs) ------------------------------------
// Contract: {text} of at most SPEAK_MAX_CHARS characters, and only text already on screen
// (OWNER_B section 7). Returns audio/mpeg. Errors: FORBIDDEN_CLAIM 422 (the text makes a
// safety claim), RATE_LIMITED/BUDGET 429 (free-tier guard), UPSTREAM 502.

/** Server limit; change here if C changes it. */
export const SPEAK_MAX_CHARS = 600;

export type SpeakResult = { ok: true; audio: Blob } | Unavailable;

/** Trim to the limit at a word boundary so the spoken text stays a prefix of what's on screen. */
export function clipForSpeech(text: string, max = SPEAK_MAX_CHARS): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trim();
}

const SPEAK_MESSAGES: Record<string, string> = {
  BUDGET: "Read-aloud has used today's free voice budget.",
  RATE_LIMITED: "Too many read-aloud requests. Try again in a minute.",
  FORBIDDEN_CLAIM: "This text can't be read aloud.",
};

export async function speak(text: string, fetchImpl: typeof fetch = fetch): Promise<SpeakResult> {
  const t = clipForSpeech(text);
  if (!t) return unavailable("EMPTY", "Nothing to read");
  try {
    const res = await fetchImpl("/api/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: t }),
    });
    if (res.status === 404) return unavailable("NOT_DEPLOYED", "Read-aloud is not available yet");
    if (!res.ok) {
      const e = await readError(res);
      return SPEAK_MESSAGES[e.code] ? unavailable(e.code, SPEAK_MESSAGES[e.code]) : e;
    }
    return { ok: true, audio: await res.blob() };
  } catch {
    return unavailable("NETWORK", "Could not reach the voice service");
  }
}

// ---- GET /api/sources (Owner A, data trust summary) --------------------------
// Contract: src/lib/data/sources.ts (SourcesResult). One row per source with what it
// proves / does not prove, record counts and ingest freshness.

export interface SourceRow {
  source_kind: string;
  name: string;
  publisher: string;
  source_url: string;
  what_it_proves: string;
  what_it_does_not_prove: string;
  geometry_precision: string;
  default_verification_status: string;
  license_note: string;
  count_current: number;
  count_outdated: number;
  source_layer_updated_at: string | null;
  last_successful_ingest_at: string | null;
}
export type SourcesFetchResult = { ok: true; rows: SourceRow[]; generatedAt: string | null; dataMode: string } | Unavailable;

export async function fetchSources(bbox?: [number, number, number, number], fetchImpl: typeof fetch = fetch): Promise<SourcesFetchResult> {
  try {
    const res = await fetchImpl(bbox ? `/api/sources?bbox=${bbox.join(",")}` : "/api/sources");
    if (res.status === 404) return unavailable("NOT_DEPLOYED", "Source summary is not available yet");
    if (!res.ok) return readError(res);
    const j = await res.json();
    if (!Array.isArray(j?.data)) return unavailable("BAD_SHAPE", "Unexpected source summary");
    const rows: SourceRow[] = j.data
      .filter((r: any) => r && typeof r.name === "string")
      .map((r: any) => ({
        ...r,
        count_current: Number(r.count_current) || 0,
        count_outdated: Number(r.count_outdated) || 0,
        source_layer_updated_at: r.source_layer_updated_at ?? null,
        last_successful_ingest_at: r.last_successful_ingest_at ?? null,
      }));
    return { ok: true, rows, generatedAt: j?.meta?.generated_at ?? null, dataMode: String(j?.meta?.data_mode ?? "unknown") };
  } catch {
    return unavailable("NETWORK", "Could not reach the source summary");
  }
}
