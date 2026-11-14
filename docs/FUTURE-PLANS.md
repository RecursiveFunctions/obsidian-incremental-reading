# Unified Incremental Reading Roadmap

Single authoritative product roadmap across the **Obsidian plugin** (`obsidian-incremental-reading`) and the **local-first PWA** (`PWA-alpha` / `PWA-WIP`), incorporating our scheduling, queue-mechanics, collection-portability, and diagnostics specifications.

For what is already released in the plugin, see `CHANGELOG.md` and `DESIGN.md`. For the PWA's automated execution queue and architectural decision records, see `PWA-alpha-roadmap/docs/ROADMAP-QUEUE.md` and `PWA-alpha-roadmap/docs/IMPLEMENTATION-STATUS.md`.

---

## 1. Delivered Foundation (Through v0.13.0 & PWA Epoch 2)

| Capability | Obsidian Plugin (`v0.13.0`) | Local-First PWA (`PWA-alpha`) |
|---|---|---|
| **Core Domain & Storage** | Append-only `.ir/` event ledger, block-anchored extracts, markdown clozes, PDF topics, image occlusion | SQLite-wasm + OPFS physical schema 4, Domain 2 revisions/heads/placements/trash, Epoch 2 E2EE cell & blob sync |
| **5-Dimension Mercy & Postpone** | **Shipped (`v0.13.0`)**: 5 weighted dimensions (*Importance*, *Lateness*, *Easiness*, *Investment*, *Recency*) against a 400-point baseline interval-growth curve; interactive `Alt+M` preview; separate `totalPostponeCount` and `recentPostponeCount` (resetting on review) | Basic day-aligned spread `postpone v2` shipped; **5-dimension Mercy scoring and `recentPostponeCount` starvation protection queued next** |
| **Schedulers & Divergence** | **Shipped (`v0.13.0`)**: FSRS-6 primary recall engine + local optimizer; 3-model Divergence Picker (`FSRS-6` / power-law `DSR` / `SM-2`); priority-scaled first topic intervals (`[1, 44530]`-day clamp) | `ts-fsrs` (`fsrs-7` profile revision) + local-day rollover semantics ratified (ADR 0003); **priority-scaled topic intervals and DSR divergence queued** |
| **Queue & Overload Controls** | Deterministic priority queue policies (`Strict`, `Balanced`, `Discovery`), item/reading jitter, daily ceiling, priority cutoff, startup auto-postpone | Soft daily new-item cap (`20/day`), canonical `dueOf()` helper, 8-slot / 2-minute `Again` requeue, queue-load chip |
| **Capture & Mobile** | Mobile capture/review FAB, bottom navigation shell, Ctrl multi-span extracts, PDF region crop & occlusion | Native PDF canvas + canonical text fallback, durable read-point tracking, offline service worker, account-less device pairing |

---

## 2. Phase 1 — Rich Collection Portability & Duplicate Guards (Immediate Priority)

Unblock full-fidelity collection migration (solving the v0 plaintext/title-only limitations) and cross-app portability between desktop collections, the Obsidian vault, and the PWA.

### 2.1 Rich-Content Collection Import
- **Component Stream Decoding (`compon` records):**
  - Decode rich HTML (`Type 13` / `0x1c`-byte buffer at text slot `+0x11`) and attached image (`Type 2`) component records by resolving registry member paths and filespace slots into clean Markdown notes and local attachments instead of falling back to plaintext registry titles.
  - Use byte-level resynchronization (`stride = 1`) when scanning component streams so records with under-reported `body_length` do not swallow subsequent valid records.
- **Question / Answer & Cloze Synthesis (`DisplayAt` bitmask):**
  - Inspect the component `DisplayAt` bitmask (`+0x08`) on multi-component items (`[13, 13]` or `[0, 0]`): components with `0xff` render on Question + Answer, while components with `0xd7` / `0xdf` (clearing bit `0x20`) render on Answer only. Automatically synthesize `{{c1::...}}` clozes or Q&A splits.
- **Extract vs. Topic Provenance & Lineage:**
  - Distinguish **Extracts** from root **Topics** during import using `source_article` (`+0x5d`) and `extraction_date` (`+0x4d`) metadata (non-zero if and only if extracted from a parent source), preserving parent-child lineage and concept-group affiliation (`+0x41`).
  - Preserve floating-point priority percentiles from `priority.sub` (`projectRelativePriorities`) rather than rounding to integers so collections with `>100` elements do not suffer tie-breaking order loss.
- **Read-Point Caret & Scroll Bookmark Recovery:**
  - Decode the 43-byte `element_parameters` block (`read_point_start`, `read_point_length`, `read_point_component`, `read_point_scroll_top`) and map reading carets directly into `.ir/` ledger bookmarks (Plugin) and Topic read points (PWA).

### 2.2 Duplicate-Source Detection & Vault Bridge
- **Duplicate URL / Source Guard on Import:**
  - Before minting a new topic from web capture, RSS feeds, or bulk import, normalize incoming URLs and content hashes against existing ledger/Source records (`IsURLDuplicate` parity) and offer to jump to the existing topic or append as a new extract.
- **Obsidian ↔ PWA Lossless Bridge:**
  - Complete the 1:1 Markdown vault + `.ir/` event ledger importer/exporter (`EXPORT.md` #3) so topics, block-anchored extracts, items, FSRS/DSR scheduling history, and postpone counts round-trip cleanly between the Obsidian plugin and `PWA-alpha`.

---

## 3. Phase 2 — Review Session Modes, Final Drill & Queue Diagnostics

Bring high-leverage session mechanics and visual calibration tools to both surfaces without cluttering the single-leaf review flow.

### 3.1 Final Drill & Early Review Tools
- **In-Session Final Drill Queue (`drill` parity):**
  - Track items graded below threshold (`Again` / lapsed or explicitly flagged during the pass) in a dedicated end-of-session **Final Drill** stage that cycles until every item achieves a passing recall grade, without mutating long-term FSRS stability after the first graded exposure of the day.
- **Semantic Review Passes (Branch, Subset, Search):**
  - **Branch session:** Start from any topic or extract in Collection (`Alt+I`) and queue only its descendant tree (reading + items), with an eligibility toggle for *Due only* vs. *Include unscheduled / not-yet-due*.
  - **Subset & Search sessions:** Multi-select rows in Collection or pipe an Obsidian/PWA search query into a focused review pass using the standard review leaf and provenance badge (`via branch`, `via subset`, `via search`).
- **Advance & Add to Outstanding:**
  - **Advance:** Pull future items forward safely (recomputing elapsed retrievability `R` honestly at review time).
  - **Add to today's pass:** Inject selected topics, extracts, or items into today's active queue without recording a synthetic review or altering Mercy/postpone counters.

### 3.2 Dynamic Neural Review (`Alt+N`)
- **Incremental Spreading-Activation Expansion:**
  - Upgrade Neural Review from a static upfront 3-layer BFS walk to dynamic spreading activation: re-seed activation from the element just reviewed/graded and expand deeper graph layers incrementally using bounded per-step budgets (`15` then `30` nodes) whenever the active neural queue drops below threshold.
  - Add an optional **Due-today filter** inside Neural sessions so users can restrict graph exploration to overdue/due material when desired.

### 3.3 Queue Randomization Preview & Leech Manager
- **Queue Randomization Curve Preview:**
  - Add a compact visual probability-curve preview in Settings beside `itemJitter` / `readingJitter` (`Strict`, `Balanced`, `Discovery` presets) plotting the cumulative selection probability and `(position, 100 - priority)` stair-step curve.
- **Multi-Criteria Leech Diagnostics & Triage (`Stats` view):**
  - Expand `Stats` (`Alt+S`) with a dedicated **Leech & Lapses** panel filtering items by combined criteria (lapses vs. threshold, interval ceiling, forgetting index / retention rate, and difficulty/A-Factor), paired with one-click triage actions (**Dismiss**, **Reset / Forget**, **Rewrite / Split**, or **Duplicate as sibling item**).
  - Include the calendar review heatmap and rolling 30-day true retention trend.

---

## 4. Phase 3 — Incremental Video, Audio & Web Capture

### 4.1 Timestamp-Anchored Media IR
- **Resume / Start / Stop Event Model:**
  - Ground video and audio extracts in explicit `{ resume, start, stop }` timestamp anchors stored in the ledger.
  - **Topic:** Local media file (`mp4`, `mp3`, `m4a`) or structured stream descriptor note (YouTube / podcast URL) with automatic resume-position bookmarking.
  - **Extract:** Ledger element carrying `timeRange: { start, end }`, parent media provenance, and optional transcript span.
- **Side-by-Side Review Player:**
  - Render media in the review source column alongside the extract/transcript pane, restoring `resume` on open, highlighting active extract ranges on the timeline, and supporting keyboard-driven timestamp extraction without leaving the review pass.
  - Maintain strict offline privacy: local media works 100% offline; hosted embeds connect only on explicit user playback, with zero background network calls.

### 4.2 One-Click Web & Feed Capture
- **Browser Extension & Feed Triage:**
  - Ship the companion browser extension for one-click web selection/article capture into the Obsidian vault, and complete client-side RSS/OPML inbox polling with daily introduction cap integration in the PWA.

---

## 5. Cross-Platform Alignment (Plugin ↔ PWA Parity Matrix)

To keep the Obsidian plugin and `PWA-alpha` aligned as one product family, features proven in one surface are ported to the other along these shared contracts:

1. **Unified Postpone v2 + 5-Dimension Mercy:** Upgrade `PWA-alpha`'s `src/scheduler/postpone.ts` from flat-priority sorting to support the 5-dimension Mercy ordinal scorer (`Importance`, `Lateness`, `Easiness`, `Investment`, `Recency` against the typical-interval curve) and `recentPostponeCount` starvation protection already live in the plugin (`v0.13.0`).
2. **Unified Topic & Item Scheduling Options:** Bring priority-scaled initial topic intervals (`max(floor, scale * pos^exponent)`, clamped to `[1, 44530]` days) and optional power-law `DSR` shadow divergence into the PWA scheduler alongside `ts-fsrs`.
3. **Shared Portability Fixtures:** Maintain shared test fixtures across both repositories for Markdown vault export/import, review-log CSVs, Anki `.apkg`/TSV, and rich-content collection imports.
4. **Plugin Directory & Release Milestones:** Complete Obsidian Community Plugins submission (plugin ID/name finalization + BRAT migration path) alongside PWA Phase 6/7 beta readiness.

---

## 6. Explicitly Out of Scope

- **Day-planner / tasklist subsystems:** Use native Obsidian tasks/daily notes or dedicated calendar tools; IR owns the reading and review queue.
- **Sleep / circadian tracking subsystems:** Overload is solved via 5-dimension Mercy, postpone, daily caps, and priority protection.
- **Streaks or guilt mechanics:** Both the plugin and PWA deliberately exclude streaks in favor of honest 7-day load forecasts and true retention metrics.
