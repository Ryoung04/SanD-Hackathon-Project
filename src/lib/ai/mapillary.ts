// Mapillary street-level imagery (Owner C). Server-only.
// License: Mapillary imagery is CC BY-SA 4.0; we store attribution + page link per image.
// We only download thumbnails from Mapillary's CDN (fbcdn.net) returned by the Graph API,
// never arbitrary URLs. Location = camera position (computed by Mapillary), not the barrier.
import "server-only";
import { haversineMeters } from "@/lib/data/geo";
import { MAX_IMAGE_BYTES, sniffImageMime } from "./gemini";
import type { ImageReference } from "./imageSources";

const GRAPH = "https://graph.mapillary.com/images";
const FIELDS = "id,captured_at,computed_geometry,compass_angle,is_pano,thumb_1024_url,creator";
export const MAPILLARY_LICENSE = "CC BY-SA 4.0";

export interface MapillaryImage {
  id: string;
  captured_at: string; // YYYY-MM-DD
  lon: number;
  lat: number;
  compass_angle: number | null;
  is_pano: boolean;
  thumb_url: string;
  creator: string | null;
  distance_m: number;
  /** |camera heading - bearing(camera -> target)|, 0..180. Small = camera faces the target. */
  heading_off_deg: number | null;
}

export class MapillaryError extends Error {}

function token() {
  const t = process.env.MAPILLARY_TOKEN;
  if (!t) throw new MapillaryError("MAPILLARY_TOKEN not set");
  return t;
}

export function bearingDeg(from: [number, number], to: [number, number]): number {
  const [lon1, lat1, lon2, lat2] = [from[0], from[1], to[0], to[1]].map((d) => (d * Math.PI) / 180);
  const y = Math.sin(lon2 - lon1) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const angleDiff = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/** Thumbnails must come from Mapillary's CDN over https. */
export function isAllowedThumbUrl(u: string): boolean {
  try {
    const p = new URL(u);
    return p.protocol === "https:" && !p.username && !p.password && !p.port && /(^|\.)fbcdn\.net$/.test(p.hostname);
  } catch {
    return false;
  }
}

/** Score: prefer camera facing the target, close, recent; panoramas excluded (distorted for vision). */
export function rankImages(imgs: MapillaryImage[]): MapillaryImage[] {
  const score = (i: MapillaryImage) =>
    (i.heading_off_deg ?? 90) * 1.0 + i.distance_m * 2 - Number(i.captured_at.slice(0, 4)) * 5;
  return imgs.filter((i) => !i.is_pano).sort((a, b) => score(a) - score(b));
}

/** Non-panoramic images whose camera is within radiusM of the target point. */
export async function findImagesNear(lat: number, lon: number, radiusM = 30): Promise<MapillaryImage[]> {
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  const bbox = [lon - dLon, lat - dLat, lon + dLon, lat + dLat].map((n) => n.toFixed(6)).join(",");
  const res = await fetch(`${GRAPH}?fields=${FIELDS}&bbox=${bbox}&limit=100`, {
    headers: { Authorization: `OAuth ${token()}` },
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await res.json().catch(() => null)) as any;
  if (!res.ok || !j || j.error) throw new MapillaryError(`Mapillary ${res.status}: ${String(j?.error?.message ?? "bad response").slice(0, 120)}`);
  const target: [number, number] = [lon, lat];
  const out: MapillaryImage[] = [];
  for (const i of j.data ?? []) {
    const c = i?.computed_geometry?.coordinates;
    if (!Array.isArray(c) || typeof i.thumb_1024_url !== "string" || !isAllowedThumbUrl(i.thumb_1024_url)) continue;
    const cam: [number, number] = [Number(c[0]), Number(c[1])];
    const d = haversineMeters(cam, target);
    if (!(d <= radiusM)) continue;
    const ca = typeof i.compass_angle === "number" ? i.compass_angle : null;
    out.push({
      id: String(i.id),
      captured_at: new Date(Number(i.captured_at)).toISOString().slice(0, 10),
      lon: cam[0],
      lat: cam[1],
      compass_angle: ca,
      is_pano: !!i.is_pano,
      thumb_url: i.thumb_1024_url,
      creator: typeof i?.creator?.username === "string" ? i.creator.username.slice(0, 60) : null,
      distance_m: Math.round(d * 10) / 10,
      heading_off_deg: ca === null || d < 2 ? null : Math.round(angleDiff(ca, bearingDeg(cam, target))),
    });
  }
  return rankImages(out);
}

export function mapillaryReference(img: MapillaryImage): ImageReference {
  return {
    image_reference: `mapillary:${img.id}`,
    source: "mapillary",
    page_url: `https://www.mapillary.com/app/?pKey=${encodeURIComponent(img.id)}`,
    license: MAPILLARY_LICENSE,
    attribution: `${img.creator ?? "Mapillary contributor"} via Mapillary, ${MAPILLARY_LICENSE}`,
    captured_at: img.captured_at,
    camera_location: { lat: img.lat, lon: img.lon },
  };
}

export async function downloadThumb(img: MapillaryImage): Promise<{ bytes: Uint8Array; mimeType: string }> {
  if (!isAllowedThumbUrl(img.thumb_url)) throw new MapillaryError("thumbnail host not allowed");
  const res = await fetch(img.thumb_url, { redirect: "error", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new MapillaryError(`thumbnail ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) throw new MapillaryError("thumbnail size out of range");
  const mimeType = sniffImageMime(bytes);
  if (!mimeType) throw new MapillaryError("thumbnail is not an image");
  return { bytes, mimeType };
}
