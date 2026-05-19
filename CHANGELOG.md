# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.2] — 2026-05-19

### Added
- **Element tree view** (v0.2 roadmap): right-pane *IR element tree* view, ribbon action, and command *Open IR element tree*. Surfaces the parent/extract/cloze hierarchy from the v0.2 store via the existing `buildTree` pure core, with an icon and priority badge per node and click-to-open for elements that are backed by a vault note. Read-only in 0.0.2; future versions will add inline actions (priority, dismiss, postpone).

### Changed
- Manifest marks the plugin mobile-eligible (`isDesktopOnly: false`). The bundle has no Node-only imports, but iOS/Android Obsidian is not yet tested end-to-end.

## [0.0.1] — 2026-05-19

First BRAT-installable pre-release. Bundles the v0.1 MVP (topic mark, extract, cloze, review, interleaved queue, dismiss, priority slider) and the v0.2 storage substrate (per-element state files + per-device append-only log shards under `<vault>/.ir/`, migration from frontmatter on first load, dual-write fallback). Seven v0.2 pure cores (extract/promote, mercy, tree, deletion, SM-2+divergence, anki-export, stats) are landed but not yet wired to commands or UI; subsequent releases will surface them.

### Added
- **SuperMemo topic scheduling** (`src/topic.ts`): reading elements (topics and extracts) are no longer graded. The review modal shows **Next** / **Later today** / **Dismiss** instead of Again/Hard/Good/Easy. Next stretches the interval by a per-element A-Factor (first interval then `interval *= A-Factor`, capped at a max); Later today postpones without advancing. State is plain hand-editable frontmatter (`ir-interval`, `ir-a-factor`, shared `ir-due`). Items (cloze) still use FSRS unchanged. Settings gain First interval / Default A-Factor / Max interval.
- **Editable priority**: inline 0-100 priority control on every element in the review modal, plus a *"Set IR priority of current element"* command, since reordering the queue is a core part of the SuperMemo flow.
- Headless test suite (`npm test`, `node:test` + `tsx`), now 35 tests wired into CI, runs without Obsidian. Covers cloze offset math, FSRS frontmatter round-trip, queue interleave/ordering, the full extract/cloze/dismiss/topic-mark file flows via an in-memory fake App and Editor (`test/fake-obsidian.ts`), and the topic scheduler (first/grow/cap/override/migration).

### Changed
- Topics and extracts now seed a topic schedule instead of an FSRS card. Pre-existing topics with stale FSRS keys migrate cleanly: they read as interval 0, so the first Next seeds the interval; leftover keys are harmless and round-trip.
- Extracted the cloze offset math into `buildClozeBody` (`src/cloze.ts`) and the queue ordering into `interleavedQueue` (`src/queue.ts`), both free of the Obsidian API so they can be unit tested directly. Behavior unchanged.
- `src/ir-note.ts` no longer imports the Obsidian API at runtime: the imports are type-only and a local `normalizePath` replaces the one from `obsidian`. This is what lets the in-memory fake exercise it. Behavior unchanged.

### Added (MVP)
- **Interleaved queue** (MVP item 6): the review session now folds reading elements (topics, extracts) in among due review items by a configurable "reviews per reading" ratio (default 3, 0 disables). Completes the v0.1 MVP.
- **Dismiss action** (MVP item 7): command *"Dismiss / restore current IR element"* sets a reversible `ir-dismissed` flag. Dismissed elements are skipped by the queue; FSRS state is left untouched so restoring is lossless.
- **Review UI** (MVP item 5): command and ribbon *"Start IR review"* open a modal that walks every due IR note, ordered by priority then due date. Cloze answers stay hidden until `Space`; `1`/`2`/`3`/`4` grade Again/Hard/Good/Easy. Each grade runs the card through FSRS and writes the rescheduled state back to frontmatter. Adds `schedule()` to the FSRS layer and `src/review.ts`.
- **Cloze from selection** (MVP item 4): command *"Cloze selection into an IR item"* and an editor context-menu action. The selected span becomes the hidden answer in a `{{c1::...}}` cloze; the full lines it spans are kept as context. Creates a child `ir-type: item` note linked to its source.
- SuperMemo-style default hotkeys: `Alt+X` extract, `Alt+Z` cloze. Rebindable in Settings, Hotkeys.
- **Extract from selection** (MVP item 3): command *"Extract selection to IR child note"* and an editor context-menu action. Creates a child note holding the selected text, sets `ir-type: extract` and `ir-parent`, inherits the source priority, seeds a fresh FSRS card, then opens the new note. Refuses if the source is not an IR topic or extract.
- **Topic mark** (MVP item 1): command *"Mark current note as IR topic"* and a ribbon action that set `ir-type: topic` plus `ir-priority` and seed a fresh FSRS card in note frontmatter. Re-marking an existing topic is a no-op.
- Settings tab with a configurable default topic priority (0 to 100 slider) and an optional extract folder.
- Frontmatter/FSRS serialization layer (`src/fsrs.ts`, `src/ir-note.ts`, `src/types.ts`), the shared foundation later IR features build on.
- Initial repository scaffold: Obsidian plugin skeleton, TypeScript + esbuild build pipeline, `ts-fsrs` dependency for scheduling, MIT license, CI build workflow, issue templates.

[Unreleased]: https://github.com/RecursiveFunctions/obsidian-incremental-reading/compare/0.0.2...HEAD
[0.0.2]: https://github.com/RecursiveFunctions/obsidian-incremental-reading/releases/tag/0.0.2
[0.0.1]: https://github.com/RecursiveFunctions/obsidian-incremental-reading/releases/tag/0.0.1
