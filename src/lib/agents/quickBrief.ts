// Deterministic evidence brief (Owner C). No model call: every sentence is built from record
// fields, so it is instant, free, and cannot invent facts. Same shape as the Mastra brief.
import type { BarrierObservation, Geometry } from "@/lib/data/types";
import { haversineMeters } from "@/lib/data/geo";
import { BASELINE_UNCERTAINTIES, type EvidenceBrief } from "./brief";
import type { ImageryCheck } from "@/lib/ai/imageryChecks";

export const QUICK_RADIUS_M = 100;
const anchor = (g: Geometry): [number, number] => (g.type === "Point" ? g.coordinates : g.coordinates[0]);
const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : null);
const isHttp = (u: string) => /^https?:\/\//.test(u);
const m = (o: BarrierObservation, k: string) => (o.metadata as Record<string, unknown>)?.[k];

function describe(o: BarrierObservation): { text: string; uncertain: string[] } {
  switch (o.source_kind) {
    case "city_gis": {
      const aps = Number(m(o, "APS_DEFICIT") ?? 0);
      if (o.category === "crossing_issue" && aps > 0)
        return {
          text: `The City of San Diego's inventory lists this intersection as missing accessible pedestrian signals at ${aps} crossing${aps === 1 ? "" : "s"}.`,
          uncertain: ["Which crossings lack accessible signals is not recorded."],
        };
      const def = m(o, "RAMP_DEFICIT"), req = m(o, "RAMPS_REQUIRED");
      return {
        text: def != null && req != null
          ? `The City of San Diego's curb-ramp inventory lists this intersection as missing ${def} of ${req} required curb ramps.`
          : `The City of San Diego's curb-ramp inventory lists a curb-ramp deficit at this intersection.`,
        uncertain: ["Which corner is missing a ramp is not recorded.", "The inventory has no inspection date; a ramp may have been built since."],
      };
    }
    case "city_311":
      return {
        text: `A resident 311 report${day(o.source_observed_at) ? ` filed ${day(o.source_observed_at)}` : ""} is listed here: ${o.label}.`,
        uncertain: ["311 reports are unverified resident submissions; the location is an approximate address point."],
      };
    case "traffic_control": {
      const s = day(m(o, "date_start") as string), e = day(m(o, "date_end") as string);
      return {
        text: `A city traffic-control permit is active nearby${s && e ? ` (${s} to ${e})` : ""}.`,
        uncertain: ["A traffic-control permit does not confirm that the sidewalk is closed."],
      };
    }
    case "web_notice":
      return {
        text: `A news report mentions construction near here.`,
        uncertain: ["The news report does not state a pedestrian or sidewalk impact."],
      };
    case "street_imagery_ai":
      return {
        text: `An AI review of a street photo flagged a possible issue here: ${o.label}.`,
        uncertain: ["This is an AI reading of one photo and has not been reviewed by a person."],
      };
    default:
      return { text: `${o.label}.`, uncertain: [] };
  }
}

function years(os: BarrierObservation[]) {
  const ys = os.map((o) => day(o.source_observed_at)?.slice(0, 4)).filter(Boolean).sort() as string[];
  return ys.length ? (ys[0] === ys[ys.length - 1] ? ` (${ys[0]})` : ` (${ys[0]}–${ys[ys.length - 1]})`) : "";
}

/** Build a brief from the selected record, current records nearby, and an optional photo check. */
export function buildQuickBrief(barrier: BarrierObservation, around: BarrierObservation[], photo: ImageryCheck | null): EvidenceBrief {
  const at = anchor(barrier.geometry);
  const near = around
    .filter((o) => o.id !== barrier.id)
    .map((o) => ({ o, d: haversineMeters(at, anchor(o.geometry)) }))
    .filter((x) => x.d <= QUICK_RADIUS_M)
    .sort((a, b) => a.d - b.d)
    .map((x) => x.o);

  const main = describe(barrier);
  const sentences = [main.text];
  const uncertainties = [...BASELINE_UNCERTAINTIES, ...main.uncertain];
  const conflicts: string[] = [];

  const r311 = near.filter((o) => o.source_kind === "city_311");
  const permits = near.filter((o) => o.source_kind === "traffic_control");
  const city = near.filter((o) => o.source_kind === "city_gis");
  const ai = near.filter((o) => o.source_kind === "street_imagery_ai");
  const parts = [
    r311.length && `${r311.length} open 311 sidewalk/curb report${r311.length === 1 ? "" : "s"}${years(r311)}`,
    permits.length && `${permits.length} active traffic-control permit${permits.length === 1 ? "" : "s"}`,
    city.length && `${city.length} other city inventory record${city.length === 1 ? "" : "s"}`,
    ai.length && `${ai.length} AI photo flag${ai.length === 1 ? "" : "s"} (unverified)`,
  ].filter(Boolean) as string[];
  sentences.push(parts.length ? `Within ${QUICK_RADIUS_M} m: ${parts.join(", ")}.` : `No other current records within ${QUICK_RADIUS_M} m.`);
  if (permits.length && barrier.source_kind !== "traffic_control") uncertainties.push("Nearby permits do not confirm that any sidewalk is closed.");

  const links: string[] = [];
  if (photo?.status === "analyzed" && photo.image) {
    const seen =
      photo.curb_ramp_visibility === "visibly_present" ? "shows at least one curb ramp"
      : photo.curb_ramp_visibility === "not_visible" ? "shows a corner without a visible curb ramp"
      : "does not clearly show the corner";
    sentences.push(`A street photo from ${photo.image.captured_at} ${seen} (AI reading of one photo, unverified).`);
    links.push(photo.image.page_url);
    const existing = m(barrier, "RAMPS_EXISTING");
    if (photo.curb_ramp_visibility === "visibly_present" && barrier.source_kind === "city_gis" && existing === 0)
      conflicts.push("The city inventory records no existing ramps here, but an AI reading of a street photo shows a ramp.");
    if (photo.curb_ramp_visibility !== "visibly_present") uncertainties.push("One photo cannot show every corner; a ramp not visible in it may still exist.");
  }

  const cited = [barrier, ...near.slice(0, 10)];
  for (const o of cited) if (isHttp(o.source_url)) links.push(o.source_url);

  return {
    barrier_id: barrier.id,
    summary: sentences.join(" "),
    supporting_observation_ids: cited.map((o) => o.id),
    source_links: [...new Set(links)],
    conflicts,
    uncertainties: [...new Set(uncertainties)],
    recommendation_type: "informational_only",
  };
}
