// Pure guardrails for the Mastra evidence brief (Owner C, OWNER_C §6).
// The model drafts; this module decides what survives. No I/O here so it is unit-testable.
import { z } from "zod";
import { noForbiddenClaim } from "@/lib/ai/validate";

/** What the model is asked to return (structured output). */
// Over-long text is trimmed, not rejected: one verbose sentence shouldn't fail the whole brief
// (observed live). Ids/links are never trimmed — a cut id/link simply won't match and is dropped.
const clip = (n: number) => z.string().transform((s) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s));
const list = <T extends z.ZodTypeAny>(item: T, n: number) => z.array(item).transform((a) => a.slice(0, n));
export const BriefDraft = z.object({
  summary: clip(800),
  supporting_observation_ids: list(z.string().max(300), 20),
  source_links: list(z.string().max(500), 20),
  conflicts: list(clip(300), 10),
  uncertainties: list(clip(300), 10),
});
export type BriefDraft = z.output<typeof BriefDraft>;

/** Minimal record view the tools hand to the model (and to the guard). */
export interface SeenRecord {
  id: string;
  source_url: string;
  /** A citable link (e.g. a photo page) that is not an observation id. */
  link_only?: boolean;
}

export interface EvidenceBrief {
  barrier_id: string;
  summary: string;
  supporting_observation_ids: string[];
  source_links: string[];
  conflicts: string[];
  uncertainties: string[];
  recommendation_type: "informational_only";
}

/** Always present, whatever the model says. */
export const BASELINE_UNCERTAINTIES = [
  "Current on-the-ground condition is not verified by this app.",
];

const isHttp = (u: string) => {
  try {
    const p = new URL(u);
    return p.protocol === "https:" || p.protocol === "http:";
  } catch {
    return false;
  }
};

export class BriefRejected extends Error {}

/**
 * Enforce: ids only from records the tools returned; links only from those records'
 * source_url (http/https); no forbidden safety/ADA claims anywhere; fixed recommendation.
 * Throws BriefRejected if the summary itself makes a forbidden claim.
 */
export function finalizeBrief(barrierId: string, draft: BriefDraft, seen: SeenRecord[]): EvidenceBrief {
  const seenIds = new Set(seen.filter((r) => !r.link_only).map((r) => r.id));
  const seenLinks = new Set(seen.map((r) => r.source_url).filter(isHttp));

  if (!noForbiddenClaim(draft.summary)) throw new BriefRejected("summary made a forbidden accessibility claim");
  const clean = (arr: string[]) => arr.map((s) => s.trim()).filter((s) => s && noForbiddenClaim(s));

  const ids = [barrierId, ...draft.supporting_observation_ids.filter((id) => seenIds.has(id) && id !== barrierId)];
  const links = draft.source_links.filter((u) => seenLinks.has(u));
  const barrierUrl = seen.find((r) => r.id === barrierId)?.source_url;
  if (!links.length && barrierUrl && isHttp(barrierUrl)) links.push(barrierUrl);

  const uncertainties = clean(draft.uncertainties);
  for (const b of BASELINE_UNCERTAINTIES) if (!uncertainties.includes(b)) uncertainties.unshift(b);

  return {
    barrier_id: barrierId,
    summary: draft.summary.trim(),
    supporting_observation_ids: [...new Set(ids)],
    source_links: [...new Set(links)],
    conflicts: clean(draft.conflicts),
    uncertainties,
    recommendation_type: "informational_only",
  };
}
