# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Extract highlighting in source column:** When reviewing an extract, the parent note body highlights the exact range the extract was pulled from. Uses the anchor layered selector chain (position hint, text-quote, normalized match) with a plain substring fallback for pre-store extracts. The highlight auto-scrolls into view.
- **Tree view: expand / collapse all:** Header buttons to expand or collapse every node at once.
- **Tree view: due-date badges:** Each tree row shows a relative due-date label (e.g. "due", "3d", "2mo", "1y"); overdue items get an accent color.
- **Tree view: dismissed element toggle and restore:** "Show dismissed" button reveals dismissed elements with reduced opacity. A **Restore** button on each dismissed row writes a `dismiss-set` event to the store and updates frontmatter, making dismissed elements recoverable directly from the tree.
- **Reading position bookmarks:** The review view saves and restores scroll position and cursor offset per element, persisted to `.ir/bookmarks.json`. Bookmarks survive session close and are restored when the same element reappears in a future review.
- **Bulk import (Alt+B):** Command "Import clipboard as IR topic" creates a new IR topic note from clipboard text with a generated title. Available from the command palette, hotkey, and mobile file menu.
- **Release automation:** Pushing a semver git tag runs `.github/workflows/release.yml`, which builds `main.js` and creates a **GitHub Release** with `manifest.json`, `main.js`, and `styles.css` so **BRAT >= 1.1.0** can install updates (tags alone are insufficient). Manual repair: `workflow_dispatch` on that workflow with the tag name, or see [`docs/RELEASE.md`](docs/RELEASE.md).

### Changed

- **`findExtractRange` extracted to pure module:** The extract-range resolution logic (anchor chain + substring fallback) is now in `src/ir/extract-range.ts`, directly unit-testable without Obsidian.
- **`formatDueLabel` extracted to pure module:** Due-date label formatting is now in `src/ir/due-label.ts` with year-scale support (365+ days shows "Ny").
- **Docs / agent rules:** `docs/RELEASE.md` is the canonical ship checklist; `.cursor/rules/brat-version-on-commit.mdc` now matches BRAT's GitHub Release requirement.

## [0.0.10] — 2026-05-21

### Added

- **Cloze hints (SuperMemo-style):** Optional hint using Anki-compatible `{{cN::answer::hint}}`. Creating a cloze from the note editor or IR review opens a short prompt (leave blank for none); in review, the hint appears in muted parentheses next to the hidden gap. You can also type the syntax by hand; answers may contain `::`, but hints cannot.

### Changed

- **IR review reading pane:** Topics and extracts open in **rendered** markdown (wikilinks, emphasis, like preview). **Click the card body** (outside links and embedded controls) to switch to the source editor; **Edit** / **Preview** still toggles explicitly. Use **Edit** when extract/cloze selection must map exactly to raw markdown.
- **IR review cloze cards:** Hidden and revealed cloze deletions use a SuperMemo-style highlight band (theme `text-highlight-bg`); hidden gaps use a dashed outline and `[ ... ]` inside the mark.

### Fixed

- **IR review:** Extract/Cloze clicks no longer move focus off the textarea before the handler runs (selection + "click into the editor first" bug). **Alt+X** / **Alt+Z** use `KeyboardEvent.code` so layouts where Alt changes `key` still work; while editing a reading body, **Ctrl+Enter** ( **Cmd+Enter** on macOS) runs **Next** and the Next button label reflects that.

## [0.0.9] — 2026-05-20

### Fixed

- **Mobile IR review:** Do not autofocus the reading textarea on phones; the soft keyboard no longer opens until you tap the note body, so controls and text stay visible when a topic or extract loads.

## [0.0.8] — 2026-05-20

### Added

- **`version-bump.mjs`:** `npm version patch` syncs `manifest.json` and `versions.json` with `package.json` for BRAT installs.
- **Cursor rule** `.cursor/rules/brat-version-on-commit.mdc`: agents bump the plugin version whenever they commit shipped plugin changes.

### Fixed

- **Mobile IR review dock:** Extra bottom padding on the review control bar so buttons sit above Obsidian's floating mobile navigation instead of underneath it.

### Changed

- **IR review reading pane:** Topics and extracts open in the body editor by default (no required **Edit** click). **Preview** switches to rendered markdown; **Edit** returns to the editor. Cloze review cards are unchanged (still start rendered until you choose **Edit**).
- **Docs:** README BRAT blurb points at `manifest.json` for the current version string; modal-removal doc references the version script again.

## [0.0.6] — 2026-05-20

### Fixed

- **Review "session not prepared":** `startReview` cleared the pending queue in a `finally` after `await setViewState`, but the workspace can construct the `ItemView` after that await settles, so the factory sometimes saw `null` and threw. Session payload now lives on the plugin instance and is consumed only inside the `registerView` factory; opening failures clear it in `catch`. If a review leaf is restored from an older workspace with no payload, the view opens with an empty queue and explains how to start again instead of throwing.

## [0.0.5] — 2026-05-20

### Added

- **In-tree priority edit (v0.3 / modal-removal phase B1):** In the IR element tree, click the `pNN` priority badge (or focus it and press Enter/Space) to edit inline. Commits append a `priority-set` store event and dual-write `ir-priority` on the note, same as the review pane. The status-bar *Set IR priority* path (Alt+P / file menu) now also updates the store so the queue cannot drift behind frontmatter-only edits.
- **Alt+P tree focus:** When the active markdown note is an IR element, **Set IR priority** reveals the element tree and opens the inline `pNN` field for that row; otherwise the status-bar prompt is used.
- **Review source column (UI commitment #2):** During review, when the current element has a parent, the parent's note body (or stored text) renders in a scrollable column beside the card in the same `ItemView` (no modal).
- **Mobile file menu (parity):** On Obsidian mobile, the note file menu (⋯) gains the same IR commands that desktop users reach via hotkeys or the ribbon: start review, open element tree, session log, stats, mercy postpone, and Anki TSV export (after *Mark as IR topic* or the IR priority/dismiss entries).
- **Mobile tree tap targets:** The element tree view uses larger rows, chevrons, and priority controls when `Platform.isMobile` so expand/collapse and inline priority editing are easier to hit with a thumb.

### Fixed

- **Priority hotkey vs queue:** Changing priority via the status-bar prompt previously wrote only frontmatter while the folded store kept the old value until some other review event ran; queue order now stays consistent.

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

[Unreleased]: https://github.com/RecursiveFunctions/obsidian-incremental-reading/compare/0.0.10...HEAD
[0.0.10]: https://github.com/RecursiveFunctions/obsidian-incremental-reading/compare/0.0.9...0.0.10
[0.0.9]: https://github.com/RecursiveFunctions/obsidian-incremental-reading/compare/0.0.8...0.0.9
[0.0.8]: https://github.com/RecursiveFunctions/obsidian-incremental-reading/compare/0.0.6...0.0.8
[0.0.6]: https://github.com/RecursiveFunctions/obsidian-incremental-reading/compare/0.0.5...0.0.6
[0.0.5]: https://github.com/RecursiveFunctions/obsidian-incremental-reading/compare/0.0.2...0.0.5
[0.0.2]: https://github.com/RecursiveFunctions/obsidian-incremental-reading/releases/tag/0.0.2
[0.0.1]: https://github.com/RecursiveFunctions/obsidian-incremental-reading/releases/tag/0.0.1
