# Ognom - Feature Roadmap (explore branch)

Based on market research (2023-2026: Reddit, HN, Stack Overflow, MongoDB forums, competitor
GitHub issues) mapped against Ognom's current feature set. Ognom's position - native/fast,
private, no telemetry, BYO-key AI - matches the loudest market complaints (Compass Electron
bloat, Studio 3T pricing, Compass telemetry). These tasks build on that position.

**Process:** one task at a time → user tests & approves → next task. Update status here when done.

## Task sequence

### 1. Cross-connection collection copy - `done ✓ (user tested)`
The most recurring MongoDB workflow ask on Stack Overflow ("copy a collection from server A
to server B"); still answered with `mongodump | mongorestore`. No free GUI does it.
Ognom already holds multiple live connections (workspace pool) - the hard part is done.
- Right-click collection → "Copy to..." → pick target workspace / database / collection name
- Optional filter; batched streaming (not in-memory); progress + cancel
- Copy indexes optionally

### 2. Collection diff & sync - `done ✓ (user tested)`
Diff two collections (same or different connections): added / removed / changed docs,
field-level diff view, selective sync. Only Studio 3T's paid tier has this.
Staging-vs-prod verification is the driving use case.

### 3. Terminator: AI provider abstraction + hard read-only gate - `implemented, awaiting user testing`
- Provider abstraction: OpenAI + Anthropic + Ollama + LM Studio + custom OpenAI-compatible
  endpoints (BYO-key or fully local). "Schema never leaves your machine" is the
  differentiator vs Compass's cloud-only AI.
- Studio's read-only guarantee enforced in the Rust backend (`aggregate_collection`
  rejects $out/$merge on the Studio path), not just via prompt.
- AI API keys moved from localStorage into the encrypted vault (per-provider, AES-256-GCM,
  write-only from the webview; legacy key auto-migrated on launch).

### 4. Aggregation per-stage stats - `implemented, awaiting user testing`
"Stage stats" button in the pipeline builder: profiles each enabled stage
(prefix + $count) and annotates every stage card with docs-out, drop-off %, and
cumulative timing. Stats auto-hide when the pipeline is edited. Write stages refused.

### 5. Index intelligence - `implemented, awaiting user testing`
- `list_indexes` merges `$indexStats`: "unused" badge + ops-served count in the
  Indexes sheet (best-effort; degrades silently on views/restricted servers)
- Explain sheet: collection scan → ESR-ordered (equality → sort → range) suggested
  index derived from the query shape, with a one-click Create index button
  (works for find and for pipelines with a leading $match)

### 6. What's New slider - `implemented, awaiting user testing`
Version-gated: on first launch of a new version (localStorage `ognom-whats-new-seen`
vs app version), a 5-slide carousel shows the release highlights ~1.6s after launch.
Reopenable from About → "What's new". Slide content lives in
[src/lib/whatsnew.ts](src/lib/whatsnew.ts) - update it each release.

## Backlog - all implemented (awaiting user testing)

- ✓ Streaming import/export: batched + cancellable with progress toasts; import
  accepts JSON / NDJSON / CSV (type-inferred) / mongodump BSON; export adds NDJSON + BSON
- ✓ Shell autocomplete in Monaco: collection names after `db.`, collection & cursor
  methods, sampled field paths + operators inside bodies; shell `createIndex` now
  honors partialFilterExpression / collation / hidden (was silently dropped)
- ✓ Bulk update/delete: dropdown menu on the Documents tab, affected-count + sample-id
  preview, operator-only updates enforced, typed confirmation for delete
- ✓ Ops panel (Activity icon in the top bar): currentOp with kill, per-database profiler
  (level toggle + slow-op browser with COLLSCAN flags), live 2s server metrics
- ✓ Schema map: database right-click → inferred entity graph (reference-shaped fields
  matched to collection names), hover-highlighted SVG
- ✓ AI explain reading: "Ask AI to read this plan" on the Explain sheet
- ✓ Saved Studio insights: pin any prompt (hover a user bubble), rerun from Studio home
- ✓ Dev hygiene: vitest (19 tests: lib/diff, lib/bson), `npm run typecheck`/`test`,
  GitHub Actions CI (tsc + vitest + cargo check/test) on PRs and main/production pushes

## Status log

- 2026-08-08 - Roadmap created on `explore` branch. Task 1 started.
- 2026-08-08 - Task 1 implemented (backend `copy_collection`/`cancel_copy` with batched
  streaming + progress events; `CopyCollectionDialog`; sidebar "Copy to..." menu item;
  `list_databases`/`list_collections` accept an optional workspace id). Awaiting user testing.
- 2026-08-08 - Task 1 approved by user ("works like a charm").
- 2026-08-08 - Task 2 implemented (backend `diff_collections` two-pass batched `_id` diff with
  progress/cancel + `sync_documents` copy/delete resolution; `DiffCollectionDialog` with
  summary, category tabs, field-level diff, selective sync; sidebar "Diff with..."; `cancel_copy`
  generalized to `cancel_job`). Awaiting user testing.
- 2026-08-08 - Task 2 approved by user. Task 3 implemented: multi-provider `ai_chat`
  (OpenAI / Anthropic Messages API / Ollama / LM Studio / custom), encrypted AI key vault
  (`set_ai_key`/`ai_key_status`), backend read-only gate on Studio aggregations, provider
  settings UI. Awaiting user testing.
- 2026-08-08 - Tasks 4, 5, 6 implemented in one pass (user batching the testing):
  `aggregate_stage_stats` + Stage stats UI; `$indexStats` usage in Indexes sheet +
  suggested-index-with-create in Explain; version-gated What's New slider with About entry.
- 2026-08-08 - Entire backlog implemented (8 items, see above). What's New slides
  expanded to six covering the full release. All gates green: tsc, vitest (19),
  cargo check, cargo test (35).
