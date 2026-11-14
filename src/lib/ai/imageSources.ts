// Permission-aware image references. Owner C.
// Only Wikimedia Commons files with an allowlisted open license, or a
// participant upload, may be analyzed. No arbitrary user URLs (SSRF).

const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const UA = "AccessPathSD-hackathon/0.1";
const MAX_COMMONS_BYTES = 5 * 1024 * 1024;
const OK_LICENSE = /^(CC0|Public domain|CC BY(-SA)? \d\.\d)$/i;

export interface ImageReference {
  image_reference: string; // e.g. "commons:File:Curb Ramp in San Diego.jpg" or "upload:<id>"
  source: "wikimedia_commons" | "participant_upload";
  page_url: string | null;
  license: string | null;
  attribution: string | null;
  captured_at: string | null; // YYYY-MM-DD from source metadata only
  camera_location: { lat: number; lon: number } | null; // camera, not the barrier
}

const strip = (s?: string) => (s ?? "").replace(/<[^>]+>/g, "").trim();

/** "23 April 2020 (according to Exif data)" | "2017-10-16 15:22" -> YYYY-MM-DD | null */
export function parseCommonsDate(raw?: string): string | null {
  const s = strip(raw).replace(/\(.*?\)/g, "").trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const t = Date.parse(`${s} UTC`);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

export async function fetchCommonsImage(title: string): Promise<{ bytes: Uint8Array; mimeType: string; ref: ImageReference }> {
  if (title.length > 200 || !/^File:[^/\\|#?<>[\]{}]+\.(jpe?g|png|webp)$/i.test(title)) throw new Error("invalid Commons file title");
  const u = new URL(COMMONS_API);
  for (const [k, v] of Object.entries({
    action: "query", format: "json", titles: title, prop: "imageinfo",
    iiprop: "url|extmetadata|mime", iiurlwidth: "1024",
  })) u.searchParams.set(k, v);
  const meta = await (await fetch(u, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15_000) })).json();
  const page: any = Object.values(meta?.query?.pages ?? {})[0];
  const ii = page?.imageinfo?.[0];
  if (!ii) throw new Error("Commons file not found");
  const em = ii.extmetadata ?? {};
  const license = strip(em.LicenseShortName?.value);
  if (!OK_LICENSE.test(license)) throw new Error(`license not allowlisted: ${license || "unknown"}`);

  const imgUrl = new URL(ii.thumburl ?? ii.url);
  if (imgUrl.protocol !== "https:" || !["upload.wikimedia.org", "thumb.wikimedia.org"].includes(imgUrl.hostname))
    throw new Error("unexpected image host");
  const res = await fetch(imgUrl, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20_000), redirect: "error" });
  if (!res.ok) throw new Error(`image fetch HTTP ${res.status}`);
  if (Number(res.headers.get("content-length") ?? 0) > MAX_COMMONS_BYTES) throw new Error("image too large");
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MAX_COMMONS_BYTES) throw new Error("image too large");
  const lat = Number(em.GPSLatitude?.value), lon = Number(em.GPSLongitude?.value);
  return {
    bytes: buf,
    mimeType: res.headers.get("content-type")?.split(";")[0] ?? ii.mime,
    ref: {
      image_reference: `commons:${page.title}`,
      source: "wikimedia_commons",
      page_url: ii.descriptionurl,
      license,
      attribution: strip(em.Artist?.value) || null,
      captured_at: parseCommonsDate(em.DateTimeOriginal?.value),
      camera_location: Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null,
    },
  };
}
