// Active city traffic-control permits for an area, normalized with Owner A's
// normalizeTrafficControl. Used for notice matching outside A's STUDY_BBOX.
// TODO(A): replace with A's store once it covers the needed area.
import "server-only";
import { normalizeTrafficControl } from "@/lib/data/normalizers";
import { SOURCES } from "@/lib/data/sourceRegistry";
import type { Bbox } from "@/lib/data/types";
import { permitFromObservation, type PermitRecord } from "./permitMatch";

/** Central San Diego: downtown + Golden Hill + Sherman Heights. */
export const NOTICE_BBOX: Bbox = [-117.175, 32.7, -117.125, 32.735];

export async function permitsNear(bbox: Bbox, activeSinceIso: string): Promise<PermitRecord[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(activeSinceIso)) throw new Error("activeSinceIso must be YYYY-MM-DD");
  const u = new URL(`${SOURCES.traffic.endpoint}/query`);
  for (const [k, v] of Object.entries({
    where: `DATE_END >= DATE '${activeSinceIso}'`, geometry: bbox.join(","), geometryType: "esriGeometryEnvelope",
    inSR: "4326", outSR: "4326", spatialRel: "esriSpatialRelIntersects", returnGeometry: "true", f: "json", outFields: "*",
    resultRecordCount: "2000",
  })) u.searchParams.set(k, v);
  const res = await fetch(u, { signal: AbortSignal.timeout(20_000), cache: "no-store" });
  const d = await res.json();
  if (d.error) throw new Error(`ArcGIS: ${JSON.stringify(d.error).slice(0, 200)}`);
  return (d.features ?? [])
    .map((f: unknown) => normalizeTrafficControl(f as never))
    .map((o: ReturnType<typeof normalizeTrafficControl>) => (o ? permitFromObservation(o) : null))
    .filter((p: PermitRecord | null): p is PermitRecord => p !== null);
}
