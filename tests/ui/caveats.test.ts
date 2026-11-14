import { test } from "node:test";
import assert from "node:assert/strict";
import { caveatFor, observedDateText } from "../../src/lib/ui/caveats";

type Obs = Parameters<typeof caveatFor>[0];
const mk = (o: Partial<Obs>): Obs => ({
  source_kind: "other",
  category: "other",
  verification_status: "unknown",
  source_observed_at: null,
  ...o,
});

test("city_311 caveat", () => {
  assert.equal(
    caveatFor(mk({ source_kind: "city_311", category: "sidewalk_obstruction" })),
    "Resident-submitted issue report. Status may not correspond to completed repair work.",
  );
});

test("traffic_control caveat", () => {
  assert.equal(
    caveatFor(mk({ source_kind: "traffic_control" })),
    "Scheduled traffic control nearby. This record alone does not confirm a sidewalk closure.",
  );
});

test("construction_warning category caveat (any source)", () => {
  assert.equal(
    caveatFor(mk({ source_kind: "web_notice", category: "construction_warning" })),
    "Scheduled traffic control nearby. This record alone does not confirm a sidewalk closure.",
  );
});

test("missing/noncompliant curb ramp from city_gis", () => {
  const expected =
    "Official planning inventory reports a curb-ramp deficit near this intersection. The exact affected crossing and current passability are not confirmed.";
  for (const category of ["missing_curb_ramp", "noncompliant_curb_ramp"] as const) {
    assert.equal(caveatFor(mk({ source_kind: "city_gis", category })), expected);
  }
});

test("generic fallback caveat", () => {
  assert.equal(
    caveatFor(mk({})),
    "Potential barrier from the listed source. Current conditions and passability are not confirmed.",
  );
});

test("ai_candidate with date", () => {
  assert.equal(
    caveatFor(mk({ source_kind: "street_imagery_ai", verification_status: "ai_candidate", source_observed_at: "2026-11-15T05:00:00Z" })),
    "AI-generated candidate observation based on imagery dated Nov 14, 2026. Requires review; does not certify accessibility.",
  );
});

test("ai_candidate with null date says unknown date", () => {
  assert.equal(
    caveatFor(mk({ source_kind: "street_imagery_ai", verification_status: "ai_candidate", source_observed_at: null })),
    "AI-generated candidate observation based on imagery dated unknown date. Requires review; does not certify accessibility.",
  );
});

test("AI wins over other rules", () => {
  const ai = "AI-generated candidate observation based on imagery dated unknown date.";
  assert.ok(caveatFor(mk({ source_kind: "city_311", verification_status: "ai_candidate" })).startsWith(ai));
  assert.ok(caveatFor(mk({ source_kind: "traffic_control", category: "construction_warning", verification_status: "ai_candidate" })).startsWith(ai));
  assert.ok(caveatFor(mk({ source_kind: "street_imagery_ai", category: "missing_curb_ramp" })).startsWith(ai));
});

test("observedDateText fallbacks", () => {
  for (const v of [null, undefined, "", "not-a-date"]) {
    assert.equal(observedDateText(v), "Observation date not available");
  }
});

test("observedDateText renders Pacific date", () => {
  assert.equal(observedDateText("2026-11-15T05:00:00Z"), "Nov 14, 2026");
  assert.equal(observedDateText("2026-07-01T12:00:00Z"), "Jul 1, 2026");
});
