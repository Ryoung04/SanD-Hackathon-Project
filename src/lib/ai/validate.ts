// Strict validation for Gemini outputs (Owner C).
// Model output is never trusted: everything is parsed here before use.
import { z } from "zod";

export const CANDIDATE_CATEGORIES = [
  "missing_curb_ramp",
  "noncompliant_curb_ramp",
  "sidewalk_obstruction",
  "sidewalk_damage",
  "stairs",
  "crossing_issue",
  "construction_warning",
  "other",
] as const;

export const MODEL_CONFIDENCE = ["uncertain", "possible", "likely"] as const;

// Phrases the model must never assert from a photo or a news article.
const FORBIDDEN_CLAIMS =
  /\b(ada[- ]?compliant|wheelchair[- ]?safe|fully accessible|guaranteed|verified accessible|safe route|is passable)\b/i;

const noForbiddenClaim = (s: string) => !FORBIDDEN_CLAIMS.test(s);

// ---------- Image analysis ----------

export const VisionCandidate = z.object({
  category: z.enum(CANDIDATE_CATEGORIES),
  explanation: z
    .string()
    .min(1)
    .max(400)
    .refine(noForbiddenClaim, "explanation asserts verified accessibility"),
  model_confidence: z.enum(MODEL_CONFIDENCE),
});

export const VisionModelOutput = z.object({
  curb_ramp_visibility: z.enum(["visibly_present", "not_visible", "not_determinable"]),
  candidate_observations: z.array(VisionCandidate).max(10),
  no_clear_evidence: z.boolean(),
  image_quality_notes: z
    .string()
    .max(600)
    .refine(noForbiddenClaim, "notes assert verified accessibility"),
});
export type VisionModelOutput = z.infer<typeof VisionModelOutput>;

/** Gemini responseSchema mirroring VisionModelOutput (OpenAPI subset). */
export const VISION_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    curb_ramp_visibility: {
      type: "STRING",
      enum: ["visibly_present", "not_visible", "not_determinable"],
    },
    candidate_observations: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          category: { type: "STRING", enum: [...CANDIDATE_CATEGORIES] },
          explanation: { type: "STRING" },
          model_confidence: { type: "STRING", enum: [...MODEL_CONFIDENCE] },
        },
        required: ["category", "explanation", "model_confidence"],
      },
    },
    no_clear_evidence: { type: "BOOLEAN" },
    image_quality_notes: { type: "STRING" },
  },
  required: ["curb_ramp_visibility", "candidate_observations", "no_clear_evidence", "image_quality_notes"],
} as const;

// ---------- Notice (news / third-party page) extraction ----------

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const NoticeModelOutput = z.object({
  construction_mentioned: z.boolean(),
  location_text: z.string().max(300).nullable(),
  cross_streets: z.array(z.string().min(1).max(80)).max(8),
  date_start: isoDate.nullable(),
  date_end: isoDate.nullable(),
  pedestrian_impact_quotes: z.array(z.string().min(1).max(400)).max(6),
});
export type NoticeModelOutput = z.infer<typeof NoticeModelOutput>;

export const NOTICE_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    construction_mentioned: { type: "BOOLEAN" },
    location_text: { type: "STRING", nullable: true },
    cross_streets: { type: "ARRAY", items: { type: "STRING" } },
    date_start: { type: "STRING", nullable: true },
    date_end: { type: "STRING", nullable: true },
    pedestrian_impact_quotes: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: [
    "construction_mentioned",
    "location_text",
    "cross_streets",
    "date_start",
    "date_end",
    "pedestrian_impact_quotes",
  ],
} as const;

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Ground a notice extraction against its source text: drop quotes and street
 * names that do not literally appear in the article (hallucination guard).
 */
export function groundNotice(out: NoticeModelOutput, sourceText: string) {
  const src = norm(sourceText);
  const quotes = out.pedestrian_impact_quotes.filter((q) => src.includes(norm(q)));
  const streets = out.cross_streets.filter((s) => {
    // "25th Street" may appear as "25th and C streets"; check the core token.
    const core = norm(s).replace(/\b(street|streets|st|avenue|ave|boulevard|blvd|road|rd|drive|dr)\b/g, "").trim();
    return core.length > 0 && new RegExp(`\\b${core.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(src);
  });
  return {
    ...out,
    cross_streets: streets,
    pedestrian_impact_quotes: quotes,
    dropped_quotes: out.pedestrian_impact_quotes.length - quotes.length,
    dropped_streets: out.cross_streets.length - streets.length,
  };
}
