# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **Visible drag-select in reading mode.** Obsidian disables text
  selection app-wide (`user-select: none`); the review card now opts
  back in and paints an accent-colored `::selection` so highlight →
  extract is visible before Alt+X.

## [0.6.23] — 2026-08-21

### Fixed

- **Escape while editing returns to reading mode.** In Live Preview /
  Source edit, Escape was closing the IR review tab. It now exits edit
  first; a second Escape (or Escape in reading mode) leaves IR.

## [0.6.22] — 2026-08-21

### Fixed

- **Reading mode: highlight and extract without entering edit.** Plain
  single-click no longer opens the in-card editor (that stole the
  selection before Alt+X). Drag-to-select stays in preview; double-click
  enters edit only when it did not create a selection (word-select stays
  extractable). Ctrl/Cmd-click still jumps to Live Preview at the caret.
  The Edit button is unchanged.

## [0.6.21] — 2026-08-20

### Fixed

- **IR-marked notes missing from the store after a folder move.** A
  folder rename used to delete those elements from `.ir/` while leaving
  `ir-type` on the files. Load now puts them back under their original
  ids (so parent links survive) instead of ignoring them.

## [0.6.20] — 2026-08-20

### Fixed

- **Folder rename/move no longer looks like a mass delete.** Stored
  `notePath` / anchors follow the folder (and delete+create moves), so
  IR does not prompt once per note.

### Changed

- **Source-gone prompt: do this for all.** When several sources are
  missing at once, a checkbox applies the same choice to the rest.

## [0.6.19] — 2026-08-20

### Fixed

- **Reading position is shared across reader and editor.** Scroll, %
  read, and resume use the same 0–1 progress in Live Preview and in
  the rendered card, so Escape and Edit land where you were.

## [0.6.18] — 2026-08-20

### Fixed

- **Preview after Escape keeps your place.** Leaving Live Preview no
  longer jumps the reader back to the top of the note.

## [0.6.17] — 2026-08-20

### Fixed

- **Review click-to-edit keeps your place.** The caret and viewport land
  on the text you clicked, instead of jumping to the start of the note.

## [0.6.16] — 2026-08-20

### Fixed

- **Review click-to-edit went blank.** The in-card Live Preview opened
  without the note in view state, and the nested editor had no height.
  Edit keeps the file and fills the card.

## [0.6.15] — 2026-08-20

### Changed

- **Review edit stays in Live Preview.** Clicking the card (or Edit) no
  longer swaps the note into a raw source textarea. Vault notes open in
  Obsidian's editing view in the card. **Source** still opens raw
  markdown. Phone and store-only extracts still use the textarea.

## [0.6.14] — 2026-08-20

### Added

- **Folder → Mark folder notes as IR topics:** right-click a folder in
  the file explorer (or the command palette while a note in that folder
  is open). Nested markdown and PDFs are included; notes already in IR
  are skipped. Confirms above 10 files, or for the vault root.

### Fixed

- **Focus PDF** no longer re-opens the file. Reloading remounted pdf.js
  and dropped extract highlights. If the viewer is already open, the
  button reveals it and turns the page in place.

## [0.6.13] — 2026-08-19

### Fixed

- **PDF review focus:** a PDF card splits the built-in viewer beside
  review and focuses it so you can select text immediately. Extract
  (Alt+X) still records the highlight if the click onto review cleared
  the selection. Yellow marks paint on the text layer after extract.

## [0.6.12] — 2026-08-19

### Added

- **PDF topics and extracts:** Alt+T on an open PDF queues it as a
  store-only topic (PDFs have no YAML). Alt+X on a text selection in the
  built-in viewer creates an anchored extract (page + selection fragment).
  Highlights paint in the viewer from the store; the PDF file is never
  written. Review opens the PDF at that page. Cloze stays markdown-only
  (extract first). Scanned pages with no text layer cannot be extracted.

- **Space after cloze reveal:** in review, the first Space still shows the
  answer; the next Space grades Good by default. Settings → Review can
  point it at Again / Hard / Easy, or turn it off (reveal only). Reading
  cards keep Space as Next.

- **Already-clozed spans** on a topic paint as a green underline
  (`ir-cloze-source`) beside extract highlights, using the existing editor /
  reading-view / review decoration pipeline — not a second viewer.

### Fixed

- **Alt+T on a PDF:** the core PDF viewer often has no `getActiveFile()`,
  so the command now reads the file from the active PDF leaf.

## [0.6.11] — 2026-08-14

### Added

- **Source gone prompt:** deleting a source note (or finding it missing on
  launch) asks once: make orphan highlights into notes, keep them as
  review cards only, or undo (tree unchanged). A Notice Undo reverses
  make-notes / keep-without-notes and trashes notes the plugin created.
- **Settings → When a source note is deleted** picks the default if you
  close that prompt. On (default) makes them notes.

### Changed

- **FAB during review:** the radial wheel keeps **Start IR review** on the
  ring (with the tree and Go neural), so the phone entry still starts
  today's due queue mid-session.
- Docs no longer sell Obsidian Graph view as a product goal. Anchored
  extracts stay the default so a session of highlights does not mint a
  file per span.

## [0.6.10] — 2026-08-14

### Added

- **Restore defaults** at the top of Settings puts every slider, toggle,
  and text field back to a new vault's values. Notes and review history
  are untouched.

## [0.6.9] — 2026-08-14

### Changed

- **Settings** are grouped the way people think: Review, Extracts, Topics,
  Overload, Anki export, Danger zone. Mercy ceiling sits under Overload,
  not next to the Anki deck name.
- **Empty vault:** Start review opens a one-leaf pane
  (“Mark a note as a topic (Alt+T), then start review (Alt+R)”) instead of
  a Notice.
- **Deleted source comes back** (trash/Sync/git restore): a prompt lists
  extracts from that source. Re-link restores provenance; leave detached
  forgets the offer. Never re-links silently.
- **Frontmatter dual-write** failures after a successful store write are
  logged once. No “see the developer console” toast — the store still has
  the change.

## [0.6.8] — 2026-08-14

### Changed

- **Neural is a mode.** Session bar chip is Neural vs Due (no `Neuro=`
  prefix). Escape when not editing ends the neural pass and offers
  **Start outstanding (Alt+R)** instead of closing the tab.
- **Why this card:** a muted line on neural cards —
  `via wikilink ← Foo`, `via child of Bar`, or `via tag #dogs`.
- **Empty neural** tells you what to do: add wikilinks, extract children,
  or mark linked notes. A seed with nothing related no longer opens a
  one-card session.

## [0.6.7] — 2026-08-14

### Changed

- **Editor cloze hint is the same inline bar as review**, not a modal.
  Enter confirms (empty = no hint), Esc cancels.
- **Preview extract/cloze that cannot map onto markdown** switches to
  Edit and keeps the selection when it can: “Switch to Edit to extract
  the exact markdown.”
- **Reading view** marks each occurrence of a duplicate quote instead of
  collapsing them to one highlight. Spans that cross formatting
  boundaries are still a known gap.
- **Glossary:** anchored extract vs standalone note. Menus and Settings
  no longer say “child note.”

## [0.6.6] — 2026-08-14

### Changed

- **Status bar** shows `due · postponed · +inflow/7d`. Postponed means the
  last due-changing event is mercy and the due is still in the future.
  Later-today stays in the tooltip, split by topic / extract / item.
- **Stats leaf** drops Refresh and redraws with the status bar. Empty
  vault: “Mark a note as a topic (Alt+T) to start.” A 14-day grade spark
  sits under the five numbers.
- **Session log is this review**, stamped when Alt+R / Alt+N actually
  opens a queue, not at plugin load. Click a row to jump that card in the
  open review, or open the note.

## [0.6.5] — 2026-08-13

### Changed

- **Tree is a keyboard home.** `j`/`k` or arrows move; Enter opens (or
  jumps) review; `o` opens the note; `p` edits priority; `d` dismisses;
  `m` postpones; Space toggles collapse. Click a row to reveal it in an
  open review session, or open the note if none is running. Double-click
  always opens the note. Expand/collapse survives filter and Refresh; the
  current review card keeps a **reviewing** chip.
- **Needs-reanchor banner on the review card** with Re-anchor / Detach /
  Open source, instead of only a tree context-menu item.

## [0.6.4] — 2026-08-13

### Fixed

- **Mobile: Open IR element tree is on the FAB hub** (and the editor ⋯
  menu), not only behind the file-menu swipe. During review the same petal
  is there so you can jump from a card to the tree.
- **Go neural is only offered on something already in IR.** A plain note
  no longer auto-marks and opens a one-card neural session. Mark it as a
  topic first; the command, hub petal, and status-bar item stay hidden
  until then.

## [0.6.3] — 2026-08-13

### Fixed

- **Mobile: Incremental Reading actually shows up.** 0.6.1 left the phone
  with no status bar, one ribbon icon behind a swipe, a FAB that hid on the
  file explorer, and a hub that listed no Start-review action on a plain
  note. The purple FAB is now always on (brain icon), and the hub always
  includes **Start IR review** / **Go neural** (and **Mark as IR topic** on
  a plain note). Plugin load no longer waits on `.ir/` IO, so a hung hidden
  folder on iOS cannot register zero commands.

## [0.6.2] — 2026-08-13

### Changed

- **Live review session.** Extract, cloze, promote, fork, and hub bulk
  extract append the new card immediately after the current one instead of
  waiting for the next Alt+R. The session bar shows `Due · N left` or
  `Neural · Neuro=N · seed`. Finishing the pass leaves a **Session complete**
  pane (Alt+R / Escape / Close) rather than closing the tab.
- **Source chip on mobile** lives on the session bar so it is not scrolled
  off the card. Cloze items prefer the nearest extract ancestor in the
  source column.
- **Resume chrome.** Reading cards with a saved position show **Resumed from
  last time** and **From the top**.

## [0.6.1] — 2026-08-13

### Changed

- **Scheduler divergence picker is now a setting** (DESIGN §5). New vaults
  default to off: grades follow FSRS with no prompt. Existing installs are
  grandfathered on (same as 0.6.0's always-on picker) until the user turns
  **Settings → Show scheduler divergence picker** off.
- **One ribbon icon.** Only **Start IR review** remains on the left ribbon.
  Tree, quick actions, and mark-as-topic stay in the command palette; right-
  click (or long-press) the status bar for the same menu.
- **Review success feedback is in-dock.** Extract, cloze, dismiss, and undo
  flash a one-line status in the review dock instead of a Notice. Failures
  and "nothing due" still toast. Starting review no longer announces the
  queue composition (the progress line already shows it).

### Fixed

- **Empty review tab after workspace restore.** A leftover IR review leaf
  with no session now rebuilds today's due queue, or detaches if nothing is
  due, instead of showing a dead "Close this tab then Alt+R" pane.

## [0.6.0] — 2026-08-13

### Added

- **Go neural (`Alt+N`).** SuperMemo-style subset review from the current
  note, review card, or tree row. Spreading activation walks the element
  tree, wikilinks/backlinks, and shared tags (CombinePriority weights).
  Associated not-due material is included; grading is a real repetition.
  Progress shows `Neural · Neuro=N`. `Alt+R` is unchanged.
- **Settings → Extract to standalone note** (off by default). Off keeps
  today's anchored extracts (DESIGN §2). On is GitHub #1: each extract
  becomes a child markdown note and inherits the parent's tags, aliases,
  and source/url.
- **One-shot promote** when the setting is off: `Alt+Shift+X` extracts to
  a note once; `Alt+Shift+P` promotes the current anchored extract
  (review card or tree selection). The tree context-menu action was
  already there.
- **Parent metadata on new IR notes:** promoted extracts and cloze item
  notes copy `tags` / `aliases` / `cssclasses` and `source` / `url` from
  the parent, and promoted extracts now set `ir-parent`.

## [0.3.9] — 2026-05-24

### Fixed

- **Landscape edit mode: textarea content invisible when the keyboard
  opens.** The Preview pill was `position: absolute` over the textarea,
  with a 3rem padding-top on the textarea to compensate. In landscape
  with the keyboard up, the visible viewport above the keyboard is
  ~140px, so the 3rem padding plus the cursor at position 0 pushed
  content below the visible area and the user saw a black void. Moved
  the topbar into normal flex flow (`order: -1` puts it visually first
  in the already-column host) so it consumes layout space and the
  textarea starts naturally below it. Removed the padding-top hack.

### Changed

- **Edit topbar pill nudged in from the right edge** (0.85rem of inset
  instead of 0.5rem) so it no longer crowds Obsidian's three-dot view
  menu.
- **Compact edit topbar in landscape:** pill height 38→32px and smaller
  vertical padding, since every line of textarea visibility counts when
  the keyboard is open in landscape.
- **Dock buttons nudged clear of Android's nav area:** portrait dock
  bottom padding 4rem → 5rem, landscape 3.5rem → 4rem. Added a 0.25rem
  margin-bottom on the buttons grid for a visible floor.

## [0.3.8] — 2026-05-24

### Changed

- **Doc progress bar now actually scales with the percentage.** The fill
  element had `flex: 1 1 auto` inside a flex container, so flex-grow
  overrode the inline `width: N%` and the bar always rendered full-width
  regardless of how far the user had scrolled. Wrapped the fill in a
  track element so the track does the flex-grow and the fill inside
  takes the real width. The fill is also dimmed (accent at 50% opacity,
  3px tall) so it reads as a secondary scroll indicator versus the
  solid 4px accent session bar at the top of the pane.
- **Preview button in mobile edit mode moved to a floating top-right
  pill.** The bottom-anchored dock toggle sat in the device gesture zone
  and behind Obsidian's floating nav pill. Native edit-confirm controls
  (iOS Done, Android checkmark) live in the top app bar, so the pill
  now floats over the top-right of the textarea. The textarea gets
  3rem of top padding so the first line clears the pill.
- **Workspace FAB suppressed inside the IR review pane.** The dock
  already has a "Quick actions" button, so the FAB in the corner was
  redundant and competed with the grade/edit buttons for the bottom-
  right of the pane. Also added a `document.activeElement` check
  (input/textarea/contenteditable) so the FAB hides while typing on
  devices where the WebView does not shrink `visualViewport.height`
  on IME open.

## [0.3.7] — 2026-05-24

### Fixed

- **Mobile review, edit-mode Preview button overlaps Obsidian's nav pill
  and sits in the gesture zone.** The edit-mode dock had only ~8px of
  bottom padding, so when the keyboard was closed the Preview button
  ended up under Obsidian's floating nav strip and right where the
  device's back/home gestures originate. Added 4rem of clearance when
  the card host is not pinned (keyboard closed) and kept the minimal
  padding only while the card host is pinned to the visible viewport
  (keyboard open), so the textarea still gets max space while typing.

## [0.3.6] — 2026-05-24

### Fixed

- **Mobile portrait: card body invisible behind a tall dock.** In reading
  mode the dock was ~460px tall (Quick actions + Priority + "0 = most
  important" hint + A-Factor + "interval multiplier" hint + 4 rows of
  buttons + 5.25rem of bottom-nav padding), which on a 750px portrait
  viewport left no room for the card body once the source column took its
  40vh. Three coordinated changes:
  - Inline the hub button, priority editor, and A-Factor editor on a
    single row above the buttons grid.
  - Hide the priority/A-Factor hint copy on mobile in both orientations.
  - Trim portrait bottom-nav padding from 5.25rem to 4rem (still clears
    Obsidian's nav strip; saves ~20px of card height).
- **Mobile review, source column starves the card body.** The portrait
  context column had `flex: 0 0 40vh`, meaning it could not shrink to
  make room for the main column. Switched to `flex: 0 1 30vh` (basis
  30vh, can shrink) and dropped the expanded basis from 75vh to 55vh.
  Added `min-height: 18vh` to the main column so the card body always
  shows at least a few lines regardless of dock or source size.

## [0.3.5] — 2026-05-24

### Fixed

- **Mobile review, portrait source column collapsed to header height:**
  The context column had `flex: 0 0 auto`, but its scroll child has
  `flex: 1 1 0` + `overflow: auto` so the column basis collapsed to just
  the header. Switched to an explicit `flex: 0 0 40vh` (and `0 0 75vh`
  when the user taps the header to expand). The source body now actually
  shows alongside the card again.
- **Mobile review, landscape dock clipped by Obsidian's bottom nav bar:**
  The landscape rule had dropped the dock's bottom-nav padding to
  ~0.5rem, on the assumption that Obsidian hides its nav strip in
  landscape. It does not (the strip with back/forward/search/etc. still
  sits over the dock). Bumped to ~3.5rem so Previous, Later today, and
  Dismiss are no longer covered.

## [0.3.4] — 2026-05-24

### Changed

- **Mobile review dock, landscape layout:** Dropped the `@media
  (orientation: landscape) and (max-height: ...)` gate that wasn't firing
  reliably inside the Obsidian webview, and switched to a JS-driven
  `.ir-review--landscape` class applied whenever `window.innerWidth >
  window.innerHeight` on a mobile platform. Grade buttons
  (Again/Hard/Good/Easy, or Next/Show answer) sit on one row, with utility
  buttons (Previous/Edit/Dismiss/Later/Undo) on a second row below. Hub
  button, priority editor, and A-Factor editor share a single line above
  the buttons grid; the long hint copy ("0 = most important", "interval
  multiplier") is hidden in landscape. Dock no longer scrolls internally so
  every button is reachable without a sub-scroll.
- **Mobile review dock, portrait:** Trimmed vertical padding on the dock and
  controls so a short card body stays visible above the dock. Swipe legend
  dismisses itself after the first swipe (remembered across sessions via
  localStorage).
- **Mobile review, tap to expand the source column:** The "Source ..." header
  is now a button. Tap once to expand the parent column to ~75% of the
  viewport (portrait) or ~68% width (landscape) for long parents; tap again
  to collapse back to the default cap.
- **Workspace IR FAB:** Hides automatically while the on-screen keyboard is
  open so it no longer floats over the IME on iOS/Android.

## [0.0.24] — 2026-05-24

### Changed

- **IR quick actions:** Replaced the list modal with a **radial wheel** (ring of buttons around a center help card). The wheel **always opens** from the ribbon, **Alt+Shift+U**, menus, or review **Quick actions** so the gesture is predictable; when nothing applies, the center explains which context unlocks each action. The ring is **centered on the active workspace pane** (not the cursor). Command palette name is **IR quick actions (radial wheel)**; ribbon and menus use clearer copy.

### Notes for testers (BRAT)

- Installs use **GitHub Releases** assets (`main.js`, `manifest.json`, `styles.css`) built by `.github/workflows/release.yml` when a semver tag is pushed — not the bare git tree.

## [0.0.23] — 2026-05-23

### Added

- **IR actions hub** — Ribbon icon, command palette entry (**Open IR actions hub**), editor/file (IR) menus, mobile file menu, and an **IR actions…** button in the review dock. Lists contextual actions so the main chrome stays uncluttered.
- **New cloze card (separate item)** — Command + hub + editor menu: on an IR **item** note, creates a sibling item under `ir-parent` instead of adding `{{cN::}}` in place. Default hotkey **Alt+Shift+Z** (distinct from **Alt+Z** cloze).
- **Split cloze into separate IR item notes** — Hub + command: one new graded note per `{{cN::…}}` group (original unchanged). Assign a hotkey in Settings if desired.
- **Fork extract** — IR tree context menu on extracts; hub when a promoted extract note is active. Store-only extracts get a second reading element; promoted extracts are forked by copying the markdown file.
- **IR review: Previous** — Button and **`[`** hotkey (left bracket; `BracketLeft` for non-US layouts) move to the prior element in the **current session** only. Schedules you already advanced past are not rolled back; use this to revisit a reading card for another extract/cloze or to re-read a cloze before grading.

## [0.0.22] — 2026-05-23

### Fixed

- **Review: extract/cloze from anchored (store-only) extracts:** `canMakeChild` no longer requires `slot.file`. The view walks the ancestor chain for a vault `notePath` (or `anchor.sourcePath`) for provenance, finds a vault-backed topic/extract for cloze placement, wraps highlights in the store body when there is no file, and reparents cloze items created under a store-backed card.

## [0.0.21] — 2026-05-23

### Fixed

- **Extract: truncated stored text after highlight wrap:** `buildExtractEvent` was slicing selection offsets against the post-wrap note body, so `quote.exact` and `element.text` were cut off mid-passage (often after the opening `<mark class="ir-extract-source">`). Anchors now use the pre-wrap body plus an explicit `persistedExtractMark` flag so the stored extract matches the full selection.

## [0.0.16] — 2026-05-22

### Changed

- **Extract: block-anchored by default:** Review and Alt+X extract no longer create a separate vault note per selection. Extracts are stored in `.ir/` with an anchor into the source note, so the Obsidian graph stays clean until you **Promote to standalone note** in the tree.

## [0.0.15] — 2026-05-22

### Fixed

- **Cloze: multi-line selections:** Review preview and the editor now keep full line context when a cloze spans multiple lines (not just the line with the cursor).
- **Extract highlights:** Extracted text is marked with `<mark class="ir-extract-source">` in the source note and ancestor topics (via `ir-parent`), with styles so highlights show in Reading view and IR review.

## [0.0.14] — 2026-05-22

### Added

- **Extract: source highlight:** Creating an extract wraps the selected span in the parent topic/extract with Obsidian `==highlight==` so you can see what was already pulled out.

### Fixed

- **Review: Escape in edit mode:** Escape leaves the textarea and returns to preview instead of closing the whole review session.
- **Review: duplicate front matter after extract:** Reloading the card after extract/cloze no longer injects YAML into the edit buffer; selections that accidentally include front matter are stripped before creating a child note.

## [0.0.13] — 2026-05-22

### Added

- **Tree view: search/filter:** Type-to-filter input in the tree header narrows the tree to matching elements plus their ancestors. All nodes auto-expand during filtering.
- **Tree view: drag-to-reparent (UI commitment #5):** Drag any row onto another to make it a child. Cycle detection prevents dropping a parent onto its own descendant. A root drop zone appears during drag to promote elements to root level.
- **Tree view: element deletion:** "Delete element" in the context menu reparents children to the deleted element's parent, with a confirmation dialog.
- **Tree view: promote extract:** "Promote to standalone note" context menu item for extracts that don't yet have a note path. Creates the note on disk and emits a `promoted` event.
- **Tree view: anchor state badges:** Warning triangle icon for `needs-reanchor` elements, unlink icon for `detached` elements. Visual feedback for drifted anchors.
- **Tree view: re-anchor action:** "Re-anchor to source" context menu item for drifted extracts. Re-resolves the anchor against the current source text and emits an `anchor-repaired` event on success.
- **Review: visual progress bar:** Thin accent-colored bar above the card showing session completion. Queue composition breakdown in the progress text (e.g. "3 topics, 8 items left").
- **Review: per-element A-Factor editing:** Reading elements (topics/extracts) now show an A-Factor input in the review dock, next to priority. Adjusting the interval multiplier writes a `topic-advanced` event.
- **Review: queue composition notice:** Starting a review session shows a Notice with the breakdown (e.g. "Starting review: 3 topics, 5 items (8 total)").
- **Review: divergence picker (DESIGN.md Section 5):** When FSRS and SM-2 predict significantly different next intervals after grading, an inline picker bar appears so the user can choose which interval to use. SM-2 state is approximated from the FSRS card.

### Changed

- **Review: Escape exits editing:** Pressing Escape in the textarea returns to preview mode. "Next" button always shows "Space" since Escape then Space is the natural flow.
- **Review: focus management:** `ensureFocus()` restores keyboard focus to the review view after every card render, cloze/extract creation, and grading, so hotkeys work without clicking first.
- **Code cleanup:** Deduplicated `IrType`, `PRIORITY_MIN/MAX`, `clampPriority` across `src/types.ts`, `src/ir/model.ts`, `src/ir-note.ts`. Extracted `stripFrontmatter`/`saveBody` into `src/ir/frontmatter-body.ts`. Removed dead code from `src/review.ts`.

### Fixed

- **Review: inline hint bar steals hotkeys:** The cloze hint input now blocks keyboard shortcuts while typing (broadened `isTypingInInput` to cover `HTMLInputElement`, not just `HTMLTextAreaElement`). Typing "d" in the hint input no longer triggers dismiss.
- **Review: Alt+X / Alt+Z broken in review view:** Extract and cloze commands used `editorCheckCallback` which only fires in a MarkdownView. Switched to `checkCallback` with review view priority so the hotkey works in the IR review ItemView.
- **Review: 1-4 grading hotkeys broken on revealed cloze:** Removed the `isTypingInTextarea` guard for grade keys on revealed cloze cards. Grading is the primary action and should work regardless of textarea focus.
- **Review: Ctrl+Enter for Next:** Added a contentEl-level Ctrl+Enter handler so Next works even when focus is not on the textarea.

## [0.0.12] — 2026-05-21

### Fixed

- **Review hotkeys broken by textarea/input focus guards:** 1-4 grade keys, Alt+X/Z extract/cloze, Ctrl+Enter for Next, and inline hint bar input all fixed (see Unreleased for details of each fix that shipped in 0.0.12).

## [0.0.11] — 2026-05-21

### Added

- **Tree view: context menu:** Right-click any tree row for a native Obsidian context menu with Open note, Dismiss/Restore, and Postpone (1/3/7/14/30 days). Postpone writes a `mercy-postponed` event without corrupting scheduler state.
- **Review: inline cloze hint bar (UI commitment #6 partial reversal):** Cloze hint entry in the review view is now an inline bar in the dock instead of a modal dialog. The editor path (Alt+Z) still uses the modal. Updated `docs/UI-COMMITMENTS.md` to reflect the partial reversal.
- **Tree view: dismiss/restore action:** Dismissed elements in the tree have a Restore button that writes a `dismiss-set` event and updates frontmatter.
- **Extract highlighting in source column:** When reviewing an extract, the parent note body highlights the exact range the extract was pulled from.
- **Tree view: expand/collapse all, due-date badges, dismissed toggle.**
- **Reading position bookmarks** persisted to `.ir/bookmarks.json`.
- **Bulk import (Alt+B):** Import clipboard text as an IR topic.
- **Release automation** via `.github/workflows/release.yml`.

### Changed

- **`findExtractRange` and `formatDueLabel` extracted to pure modules** (`src/ir/extract-range.ts`, `src/ir/due-label.ts`) for direct unit testing.
- **`formatDueLabel`:** Added year-scale support (365+ days shows "Ny").

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
- **Mobile file menu (parity):** On Obsidian mobile, the note file menu gains the same IR commands that desktop users reach via hotkeys or the ribbon: start review, open element tree, session log, stats, mercy postpone, and Anki TSV export (after *Mark as IR topic* or the IR priority/dismiss entries).
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

[Unreleased]: https://github.com/RecursiveFunctions/obsidian-incremental-reading/compare/0.0.13...HEAD
[0.0.13]: https://github.com/RecursiveFunctions/obsidian-incremental-reading/compare/0.0.12...0.0.13
[0.0.12]: https://github.com/RecursiveFunctions/obsidian-incremental-reading/compare/0.0.11...0.0.12
[0.0.11]: https://github.com/RecursiveFunctions/obsidian-incremental-reading/compare/0.0.10...0.0.11
[0.0.10]: https://github.com/RecursiveFunctions/obsidian-incremental-reading/compare/0.0.9...0.0.10
[0.0.9]: https://github.com/RecursiveFunctions/obsidian-incremental-reading/compare/0.0.8...0.0.9
[0.0.8]: https://github.com/RecursiveFunctions/obsidian-incremental-reading/compare/0.0.6...0.0.8
[0.0.6]: https://github.com/RecursiveFunctions/obsidian-incremental-reading/compare/0.0.5...0.0.6
[0.0.5]: https://github.com/RecursiveFunctions/obsidian-incremental-reading/compare/0.0.2...0.0.5
[0.0.2]: https://github.com/RecursiveFunctions/obsidian-incremental-reading/releases/tag/0.0.2
[0.0.1]: https://github.com/RecursiveFunctions/obsidian-incremental-reading/releases/tag/0.0.1
