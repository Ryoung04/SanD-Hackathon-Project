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
  - **B connected both (2026-11-14):** `src/lib/ui/evidenceClient.ts` (`investigate`, `speak`, `SPEAK_MAX_CHARS = 600`) and `src/components/EvidenceActions.tsx`. A bare 404 hides the button; a 404 with `NOT_FOUND` in the body shows as a message. Read-aloud speaks the AI summary once it is on screen.
- [x] **A `GET /api/sources`** connected in `fetchSources` and `src/components/SourcesPanel.tsx` ("Data sources" panel: what each source shows and does not show, counts, freshness).

## From Owner C → B (available now)
- **`POST /api/analyze-image`** (multipart): `image` file + `permission_confirmed=true` [+ `lat`,`lon` in SD County], or `commons_title=File:...`. Returns §4.4 shape plus `image` (license/attribution/captured_at), `location` (camera, or null), `location_note`, `observation_ids`, `saved`. Candidates are `ai_candidate`/`unknown`; saved only when a location exists. Errors: `{error:{code,message}}` with `BAD_REQUEST`, `PERMISSION_REQUIRED`, `IMAGE_TOO_LARGE`, `INVALID_LOCATION`, `IMAGE_SOURCE_REJECTED`, `RATE_LIMITED` (429), `AI_UPSTREAM` (502). Typical latency 5–15 s: show a loading state.
- **`GET /api/notices`**: `{data: NoticeCard[], meta:{count, refreshed_at, data_mode:"cached_live"|"empty", source_note}}`. `NoticeCard = {notice:{source_url, page_title, published_at, retrieved_at, cross_streets, pedestrian_impact_found, pedestrian_impact_language[], ...}, matched_permit_ids[], observation_id|null}`. `observation_id` null → show as a card (no marker). Matched notices already appear in `/api/barriers` as `source_kind: web_notice`.
- Upload images: `source_url` is `upload:<hash>` (not a link); render as text.
- **`POST /api/investigate`** (JSON) `{barrier_id, lat, lon}` — lat/lon = the record's marker point (A has no get-by-id; server looks it up within 60 m). Returns `{barrier_id, summary, supporting_observation_ids[], source_links[], conflicts[], uncertainties[], recommendation_type:"informational_only", meta:{agent:"mastra", model, tool_calls[{tool,input,result_count,ms}], note}}`. Show `summary` with the `meta.note` caveat, list `uncertainties`/`conflicts`, link `source_links`. Errors `{error:{code,message}}`: `BAD_REQUEST`/`INVALID_LOCATION` 400, `NOT_FOUND` 404, `RATE_LIMITED` 429 (6/min/IP), `AI_UPSTREAM`/`INVALID_OUTPUT` 502, `TIMEOUT` 504 (45 s cap). Typical 8–20 s: show loading; treat as optional.
- **`POST /api/speak`** (JSON) `{text}` — text must be what's already on screen (e.g. the investigate `summary`), ≤600 chars. Returns `audio/mpeg` (play via `URL.createObjectURL(await res.blob())`). Errors JSON `{error:{code,message}}`: `BAD_REQUEST` 400, `FORBIDDEN_CLAIM` 422, `RATE_LIMITED`/`BUDGET` 429, `UPSTREAM` 502. ~1 s. Keep the transcript visible; hide/disable the button on error.

## To Owner C (with A for persistence): access-detail endpoint (slope / ramps)
The map is ready now. Until this endpoint exists it shows the OSM snapshot only; a 404 changes nothing.
B owns the contract, which is in **`src/lib/map/accessContract.ts`**. The sample payload is `docs/samples/access_features_v1.json`, tested in `tests/ui/accessContract.test.ts`.

**Already covered by B (don't duplicate):** path-level running slope from USGS 3DEP 1 m lidar.
- `public/data/downtown-slopes.geojson` is built by `scripts/elevation/fetch-slopes.ts`; features are `kind: "slope_segment"`, `method: "inferred"`, ids `dem/<osm id>/<n>`.
- Stair height changes (`rise_m`) are also covered.
- C's feed adds most value with what elevation can't give: curb-ramp slope and flare, cross slope, width, surface condition, landings, and confirmation of "possibly unmapped stairs" spots (>12%).
- Reuse a `dem/...` id to replace one of B's estimates with a better value.

**Endpoint:** `GET /api/access-features?bbox=west,south,east,north` (the map requests `STUDY_BBOX`).
- Another path: set `NEXT_PUBLIC_ACCESS_FEATURES_URL` or edit `ACCESS_FEATURES_URL` in `src/lib/map/accessClient.ts`.
- Next.js route files may export only handlers and config. Put helpers in `src/lib/`.
- Persist through A's agreed contract. Don't create a second database.

**Response:** `{ data: Feature[], meta: { contract_version: "1", count, data_mode, generated_at, source_note } }`.
- A bare FeatureCollection or array also works.
- On errors, return `{error:{code,message}}` with HTTP 4xx/5xx. The map then falls back to OSM.

**Feature:** GeoJSON `Point` or `LineString` in lon,lat order (other geometries are dropped).
- `id`: stable. Reuse an OSM id (e.g. `way/123`) to **replace** that OSM feature with an enriched one; new ids are added alongside.
- `properties.kind`: `curb_ramp | ramp | ramp_candidate | slope_segment | sidewalk | footway | crossing | crossing_line | steps | entrance | elevator | kerb_lowered | kerb_raised | kerb_unknown | other`.
- `properties.detail` (all optional; send `null` for unknown and never guess):
  - `slope_pct`: running slope, absolute %.
  - `cross_slope_pct`, `width_m`, `kerb_height_cm`, `step_count`.
  - `surface`, `surface_condition` (`good|fair|poor|unknown`).
  - `ramp_type` (`curb_ramp|building_ramp|path_ramp|stair_ramp|unknown`).
  - `handrail`, `landing`, `tactile_paving`, `signals`: `yes|no|unknown`.
  - `wheelchair`: the raw tag only.
- `properties.provenance` (required in spirit):
  - `source`: human-readable.
  - `source_url`: https or null.
  - `source_date`: ISO date or null.
  - `method`: `measured|official_dataset|community_tag|ai_estimate|inferred|unknown`.
  - `verification_status`: A's `VERIFICATION_STATUSES`.
  - `confidence`: `high|medium|low|uncertain|unknown`.
  - `note`: one sentence on how the value was derived.
- Flat props work too: `detail`/`provenance` may be flattened into `properties`.

**Rules the map enforces; please match them at the source:**
- AI or elevation-derived values use `method: ai_estimate` or `inferred`. They render **dashed**, are labelled "~", and never show as measured.
- `ai_estimate` together with `official_inventory` is downgraded to `ai_candidate`.
- No "ADA compliant", "safe" or "accessible route" claims anywhere in `note`. A slope band is a description, not a verdict.
- A missing ramp in imagery means unknown, not "no ramp".

**If your names or units differ, there's no need to change the map code.** Edit one block in `accessContract.ts`:
- `FIELD_ALIASES`: field names and unit factors, e.g. `["slope_ratio", 100]` or `["width_in", 0.0254]`. Ratio, inch, cm and ft are already accepted.
- `KIND_ALIASES` / `METHOD_ALIASES`: other vocabularies.
- `SLOPE_BANDS`: thresholds and labels. Colors are the `--map-slope-*` tokens in `globals.css`.
- Bump `ACCESS_CONTRACT_VERSION` only for incompatible changes. The map shows a warning when versions differ.
- Add a test case in `tests/ui/accessContract.test.ts` for any new alias.

**Checklist for C's agent:** return the sample shape → `npm run test:ui` → load the map, open "Map details" and check that the status line reads "Detailed access feed: N features (M estimated)" → click a feature and check that the popup shows source, date, method, status and confidence.
