# Roadmap

Single authoritative roadmap for **Incremental Reading for Obsidian**. For full release history see [`CHANGELOG.md`](../CHANGELOG.md); for architectural invariants see [`DESIGN.md`](DESIGN.md).

---

## 1. Shipped Baseline (Through `v0.17.0`)

- **Core Domain & Vault Storage:** Append-only `.ir/` event ledger, block-anchored extracts (with one-key standalone note promotion), Markdown clozes with hints, typed Spell-Pad clozes (`{{c1:=...}}`), multiple-choice (`ir-mcq`), sequence ordering (`ir-order`), text-layer PDF topics and extracts, local/streamed audio & video topics and timestamped clip extracts, Ctrl multi-span extracts, PDF/image region crops with rectangle & polygon image occlusion (`ir-occlusion`), inherited Concept Groups & source References (`ir_concept`, `ir_ref`), progressive reading chop commands, and non-modal side-panel priority placement for single mark, bulk folder/file mark (`files-menu`, default / fixed / even-spaced range), and extract-with-priority.
- **Exact SM20 Topic, Extract & Priority Mechanics:**
  - **Length-driven Topic A-Factor (`0x00cfee40`):** New topics and bulk imports compute initial `aFactor` from character length via `1.25 + 150 / (L + 200)` (`1.3` for image/crop extracts at `0x00bcb0a0`).
  - **Extract Inheritance & Parent Decay (`0x00cfdb80`, `0x00f4db80`):** Child extracts blend parent A-Factor with extract text-length A-Factor via weight `w = 0.9 - 0.9t / (t + 0.29)`, while immediately decaying the parent's A-Factor by 5% toward `1.01` (`(af - 1.01) * 0.95 + 1.01`).
  - **Extract Priority Spreading (`0x00ca1140`):** Child extract priority is randomized around parent priority $P$ within `[0.7*P, min(100, exp(1.7 * P^0.2))]` weighted by `L / (L + 100)` unless explicitly placed via `Extract selection with priority`.
  - **Topic Commit, Dispersion & Ease Adjustment (`0x00d85480`, `0x00e38580`, `0x00d01870`, `0x00cff250`):** First repetition uses `a^3`, subsequent repetitions use `interval * a` (with `a` clamped to `[1.01, 3.0]`), perturbed with log-uniform interval dispersion (`-10.85776 * ln(...)`), and updates `aFactor` via rational saturation.
  - **Item Grade Auto-Priority Drift (`0x00d77d20` / `0x00ca1e30`):** Passing item grades automatically drift priority upward (`Hard: +0.05`, `Good: +0.15`, `Easy: +0.30`), reversible via Undo.
- **5-Dimension Mercy & Postpone (`v0.13.0`+):** Due overflow scored across five configurable dimensions (*Importance*, *Lateness*, *Easiness*, *Investment*, *Recency*) against a 400-point baseline interval-growth curve; interactive `Alt+M` preview modal with live sliders; separate `totalPostponeCount` and `recentPostponeCount` tracking (resetting `recentPostponeCount` upon review so older items are never permanently starved).
- **Schedulers, Algorithm Arena & Multi-Model Divergence (`v0.14.0`–`main`):** SM-20 default item scheduler running the 5-algorithm Algorithm Arena (`SM-2`, `SM-15`, `SM-19`, `SM-20`, `FSRS` with live `LSRM` recall-accuracy weight adaptation and Settings sliders), schema v4 `alg17` matrices (all 8 non-sleep `.dat` structures including `int32`+`float64` `Retrievability.dat`, log-1.4 `ForgettingCurve` & `FirstInterval` readers, and 3D neighbor smoothing), SplitMix32-seeded `0x00cf2f30` interval dispersion with Undo re-roll, optional `0–5` 6-point SuperMemo grading, FSRS-6 with local parameter optimizer, post-grade Interval Choice / Divergence Picker, and priority-scaled first topic intervals (`[1, 44530]`-day clamp).
- **Queue & Overload Controls:** Deterministic priority queue policies (`Strict`, `Balanced`, `Discovery`), item/reading jitter, daily ceiling, priority cutoff, startup auto-postpone, `Add soonest future elements to today's session` (`Alt+Shift+A`), Collection numeric range filters / Spread Priorities / Subset Search & Replace / Integrity Audit & Repair, two-way SuperMemo `.xml`, Q&A `.txt`, and binary collection exchange, and full undo for grades, Mercy batches, manual reschedules, Later today, and Dismiss.
- **3-Layer Progressive Disclosure UX & Responsive Tiers (`v0.15.0`–`main`):** Calm primary Review dock (with responsive 2×3 6-point Fail/Pass grid on narrow panes and quiz-suggested grade confirmation), card-header utilities, humanized rank chip, unified `Reschedule…` bar, progressive `Element Info (I)` drawer (with forgetting curve and Concept/Reference autocomplete), Collection view (`Alt+I`) with Priority/Sources modes + inline tool drawers + touch `Select` mode, 4-tab Stats view (`Alt+S`: `Overview | Triage | Simulator | Models & SM-20` with 3-year workload simulator, 20×20 `SInc` surface, calibration benchmark, and clickable 20-category Priority FI subsets), Session log (`Alt+L`), Help panel (`Alt+H`), and container-responsive `compact`/`medium`/`expanded` tiers with unified Mobile Hub FAB and Touch Selection Bar.

---

## 2. Phase 1 — Rich Collection Import & Duplicate Guards (Shipped)

All Phase 1 items are implemented and shipped:

### 2.1 Rich-Content Collection Import (Shipped)
- **Component Stream Decoding & SM20 Registry Join:** `compon` stream decoding with stride-1 resynchronization, `.mem` + `.ptr` + `.rtx` registry lookup, `DisplayAt` Q&A/cloze synthesis, `source_article`/`extraction_date` provenance, floating-point `projectRelativePriorities`, and 43-byte read-point scroll/caret bookmark recovery.

### 2.2 Duplicate-Source Detection & Additional Formats (Shipped)
- **Vault-Wide Duplicate URL & Content Guard:** `buildDuplicateIndex` / `findDuplicateTopicOrExtract` normalize URLs (`anchor.url` + note frontmatter `url`/`source`) and content fingerprints (ledger `text` + frontmatter-stripped Markdown note bodies) across `bulkImport` and mobile capture, offering non-blocking **Open existing**, **Append as extract**, and **Import anyway** actions.
- **EPUB & HTML Document Import:** Zero-dependency PKZIP reader (`src/ir/zip-read.ts`) and shared HTML-to-Markdown converter (`src/ir/html-to-markdown.ts`) power `Import EPUB or HTML document` (plus file-explorer context menu), emitting a parent Book topic, ordered Chapter child topics with `A-Factor` and priority spread, wikilink TOC/cross-links, and extracted vault attachments.

---

## 3. Phase 2 — Review Session Modes, Final Drill & Queue Diagnostics (Shipped)

All Phase 2 items are implemented and shipped:

### 3.1 Final Drill, Advance & Semantic Review Passes (Shipped)
- **In-Session Final Drill Queue (`drill` parity):** End-of-session Final Drill re-tests `< Good` items until passed without mutating long-term stability.
- **Semantic Review Passes (`via branch`, `via subset`, `via search`):** Branch review, Collection multi-select review, Collection `Review filtered`, and Obsidian core Search review (`Review Obsidian search results (due / all)`).
- **SM-20 Early-Review R Damping & `Advance`:** Early reviews (`elapsedDays < prevS`) proportionally dampen stability gain as $R \to 1$ and bypass the `1.1x` interval growth floor; `Advance` (`0` / `today` or `N` days) spreads selected elements in priority order across `[0..horizonDays]` via undoable `manual-reschedule` events without touching Mercy counters.
- **Duplicate / Sibling Item Workflow:** One-key sibling duplication under the same parent with lineage and priority inheritance.

### 3.2 Dynamic Neural Review (`Alt+N` / `TNeuralQueue` Parity) (Shipped)
- **Incremental Spreading-Activation Expansion & `Due today` Toggle:** `NeedsExpanding` (`< 50`) bounded expansion, inverse-threshold `PickNext`, `neural.json` persistence, and an inline `Due today` filter chip on the Neural session bar (`neuralDueOnly`) preserving the unvisited seed and associative graph bridges.

### 3.3 Queue Randomization Curve, Postpone Ceiling & Leech Manager (Shipped)
- **Simulated `(position, 100 - P)` Dispersion Curve Preview:** Settings plots the live `(queue_position, 100 - P)` dispersion curve driven by `sliderToRepSortFactor`.
- **Priority-Interpolated Postpone Ceiling & SInc Shadow Model:** Priority-scaled maximum postpone intervals and 4-model Divergence Picker (`SM-20`, `FSRS-6`, `DSR`, `SM-2`).
- **Bounded Leech Triage & Calendar/Retention Analytics (`Stats` view):** Interval-bounded leech detection (`maxLapseIntervalDays`), post-reset `failRate`, interactive threshold controls, one-click `Forget / Reset` alongside Open/Postpone/Duplicate/Dismiss, a 26-week review/reading activity heatmap, and a 30-day rolling 7-day true retention curve.

---

## 4. Phase 3 — Incremental Video, Audio & Web Capture

### 4.1 Timestamp-Anchored Media IR (Shipped in v0.16.0)
- **Resume / Start / Stop Event Model:**
  - Ground video and audio extracts in explicit `{ resume, start, stop }` timestamp anchors stored in the `.ir/` ledger.
  - **Topic:** Vault media file (`mp4`, `mp3`, `m4a`) or structured stream descriptor note (YouTube / podcast URL) with automatic resume-position bookmarking.
  - **Extract:** Ledger element carrying `timeRange: { start, end }`, parent media provenance, and optional transcript span.
- **Side-by-Side Review Player:**
  - Render media in the review source column alongside the extract/transcript pane, restoring `resume` on open, highlighting active extract ranges on the timeline, and supporting keyboard-driven timestamp extraction without leaving the review pass.
  - Maintain strict offline privacy (`SECURITY.md`): local media works 100% offline; hosted embeds connect only on explicit user playback, with zero background network calls in `main.js`.

### 4.2 Companion Web Capture & Directory Release
- **Browser Extension for One-Click Capture:**
  - Ship the companion browser extension that writes captured articles and selections directly into the vault as Markdown topics (keeping the plugin bundle 100% free of network code).
- **Community Directory Submission & Mobile Polish:**
  - Finalize plugin ID/name for the official Obsidian Community Plugins directory (with a seamless BRAT migration path) and complete real-device mobile layout refinements.

---

## 5. Explicitly Not Planned

- **Day-planner / tasklist subsystems:** Use Obsidian tasks, calendar, or daily notes for life scheduling; IR owns the reading and review queue.
- **Sleep / circadian tracking subsystems:** Overload is handled with 5-dimension Mercy, postpone, dismiss, and priority protection.
- **Streaks or guilt mechanics:** Excluded in favor of honest 7-day load forecasts and true retention metrics.

*(Note: Concept Groups and Propagating Reference Metadata are supported via bidirectional `ir_concept` / `ir_ref` YAML frontmatter and `.ir/` ledger sync — see [`SCOPE-SM20-FULL-PARITY.md`](SCOPE-SM20-FULL-PARITY.md).)*
