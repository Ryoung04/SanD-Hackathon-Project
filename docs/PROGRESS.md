# Progress

## Owner B — Sprint 0/1 shell (2026-11-14)
- **Outcome:** Next.js + TS + Leaflet scaffold. Map refetches `/api/barriers?bbox=` on pan (350 ms debounce, grid-snapped cache). Has an evidence panel with the required caveat wording, a source legend with layer toggles (glyph + text, not color only), and a keyboard observation list. Fixture fallback shows a banner and badges; there is a "Coverage incomplete" notice.
- **Files:** `package.json`, `tsconfig.json`, `next.config.mjs`, `src/app/{layout,page}.tsx`, `src/app/globals.css`, `src/components/{MapView,BarrierDetail,SourceLegend,ObservationList}.tsx`, `src/lib/ui/{barrierTypes,caveats,barrierClient,fixtures}.ts`, `tests/ui/*.test.ts`, `docs/OWNER_B_REQUESTS.md`.
- **Tests:** `npm run test:ui` → 17 pass (caveats, date fallback, bbox cache, fixture fallback). Lib typechecks. Components have NOT been typechecked or rendered yet; run `npm install && npm run typecheck && npm run dev`.
- **Tiles:** OSM standard tiles with attribution. That is fine for light demo use under the OSM tile policy; switch providers if traffic grows.
- **Blockers:** see `docs/OWNER_B_REQUESTS.md` (bbox, real samples, A's endpoint/types).
- **Next:** swap in A's real records; Sprint 2 `POST /api/route` adapter (Valhalla) + `RoutePlanner` + near-route warnings.
