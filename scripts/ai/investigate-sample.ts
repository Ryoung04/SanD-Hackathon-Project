// Live Mastra investigation for one record. Usage:
//   npm run ai:investigate -- <barrier_id> <lat> <lon> [out.json]
// Writes {brief, trace, model} — the trace is the sponsor proof (tool names, inputs, returned ids only).
import fs from "node:fs";
import { investigateBarrier } from "@/lib/agents/investigate";

async function main() {
  const [id, lat, lon, out] = process.argv.slice(2);
  if (!id || !lat || !lon) throw new Error("usage: <barrier_id> <lat> <lon> [out.json]");
  const t0 = Date.now();
  const r = await investigateBarrier({ barrier_id: id, lat: Number(lat), lon: Number(lon) });
  const doc = { ran_at: new Date().toISOString(), elapsed_ms: Date.now() - t0, ...r };
  const json = JSON.stringify(doc, null, 2);
  if (out) fs.writeFileSync(out, json + "\n");
  console.log(json);
}
main().catch((e) => {
  console.error(`${e.code ?? "ERROR"}: ${e.message}`);
  process.exit(1);
});
