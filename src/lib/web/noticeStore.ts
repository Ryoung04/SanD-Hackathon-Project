// Cached-last-success store for notice cards (OWNER_C §5 acceptance).
// File-based like Owner A's fallback store; path overridable for tests.
import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { ConstructionNotice } from "./noticeExtractor";

export interface NoticeCard {
  notice: ConstructionNotice;
  matched_permit_ids: string[]; // date-overlapping permits only
  observation_id: string | null; // null -> card only, no map marker
}

export interface NoticeCache {
  refreshed_at: string | null;
  queries: string[];
  cards: NoticeCard[];
  errors: string[];
}

const storePath = () => process.env.NOTICE_STORE_PATH || path.join(process.cwd(), "data", "notices.json");

export function readNoticeCache(): NoticeCache {
  try {
    const raw = JSON.parse(fs.readFileSync(storePath(), "utf8"));
    if (raw && Array.isArray(raw.cards)) return raw as NoticeCache;
  } catch {
    /* missing: empty */
  }
  return { refreshed_at: null, queries: [], cards: [], errors: [] };
}

/** Merge new cards by source_url (newer wins) and persist. */
export function writeNoticeCache(update: NoticeCache): NoticeCache {
  const prev = readNoticeCache();
  const byUrl = new Map(prev.cards.map((c) => [c.notice.source_url, c]));
  for (const c of update.cards) byUrl.set(c.notice.source_url, c);
  const next: NoticeCache = { ...update, cards: [...byUrl.values()] };
  const p = storePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(next, null, 2));
  return next;
}
