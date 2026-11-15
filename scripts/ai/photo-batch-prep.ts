// Prepare a multi-photo blind review batch for city curb-ramp intersections.
// Usage: npm run ai:photo-prep -- <outDir> [--n 40] [--per 4] [--batch 40]
// Picks the N ramp-deficit intersections closest to the demo anchors; for each, up to `per`
// perspective photos (one per approach quadrant, distinct capture sequences, camera facing the
// node, 6–30 m away, newest first) + 1 spherical panorama. Writes shrunk JPEGs, manifest.json,
// and batch_*.txt lists for reviewers. Review results are imported with ai:import-review.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { listObservations } from "@/lib/data/observations";
import { STUDY_BBOX } from "@/lib/data/studyArea";
import { haversineMeters } from "@/lib/data/geo";
import { bearingDeg, isAllowedThumbUrl } from "@/lib/ai/mapillary";
import type { BarrierObservation } from "@/lib/data/types";

/** Demo anchors: downtown core (Gaslamp/Civic Center) and the Golden Hill notice. */
const ANCHORS: { name: string; at: [number, number]; share: number }[] = [
  { name: "downtown", at: [-117.1611, 32.7157], share: 0.8 },
  { name: "golden_hill", at: [-117.14002, 32.71712], share: 0.2 },
];
const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : d;
};
const diff = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

interface Img { id: string; seq: string; pano: boolean; lon: number; lat: number; compass: number | null; captured: string; thumb: string; d: number; off: number | null; quad: number }

async function imagesNear(lon: number, lat: number): Promise<Img[]> {
  const r = 30, dLat = r / 111_320, dLon = r / (111_320 * Math.cos((lat * Math.PI) / 180));
  const bbox = [lon - dLon, lat - dLat, lon + dLon, lat + dLat].map((n) => n.toFixed(6)).join(",");
  const res = await fetch(`https://graph.mapillary.com/images?fields=id,sequence,camera_type,computed_geometry,compass_angle,captured_at,thumb_1024_url&bbox=${bbox}&limit=200`, {
    headers: { Authorization: `OAuth ${process.env.MAPILLARY_TOKEN}` }, signal: AbortSignal.timeout(20_000),
  });
  const j: any = await res.json();
  if (j?.error) throw new Error(j.error.message);
  const out: Img[] = [];
  for (const i of j.data ?? []) {
    const c = i?.computed_geometry?.coordinates;
    if (!Array.isArray(c) || !isAllowedThumbUrl(i.thumb_1024_url)) continue;
    const cam: [number, number] = [c[0], c[1]];
    const d = haversineMeters(cam, [lon, lat]);
    if (d > 30) continue;
    const toNode = bearingDeg(cam, [lon, lat]);
    const compass = typeof i.compass_angle === "number" ? i.compass_angle : null;
    out.push({
      id: String(i.id), seq: String(i.sequence ?? i.id), pano: i.camera_type === "spherical" || i.camera_type === "equirectangular",
      lon: cam[0], lat: cam[1], compass, captured: new Date(Number(i.captured_at)).toISOString().slice(0, 10), thumb: i.thumb_1024_url, d,
      off: compass === null ? null : diff(compass, toNode), quad: Math.floor(((bearingDeg([lon, lat], cam) + 45) % 360) / 90),
    });
  }
  return out;
}

function pick(imgs: Img[], per: number): Img[] {
  const persp = imgs.filter((i) => !i.pano && i.d >= 6 && i.off !== null && i.off <= 40)
    .sort((a, b) => (b.captured > a.captured ? 1 : -1) || (a.off! - b.off!));
  const chosen: Img[] = [], seqs = new Set<string>(), quads = new Set<number>();
  for (const i of persp) if (!quads.has(i.quad) && !seqs.has(i.seq) && chosen.length < per) { chosen.push(i); quads.add(i.quad); seqs.add(i.seq); }
  for (const i of persp) if (!seqs.has(i.seq) && chosen.length < per) { chosen.push(i); seqs.add(i.seq); }
  const pano = imgs.filter((i) => i.pano && i.d <= 15).sort((a, b) => a.d - b.d)[0];
  return pano ? [...chosen, pano] : chosen;
}

async function main() {
  const out = process.argv[2];
  if (!out) throw new Error("usage: <outDir> [--n 40] [--per 4] [--batch 40]");
  const n = Number(arg("--n", "40")), per = Number(arg("--per", "4")), batch = Number(arg("--batch", "40"));
  fs.mkdirSync(path.join(out, "photos"), { recursive: true });

  const all: BarrierObservation[] = [];
  let cursor: string | undefined;
  do {
    const r: any = await listObservations({ bbox: STUDY_BBOX, categories: ["missing_curb_ramp"], limit: 500, cursor });
    all.push(...r.data);
    cursor = r.next_cursor ?? r.meta?.next_cursor ?? undefined;
  } while (cursor);
  const ramps = all.filter((o) => o.source_kind === "city_gis" && o.geometry.type === "Point");
  const targets: BarrierObservation[] = [];
  for (const a of ANCHORS) {
    const k = Math.round(n * a.share);
    const near = ramps.filter((o) => !targets.includes(o))
      .sort((x, y) => haversineMeters(a.at, x.geometry.coordinates as [number, number]) - haversineMeters(a.at, y.geometry.coordinates as [number, number]));
    targets.push(...near.slice(0, k));
  }

  const manifest: { photo: string; barrier_id: string; image: string; captured_at: string; pano: boolean; distance_m: number; page_url: string }[] = [];
  let k = 0, none = 0;
  for (const t of targets) {
    const [lon, lat] = t.geometry.coordinates as [number, number];
    const picks = pick(await imagesNear(lon, lat), per);
    if (!picks.length) none++;
    for (const p of picks) {
      const tag = `q${String(++k).padStart(3, "0")}`;
      const raw = path.join(out, "photos", `${tag}.raw.jpg`);
      fs.writeFileSync(raw, Buffer.from(await (await fetch(p.thumb, { redirect: "error" })).arrayBuffer()));
      execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", raw, "-vf", `scale=${p.pano ? 1024 : 640}:-2`, "-q:v", "5", path.join(out, "photos", `${tag}.jpg`)]);
      fs.unlinkSync(raw);
      manifest.push({ photo: tag, barrier_id: t.id, image: `mapillary:${p.id}`, captured_at: p.captured, pano: p.pano, distance_m: Math.round(p.d), page_url: `https://www.mapillary.com/app/?pKey=${p.id}` });
    }
  }
  fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest));
  for (let i = 0; i * batch < manifest.length; i++)
    fs.writeFileSync(path.join(out, `batch_${i + 1}.txt`), manifest.slice(i * batch, (i + 1) * batch).map((m) => m.photo).join("\n") + "\n");
  console.log(`intersections=${targets.length} photos=${manifest.length} panos=${manifest.filter((m) => m.pano).length} no_photos=${none} batches=${Math.ceil(manifest.length / batch)}`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
