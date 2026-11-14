// POST /api/notices/refresh — runs the bounded notice pipeline (costs Bright
// Data + Gemini credits). Requires header `x-admin-token: $ADMIN_TOKEN`.
// Body (optional JSON): { "days": 60, "save": true }
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { refreshNotices } from "@/lib/web/noticePipeline";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const err = (status: number, code: string, message: string) => NextResponse.json({ error: { code, message } }, { status });

function authorized(req: Request) {
  const want = process.env.ADMIN_TOKEN;
  const got = req.headers.get("x-admin-token");
  if (!want || !got || want.length !== got.length) return false;
  return timingSafeEqual(Buffer.from(want), Buffer.from(got));
}

let running = false;

export async function POST(req: Request) {
  if (!authorized(req)) return err(401, "UNAUTHORIZED", "Admin token required");
  if (running) return err(409, "BUSY", "A refresh is already running");
  const raw: unknown = await req.json().catch(() => null);
  const body = (raw && typeof raw === "object" ? raw : {}) as { days?: unknown; save?: unknown };
  const days = Math.min(Math.max(Number(body.days) || 60, 1), 120);
  running = true;
  try {
    const r = await refreshNotices({ days, save: body.save !== false });
    return NextResponse.json({
      refreshed_at: r.refreshed_at,
      cards: r.cards.length,
      with_map_marker: r.cards.filter((c) => c.observation_id).length,
      saved: r.saved,
      errors: r.errors,
    });
  } catch (e) {
    return err(502, "PIPELINE_FAILED", (e as Error).message.slice(0, 200));
  } finally {
    running = false;
  }
}
