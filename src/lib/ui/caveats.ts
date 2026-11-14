import type { BarrierObservation, SourceKind, VerificationStatus } from "./barrierTypes";

/** Required detail-panel language (OWNER_B §4). */
export function caveatFor(obs: Pick<BarrierObservation, "source_kind" | "category" | "verification_status" | "source_observed_at">): string {
  if (obs.source_kind === "street_imagery_ai" || obs.verification_status === "ai_candidate") {
    const d = obs.source_observed_at ? formatPacificDate(obs.source_observed_at) : "unknown date";
    return `AI-generated candidate observation based on imagery dated ${d}. Requires review; does not certify accessibility.`;
  }
  if (obs.source_kind === "city_311") {
    return "Resident-submitted issue report. Status may not correspond to completed repair work.";
  }
  if (obs.source_kind === "traffic_control" || obs.category === "construction_warning") {
    return "Scheduled traffic control nearby. This record alone does not confirm a sidewalk closure.";
  }
  if (obs.category === "missing_curb_ramp" || obs.category === "noncompliant_curb_ramp") {
    return "Official planning inventory reports a curb-ramp deficit near this intersection. The exact affected crossing and current passability are not confirmed.";
  }
  return "Potential barrier from the listed source. Current conditions and passability are not confirmed.";
}

export const SOURCE_LABELS: Record<SourceKind, string> = {
  city_gis: "City GIS (official)",
  county_gis: "County GIS (official)",
  city_311: "311 resident report",
  traffic_control: "Construction / traffic control",
  web_notice: "Public web notice",
  street_imagery_ai: "AI candidate (imagery)",
  community_report: "Community report",
  other: "Other source",
};

/** Short glyph so meaning never depends on color alone. */
export const SOURCE_GLYPHS: Record<SourceKind, string> = {
  city_gis: "G",
  county_gis: "C",
  city_311: "R",
  traffic_control: "T",
  web_notice: "N",
  street_imagery_ai: "AI",
  community_report: "P",
  other: "?",
};

export const SOURCE_COLORS: Record<SourceKind, string> = {
  city_gis: "#1d4ed8",
  county_gis: "#1e3a8a",
  city_311: "#b45309",
  traffic_control: "#c2410c",
  web_notice: "#4d7c0f",
  street_imagery_ai: "#7e22ce",
  community_report: "#0f766e",
  other: "#475569",
};

export const VERIFICATION_LABELS: Record<VerificationStatus, string> = {
  official_inventory: "Official inventory (origin authenticated; current condition not guaranteed)",
  unverified_report: "Unverified report",
  ai_candidate: "AI candidate — requires review",
  community_confirmed: "Community confirmed",
  human_reviewed: "Human reviewed",
  outdated: "Outdated",
  unknown: "Verification unknown",
};

const PACIFIC = "America/Los_Angeles";

/** UTC ISO -> Pacific date string. Returns null for missing/invalid input; never substitutes "now". */
export function formatPacificDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: PACIFIC,
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

export function observedDateText(iso: string | null | undefined): string {
  return formatPacificDate(iso) ?? "Observation date not available";
}

export function dateOrUnknown(iso: string | null | undefined): string {
  return formatPacificDate(iso) ?? "Unknown";
}

/** "missing_curb_ramp" -> "Missing curb ramp" */
export function humanize(value: string): string {
  const s = value.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
