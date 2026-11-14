// Mastra evidence investigation agent (Owner C, OWNER_C §6). Server-only.
// Tools are closures bound to ONE barrier + location chosen by the server: the model can
// only pick a search radius, never a URL, id, or arbitrary place. Output goes through
// finalizeBrief (ids/links must come from tool results; forbidden claims rejected).
import "server-only";
import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { listObservations } from "@/lib/data/observations";
import { haversineMeters, padBbox } from "@/lib/data/geo";
import type { BarrierObservation, Bbox, Geometry } from "@/lib/data/types";
import { readNoticeCache } from "@/lib/web/noticeStore";
import { BriefDraft, finalizeBrief, type EvidenceBrief, type SeenRecord } from "./brief";

// flash-lite first: 3.5-flash often stalls (503/timeouts) and the fallback cost ~35 s in testing.
const DEFAULT_MODELS = ["gemini-3.1-flash-lite", "gemini-3.5-flash"];
const MAX_STEPS = 6;
const TIMEOUT_MS = 45_000;
const LOOKUP_PAD_M = 60;

export class InvestigateError extends Error {
  constructor(public code: "CONFIG" | "NOT_FOUND" | "TIMEOUT" | "AI_UPSTREAM" | "INVALID_OUTPUT", message: string) {
    super(message);
  }
}

export interface TraceEntry {
  tool: string;
  input: Record<string, unknown>;
  result_ids: string[];
  ms: number;
}

export interface InvestigateResult {
  brief: EvidenceBrief;
  trace: TraceEntry[];
  model: string | null;
}

const anchor = (g: Geometry): [number, number] => (g.type === "Point" ? g.coordinates : g.coordinates[0]);
const pointBbox = (lon: number, lat: number, m: number): Bbox => padBbox([lon, lat, lon, lat], m);

/** Trim a record to what the model needs; description capped (311 text can be long). */
function view(o: BarrierObservation, from?: [number, number]) {
  const [lon, lat] = anchor(o.geometry);
  return {
    id: o.id,
    category: o.category,
    label: o.label,
    source_kind: o.source_kind,
    verification_status: o.verification_status,
    routing_impact: o.routing_impact,
    geometry_precision: o.geometry_precision,
    source_observed_at: o.source_observed_at,
    source_url: o.source_url,
    description: (o.description || "").slice(0, 240),
    ...(from ? { distance_m: Math.round(haversineMeters(from, [lon, lat])) } : {}),
    ...(o.source_kind === "traffic_control"
      ? { permit_dates: { start: (o.metadata as any)?.date_start ?? null, end: (o.metadata as any)?.date_end ?? null } }
      : {}),
  };
}

/** Find the barrier by id near the point the client says it is (A has no get-by-id API). */
export async function getBarrierNear(id: string, lat: number, lon: number): Promise<BarrierObservation | null> {
  const r = await listObservations({ bbox: pointBbox(lon, lat, LOOKUP_PAD_M), limit: 500 });
  return r.data.find((o) => o.id === id) ?? null;
}

function modelChain() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new InvestigateError("CONFIG", "GEMINI_API_KEY not set");
  const ids = (process.env.INVESTIGATE_MODELS?.split(",").map((s) => s.trim()).filter(Boolean) ?? DEFAULT_MODELS);
  return ids.map((m) => ({ model: { id: `google/${m}` as `${string}/${string}`, apiKey: key }, maxRetries: 1 }));
}

const INSTRUCTIONS = `You are an evidence investigator for a San Diego accessibility-awareness map.
You receive one selected map record. Use the tools to gather evidence, then write a short brief.

Process: call get_barrier first; then get_nearby_records; then get_construction_notices.
Compare source types (official inventory vs 311 report vs permit vs news notice vs AI candidate),
dates, verification status, and geographic precision.

Hard rules:
- Use ONLY facts present in tool results. Never invent reports, street names, dates, conditions, or links.
- supporting_observation_ids and source_links must be copied exactly from tool results.
- Never say a place/route is accessible, ADA compliant, wheelchair safe, passable, or verified. Unknown stays unknown.
- A construction permit or news article is not proof a sidewalk is blocked. An intersection-level record does not say which corner.
- If sources disagree (e.g. official vs AI candidate, or dates do not overlap), list it under conflicts; do not pick a winner.
- Put what cannot be known (current condition, exact corner, whether a permit affects the sidewalk) in uncertainties.
- summary: 1-3 plain sentences for a resident. Do not include record ids in the summary. No recommendations to travel or avoid.`;

/** Run the agent for one barrier. Throws InvestigateError. */
export async function investigateBarrier(input: { barrier_id: string; lat: number; lon: number }): Promise<InvestigateResult> {
  const models = modelChain();
  const barrier = await getBarrierNear(input.barrier_id, input.lat, input.lon);
  if (!barrier) throw new InvestigateError("NOT_FOUND", "No current record with that id near the given location");

  const at = anchor(barrier.geometry);
  const seen = new Map<string, SeenRecord>([[barrier.id, { id: barrier.id, source_url: barrier.source_url }]]);
  const trace: TraceEntry[] = [];
  const record = async <T>(tool: string, inp: Record<string, unknown>, fn: () => Promise<{ ids: string[]; out: T }>) => {
    const t0 = Date.now();
    const { ids, out } = await fn();
    trace.push({ tool, input: inp, result_ids: ids, ms: Date.now() - t0 });
    return out;
  };
  const remember = (os: BarrierObservation[]) => os.forEach((o) => seen.set(o.id, { id: o.id, source_url: o.source_url }));

  const getBarrier = createTool({
    id: "get_barrier",
    description: "Return the selected map record (source, dates, verification status, precision).",
    inputSchema: z.object({}),
    execute: async () => record("get_barrier", {}, async () => ({ ids: [barrier.id], out: view(barrier) })),
  });

  const getNearby = createTool({
    id: "get_nearby_records",
    description: "Other current records (official GIS, 311, traffic permits, AI candidates) within radius_m of the selected record, nearest first.",
    inputSchema: z.object({ radius_m: z.number().min(20).max(200).default(100) }),
    execute: async (args: { radius_m?: number }) => {
      const radius = Math.min(Math.max(Number(args?.radius_m) || 100, 20), 200);
      return record("get_nearby_records", { radius_m: radius }, async () => {
        const r = await listObservations({ bbox: pointBbox(at[0], at[1], radius), limit: 200 });
        const near = r.data
          .filter((o) => o.id !== barrier.id && o.source_kind !== "web_notice")
          .map((o) => ({ o, d: haversineMeters(at, anchor(o.geometry)) }))
          .filter((x) => x.d <= radius)
          .sort((a, b) => a.d - b.d)
          .slice(0, 15)
          .map((x) => x.o);
        remember(near);
        return { ids: near.map((o) => o.id), out: { radius_m: radius, count: near.length, records: near.map((o) => view(o, at)) } };
      });
    },
  });

  const getNotices = createTool({
    id: "get_construction_notices",
    description: "News-based construction notices (unverified) within 400 m that were matched to city permits by street names and dates.",
    inputSchema: z.object({}),
    execute: async () =>
      record("get_construction_notices", { radius_m: 400 }, async () => {
        const r = await listObservations({ bbox: pointBbox(at[0], at[1], 400), categories: ["construction_warning"], limit: 200 });
        const obs = r.data.filter((o) => o.source_kind === "web_notice");
        const cards = new Map(readNoticeCache().cards.filter((c) => c.observation_id).map((c) => [c.observation_id!, c]));
        remember(obs);
        const out = obs.map((o) => {
          const c = cards.get(o.id);
          return {
            ...view(o, at),
            page_title: c?.notice.page_title ?? null,
            published_at: c?.notice.published_at ?? null,
            pedestrian_impact_found: c?.notice.pedestrian_impact_found ?? false,
            matched_permit_ids: c?.matched_permit_ids ?? [],
          };
        });
        return { ids: obs.map((o) => o.id), out: { count: out.length, notices: out } };
      }),
  });

  const agent = new Agent({
    id: "evidence-investigator",
    name: "Evidence investigator",
    instructions: INSTRUCTIONS,
    model: models,
    tools: { get_barrier: getBarrier, get_nearby_records: getNearby, get_construction_notices: getNotices },
  });

  // One shared deadline. Structured output is occasionally missing/malformed (seen ~1 in 6
  // live runs), so retry once if enough time remains; never retry on timeout/upstream errors.
  const deadline = AbortSignal.timeout(TIMEOUT_MS);
  const started = Date.now();
  let lastInvalid = "Agent did not return a valid brief";
  for (let attempt = 1; attempt <= 2; attempt++) {
    let res: any;
    try {
      res = await agent.generate(
        `Investigate map record ${JSON.stringify(barrier.id)}. Use the tools, then return the brief.`,
        { maxSteps: MAX_STEPS, abortSignal: deadline, structuredOutput: { schema: BriefDraft } } as any,
      );
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      if (deadline.aborted || /abort|timeout/i.test(msg)) throw new InvestigateError("TIMEOUT", `Agent exceeded ${TIMEOUT_MS / 1000}s`);
      throw new InvestigateError("AI_UPSTREAM", msg.slice(0, 200));
    }
    const parsed = BriefDraft.safeParse(res?.object);
    if (parsed.success) {
      try {
        return { brief: finalizeBrief(barrier.id, parsed.data, [...seen.values()]), trace, model: res?.response?.modelId ?? null };
      } catch (e) {
        lastInvalid = (e as Error).message;
      }
    }
    if (Date.now() - started > TIMEOUT_MS - 15_000) break;
  }
  throw new InvestigateError("INVALID_OUTPUT", lastInvalid);
}
