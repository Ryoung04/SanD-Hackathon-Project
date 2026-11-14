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
- [ ] `/api/investigate`, `/api/speak` shapes confirmed; UI treats both as optional.
