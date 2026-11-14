// News/third-party construction notice -> source-backed candidate. Owner C.
// Source: Times of San Diego WordPress REST API, fetched via Bright Data.
// A news article is a third-party report, never an official record.
import { brightDataFetch } from "./brightData";
import { extractNotice } from "../ai/gemini";
import type { PermitMatch } from "./permitMatch";

const WP = "https://timesofsandiego.com/wp-json/wp/v2/posts";

export interface ArticleRef {
  wp_id: number;
  title: string;
  source_url: string;
  published_at: string | null; // UTC ISO
  modified_at: string | null;
}

const toIso = (gmt?: string) => (gmt ? `${gmt}Z` : null); // WP *_gmt has no zone suffix
const stripHtml = (h: string) =>
  h
    .replace(/<[^>]+>/g, " ")
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Search recent articles. `afterIso` bounds recency (e.g. last 60 days). */
export async function searchNews(query: string, afterIso: string, perPage = 8): Promise<ArticleRef[]> {
  const u = new URL(WP);
  u.searchParams.set("search", query);
  u.searchParams.set("after", afterIso);
  u.searchParams.set("per_page", String(Math.min(perPage, 20)));
  u.searchParams.set("_fields", "id,date_gmt,modified_gmt,link,title");
  const r = await brightDataFetch(u.toString());
  const posts = JSON.parse(r.body) as Array<{ id: number; date_gmt: string; modified_gmt: string; link: string; title: { rendered: string } }>;
  return posts.map((p) => ({
    wp_id: p.id,
    title: stripHtml(p.title.rendered),
    source_url: p.link,
    published_at: toIso(p.date_gmt),
    modified_at: toIso(p.modified_gmt),
  }));
}

export interface Article extends ArticleRef {
  text: string;
  retrieved_at: string;
}

export async function fetchArticle(sourceUrl: string): Promise<Article> {
  const slug = new URL(sourceUrl).pathname.split("/").filter(Boolean).pop();
  if (!slug) throw new Error("cannot derive slug");
  const u = new URL(WP);
  u.searchParams.set("slug", slug);
  u.searchParams.set("_fields", "id,date_gmt,modified_gmt,link,title,content");
  const r = await brightDataFetch(u.toString());
  const [p] = JSON.parse(r.body);
  if (!p) throw new Error("article not found");
  return {
    wp_id: p.id,
    title: stripHtml(p.title.rendered),
    source_url: p.link,
    published_at: toIso(p.date_gmt),
    modified_at: toIso(p.modified_gmt),
    text: stripHtml(p.content.rendered),
    retrieved_at: r.retrieved_at,
  };
}

/** Structured notice (OWNER_C §5 fields). No geometry: text location only. */
export interface ConstructionNotice {
  source_url: string;
  source_name: "Times of San Diego";
  source_type: "news_report";
  page_title: string;
  published_at: string | null;
  retrieved_at: string;
  retrieved_via: "bright_data_web_unlocker";
  construction_mentioned: boolean;
  location_text: string | null;
  cross_streets: string[];
  date_start: string | null;
  date_end: string | null;
  pedestrian_impact_language: string[]; // verbatim, grounded quotes
  pedestrian_impact_found: boolean;
  location_confidence: "text_only";
  geocoding_method: "none";
  extraction_model: string;
}

export async function buildNotice(article: Article): Promise<ConstructionNotice> {
  const ex = await extractNotice(article.text);
  return {
    source_url: article.source_url,
    source_name: "Times of San Diego",
    source_type: "news_report",
    page_title: article.title,
    published_at: article.published_at,
    retrieved_at: article.retrieved_at,
    retrieved_via: "bright_data_web_unlocker",
    construction_mentioned: ex.construction_mentioned,
    location_text: ex.location_text,
    cross_streets: ex.cross_streets,
    date_start: ex.date_start,
    date_end: ex.date_end,
    pedestrian_impact_language: ex.pedestrian_impact_quotes,
    pedestrian_impact_found: ex.pedestrian_impact_quotes.length > 0,
    location_confidence: "text_only",
    geocoding_method: "none",
    extraction_model: ex.model,
  };
}

/**
 * BarrierObservation (PROJECT_MASTER §4.1) for a notice corroborated by an
 * official permit. Geometry comes from the permit's point, never invented.
 * Without a permit match, show the notice as a card (no map marker).
 * TODO: replace local shape with Owner A's shared BarrierObservation type.
 */
export function noticeToObservation(notice: ConstructionNotice, match: PermitMatch) {
  const p = match.permit;
  const ped = notice.pedestrian_impact_found;
  return {
    id: `web_notice:tosd:${new URL(notice.source_url).pathname.split("/").filter(Boolean).pop()}:${p.approval_id}`,
    category: "construction_warning" as const,
    label: ped ? "Construction reported; possible sidewalk impact" : "Construction reported nearby; pedestrian impact not stated",
    geometry: { type: "Point" as const, coordinates: [p.lon, p.lat] as [number, number] },
    geometry_precision: "approximate_point" as const,
    source_kind: "web_notice" as const,
    source_record_id: notice.source_url,
    source_url: notice.source_url,
    source_observed_at: null,
    source_updated_at: notice.published_at,
    ingested_at: new Date().toISOString(),
    verification_status: "unverified_report" as const,
    routing_impact: "unknown" as const,
    severity: "unknown" as const,
    description: ped
      ? `News report mentions pedestrian impact near ${notice.cross_streets.join(" & ")}. City permit ${p.approval_id} covers this block; sidewalk status not verified.`
      : `News report describes construction near ${notice.cross_streets.join(" & ")}; it does not mention sidewalks. City permit ${p.approval_id} covers this block.`,
    evidence: [
      {
        kind: "news_report",
        source_url: notice.source_url,
        title: notice.page_title,
        published_at: notice.published_at,
        retrieved_at: notice.retrieved_at,
        retrieved_via: notice.retrieved_via,
        quotes: notice.pedestrian_impact_language,
      },
      {
        kind: "city_traffic_control_permit",
        approval_id: p.approval_id,
        block_information: p.block_information,
        date_start: p.date_start,
        date_end: p.date_end,
        match_basis: match.match_basis,
        date_overlap: match.date_overlap,
      },
    ],
    metadata: { extraction_model: notice.extraction_model, location_confidence: "permit_block_match" },
  };
}
