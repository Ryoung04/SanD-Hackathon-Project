// POST /api/investigate — Mastra evidence brief for one map record (Owner C, OWNER_C §6).
// Body: { "barrier_id": string, "lat": number, "lon": number, "mode"?: "quick" | "agent" }  (lat/lon = the record's marker)
// mode "quick" (default): instant rule-based brief, no AI call. mode "agent": live Mastra agent (8–45 s, may 504).
// 200: { barrier_id, summary, supporting_observation_ids, source_links, conflicts, uncertainties,
//        recommendation_type: "informational_only", meta: { agent, model, tool_calls[] } }
// Errors: { error: { code, message } } — BAD_REQUEST 400, INVALID_LOCATION 400, NOT_FOUND 404,
//         RATE_LIMITED 429, AI_UPSTREAM/INVALID_OUTPUT 502, TIMEOUT 504, CONFIG 500.
import { NextResponse } from "next/server";
import { investigateBarrier, quickInvestigate, InvestigateError } from "@/lib/agents/investigate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const err = (status: number, code: string, message: string) => NextResponse.json({ error: { code, message } }, { status });

const hits = new Map<string, number[]>();
function rateLimited(ip: string, max = 6, windowMs = 60_000) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > max;
}

const inSanDiego = (lat: number, lon: number) => lat > 32.5 && lat < 33.6 && lon > -117.7 && lon < -116.0;
const STATUS: Record<InvestigateError["code"], number> = {
  CONFIG: 500, NOT_FOUND: 404, TIMEOUT: 504, AI_UPSTREAM: 502, INVALID_OUTPUT: 502,
};

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  if (rateLimited(ip)) return err(429, "RATE_LIMITED", "Too many investigations; try again in a minute");

  const raw: unknown = await req.json().catch(() => null);
  if (!raw || typeof raw !== "object") return err(400, "BAD_REQUEST", "JSON body required");
  const b = raw as { barrier_id?: unknown; lat?: unknown; lon?: unknown };
  if (typeof b.barrier_id !== "string" || !b.barrier_id.trim() || b.barrier_id.length > 300)
    return err(400, "BAD_REQUEST", "barrier_id (string) required");
  const lat = Number(b.lat);
  const lon = Number(b.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !inSanDiego(lat, lon))
    return err(400, "INVALID_LOCATION", "lat/lon must be the record's location in San Diego County");

  const mode = (raw as { mode?: unknown }).mode === "agent" ? "agent" : "quick";
  try {
    if (mode === "quick") {
      const q = await quickInvestigate({ barrier_id: b.barrier_id, lat, lon });
      return NextResponse.json({
        ...q.brief,
        meta: { agent: "rules", mode, model: null, tool_calls: [], note: "Built from the listed public records; no AI summary. Not a verification of current conditions." },
      });
    }
    const r = await investigateBarrier({ barrier_id: b.barrier_id, lat, lon });
    return NextResponse.json({
      ...r.brief,
      meta: {
        agent: "mastra",
        mode,
        model: r.model,
        tool_calls: r.trace.map((t) => ({ tool: t.tool, input: t.input, result_count: t.result_ids.length, ms: t.ms })),
        note: "AI-generated summary of the listed records only. Not a verification of current conditions.",
      },
    });
  } catch (e) {
    if (e instanceof InvestigateError) return err(STATUS[e.code], e.code, e.message);
    return err(502, "AI_UPSTREAM", "Investigation failed");
  }
}
