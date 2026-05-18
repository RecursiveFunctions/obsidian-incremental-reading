# Design Decisions

Architecture decisions for the incremental reading plugin, with rationale.
These are locked for v1 unless a decision explicitly says otherwise.

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

## Open items

- Confirm which exact SM18 mechanism the divergence picker is modeled on
  (treated as the algorithm chooser per section 5; revisit if it was something
  else).
- Image occlusion, incremental video and audio: out of scope for v1, revisit.
- Sleep/circadian and Plan/day-structure subsystems: deliberately not pursued.
