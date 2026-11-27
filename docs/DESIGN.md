# Design Decisions

Architecture decisions for the incremental reading plugin, with rationale.
These are locked for v1 unless a decision explicitly says otherwise.

## Current v1 invariants

- Topics, cloze/quiz items, and image-occlusion items are Markdown notes; PDF topics, vault audio/video topics (`mp4`, `webm`, `mp3`, `m4a`, `ogg`, `wav`), and anchored text/crop/timestamp extracts may be ledger-only.
- The ledger under `.ir/` is authoritative for scheduling, review history, bookmarks, tombstones, anchor state, Concept Groups (`concepts.json`), generation-scoped sidecars (`drill.json`, `neural.json`, `sm20-matrix.json` schema v4), and root-level runtime state (`session.json`, `auto-postpone.json`, `analytics/`). `ir-` frontmatter remains a migration fallback and compatibility copy, while `ir_concept` / `ir_ref` YAML frontmatter syncs bidirectionally with `.ir/` so child extracts and items inherit Concept Groups and source citations automatically.
- New vaults default to **SM-20** (`primaryScheduler: "sm20"`, running the 5-algorithm Algorithm Arena across `SM-2`, `SM-15`, `SM-19`, `SM-20`, and `FSRS`) for items, while existing vaults grandfather to **FSRS-6** (`"fsrs"`) with a one-time upgrade offer modal (`Sm20SchedulerOfferModal`). Both schedulers share `StoredCard` state, support 4-point (`1–4`) or SuperMemo 6-point (`0–5`) grading, and can be switched losslessly in Settings. Topics and extracts use SM-20's decompiled reading and priority algorithms.
- Each completed migration, reset, and nuke uses generation metadata to isolate its live logs from stale root or prior-generation data.
- The live plugin folds concurrent event streams in clock order (using per-device fold checkpoints when the stream exceeds 250 events); there is no user-facing setting that switches it to conservative scheduling.
- Compaction writes and verifies a complete transaction archive before rewriting its live shard. A matching archive can recover only the validated prefix before an interrupted final JSONL event.
- Source notes are never rewritten to paint extract or cloze highlights.
- Anchored extracts become files only when explicitly promoted. Image-region extracts (`Alt+Shift+I` on PDFs, right-click crop on embedded images), rectangle & polygon image occlusion (`Alt+Shift+O` / `Alt+O`), interactive Markdown items (`{{cN:=...}}` Spell-Pad, `ir-mcq`, `ir-order`), and timestamp-anchored media clips are shipped workflows.
- Anki TSV export is one-way and omits image-occlusion items it cannot import (reporting the skipped count), whereas SuperMemo XML (`.xml`), Q&A text (`.txt`), and SM-20 binary collection exports support two-way collection/schedule/concept/reference round-trips.
- Reading-view highlights use a formatting-tolerant fallback that crosses inline formatting boundaries.
- Historical notes below explain how these decisions evolved; when they conflict, this section is current.

**Decision 2026-05-18:** Full structured-ledger model chosen (Option 1) over
the hybrid. All element state, including extracts, leaves frontmatter for the
plugin ledger; extracts become block-anchored with promotion. Chosen because
extraction is aggressive (a session of highlights must not mint a file per
span), no real data is at risk yet, and the rearchitecture is cheapest now
while the code is unshipped. Two sub-questions it raises are still open, see
"Open design questions" below. Q1 (anchor strategy) and Q2 (ledger granularity
and sync shape) are both resolved. The storage substrate (feature branch #1)
is now unblocked.

*(Superseded in part: the storage substrate, Q1, and Q2 are all shipped, and per the vault-reality note in Section 1, IR items remain Markdown notes while `.ir/` holds authoritative scheduling and review state.)*

**Decision 2026-08-14:** Obsidian's Graph view is not a product goal and not
a storage constraint. Incremental reading does not run on that picture.
See section 3.

## 1. Storage model

*(Historical 2026-05-18 rationale — superseded for item files by the vault-reality note below; `.ir/` is authoritative for scheduling, anchors, and runtime sidecars.)*

Items and cloze state live as **structured plugin data**, never as markdown
files, and never as inline HTML comments.

Two features each force structured state on their own:

- FSRS: the scheduler persists a per-card DSR state plus a review log. That is
  structured data, not something inline comments can carry.
- Multi-scheduler override (section 5): a card must record which scheduler owns
  it and carry enough state to run any ensemble member.

This is no longer a debatable default. It is a requirement.

A third reason in the original write-up — Graph hygiene: markdown file ⇒
graph node, so items and raw extracts must not be files — is **withdrawn**
(2026-08-14). See section 3.

**Note (vault reality, 0.0.10+):** IR *items* (clozes and image occlusions)
are stored as normal Markdown notes so they remain portable (plain files,
Anki-style cloze markup, other plugins can see them); scheduling state lives
in the structured `.ir/` ledger (with `ir-` frontmatter dual-written as a
compatibility copy). Cloze *markup* in the note body uses Anki-style
`{{cN::answer}}` with optional `{{cN::answer::hint}}` for SuperMemo-style
hints during review.

## 2. Extracts

Extracts are **block-anchored inside their source note by default**. An
extract becomes a standalone markdown note only on explicit user promotion.

The default is about session speed: aggressive highlighting should not
create a new file per span. Promotion is the moment you want that extract
as its own reading note — open it, link it, edit it — not a moment it
"earns a node" in Obsidian's Graph view.

**Opt-in extract-as-note (2026-08-11, GitHub #1).** The default is
unchanged: `Alt+X` stays anchored. Settings → **Extract to standalone
note** (off by default) is the alternative: every extract becomes a child
markdown note. That is still explicit promotion, just chosen once in
settings instead of per extract.

One-shot escapes when the setting is off:

- Extract selection to standalone note (`Alt+Shift+X`)
- Promote extract to standalone note (`Alt+Shift+P`, or the tree
  context menu)

New notes inherit an allowlisted slice of the parent YAML (`tags`,
`aliases`, `cssclasses`, `source`, `url`) and set `ir-parent`. Cloze
*item* notes (already files, per the vault-reality note in section 1)
inherit the same keys either way.

### PDF sources

**Decision 2026-08-19:** PDFs are first-class IR topics. They cannot carry
YAML, so the topic is **ledger-only** (`notePath` is the `.pdf` path). Alt+T
on an open PDF records that element (the core PDF viewer often leaves
`getActiveFile()` empty, so the command reads the file from the active
PDF leaf). Alt+X on a text selection creates an
anchored extract whose locator is Obsidian's public fragment
`#page=N&selection=beginIndex,beginOffset,endIndex,endOffset`, plus
`quote.exact` as the verbatim review payload. The PDF file is never
mutated (same §Q3 contract as markdown). Highlights are painted onto the
built-in pdf.js text layer from the ledger.

Cloze stays markdown-only: extract first, then cloze the extract. Scanned
PDFs with no text layer cannot be extracted. *(Historical note: cross-page
selection and area snapshots were originally deferred from v1, but both
subsequently shipped under Decision 2026-08-26 below via `pdf.segments`
and `pdf-rect-select.ts`; OCR and embedding a second pdf.js in the review
leaf remain out of v1.)* PDF++ is not required; a promoted extract's note
body includes the wikilink fragment so PDF++ can see it if installed.

Private viewer APIs (`view.viewer.child.getTextSelectionRangeStr`) are
fenced in `src/ir/pdf-view.ts`. Obsidian updates can break that path; a
`data-idx` DOM fallback exists. Do not spread those calls through
`main.ts` / `review-view.ts`.

The review side column cannot host the PDF. It auto-opens the native
viewer in a split, focuses it, and offers **Focus PDF** to bring it back
(UI commitment #2 exception, named in `docs/UI-COMMITMENTS.md`).

### Multi-selection, image regions, and occlusion

**Decision 2026-08-26:** SuperMemo Assistant parity on top of the PDF
model above, without a second anchoring scheme.

- **Ctrl multi-select.** A pure `PendingSelections` set
  (`src/ir/multi-select.ts`, dedupe by source + span, enforcing a
  single-source batch invariant so spans held in one note, PDF, or review
  card are never silently dropped if `Alt+X` is pressed elsewhere) plus a DOM
  controller that paints held ranges with `CSS.highlights`
  (`multi-select-dom.ts`). One rule on every surface: the first span
  carries the anchor, all spans join the stored `text`
  (`ExtractInput.textOverride`). PDF anchors gain `pdf.segments` (every
  span, any page); the painter highlights all of them, and the top-level
  `page`/`selection` still equal the first span so older readers work. In
  CodeMirror the hold is expressed as native multi-selection
  (`setSelections`) and Extract reads `listSelections()`. In reading view
  and the review card offsets are resolved at hold time
  (`mapRenderedSelectionToRaw`) because the DOM re-renders before Extract.
- **Image regions.** `pdf-rect-select.ts` draws a one-shot rectangle on a
  `.page`; `pdf-canvas.ts` crops the rendered canvas to a PNG attachment
  (public DOM only, private viewer API stays fenced in `pdf-view.ts`). The
  extract is a normal PDF extract with the page-only placeholder selection
  and `pdf.rect`; its text is the `![[crop.png]]` embed. Images inside
  notes are extracted byte-exactly on their embed markup
  (`image-embed.ts`), so decorations and relocation are unchanged.
- **Occlusion & interactive items.** Follows the cloze precedent: one item note per card, body
  is a single `ir-occlusion` fenced JSON block (normalized `rects` and/or multi-vertex `polygons` for `THitEditor` parity, `active`
  = tested mask, `mode` hide-all / hide-one; `src/ir/occlusion.ts`), or Markdown interactive quiz syntax (`{{cN:=answer::hint}}` Spell-Pad typed clozes, `ir-mcq` multiple-choice blocks, and `ir-order` sequence-ordering blocks; `src/ir/interactive-items.ts`). A
  code-block processor renders each block everywhere; in the review pane the block
  reads `.ir-review-revealed` on the card body so reveal stays with the
  pane's Space/swipe/grade flow (`isClozeLike = hasCloze || hasOcclusion || hasInteractiveQuiz`), and interactive quizzes highlight their suggested grade on the dock so `Space` / `Enter` confirms it without surprising auto-advance.
  Items need a markdown parent, so a PDF crop is promoted to a note first
  (same "extract, then cloze the extract" rule). The occlusion editor is an
  `ItemView` leaf (UI commitment #6) and keyboard-complete (#1).

Known limits: paragraph breaks inside a PDF selection are not recoverable
from the text layer; Anki TSV export omits image-occlusion items and reports
how many it skipped because that block format is not importable.

## 3. Graph (Obsidian Graph view)

**Decision 2026-08-14:** Graph view is not a design constraint. SuperMemo
never had one. Daily IR is the queue, the element tree, and the source in
front of you. Force-directed dots of every cloze file are a PKM screenshot,
not a learning loop.

Cloze item notes and standalone extracts are markdown files. They appear in
Graph if someone opens it. That is not a bug and not something we hide. Do
not spend a release excluding IR files from Graph unless we actually use
Graph and it is noisy.

What we still keep separate:

- The **IR element tree** is the SuperMemo hierarchy (source → extract →
  item). SuperMemo mixed that hierarchy with a concept network; we keep the
  tree in its own pane.
- **Neural review** walks `parentId`, vault wikilinks/backlinks, and shared
  tags. That adjacency is the IR walk (`src/ir/neural-graph.ts`). It is not
  Graph view.

## 4. Scheduler

Item scheduling runs through a unified dispatcher (`src/ir/item-scheduler.ts`)
supporting **SM-20** (`src/ir/sm20-scheduler.ts`, `src/ir/sm20-matrix.ts`) and
**FSRS-6** via `ts-fsrs` (`src/fsrs.ts`). New vaults default to **SM-20**, while
existing vaults grandfather to **FSRS-6** with a one-time upgrade offer modal
(`src/sm20-offer-modal.ts`); both operate on the same `StoredCard` state so
users can switch losslessly in Settings at any time. **SuperMemo 20's decompiled
reading and priority algorithms** (`src/sm18-ir-mechanics.ts` & `src/topic.ts`)
govern topics, extracts, and priority drift. The plugin **owns the IR queue**
(priority, topics, items, postpone, interleaving, and `sliderToRepSortFactor`
dispersion), because nothing in the Obsidian ecosystem provides an IR queue and
the queue is the core of the product.

Rationale: SM-20 and FSRS-6 share the DSR lineage (SM-17 -> FSRS-6 / SM-20).
For items under SM-20, scheduling runs SuperMemo 20's full **5-algorithm Algorithm Arena**
(`0x00d97fc0` -> `0x00cf2b80` / `0x00d8b990`: `6% SM-2 + 14% SM-15 + 45% SM-19 + 25% SM-20 + 10% FSRS`
baseline weights, auto-adapting over 100–200 reviews from live `LSRM` recall prediction error
and configurable in Settings) backed by `.ir/sm20-matrix.json` (**schema v4**) across all 8
non-sleep `alg17` structures: the 21x21x21 `StabilityIncrease.dat` and `Recall.dat` cubes
(`0x00cdeb50` analytical priors, `0x00ce6470` `sat(cases, 300)` + `0x00ce66e0` `(175, 0.01, 100, 0.1)`
matrix stability blend, 3D neighbor smoothing `smoothSm20SincCube` `0x00a93480`/`0x00a93510`),
`FirstInterval.dat` (`2x21x21x36` `uint32`, read via `0x00cdfb60` alongside `0x00ce0230` on post-lapse rep 1),
`ForgettingCurve.dat` (`2x36` `uint32` with `0x00cf5290` log-1.4 time bins, read via `0x00cf5590`),
`Retrievability.dat` (Half A `76x30` `int32` case counts + Half B `38x30` `float64` recall sums per `0x00cc69e0`),
and `DifficultyDistribution.dat` (`20` `uint32`), plus all 35 IEEE-754 weights of the SM-20 ML
evaluator (`*0x011a5bd0` / `0x00ce4810`, `0x00cad1b0`..`0x00cad8d0`), SplitMix32-seeded `0x00cf2f30`
interval dispersion (`hash(elementId, reps, lapses, smGrade, undoRollCount)` matching button previews and
re-rolling on Undo), early-review R damping across all 5 Arena candidates, adjacent-bin outlier
reconciliation (`reconcileRetentionMatrixOutliers`, `0x00c243f0`), minimum interval growth floor
(`0x00cf29c0`), and full item history replay (`replaySm20CardsFromEvents`, `0x00ce6f40` -> `0x00ce94a0`)
preserving existing `due` timestamps. For ungraded reading
elements (topics and extracts) and priority dynamics, we use the exact formulas
recovered from SuperMemo 20 (`sm20.exe`):

- **Length-based Topic A-Factor (`0x00cfee40`):** `1.25 + 150 / (L + 200)` from
  character length `L` (`1.3` for image/crop extracts at `0x00bcb0a0`).
- **Extract Inheritance & Parent Decay (`0x00cfdb80`, `0x00f4db80`):** Child
  extract A-Factor blends the parent's A-Factor with its own length-based
  A-Factor (`w = 0.9 - 0.9t / (t + 0.29)`), and decays the parent's A-Factor
  by 5% toward `1.01` (`(af - 1.01) * 0.95 + 1.01`).
- **Topic Commit (`0x00d85480`, `0x00e38580`, `0x00d01870`, `0x00cff250`):**
  First repetition uses `a^3`, subsequent repetitions use `interval * a` (with
  `a` clamped to `[1.01, 3.0]`), dispersed with log-uniform random spread, and
  adjusts `aFactor` via rational saturation.
- **Extract Priority Spreading (`0x00ca1140`), Placement Requests & Item Grade Drift (`0x00ca1e30`):**
  New extracts spread around parent priority `P` within `[0.7*P, exp(1.7*P^0.2)]`
  weighted by `L / (L + 100)` unless overridden via the non-modal placement
  priority side panel (`IrPlacementPriorityView`). Single-file mark with
  priority, bulk folder/file staging (`IrBulkMarkView` with default, fixed, or
  deterministic even-spaced range priorities), and extract-with-priority treat
  entered numbers as queue placement requests projected by `finalizeFold`.
  Passing item grades (`Hard/Good/Easy`) nudge item priority by
  `+0.05 / +0.15 / +0.30`.
- **Review log & local FSRS optimizer (`src/ir/optimizer/`):** Review grades
  and ratings (`1..4`, plus `overridden` flags) are persisted from day one.
  `fit.ts` runs seeded, deterministic Adam optimization over binary
  cross-entropy on the 21 FSRS-6 weights with a 20% held-out split; a
  candidate that fails to beat defaults on held-out log-loss cannot be applied,
  and `card-reset` events exclude pre-reset reviews from optimizer fitting and
  post-reset fail-rate calculations.
- **Interop:** Two-way SuperMemo XML (`.xml`), Q&A text (`.txt`), and SM-20 binary
  collection import/export (`src/ir/sm20-exchange.ts`, `src/ir/sm-collection-import.ts`)
  plus **Anki TSV export** as a one-directional escape hatch (omitting image-occlusion
  items). No runtime coupling to the `obsidian-spaced-repetition` plugin.

## 5. Multi-scheduler picker

Replicates SuperMemo's divergence-triggered algorithm chooser (`TIntervalChoiceForm`
`0x00cec060`) as a parallel ensemble (`src/ir/grade-divergence.ts`, `src/ir/sm20-analytics.ts`)
with weighted-average, minimum-interval, and left/right SD metrics plus manual override.

- **Ensemble members:** `SM-20` (adaptive SInc matrix), `FSRS` (FSRS-6 with
  user-fitted or default weights), `DSR` (power-law SM-18/20 analytical
  baseline), and `SM-2` (classic ease-factor baseline).
- **Architecture:** One **primary** scheduler (`sm20` or `fsrs`) is
  authoritative and owns card state. The remaining members run as **shadows**
  in parallel and never mutate state unless chosen in the Divergence Picker.
- **Divergence metric & display:** Interval **ratio** (`max(intervals) /
  min(intervals) > k`, default `1.5`, gated by an absolute floor of 7 days).
  The inline picker plots intervals on a logarithmic track
  (`DIVERGENCE_TRACK_SCALE = "log"`) using theme CSS variables so multi-year
  SM-20 intervals do not crush short FSRS segments.
- **UX:** The picker is **opt-in expert mode, off by default**. Default behavior
  silently follows the primary scheduler. Settings -> **Show scheduler
  divergence picker** arms the inline chooser when intervals diverge past the
  threshold; overridden choices are recorded on the `graded` event
  (`overridden: true`) so the FSRS optimizer and SM-20 matrix updates can
  account for them.
  **Migration (2026-08-13):** new vaults get off. Existing installs that
  already had the always-on picker are grandfathered to on so their workflow
  does not silently change; they can turn it off in Settings.

## 6. Mercy / Postpone, Manual Rescheduling & Leeches

Overload handling via **queue redistribution only**.

The critical rule: postpone moves a card's position in the queue. It never
tells the scheduler the card was reviewed. The scheduler state stays pristine.

- **5-dimension Mercy (`src/ir/mercy.ts`, `src/ir/mercy-modal.ts`):** When due
  load exceeds the daily ceiling, Mercy ranks overflow across five weighted
  dimensions (*Importance*, *Lateness*, *Easiness*, *Investment*, *Recency*)
  paired with the 400-point `TYPICAL_INTERVAL_TABLE` growth curve, caps
  postponement by priority (`postponeCeilingForPriority`), and previews the
  14-day redistribution in an interactive stacked bar chart (`Alt+M`).
- **Manual rescheduling (`src/ir/manual-schedule.ts`):** `Jump interval...`
  reschedules by day count or `YYYY-MM-DD` date (with optional topic A-Factor
  adjustment and dispersion), and SM-20 `Advance` spreads selected elements in
  priority order across `[0..horizonDays]` via undoable `manual-reschedule`
  events without touching Mercy counters or `recentPostponeCount`.
- **Bounded leech triage (`src/ir/leech.ts`):** Multi-criteria leech
  diagnostics flag items by lapse count (`<= maxLapseIntervalDays`),
  high-difficulty short-interval stagnation, chronic postpones, and post-reset
  `failRate`, with `Leeches only` Collection filtering and confirmation-guarded
  `Forget / Reset schedule` (`card-reset`) in Stats.
- **Reversible & visible:** Status bar (and mobile FAB badge) expose due,
  postponed, and 7-day inflow counts. Mercy batches and manual reschedules
  carry `batchId` / `previousDue` metadata for undo.

## Positioning

Not a SuperMemo clone. The honest pitch: the SuperMemo 20 incremental reading
workflow — length-based A-Factors, priority-aware queues, SM-20 SInc / FSRS-6
item scheduling, Mercy overload control, and spreading-activation neural
review — vault-native in plain Markdown and `.ir/` JSON, on desktop and mobile.
Obsidian Graph view is not.

## Neural review, Final Drill & Semantic Passes

`Learn : Go neural` (`Alt+N`) is a **second session builder**, not a
scheduler change. SM-20 / FSRS / A-factor run as in outstanding review; only
the sequence differs.

- **Seed & persistence (`src/ir/neural.ts`, `neural.json`):** Seeds from the
  current review card, else the active IR note, or a tree row action. The
  active neural frontier persists per-generation in `neural.json` (`Resume
  Neural Queue`), dynamically exciting neighbors on review/extract/cloze/edit
  actions with recency cooldown (`NEURAL_COOLDOWN_MS`), `NEURAL_EXPAND_THRESHOLD`
  (`< 50`) incremental expansion, and capacity eviction (`NEURAL_MAX_QUEUE = 200`).
- **Graph (`src/ir/neural-graph.ts`):** `parentId` tree (`child`/`parent`
  0.16, `sibling` 0.26–0.5, `rootParent` 0.40), vault wikilinks/backlinks
  (0.05, degree cap 12, single unmarked-note relay), shared tags (0.01,
  skipped above 40 IR members), and optional `titleMention` (0.20) / `lexical`
  (0.35) edges. Ledger-only extracts enter via the tree.
- **Walk & `Due today` filter:** Uses SuperMemo `CombinePriority(P, GroupP)`
  across up to 3 layers with `(1-P)` weighted shuffling. An inline `Due today`
  toggle (`neuralDueOnly`) filters candidate/popped slots to elements due
  today while keeping unvisited seeds and associative bridges intact.
- **Eligibility:** Not dismissed, reviewable body. **Due date is not a gate**
  unless `Due today` is enabled. Grading is a real repetition; no
  `reviewsPerReading` interleave. Closing or escaping ends neural and offers
  `Alt+R`.
- **Persisted Final Drill (`src/ir/drill.ts`, `drill.json`):** Recall items
  graded below Good (configurable: `again-and-hard`, `again`, or `off`)
  automatically enter a generation-scoped daily `drill.json` queue and re-test
  at the end of the session (or via `Start Final Drill`) until passed, without
  mutating long-term stability or appending duplicate ledger grades.
- **Semantic review passes:** `Review branch (due / all)`, Collection
  multi-select / `Review filtered`, and `Review Obsidian search results (due /
  all)` (`via branch`, `via subset`, `via search`) build scoped sessions over
  the same single review surface.

## Open design questions (decide before implementation)

These are expensive to reverse once the ledger exists and users have real
data. They must be answered before feature branch #1 (the storage substrate)
is written, not defaulted by the first implementation.

### Q1. Extract anchor strategy

STATUS: RESOLVED 2026-05-18. Full layered selector chain (option C), shipped
complete in v1, no deferral.

An extract anchors into its user-owned, externally-mutable source note via a
layered chain resolved cheapest-first:

1. Position hint (char offset) for the fast exact path.
2. Text-quote selector (exact extracted text plus prefix/suffix context) for
   relocation when the position drifts.
3. Automatic conservative position repair when the quote still matches but the
   position moved.
4. Optional, opt-in block id for users who want Obsidian-native cross-linking.
   Never the primary anchor.

Two principles are locked alongside it:

- **Never silently re-point.** A failed or ambiguous relocation degrades to a
  visible "needs re-anchor" state on the extract, never a confident wrong
  location. Wrong-but-confident is the only unrecoverable failure here.
- **Always keep the extracted text verbatim** in the ledger. It is the
  fingerprint, the offline review payload, and the safety net if the source is
  deleted. Not optional duplication.

Sub-decisions inside C:

- Normalization: normalize whitespace and strip Markdown syntax for the match
  key; keep the raw text verbatim for display.
- Duplicate-quote disambiguation: context window first, then
  nearest-to-last-known-position.
- Orphan UX: needs-re-anchor extracts stay visible in the queue, never
  silently dropped; user can re-anchor or detach into a standalone note.

Source deletion behavior:

- Never cascade-delete extracts when their source is deleted. Content is never
  lost: the verbatim text lives in the ledger, so the extract stays fully
  reviewable and its items keep scheduling.
- Reparent children to the grandparent where a tree exists (always).
- Detect deletion via Obsidian vault events (`vault.on("delete")`) **and**
  a load-time reconcile (`missingSourcePaths`) for deletes that happened
  while Obsidian was closed (Sync, git, file explorer). Both enqueue the
  same source-gone prompt. A path that already has a tombstone is skipped.
- Write a source tombstone (path, title, deletion timestamp), not a null.
  Preserves provenance and enables re-link.
- Comes-back case: if the same path reappears **and a tombstone exists**,
  offer conservative re-link. Never re-link silently. No tombstone means
  no prompt — typical when the note vanished while Obsidian was closed
  *and* the load-time reconcile has not run yet.
  **STATUS (2026-08-14): IMPLEMENTED for live vault deletes and load-time
  missing-file reconcile.** `vault.on("create")` / `rename` and a load
  scan look up `state.tombstones.get(path)`. On a hit, a modal lists the
  extracts still pointing at that path. Confirm emits `anchor-repaired` per
  extract (restoring `sourcePath`) plus `source-restored` to drop the
  tombstone. Decline emits `source-restored` only, so the offer is not
  repeated. An empty candidate list clears the tombstone with no prompt.
- Genuinely rootless detached extracts **become standalone notes by
  default**, with Settings → **When a source note is deleted** to switch
  the default to keep-without-notes. Each delete still prompts.
- Bulk UX: one source delete fires a single prompt (make them notes /
  keep without notes / undo). Undo on the prompt writes a tombstone only
  (tree unchanged). After make-notes or keep-without-notes, a Notice
  offers Undo that reverses detach/promote and trashes auto-created notes,
  keeping the tombstone so the next load does not prompt again.
  **STATUS (2026-08-14): IMPLEMENTED.**

### Q2. Ledger granularity and sync shape

STATUS: RESOLVED 2026-05-18. Hybrid (option D): per-element state files plus
per-device append-only log shards.

- Materialized current state lives in small per-element JSON files. Conflict
  surface is one element, not the collection. Git-diffable and inspectable,
  partially restoring the plaintext trust Option 1 traded away.
- The loss-sensitive path (review grades, scheduling events) goes into
  per-device append-only log shards. A device only ever appends to its own
  shard, so Obsidian Sync last-write-wins has nothing to destroy. Reviews are
  structurally impossible to lose under concurrent multi-device use.
- On sync, all shards fold into the shared per-element state. The fold is the
  Section 5 reconciliation pass, now with a defined job. It must be idempotent.

Sub-decisions:

1. Location: a dedicated vault dotfolder (`<vault>/.ir/`), never the plugin
   config dir (users often do not sync config, which would silently desync the
   ledger). Written through the data adapter, not as markdown notes, so the
   JSON is not indexed as a vault note.
2. Concurrent same-item conflict: both grade events are always retained in the
   logs. The live plugin folds them in **clock order** (the newest Lamport
   event wins), matching its synced-vault behavior. `conservative` remains a
   pure-ledger/testing option, not a user-facing scheduling setting.
3. Compaction defaults (all adjustable except the review-history guarantee):
   - Primary trigger: compact the local shard when it exceeds **250 events**
     (caps the active shard around 60 KB; cheap per-grade resync on mobile,
     since Obsidian Sync is whole-file not delta).
   - Safety net: also compact on load if the oldest uncompacted event is older
     than **7 days**.
   - Runs at plugin load and after a sync-fold, never mid-review, local shard
     only. A device never compacts another device's shard.
   - **Review-history guarantee:** compaction folds grade events into state and
     appends them to a per-device `review-history` file consumed only by the
     FSRS optimizer and export, never replayed for state. Only operational
     events (anchor repairs, priority tweaks) are dropped after folding.
     Default-on; the override warns loudly because disabling it kneecaps the
     multi-scheduler features.
   - Before a live shard is rewritten, compaction writes and verifies a
     complete transaction archive. During loading, that archive can recover
     only a validated prefix before an interrupted final JSONL line; it never
     permits malformed middle lines or schema-invalid events.
4. Element ids: stable and path-independent (already required by Q1's anchor
   model and the `queue.ts` id rework).
5. Fold checkpoint (2026-11-16): a per-device
   `<gen>/checkpoint/<device>-<seq>.json` stores the fold's **intermediate**
   state (raw priorities plus the priority-placement list, not the projected
   result), a lamport watermark and an `id → digest` coverage index. `load()`
   folds the checkpoint plus the events it does not cover and never re-reads
   compaction archives; the migration log is skipped once a checkpoint exists
   (it is written once per generation and the first checkpoint always folds
   it). Compaction is shard-only and therefore never sees a migrated
   collection's history, so the checkpoint is built independently on load when
   the total stream exceeds **250 events**. Any uncovered event at or below
   the watermark, an undo of a folded grade, or an unreadable newest slot
   forces a rebuild from the archives, which are retained as the rebuild
   source.

## Integration (storage substrate to live plugin — Shipped)

*(Historical integration plan — shipped in v0.6.x–v0.14.x: `ObsidianVaultFs`,
`migrateNotes`, and the guarded migration controller with `metadataCache`
readiness checks are all live.)*

The substrate (log, fold, compaction, reconcile, ledger) is complete and
pure. Bringing it into the running plugin splits into three parts on a
clean boundary so the gradable pieces can be delegated and only the
irreversible glue stays on the maintainer.

**Boundary contract.** The ledger reaches the vault through one port,
`VaultFs`. Nothing above the ledger imports Obsidian; nothing in the ledger
knows about Obsidian. Migration is a pure function from old frontmatter to
events. The controller is the only place that touches both worlds.

1. `ObsidianVaultFs` (delegated). Implements `VaultFs` over
   `app.vault.adapter` (the raw data adapter, not the indexed markdown file
   tree, so `.ir/` JSON is not treated as notes). Pure against a fake
   adapter: it creates missing parent folders before a write or append,
   maps the adapter's `{files, folders}` listing to the `VaultFs.list`
   path array, and tolerates a missing path on remove. New file
   `src/ir/obsidian-vault-fs.ts`. Single-file fence, deterministic oracle.

2. `migrateNotes` (delegated). Pure: `(FrontmatterNote[], now) ->
   IrEvent[]`. Each note with a valid `ir-type` becomes one
   `element-created` event whose element is decoded with the existing
   pure readers (`readCardFromFrontmatter`/`cardToStored`,
   `readTopicFromFrontmatter`), so migrated state is by construction
   equivalent to what the frontmatter readers saw. Element ids are
   deterministic from the note path, so a re-run is idempotent and an
   `ir-parent` path resolves to the parent's migrated id. Pre-ledger
   extracts and items are already standalone notes, so they migrate as
   promoted elements (`notePath` set, no anchor). New file
   `src/ir/migrate.ts`. Single-file fence, deterministic oracle.

3. Migration controller (maintainer-owned). Not delegated: it owns the
   one-way, data-at-risk decisions a mechanical oracle cannot gate. On
   load it constructs the ledger over `ObsidianVaultFs`, decides whether a
   migration is owed (no `.ir/meta.json`), enumerates IR notes via
   `metadataCache`, runs `migrateNotes`, appends, reconciles, and writes a
   migration marker. It is guarded (runs once), reversible (frontmatter is
   left intact as the fallback until the user confirms), and idempotent
   (re-run is a no-op via the marker plus deterministic ids). Wiring the
   live queue and review flow to read the ledger instead of frontmatter
   follows after the controller lands.

### Q3. Source-note pristine guarantee (decoration-only highlights)

STATUS: RESOLVED 2026-05-31. Decoration-only, persisted marks dropped on
new extracts. Legacy data left in place.

Pre-§Q3, extract creation wrapped the selected span in
`<mark class="ir-extract-source">…</mark>` HTML on disk and propagated that
wrap up the `ir-parent` chain. The source note the user authored was
mutated on every extract and every cloze. That violated the implicit
contract Obsidian users expect: the plugin should observe their notes,
not edit them.

The persisted marks were doing three jobs. Only the first is real:

1. **Visible feedback** in the source ("here's what I extracted").
2. **Disambiguation** when a sibling extract overlapped an earlier span:
   the anchor's `quote.exact` recorded the wrapped slice, which is
   structurally unique because of the surrounding mark.
3. **Survives outside the plugin** (mark renders on GitHub, mobile
   preview, etc.).

Job 1 is the only one that justifies mutating user content. Jobs 2 and 3
are recoverable without persisted marks: Q1's prefix/suffix scoring plus
nearest-to-last-known-position handles disambiguation, and the "survives
outside the plugin" property is not a load-bearing IR feature.

Resolution: source notes are never mutated by extract or cloze creation.
Visible feedback is painted in the editor as a CodeMirror 6 decoration
(`<mark class="ir-extract-source">` injected into the render tree only),
driven by `src/ir/extract-decorations.ts` reading resolved anchor ranges
from the ledger. Anchors carry the raw selected slice in `quote.exact` and
the byte-exact body offsets in `position`.

Sub-decisions locked alongside it:

- **Surfaces covered:** CM6 extension for Live Preview and Source view
  (0.4.0); review-pane side-panel splices marks for the focused card and
  every sibling extract (0.4.1); reading-view post-processor walks the
  rendered DOM and wraps text-quote matches (0.4.4). All three are
  decoration-only — the source bytes stay pristine. Legacy notes with
  persisted marks continue to render everywhere because the CSS class is
  unchanged.
- **Legacy data is not migrated.** Notes that already carry
  `<mark class="ir-extract-source">` chrome on disk keep it; their
  anchors keep wrapping in `quote.exact`. The anchor resolver is
  byte-exact, so both shapes work uniformly. A migration that strips
  marks from notes and rewrites anchors is its own data-at-risk commit.
- **Cloze parity.** Cloze creation also no longer wraps the source
  passage. The cloze item carries the `{{cN::…}}` syntax in its own
  note. Coverage highlights (`mark.ir-cloze-source`) reuse the extract
  decoration pipeline (CM6, reading-view post-processor, review splice)
  so already-clozed spans are visible on the topic like SuperMemo.
  New clozes also carry a text-quote `anchor` on the item. No second
  viewer. PDFs stay extract-only.
- **Bulk-extract idempotency** moves from "skip spans inside a body
  mark" to "skip spans that overlap any anchor already in the ledger
  for this source." See `main.ts existingExtractRangesForSource`.

Remaining follow-up:

- Optional one-shot legacy-data migration: strip persisted `<mark>` chrome
  from notes and rewrite the matching anchors' `quote.exact` to use the
  unwrapped slice. Cosmetic — both shapes already work via the byte-exact
  resolver, but the migration would tidy old notes that the user wants to
  keep in pure markdown.

Reading-view behavior and limitations:

- The initial text-quote search runs per-section. When a match crosses inline
  formatting such as `<strong>` or links, the formatting-tolerant fallback
  wraps every touched text node, so the extract still paints in reading view.
- Identical quotes at different positions each get a mark in reading view
  (Nth occurrence of that needle). Embedded blocks and other non-text content
  may still require the editor's precise CM6-offset surface.

## Open items

- **SM-20 Algorithm Arena, v4 `alg17` & full parity:** SHIPPED (`v0.14.0`–`v0.16.0` + `main`).
  SM-20 runs the 5-algorithm Algorithm Arena (`SM-2`, `SM-15`, `SM-19`, `SM-20`, `FSRS`),
  schema v4 `alg17` matrices (all 8 non-sleep `.dat` structures), SplitMix32-seeded `0x00cf2f30`
  dispersion with Undo re-roll, optional `0–5` 6-point grading, interactive quiz items
  (`Spell-Pad`, `ir-mcq`, `ir-order`, polygon occlusion), Concept Groups & propagating
  Reference metadata (`src/ir/concepts-references.ts`), Collection numeric range filters /
  Spread Priorities / Subset Search & Replace / Integrity Repair, and two-way SuperMemo `.xml`,
  Q&A `.txt`, and binary collection exchange (`docs/SCOPE-SM20-FULL-PARITY.md`).
- **Phase 1 & Phase 2 (`docs/FUTURE-PLANS.md`):** SHIPPED (`v0.14.0`–`v0.15.0`)
  — rich SM18/SM20 collection import (`src/ir/sm-collection-import.ts` with
  non-positive interval and grade/lapse history verification), EPUB/HTML import
  (`src/ir/epub-import.ts`), duplicate URL/content guards, non-modal
  placement-priority panels (`IrPlacementPriorityView`, `IrBulkMarkView`),
  3-layer progressive disclosure UX across Review/Stats/Settings/Mobile,
  persisted Final Drill (`drill.json`), dynamic Neural Queue (`neural.json`
  with Aho-Corasick title-mention matching), `Advance` / `JumpInterval`,
  bounded leech triage, and 4-tab Stats (`Overview | Triage | Simulator | Models & SM-20`).
- **Phase 3 (`docs/FUTURE-PLANS.md`):** Timestamp-anchored incremental video
  and audio (`{ resume, start, stop }` model in `src/ir/media.ts`, SHIPPED in
  `v0.16.0`); planned: companion browser capture extension and Obsidian
  Community Plugins directory release.
- **Deliberately not pursued:** Day-planner/tasklist, sleep/circadian,
  and streak/guilt mechanics.
