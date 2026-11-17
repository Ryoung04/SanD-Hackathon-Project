# AccessPath SD

**2nd Place — SanD Hacks 2026**

A map that warns wheelchair users and other pedestrians about **potential** sidewalk barriers in San Diego: missing curb ramps, active construction, and resident-reported sidewalk damage. It pulls them from real city data, and every warning cites its source.

> AccessPath SD never claims a route is safe or accessible. A missing marker means *no record*, not *no barrier*.

## Features

- **Live city data on one map.** City accessibility inventory, active traffic-control permits, and 311 reports, combined into one format and served from Neon Postgres.
- **Every warning is cited.** Each record shows its publisher, source date (or "unknown"), a link to the original record, its verification status, and what it does *not* prove.
- **Trust panel.** For each source: what it proves, what it doesn't, current vs. outdated counts, and when it was last refreshed.
- **Route warnings.** Plan a pedestrian route (with wheelchair settings if you choose them) and see barriers within 30 m of it, labeled as approximate.
- **AI evidence brief.** An agent gathers nearby records and construction news into a summary that cites every claim. AI findings stay labeled as unverified candidates.
- **Read aloud.** Text-to-speech for the on-screen evidence. The text always stays visible.

## How it works

```
City ArcGIS layers ─┐
311 reports (CSV) ──┼─> import scripts ─> one shared record format ─> Neon Postgres + PostGIS
Traffic permits ────┘                                                        │
                                       /api/barriers, /api/sources, near-route queries
                                                                             │
                                          Next.js map ─> route warnings + evidence panel
```

1. **Import.** Scripts query the city's ArcGIS services and the Get It Done 311 file for the Downtown study area. Each record becomes a `BarrierObservation` with a stable ID, GeoJSON geometry, source link, dates, and verification status.
2. **Validate.** Records are checked before saving. AI or community records can never be stored as "human reviewed" or "confirmed blocking."
3. **Refresh safely.** `npm run ingest:safe` imports into a temporary Neon branch, checks the counts, and only then restores `main` from it. Records that drop out of a source are marked outdated, and expired permits are hidden.
4. **Query.** PostGIS spatial indexes serve map-area queries. A geography distance query (`ST_DWithin`) finds barriers near a route.
5. **Warn, don't block.** The ramp data is intersection-level (it doesn't say which corner), so barriers are shown as warnings and are never used to silently reroute.

## Data sources

| Source | What a record proves | What it does not prove |
|---|---|---|
| [City of San Diego PROWAG inventory](https://services8.arcgis.com/WunV6yKxvEXfsV4W/ArcGIS/rest/services/CSD_PROWAG_FINAL_V2_WFL1/FeatureServer/2) | The city lists a curb-ramp deficit at this intersection | Which corner, or that it's still missing today |
| [DSD traffic-control permits](https://webmaps.sandiego.gov/arcgis/rest/services/DoIT_Public/DSDPermits/MapServer/5) | A permitted traffic-control plan exists for these dates | That the sidewalk is closed |
| [Get It Done 311 reports](https://data.sandiego.gov/datasets/get-it-done-reports/) | A resident reported a sidewalk issue | That it's verified, or that "closed" means repaired |

Source caveats are in [docs/source-audit.md](docs/source-audit.md). For example, the city layer named "Missing Sidewalk" actually describes existing sidewalks, so it isn't used.

## Tech stack

- **App:** Next.js 14, TypeScript, React, MapLibre GL
- **Data:** Neon Postgres + PostGIS, `@neondatabase/serverless`, Neon branching
- **Routing:** Valhalla pedestrian routing
- **AI & voice:** Gemini, Mastra agents, Bright Data (news notices), ElevenLabs
- **Hosting:** Vultr
- **Tests:** Vitest

## Run locally

Requires Node 20+.

```bash
npm install
cp .env.example .env.local   # then fill in the values you need
npm run ingest               # import live city data into Neon (or a local file if DATABASE_URL is unset)
npm run dev                  # http://localhost:3000
```

Environment variables (see `.env.example`):

| Variable | Needed for |
|---|---|
| `DATABASE_URL` | Neon Postgres. Without it, data goes to a local JSON file |
| `GEMINI_API_KEY` | AI evidence brief and image analysis |
| `ELEVENLABS_API_KEY` | Read aloud |
| `BRIGHTDATA_API_KEY`, `ADMIN_TOKEN` | Refreshing construction news notices |
| `MAPILLARY_ACCESS_TOKEN` | Street imagery review |
| `VALHALLA_URL` | Custom Valhalla server (defaults to the public FOSSGIS server) |

Other useful commands:

```bash
npm test               # unit tests
npm run typecheck
npm run ingest:safe    # branch-validated import into Neon
npm run coverage       # record counts by source and category
```

## API

| Endpoint | Description |
|---|---|
| `GET /api/barriers?bbox=west,south,east,north` | Barrier records in an area (paged; follow `meta.next_cursor`) |
| `POST /api/barriers/near-route` | Barriers within a distance of a GeoJSON route |
| `GET /api/sources` | Per-source meaning, counts, and refresh history |
| `POST /api/route` | Pedestrian route via Valhalla |
| `POST /api/investigate` | AI evidence brief for one record |
| `GET /api/notices` | Construction news notices |
| `POST /api/speak` | Text-to-speech for on-screen text |

All JSON is `snake_case`. Coordinates are `[longitude, latitude]`.

## Limitations

- Coverage is the Downtown San Diego study area only.
- Ramp records are intersection-level. The affected corner is unknown.
- Reuse terms for the city GIS and permit layers weren't stated. Data is attributed to the City of San Diego.
- 311 reports are unverified resident submissions.
- AI detections are candidates for review, not confirmed barriers.

## Team

Built in about 25 hours at SanD Hacks 2026 by a three-person team:

- **Data & backend:** city data imports, the shared record format, the Neon/PostGIS API, and branch-validated refreshes
- **Map & routing:** 3D map, route planner, warnings, and accessible UI
- **AI & integrations:** Gemini and Mastra evidence agent, Bright Data notices, ElevenLabs voice, and Vultr deployment
