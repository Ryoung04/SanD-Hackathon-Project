# OWNER C — AI Mapping, Web Ingestion, Agents, Sponsor Integrations, and Deployment

> **Role:** AI + external web data + sponsor integrations + cloud/deployment coordination.  
> **Read first:** `PROJECT_MASTER.md`, especially common `BarrierObservation` contracts and 'unknown != accessible' policy.  
> **Primary question:** Can we create *new, traceable candidate accessibility evidence* from permitted imagery and real public notices without hallucinating current sidewalk passability?

## Success criteria

At minimum, run one real Gemini vision analysis on a legally usable image, store the result as an `ai_candidate` with source/date evidence, and show it in Owner B's UI. For Bright Data, run one **actual Bright Data** acquisition that returns a permitted public construction notice and turns it into a source-backed `construction_warning` record. Integrate Mastra, ElevenLabs, and Vultr only as time and accounts permit; never claim unused services.

## 1. Your ownership

```text
src/lib/ai/gemini.ts               # Vision inference; structured outputs
src/lib/ai/validate.ts             # Strict candidate response validation
src/lib/ai/imageSources.ts         # Permission-aware image references
src/lib/agents/investigate.ts      # Mastra agent/tools/workflow
src/lib/web/brightData.ts          # Sponsor web-data acquisition
src/lib/web/noticeExtractor.ts     # Notice -> source-backed candidate
src/lib/voice/elevenLabs.ts        # Speech generation
src/app/api/analyze-image/route.ts # AI image upload analysis endpoint
src/app/api/investigate/route.ts   # Agent evidence briefing endpoint
src/app/api/speak/route.ts         # Optional voice endpoint
scripts/ai/analyze-batch.ts        # Bounded batch ingestion after demo works
infra/**                           # Vultr config/deploy instructions
docs/sponsor-proof.md              # Actual sponsor use, screenshots/logs
```

Do not edit A's normalized data schema, ingestion internals, or B's map and routing components. Ask A for server-only `upsertObservations` helper or agreed ingestion API. You should only call A's persistence layer; never create a second conflicting observations table.

## 2. AI and reliability policy — non-negotiable

**Model output must never be treated as verified accessibility.**

- A visible ramp is not proof that its slope, landing, width, surface, or current condition is accessible.
- A ramp **not visible** in a photo is not proof that no ramp exists.
- A photograph might be years old; save the actual `captured_at` (or `null`) separately from inference time.
- Street photos cannot reliably identify the exact corner/crossing unless camera location and direction support that determination; default `geometry_precision = approximate_point`.
- AI-generated categories are `verification_status = ai_candidate`, `routing_impact = unknown`, until reviewed by humans with sufficient evidence.
- Do not process restricted/private imagery, scrape Google Maps/Street View in bulk, or assume public visibility equals permission for model training/derived datasets.
- Prefer Mapillary or KartaView only after reviewing the relevant API, license, terms and local coverage. If that is uncertain, use an explicitly authorized, user-provided image or other approved example.
- Never present confidence as statistical probability unless actually calibrated; use `uncertain`, `possible`, etc.
- Do not publish photos of bystanders, license plates, faces, or location-linked personal data unnecessarily.

## 3. Sprint 0 (10:30–11:15): credentials and one real test

### Service feasibility checklist

- [ ] Gemini: API key loads on server; one inference works using a permitted test image.
- [ ] Bright Data: provided team credit/account is active; one permitted web page can be retrieved with their actual product.
- [ ] Mastra: project initializes in TypeScript; one local tool invocation works.
- [ ] ElevenLabs: credits exist, but defer full voice integration until core app works.
- [ ] Vultr: deployment credentials/credits available; defer deploy until the server builds locally.
- [ ] Image sources: determine whether current Downtown San Diego imagery is available and legally usable through API. Do not assume coverage.

**Report blockers by 11:15 AM:** missing tokens, approval delays, API errors, image-usage uncertainty, or provider cost/quota limits. Have a credible no-service fallback for each optional integration.

Do not run an unbounded image scan in the first hour.

## 4. Sprint 1 (11:15–14:00): Gemini image -> candidate observation

### Input

- An image uploaded by a participant with permission, or a permitted source image returned through a documented API.
- Optional approximate coordinates, image capture date, source URL/license/attribution.
- Server enforces upload size, MIME type, rate limits, API-key protection, safe retrieval and max inference tokens.
- Do not let a random user URL cause unrestricted server-side fetching (SSRF); use upload or allowlisted image service references.

### Model task

Ask Gemini to examine only the **visible** scene for potential pedestrian barriers:

- curb ramp **visibly present** / **not determinable**;
- visible steps along pedestrian path;
- sidewalk obstruction (e.g., fencing, debris, parked vehicle), but note whether path continuity is uncertain;
- possible sidewalk surface damage;
- no clear evidence in image.

Make it output strict JSON, **not free-form markdown**, and prohibit location/time/source hallucination. Use server-side schema validation (Zod is a natural choice). Keep model output and independent image metadata separately.

### Minimal output contract

```json
{
  "status": "candidate",
  "image_reference": "upload-id-or-permitted-source-id",
  "captured_at": null,
  "candidate_observations": [
    {
      "category": "sidewalk_obstruction",
      "explanation": "Fence appears to narrow the visible pedestrian path; remaining passage width cannot be verified",
      "model_confidence": "uncertain",
      "verification_status": "ai_candidate",
      "routing_impact": "unknown"
    }
  ],
  "requires_human_review": true
}
```

All example content above is **hypothetical**. Do not put this into the map as though the model saw a real event.

### Convert to `BarrierObservation`

- Call A's `upsertObservations`, keeping exact source/image attribution and observation category.
- If no georeference is available, return analysis result for UI but **do not create a geographic marker at an invented point**.
- For image geo-reference that only locates the camera, mark precision `approximate_point`, not `sidewalk_edge`.
- Expose `POST /api/analyze-image` to B. Save original permitted image references securely, rather than mass rehosting raw provider images.

### Human review / validation

Review a small set of test images (aim for at least 5 varied real images **if legally obtained**):

- clear visible obstruction;
- no clear obstruction;
- ambiguous ramp corner;
- poor-quality/partial view;
- older image with capture date.

Keep a simple table of findings, false positives/unknowns, and why the images don't establish safe passage. Report real measured counts, not made-up accuracy percentages.

## 5. Sprint 2 (12:30–16:00): Bright Data -> construction warning

### Problem it solves

Government traffic-control points may not reveal whether pedestrians are specifically mentioned in a public notice. Use Bright Data to collect **permitted public construction updates**, then extract textual references to sidewalks, curb ramps, temporary walkways, closures, project dates and cross streets.

### Implementation

1. Select 1–3 official, publicly accessible San Diego construction notice pages (for example project updates on `sandiego.gov`). Verify scraping/API access complies with site requirements and permissions.
2. Make a **real request through Bright Data**, not an ordinary `fetch` mislabeled as their integration.
3. Retain exact URL, retrieval time, page publication/update date if provided, and a short non-copyright-infringing relevant excerpt or summary.
4. Extract structured fields using deterministic parsing or Gemini as needed:
   - `source_url`, `page_title`, `published_at` (or null), `retrieved_at`
   - `location_text`, `cross_streets`, `date_start`, `date_end`
   - `pedestrian_impact_language` (text indicating possible sidewalk impact)
   - `location_confidence` and `geocoding_method`
5. Geocode cautiously. When location cannot be resolved to a bounded point/segment, show it as a **notice card**, not a fabricated map marker.
6. Write a `construction_warning` observation with `verification_status = unverified_report` for the inferred pedestrian impact, and `routing_impact = unknown`; the page's existence is official, pedestrian blockage may be unverified.
7. Surface it in B's UI; clicking shows the original public notice and precise data-quality caveat.

### Acceptance

- [ ] Actual Bright Data account/product invocation succeeds (save sanitized request/response proof).
- [ ] At least one real public notice yields a useful structured warning or an honest 'no pedestrian restriction found'.
- [ ] Source URL and retrieval date visible.
- [ ] No automatic removal of route edges based only on a text notice.
- [ ] Process is repeatable or has a truthful cached-last-success fallback.

**If no usable notice exists** for the study area, do not force one. Expand to a different permitted official San Diego project page, or focus on extraction quality and keep it separate from routing.

## 6. Sprint 3 (16:00–19:30): Mastra evidence investigation agent

The agent must do a real tool-using workflow, not a single prompt without data. Example:

```text
User selects barrier ID
   -> getBarrier(id) [A's database]
   -> getNearbyOfficialRecords(bbox)
   -> optionally getConstructionNotices(bbox / matching street)
   -> optionally getImageEvidence(image_id)
   -> compare dates, source classifications and geographic precision
   -> return source-backed JSON evidence brief (uncertainty included)
```

### `POST /api/investigate` response

```json
{
  "barrier_id": "id-from-db",
  "summary": "A city planning record indicates a curb-ramp deficit near this intersection, but the affected crossing is not identified.",
  "supporting_observation_ids": ["id-from-db"],
  "source_links": ["https://example.org/replace-with-actual-official-link"],
  "conflicts": [],
  "uncertainties": ["Current condition is not verified", "Specific corner is unknown"],
  "recommendation_type": "informational_only"
}
```

That is a **shape example**, not evidence for a real record. Replace with true IDs/links.

### Guardrails

- Tool inputs bounded by location / known observation IDs; no arbitrary internet fetching from user instructions.
- Model isn't allowed to invent city reports, street names, present conditions, or dates.
- Source links must originate from returned records, not the model's imagination.
- If official and AI evidence conflict, include it under `conflicts` rather than silently selecting one.
- Agent cannot alter `verification_status` to `human_reviewed`, nor alter routing blocks, nor submit a City 311 report without user review and supported official workflow.
- Limit iterations/time/cost; provide deterministic timeout/error to B.

**Sponsor proof:** Save an example tool trace (redacted) showing Mastra made multiple actual tool calls and combined real results.

## 7. Sprint 4 (19:30–22:00): deployment and optional integrations

### Vultr

If time and credentials permit:

- [ ] Deploy a real service (API, ingestion worker, or analysis worker) on a Vultr instance.
- [ ] Enable HTTPS through a supported proxy/platform; configure secrets with environment variables.
- [ ] Confirm a test request from the frontend reaches the deployed worker.
- [ ] Document which component **actually** runs on Vultr, plus deployment/health-check proof.
- [ ] Avoid copying unnecessary 311 user text or unlicensed raw images to cloud logs.

If cloud deployment blocks core product stability, ship the local/other deployed web app and **do not claim Vultr integration**.

### ElevenLabs

- [ ] Server-side TTS endpoint accepts **already grounded, visible** text (e.g., the evidence summary displayed in map panel).
- [ ] `POST /api/speak` returns playable audio; show loading and failure states.
- [ ] B provides button and text transcript; speech should not be the only path to information.
- [ ] Do not generate speculative turn-by-turn instructions or tell user a route is safe.
- [ ] Document an actual ElevenLabs API call for sponsor proof.

### Optional MLH sponsors

- **SpaceXSI:** Cursor as primary coding agent + working Grok Bot automation + documentation + opt-in per official sponsor page. This is a team workflow decision, not automatically C's personal task.
- **GoDaddy Registry:** only if a qualifying domain can be registered rapidly and placed in actual use; do not burn the final hour on DNS.
- **Tiger Data:** only if an authentic time-series analysis use case emerges; don't add a second DB merely for eligibility.
- **Solana:** skip unless core product gains a meaningful blockchain requirement (none currently defined).
- **DEV:** article after hackathon according to the challenge's separate instructions.

## 8. Sponsor category proof checklist

Maintain `docs/sponsor-proof.md` with one entry per track **actually used**:

| Category | Required evidence to collect |
|---|---|
| Bright Data — Data for Good | Real Bright Data product usage, permitted public page, extracted notice, where resident sees it |
| Gemini API | Model/API request + permitted image + structured output + UI record |
| Mastra | Executed agent workflow + genuine multi-tool trace + grounded answer |
| ElevenLabs | TTS call + actual playable audio in accessible UI |
| Vultr | Live deployment/health-check, service role, infrastructure URL if safe to share |
| Neon | Ask A for live database/API verification proof |
| Best Overall / Most Innovative | Real user story and evidence showing the platform adds value beyond a static map |
| SpaceXSI/GoDaddy/Tiger/Solana/DEV | Only document if full published category criteria are satisfied |

**Do not assert prize eligibility from architecture diagrams alone.** Check official page: https://www.mlh.com/events/sand-hacks/prizes.

## 9. Handoffs and checkpoints

### To A (by ~1 PM)

- Exact `ai_candidate` mapping, image reference fields, source URL/license/capture date.
- Preferred `upsertObservations` interface: A's server-only function, no direct competing DB writes.
- One sample *actual API response* after successful inference (with sensitive details removed).

### To B (by ~2 PM)

- Stable `POST /api/analyze-image` JSON response, API error shape, whether upload support works.
- The first actual `ai_candidate` ID inserted in A's DB if available.
- Later `POST /api/investigate` and optional `POST /api/speak` endpoints with text-only fallback behavior.

### To submission coordinator (Sunday morning)

- Exact services truly used; do not overclaim.
- Screenshots/video clips of AI inference, Bright Data extraction, Mastra workflow and any voice/cloud integration.
- Honest caveat: imagery cannot verify accessibility, and unknown conditions remain unknown.

## 10. Tests and unacceptable shortcuts

- [ ] Vision output parsed through schema validation; malformed model JSON handled without DB corruption.
- [ ] No geolocation invented if image lacks location metadata.
- [ ] No photo capture date inferred from upload time.
- [ ] Never label ramps 'ADA compliant' from visual appearance alone.
- [ ] No arbitrary URL fetching from users; SSRF-safe image and notice retrieval.
- [ ] Respect usage permissions, rate limits, copyright/attribution and privacy.
- [ ] Construction inference doesn't become a confirmed sidewalk closure automatically.
- [ ] Agent citations reference source records; absent links are reported as missing.
- [ ] Voice only reads available grounded content.
- [ ] Optional services fail gracefully without breaking primary map.
- [ ] API keys stored server-side only; no secrets in demo recording or repository.

## 11. Recommended sequence for the time-boxed hackathon

| Window | Action | Output |
|---|---|---|
| Sat 10:30–11:15 | Verify credentials + permitted imagery | Real Gemini response; source policy decided |
| Sat 11:15–14:00 | Gemini structured output -> A's DB -> B's map | One AI candidate with source attribution |
| Sat 12:30–16:00 (parallel if feasible) | Bright Data notice retrieval/extraction | One real permit/notice enrichment |
| Sat 16:00–19:30 | Mastra evidence workflow | Multi-step source-backed brief |
| Sat 19:30–22:00 | Vultr deploy/test and integration cleanup | Live worker if possible; otherwise stable local demo |
| Sun 07:00–09:00 | ElevenLabs voice / sponsor proof / bug fixes | Optional audio and complete evidence screenshots |
| Sun 09:00–12:00 | Support video/write-up + track verification | No new risky features; final by noon |

**Do not let this workstream delay the source-backed map MVP.** If you must choose, a clean real Gemini candidate + Bright Data extraction are more valuable than a half-integrated pile of sponsor tools.

## 12. Paste into your CLI coding agent

```text
You are OWNER C (AI/integrations) for AccessPath SD at SanD Hacks 2026.
Read PROJECT_MASTER.md and OWNER_C_AI_INTEGRATIONS.md completely.
Implement a permission-aware image analysis workflow using Gemini that produces strictly validated, source-backed AI CANDIDATES, never verified passability claims. Connect through OWNER A's server persistence contract and OWNER B's display interfaces.
Use Bright Data for an actual permitted public construction notice retrieval, not a placeholder. Build Mastra evidence investigation only after one end-to-end image/notice record is visible. Add ElevenLabs and Vultr only if stable and demonstrably used.
Capture true provider integration evidence, guard against arbitrary URL fetches, and never fabricate images, map features, source dates or sponsor eligibility.
Before commits, follow the SanD Hacks legal commit window. Provide changed files, working test responses, cost/quota notes, and integration handoff details.
```
