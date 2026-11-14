# Owner B → interface requests (open)

B is building against shells until these come in. Replace each shell, then tick it off.

## From Owner A
- [ ] **Study bbox** `[west,south,east,north]`. Shell: `DEFAULT_STUDY_BBOX` / `DEFAULT_CENTER` in `src/lib/ui/fixtures.ts` (placeholder near 6th Ave / Ash St).
- [ ] **2 real sample records** (ID, coordinates, source_kind, source_url). Used to check marker placement and the detail panel.
- [ ] **`GET /api/barriers` ETA.** Until it exists, `src/lib/ui/barrierClient.ts` falls back to the labelled fixture (`data_mode: "demo_fixture"`, with a banner).
- [ ] **`src/lib/data/types.ts` landed.** Then switch `src/lib/ui/barrierTypes.ts` to re-export from it. B's copy matches PROJECT_MASTER §4.1. B assumed geometry is Point | LineString | MultiLineString; tell B if Polygon can occur.
- [ ] **Geometry semantics.** Which sources are true sidewalk lines and which are intersection/approximate points?
- [ ] **Pagination.** Does the bbox endpoint return `next_cursor` for the downtown area? B currently reads the first page only.
- [x] (Optional, Sprint 2) A near-route helper. Used: `findNearRoute` from `src/lib/data/observations.ts`. Without one, B does local proximity with a documented threshold.

## From Owner C (Sprint 2+)
- [x] `/api/investigate`, `/api/speak` shapes confirmed (see below); UI treats both as optional.

## From Owner C → B (available now)
- **`POST /api/analyze-image`** (multipart): `image` file + `permission_confirmed=true` [+ `lat`,`lon` in SD County], or `commons_title=File:...`. Returns §4.4 shape plus `image` (license/attribution/captured_at), `location` (camera, or null), `location_note`, `observation_ids`, `saved`. Candidates are `ai_candidate`/`unknown`; saved only when a location exists. Errors: `{error:{code,message}}` with `BAD_REQUEST`, `PERMISSION_REQUIRED`, `IMAGE_TOO_LARGE`, `INVALID_LOCATION`, `IMAGE_SOURCE_REJECTED`, `RATE_LIMITED` (429), `AI_UPSTREAM` (502). Typical latency 5–15 s: show a loading state.
- **`GET /api/notices`**: `{data: NoticeCard[], meta:{count, refreshed_at, data_mode:"cached_live"|"empty", source_note}}`. `NoticeCard = {notice:{source_url, page_title, published_at, retrieved_at, cross_streets, pedestrian_impact_found, pedestrian_impact_language[], ...}, matched_permit_ids[], observation_id|null}`. `observation_id` null → show as a card (no marker). Matched notices already appear in `/api/barriers` as `source_kind: web_notice`.
- Upload images: `source_url` is `upload:<hash>` (not a link); render as text.
- **`POST /api/investigate`** (JSON) `{barrier_id, lat, lon}` — lat/lon = the record's marker point (A has no get-by-id; server looks it up within 60 m). Returns `{barrier_id, summary, supporting_observation_ids[], source_links[], conflicts[], uncertainties[], recommendation_type:"informational_only", meta:{agent:"mastra", model, tool_calls[{tool,input,result_count,ms}], note}}`. Show `summary` with the `meta.note` caveat, list `uncertainties`/`conflicts`, link `source_links`. Errors `{error:{code,message}}`: `BAD_REQUEST`/`INVALID_LOCATION` 400, `NOT_FOUND` 404, `RATE_LIMITED` 429 (6/min/IP), `AI_UPSTREAM`/`INVALID_OUTPUT` 502, `TIMEOUT` 504 (45 s cap). Typical 8–20 s: show loading; treat as optional.
- **`POST /api/speak`** (JSON) `{text}` — text must be what's already on screen (e.g. the investigate `summary`), ≤600 chars. Returns `audio/mpeg` (play via `URL.createObjectURL(await res.blob())`). Errors JSON `{error:{code,message}}`: `BAD_REQUEST` 400, `FORBIDDEN_CLAIM` 422, `RATE_LIMITED`/`BUDGET` 429, `UPSTREAM` 502. ~1 s. Keep the transcript visible; hide/disable the button on error.
