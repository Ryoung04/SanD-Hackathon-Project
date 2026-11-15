# Progress

## Owner C — multi-photo intersection review (2026-11-14 night)
- 40 demo intersections (32 downtown core + 8 Golden Hill): 154 Mapillary photos incl. 32 panoramas (tiled). Blind Claude-Haiku subagent review. 20/38 intersections now have photo evidence of ≥1 ramp; negatives not trusted. 11 obstruction ai_candidates. Quick brief reports "Of N photos, K show a curb ramp" + flags conflicts when photos show more ramps than the city lists.
- Repro: `npm run ai:photo-prep -- <dir>` → reviewers → `node scripts/ai/merge-pano-tiles.js <dir>` → `npm run ai:import-review -- <dir>/manifest.json <tsvs> --save`.

## Owner C — reliable briefs + imagery review (2026-11-14 evening)
- Gemini free tier can't sustain runtime agent calls (3.5-flash quota exhausted; flash-lite hangs → 45 s timeouts). Fix: `/api/investigate` defaults to an instant rule-based brief (`src/lib/agents/quickBrief.ts`, 0.1–0.4 s live); Mastra agent is opt-in `mode:"agent"` (step limit 10, aborted→TIMEOUT, long text trimmed).
- Imagery: `src/lib/ai/{mapillary,imageryChecks,imageryPipeline}.ts`, `npm run ai:imagery`, `npm run ai:import-review`. Mapillary photos for 88 ramp intersections; Gemini pass was noisy → quality gate (`candidateGate`) → replaced by blind Claude-Haiku subagent review (70 photos): 1 ramp visible, 69 can't tell, 3 obstructions. Neon: 3 current street_imagery_ai, 68 marked outdated.
- Tests: `npm test` 271 pass + 1 todo; `test:ui` 44.

## Owner C (on A's files, team-approved) — wider study area + Missing APS (2026-11-14)
- `STUDY_BBOX` → [-117.175, 32.705, -117.135, 32.735] (adds East Village, Golden Hill, Barrio Logan edge). Map bounds/route planner follow it automatically.
- New: PROWAG layer 1 "Missing APS" → `city_gis:prowag1:<oid>`, `crossing_issue`, `routing_impact: informational`. Fetched inside the prowag step because `markOutdated` is per source_kind.
- `ingest`/`ingest:safe`/`coverage` now also read `.env` (env vars still win, so ingest:safe keeps its branch URL — verified).
- Live ingest to Neon: city_gis 165 (88 ramp + 77 APS), traffic_control 119 active, city_311 1194 (of 10,293 rows in bbox), 0 rejected. Total 1479 current. Golden Hill notice now has 21 records within 200 m.
- Tests: `npm test` 241 pass + 1 todo (`tests/data/prowagAps.test.ts`), `test:ui` 44.

## Owner C — Vultr deploy (2026-11-14)
- **Live:** https://140-82-17-18.sslip.io — full app on Vultr `vc2-1c-1gb` (lax), Caddy TLS, Neon data. Redeploy: `scripts/deploy/vultr-deploy.sh 140.82.17.18` (needs `~/.ssh/accesspath_vultr`, Aidan's machine). Server env = Gemini + ElevenLabs + DATABASE_URL only.
- `/api/investigate` now retries once on malformed structured output (seen 1/6 live). `npm test` 233 pass + 1 todo.
- **Cost:** $5/mo on $100 credit — delete after judging.

## Owner C — ElevenLabs `/api/speak` (2026-11-14)
- **Outcome:** server-side TTS for on-screen text; live call verified (326 chars → MP3, 0.9 s). Budget guards for free tier.
- **Files:** `src/lib/voice/elevenlabs.ts`, `src/app/api/speak/route.ts`, `tests/ai/speak.test.ts`; contract in `docs/OWNER_B_REQUESTS.md`.
- **Tests:** `npm test` 232 pass + 1 todo; build passes.
- **Next:** B adds "Investigate" + "Read aloud" buttons in the evidence panel. Vultr only if time permits ($100 credit cap — careful).

## Owner C — Mastra `/api/investigate` (2026-11-14)
- **Outcome:** Mastra agent (`@mastra/core` 1.83, Gemini flash-lite via model router) with 3 server-bound tools over A's Neon data + notice cache returns a source-backed evidence brief. Ids/links filtered to tool results, forbidden claims rejected in code. Notices refreshed into Neon (Golden Hill `web_notice`, 1 record).
- **Files:** `src/lib/agents/{brief,investigate}.ts`, `src/app/api/investigate/route.ts`, `scripts/ai/investigate-sample.ts` (`npm run ai:investigate -- <id> <lat> <lon> [out]`), `tests/ai/investigate.test.ts`, `docs/samples/investigate_mastra_trace.json`, contract in `docs/OWNER_B_REQUESTS.md`.
- **Tests:** `npm test` 215 pass + 1 todo; `test:ui` 44; typecheck + build pass. Live via `next start`: 200 in ~8–21 s, 3–4 tool calls.
- **For A:** a `getObservation(id)` helper would let B drop lat/lon from the request. Golden Hill is outside `STUDY_BBOX` so its nearby search is empty.
- **Next:** ElevenLabs `/api/speak`; B wires an "Investigate" button in the evidence panel.

## Owner B — Sprint 2 routing + warnings (2026-11-14)
- **Outcome:** `POST /api/route` → Valhalla public server (`pedestrian`, `type: wheelchair` when preferred; override with `VALHALLA_URL`). Returns real geometry/distance/time or `status:"unavailable"`, never a straight line. Near-route warnings use A's `findNearRoute` (30 m, approximate), grouped in the UI as official / resident-reported / AI / other. Rerouting is off (warning-only; `avoid_barrier_ids` ignored). UI: `RoutePlanner` (lat,lon inputs + pick-on-map, preference select), route line plus A/B pins on the map. All CSS colors are now `:root` tokens, the hook for future themes.
- **Files:** `src/lib/routing/provider.ts`, `src/app/api/route/route.ts`, `src/lib/ui/routeClient.ts`, `src/components/RoutePlanner.tsx`, `src/components/MapView.tsx`, `src/app/page.tsx`, `src/app/globals.css`, `tests/ui/{routing,routeClient}.test.ts`.
- **Tests:** `npm run test:ui` 44 pass; `npm test` 12 pass; typecheck and build pass. Live: real route 995 m, 15 nearby 311 records after `npm run ingest`; with the provider unreachable → `unavailable`.
- **Not verified:** UI not yet clicked through in a browser. The local store needs `npm run ingest` (data is gitignored).
- **Next:** browser run-through; address/place search (currently lat,lon); optional second-route comparison only if two real provider routes exist.

## Owner B — Sprint 0/1 shell (2026-11-14)
- **Outcome:** Next.js + TS + Leaflet scaffold. Map refetches `/api/barriers?bbox=` on pan (350 ms debounce, grid-snapped cache). Has an evidence panel with the required caveat wording, a source legend with layer toggles (glyph + text, not color only), and a keyboard observation list. Fixture fallback shows a banner and badges; there is a "Coverage incomplete" notice.
- **Files:** `package.json`, `tsconfig.json`, `next.config.mjs`, `src/app/{layout,page}.tsx`, `src/app/globals.css`, `src/components/{MapView,BarrierDetail,SourceLegend,ObservationList}.tsx`, `src/lib/ui/{barrierTypes,caveats,barrierClient,fixtures}.ts`, `tests/ui/*.test.ts`, `docs/OWNER_B_REQUESTS.md`.
- **Tests:** `npm run test:ui` → 17 pass (caveats, date fallback, bbox cache, fixture fallback). Lib typechecks. Components have NOT been typechecked or rendered yet; run `npm install && npm run typecheck && npm run dev`.
- **Tiles:** OSM standard tiles with attribution. That is fine for light demo use under the OSM tile policy; switch providers if traffic grows.
- **Blockers:** see `docs/OWNER_B_REQUESTS.md` (bbox, real samples, A's endpoint/types).
- **Next:** swap in A's real records; Sprint 2 `POST /api/route` adapter (Valhalla) + `RoutePlanner` + near-route warnings.

## Owner A progress (geodata backend)

Status: ingest -> normalize -> persist -> API -> near-route helper implemented on `feat/geodata` (uncommitted).

Files: `src/lib/data/{types,studyArea,sourceRegistry,normalizers,geo,query,observations}.ts`, `src/lib/db/{schema.sql,client.ts}`,
`src/app/api/barriers/route.ts`, `src/app/api/barriers/near-route/route.ts`, `scripts/ingest/{arcgis,sd-prowag,sd-traffic,sd-311,run-all,check-coverage}.ts`,
`tests/data/data.test.ts`, plus package.json/tsconfig/next.config.mjs/vitest.config.ts/.gitignore/.env.example and a placeholder `src/app/{layout,page}.tsx`.

Commands: `npm install`, `npm run typecheck`, `npm test` (12 pass), `npm run ingest`, `npm run coverage`, `npm run build`.
Ingest/coverage scripts run with `--conditions=react-server` so `server-only` does not throw under tsx.
Storage: Neon if DATABASE_URL set (schema.sql auto-applied by ingest), else file store `data/observations.json` (override with OBS_STORE_PATH; gitignored).

Live ingest results (study bbox -117.175,32.712,-117.150,32.730; 2026-11-14), matching source-audit counts:
- city_gis (PROWAG L2): fetched 24, normalized 24, rejected 0 -> missing_curb_ramp 24
- traffic_control: fetched 83 (active), normalized 83, rejected 0 -> construction_warning 83
- city_311: 5041 CSV rows in bbox, 564 whitelist matches -> sidewalk_damage 562, missing_curb_ramp 2
- Total 671. No noncompliant_curb_ramp / sidewalk_obstruction / crossing_issue rows in bbox currently.

Sample real observation: `city_311:5723946` at [-117.1691975, 32.71662479] (unverified_report, approximate_point).

API checks (next start :3100): `GET /api/barriers?bbox=...&limit=2` -> 200 with data+meta; bbox with 3 numbers -> 400 INVALID_BBOX.
Near-route: `POST /api/barriers/near-route {route, threshold_m}` (match_method `within_<N>m_approximate`; warning-only, never edge-exclusion).

Blockers/notes: source licenses for PROWAG and traffic control unresolved (attribution only). Pagination `next_cursor` = last id.
No Neon DB was available, so the SQL path (xmax=0 counting, keyset query) is untested live. 311 labels are generic by design; no fixture data is served.


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

## Owner C — integrated into main (2026-11-14, ~12:00 PT)
- Merged `aidan` into main via `feat/ai-ingestion`. Uses A's `BarrierObservation` (`@/lib/data/types`), A's `normalizeTrafficControl` for permits, `permitFromObservation` adapter; observations cite ALL date-overlapping permits; pass A's `validateObservation`.
- `server-only` added to `gemini.ts`, `brightData.ts`. Tests moved to `tests/ai/ai.test.ts` (vitest).
- Commands: `npm test` (21 pass), `npm run test:ui` (17 pass), `npm run typecheck` clean, `npm run build` OK.
  Live: `npm run ai:notice -- <tosd article url> [out.json] [--save]`, `npm run ai:image -- "File:<commons title>" [out.json]` (read keys from `.env`/`.env.local`).
- Note for A: Golden Hill (25th & C) is outside `STUDY_BBOX` [-117.175,32.712,-117.15,32.73]; the script queries permits for a wider bbox itself.
- Next: `POST /api/analyze-image`, notices endpoint for B, Mastra agent.

## Owner C — API endpoints (2026-11-14, ~12:00 PT)
- New: `POST /api/analyze-image`, `GET /api/notices`, `POST /api/notices/refresh` (header `x-admin-token: $ADMIN_TOKEN`; runs bounded Bright Data + Gemini pipeline, ~60 s, ≤8 articles). Lib: `src/lib/web/{permits,noticePipeline,noticeStore}.ts`, `src/lib/ai/imageObservations.ts`. Cache: `data/notices.json` (gitignored).
- Live dev-server test (isolated stores): error paths OK; Commons SD image → 200, camera GPS + 2020-04-23, no candidates, nothing saved; upload without location → 2 `sidewalk_obstruction` candidates (pole, fence; model output varies run-to-run), not mapped; refresh → Golden Hill card, 3 permits, 1 observation upserted via A, returned by `/api/barriers`.
- Tests: `npm test` 22 pass; typecheck clean. Contract for B in `docs/OWNER_B_REQUESTS.md`.
- To populate demo data: set `ADMIN_TOKEN` in `.env`, run app, `curl -X POST localhost:3000/api/notices/refresh -H "x-admin-token: ..."` (or `npm run ai:notice -- --refresh --save`).

## Owner C — test hardening (2026-11-14, ~12:10 PT)
- Added `tests/ai/routes.test.ts` (22, mocked route tests) and `tests/ai/security.test.ts` (151, adversarial). `npm test` 194 pass + 1 todo; test:ui 17; typecheck + build OK.
- Fixes from security probe: removed `www.google.com` from Bright Data allowlist (open redirect bypassed .gov policy); reject URL userinfo/ports, send parsed URL; forbidden-claim guard NFKC/dash/zero-width normalised + wider phrases, applied per item (drops candidate/quote, counts `dropped_for_unsupported_claims`) instead of failing the whole response; quote grounding needs ≥3 words, word boundaries, no preceding negation; real-calendar date validation; magic-byte image sniffing; captured_at format check; Commons title bans `| # ? < > [ ] { }`, ≤200 chars, https + 5 MB cap, no redirects; fetchArticle only accepts timesofsandiego.com slugs; refresh route tolerates null/non-object JSON body.
- Contract changes: `AnalyzeImageResponse.dropped_for_unsupported_claims`; `PermitMatch.date_basis` ("notice_dates" | "article_publication_date" | "none"), shown in permit evidence + description; web_notice id is now `web_notice:<host><path>`.
- Known limitation: grounded quote returned is the model's string (verified present in article, not re-sliced); text injected into an article still grounds.

## Owner A — trust + Neon features (2026-11-14)
Backend hardening: PostGIS `geom` column (GIST) backs bbox listing and near-route (ST_DWithin on geography); schema.sql backfills it.
`ingest_runs` table logs one row per source per ingest (status, counts, sanitized error, neon_branch). New `GET /api/sources` (+ `listSources`) gives per-source plain-language semantics, current/outdated counts, last ingest.
`npm run ingest:safe` ingests into a Neon branch, validates (runs ok, normalized>0, counts >=50% of main), then restores main from it, keeping `main-before-<name>`. The ingest branch cannot be deleted after promotion (backup is its child) and expires after 1 day.
