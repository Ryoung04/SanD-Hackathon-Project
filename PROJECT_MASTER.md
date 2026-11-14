# SanD Hacks 2026 — Accessibility Intelligence / Barrier-Aware Routing

> **Status:** Hackathon implementation specification, not an account of completed functionality.  
> **Event:** SanD Hacks, UC San Diego, Nov 14–15, 2026 (America/Los_Angeles).  
> **Team:** Three developers; assign names to OWNER_A, OWNER_B, OWNER_C in the event kickoff.  
> **Scope:** One carefully selected Downtown/Central San Diego study area, starting with 6th Ave & Ash St **only if live records support it**.  
> **Working product name:** AccessPath SD (placeholder; rename freely).  
> **Agent entrypoint:** Read this entire file, then read your assigned `OWNER_*.md` file. Implement only owned surfaces unless an interface change is agreed upon.

## 0. Mission and the first principle

Build a resident-facing app that combines **real San Diego infrastructure GIS records**, possible construction impacts, community observations, and optional AI analysis of permitted street imagery to help people with mobility disabilities **investigate potential pedestrian barriers before travel**.

### One-sentence pitch

> San Diego's accessibility information is scattered across GIS services, city reports, construction notices and street imagery. We bring it together in one evidence-backed map and flag possible barriers near pedestrian journeys.

### Important wording and safety boundary

- **Do not promise wheelchair-safe routes** or universal real-time accessibility. Unknown != accessible.
- A municipal `RAMP_DEFICIT` at an intersection does not identify the affected curb/crossing by itself.
- A 311 submission is a **resident report**, not independently verified maintenance status. `closed` does not necessarily mean fixed.
- A traffic-control permit is **not proof that a sidewalk is blocked**.
- Computer vision detects *candidate* features; photos alone cannot verify ADA compliance, slope, precise width, passability, or current conditions.
- Only exclude an actual pedestrian routing edge after there is sufficiently specific, reviewed evidence identifying that edge. Otherwise give a warning and explain uncertainty.
- Prefer **'potential barrier'**, **'reported issue'**, **'historical inventory'**, or **'fewer known warnings'** over **'safe'**.

## 1. Judges' demonstration: build backward from this

A judge should be able to do the following without developer intervention:

1. Open the working app on a real San Diego map.
2. Select a Downtown neighborhood or origin + destination.
3. See official accessibility-related records as distinct layers, each with source, source date, and verification level.
4. View a *pedestrian route* (if a routing provider is functional), with nearby barrier warnings and uncertainty visibly explained.
5. Click a specific barrier and inspect its source evidence and how/why it was classified.
6. See an AI-assisted observation from a **real, legally usable** image or an extracted public construction notice, visibly labeled as unverified.
7. Optionally hear a short barrier description through ElevenLabs or run a Mastra evidence-check workflow.
8. Optionally compare an alternative route **only if** exact affected pedestrian edges can be determined. Otherwise label it a 'route with fewer reported warnings' and avoid accessibility guarantees.

### MVP vs stretch

**P0 — must ship**

- Official city GIS data actually retrieved for the selected area (not hard-coded invented barriers).
- Interactive map with category, provenance, timestamps, and evidence details.
- Search/selection of area and/or route origin/destination.
- Baseline pedestrian route **or**, if routing provider/data is unavailable, explicitly labeled route exploration that does not pretend a straight line is an accessible route.
- Near-route spatial warnings; distinction between confirmed geometry and approximate intersection points.
- Neon-backed normalized observations, if Neon credentials/support are available; keep a local JSON fallback for reliable demo continuity.
- Stable live demo and reproducible steps.

**P1 — key innovation / sponsor capabilities**

- Gemini image analysis on permitted street imagery or user-uploaded photo, producing structured candidate observations with a source link and human-review flag.
- Bright Data ingestion of permitted publicly available construction notices with extraction to candidate disruptions.
- Mastra workflow: gather a location's records + candidate image/notice + confidence and write a source-backed evidence brief.
- Deployment of a server/worker on Vultr (if feasible) and/or ElevenLabs spoken explanation.

**P2 — only after P0/P1 work**

- Verified barrier-to-pedestrian-edge association and real automatic alternative routing.
- Time-series reporting/Tiger Data; municipal prioritization dashboard; larger-area AI scanning; community reporting with moderation; custom domain; other optional MLH entries.

## 2. Team ownership / boundaries

| Owner | Main responsibilities | Files / surfaces (proposed) | Deliverable |
|---|---|---|---|
| **A: Geospatial + DB** | Verify sources; ingest/query; normalize records; provenance; spatial filtering; Neon | `src/lib/data/**`, `src/lib/db/**`, `src/app/api/barriers/**`, `scripts/ingest/**`, `db/**` | Live records and `GET /api/barriers` |
| **B: Frontend + Routing** | Map UX; layer controls; destination search; baseline route; warnings; comparison with guardrails; a11y | `src/app/page.tsx`, `src/components/**`, `src/lib/routing/**`, `src/app/api/route/**` | Complete interactive resident journey |
| **C: AI + Web + Integrations** | Gemini classifier; Bright Data collector; Mastra agent; ElevenLabs; Vultr; sponsor proof/docs | `src/lib/ai/**`, `src/lib/agents/**`, `src/app/api/analyze/**`, `src/app/api/investigate/**`, `src/app/api/speak/**`, `infra/**` | At least one real evidence-enrichment pipeline |

**Shared responsibilities:** Every owner tests their modules, writes README setup for their services, prevents secrets in git, supports final demo, and contributes factual claims + source links. Choose **one submission coordinator** during kickoff; not preassigned here.

**Read these handoffs:** `OWNER_A_GEOSPATIAL_BACKEND.md`, `OWNER_B_FRONTEND_ROUTING.md`, `OWNER_C_AI_INTEGRATIONS.md`.

## 3. Proposed architecture

```text
City GIS ArcGIS + 311 CSV + OSM walking network + permitted public notices/images
                 |                     |                     |
          Owner A ingester      Owner B route adapter      Owner C ingestion / Gemini
                 |                     |                     |
          Normalized observations in Neon PostgreSQL (+ PostGIS if enabled)
                 |                     |                     |
       GET /api/barriers     POST /api/route      POST /api/investigate
                 \_____________  Next.js app  ______________/
                                   |
                          Map + warnings + evidence
                                   |
                     ElevenLabs voice (optional)
```

**Recommended stack:** Next.js + TypeScript + React + MapLibre GL JS (or Leaflet if easier), Neon PostgreSQL, a server-side ingestion script, a pedestrian-route provider adapter (Valhalla is a candidate, not a guarantee), Gemini API, Mastra TypeScript, Bright Data, ElevenLabs. Run the app locally before any optional cloud complexity. If PostGIS isn't available in the chosen DB, use `lat/lon` and server-side bounding-box filters for the small study area and document limitations.

**Critical interface policy:** All HTTP JSON is `snake_case`; all GeoJSON coordinates are `[longitude, latitude]`; displayed location names are untrusted text; timestamps are UTC ISO 8601, displayed in Pacific time. No external keys in client code.

## 4. Shared data contracts — lock these during kickoff

### 4.1 `BarrierObservation`

```json
{
  "id": "san_diego_311:5773432",
  "category": "sidewalk_obstruction",
  "label": "Possible sidewalk obstruction",
  "geometry": {"type": "Point", "coordinates": [-117.16, 32.72]},
  "geometry_precision": "approximate_point",
  "source_kind": "city_311",
  "source_record_id": "5773432",
  "source_url": "https://data.sandiego.gov/datasets/get-it-done-reports/",
  "source_observed_at": null,
  "source_updated_at": null,
  "ingested_at": "2026-11-14T19:00:00Z",
  "verification_status": "unverified_report",
  "routing_impact": "unknown",
  "severity": "unknown",
  "description": "Example only; not a real assertion about this location",
  "evidence": [],
  "metadata": {}
}
```

**All values above are illustrative contract examples**, including ID, category, coordinates, and times; do not use them as authentic source records. Real observations must be created by live ingestion. Treat `description` as untrusted user text and escape it.

Allowed enum values:

- `category`: `missing_curb_ramp | noncompliant_curb_ramp | missing_sidewalk | sidewalk_obstruction | sidewalk_damage | construction_warning | stairs | crossing_issue | other`.
- `geometry_precision`: `sidewalk_edge | corner | intersection | approximate_point | unknown`.
- `source_kind`: `city_gis | county_gis | city_311 | traffic_control | web_notice | street_imagery_ai | community_report | other`.
- `verification_status`: `official_inventory | unverified_report | ai_candidate | community_confirmed | human_reviewed | outdated | unknown`.
- `routing_impact`: `confirmed_blocking_edge | possible_obstacle | informational | unknown`.
- `severity`: `low | medium | high | unknown` (never claim medical or passability certainty).

**Rule:** `official_inventory` authenticates a record's official origin, **not** a guarantee that today's infrastructure matches it.

### 4.2 `GET /api/barriers?bbox=west,south,east,north&categories=...`

Response:

```json
{
  "data": [{"id": "...", "category": "...", "geometry": {"type": "Point", "coordinates": [-117.16, 32.72]}, "geometry_precision": "intersection", "source_kind": "city_gis", "source_url": "...", "verification_status": "official_inventory", "routing_impact": "unknown"}],
  "meta": {"count": 1, "bbox": [-117.18, 32.70, -117.14, 32.74], "generated_at": "2026-11-14T19:00:00Z", "data_mode": "live_import"}
}
```

- Every item in production returns the complete `BarrierObservation` fields, not only the shortened example.
- Pagination if results exceed 500; expose `limit`, `next_cursor`, and max bounds.
- If using local fixture fallback, set `data_mode: "demo_fixture"` and visibly label in UI. **Do not count fixture observations as real evidence.**
- Response error shape: `{"error":{"code":"SOURCE_UNAVAILABLE","message":"..."}}`.

### 4.3 `POST /api/route`

Request:

```json
{
  "start": {"lat": 32.718, "lon": -117.164},
  "end": {"lat": 32.724, "lon": -117.158},
  "profile": "wheelchair_preference",
  "avoid_barrier_ids": []
}
```

Response:

```json
{
  "status": "route_available",
  "provider": "valhalla",
  "route": {"type": "LineString", "coordinates": [[-117.164, 32.718], [-117.158, 32.724]]},
  "distance_m": 880,
  "duration_s": 650,
  "nearby_barriers": ["san_diego_311:5773432"],
  "coverage_note": "Pedestrian path; accessibility unverified",
  "verified_accessible": false
}
```

Example distances, times, and geometry are **placeholders**, not actual computed results. Route shape must come from a real pedestrian routing provider. If route provider fails: `status = "unavailable"`, no fabricated `route`, and present a helpful fallback.

Do **not** infer `avoid_barrier_ids` from proximity alone; avoid edges only if matched precisely and reviewed. Default to warning overlays instead of exclusions.

### 4.4 `POST /api/analyze-image`

Input: authenticated/size-limited image upload or permitted image reference plus approximate location; do not pass arbitrary URLs directly to a server-side fetcher. Output:

```json
{
  "status": "candidate",
  "image_reference": "licensed_image_id_or_upload_id",
  "captured_at": null,
  "candidate_observations": [
    {"category": "missing_curb_ramp", "explanation": "Ramp not visible in the provided view", "model_confidence": "uncertain", "verification_status": "ai_candidate", "routing_impact": "unknown"}
  ],
  "requires_human_review": true
}
```

The example is illustrative; 'not visible' means **unknown**, not proof of absence. Reject output schema violations and model hallucinated sources.

### 4.5 `POST /api/investigate`

Input: `{ "barrier_id": "..." }` or a bounded point/bbox. Output: a source-backed structured brief with `summary`, `supporting_observation_ids`, `source_links`, `conflicts`, `uncertainties`, and `recommendation_type: "informational_only"`. AI never sets `confirmed_blocking_edge` independently.

### 4.6 `POST /api/speak` (optional)

Input: short already-grounded display text. Server invokes ElevenLabs; return playable audio or an explicit fallback. Do not let voice invent routing instructions.

## 5. Data sources and live validation

| Priority | Source | Link | Verified feature / known limitation |
|---|---|---|---|
| 1 | City accessibility GIS — missing ramps | https://services8.arcgis.com/WunV6yKxvEXfsV4W/ArcGIS/rest/services/CSD_PROWAG_FINAL_V2_WFL1/FeatureServer/2 | Published GIS layer; **feature records and local coverage must be tested** |
| 1 | Related layer labeled 'Missing Sidewalk' | https://services8.arcgis.com/WunV6yKxvEXfsV4W/ArcGIS/rest/services/CSD_PROWAG_FINAL_V2_WFL1/FeatureServer/3 | **Metadata contradictory:** description says existing sidewalk; fields are ramp/APS deficits; do not treat as confirmed sidewalk gaps without record-level verification |
| 1 | San Diego Get It Done | https://data.sandiego.gov/datasets/get-it-done-reports/ | Daily CSV; submissions, not verified repairs; filter categories, location and recency |
| 1 | Traffic control point features | https://webmaps.sandiego.gov/arcgis/rest/services/DoIT_Public/DSDPermits/MapServer/5 | `TRAFFIC_CONTROL_TYPE`, `DATE_START`, `DATE_END`, `BLOCK_INFORMATION`, lat/lon; cannot prove sidewalk closure |
| 2 | County sidewalks | https://gis-public.sandiegocounty.gov/arcgis/rest/services/DPW/TRANSPORTATION/MapServer/17 | Width, material, side-of-road, inventory date, line geometry; city coverage **unverified** |
| 2 | OSM | https://www.openstreetmap.org/ ; https://wiki.openstreetmap.org/wiki/Overpass_API | Pedestrian network and sometimes `wheelchair`, kerb/crossing attributes; unknown tags ≠ accessible |
| 2 | City ADA Right of Way Project | https://www.sandiego.gov/adacompliance/ada-right-of-way-project | Ongoing project south of I-8; city does **not** retain source survey images online |
| 3 | Planned paving | https://data.sandiego.gov/datasets/streets-planned-repair-projects/ | Context only, not pedestrian closure proof |
| 3 | Mapillary imagery | https://help.mapillary.com/hc/en-us/articles/360010234680-Accessing-imagery-and-data-through-the-Mapillary-API | Requires access/terms review and local imagery audit before automated analysis |

**Source access audit:** Metadata and fields were externally reviewed in planning; **we have not yet proven feature counts, neighborhood coverage, source download robustness, or edge-matching accuracy**. Those are Sprint 1 tasks. The app must not state otherwise.

### ArcGIS query pattern (Owner A)

```bash
# First inspect metadata: find available fields, count limits, supported formats.
curl -fsSL 'https://webmaps.sandiego.gov/arcgis/rest/services/DoIT_Public/DSDPermits/MapServer/5?f=pjson'

# Count records before downloading (example for a public service; validate access).
curl -fsSL 'https://webmaps.sandiego.gov/arcgis/rest/services/DoIT_Public/DSDPermits/MapServer/5/query?where=1%3D1&returnCountOnly=true&f=json'
```

- Validate the response is JSON and contains no ArcGIS `error` object.
- For geography filters use a **tested** WGS84 `bbox` with `geometryType=esriGeometryEnvelope`, `inSR=4326`, `spatialRel=esriSpatialRelIntersects`, and `outSR=4326`; URL-encode fields. Don't assume the output SR matches the map.
- Page using `resultOffset` / `resultRecordCount`, or object IDs where supported, respecting `maxRecordCount`; log counts, null geometry, failed requests, and source last-updated dates.
- ArcGIS service being reachable does not grant carte blanche to redistribute data. Verify service/license/terms for public deployment; if restricted, use permitted sources only.

### Go/no-go after first two hours

1. At least one **real** accessible GIS/311 record can be retrieved and plotted with a citation in the study area.
2. Inspect a sample manually: correct CRS/geometry, category, age, and location.
3. Check selected area's baseline pedestrian network and whether a useful route is returned.
4. Verify whether a specific missing ramp can be linked to a **corner/crossing**; if not, retain warning-only mode.
5. If missing-ramp GIS has no usable data, use trustworthy 311 + construction warnings as fallback, and explicitly scope the narrative accordingly.

## 6. Branching, quality and teamwork

**Git timing: read before starting:** official hackathon rules forbid commits dated before **Sat Nov 14, 10:30 AM PST** or after **Sun Nov 15, 12 PM PST**. Do not create project commits outside the allowed window. Do not fake commit timestamps. If uncertain what preparatory activity is permitted, ask organizers.

Suggested ownership branches: `feat/geodata`, `feat/map-routing`, `feat/ai-ingestion`. One owner creates initial repo and `main` during the legal window; others branch from it. Merge only after another owner reviews endpoint/shape changes. Always keep `main` runnable.

**Environment variables (names are illustrative, not guaranteed provider variable names):**

```dotenv
DATABASE_URL=
GEMINI_API_KEY=
BRIGHT_DATA_API_KEY=
ELEVENLABS_API_KEY=
MAPILLARY_ACCESS_TOKEN=
ROUTING_BASE_URL=
```

- Secrets go in `.env.local`; commit `.env.example` only with empty values.
- Never commit downloaded sensitive data, personal information from 311 reports, or unlicensed street images. Minimize or redact free-text reports in the UI.
- Maintain a README with a single command to run locally and a stable demo mode; report actual source refresh dates.
- Use unit tests for all transform functions and a smoke test from map click → API → evidence panel.
- Usability/accessibility: keyboard focus, textual route descriptions, readable contrast, no color-only warnings, screen-reader labels; voice is optional, not a replacement.

## 7. Sprint schedule (Pacific time)

| Window | A: Data/DB | B: UI/Routing | C: AI/Sponsor | Gate |
|---|---|---|---|---|
| **Sat 10:30–12:30** | Validate live GIS records, choose study area, lock schema | Scaffold map + data fixture aligned to schema; test pedestrian router | API credentials + one Gemini test; permitted-image access audit | Real record + source on map |
| **Sat 12:30–14:30** | Neon tables and `/api/barriers`, ingest 311/GIS | Replace fixture with live barriers; evidence drawer | Bright Data source test + structured extractor | Live map can explain a point |
| **Sat 14:30–17:00** | Spatial warning query and source freshness | Baseline route, warnings; test edge matching | Gemini imagery candidate + persistent record | Routing go/no-go by 17:00 |
| **Sat 17:00–19:30** | Stable API, fix data gaps | Refine UX, one polished resident journey | Mastra workflow; Bright Data enrichment | Sponsor features tied to evidence |
| **Sat 19:30–22:00** | Production DB / fallback snapshot | E2E flow, accessible UI | Deploy backend/worker on Vultr if viable | Entire app demo works |
| **Sun 07:00–09:00** | Bugs, provenance checks | Rehearse full flow; audio controls | ElevenLabs if stable; capture sponsor proof | Feature freeze ~09:00 |
| **Sun 09:00–12:00** | Submission support | Record and validate 3-min demo | Sponsor proof / write-up | Placeholder by 11:00, final by 12:00 |

**Official site discrepancy:** Devpost's general schedule shows submissions until 1 PM, while event rules, overview, and on-site schedule say **noon**. Use **11 AM initial, noon final** as controlling deadlines. Do not depend on the extra hour.

## 8. Decision matrix and fallbacks

| Problem | Fallback that remains honest and demoable |
|---|---|
| Missing-ramp GIS access fails | 311 and traffic-control warning map; label official vs reported distinctly |
| County sidewalk coverage sparse | OSM pedestrian paths with 'unknown accessibility' status; never imply municipal coverage |
| Routing provider unavailable | Show map + pinned source-backed barriers; no fictional route line or times |
| Barrier can't be linked to correct crossing edge | Render point warning; do not alter route automatically |
| No usable current street imagery | Let a user upload a permitted image for Gemini; label observed vs uploaded vs sourced |
| Bright Data source unavailable | Switch to a permitted second public notice page; do not claim Bright Data prize work without real tool usage |
| Neon fails | Static locally cached, **real-source** JSON snapshot with source timestamps and clear offline-mode label |
| Mastra / ElevenLabs / Vultr fails | Ship core app, omit sponsor claims for services not actually integrated |

## 9. Sponsor tracks — precise feature mapping

| Track | Concrete entry evidence | Priority |
|---|---|---|
| Best Overall | Fully functioning real-data app + live resident journey | Core |
| UCSD Basement — Innovative | New public-record + AI-derived evidence layer around user routes | Core |
| Bright Data — Data for Good | Actual Bright Data fetch of permitted construction notices + extracted map record | High |
| ElevenLabs | Actual generated spoken evidence explanation, with text alternative | High if stable |
| Neon | Real live DB storing/querying observations and source metadata | Core |
| MLH Gemini API | Real vision API call producing an inspectable AI candidate | High |
| MLH Mastra | Working multi-step agent with tools and logged source evidence | High |
| MLH Vultr | Working API/worker deployed to Vultr; deployment proof | High if feasible |
| MLH SpaceXSI | Cursor and Grok Bot workflow + documentation + raffle opt-in, per sponsor rules | Optional |
| MLH GoDaddy Registry | Qualifying registered domain actually in use, sponsor requirements met | Optional |
| MLH Tiger Data | Genuine historical/time-series use case using Tiger Data | Stretch |
| MLH DEV Writing Challenge | Published technical article on DEV meeting challenge rules | Separate/post-event |
| MLH Solana | Meaningful Solana integration (none proposed) | Skip |

Submitting to a category is not automatic qualification. Verify and complete each sponsor's latest instructions: https://www.mlh.com/events/sand-hacks/prizes and https://sand-hacks-26.devpost.com/.

## 10. Acceptance checklist / Definition of Done

### P0 app

- [ ] A real, inspected source record appears at correct coordinate(s).
- [ ] Barrier panel says who published it, when it was captured/updated (or unknown), source link, verification status and uncertainty.
- [ ] Map can filter types and distinguish official inventory vs 311 vs AI vs construction.
- [ ] No fake route coordinates, distances, accessibility safety scores, or unverified claims.
- [ ] A real pedestrian route works OR app clearly states route service unavailable; no broken UI.
- [ ] A user can follow the demo in 3 minutes and understand the intended benefit.
- [ ] Keyboard navigation and text alternatives work.
- [ ] `README` explains sources, run steps, reliability limits, known gaps.

### P1 meaningful sponsor usage

- [ ] Gemini output saved as `ai_candidate` with traceable image and uncertain claims.
- [ ] Bright Data actually retrieves usable web data (per terms) with source URL.
- [ ] Agent uses multiple tools/sources and returns cited evidence rather than unsupported conclusions.
- [ ] Neon queried in the actual demo (if entering Neon track).
- [ ] Voice / Vultr integrations work end-to-end before claiming those tracks.

### Submission

- [ ] All three members present for in-person judging, registered/checked-in as required.
- [ ] Initial Devpost submission by 11:00 AM Sunday.
- [ ] 3-minute **public** video link, write-up, GitHub link, selected eligible tracks, and optional demo link by noon.
- [ ] Screenshots, sample record IDs, and sponsor usage proof are truthful and reproducible.
- [ ] Every Git commit timestamp within permitted hackathon window.

## 11. Canonical references

- Event overview and deadlines: https://sand-hacks-26.devpost.com/
- Event rules / commit window: https://sand-hacks-26.devpost.com/rules
- MLH prize categories: https://www.mlh.com/events/sand-hacks/prizes
- City ADA project: https://www.sandiego.gov/adacompliance/ada-right-of-way-project
- City Get It Done: https://data.sandiego.gov/datasets/get-it-done-reports/
- Traffic controls: https://webmaps.sandiego.gov/arcgis/rest/services/DoIT_Public/DSDPermits/MapServer/5
- City PROWAG GIS ramp layer: https://services8.arcgis.com/WunV6yKxvEXfsV4W/ArcGIS/rest/services/CSD_PROWAG_FINAL_V2_WFL1/FeatureServer/2
- City PROWAG 'Missing Sidewalk' layer (verify semantics): https://services8.arcgis.com/WunV6yKxvEXfsV4W/ArcGIS/rest/services/CSD_PROWAG_FINAL_V2_WFL1/FeatureServer/3
- County sidewalk layer: https://gis-public.sandiegocounty.gov/arcgis/rest/services/DPW/TRANSPORTATION/MapServer/17
- Valhalla routing documentation: https://github.com/valhalla/valhalla/blob/master/docs/docs/api/route/api-reference.md
- Mapillary imagery API: https://help.mapillary.com/hc/en-us/articles/360010234680-Accessing-imagery-and-data-through-the-Mapillary-API

## 12. Copyable instructions for a CLI coding agent

```text
Read PROJECT_MASTER.md completely, then read my OWNER_[A/B/C]_*.md ownership file.
Before writing code: identify owned files, the exact contract(s) you implement, the first verifiable milestone, and external credentials/permissions required.
Do not create project commits outside the SanD Hacks legal coding window.
Do not invent source data, routes, accessibility certifications, source timestamps, or API outputs.
Use the shared BarrierObservation and API contracts exactly; ask the team before changing them.
Implement one small working vertical slice, test it, and provide: changed files, commands run, pass/fail, blockers, and interfaces needed from other owners.
Prioritize a usable demo over unintegrated sponsor APIs.
```
