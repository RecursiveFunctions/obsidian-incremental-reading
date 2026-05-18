# Design Decisions

Architecture decisions for the incremental reading plugin, with rationale.
These are locked for v1 unless a decision explicitly says otherwise.

**Decision 2026-05-18:** Full structured-store model chosen (Option 1) over
the hybrid. All element state, including extracts, leaves frontmatter for the
plugin store; extracts become block-anchored with promotion. Chosen because
extraction is aggressive (the clean-by-construction graph earns its cost), no
real data is at risk yet, and the rearchitecture is cheapest now while the
code is unshipped. Two sub-questions it raises are still open, see "Open
design questions" below. Q1 (anchor strategy) is now resolved; Q2 (store
granularity and sync shape) must still be settled before the store is written.

## 1. Storage model

Items and cloze state live as **structured plugin data**, never as markdown
files, and never as inline HTML comments.

Three independent features each force this conclusion on their own:

- Graph hygiene: anything that is a markdown file is a graph node. Items and
  raw extracts must not be nodes.
- FSRS: the scheduler persists a per-card DSR state plus a review log. That is
  structured data, not something inline comments can carry.
- Multi-scheduler override (section 5): a card must record which scheduler owns
  it and carry enough state to run any ensemble member.

This is no longer a debatable default. It is a requirement.

## 2. Extracts

Extracts are **block-anchored inside their source note by default**. An
extract becomes a standalone markdown note only on explicit user promotion.

Promotion is the single moment an extract earns a place in the global graph.
This mirrors the literature-note to permanent-note pipeline that serious
Obsidian users already run, so it reads as faithful, not as a workaround.

## 3. Graph

The global Obsidian graph shows **sources and promoted concepts only**.

The SuperMemo knowledge tree (source to extract to item) is strictly
hierarchical and gets its **own dedicated hierarchy view**, not the
force-directed graph. SuperMemo conflates these two structures and it is the
source of the clutter. Keeping them separate is more faithful to SM, not less.

## 4. Scheduler

FSRS via `ts-fsrs` as the primary scheduler. The plugin **owns the IR queue**
(priority, topics, items, postpone, interleaving), because nothing in the
Obsidian ecosystem provides an IR queue and the queue is the core of the
product.

Rationale: FSRS descends from SuperMemo's own DSR model (SM-17 lineage). It is
the closest open analog that exists, not a rough substitute. The scheduler is
the highest-parity part of the build, not the lowest.

- Review log persisted **from day one**. Required for personal optimization and
  for the ensemble in section 5 to be meaningful.
- Interop: **Anki export** for the item layer as an optional, one-directional
  escape hatch. No runtime coupling to the obsidian-spaced-repetition plugin
  (it still runs SM-2, not FSRS, and has no IR queue).

## 5. Multi-scheduler picker

Replicates SuperMemo's divergence-triggered algorithm chooser as an ensemble
plus manual override.

- Ensemble members: default-FSRS, user-optimized-FSRS, classic SM-2. The
  informative pair is default-FSRS vs user-optimized-FSRS: large divergence
  signals model uncertainty or thin review history, and FSRS can expose the
  confidence behind it. SM showed two numbers; we can show why they differ.
- Architecture: a `Scheduler` interface
  (`predict(cardState, grade) -> {interval, due, nextState, confidence?}`).
  One **primary** scheduler is authoritative and owns card state. Others run as
  **shadows**: computed in parallel, never mutate state unless chosen.
- Divergence metric: interval **ratio**, not day count.
  `max(intervals) / min(intervals) > k`, k configurable, ~1.5 to start.
  Optionally gated by an absolute interval floor so short intervals never nag.
- UX: the picker is **opt-in expert mode, off by default**. Default behavior is
  silent auto-follow of the primary scheduler. A modal in the queue every few
  cards would destroy IR throughput, which is the entire point of IR. The
  always-armed-on-extreme-divergence variant is a possible later setting, not
  v1.

## 6. Mercy / Postpone

Overload handling via **queue redistribution only**.

The critical rule: postpone moves a card's position in the queue. It never
tells the scheduler the card was reviewed. The scheduler state stays pristine.

- Trigger: outstanding load (due topics plus items) exceeds a configurable
  daily ceiling.
- Mechanic: push lowest-priority overflow forward, preserve relative order,
  apply slight decay so it cannot snowball, never postpone above a priority
  cutoff.
- Reversible and visible (a "postponed: N" indicator). Silent queue mutation is
  how users lose trust in a scheduler.

## Positioning

Not a SuperMemo clone. The honest pitch: the SuperMemo incremental reading
workflow, on the open descendant of SM-17's algorithm, with data in plain
files and a better concept graph than SuperMemo itself.

## Open design questions (decide before implementation)

These are expensive to reverse once the store exists and users have real
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
- **Always store the extracted text verbatim** in the store. It is the
  fingerprint, the offline review payload, and the safety net if the source is
  deleted. Not optional duplication.

Sub-decisions inside C:

- Normalization: normalize whitespace and strip Markdown syntax for the match
  key; store the raw text verbatim for display.
- Duplicate-quote disambiguation: context window first, then
  nearest-to-last-known-position.
- Orphan UX: needs-re-anchor extracts stay visible in the queue, never
  silently dropped; user can re-anchor or detach into a standalone note.

Source deletion behavior:

- Never cascade-delete extracts when their source is deleted. Content is never
  lost: the verbatim text lives in the store, so the extract stays fully
  reviewable and its items keep scheduling.
- Reparent children to the grandparent where a tree exists (always).
- Genuinely rootless detached extracts **auto-promote to standalone notes by
  default**, with a setting to switch to store-only-detached instead.
- Detect deletion two ways: Obsidian vault events and a lazy/reconciliation
  pass (catches deletes done outside Obsidian via Sync, git, file explorer).
- Write a source tombstone (path, title, deletion timestamp), not a null.
  Preserves provenance and enables re-link.
- Comes-back case (Sync/git/trash restore): offer conservative re-link when a
  matching note reappears. Never re-link silently.
- Bulk UX: one source delete fires a single batched notification
  (promote-all / leave-detached / undo). Undo must also reverse the
  auto-created notes, not just the detach.

### Q2. Store granularity and sync shape

Whether the store is one monolithic JSON object, many small per-element files
in a plugin-owned folder, or an append-only log. Governs multi-device Obsidian
Sync conflict behavior and data-loss risk. STATUS: not yet started.

## Open items

- Confirm which exact SM18 mechanism the divergence picker is modeled on
  (treated as the algorithm chooser per section 5; revisit if it was something
  else).
- Image occlusion, incremental video and audio: out of scope for v1, revisit.
- Sleep/circadian and Plan/day-structure subsystems: deliberately not pursued.
