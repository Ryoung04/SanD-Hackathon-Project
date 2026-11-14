# Progress

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
