// Per-record imagery cross-checks (Owner C). File cache like noticeStore; path overridable.
// A check says what ONE permitted street photo near a record shows. It never changes the
// record it checks: city records stay official_inventory; AI output stays ai_candidate.
import "server-only";
import fs from "node:fs";
import path from "node:path";

export interface ImageryCheck {
  barrier_id: string;
  checked_at: string;
  status: "analyzed" | "no_imagery" | "error";
  image: {
    reference: string;
    page_url: string;
    captured_at: string;
    license: string;
    attribution: string;
    distance_m: number;
    heading_off_deg: number | null;
  } | null;
  curb_ramp_visibility: "visibly_present" | "not_visible" | "not_determinable" | null;
  no_clear_evidence: boolean | null;
  candidates: { category: string; model_confidence: string; explanation: string }[];
  observation_ids: string[];
  image_quality_notes: string | null;
  model: string | null;
  error: string | null;
}

export interface ImageryCheckStore {
  updated_at: string | null;
  checks: Record<string, ImageryCheck>;
}

const storePath = () => process.env.IMAGERY_CHECK_PATH || path.join(process.cwd(), "data", "imagery_checks.json");

export function readImageryChecks(): ImageryCheckStore {
  try {
    const raw = JSON.parse(fs.readFileSync(storePath(), "utf8"));
    if (raw && typeof raw.checks === "object") return raw as ImageryCheckStore;
  } catch {
    /* missing: empty */
  }
  return { updated_at: null, checks: {} };
}

export function writeImageryChecks(checks: ImageryCheck[]): ImageryCheckStore {
  const s = readImageryChecks();
  for (const c of checks) s.checks[c.barrier_id] = c;
  s.updated_at = new Date().toISOString();
  const p = storePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(s, null, 1));
  return s;
}

export function getImageryCheck(barrierId: string): ImageryCheck | null {
  return readImageryChecks().checks[barrierId] ?? null;
}
