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

## Not yet used (do not claim): Mastra, ElevenLabs, Vultr.

## Image review table (real runs, n=2)
| Image | License | Model result | Human review |
|---|---|---|---|
| Curb Ramp in San Diego.jpg (SD, 2020-04-23) | CC BY 4.0 | ramp visibly_present; no candidates | Agrees; slope/condition not verifiable |
| Curb ramp with fences (Chicago, 2017-10-16; test only) | CC BY 2.0 | ramp visibly_present; no candidates | Railings channel the ramp (not obstruction); poles near curb debatable |
