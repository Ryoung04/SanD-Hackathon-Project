import { test } from "vitest";
import assert from "node:assert/strict";
import { normalizeStreet, permitStreets, matchNoticeToPermits, type PermitRecord } from "@/lib/web/permitMatch";
import { groundNotice } from "@/lib/ai/validate";
import { assertAllowedUrl } from "@/lib/web/brightData";
import { parseCommonsDate } from "@/lib/ai/imageSources";

const permit = (id: string, block: string, start: string, end: string): PermitRecord => ({
  approval_id: id, traffic_control_type: "Other Work", block_information: block,
  date_start: start, date_end: end, lat: 32.717119, lon: -117.140021,
});

test("normalizeStreet", () => {
  assert.equal(normalizeStreet("25th Street"), "25th");
  assert.equal(normalizeStreet("C ST"), "c");
  assert.equal(normalizeStreet("Fifth Ave."), "5th");
});

test("permitStreets parses block info", () => {
  assert.deepEqual(permitStreets("C ST from 25TH ST to 26TH ST from 11/02/2026 at 08:00 AM to 11/10/2026"), ["c", "25th", "26th"]);
  assert.deepEqual(permitStreets("Alley E/O 26th St from E ST to End of Alley from 11/18/2026"), ["e o 26th", "e"]);
  assert.deepEqual(permitStreets(null), []);
});

test("matches street pair and ranks overlapping dates first", () => {
  const notice = { cross_streets: ["25th Street", "C Street"], date_start: null, date_end: null, published_at: "2026-11-09T20:10:15Z" };
  const m = matchNoticeToPermits(notice, [
    permit("FUTURE", "C ST from 25TH ST to 26TH ST from 11/18/2026", "2026-11-18", "2027-01-15"),
    permit("ACTIVE", "25TH ST from C ST to B ST from 07/01/2026", "2026-07-01", "2026-11-17"),
    permit("OTHER", "BROADWAY from 26TH ST to 27TH ST from 11/19/2026", "2026-11-19", "2026-12-10"),
  ]);
  assert.deepEqual(m.map((x) => [x.permit.approval_id, x.date_overlap]), [["ACTIVE", "overlaps"], ["FUTURE", "no_overlap"]]);
});

test("combined cross-street string is split", () => {
  const notice = { cross_streets: ["25th and C streets"], date_start: null, date_end: null, published_at: "2026-11-09T20:10:15Z" };
  const m = matchNoticeToPermits(notice, [permit("ACTIVE", "25TH ST from C ST to B ST from 07/01/2026", "2026-07-01", "2026-11-17")]);
  assert.deepEqual(m.map((x) => x.matched_streets), [["25th", "c"]]);
});

test("single street is not a match", () => {
  const notice = { cross_streets: ["Broadway"], date_start: null, date_end: null, published_at: null };
  assert.equal(matchNoticeToPermits(notice, [permit("X", "BROADWAY from 1ST to 2ND from 1/1/2026", "2026-01-01", "2026-02-01")]).length, 0);
});

test("groundNotice drops hallucinated quotes and streets", () => {
  const src = "Crews at 25th and C streets. The sidewalk on C Street is closed until Friday.";
  const g = groundNotice(
    { construction_mentioned: true, location_text: null, cross_streets: ["25th Street", "C Street", "Market Street"],
      date_start: null, date_end: null,
      pedestrian_impact_quotes: ["The sidewalk on C Street is closed until Friday.", "Pedestrians must detour via Broadway."] },
    src,
  );
  assert.deepEqual(g.cross_streets, ["25th Street", "C Street"]);
  assert.deepEqual(g.pedestrian_impact_quotes, ["The sidewalk on C Street is closed until Friday."]);
  assert.equal(g.dropped_quotes, 1);
});

test("Bright Data URL guard", () => {
  assert.throws(() => assertAllowedUrl("https://www.sandiego.gov/cip"), /government/);
  assert.throws(() => assertAllowedUrl("http://timesofsandiego.com/x"), /https only/);
  assert.throws(() => assertAllowedUrl("https://169.254.169.254/latest"), /not allowlisted/);
  assert.equal(assertAllowedUrl("https://timesofsandiego.com/wp-json/wp/v2/posts").hostname, "timesofsandiego.com");
});

test("parseCommonsDate", () => {
  assert.equal(parseCommonsDate("23 April 2020 (according to <span>Exif data</span>)"), "2020-04-23");
  assert.equal(parseCommonsDate("2017-10-16 15:22"), "2017-10-16");
  assert.equal(parseCommonsDate(""), null);
});

test("noticeToObservation passes Owner A's validator; no overlap -> null", async () => {
  const { noticeToObservation } = await import("@/lib/web/noticeExtractor");
  const { validateObservation } = await import("@/lib/data/normalizers");
  const notice = {
    source_url: "https://timesofsandiego.com/business/2026/11/09/example-slug/", source_name: "Times of San Diego" as const,
    source_type: "news_report" as const, page_title: "t", published_at: "2026-11-09T20:10:15Z", retrieved_at: "2026-11-14T19:39:16Z",
    retrieved_via: "bright_data_web_unlocker" as const, construction_mentioned: true, location_text: null,
    cross_streets: ["25th Street", "C Street"], date_start: null, date_end: null, pedestrian_impact_language: [],
    pedestrian_impact_found: false, location_confidence: "text_only" as const, geocoding_method: "none" as const, extraction_model: "test",
  };
  const permits = [
    permit("A1", "25TH ST from C ST to B ST from 07/01/2026", "2026-07-01", "2026-11-17"),
    permit("A2", "C ST from 25TH ST to 26TH ST from 09/29/2026", "2026-09-29", "2026-11-17"),
    permit("F1", "C ST from 25TH ST to 26TH ST from 11/18/2026", "2026-11-18", "2027-01-15"),
  ];
  const obs = noticeToObservation(notice, matchNoticeToPermits(notice, permits))!;
  assert.deepEqual(validateObservation(obs), { ok: true, errors: [] });
  assert.equal(obs.verification_status, "unverified_report");
  assert.equal(obs.routing_impact, "unknown");
  assert.equal(obs.evidence.length, 3); // news + 2 overlapping permits, not the future one
  assert.equal(noticeToObservation(notice, matchNoticeToPermits(notice, permits.slice(2))), null);
});

test("imageToObservations: ai_candidate at camera point; no location -> none", async () => {
  const { imageToObservations } = await import("@/lib/ai/imageObservations");
  const { validateObservation } = await import("@/lib/data/normalizers");
  const analysis = {
    status: "candidate" as const, image_reference: "upload:abc", captured_at: null, requires_human_review: true as const,
    candidate_observations: [{ category: "sidewalk_obstruction" as const, explanation: "Fence near path; width unknown",
      model_confidence: "possible" as const, verification_status: "ai_candidate" as const, routing_impact: "unknown" as const }],
    curb_ramp_visibility: "not_determinable" as const, no_clear_evidence: false, image_quality_notes: "", dropped_for_unsupported_claims: 0,
    model: "test", analyzed_at: "2026-11-14T20:00:00.000Z",
  };
  const image = { image_reference: "upload:abc", source: "participant_upload" as const, page_url: null,
    license: "submitted_with_permission", attribution: null, captured_at: null, camera_location: null };
  assert.deepEqual(imageToObservations(analysis, image, null), []);
  const [o] = imageToObservations(analysis, image, { lat: 32.72, lon: -117.16, basis: "user_supplied" });
  assert.deepEqual(validateObservation(o), { ok: true, errors: [] });
  assert.equal(o.verification_status, "ai_candidate");
  assert.equal(o.routing_impact, "unknown");
  assert.equal(o.geometry_precision, "approximate_point");
  assert.equal(o.source_observed_at, null); // never upload time
});
