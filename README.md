# Incremental Reading for Obsidian

Read many sources in parallel, extract the passages worth keeping, and review them on a spaced schedule — all inside Obsidian.

**Status:** alpha. The current version is published on [GitHub Releases](https://github.com/RecursiveFunctions/obsidian-incremental-reading/releases). Install through [BRAT](#installation). A commit on `main` is not installable; BRAT reads the release assets.

## What it is

Incremental reading is a method from Piotr Wozniak's [SuperMemo](https://supermemo.guru). You keep many articles in flight at once, break passages out of them as you read, and see those pieces again when they come due. This plugin implements that reading workflow against the markdown files and PDFs already in your vault.

## Why it is different

- **Source → extract → item lineage.** Every element keeps a link back to where it came from, and Collection shows the whole tree: which note a passage was cut from, which cloze was cut from a passage.
- **Your notes stay in place.** The plugin is vault-native: topics, extracts, and items live in your existing markdown files, there is no copied content library and no external database, and the scheduling and review metadata stays inside the vault under `.ir/`.
- **Visible, priority-aware overload control.** The status bar shows what is due, what is postponed, and what has flowed in over seven days. When the queue runs away, Mercy previews and redistributes the lower-priority overflow across future days, without recording a review or touching what you actually learned.

## Concepts

The plugin uses three kinds of element, and they behave differently.

| Element | What it is | How it is scheduled |
|---|---|---|
| Topic | Something you read: a note or a PDF | SuperMemo 20 reading schedule (length-based initial A-Factor, `a^3` first interval, log-uniform spread, and ease updates). Never graded |
| Extract | A span pulled out of a topic or another extract | Blends parent A-Factor with extract length, decays parent A-Factor by 5%, spreads priority around the parent, and keeps a link to its source |
| Item | A card you grade: a cloze or an image occlusion | SuperMemo 20 or FSRS-6 (switchable anytime in Settings, with subtle priority drift on passing grades so mastered items slowly make room for fresh material) |

Every element carries a **priority** from 0 to 100, where **lower means more important**. Priority 0 floats to the top of the queue.

Four ways to move work out of your way, which are all different:

- **Later today** pushes a reading element back a few hours. It does not count as a review.
- **Postpone** moves a selected element's due date forward by a set number of days (1, 3, 7, 14, or 30). It does not count as a review.
- **Mercy** bulk-redistributes an overloaded queue across future days. It does not count as a review. See [Stay ahead of overload](#stay-ahead-of-overload).
- **Dismiss** takes an element out of the queue and leaves it in the tree. Reversible.

## Stay ahead of overload

The status bar shows three numbers at a glance: how many elements are due now, how many are currently postponed, and how many new elements landed in the last seven days. The inflow number is a leading indicator that you are importing faster than you can process.

Settings, Overload sets a daily ceiling: the maximum number of due elements per day. A priority cutoff protects the work that matters most — elements with a priority at or below the cutoff are never postponed, no matter the overflow.

When the queue has run away, run Mercy (`Alt+M`). It first shows a preview: how many elements stay due today, how many are protected by priority, and how the postponed overflow will be spread across future days that have free capacity. Apply it, and the overflow is redistributed without recording a review and without changing FSRS stability or reading A-Factor — the scheduler state stays exactly as your grades left it. The latest Mercy batch can be undone with Undo last mercy, which restores each element's previous due time.

Manual Postpone and Later today are separate, smaller levers: Postpone moves one selected element to a chosen future date, and Later today defers a reading element within the same day. Neither is part of Mercy and neither is covered by Mercy undo.

An optional startup auto-postpone is off by default. When you turn it on, it postpones overdue overflow once per launch and always leaves work newly due today alone.

Keyboard bindings and per-control details are in [Keyboard](#keyboard) and [Settings](#settings).

## Getting started

1. Open a markdown note or a PDF.
2. Mark it as a topic with `Alt+T`, or the file menu on mobile. Right-clicking a folder marks every unmarked note and PDF inside it, nested folders included; **Mark as IR topic with priority…** or **Bulk mark as IR topics…** lets you pick a placement priority or spread a batch evenly across a priority range.
3. Start review with `Alt+R`, the ribbon icon, or a click on the status bar. On a phone, tap the floating brain button.

`Alt+H` opens a help panel listing every key and command. If you have no topics yet, Start review opens a pane that walks you through those three steps.

## A review session

Review runs in one tab. The bar at the top shows the mode (Due or Neural) and how many cards are left in the pass.

Extract or cloze during review and the new card is queued right after the current one, so you see it in this session.

Reading cards remember where you stopped and say so, with an option to start from the top instead. The source note sits beside the card. On a phone, Source is a toggle on the session bar. Click the card text to edit in Live Preview at that spot; Source gives you raw markdown.

Grade buttons are color-coded and carry their own hotkey. Successful actions flash a line in the review dock; failures use a notice.

**Undo** covers your last grade and your last Later today or Dismiss. It rewinds to the card it restored. Every reversal is written to the log as a new event, so review history stays append-only.

When the pass ends, the tab stays open on a completion screen. When nothing is due at all, review opens a panel showing the next due time, how many elements land tomorrow, and how many land inside a week.

If an extract's source has moved or disappeared, the card offers Re-anchor, Detach, and Open source directly.

## Extracts

There are two kinds, and the menus use these words:

- **Anchored extract**, the default. A highlight in the source. No new file.
- **Standalone note.** A new markdown file. Turn on Settings, Extracts, Extract to standalone note, or do it once with `Alt+Shift+X`. `Alt+Shift+P` promotes an anchored extract later.

Cloze items always get their own note. Creating one with `Alt+Z` offers an optional hint on an inline bar: Enter confirms, empty means no hint, Escape cancels. Deletions use Anki-compatible markup, `{{c1::hidden text}}` or `{{c1::hidden text::hint}}`.

Extract and cloze both work from Reading view. `Alt+X` uses a formatting-tolerant mapping and never switches Reading view automatically; if it cannot map the selection, it reports that instead. Cloze creation can switch to Source/Edit when exact markdown is required, keeping the selection where possible.

Extract and cloze highlights paint in the editor, in reading view, and in the review source column. Extracts are yellow, clozes are green and underlined. The source file is never rewritten to add them.

Delete a source note and you get one prompt: turn the orphaned extracts into notes, keep them in review with no note file, or undo. The same prompt appears at next launch if the note vanished while Obsidian was closed. Restore the note later and you are asked whether to reattach the highlights.

### Multi-span, images, occlusion

Hold Ctrl (Cmd on macOS) to build one extract from several spans. Each selection you release with the modifier down is held and painted. `Alt+X` then joins every held span and the live one into a single extract, one paragraph per span, anchored on the first. This works in the PDF viewer with spans across different pages, in the editor, in reading view, and on the review card. `Esc` or `Alt+Shift+C` drops the held spans.

`Alt+Shift+I` in the PDF viewer lets you drag a rectangle on a page. The crop is saved as a PNG attachment and becomes an extract that embeds it, with the page and rect recorded on the anchor. `Alt+Shift+O` does the same drag and opens the occlusion editor on the crop.

For images already in notes, right-click one inside a topic or extract and choose Extract image (IR) or Image occlusion items from this image. `Alt+O` does the same for an open image file.

The occlusion editor is a workspace leaf. Drag to draw masks, click one to select it, type an optional label. `Del` removes, `Tab` cycles, arrows nudge, `M` toggles the mode, `Enter` creates one item per mask, `Esc` closes. Two modes: hide all and guess one, or hide one and show the rest. Each item is an ordinary note whose body is an `ir-occlusion` block:

```ir-occlusion
{"image":"attachments/heart.png","mode":"hide-all","active":2,"rects":[{"n":1,"x":0.1,"y":0.2,"w":0.3,"h":0.1,"label":"aorta"},{"n":2,"x":0.5,"y":0.5,"w":0.2,"h":0.2}]}
```

That block renders as the masked image anywhere Obsidian renders markdown. In review, `Space` reveals and `1` to `4` grade, the same as a text cloze. Anki TSV export skips image-occlusion items and reports how many were omitted because Anki cannot import this block format.

## Neural review

`Alt+N` starts a session from the card you are reviewing or the IR note you have open, then walks related material through children, wikilinks, tags, and optional lexical/title-mention links. The active frontier persists in `.ir/` (`Resume Neural Queue`) and expands dynamically as you review, extract, or cloze; an inline **Due today** toggle filters review slots to due elements while keeping the seed and associative bridges intact. Grades still count. A muted line on each card says how it got there: `via wikilink`, `via child of`, or `via tag`. Escape ends the neural pass and offers to start today's due queue.

## Views

**Collection** (`Alt+I`) separates global Priority order from the nested Sources view. Keys: `j` and `k` or arrows to move, Enter to open or jump review, `o` to open the note, `p` to edit priority, `d` to dismiss, `m` to postpone, Space to fold Sources.

Move elements by dragging, or without a mouse: `x` picks up the focused element or the current selection, every legal destination row grows a Move here button, and `v` drops onto the focused row. The banner offers Make root, and Escape cancels. A row that would swallow its own subtree is dimmed.

Click a row to locate it in an open review; double-click opens the note. The card under review keeps a chip.

**Stats** (`Alt+S`) is organized into three tabs — **Overview**, **Triage**, and **Models & SM-20**. Overview shows a 4-card KPI grid (due today, 7-day true retention, 7-day inflow, leeches), total and scheduled element counts, a seven-day forecast (with overdue counted separately), a 26-week activity heatmap, 30-day rolling 7-day true retention, the grade spread, and a 20-category Priority Forgetting Index chart with a `1 - desiredRetention` target line and click-to-review subset launch. Triage provides bounded leech detection with adjustable thresholds and `Forget / Reset`. Models & SM-20 holds inline primary-scheduler switching (`SM-20` / `FSRS-6`), SM-20 matrix diagnostics and rebuild controls, and the local FSRS-6 parameter optimizer. Retention counts Hard or better as a recall, and the panel says so.

**Session log** (`Alt+L`) is the current pass, stamped when you start it. Click a row to jump to that card or open the note.

**Help** (`Alt+H`) lists the review keys, the tree keys, every command with the binding you have actually assigned, and a short vocabulary section.

**Status bar** shows due now, currently postponed, and inflow over seven days — the same three numbers described in [Stay ahead of overload](#stay-ahead-of-overload). Click to start review, right-click for the IR menu.

## Keyboard

Commands with a default binding:

| Key | Command |
|---|---|
| `Alt+T` | Mark the current note or PDF as a topic |
| `Alt+R` | Start review |
| `Alt+N` | Go neural |
| `Alt+X` | Extract selection, joining any Ctrl-held spans |
| `Alt+Z` | Cloze selection |
| `Alt+Shift+X` | Extract once to a standalone note |
| `Alt+Shift+P` | Promote the current anchored extract |
| `Alt+Shift+Z` | New cloze item in a separate note |
| `Alt+Shift+C` | Clear held Ctrl selections |
| `Alt+Shift+I` | Extract an image region from the open PDF |
| `Alt+Shift+O` | Occlusion cards from a PDF region |
| `Alt+O` | Occlusion cards from the open image |
| `Alt+I` | Collection |
| `Alt+L` | Session log |
| `Alt+S` | Stats |
| `Alt+H` | Help and keyboard shortcuts |
| `Alt+P` | Set priority |
| `Alt+M` | Postpone overload |
| `Alt+D` | Dismiss or restore |
| `Alt+E` | Export items to Anki TSV |
| `Alt+B` | Import clipboard text as a topic |
| `Alt+Shift+U` | Quick actions wheel |

Additional commands ship with no default binding: `Mark current note as IR topic with priority`, `Bulk mark folders and files as IR topics`, `Extract selection with priority`, `Resume Neural Queue`, `Start Final Drill`, `Start random review (reschedules items)`, `Sort current review queue now`, `Jump interval…`, `Advance element / selection…`, `Review Obsidian search results (due)` / `(all)`, `Duplicate element as sibling`, `Resume last read topic`, `Undo last grade`, `Undo last mercy`, `Split cloze into separate IR item notes`, `Mark folder notes as IR topics`, `Import SuperMemo collection (SM18 / SM20)`, `Import EPUB or HTML document`, `Copy optimizer data report`, `Rebuild SM-20 optimization matrix`, and the bulk extract commands (paragraph at cursor, heading section, every blockquote, every list item, every paragraph). Assign keys under Settings, Hotkeys.

Inside the review tab: `Space` advances a reading card, reveals a cloze, and then grades Good by default. `1` to `4` grade a revealed cloze. `[` goes back, `I` toggles the on-demand Element Info telemetry drawer (`R%`, `S`, `D`, `SInc`, shadow intervals, rank/delta, reading stats), `L` is later today, `D` dismisses, `Ctrl+Enter` advances a reading card while the editor is focused, `Escape` leaves.

These review and tree keys belong to their panes and are fixed. They only fire while that pane has focus, and Settings, Hotkeys does not govern them. Everything in the table above is rebindable.

## Mobile

A single due-badged floating brain button stays visible across the workspace (auto-hidden during active review so it never covers the dock): tap to open the Bottom Sheet Hub (`Start review`, `Open Collection`, `Go neural`, queue summary), or long-press (`450 ms`) for Quick Capture.

Review and Collection adapt by container width and pointer capability (`compact`, `medium`, `expanded` tiers): the primary review dock stays calm (`Extract`, `Cloze`, `Later`, `Next` on reading; 4 grade buttons on items), secondary card utilities (`Prev`, `Edit`, `Info`, `⋯`) sit in the card header, selecting text on touch surfaces reveals a thumb-zone Touch Selection Bar (`Extract`, `Cloze`, `+ Hold span`), and Collection provides a `Select` checkbox mode, `450 ms` row long-press, and `[⋯]` row menu. Swipe the card to navigate and grade; a legend explains the directions and stops appearing after three sessions.

Priority editing on mobile goes through the tree's inline editor or the side-panel placement priority view, since Obsidian mobile has no status bar.

If you extract from the editor, pin these to the mobile toolbar under Settings, Mobile, Configure mobile toolbar: Extract selection, Cloze to IR item, Start IR review, IR quick actions, Mark note as IR topic.

## Settings

Eight sections: Review, Extracts, Topics, Overload, Priority scheduling, Mobile, Anki export, Danger zone (with expert SM-20, dispersion, divergence, and lexical controls folded into **Advanced scheduling & SM-20**).

Review covers **Reviews per reading** (with live reading/item percentage copy), the scheduler divergence picker, and which grade Space applies after a cloze reveal. Overload holds the daily ceiling, the priority cutoff, and the optional startup auto-postpone, all described in [Stay ahead of overload](#stay-ahead-of-overload). Extracts covers standalone-note behavior and what happens when a source note is deleted. Mobile configures the **Floating IR button & hub**. Danger zone can reset IR state while keeping your notes, or trash every IR note.

Restore defaults at the top returns every control to a new vault's values. It does not touch notes or review history.

New vaults use the SuperMemo 20 item scheduler by default, and existing vaults keep FSRS-6 unless you choose to switch. You can switch between SuperMemo 20 and FSRS-6 at any time in Settings without converting your cards. Turning on the scheduler divergence picker asks you to choose when the schedulers disagree sharply about the next interval.

## Privacy
Built to work offline. Full threat model, verification commands and reproducible-build instructions: [`SECURITY.md`](SECURITY.md).
- **No network calls.** There is no `fetch`, `requestUrl`, `XMLHttpRequest`, or `WebSocket` anywhere in the source, and the build fails if one ever appears in the compiled `main.js`.
- **No telemetry**, which follows from the above.
- **One runtime dependency**, [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs), pinned to an exact version with a committed lockfile.

## Roadmap

Shipped: topics with length-based SM20 A-Factors, non-modal placement-priority panels for single mark, bulk folder/file mark (default, fixed, or even-spaced range), and extract-with-priority, anchored extracts and standalone notes with SM20 A-Factor inheritance, parent A-Factor decay, and priority spreading, clozes with hints, SM-20 default item scheduling (`SInc` 21×21×21 matrix with 3D neighbor smoothing, difficulty/lapse post-lapse curve, retention outlier reconciliation, early-review R damping) alongside FSRS-6 with post-grade priority drift and a local parameter optimizer, 4-model scheduler divergence (`SM-20` / `FSRS-6` / `DSR` / `SM-2`), SM20 topic commit (`a^3` first interval, log-uniform dispersion, ease adjustment) and priority-scaled first intervals, persisted same-day Final Drill, interleaved due review, semantic passes (`via branch`, `via subset`, `via search`), unified inline `Reschedule…` bar (`Later`, `Postpone`, `Advance`, `Jump interval`), on-demand `Element Info (I)` telemetry drawer, dynamic Neural Queue (`neural.json`, Aho-Corasick title-mention matching, `Due today` toggle), deterministic priority queue policies, 5-dimension Mercy scoring and interactive postpone preview (`Alt+M`), bounded leech triage, SM18/SM20 and EPUB/HTML import with vault-wide duplicate guards and history interval repair, Collection with global Priority and nested Sources modes, status bar, segmented 3-tab Stats (`Overview | Triage | Models & SM-20`) with forecast/heatmap/rolling retention/clickable Priority FI, session log, help panel, PDF topics and extracts, image extracts and image occlusion, Ctrl multi-span extracts, responsive `compact`/`medium`/`expanded` container tiers with unified Mobile Hub FAB and Touch Selection Bar, and undo for grades, Mercy, manual reschedules, later, and dismiss.

PDF support covers text-layer PDFs. Scanned PDFs with no text layer cannot be extracted, and cloze is markdown-only: extract from the PDF first, then cloze the extract.

Planned, in order (full details in [`docs/FUTURE-PLANS.md`](docs/FUTURE-PLANS.md)):

- [x] **Rich-content collection import & duplicate-source guards:** Full HTML and image component decoding, automatic Q&A/cloze synthesis from display flags, extract-vs-topic provenance detection, read-point caret/scroll bookmark recovery, and URL/source deduplication on import.
- [x] **Final Drill, semantic review passes & dynamic Neural Review:** End-of-session Final Drill stage for lapsed items, branch/subset/search review passes, safe Advance / Add-to-outstanding tools, and incremental spreading-activation expansion in Neural Review (`Alt+N`).
- [x] **Queue diagnostics, leech triage & stats trends:** Visual queue-randomization probability curve in Settings, multi-criteria leech filtering and one-click triage actions in Collection and Stats.
- [x] **Incremental video & audio (`#69`):** Timestamp-anchored media topics and extracts (`resume / start / stop` in `.ir/`), bounded HTML5 review player with clip timeline markers, and offline-first privacy.
- [ ] **Companion web capture & directory submission:** Companion browser extension for one-click web import, final plugin ID/name migration path from BRAT, and real-device mobile refinements.

Under consideration: a one-way structure export for external collections.

If you're interested in the architecture and full roadmap, check [`docs/DESIGN.md`](docs/DESIGN.md) and [`docs/FUTURE-PLANS.md`](docs/FUTURE-PLANS.md).

## Recent changes (0.15.0)

See [`CHANGELOG.md`](CHANGELOG.md) for the full version history. `0.15.0` ships the 3-layer progressive disclosure UX across Review, Stats, Settings, and Mobile, non-modal placement-priority panels for marking and extracting, SM-20 post-lapse/retention-matrix refinements, and SuperMemo/EPUB import hardening.

- **Non-modal placement-priority panels (#89, #90, #91):** Mark a note or PDF with an explicit placement priority (`Use default`, or route already-IR files to the priority editor), bulk-stage folders and multi-selected files (`files-menu`) with default / fixed / deterministic even-spaced range priorities, and extract selections with `Use computed`, `Use default`, or custom 0–100 child priority while preserving parent A-Factor decay.
- **3-layer progressive disclosure UX (#61–#65):** Calm primary Review dock with card-header utilities, humanized rank chip, unified `Reschedule…` bar, on-demand `Element Info (I)` telemetry drawer, 3-tab `IR stats` (`Overview | Triage | Models & SM-20`) with clickable 20-category Priority FI subsets, collapsible **Advanced scheduling & SM-20** settings, and responsive `compact`/`medium`/`expanded` container tiers with the unified Mobile Hub FAB and Touch Selection Bar.
- **SM-20 post-lapse curve, 3D cube smoothing & retention outlier reconciliation (#68, #70, #73):** Replaced flat post-lapse multipliers in `computePostLapseStability` with `0x00ce0600` difficulty-and-lapse scaling, added `smoothSm20SincCube` (`0x00a93480`/`0x00a93510`), reconciled `> 0.5` adjacent retention-bin jumps (`0x00c243f0`) before weighted regression in `calibrateSm20Retrievability`, added `computeBlendedForgettingCurveRetention` (`0x00cad6a0`), and repaired non-positive intervals (`0x00d1e8a0`) + tracked grade/lapse mismatches (`0x00d1bde0`) on SuperMemo import.
- **Scale & import fixes (#74–#77, #82–#86, #92–#95):** Linear-time `planFinalOrder` with debounced Distribute range inputs, Aho-Corasick title-mention matching in Neural review, single-write frontmatter + `reconcileNew` batch import, `.mem` `filespace_slot` (`0x16`) + HTML backing/image attachment resolution, vault-relative path containment, bookmark load-failure guard, `Later today` undo tagging, and accurate divergence tooltip key numbers.

## Installation

Install through BRAT while the plugin is in alpha.

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) from Community Plugins and enable it.
2. Settings, BRAT, Add Beta plugin, repository `RecursiveFunctions/obsidian-incremental-reading`.
3. Install the latest release. If a tag was just pushed, wait for the Release workflow to go green first.
4. Enable Incremental Reading under Community Plugins.

Requires Obsidian 1.7.2 or newer. Desktop and mobile.

This is alpha software. Expect breaking changes between updates. Personally I do actually use this in my own vault, but you may want to back yours up just in case.

## Development

Requires Node.js 20 or newer and a vault.

```bash
git clone https://github.com/RecursiveFunctions/obsidian-incremental-reading
cd obsidian-incremental-reading
npm install
npm run dev          # builds and watches, writes main.js next to manifest.json
```

Symlink the project into your test vault and enable it under Community Plugins:

```bash
# from inside your test vault
mkdir -p .obsidian/plugins
ln -s /absolute/path/to/obsidian-incremental-reading .obsidian/plugins/incremental-reading
```

`npm run build` is a one-shot production build with type-checking. `npm test` runs the headless core suite, and `npm run test:layout` checks the mobile edit layout in Chromium. These tests do not cover every live review interaction, hotkey dispatch, or `processFrontMatter` against the real app, so changes there need a real vault.

Release mechanics are in [`docs/RELEASE.md`](docs/RELEASE.md). UI rules the project holds itself to are in [`docs/UI-COMMITMENTS.md`](docs/UI-COMMITMENTS.md).

## Contributing

Bug reports, design discussion, code, docs, and testing in your own vault all help.

Open an issue before sending a PR for a new feature. The plugin stays close to SuperMemo's model instead of inventing parallel mechanics, so agreeing on approach early saves rework.

## Acknowledgments

- [Piotr Wozniak](https://supermemo.guru) for inventing incremental reading and writing about it for decades.
- The [FSRS team](https://github.com/open-spaced-repetition), in particular Jarrett Ye, for an open scheduler in SuperMemo's lineage.
- The [Obsidian sample plugin](https://github.com/obsidianmd/obsidian-sample-plugin) and the community developers whose code taught me the API.

## License

[MIT](LICENSE). Every feature is free. There is no paid tier, no telemetry, and no server. There is no future version where the core is gated.
