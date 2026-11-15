# Sponsor proof (Owner C) — only services actually used

## Bright Data — Data for Good
- Product: Web Unlocker API (`POST https://api.brightdata.com/request`), zone `cli_unlocker` (created 2026-11-14 19:29 UTC).
- Policy finding: `www.sandiego.gov` refused (`x-brd-error: ... classified as Government and blocked by Bright Data`). We do not circumvent this; official data is read directly from public city ArcGIS services.
- Use: Google search results and Times of San Diego WordPress API fetched via Bright Data (2026-11-14). Article `san-diego-construction-parking-woes-golden-hill-cafe` (published 2026-11-09) retrieved 2026-11-14T19:39Z.
- Output: `docs/samples/notice_pipeline_golden_hill.json` — notice matched to city permits on 25th St / C St, emitted as `construction_warning`, `unverified_report`, `routing_impact: unknown`.
- Where a resident sees it: TODO (B's evidence panel).

## Gemini API
- Models actually served: `gemini-3.6-flash` (via `gemini-3.5-flash` alias), `gemini-3.1-flash-lite`. Structured output via `responseSchema` + Zod.
- Image: Wikimedia Commons "Curb Ramp in San Diego.jpg" (CC BY 4.0, Mds08011). Output: `docs/samples/analyze_image_sd_curb_ramp.json`.
- Text: notice extraction for the article above.
- UI record: TODO (after A's persistence + B's panel).

## Mastra — evidence investigation agent
- Package: `@mastra/core` 1.83.0 `Agent` + `createTool`, Gemini via Mastra model router (`google/gemini-3.1-flash-lite`, fallback `google/gemini-3.5-flash`).
- Tools (bound server-side to one record; model chooses only a radius ≤200 m): `get_barrier`, `get_nearby_records` (A's Neon store), `get_construction_notices` (web_notice records + Bright Data notice cache).
- Real run 2026-11-14 on `city_gis:prowag2:3575` (downtown missing-curb-ramp intersection): 3 tool calls, 15 nearby 311/permit records combined, ~8 s. Trace + brief: `docs/samples/investigate_mastra_trace.json`.
- Guardrails enforced in code (`src/lib/agents/brief.ts`), not just prompt: cited ids/links must come from tool results; forbidden accessibility claims rejected; `recommendation_type` fixed to `informational_only`.
- Endpoint: `POST /api/investigate` (verified against `next build` + `next start`).

## ElevenLabs — text-to-speech
- API: `POST /v1/text-to-speech/{voice}` model `eleven_flash_v2_5`, premade voice "River". Free tier (10k chars/month).
- Real call 2026-11-14: spoke the Mastra brief summary for `city_gis:prowag2:3575` (326 chars) → 145 KB MP3 (44.1 kHz, 64 kbps) in 0.9 s.
- Endpoint: `POST /api/speak` reads only on-screen text (≤600 chars), rejects forbidden accessibility claims, caches identical text, 5/min/IP, 3000-char/day cap. Text stays visible; audio is never the only path.

## Gemini — imagery batch (honest outcome)
- 2026-11-14: Mapillary (CC BY-SA 4.0) photos for 88 city curb-ramp intersections → Gemini vision: 70 analyzed, 16 no photo, 2 rate-limited. Output was noisy (54/70 "likely obstruction", mostly parked cars / hedged). A deterministic quality gate hid 46; the rest were later **superseded** by the Claude review below. Free-tier quota on `gemini-3.5-flash` was exhausted by this run.

## Claude (via Claude Code subagents) — blind photo review
- Same 70 photos, shrunk to 640 px, reviewed blind (no city data shown) by two Claude Haiku subagents (~59k tokens each, ~90 s). Verdicts: ramp visible 1, can't tell 69 (side-facing dashcam shots rarely show the corner); 3 sidewalk obstructions (construction fence/cones, dumpsters). Two spot-checked by hand. Files: `docs/samples/photo_review/`. Stored as `ai_candidate` with `model` = reviewer label. This is AI review, not human verification.

## Vultr — hosts the full web app
- Instance `accesspath-sd-demo`: `vc2-1c-1gb` (1 vCPU / 1 GB, $5/mo), region `lax`, Ubuntu 24.04, created 2026-11-14 via Vultr API. Backups off, ufw 22/80/443 only.
- Runs: the whole Next.js app (map UI + `/api/barriers`, `/api/route`, `/api/notices`, `/api/investigate`, `/api/speak`) as systemd service under a non-root user, behind Caddy with Let's Encrypt TLS.
- URL: https://140-82-17-18.sslip.io (live 2026-11-14 ~12:45 PT). Data from Neon; AI calls to Gemini/ElevenLabs from the Vultr box.
- Verified from outside: home 200; `/api/barriers` 200 live_import; `/api/notices` 1 card; `/api/investigate` 200 ×4 (11–26 s); `/api/speak` 200 audio/mpeg; `/api/notices/refresh` 401 (no admin token or Bright Data key on server, by design).
- Scripts: `scripts/deploy/vultr-provision.sh`, `scripts/deploy/vultr-deploy.sh <ip>`.
- **Teardown after judging** (credit-limited): delete instance + ssh key via Vultr API/console.

## Image review table (real runs, n=2)
| Image | License | Model result | Human review |
|---|---|---|---|
| Curb Ramp in San Diego.jpg (SD, 2020-04-23) | CC BY 4.0 | ramp visibly_present; no candidates | Agrees; slope/condition not verifiable |
| Curb ramp with fences (Chicago, 2017-10-16; test only) | CC BY 2.0 | ramp visibly_present; no candidates | Railings channel the ramp (not obstruction); poles near curb debatable |
