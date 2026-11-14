# OWNER A — San Diego Geospatial Data, Database, and API

> **Role:** Data engineering + GIS validation + persistence.  
> **Read first:** `PROJECT_MASTER.md`. This file is not a substitute for the common schemas and safety rules.  
> **Primary question to answer:** Can we get *real* San Diego accessibility observations in the right places and explain exactly what each observation proves?

## Success criteria

By the first integration checkpoint, `GET /api/barriers` returns **at least one genuine, source-backed** City/County/311 record in a selected Downtown study area. Clicking it in Owner B's frontend shows the correct location, publisher, timestamp or an explicit `unknown`, and a source link. The database can save + query AI candidates sent by Owner C without incorrectly verifying them.

Your work is the **critical path**. If data proves insufficient, report that early and trigger the fallback described in `PROJECT_MASTER.md`.

## 1. Own these files (proposed)

```text
src/lib/data/types.ts                # Canonical shared types (coordinate with B/C)
src/lib/data/normalizers.ts          # ArcGIS and CSV -> BarrierObservation
src/lib/data/observations.ts         # Server-side list/upsert API for other owners
src/lib/data/sourceRegistry.ts       # Provenance, source age, URLs
src/lib/db/client.ts                 # Neon connection, server-only
src/lib/db/schema.sql                # Tables/indexes
src/app/api/barriers/route.ts        # Read endpoint
scripts/ingest/sd-prowag.ts          # City accessible GIS
scripts/ingest/sd-311.ts             # CSV subset
scripts/ingest/sd-traffic.ts         # Traffic control point layer
scripts/ingest/check-coverage.ts     # Geographic audit and counts
tests/data/**                        # Transform and source validation tests
```

Do not edit Owner B's UI components or Owner C's model prompts/agents. If a contract change is needed, notify the others **before** editing shared TypeScript types.

## 2. Sprint 0 (10:30–10:50): establish reality

**First 20 minutes**

- [ ] Confirm selected study area's bounding box. Start around **6th Ave / Ash St, Downtown San Diego**, but *do not assume* it contains valid current records. Keep a second nearby area as backup.
- [ ] Query the City PROWAG layer `/2` metadata and `/query?where=1%3D1&returnCountOnly=true&f=json`.
- [ ] Fetch a tiny geospatial feature sample with `outFields=*`, `outSR=4326`, and valid WGS84 bounding geometry; inspect response for `error` and null features.
- [ ] Verify actual geometry type, coordinates, ramp deficit fields, date fields, and license/reuse constraints.
- [ ] Query `/3` but flag that its **name ('Missing Sidewalk') conflicts with its description (existing sidewalks)**. Do not infer meaning from the name alone.
- [ ] Tell B and C: selected bbox, record count, 2 real sample records (IDs + coordinates + sources), and which categories are valid.

### Endpoint starting points

- City missing curb ramps: `https://services8.arcgis.com/WunV6yKxvEXfsV4W/ArcGIS/rest/services/CSD_PROWAG_FINAL_V2_WFL1/FeatureServer/2`
- City layer labeled missing sidewalk: `https://services8.arcgis.com/WunV6yKxvEXfsV4W/ArcGIS/rest/services/CSD_PROWAG_FINAL_V2_WFL1/FeatureServer/3`
- Traffic control: `https://webmaps.sandiego.gov/arcgis/rest/services/DoIT_Public/DSDPermits/MapServer/5`
- 311 CSV page: `https://data.sandiego.gov/datasets/get-it-done-reports/`
- County sidewalks: `https://gis-public.sandiegocounty.gov/arcgis/rest/services/DPW/TRANSPORTATION/MapServer/17`

### Safe URL examples

```bash
# Inspect service metadata (no authentication implied).
curl -fsSL 'https://webmaps.sandiego.gov/arcgis/rest/services/DoIT_Public/DSDPermits/MapServer/5?f=pjson' > /tmp/traffic-metadata.json

# Does the service expose a count? Inspect JSON and errors, don't trust HTTP 200 alone.
curl -fsSL 'https://webmaps.sandiego.gov/arcgis/rest/services/DoIT_Public/DSDPermits/MapServer/5/query?where=1%3D1&returnCountOnly=true&f=json'
```

Use a URL encoder and proper ArcGIS parameters when adding `geometry`, `geometryType`, `inSR`, `spatialRel`, `outSR`, `resultOffset`, `resultRecordCount`, and `f=geojson` as supported. Watch per-layer `maxRecordCount`; never silently truncate.

**Stop-the-line rule:** If no usable data is found after ~90 minutes, coordinate a small-location pivot with B and C rather than silently switching to synthetic records.

## 3. Sprint 1 (10:50–12:30): source audit + normalization

### Required audit table

Produce `docs/source-audit.md` or a section in the project README containing real observed values:

| Field | Record for each source |
|---|---|
| Endpoint | Exact source URL |
| Access | HTTP response, auth requirements, any ArcGIS error |
| Count | Actual count in selected bbox; do not guess |
| Spatial coverage | Bounding extent, sample geometry, CRS conversion |
| Source timing | Last edit time and record-level dates if available |
| Data semantics | What the attributes *actually* mean |
| Licensing | Attribution/redistribution terms or unresolved issue |
| Confidence | Whether a point identifies an intersection or an exact sidewalk edge |

### Normalize to `BarrierObservation`

Follow `PROJECT_MASTER.md` section 4 exactly:

- Unique IDs: `source_kind:source_record_id`, stable across refreshes.
- Geometry: GeoJSON `Point` or `LineString`, WGS84 `[lon,lat]`; reject invalid/empty geometry.
- Categories and statuses: categorical enums from shared contract; never assign `confirmed_blocking_edge` just because the GIS source is official.
- `source_observed_at` vs `source_updated_at` vs `ingested_at`: these are different concepts; never substitute one for the other.
- `source_url`: link to official publisher or record when possible.
- `description`: sanitize, truncate and mark as user-supplied if from 311; do not ingest/request unnecessary personal data.
- Preserve raw attribute subset under `metadata`, excluding unneeded identifying information.

### Suggested source mappings

| Source | Likely category | Default verification | Default routing impact |
|---|---|---|---|
| GIS missing curb-ramp record with verified meaning | `missing_curb_ramp` | `official_inventory` | `unknown` |
| 311 sidewalk complaint, based on matched category/description | `sidewalk_damage` or `sidewalk_obstruction` | `unverified_report` | `possible_obstacle` |
| Traffic-control permit | `construction_warning` | `official_inventory` for **permit existence** | `unknown` |
| AI observation from C | Based on model classification | `ai_candidate` | `unknown` |
| County sidewalk segment | **Network inventory**, not automatically a barrier | As available | `informational` |

For the traffic-control layer, check `DATE_START` / `DATE_END`, `TRAFFIC_CONTROL_TYPE`, `BLOCK_INFORMATION`, coordinates. A project scheduled during a time window is a **potential nearby disruption**, not proof of sidewalk closure.

## 4. Sprint 2 (12:30–14:30): Neon + read API

### Preferred schema design

Use a simple model that survives feature changes:

```sql
-- Illustration; adjust types after confirming installed extensions.
CREATE TABLE IF NOT EXISTS barrier_observations (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  label TEXT NOT NULL,
  geometry_json JSONB NOT NULL,
  geometry_precision TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_record_id TEXT,
  source_url TEXT,
  source_observed_at TIMESTAMPTZ,
  source_updated_at TIMESTAMPTZ,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verification_status TEXT NOT NULL,
  routing_impact TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'unknown',
  description TEXT,
  evidence_json JSONB NOT NULL DEFAULT '[]',
  metadata_json JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS barriers_kind_idx ON barrier_observations(source_kind);
CREATE INDEX IF NOT EXISTS barriers_category_idx ON barrier_observations(category);
```

For geospatial filtering, enable PostGIS only after verifying it is available in your Neon environment; otherwise keep a sanitized computed coordinate/bbox index for the small pilot region. A `geometry_json` storage field by itself is **not** a spatial index.

### Functions exposed to other owners

```ts
// Server-only, exact signatures to agree upon with C.
export async function listObservations(args: {
  bbox: [number, number, number, number];
  categories?: string[];
  limit?: number;
  cursor?: string;
}): Promise<{ data: BarrierObservation[]; next_cursor?: string; data_mode: 'live_import' | 'demo_fixture' }>;

export async function upsertObservations(
  observations: BarrierObservation[]
): Promise<{ inserted: number; updated: number; rejected: number }>;
```

- Validate data before persistence. **Do not** let Owner C set `verification_status = human_reviewed` or `routing_impact = confirmed_blocking_edge` automatically.
- Return clear error states and import summaries.
- Ensure `src/lib/db/client.ts` is server-only; `DATABASE_URL` never exposed to browser.

### `GET /api/barriers`

- Parse `bbox=west,south,east,north`, ensure numeric, sensible extents and WGS84 bounds; cap maximum size.
- Optional `categories=missing_curb_ramp,construction_warning`, `limit` <= 500, `cursor` for pagination.
- Return contract from master spec with `meta.count`, `meta.generated_at`, and truthful `meta.data_mode`.
- Query only observations inside bbox; point vs line intersection logic must be tested.
- No fetching all city records on every map pan. Cache source ingestion separately.

## 5. Sprint 3 (14:30–17:00): near-route warnings

- Accept a GeoJSON `LineString` from B for proximity analysis *as a server helper*, or B may do temporary client geospatial distance checks using an agreed threshold.
- Keep the distinction: **near the route** vs **on the correct pedestrian edge**.
- Return barrier IDs and explanation of matching method, e.g. `within_30m_approximate`, not `blocked`.
- Avoid exclusion decisions without manual review of exact edge.
- For official inventory records, distinguish current update time from survey/inventory date.

## 6. Tests and failure conditions

At minimum:

- [ ] `bbox` with empty result returns `data: []`, not a server exception.
- [ ] Invalid bbox rejected with 400 and documented error JSON.
- [ ] Inputs `[lon,lat]` correctly converted from any source CRS.
- [ ] Duplicate import updates a record without duplicating markers.
- [ ] Source observed date stays `null` if source lacks it (no fake time).
- [ ] GeoJSON `LineString` doesn't get treated as a single point.
- [ ] A 311 `closed` report isn't automatically marked repaired.
- [ ] AI-proposed missing ramp without reviewed geometry stays `ai_candidate` with `routing_impact: unknown`.
- [ ] Input strings are escaped/sanitized; credentials never logged.
- [ ] Read API works without direct client access to Neon credentials.

## 7. Handoff to Owner B

Provide, by **12:30 PM**:

```text
Study area bbox: [west,south,east,north]
GET /api/barriers URL:
Fields: schema version / differences (should be none)
One REAL sample observation id and geometry:
Source URL:
Which categories actually have coverage:
Known caveats:
```

By **2:30 PM**, confirm the API works from the frontend and provide a source/verification legend. Tell B immediately if a dataset's geometry is point-at-intersection rather than precise sidewalk/crossing geometry.

## 8. Handoff to Owner C

Provide, by **1:00 PM**:

- `BarrierObservation` TypeScript type and `upsertObservations` server function.
- Allowed `category`, `source_kind`, `verification_status`, and `routing_impact` enums.
- Instructions for capturing original web/image URLs, captured dates and retrieval timestamps.
- Field validation rules, deduplication rules, and evidence/link format.
- Agreement that AI observations do not automatically remove routing edges.

## 9. Sponsor tie-ins and deliverable proof

- **Neon:** Show a real geospatial read from the DB; demo should be using DB records, not only an in-memory array.
- **Best Overall / Innovative:** Document how unrelated city data sources were made interoperable and what was not known.
- **Bright Data / Gemini:** Give C reliable DB integration, but don't claim those features for this role unless actually working.

## 10. Paste into your CLI coding agent

```text
You are OWNER A (geospatial/backend) for AccessPath SD at SanD Hacks 2026.
Read PROJECT_MASTER.md and OWNER_A_GEOSPATIAL_BACKEND.md completely.
First validate the official San Diego GIS endpoints with real feature records and publish a short source audit. Do not fabricate records or location coverage.
Build a normalizer, Neon persistence with a truthful fallback, and GET /api/barriers under the shared contract. Then implement proximity warnings.
Do not change frontend or AI-owned modules. Share exact sample IDs and API outputs with other developers.
Before each commit verify the event commit window. Report files touched, commands run, counts found, acceptance tests passed, and any uncertainty.
```
