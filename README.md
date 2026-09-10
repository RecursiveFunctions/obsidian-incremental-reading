# Incremental Reading for Obsidian

Read many sources in parallel, pull the parts worth keeping out of them, and review those parts on a spaced schedule. SuperMemo-style incremental reading, in your vault.

**Status:** alpha, currently 0.7.13. Install through [BRAT](#installation) from [GitHub Releases](https://github.com/RecursiveFunctions/obsidian-incremental-reading/releases). A commit on `main` is not installable; BRAT reads the release assets.

## What it is

Incremental reading is a method from Piotr Wozniak's [SuperMemo](https://supermemo.guru). You keep many articles in flight at once, break passages out of them as you read, and see those pieces again when they come due.

SuperMemo runs on Windows and keeps your knowledge in its own format. Obsidian's existing spaced-repetition plugins are flashcard tools: they schedule cards but have no element tree, no extracts, and no priority queue. This plugin implements the reading workflow itself against plain markdown files.

## Concepts

The plugin uses three kinds of element, and they behave differently.

| Element | What it is | How it is scheduled |
|---|---|---|
| Topic | Something you read: a note or a PDF | A reading schedule. You are never graded |
| Extract | A span pulled out of a topic or another extract | Inherits a reading schedule, keeps a link to its source |
| Item | A card you grade: a cloze or an image occlusion | FSRS |

Every element carries a **priority** from 0 to 100, where **lower means more important**. Priority 0 floats to the top of the queue.

Three ways to move work out of your way, which are all different:

- **Later today** pushes a reading element back a few hours. It does not count as a review.
- **Postpone (mercy)** bulk-pushes overdue elements when the queue has run away from you. Also not a review.
- **Dismiss** takes an element out of the queue and leaves it in the tree. Reversible.

## Getting started

1. Open a markdown note or a PDF.
2. Mark it as a topic with `Alt+T`, or the file menu on mobile. Right-clicking a folder marks every unmarked note and PDF inside it, nested folders included.
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

Extract and cloze both work from Reading view. When a rendered selection cannot be mapped back onto the markdown, the note switches to Edit and keeps the selection where possible.

Extract and cloze highlights paint in the editor, in reading view, and in the review source column. Extracts are yellow, clozes are green and underlined. The source file is never rewritten to add them.

Delete a source note and you get one prompt: turn the orphaned extracts into notes, keep them as review cards only, or undo. The same prompt appears at next launch if the note vanished while Obsidian was closed. Restore the note later and you are asked whether to reattach the highlights.

### Multi-span, images, occlusion

Hold Ctrl (Cmd on macOS) to build one extract from several spans. Each selection you release with the modifier down is held and painted. `Alt+X` then joins every held span and the live one into a single extract, one paragraph per span, anchored on the first. This works in the PDF viewer with spans across different pages, in the editor, in reading view, and on the review card. `Esc` or `Alt+Shift+C` drops the held spans.

`Alt+Shift+I` in the PDF viewer lets you drag a rectangle on a page. The crop is saved as a PNG attachment and becomes an extract that embeds it, with the page and rect recorded on the anchor. `Alt+Shift+O` does the same drag and opens the occlusion editor on the crop.

For images already in notes, right-click one inside a topic or extract and choose Extract image (IR) or Image occlusion cards from this image. `Alt+O` does the same for an open image file.

The occlusion editor is a workspace leaf. Drag to draw masks, click one to select it, type an optional label. `Del` removes, `Tab` cycles, arrows nudge, `M` toggles the mode, `Enter` creates one card per mask, `Esc` closes. Two modes: hide all and guess one, or hide one and show the rest. Each card is an ordinary note whose body is an `ir-occlusion` block:

```ir-occlusion
{"image":"attachments/heart.png","mode":"hide-all","active":2,"rects":[{"n":1,"x":0.1,"y":0.2,"w":0.3,"h":0.1,"label":"aorta"},{"n":2,"x":0.5,"y":0.5,"w":0.2,"h":0.2}]}
```

That block renders as the masked image anywhere Obsidian renders markdown. In review, `Space` reveals and `1` to `4` grade, the same as a text cloze. Anki TSV export writes the block verbatim; Anki cannot import it.

## Neural review

`Alt+N` starts a session from the card you are reviewing or the IR note you have open, then walks related material through children, wikilinks, and tags. Grades still count. A muted line on each card says how it got there: `via wikilink`, `via child of`, or `via tag`. Escape ends the neural pass and offers to start today's due queue.

## Views

**Element tree** (`Alt+I`) shows the source to extract to item hierarchy. Keys: `j` and `k` or arrows to move, Enter to open or jump review, `o` to open the note, `p` to edit priority inline, `d` to dismiss, `m` to postpone, Space to fold.

Move elements by dragging, or without a mouse: `x` picks up the focused element or the current selection, every legal destination row grows a Move here button, and `v` drops onto the focused row. The banner offers Make root, and Escape cancels. A row that would swallow its own subtree is dimmed.

Click a row to locate it in an open review; double-click opens the note. The card under review keeps a chip.

**Stats** (`Alt+S`) shows total elements, how many are scheduled, what is due now split by type, and a seven-day forecast of what lands each day. Overdue is counted separately from the daily bars. Below that: reviews over the last thirty days, retention, the grade spread, and a fourteen-day sparkline. Retention counts Hard or better as a recall, and the panel says so.

**Session log** (`Alt+L`) is the current pass, stamped when you start it. Click a row to jump to that card or open the note.

**Help** (`Alt+H`) lists the review keys, the tree keys, every command with the binding you have actually assigned, and a short vocabulary section.

**Status bar** shows due, postponed, and inflow over seven days. Click to start review, right-click for the IR menu.

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
| `Alt+Shift+Z` | New cloze card as a separate item |
| `Alt+Shift+C` | Clear held Ctrl selections |
| `Alt+Shift+I` | Extract an image region from the open PDF |
| `Alt+Shift+O` | Occlusion cards from a PDF region |
| `Alt+O` | Occlusion cards from the open image |
| `Alt+I` | Element tree |
| `Alt+L` | Session log |
| `Alt+S` | Stats |
| `Alt+H` | Help and keyboard shortcuts |
| `Alt+P` | Set priority |
| `Alt+M` | Postpone overload |
| `Alt+D` | Dismiss or restore |
| `Alt+E` | Export items to Anki TSV |
| `Alt+B` | Import clipboard text as a topic |
| `Alt+Shift+U` | Quick actions wheel |

Nine more commands ship with no default binding: resume last read topic, undo last grade, split cloze into separate notes, mark folder notes as topics, and the bulk extract commands (paragraph at cursor, heading section, every blockquote, every list item, every paragraph). Assign keys under Settings, Hotkeys.

Inside the review tab: `Space` advances a reading card, reveals a cloze, and then grades Good by default. `1` to `4` grade a revealed cloze. `[` goes back, `L` is later today, `D` dismisses, `Ctrl+Enter` advances a reading card while the editor is focused, `Escape` leaves.

These review and tree keys belong to their panes and are fixed. They only fire while that pane has focus, and Settings, Hotkeys does not govern them. Everything in the table above is rebindable.

## Mobile

A floating brain button stays visible across the app, including the file explorer, and carries a badge with the number of elements due. It opens the quick actions wheel, which always has Start review and Open element tree, plus Go neural when the open note is in IR.

In review, the dock keeps the primary actions and moves the rest behind an overflow menu whose contents depend on the card: reading cards get Edit, Previous, Later today, Dismiss and Undo, an unrevealed cloze gets Previous only. Priority and A-Factor collapse into a chip you tap to edit. Swipe the card to navigate and grade; a legend explains the directions and stops appearing after three sessions.

Priority editing on mobile goes through the tree's inline editor, since Obsidian mobile has no status bar.

If you extract from the editor, pin these to the mobile toolbar under Settings, Mobile, Configure mobile toolbar: Extract selection, Cloze to IR item, Start IR review, IR quick actions, Mark note as IR topic.

## Settings

Six sections: Review, Extracts, Topics, Overload, Anki export, Danger zone.

Review covers how many items sit between reading cards, interleaving, the scheduler divergence picker, and which grade Space applies after a cloze reveal. Overload sets the daily ceiling and the priority cutoff for postpone. Extracts covers standalone-note behavior and what happens when a source note is deleted. Danger zone can reset IR state while keeping your notes, or trash every IR note.

Restore defaults at the top returns every control to a new vault's values. It does not touch notes or review history.

FSRS handles grading. Turning on the scheduler divergence picker asks you to choose when FSRS and classic SM-2 disagree sharply about the next interval. New vaults leave it off.

## Privacy and build

This plugin reads your knowledge base, and Obsidian plugins are not sandboxed. They get filesystem and network access on the honor system. Rather than promise good behavior, the plugin is built so you can check:

- **No network calls.** There is no `fetch`, `requestUrl`, `XMLHttpRequest`, or `WebSocket` anywhere in the source. Grep for them.
- **No telemetry**, which follows from the above.
- **One runtime dependency**, [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs), with a committed lockfile.
- **A deterministic build.** `npm run build` produces a byte-identical `main.js` on the same toolchain, so you can build from source and compare hashes against the release.

## Roadmap

Shipped: topics, anchored extracts and standalone notes, clozes with hints, FSRS scheduling, interleaved due review, neural sessions, priority queue and mercy postpone, the element tree with keyboard and touch reparenting, status bar, stats with forecast, session log, help panel, PDF topics and extracts, image extracts and image occlusion, Ctrl multi-span extracts, mobile FAB with due count, and undo for grades, later, and dismiss.

PDF support covers text-layer PDFs. Scanned PDFs with no text layer cannot be extracted, and cloze is markdown-only: extract from the PDF first, then cloze the extract.

Planned:

- [ ] Browser extension for one-click import of web pages.
- [ ] Calendar heatmap and retention trend in stats.
- [ ] Consistent vocabulary across views. The code currently uses element, item, and card for overlapping things.
- [ ] Full mobile parity, meaning whatever a real device still gets wrong on small screens.

Under consideration: a one-way export of the tree that SuperMemo could import. Scheduling would not transfer, since FSRS and SM-15/17/18 do not share parameters. Open an issue if that matters to you.

Not planned: reimplementing SM-15/17/18, and importing `.kno` collection files.

The data model and the reasoning behind it are in [`docs/DESIGN.md`](docs/DESIGN.md).

## Installation

Install through BRAT while the plugin is in alpha.

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) from Community Plugins and enable it.
2. Settings, BRAT, Add Beta plugin, repository `RecursiveFunctions/obsidian-incremental-reading`.
3. Install the latest release. If a tag was just pushed, wait for the Release workflow to go green first.
4. Enable Incremental Reading under Community Plugins.

Each release attaches `main.js`, `manifest.json`, and `styles.css`. BRAT downloads those three files. A branch ZIP will not work, because `main.js` is not in git. If BRAT reports a missing `main.js`, check that the release lists all three.

Requires Obsidian 1.5.0 or newer. Desktop and mobile.

This is alpha software. It is dogfooded daily in a real vault, but the store format may still change. Back up a vault you care about.

## Development

Requires Node.js 20 or newer and a throwaway vault.

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

`npm run build` is a one-shot production build with type-checking. `npm test` runs 642 headless tests over the pure cores. Those tests do not cover the live review surface, hotkey dispatch, or `processFrontMatter` against the real app, so changes there need a real vault.

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
