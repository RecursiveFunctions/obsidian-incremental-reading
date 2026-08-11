# Design Decisions

Architecture decisions for the incremental reading plugin, with rationale.
These are locked for v1 unless a decision explicitly says otherwise.

**Decision 2026-05-18:** Full structured-store model chosen (Option 1) over
the hybrid. All element state, including extracts, leaves frontmatter for the
plugin store; extracts become block-anchored with promotion. Chosen because
extraction is aggressive (the clean-by-construction graph earns its cost), no
real data is at risk yet, and the rearchitecture is cheapest now while the
code is unshipped. Two sub-questions it raises are still open, see "Open
design questions" below. Q1 (anchor strategy) and Q2 (store granularity and
sync shape) are both resolved. The storage substrate (feature branch #1) is
now unblocked.

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

**Note (vault reality, 0.0.10):** IR *items* are still stored as normal
Markdown notes so they remain portable in the vault graph; FSRS state lives
in frontmatter / the structured store. Cloze *markup* in the note body uses
Anki-style `{{cN::answer}}` with optional `{{cN::answer::hint}}` for
SuperMemo-style hints during review.

## 2. Extracts

Extracts are **block-anchored inside their source note by default**. An
extract becomes a standalone markdown note only on explicit user promotion.

Promotion is the single moment an extract earns a place in the global graph.
This mirrors the literature-note to permanent-note pipeline that serious
Obsidian users already run, so it reads as faithful, not as a workaround.

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
  **STATUS (2026-05-31): NOT IMPLEMENTED.** The delete side writes the
  tombstone with `path` + `title` + `deletedAt`, but nothing reads it on
  create/rename. A recreated note at the same path leaves the tombstone
  unread and the promoted extracts stay as their own standalone notes. The
  load-bearing guarantee (no content lost on delete) holds; the recovery
  convenience does not exist yet. Spec for the missing piece: a
  `vault.on("create")` and `vault.on("rename")` handler that looks up
  `state.tombstones.get(newPath)` and, on hit, prompts the user with the
  tombstone's title and the list of extracts/promoted-notes that came
  from it. Re-link emits `anchor-repaired` for each extract (restoring
  `sourcePath`) and removes the tombstone via a `source-restored` event
  kind that needs to be added to the model.
- Bulk UX: one source delete fires a single batched notification
  (promote-all / leave-detached / undo). Undo must also reverse the
  auto-created notes, not just the detach.

### Q2. Store granularity and sync shape

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
   store). Excluded from graph and search via the Option 1 hygiene mechanism.
2. Concurrent same-item conflict: both grade events are always retained in the
   logs. Materialized scheduler state defaults to the **conservative schedule**
   (earlier next-due wins, so a review is never accidentally skipped), with a
   setting to switch to clock-order (last grade wins).
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
4. Element ids: stable and path-independent (already required by Q1's anchor
   model and the `queue.ts` id rework).

## Integration (storage substrate to live plugin)

The substrate (log, fold, compaction, reconcile, store) is complete and
pure. Bringing it into the running plugin splits into three parts on a
clean boundary so the gradable pieces can be delegated and only the
irreversible glue stays on the maintainer.

**Boundary contract.** The store reaches the vault through one port,
`VaultFs`. Nothing above the store imports Obsidian; nothing in the store
knows about Obsidian. Migration is a pure function from old frontmatter to
events. The controller is the only place that touches both worlds.

1. `ObsidianVaultFs` (delegated). Implements `VaultFs` over
   `app.vault.adapter` (the raw data adapter, not the indexed file tree, so
   the `.ir/` dotfolder stays out of the graph). Pure against a fake
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
   `ir-parent` path resolves to the parent's migrated id. Pre-store
   extracts and items are already standalone notes, so they migrate as
   promoted elements (`notePath` set, no anchor). New file
   `src/ir/migrate.ts`. Single-file fence, deterministic oracle.

3. Migration controller (maintainer-owned). Not delegated: it owns the
   one-way, data-at-risk decisions a mechanical oracle cannot gate. On
   load it constructs the store over `ObsidianVaultFs`, decides whether a
   migration is owed (no `.ir/meta.json`), enumerates IR notes via
   `metadataCache`, runs `migrateNotes`, appends, reconciles, and writes a
   migration marker. It is guarded (runs once), reversible (frontmatter is
   left intact as the fallback until the user confirms), and idempotent
   (re-run is a no-op via the marker plus deterministic ids). Wiring the
   live queue and review flow to read the store instead of frontmatter
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
from the store. Anchors store the raw selected slice in `quote.exact` and
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
  note, so the source has no further obligation.
- **Bulk-extract idempotency** moves from "skip spans inside a body
  mark" to "skip spans that overlap any anchor already in the store
  for this source." See `main.ts existingExtractRangesForSource`.

Remaining follow-up:

- Optional one-shot legacy-data migration: strip persisted `<mark>` chrome
  from notes and rewrite the matching anchors' `quote.exact` to use the
  unwrapped slice. Cosmetic — both shapes already work via the byte-exact
  resolver, but the migration would tidy old notes that the user wants to
  keep in pure markdown.

Reading-view limitations (worth knowing about, not bugs):

- Text-quote search runs per-section and finds matches only within a
  single text node. Extracts spanning inline formatting boundaries
  (`<strong>`, links, embedded blocks) won't be marked in reading view.
  The editor surface marks them precisely via CM6 offsets.
- Two extracts with identical text get deduped to one rendered mark in
  reading view. The editor marks each occurrence.

## Open items

- RESOLVED: the SuperMemo chooser is an accuracy-weighted parallel ensemble
  (SM-17 through SM-20 lineage; SM-20, 2026, runs ~5 algorithms in parallel,
  each weighted by how well it predicts that user's recall). Section 5
  deliberately ships a lighter divergence-*display* design instead of
  accuracy-weighted blending, for IR throughput. Weighted blending / auto-pick
  by per-scheduler hit rate is logged as a post-v1 option (the "always-armed"
  variant section 5 anticipates), not v1.
- Image occlusion, incremental video and audio: out of scope for v1, revisit.
- Sleep/circadian and Plan/day-structure subsystems: deliberately not pursued.
