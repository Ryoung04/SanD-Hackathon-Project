# Progress

## Owner C — Sprint 0 (2026-11-14, ~11:30 PT)
- Repo hygiene: added `.gitignore` (ignores `.env*`), `.env.example`. Local `.env` keys renamed to `GEMINI_API_KEY`, `BRIGHTDATA_API_KEY`.
- Gemini: key valid. Structured-JSON vision call (responseSchema) works on 2 CC-licensed Wikimedia Commons images.
  - `gemini-2.5-flash` returns 404 for this key; `gemini-3.5-flash` intermittently 503 (high demand); `gemini-3.1-flash-lite` reliable. Need retry/fallback model chain.
  - "Curb Ramp in San Diego.jpg" (CC BY 4.0, Mds08011, EXIF 2020-04-23, GPS 32.73265,-117.1602): ramp `visibly_present`, no candidates.
  - "Curb ramp with fences" (CC BY 2.0, Eric Fischer, Chicago — test only): no obstruction candidate returned; needs human review of whether fencing narrows path.
- Bright Data: key valid; created Web Unlocker zone `cli_unlocker` (trial). Fetch of `https://www.sandiego.gov/cip` REFUSED: `x-brd-error: www.sandiego.gov is classified as Government and blocked by Bright Data usage policy`.
- BLOCKER: plan to Bright-Data-fetch official sandiego.gov notices is not possible. Need a non-government permitted public source for construction notices.
- Next: pick Bright Data source; scaffold `src/lib/ai/gemini.ts` + Zod validation once app skeleton exists.

## Owner C — Sprint 1 (2026-11-14, ~11:45 PT)
- Bright Data .gov block -> new design: Bright Data fetches **news** (Times of San Diego WordPress JSON API); official city traffic-control permits come directly from the public ArcGIS layer (A's source). Notice is matched to permits by street pair + date overlap.
- Added (no app scaffold yet; only dependency is `zod`):
  - `src/lib/ai/validate.ts` Zod schemas, forbidden-claim guard, `groundNotice` (drops quotes/streets not in source text)
  - `src/lib/ai/gemini.ts` model fallback chain (`GEMINI_MODELS` env, default `gemini-3.5-flash,gemini-3.1-flash-lite`), `analyzeImage`, `extractNotice`
  - `src/lib/ai/imageSources.ts` Commons fetch with license allowlist; captured_at from EXIF metadata only
  - `src/lib/web/brightData.ts` Web Unlocker client, host allowlist (SSRF), refuses .gov, surfaces `x-brd-error`
  - `src/lib/web/noticeExtractor.ts` search/fetch article, build notice, `noticeToObservation` (geometry only from matched permit)
  - `src/lib/web/permitMatch.ts` pure matcher (permits supplied by caller)
  - `scripts/ai/notice-pipeline.ts`, `scripts/ai/analyze-sample.ts` live checks
- Tests: `npx tsx --test src/lib/web/permitMatch.test.ts` -> 8/8 pass; `tsc --strict --moduleResolution bundler` clean (run in scratch project with zod/tsx).
- Live results (samples in `docs/samples/`):
  - Golden Hill article (2026-11-09) -> streets 25th St + C St, no pedestrian language -> 10 permit matches, 3 overlap publish date -> `unverified_report` observation at permit point PMT-3450613.
  - Commons SD curb ramp image -> ramp visibly_present, no candidates, captured_at 2020-04-23.
- Known gaps: observation cites only best permit (should list all overlapping); search coverage is one news site; no pedestrian-impact article found yet.
- Needs from A: `upsertObservations` + permit records via API (replace direct ArcGIS call in script). Needs from B/scaffold: Next.js app to host `/api/analyze-image`, `/api/notices`.
