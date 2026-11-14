// POST /api/analyze-image (PROJECT_MASTER §4.4). Owner C.
// multipart/form-data:
//   image             File (jpeg/png/webp, <=5MB)   -- OR --
//   commons_title     "File:<name>.jpg" (Wikimedia Commons, open license only)
//   permission_confirmed  "true"  (required for uploads: uploader has rights)
//   lat, lon          optional camera location (uploads only; Commons uses EXIF GPS)
//   save              "false" to skip persisting candidates
// No arbitrary URLs are fetched (SSRF).
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { analyzeImage, GeminiError, MAX_IMAGE_BYTES } from "@/lib/ai/gemini";
import { fetchCommonsImage, type ImageReference } from "@/lib/ai/imageSources";
import { imageToObservations } from "@/lib/ai/imageObservations";
import { upsertObservations } from "@/lib/data/observations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const err = (status: number, code: string, message: string) => NextResponse.json({ error: { code, message } }, { status });

// Simple per-IP limiter (in-memory; fine for a single demo instance).
const hits = new Map<string, number[]>();
function rateLimited(ip: string, max = 10, windowMs = 60_000) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > max;
}

// Rough San Diego County bounds for user-supplied points.
const inSanDiego = (lat: number, lon: number) => lat > 32.5 && lat < 33.6 && lon > -117.7 && lon < -116.0;

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  if (rateLimited(ip)) return err(429, "RATE_LIMITED", "Too many analyses; try again in a minute");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return err(400, "BAD_REQUEST", "Expected multipart/form-data");
  }
  const file = form.get("image");
  const commonsTitle = form.get("commons_title");
  const save = form.get("save") !== "false";

  let bytes: Uint8Array, mimeType: string, image: ImageReference;
  let location: { lat: number; lon: number; basis: "camera_gps_metadata" | "user_supplied" } | null = null;

  try {
    if (file instanceof File) {
      if (form.get("permission_confirmed") !== "true")
        return err(400, "PERMISSION_REQUIRED", "Confirm you took this photo or have rights to submit it");
      if (file.size === 0 || file.size > MAX_IMAGE_BYTES) return err(413, "IMAGE_TOO_LARGE", "Image must be 1 byte to 5 MB");
      bytes = new Uint8Array(await file.arrayBuffer());
      mimeType = file.type;
      const id = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
      image = {
        image_reference: `upload:${id}`, source: "participant_upload", page_url: null, license: "submitted_with_permission",
        attribution: null, captured_at: null, camera_location: null, // never inferred from upload time
      };
      const lat = Number(form.get("lat")), lon = Number(form.get("lon"));
      if (form.get("lat") !== null && form.get("lon") !== null) {
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || !inSanDiego(lat, lon))
          return err(400, "INVALID_LOCATION", "lat/lon must be a point in San Diego County");
        location = { lat, lon, basis: "user_supplied" };
      }
    } else if (typeof commonsTitle === "string" && commonsTitle) {
      const r = await fetchCommonsImage(commonsTitle);
      ({ bytes, mimeType } = r);
      image = r.ref;
      if (r.ref.camera_location) location = { ...r.ref.camera_location, basis: "camera_gps_metadata" };
    } else {
      return err(400, "BAD_REQUEST", "Provide an image file or commons_title");
    }
  } catch (e) {
    return err(400, "IMAGE_SOURCE_REJECTED", (e as Error).message.slice(0, 200));
  }

  try {
    const analysis = await analyzeImage({ bytes, mimeType, imageReference: image.image_reference, capturedAt: image.captured_at });
    const observations = imageToObservations(analysis, image, location);
    const saved = save && observations.length ? await upsertObservations(observations) : null;
    return NextResponse.json({
      ...analysis,
      image,
      location: location ?? null,
      location_note: location
        ? "Location is the camera position, not the exact barrier."
        : "No location: result is not placed on the map.",
      observation_ids: observations.map((o) => o.id),
      saved: saved ? { inserted: saved.inserted, updated: saved.updated, rejected: saved.rejected } : null,
    });
  } catch (e) {
    if (e instanceof GeminiError) {
      const status = e.code === "BAD_INPUT" ? 400 : e.code === "CONFIG" ? 500 : 502;
      return err(status, `AI_${e.code}`, e.code === "CONFIG" ? "AI service not configured" : e.message.slice(0, 200));
    }
    return err(500, "INTERNAL", "Analysis failed");
  }
}
