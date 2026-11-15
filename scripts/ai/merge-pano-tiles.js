// node merge_tiles.js <dir>: results_tiles.tsv -> results_panos.tsv (one line per panorama),
// and writes results_*_nopano.tsv copies of batch results with panorama lines removed.
const fs = require("fs"), R = process.argv[2];
const m = JSON.parse(fs.readFileSync(R + "/manifest.json", "utf8"));
const panos = new Set(m.filter((x) => x.pano).map((x) => x.photo));
const g = {};
for (const l of fs.readFileSync(R + "/results_tiles.tsv", "utf8").trim().split("\n")) {
  const f = l.split("\t"); const p = f[0].replace(/t\d$/, "");
  (g[p] ||= []).push(f);
}
const out = [];
for (const [p, ts] of Object.entries(g)) {
  const ramp = ts.some((t) => t[1] === "visible") ? "visible" : ts.some((t) => t[1] === "not_visible") ? "not_visible" : "cant_tell";
  const sum = (i) => ts.reduce((a, t) => a + (Number(t[i]) || 0), 0);
  const obs = ts.find((t) => t[4] === "obstructed" && t[5] && t[5] !== "-");
  const walk = obs ? "obstructed" : ts.some((t) => t[4] === "clear") ? "clear" : "cant_tell";
  const note = ts.filter((t) => t[1] !== "cant_tell").map((t) => t[6]).join("; ").slice(0, 120) || "panorama tiles inconclusive";
  out.push([p, ramp, sum(2), sum(3), walk, obs ? obs[5] : "-", note].join("\t"));
}
fs.writeFileSync(R + "/results_panos.tsv", out.join("\n") + "\n");
for (const f of fs.readdirSync(R).filter((f) => /^results_\d\.tsv$/.test(f))) {
  const keep = fs.readFileSync(R + "/" + f, "utf8").trim().split("\n").filter((l) => !panos.has(l.split("\t")[0]));
  fs.writeFileSync(R + "/" + f.replace(".tsv", "_nopano.tsv"), keep.join("\n") + "\n");
}
const c = (v) => out.filter((l) => l.split("\t")[1] === v).length;
console.log(`panos merged=${out.length} visible=${c("visible")} not_visible=${c("not_visible")} cant_tell=${c("cant_tell")}`);
