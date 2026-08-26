# Design Decisions

Architecture decisions for the incremental reading plugin, with rationale.
These are locked for v1 unless a decision explicitly says otherwise.

**Decision 2026-05-18:** Full structured-store model chosen (Option 1) over
the hybrid. All element state, including extracts, leaves frontmatter for the
plugin store; extracts become block-anchored with promotion. Chosen because
extraction is aggressive (a session of highlights must not mint a file per
span), no real data is at risk yet, and the rearchitecture is cheapest now
while the code is unshipped. Two sub-questions it raises are still open, see
"Open design questions" below. Q1 (anchor strategy) and Q2 (store granularity
and sync shape) are both resolved. The storage substrate (feature branch #1)
is now unblocked.

**Decision 2026-08-14:** Obsidian's Graph view is not a product goal and not
a storage constraint. Incremental reading does not run on that picture.
See section 3.

## 1. Storage model

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

**Note (vault reality, 0.0.10):** IR *items* are still stored as normal
Markdown notes so they remain portable (plain files, Anki-style cloze markup,
other plugins can see them); FSRS state lives in frontmatter / the structured
store. Cloze *markup* in the note body uses Anki-style `{{cN::answer}}` with
optional `{{cN::answer::hint}}` for SuperMemo-style hints during review.

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
YAML, so the topic is **store-only** (`notePath` is the `.pdf` path). Alt+T
on an open PDF records that element (the core PDF viewer often leaves
`getActiveFile()` empty, so the command reads the file from the active
PDF leaf). Alt+X on a text selection creates an
anchored extract whose locator is Obsidian's public fragment
`#page=N&selection=beginIndex,beginOffset,endIndex,endOffset`, plus
`quote.exact` as the verbatim review payload. The PDF file is never
mutated (same §Q3 contract as markdown). Highlights are painted onto the
built-in pdf.js text layer from the store.

Cloze stays markdown-only: extract first, then cloze the extract. Scanned
PDFs with no text layer cannot be extracted. Cross-page selection, OCR,
area snapshots, and embedding a second pdf.js in the review leaf are out
of v1. PDF++ is not required; a promoted extract's note body includes the
wikilink fragment so PDF++ can see it if installed.

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
  (`src/ir/multi-select.ts`, dedupe by source + span) plus a DOM
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
- **Occlusion.** Follows the cloze precedent: one item note per card, body
  is a single `ir-occlusion` fenced JSON block (normalized rects, `active`
  = tested rect, `mode` hide-all / hide-one; `src/ir/occlusion.ts`). A
  code-block processor renders it everywhere; in the review pane the block
  reads `.ir-review-revealed` on the card body so reveal stays with the
  pane's Space/swipe/grade flow (`isClozeLike = hasCloze || hasOcclusion`).
  Items need a markdown parent, so a PDF crop is promoted to a note first
  (same "extract, then cloze the extract" rule). The editor is an
  `ItemView` leaf (UI commitment #6) and keyboard-complete (#1).

Known limits: paragraph breaks inside a PDF selection are not recoverable
from the text layer; Anki export writes the occlusion block verbatim.

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
  silent auto-follow of the primary scheduler (FSRS). Settings → **Show
  scheduler divergence picker** arms the inline FSRS vs SM-2 chooser when
  intervals diverge past the threshold. A prompt in the queue every few cards
  would destroy IR throughput, which is the entire point of IR.
  **Migration (2026-08-13):** new vaults get off. Existing installs that
  already had the always-on picker are grandfathered to on so their workflow
  does not silently change; they can turn it off in Settings.

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
files. The element tree, postpone-that-does-not-lie, and a phone that can
run a session are the differences. Obsidian Graph view is not.

## Neural review

`Learn : Go neural` (`Alt+N`) is a **second session builder**, not a
scheduler change. FSRS / A-factor run as in outstanding review; only the
sequence differs.

- Seed for `Alt+N`: current review card, else the active note if it is
  already in the collection. Go neural does not auto-mark a plain note.
  A tree row is a separate action (row context menu), not `Alt+N`.
- Graph: `parentId` tree (child 0.16, sibling 0.26–0.5, root parent 0.40)
  plus vault wikilinks/backlinks (0.05) and shared tags (0.01, skipped
  when a tag has more than 40 IR members). Unmarked notes may relay once
  so A → Bridge.md → B still connects. Store-only extracts have no note
  path, so they enter the walk only via the tree (not as wikilink targets).
- Walk: SuperMemo CombinePriority, a few layers, cap 200, wikilink degree
  12 at expansion time. Per-session RNG shuffles each layer by weight
  `(1-P)`.
- Eligibility: not dismissed, reviewable body. **Due date is not a gate.**
  Grading is a real repetition. No `reviewsPerReading` interleave.
- No concept registry and no new `IrType`. Closing the review tab ends
  neural; `Alt+R` is the outstanding queue.

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
   store). Written through the data adapter, not as markdown notes, so the
   JSON is not indexed as a vault note.
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
  note. Coverage highlights (`mark.ir-cloze-source`) reuse the extract
  decoration pipeline (CM6, reading-view post-processor, review splice)
  so already-clozed spans are visible on the topic like SuperMemo.
  New clozes also store a text-quote `anchor` on the item. No second
  viewer. PDFs stay extract-only.
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
- Identical quotes at different positions each get a mark in reading view
  (Nth occurrence of that needle). Spans that cross formatting boundaries
  still will not.

## Open items

- RESOLVED: the SuperMemo chooser is an accuracy-weighted parallel ensemble
  (SM-17 through SM-20 lineage; SM-20, 2026, runs ~5 algorithms in parallel,
  each weighted by how well it predicts that user's recall). Section 5
  deliberately ships a lighter divergence-*display* design instead of
  accuracy-weighted blending, for IR throughput. Weighted blending / auto-pick
  by per-scheduler hit rate is logged as a post-v1 option (the "always-armed"
  variant section 5 anticipates), not v1.
- Image occlusion: SHIPPED (see "Multi-selection, image regions, and
  occlusion"). Incremental video and audio: still out of scope.
- Sleep/circadian and Plan/day-structure subsystems: deliberately not pursued.
