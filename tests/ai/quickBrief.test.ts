import { describe, it, expect } from "vitest";
import { buildQuickBrief } from "@/lib/agents/quickBrief";
import { noForbiddenClaim } from "@/lib/ai/validate";
import type { BarrierObservation } from "@/lib/data/types";

const o = (id: string, kind: BarrierObservation["source_kind"], lon: number, lat: number, extra: Partial<BarrierObservation> = {}): BarrierObservation => ({
  id, category: "sidewalk_damage", label: id, geometry: { type: "Point", coordinates: [lon, lat] }, geometry_precision: "approximate_point",
  source_kind: kind, source_record_id: id, source_url: `https://example.org/${id}`, source_observed_at: null, source_updated_at: null,
  ingested_at: "2026-11-14T00:00:00Z", verification_status: "unverified_report", routing_impact: "unknown", severity: "unknown",
  description: "", evidence: [], metadata: {}, ...extra,
});
const ramp = o("city_gis:prowag2:1", "city_gis", -117.17, 32.73, { category: "missing_curb_ramp", metadata: { RAMP_DEFICIT: 1, RAMPS_REQUIRED: 3, RAMPS_EXISTING: 2 } });
const near = [
  o("city_311:1", "city_311", -117.1701, 32.7301, { label: "Sidewalk repair issue", source_observed_at: "2021-03-01T00:00:00Z" }),
  o("city_311:2", "city_311", -117.1702, 32.7300, { label: "Sidewalk repair issue", source_observed_at: "2025-06-01T00:00:00Z" }),
  o("traffic_control:9", "traffic_control", -117.1699, 32.7299, { metadata: { date_start: "2026-11-01T00:00:00Z", date_end: "2026-12-01T00:00:00Z" } }),
  o("city_311:far", "city_311", -117.16, 32.73),
];
const photo = (vis: string, existing?: number) => ({
  barrier_id: ramp.id, checked_at: "", status: "analyzed" as const, curb_ramp_visibility: vis as any, no_clear_evidence: false,
  candidates: [], observation_ids: [], image_quality_notes: null, model: "m", error: null,
  image: { reference: "mapillary:5", page_url: "https://www.mapillary.com/app/?pKey=5", captured_at: "2024-12-17", license: "CC BY-SA 4.0", attribution: "x", distance_m: 5, heading_off_deg: 1 },
});

describe("buildQuickBrief", () => {
  it("states the city deficit, nearby counts with year range, and corner uncertainty", () => {
    const b = buildQuickBrief(ramp, near, null);
    expect(b.summary).toContain("missing 1 of 3 required curb ramps");
    expect(b.summary).toContain("Within 100 m: 2 open 311 sidewalk/curb reports (2021–2025), 1 active traffic-control permit.");
    expect(b.supporting_observation_ids[0]).toBe("city_gis:prowag2:1");
    expect(b.supporting_observation_ids).not.toContain("city_311:far");
    expect(b.uncertainties.join(" ")).toMatch(/Which corner/);
    expect(b.uncertainties.join(" ")).toMatch(/do not confirm that any sidewalk is closed/);
    expect(b.recommendation_type).toBe("informational_only");
  });
  it("adds the photo reading and links it; conflict only when city says 0 existing", () => {
    const b1 = buildQuickBrief(ramp, [], photo("visibly_present"));
    expect(b1.summary).toContain("A street photo from 2024-12-17 shows at least one curb ramp");
    expect(b1.source_links).toContain("https://www.mapillary.com/app/?pKey=5");
    expect(b1.conflicts).toEqual([]);
    const none = { ...ramp, metadata: { ...ramp.metadata, RAMPS_EXISTING: 0 } };
    expect(buildQuickBrief(none, [], photo("visibly_present")).conflicts).toHaveLength(1);
    expect(buildQuickBrief(ramp, [], photo("not_visible")).uncertainties.join(" ")).toMatch(/may still exist/);
  });
  it("never makes a forbidden accessibility claim", () => {
    for (const p of [null, photo("visibly_present"), photo("not_visible"), photo("not_determinable")]) {
      const b = buildQuickBrief(ramp, near, p);
      for (const t of [b.summary, ...b.conflicts, ...b.uncertainties]) expect(noForbiddenClaim(t)).toBe(true);
    }
  });
  it("handles every source kind as the selected record", () => {
    for (const r of near) expect(buildQuickBrief(r, near, null).summary.length).toBeGreaterThan(20);
  });
});
