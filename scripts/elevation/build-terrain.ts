/**
 * Build terrain tiles for the 3D map from the cached USGS 3DEP elevation samples.
 *
 * Owner B. OFFLINE: reads data/raw/elevation-samples.json (written by fetch-slopes.ts; run that
 * first if missing) and writes Terrarium-encoded PNG tiles to public/data/terrain/{z}/{x}/{y}.png
 * plus public/data/terrain/meta.json. No network calls.
 *
 * Method: samples lie along mapped paths (~8 m apart). We interpolate a 10 m grid by inverse
 * distance weighting, so values between streets are ESTIMATES. Far from any sample (> ~150 m,
 * e.g. the bay) the surface fades to sea level so tile edges have no cliffs.
 * Purpose is legibility ("slight hills"), not survey accuracy; routing slopes come from the
 * raw samples, not from these tiles.
 *
 *   npx tsx scripts/elevation/build-terrain.ts
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

export const CONFIG = {
  samples: path.join("data", "raw", "elevation-samples.json"),
  outDir: path.join("public", "data", "terrain"),
  cellM: 10, // base grid resolution
  padM: 400, // grid extends this far beyond the samples
  bucketM: 50,
  fadeStartM: 150, // beyond this distance from any sample, fade toward sea level...
  fadeEndM: 400, // ...reaching 0 m here
  minZoom: 11,
  maxZoom: 15, // z15 ≈ 4 m/px, finer than the 10 m grid; MapLibre overzooms beyond
};

type Pt = { x: number; y: number; z: number };

// --- PNG (RGB, 8-bit) writer: avoids a dependency ---
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(buf: Buffer) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function encodePng(w: number, h: number, rgb: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

/** Terrarium encoding used by MapLibre raster-dem: elev = R*256 + G + B/256 - 32768. */
export function terrarium(elev: number): [number, number, number] {
  const v = Math.max(0, Math.min(65535.99, Math.round(elev * 4) / 4 + 32768)); // 0.25 m steps compress well
  return [Math.floor(v / 256), Math.floor(v) % 256, Math.floor((v - Math.floor(v)) * 256)];
}

const lon2tile = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z;
const lat2tile = (lat: number, z: number) => ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z;
const tile2lon = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
const tile2lat = (y: number, z: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;

function main() {
  if (!fs.existsSync(CONFIG.samples)) throw new Error(`${CONFIG.samples} missing: run scripts/elevation/fetch-slopes.ts first`);
  const raw: Record<string, number> = JSON.parse(fs.readFileSync(CONFIG.samples, "utf8"));
  const ll = Object.entries(raw).filter(([, v]) => typeof v === "number" && v > -50).map(([k, v]) => { const [lon, lat] = k.split(",").map(Number); return { lon, lat, z: v }; });
  const lat0 = ll.reduce((a, p) => a + p.lat, 0) / ll.length, lon0 = ll.reduce((a, p) => a + p.lon, 0) / ll.length;
  const KX = 111_320 * Math.cos((lat0 * Math.PI) / 180), KY = 110_540;
  const toXY = (lon: number, lat: number) => ({ x: (lon - lon0) * KX, y: (lat - lat0) * KY });
  const pts: Pt[] = ll.map((p) => ({ ...toXY(p.lon, p.lat), z: p.z }));

  const minX = Math.min(...pts.map((p) => p.x)) - CONFIG.padM, maxX = Math.max(...pts.map((p) => p.x)) + CONFIG.padM;
  const minY = Math.min(...pts.map((p) => p.y)) - CONFIG.padM, maxY = Math.max(...pts.map((p) => p.y)) + CONFIG.padM;

  // Spatial buckets.
  const B = CONFIG.bucketM, buckets = new Map<string, Pt[]>();
  for (const p of pts) { const k = `${Math.floor(p.x / B)},${Math.floor(p.y / B)}`; (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(p); }
  const near = (x: number, y: number, r: number) => {
    const out: Pt[] = [], bx = Math.floor(x / B), by = Math.floor(y / B), n = Math.ceil(r / B);
    for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) for (const p of buckets.get(`${bx + i},${by + j}`) ?? []) out.push(p);
    return out;
  };

  // Base grid (IDW with a radius that grows with distance to the nearest sample: smooth between streets).
  const C = CONFIG.cellM, W = Math.ceil((maxX - minX) / C) + 1, H = Math.ceil((maxY - minY) / C) + 1;
  const grid = new Float32Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = minX + i * C, y = minY + j * C;
    let cand = near(x, y, 60), r = 60;
    while (!cand.length && r < CONFIG.fadeEndM) { r *= 2; cand = near(x, y, r); }
    if (!cand.length) { grid[j * W + i] = 0; continue; }
    let dMin = Infinity; for (const p of cand) dMin = Math.min(dMin, Math.hypot(p.x - x, p.y - y));
    const radius = Math.max(40, dMin * 2.5);
    let sw = 0, sz = 0;
    for (const p of near(x, y, radius)) { const d = Math.hypot(p.x - x, p.y - y); if (d > radius) continue; const w = 1 / (d * d + 25); sw += w; sz += w * p.z; }
    const fade = Math.max(0, Math.min(1, 1 - (dMin - CONFIG.fadeStartM) / (CONFIG.fadeEndM - CONFIG.fadeStartM)));
    grid[j * W + i] = (sz / sw) * fade;
  }
  const sample = (x: number, y: number) => {
    const fi = (x - minX) / C, fj = (y - minY) / C;
    if (fi < 0 || fj < 0 || fi >= W - 1 || fj >= H - 1) return 0;
    const i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j, g = (a: number, b: number) => grid[b * W + a];
    return (g(i, j) * (1 - u) + g(i + 1, j) * u) * (1 - v) + (g(i, j + 1) * (1 - u) + g(i + 1, j + 1) * u) * v;
  };

  const bounds = [lon0 + minX / KX, lat0 + minY / KY, lon0 + maxX / KX, lat0 + maxY / KY];
  fs.rmSync(CONFIG.outDir, { recursive: true, force: true });
  let count = 0, bytes = 0;
  for (let z = CONFIG.minZoom; z <= CONFIG.maxZoom; z++) {
    const x0 = Math.floor(lon2tile(bounds[0], z)), x1 = Math.floor(lon2tile(bounds[2], z));
    const y0 = Math.floor(lat2tile(bounds[3], z)), y1 = Math.floor(lat2tile(bounds[1], z));
    for (let tx = x0; tx <= x1; tx++) for (let ty = y0; ty <= y1; ty++) {
      const rgb = new Uint8Array(256 * 256 * 3);
      for (let py = 0; py < 256; py++) {
        const lat = tile2lat(ty + (py + 0.5) / 256, z);
        for (let px = 0; px < 256; px++) {
          const { x, y } = toXY(tile2lon(tx + (px + 0.5) / 256, z), lat);
          rgb.set(terrarium(sample(x, y)), (py * 256 + px) * 3);
        }
      }
      const dir = path.join(CONFIG.outDir, String(z), String(tx));
      fs.mkdirSync(dir, { recursive: true });
      const png = encodePng(256, 256, rgb);
      fs.writeFileSync(path.join(dir, `${ty}.png`), png);
      count++; bytes += png.length;
    }
  }
  const meta = {
    source: "USGS 3DEP 1/3 arc-second bare-earth DEM, sampled along mapped OSM paths (getSamples), interpolated (IDW, 10 m grid)",
    caveat: "Between streets the surface is estimated; far from samples it fades to sea level. For map legibility only.",
    encoding: "terrarium", minzoom: CONFIG.minZoom, maxzoom: CONFIG.maxZoom,
    bounds: bounds.map((v) => Math.round(v * 1e6) / 1e6), samples: pts.length, built_at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(CONFIG.outDir, "meta.json"), JSON.stringify(meta, null, 2));
  console.log(`terrain: ${count} tiles, ${(bytes / 1024).toFixed(0)} KB, grid ${W}x${H}, bounds ${meta.bounds.join(",")}`);
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("build-terrain.ts")) main();
