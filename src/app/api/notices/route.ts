// GET /api/notices — cached construction notice cards (news via Bright Data,
// matched to city permits). Cards with observation_id also appear in
// /api/barriers as web_notice observations; others are card-only.
import { NextResponse } from "next/server";
import { readNoticeCache } from "@/lib/web/noticeStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const c = readNoticeCache();
  return NextResponse.json({
    data: c.cards,
    meta: {
      count: c.cards.length,
      refreshed_at: c.refreshed_at,
      data_mode: c.refreshed_at ? "cached_live" : "empty",
      source_note: "Third-party news reports retrieved via Bright Data; not official city records. Pedestrian impact unverified.",
    },
  });
}
