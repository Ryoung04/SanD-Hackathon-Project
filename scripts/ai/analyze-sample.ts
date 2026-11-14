// Live check: permitted Commons image -> Gemini -> validated candidate.
// Usage: npx tsx scripts/ai/analyze-sample.ts "File:Curb Ramp in San Diego.jpg" [out.json]
import { writeFileSync } from "node:fs";
import { fetchCommonsImage } from "../../src/lib/ai/imageSources";
import { analyzeImage } from "../../src/lib/ai/gemini";

const title = process.argv[2] ?? "File:Curb Ramp in San Diego.jpg";
const { bytes, mimeType, ref } = await fetchCommonsImage(title);
const result = await analyzeImage({ bytes, mimeType, imageReference: ref.image_reference, capturedAt: ref.captured_at });
const out = { image: ref, analysis: result };
console.log(JSON.stringify(out, null, 1));
if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify(out, null, 2));
