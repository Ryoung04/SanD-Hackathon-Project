# Source Audit — Owner A (probed 2026-11-14 ~11:00 PST)

**Study area bbox (WGS84):** `[-117.175, 32.712, -117.150, 32.730]` (Downtown; contains 6th Ave / Ash St).
**Backup area:** shift east to `[-117.150, 32.712, -117.125, 32.730]` (East Village/Golden Hill) — not yet audited.
All counts below are live `returnCountOnly` results for the bbox using `esriGeometryEnvelope`, `inSR=4326`, `spatialRel=esriSpatialRelIntersects`.

## 1. City PROWAG layer 2 — "Missing Curb Ramp"
| Field | Observed |
|---|---|
| Endpoint | `https://services8.arcgis.com/WunV6yKxvEXfsV4W/ArcGIS/rest/services/CSD_PROWAG_FINAL_V2_WFL1/FeatureServer/2` |
| Access | HTTP 200, no auth, no ArcGIS error |
| Count | 2611 citywide; **24 in bbox** |
| Spatial | Point; native SR 3857; `outSR=4326` returns valid lon/lat |
| Timing | Layer `lastEditDate` 2026-06-24T01:02Z. **No record-level dates** → `source_observed_at = null` |
| Semantics | One point per **intersection node** (`NODE_ID`). `APPROACH_COUNT`, `RAMPS_REQUIRED`, `RAMPS_EXISTING`, `RAMP_DEFICIT`, `APS_DEFICIT` (accessible pedestrian signal), `cpname` (community). Deficit tells *how many* ramps are missing, **not which corner**. |
| Licensing | ArcGIS Online public layer; no explicit license in metadata — **unresolved**, attribute City of San Diego |
| Confidence | `geometry_precision: intersection` |
| Sample | `city_gis:prowag2:2960` NODE 43194 at `[-117.170735, 32.729338]`, 3 req / 2 existing / deficit 1 |

## 2. City PROWAG layer 3 — labeled "Missing Sidewalk"
| Field | Observed |
|---|---|
| Endpoint | `.../FeatureServer/3` |
| Count | 845 citywide; **2 in bbox** |
| Spatial | Polyline (SR 3857 → 4326 OK) |
| Semantics | **Contradictory.** Name says "Missing Sidewalk"; description says "only public sidewalk segments…" (existing sidewalks). Sampled in-bbox records have all ramp fields = 0. **Not ingested as barriers.** Do not label as `missing_sidewalk`. |

## 3. Traffic Control Map (DSD permits)
| Field | Observed |
|---|---|
| Endpoint | `https://webmaps.sandiego.gov/arcgis/rest/services/DoIT_Public/DSDPermits/MapServer/5` |
| Access | HTTP 200, no auth |
| Count | 13,717 in bbox (all history); **83 active** (`DATE_END >= 2026-11-14`) |
| Spatial | Point; native SR 2230; also `LATITUDE`/`LONGITUDE` attributes |
| Timing | `DATE_START`, `DATE_END`, `DATE_LAST_UPDATED` (epoch ms) |
| Semantics | `APPROVAL_ID` (e.g. PMT-3046452), `TRAFFIC_CONTROL_TYPE` (SDGE, Building Construction Project, Public Improvement Project, ATT, 5G, Other Work, null…), free-text `BLOCK_INFORMATION`. Some records' text names streets far from their point (e.g. "Carmel Valley Rd" at a Downtown point) → **location may be a permit centroid, not the work site**. Proves permit existence only; **not** sidewalk closure. |
| Licensing | City public map service; terms unresolved |
| Confidence | `approximate_point` |

## 4. Get It Done (311)
| Field | Observed |
|---|---|
| Endpoint | `https://seshat.datasd.org/get_it_done_reports/get_it_done_requests_open_datasd.csv` (dataset page `https://data.sandiego.gov/datasets/get-it-done-reports/`) |
| Access | HTTP 200, ~31 MB CSV; contains quoted multi-line fields → needs real CSV parser |
| Columns | `service_request_id, date_requested, case_age_days, service_name, service_name_detail, date_closed, status, lat, lng, street_address, comm_plan_name, case_origin, public_description, …` |
| Count | ~1,128 open rows in bbox matching a broad sidewalk/curb keyword filter (before category whitelist) |
| Relevant categories | `Sidewalk Repair Issue` (CONCRETE SIDEWALK REPAIR ISSUE 12.7k citywide, SIDEWALK LIFTED, Sidewalk Deficiency…), `Pavement Maintenance / CONCRETE CURB RAMPS REPAIR ISSUE`, `Traffic Engineering / CURB RAMP EVAL FOR NEW ADA`, `Tree Maintenance / Sidewalk Encroachment`, `Parks Issue / Sidewalk/Pathway` |
| Excluded | Striping, paint curb, graffiti, ESD "Encroachment" (mostly trash), parking |
| Semantics | Resident submissions; `unverified_report`. `closed` ≠ repaired. `public_description` is untrusted, may contain PII → truncated, flagged |
| Licensing | data.sandiego.gov open data (ODbL-style city open data policy) — attribute City of San Diego |
| Confidence | `approximate_point` (geocoded address) |

## 5. County sidewalks (MapServer/17)
Reachable; fields include `INVENTORY_DATE`, `SIDEWALK_WIDTH`, `SIDEWALK_SIDE`. **0 features in Downtown bbox** (unincorporated County only). Not used.

## Go/no-go
**GO.** Real PROWAG ramp-deficit, active traffic-control, and 311 sidewalk records exist in the study area. Ramp data is intersection-level only → B must keep warning-only mode (no edge exclusion).
