# OWNER B — Resident Map Experience, Accessibility UX, and Routing

> **Role:** Frontend owner, map interaction, route provider adapter, route warnings, UX/accessibility.  
> **Read first:** `PROJECT_MASTER.md`, especially shared API schemas and wording safeguards.  
> **Primary question to answer:** Can a resident *actually use* the evidence to understand a particular journey, without making false accessibility promises?

## Success criteria

A real user opens the app, sees a San Diego map, selects a neighborhood or two locations, views a baseline pedestrian route if available, and clicks a real barrier warning to see source and uncertainty. The judge can do this in < 3 minutes. The UI remains coherent even if routing or AI integrations fail.

## 1. Own these files (proposed)

```text
src/app/page.tsx                  # Main resident journey
src/app/globals.css               # Design tokens / accessibility styles
src/components/MapView.tsx
src/components/LayerControls.tsx
src/components/BarrierMarker.tsx
src/components/BarrierDetail.tsx
src/components/RoutePlanner.tsx
src/components/RouteComparison.tsx
src/components/SourceLegend.tsx
src/components/VoiceExplanation.tsx   # UI only; C owns speak endpoint
src/lib/routing/provider.ts        # Adapter for real routing service
src/lib/routing/nearby.ts          # Display logic for near-route warnings
src/app/api/route/route.ts         # Real provider route endpoint
src/lib/ui/**
tests/ui/**
```

Avoid modifying A's ingest/DB code or C's AI/agent code. Call their APIs/functions as defined in the shared contract.

## 2. Interface priorities

**Desktop/tablet-first for hackathon judging**, responsive on phone. Simple 2-pane interface:

```text
+---------------------------------------------------------------+
| AccessPath SD                         Layers | Search          |
+----------------------------------+----------------------------+
|                                  | Origin / destination       |
|   MAP                            | Mobility preference        |
|   - Official GIS markers         | Route result or warning    |
|   - 311 markers                  |                            |
|   - Construction notices         | Selected barrier           |
|   - AI candidate markers         | - Category                 |
|   - Pedestrian route             | - Evidence/source URL      |
|                                  | - Date and uncertainty     |
|                                  | - Speak (optional)         |
+----------------------------------+----------------------------+
```

Avoid an overloaded UI. Show layers toggles, but default to the handful relevant to a single trip. Do not let sponsor-specific controls dominate the primary journey.

## 3. Sprint 0 (10:30–11:00): app scaffold + contract

- [ ] Initialize Next.js + TypeScript + UI structure **after legal hacking start**.
- [ ] Choose MapLibre GL JS or Leaflet based on team familiarity (MapLibre for custom map styling; Leaflet for faster simple implementation).
- [ ] Define `BarrierObservation` consumer shape from master spec; confirm with A.
- [ ] Build a **clearly labeled fixture-only** map marker while A fetches real records. No sample invented marker may appear in final live-source demo as genuine data.
- [ ] Create left/top map + right-side info panel layout.
- [ ] Add a source/verification legend early; this isn't optional polish.

**Immediate dependency to request from A:** chosen bbox, sample real record, endpoint ETA. Do not wait for A's implementation to build the component shell.

## 4. Sprint 1 (11:00–13:30): real source-backed map

### Map behavior

- [ ] Load selected study area centered on actual records once A supplies them.
- [ ] Call `/api/barriers?bbox=west,south,east,north` on map movement with debounce and caching; don't call entire city every pan.
- [ ] Render points and lines correctly; geometry is GeoJSON `[lon,lat]`.
- [ ] Visually distinguish `city_gis`, `city_311`, `traffic_control`, `street_imagery_ai`, etc.
- [ ] Clicking an observation selects a stable `id`, opens detail panel and highlights geometry.
- [ ] Show data source, original link, category, earliest known observation date, last updated/ingested, verification state, geometry precision, uncertainty.
- [ ] Show `data_mode=demo_fixture` prominently if live DB/source unavailable.

### Required language in detail panel

For a ramp deficit record:

> Official planning inventory reports a curb-ramp deficit near this intersection. The exact affected crossing and current passability are not confirmed.

For 311:

> Resident-submitted issue report. Status may not correspond to completed repair work.

For construction:

> Scheduled traffic control nearby. This record alone does not confirm a sidewalk closure.

For AI:

> AI-generated candidate observation based on imagery dated [date, if known]. Requires review; does not certify accessibility.

Use actual record dates from A. Never use today's date as a substitute for the date of the original photo/survey.

## 5. Sprint 2 (13:30–17:00): routing and warnings

### Baseline route

- [ ] Implement `POST /api/route` contract in master spec.
- [ ] Choose a **real pedestrian** route provider and verify it supports the desired mode (Valhalla is a candidate). Do not assume a public demo routing server has guaranteed uptime or unlimited use.
- [ ] Use wheelchair-oriented preferences where supported, but label the result **'Pedestrian route — accessibility not verified'**.
- [ ] Return actual route geometry, distance, duration; if unavailable, return explicit error and render a fallback.
- [ ] Do not draw a straight line between start and destination and label it a route.

### Near-route barrier warnings

- [ ] Determine whether potential barriers are geographically close to route geometry, not just near one endpoint.
- [ ] Include a 'nearby' distance threshold and identify that it is approximate, not proof the user must encounter the barrier.
- [ ] Match point-at-intersection observations conservatively; never assume a specific corner/crossing from an intersection-level ramp deficit.
- [ ] Separate 'known from official records' from 'resident-reported' from 'AI candidate'.
- [ ] Display expected additional travel distance **only when two actual provider routes exist**; never invent comparison metrics.

### Conditional automatic rerouting

Implement only if you and A can establish exact affected pedestrian edges from reviewable evidence. For Valhalla, `exclude_locations` / `exclude_polygons` may avoid approximate road edges, which can be unsafe as a proxy for precise sidewalk/crossing closure. A generic point exclusion may block the wrong approach; if this is unresolved, disable automatic barrier avoidance and display warnings instead.

**Hard checkpoint ~5 PM Saturday:** Can we demonstrate one defensible reroute? If not, use a warning-first route explorer. That is a valid MVP.

## 6. Usability and disability-aware design

- [ ] Fully operable without voice. Keyboard-accessible inputs, button focus, visible focus rings.
- [ ] Markers must also be available in a textual observations list; mouse-only map interactions exclude some users.
- [ ] Route instructions and warnings have text equivalents, screen-reader labels and sensible reading order.
- [ ] Avoid color-only meanings: pair categories with label/icon/text.
- [ ] Do not hide sources and uncertainty behind tiny hover-only tooltips.
- [ ] Use adequately sized controls and map tap targets on phones.
- [ ] Provide simple mobility preference choices (e.g., 'avoid stairs'), but **never imply selecting 'wheelchair' certifies the route**.
- [ ] Read a short content disclaimer near route result, not a giant intrusive modal.
- [ ] Never publish unreviewed private user imagery or 311 personal details.

## 7. Integration contracts / request to other owners

### From A

- `GET /api/barriers` conforming to `PROJECT_MASTER.md`, real sample ID, bbox, known data uncertainty and available source types.
- Confirm which geometries are actually sidewalk lines vs intersections/points.
- Optional helper for 'near route' candidate IDs. If not available, build local proximity analysis with a documented approximation.

### From C

- `POST /api/analyze-image`: returns `candidate_observations`, original image reference (with legal display rights), review flag.
- `POST /api/investigate`: evidence explanation for a selected observation ID.
- `POST /api/speak`: optional. The UI sends only text already on-screen and labels a service failure without disrupting map.
- Do not allow AI endpoint failure to block route display or record inspection.

## 8. Test cases and Definition of Done

- [ ] Click an official City record, not a fixture; correct marker appears near its recorded coordinate.
- [ ] Click a 311 or construction observation; displays a different classification and caveat.
- [ ] Missing `source_observed_at` is displayed as `Observation date not available`, not today.
- [ ] Changing layer filters changes visible observations without deleting DB data.
- [ ] No barrier count is represented as evidence of a 'safe' route.
- [ ] If routing provider is down, route panel shows accurate unavailability; map and reports remain usable.
- [ ] If sources are unknown or incomplete, show visible 'Coverage incomplete' messaging.
- [ ] No fictitious route distance/time, no unlicensed map tiles, correct attribution for map provider.
- [ ] Keyboard alone can select observations via list, open/close detail, and access source link.
- [ ] End-to-end run-through under 3 minutes with a stable live demo.

## 9. Priority order for the hackathon

| Time | Deliverable | Condition to proceed |
|---|---|---|
| Sat 10:30–12:00 | Map shell, fixture badges, evidence panel | A's data schema locked |
| Sat 12:00–14:00 | Live barriers and sources | Real source-backed sample visible |
| Sat 14:00–17:00 | Origin/destination + baseline routing + nearby warnings | Actual route provider tested |
| Sat 17:00–19:30 | Polish resident journey and integrate AI candidate detail | Core doesn't crash |
| Sat 19:30–22:00 | Responsive/keyboard QA + demo sequence | Entire app usable |
| Sun 07:00–09:00 | Cross-browser tests, voice button if C ready | No new risky features after ~09:00 |
| Sun 09:00–12:00 | Record video + validate final deploy | Initial by 11, final by noon |

## 10. Sponsor relevance

- **Best Overall:** coherent working map that solves a clearly understood problem.
- **Most Innovative:** visualize AI-produced and official source evidence together, rather than just a 311 map.
- **ElevenLabs:** accessible spoken explanation as progressive enhancement, not a required control.
- **Neon:** actual backend data loaded through A.
- **Gemini / Bright Data / Mastra:** integration surfaces only; C owns implementations.

## 11. Paste into your CLI coding agent

```text
You are OWNER B (frontend/routing) for AccessPath SD at SanD Hacks 2026.
Read PROJECT_MASTER.md and OWNER_B_FRONTEND_ROUTING.md completely.
Own the interactive resident map, barrier evidence panel, route adapter, route warnings, accessibility UX and demo flow.
Start with a clearly labeled fixture while OWNER A validates live source data; replace it with real observations as soon as possible.
A baseline route must come from an actual pedestrian routing provider. Never claim wheelchair safety or hide unknown coverage. Do not automatically reroute around intersection-level points without specific matched pedestrian-edge evidence.
Keep AI/voice features optional so they cannot break the core app. Report changed files, tests, blockers and exact dependencies after each milestone.
```
