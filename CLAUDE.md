# AccessPath SD — Claude Code Token-Efficient Operating Rules

> Place this file at the **repository root** as `CLAUDE.md`. Claude Code automatically reads it. Keep this file short; do not paste the full project specification into every prompt.

## Objective and source of truth

Build a San Diego accessibility-awareness app using real municipal GIS, 311, construction, and permitted imagery data. The product warns about **potential** barriers; never claim a route is verified wheelchair-safe. Unknown accessibility is **unknown**, not accessible.

- Product scope, schemas, and safety: `PROJECT_MASTER.md`.
- Owner A (GIS/API/Neon): `OWNER_A_GEOSPATIAL_BACKEND.md`.
- Owner B (map/routing/UX): `OWNER_B_FRONTEND_ROUTING.md`.
- Owner C (Gemini/Bright Data/Mastra/voice/deploy): `OWNER_C_AI_INTEGRATIONS.md`.
- Read your assigned owner file at the start of the workstream. For subsequent tasks, **search the relevant heading and read only the needed sections**. Do not reread all four documents every turn or in every new subagent. If this differs from the original master doc's initial-read instruction, do the complete read once at kickoff, then use targeted lookup thereafter.

## Model policy: Opus 5.5 orchestrator, smaller workers

1. **Main coordinator:** Claude Opus 5.5. Use it for task framing, ownership boundaries, architecture, contradictory requirements, hard bugs, and integration decisions. Default to **medium effort**; increase only for genuinely hard reasoning. Do not use high/max effort by habit.
2. **Sonnet worker:** Delegate bounded implementation, refactoring, writing focused tests, or multi-file changes. State the exact files/interfaces and acceptance test. Request `model: sonnet` explicitly when invoking a subagent; do not inherit Opus accidentally.
3. **Haiku worker:** Delegate narrow file discovery, quick code inspection, identifying relevant error lines, or repetitive low-risk transformations. Request `model: haiku` explicitly. Check its findings before acting when data integrity or safety matters.
4. **Do the task directly** if delegation setup and extra context will cost more than the work: a one-file edit, a straightforward fix, or a simple command does not need an agent.
5. Use **at most two subagents at once per human-owned session**, and only for independent bounded tasks. Stop spawning more when they duplicate another owner's work. Our **three humans already own three parallel workstreams**; do not spawn a full agent team on top of them without a specific reason.
6. Subagents have **their own billable/limited context**. They are not free. The objective is less *total* usage and faster completion, not maximum delegation.

## Scope and token discipline

- Begin with the requested deliverable and a minimal plan (up to 4 steps). Make the smallest correct change. Avoid speculative features, unnecessary abstractions, and rewrites outside scope.
- Check `git status --short` and locate code with `rg --files` / `rg -n 'pattern' path/`. Read specific files, functions, or line ranges. **Never dump the entire repository, large CSV, giant JSON, or full logs into context.**
- Limit tool output: summarize counts, column names, representative records, failing test names, and the relevant last/error lines. Keep raw data on disk. For large GIS/311 files, sample or filter with code before returning results.
- Run the smallest meaningful test first (single file, unit test, typecheck for changed package). Do full checks at integration milestones, not after each tiny edit. Never hide test failures.
- If blocked, try one targeted diagnosis; then report the blocker and the smallest proposed workaround. Do not run endless retries or broad web searches.
- Reuse existing code, agreed APIs, and components. Do not create duplicate databases, schemas, routing adapters, or docs that another owner already maintains.
- Keep normal replies short: **changed files, tests, blockers, and next action**. Avoid large explanatory essays, repeating tool results, printing full files, or excessive progress narration.
- Never send secrets, `.env` contents, private images, or access tokens to subagents, logs, commits, or summaries.

## Ownership and integration rules

- **Owner A:** geospatial imports, validation, normalizers, `BarrierObservation` schema, Neon and `/api/barriers`. Shares a tiny real sample and API result shape with B/C.
- **Owner B:** map, origin/destination UI, route warnings, route adapter, accessibility UX. Uses A's API; does not silently reinterpret `unknown` as safe.
- **Owner C:** permitted imagery, Gemini candidates, Bright Data notices, Mastra evidence flow, ElevenLabs, Vultr. Writes through A's agreed persistence contract. AI detections remain unverified candidates.
- Before changing shared types, routes, or contracts, communicate the proposed diff to other owners. If another owner is responsible, return an interface request rather than editing their files.
- Every map warning must preserve **source, source date (or unknown), verification status, and routing impact**. A construction permit is not proof of a blocked sidewalk; an intersection-level ramp deficit is not proof of which corner is blocked.

## Subagent assignment template

When delegating, use a brief prompt of this shape; do not attach entire chat history:

```
Goal: <one concrete outcome>
Scope: <exact files/directories you may touch>
Read: <specific source files or sections only>
Contract: <existing API/types; do not redefine>
Done when: <test or observable behavior>
Return: <=8 lines with files changed, result, test, blocker
```

Preferred delegation examples:
- Sonnet: "Implement the mapping normalizer in `src/lib/data/normalizers.ts` against the shared `BarrierObservation` type; add a focused test; change no UI files."
- Haiku: "Locate where `verification_status` is set; return filenames/line numbers and any inconsistent assignments; do not edit files."
- **Not worth a subagent:** rename one variable, fix a typo, inspect one known function.

## Context resets and checkpoints

- Use `/usage` and `/context` if usage rises unexpectedly. Disable unused MCP servers with `/mcp`; use CLI utilities when simpler.
- After a completed milestone, leave a **short factual handoff** in the existing project progress notes (or create `docs/PROGRESS.md` once): outcome, modified files, exact test command/result, blocker, next task. Keep this file concise.
- Use `/compact` for long *ongoing* tasks; request: `Keep decisions, file paths, interfaces, test results, blockers, and next step. Drop raw logs and repeated discussion.`
- Use `/clear` or a new session when switching to an unrelated task, then reload only the owner scope and progress notes. Don't repeatedly compact a stalled session full of large data dumps.
- Do not treat brief answers, low effort, or subagent output as proof of correctness. Test behavior and preserve provenance before marking work complete.

## Hackathon finishing rule

Prioritize **real data -> map -> one resident journey -> source-backed warning -> optional AI/sponsor features**. By submission time, a stable demonstration with honest uncertainty beats many incomplete integrations. Don't claim an API, sponsor tool, image scan, routing capability, or accessibility verification was used unless it actually ran.
