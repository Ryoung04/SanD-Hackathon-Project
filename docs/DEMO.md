# Beacon SD — demo runbook

Live: **https://140-82-17-18.sslip.io** · Verified end to end 2026-11-15 ~09:00 PT (all APIs 200, no console errors).

## Before you record / present (5 min)

1. Open the live URL **1–2 min early**. Map tiles take ~5 s on first load. Use desktop Chrome, window ~1440 px wide, browser zoom 110% so text reads on video.
2. Hard-refresh (Ctrl+Shift+R) so you get the latest build.
3. Turn volume up (read-aloud is part of the demo). Close notifications.
4. Have the backup ready: `~/Desktop/Beacon intro.mp4` (intro) and the older GIF in Downloads.
5. Do **not** click: "agent" mode, **Report with a photo → Analyze photo**, or notice refresh. They need Gemini, whose free quota is exhausted.

## Video structure (≤ 3:00)

| Time | Segment | Source |
|---|---|---|
| 0:00–0:23 | Intro: missing-ramp photo → 25,000 → Beacon logo → sources → downtown | `Beacon intro.mp4` (done, voice synced) |
| 0:23–2:20 | Live app walkthrough (below) | screen recording + voiceover |
| 2:20–2:45 | How it works / sponsors | explainer visual (ask Claude to sync to your VO) |
| 2:45–3:00 | Close: honesty line + tagline + URL | end card |

## Live walkthrough — click by click

| # | Click | Say (suggested) |
|---|---|---|
| 1 | Nothing yet; point at the header bar | "Every marker is a public record. Beacon says *potential* barriers, and anywhere unmarked is unknown, never 'accessible'." |
| 2 | **Try a sample trip: Santa Fe Depot → Horton Plaza Park** (first of the two sample links) | "Say I'm in a wheelchair getting from the train station to Horton Plaza." |
| 3 | Point at route summary (1.06 km, building passage, plazas, *no mapped stairs*) | "We route on our own sidewalk graph from OpenStreetMap, with slopes from USGS lidar, and avoid mapped stairs." |
| 4 | Scroll to **Potential barriers near this route (12)** | "Then Beacon checks every record within 30 m of the route: 3 official city records and 9 resident 311 reports. Each one is labeled with where it came from." |
| 5 | Click **Intersection missing accessible pedestrian signals at 6 crossings (~9 m)** | "This is from the City's own inventory. You see the source, when it was updated, how precise the location is, and that it's not verified on the ground." |
| 6 | **Explain evidence** | "One click summarizes everything nearby: the city record, 12 open 311 reports from 2022–2026, and what we still don't know, all with source links." |
| 7 | **Read summary aloud** — let the voice play 3–4 s | "And for blind or low-vision users, ElevenLabs reads it aloud." |
| 8 | **Map details** → point at Ramps layer / legend "Detailed access feed: 49" | "We also reviewed 369 street photos with AI at the City's missing-ramp intersections. 49 show a ramp, which means the city record may be outdated. We label all of that as AI, unverified." |
| 9 | **Construction news** panel (optional, 5 s) | "Bright Data pulls local construction news and we match it to city permits." |
| 10 | **3D view** (+ **Hills on**) | "Hills and 3D buildings help you see slopes and the area before you go." |

### Stair-avoidance segment (shows the routing, ~25 s; do this right after step 4 or after step 10)

| # | Click | Say (suggested) |
|---|---|---|
| S1 | **Try a sample trip: Waterfront Park → US Federal Courthouse (avoids stairs)** (preference: *Prefer wheelchair-friendly paths*) | "Now say I need to get from Waterfront Park to the federal courthouse." |
| S2 | Point at the bold line: *"The standard walking route takes 3 mapped stairways; this route avoids them."* (1.56 km, ~26 min) | "A normal walking route takes three sets of stairs. Beacon finds a step-free route instead: about 200 m longer, with no mapped stairs." |
| S3 | Preference → **Standard walking** → **Get route** ("This route uses 3 stairways", 1.36 km) | "Here's the route most map apps would give you: shorter, but through three staircases." |
| S4 | Preference back to **Prefer wheelchair-friendly paths** → **Get route** | "Switch back, and the stairs are gone." |


**Curb-ramp example (one click):** "See an example record: City lists a missing curb ramp, street photos show ramps (West Grape St & Albatross St)" → map pans there and opens the City record → **Explain evidence**: City says 1 of 3 ramps missing; 2 of 4 street photos (2024) show a ramp. Say: "Here the sources disagree: the City lists a missing ramp, but street photos show ramps. Beacon shows both, labeled, instead of picking one." Then open Map details → Ramps layer.

## Searching other places

Place search covers downtown from about **G Street north** (Gaslamp's north half, Core, Little Italy, East Village north). Working examples: *Horton Plaza Park*, *Santa Fe Depot*, *5th & Broadway*, *America Plaza*. Petco Park / Market St are **not** in the search list.

## If judges try it live

- Point them at the sample trip button first.
- Answers to likely questions:
  - *Why no rerouting around barriers?* Records are tied to an intersection, not a specific sidewalk edge; rerouting would be false precision.
  - *How accurate is the AI?* It's labeled as a candidate. Photos can only confirm a ramp exists; "no ramp" calls were unreliable, so we dropped them.
  - *How fresh is the data?* Every record shows its own dates; expired permits drop off automatically. Data sources panel shows last import.
  - *Is Gemini / Mastra live?* They ran (proof in `docs/samples/`), but the free Gemini quota ran out, so the default summary is rule-based and instant.

## If something breaks

- Map blank > 10 s → refresh once. Still blank → play backup recording.
- Route says "unavailable" → use the sample trip (known good).
- Read-aloud silent → daily voice cap or volume; say "it reads the summary aloud with ElevenLabs" and move on.
- Site down → `scripts/deploy/vultr-deploy.sh 140.82.17.18`, or run locally: `npm run build && npm start` → http://localhost:3000.

## After judging

Tear down Vultr (instance + SSH key; IDs in the local handoff), rotate Mapillary and Bright Data keys.
