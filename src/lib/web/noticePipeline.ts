// Orchestrates: Bright Data search/fetch -> Gemini extraction -> permit match
// -> observation (via Owner A's upsertObservations) + cached notice card.
// Queries are fixed server-side; users cannot supply URLs (SSRF).
import "server-only";
import { searchNews, fetchArticle, buildNotice, noticeToObservation } from "./noticeExtractor";
import { matchNoticeToPermits, type PermitRecord } from "./permitMatch";
import { permitsNear, NOTICE_BBOX } from "./permits";
import { writeNoticeCache, type NoticeCard, type NoticeCache } from "./noticeStore";
import { upsertObservations } from "@/lib/data/observations";
import type { BarrierObservation } from "@/lib/data/types";

export const DEFAULT_QUERIES = ["sidewalk closure", "road closure", "construction crews", "construction parking", "detour", "closed to traffic"];
const MAX_ARTICLES = 8; // cost bound: 1 Bright Data fetch + 1 Gemini call each

export async function processArticle(url: string, permits: PermitRecord[]) {
  const article = await fetchArticle(url);
  const notice = await buildNotice(article);
  const matches = matchNoticeToPermits(notice, permits);
  const observation = noticeToObservation(notice, matches);
  const card: NoticeCard = {
    notice,
    matched_permit_ids: matches.filter((m) => m.date_overlap === "overlaps").map((m) => m.permit.approval_id),
    observation_id: observation?.id ?? null,
  };
  return { card, matches, observation };
}

export async function refreshNotices(opts: { queries?: string[]; days?: number; save?: boolean } = {}): Promise<NoticeCache & { saved: unknown }> {
  const queries = (opts.queries ?? DEFAULT_QUERIES).slice(0, 8);
  const now = Date.now();
  const after = new Date(now - (opts.days ?? 60) * 86_400_000).toISOString().slice(0, 19);
  const errors: string[] = [];

  const seen = new Map<string, string>();
  for (const q of queries) {
    try {
      for (const a of await searchNews(q, after, 5)) if (!seen.has(a.source_url)) seen.set(a.source_url, a.title);
    } catch (e) {
      errors.push(`search "${q}": ${(e as Error).message}`);
    }
  }
  const permits = await permitsNear(NOTICE_BBOX, new Date(now - (opts.days ?? 60) * 86_400_000).toISOString().slice(0, 10));

  const cards: NoticeCard[] = [];
  const observations: BarrierObservation[] = [];
  for (const url of [...seen.keys()].slice(0, MAX_ARTICLES)) {
    try {
      const r = await processArticle(url, permits);
      const n = r.card.notice;
      // Keep only articles that locate construction on named streets (or mention pedestrians).
      if (!n.construction_mentioned || (n.cross_streets.length === 0 && !n.pedestrian_impact_found)) continue;
      cards.push(r.card);
      if (r.observation) observations.push(r.observation);
    } catch (e) {
      errors.push(`article ${url}: ${(e as Error).message}`);
    }
  }
  const saved = opts.save !== false && observations.length ? await upsertObservations(observations) : null;
  const cache = writeNoticeCache({ refreshed_at: new Date().toISOString(), queries, cards, errors });
  return { ...cache, saved };
}
