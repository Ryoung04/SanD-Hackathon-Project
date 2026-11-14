// Match a news notice to official city traffic-control permits. Owner C.
// Pure function: permits are supplied by Owner A's data layer (or a script),
// so this module never fetches city data itself.

export interface PermitRecord {
  approval_id: string;
  traffic_control_type: string | null;
  block_information: string | null; // e.g. "C ST from 25TH ST to 26TH ST from 11/02/2026 ..."
  date_start: string | null; // YYYY-MM-DD
  date_end: string | null;
  lat: number;
  lon: number;
}

export interface PermitMatch {
  permit: PermitRecord;
  matched_streets: string[];
  match_basis: "street_pair_in_permit_block";
  date_overlap: "overlaps" | "no_overlap" | "unknown";
}

const SUFFIX = /\b(street|streets|st|avenue|ave|av|boulevard|blvd|road|rd|drive|dr|place|pl|way|alley|ln|lane)\b\.?/g;

/** "25th Street" -> "25th"; "C ST" -> "c"; "Fifth Ave" -> "5th". */
export function normalizeStreet(s: string): string {
  const ordinals: Record<string, string> = {
    first: "1st", second: "2nd", third: "3rd", fourth: "4th", fifth: "5th",
    sixth: "6th", seventh: "7th", eighth: "8th", ninth: "9th", tenth: "10th",
  };
  const t = s.toLowerCase().replace(SUFFIX, " ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  return ordinals[t] ?? t;
}

/** Streets named in BLOCK_INFORMATION: "<street> from <a> to <b> from <date>..." */
export function permitStreets(block: string | null): string[] {
  if (!block) return [];
  const head = block.split(/\sfrom\s+\d{1,2}\/\d{1,2}\/\d{4}/i)[0];
  const m = head.match(/^(.*?)\s+from\s+(.*?)\s+to\s+(.*)$/i);
  const parts = m ? [m[1], m[2], m[3]] : [head];
  return parts.map(normalizeStreet).filter((p) => p && !/^(end of|end)/.test(p));
}

function overlap(
  notice: { date_start: string | null; date_end: string | null; published_at: string | null },
  p: PermitRecord,
): PermitMatch["date_overlap"] {
  if (!p.date_start || !p.date_end) return "unknown";
  // Use explicit notice dates if given; else the article's publication day.
  const start = notice.date_start ?? notice.published_at?.slice(0, 10) ?? null;
  const end = notice.date_end ?? notice.date_start ?? notice.published_at?.slice(0, 10) ?? null;
  if (!start || !end) return "unknown";
  return start <= p.date_end && end >= p.date_start ? "overlaps" : "no_overlap";
}

/**
 * A permit matches when at least two distinct notice streets appear in the
 * permit's block description (e.g. "25th" and "c"). One shared street is too
 * weak (long corridors). Returned matches still don't prove sidewalk impact.
 */
export function matchNoticeToPermits(
  notice: { cross_streets: string[]; date_start: string | null; date_end: string | null; published_at: string | null },
  permits: PermitRecord[],
): PermitMatch[] {
  // Models sometimes return "25th and C streets" as one entry; split it.
  const wanted = [
    ...new Set(
      notice.cross_streets
        .flatMap((s) => s.split(/\s+(?:and|&|at)\s+|\s*\/\s*/i))
        .map(normalizeStreet)
        .filter(Boolean),
    ),
  ];
  if (wanted.length < 2) return [];
  const out: PermitMatch[] = [];
  for (const p of permits) {
    const streets = new Set(permitStreets(p.block_information));
    const hit = wanted.filter((w) => streets.has(w));
    if (hit.length >= 2)
      out.push({ permit: p, matched_streets: hit, match_basis: "street_pair_in_permit_block", date_overlap: overlap(notice, p) });
  }
  const rank = { overlaps: 0, unknown: 1, no_overlap: 2 };
  return out.sort((a, b) => rank[a.date_overlap] - rank[b.date_overlap]);
}
