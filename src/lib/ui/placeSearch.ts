// Offline place/intersection search over a pre-fetched OSM snapshot (public/data/downtown-places.json).
// Pure functions only: no network, no DOM.

export type Place = { name: string; kind: string; lat: number; lon: number };

export type PlacesBbox = readonly [number, number, number, number]; // [west, south, east, north]

/** Study area used for filtering when a caller does not pass one. */
const DEFAULT_BBOX: PlacesBbox = [-117.175, 32.712, -117.15, 32.73];

const STREET_HIGHWAYS = new Set([
  "motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "living_street", "pedestrian",
]);

const NAME_DEDUPE_M = 30;
const PAIR_DEDUPE_M = 40;

function metersBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = (b.lat - a.lat) * 111_320;
  const dLon = (b.lon - a.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

function inBbox(lat: number, lon: number, bbox: PlacesBbox): boolean {
  return lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];
}

function poiKind(t: Record<string, string>): string | null {
  if (t.amenity) return t.amenity.replace(/_/g, " ");
  if (t.tourism) return t.tourism.replace(/_/g, " ");
  if (t.leisure) return t.leisure === "park" ? "park" : t.leisure.replace(/_/g, " ");
  if (t.shop) return "shop";
  if (t.railway === "station" || t.railway === "tram_stop" || t.public_transport) return "transit stop";
  if (t.building) return "building";
  return null;
}

/**
 * Convert an Overpass JSON payload (POIs with `center`/lat/lon, plus highway ways with `nodes`
 * and their skeleton nodes) into deduplicated, bbox-filtered Places.
 */
export function buildPlacesFromOverpass(json: any, bbox: PlacesBbox = DEFAULT_BBOX): Place[] {
  const elements: any[] = Array.isArray(json?.elements) ? json.elements : [];
  const nodeXY = new Map<number, { lat: number; lon: number }>();
  for (const el of elements) {
    if (el.type === "node" && typeof el.lat === "number" && typeof el.lon === "number") {
      nodeXY.set(el.id, { lat: el.lat, lon: el.lon });
    }
  }

  const pois: Place[] = [];
  const nodeNames = new Map<number, Set<string>>();

  for (const el of elements) {
    const tags: Record<string, string> = el.tags ?? {};
    const name = typeof tags.name === "string" ? tags.name.trim() : "";
    if (!name) continue;

    if (el.type === "way" && tags.highway) {
      if (!STREET_HIGHWAYS.has(tags.highway) || !Array.isArray(el.nodes)) continue;
      for (const nid of el.nodes) {
        let s = nodeNames.get(nid);
        if (!s) nodeNames.set(nid, (s = new Set()));
        s.add(name);
      }
      continue;
    }

    const kind = poiKind(tags);
    if (!kind) continue;
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (typeof lat !== "number" || typeof lon !== "number") continue;
    if (!inBbox(lat, lon, bbox)) continue;
    pois.push({ name, kind, lat: r6(lat), lon: r6(lon) });
  }

  // Intersections: nodes shared by ways with different names.
  const crossings: Place[] = [];
  const pairSeen = new Map<string, Place[]>();
  const nodeIds = [...nodeNames.keys()].sort((a, b) => a - b);
  for (const nid of nodeIds) {
    const names = [...nodeNames.get(nid)!].sort((a, b) => a.localeCompare(b));
    if (names.length < 2) continue;
    const xy = nodeXY.get(nid);
    if (!xy || !inBbox(xy.lat, xy.lon, bbox)) continue;
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const name = `${names[i]} & ${names[j]}`;
        const prior = pairSeen.get(name) ?? [];
        if (prior.some((p) => metersBetween(p, xy) <= PAIR_DEDUPE_M)) continue;
        const place: Place = { name, kind: "intersection", lat: r6(xy.lat), lon: r6(xy.lon) };
        prior.push(place);
        pairSeen.set(name, prior);
        crossings.push(place);
      }
    }
  }

  // Dedupe identical names within ~30 m (POIs first so they win).
  const out: Place[] = [];
  const byName = new Map<string, Place[]>();
  for (const p of [...pois, ...crossings]) {
    const key = p.name.toLowerCase();
    const prior = byName.get(key) ?? [];
    if (prior.some((q) => metersBetween(p, q) <= NAME_DEDUPE_M)) continue;
    prior.push(p);
    byName.set(key, prior);
    out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------- search

const ORDINALS = [
  "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth",
];
const ABBREV: Record<string, string> = {
  st: "street", ave: "avenue", av: "avenue", blvd: "boulevard", dr: "drive", pl: "place", rd: "road",
  ct: "court", ln: "lane", hwy: "highway", pkwy: "parkway", way: "way",
};
// Directions are NOT expanded from single letters: downtown has lettered streets ("E Street").
const DIRECTIONS = new Set(["north", "south", "east", "west"]);
const LETTER_DIRS = new Set(["n", "s", "e", "w"]);
const STREET_TYPES = new Set(["street", "avenue", "boulevard", "drive", "place", "road", "court", "lane", "highway", "parkway", "way"]);

/**
 * A leading direction is optional on both sides ("East Broadway" == "Broadway" == "E Broadway").
 * A single letter is dropped only when it is a direction, not a lettered street:
 * "e broadway" -> "broadway", but "e street" stays "e street".
 */
function dropLeadingDirection(side: string[]): string[] {
  if (side.length < 2) return side;
  if (DIRECTIONS.has(side[0])) return side.slice(1);
  if (LETTER_DIRS.has(side[0]) && !STREET_TYPES.has(side[1])) return side.slice(1);
  return side;
}
for (let i = 0; i < ORDINALS.length; i++) {
  const n = i + 1;
  const suffix = n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th";
  ABBREV[`${n}${suffix}`] = ORDINALS[i];
  ABBREV[String(n)] = ORDINALS[i];
}

const SEP = "&";

/** Lowercase, expand abbreviations, collapse intersection separators to "&". */
export function normalizeText(s: string): string {
  const t = s
    .toLowerCase()
    .replace(/[\/&]/g, ` ${SEP} `)
    .replace(/[^a-z0-9&\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w === "and" || w === "at" ? SEP : ABBREV[w] ?? w));
  const joined = t.join(" ").replace(/(&\s*)+/g, "& ").replace(/\s+/g, " ").trim();
  return joined.split(SEP).map((side) => dropLeadingDirection(side.trim().split(" ").filter(Boolean)).join(" ")).join(` ${SEP} `).replace(/\s+/g, " ").trim();
}

function tokens(s: string): string[] {
  return s.split(" ").filter(Boolean);
}

/** Every query token is a prefix of some name token. */
function tokensMatch(qTokens: string[], nTokens: string[]): boolean {
  return qTokens.every((q) => nTokens.some((n) => n.startsWith(q)));
}

/** 0 exact, 1 prefix, 2 contained, -1 no match. */
function rankText(q: string, n: string): number {
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  return tokensMatch(tokens(q), tokens(n)) ? 2 : -1;
}

function splitSides(s: string): string[] {
  return s.split(SEP).map((x) => x.trim()).filter(Boolean);
}

function rankPlace(qNorm: string, qSides: string[], nNorm: string): number {
  if (qSides.length >= 2) {
    const nSides = splitSides(nNorm);
    if (nSides.length >= 2) {
      const [qa, qb] = qSides;
      const [na, nb] = nSides;
      let best = -1;
      for (const [x, y] of [[na, nb], [nb, na]]) {
        const ra = rankText(qa, x);
        const rb = rankText(qb, y);
        if (ra < 0 || rb < 0) continue;
        const r = Math.max(ra, rb);
        if (best < 0 || r < best) best = r;
      }
      return best;
    }
    return -1;
  }
  const q = qSides[0] ?? qNorm;
  return rankText(q, nNorm);
}

export function searchPlaces(places: Place[], query: string, limit = 8): Place[] {
  const q = normalizeText(query);
  if (q.replace(/[&\s]/g, "").length < 2) return [];
  const qSides = splitSides(q);
  const hits: { p: Place; rank: number }[] = [];
  for (const p of places) {
    const rank = rankPlace(q, qSides, normalizeText(p.name));
    if (rank >= 0) hits.push({ p, rank });
  }
  hits.sort((a, b) => a.rank - b.rank || a.p.name.length - b.p.name.length || a.p.name.localeCompare(b.p.name));
  // Same name + kind within ~200 m (e.g. three "Santa Fe Depot" transit stops) shows once.
  const kept: Place[] = [];
  for (const { p } of hits) {
    if (kept.some((k) => k.name === p.name && k.kind === p.kind && Math.abs(k.lat - p.lat) < 0.002 && Math.abs(k.lon - p.lon) < 0.002)) continue;
    kept.push(p);
    if (kept.length >= limit) break;
  }
  return kept;
}
