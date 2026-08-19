# Incremental Reading for Obsidian

Read many sources in parallel, extract the important bits, and review them on a spaced schedule — SuperMemo-style incremental reading, inside Obsidian.

**Status:** Pre-release alpha (**0.6.11**). Install from **[GitHub Releases](https://github.com/RecursiveFunctions/obsidian-incremental-reading/releases)** via [BRAT](#installation). A commit on `main` is not enough; BRAT reads the release assets.

## What this is

Incremental reading (IR) is a learning method from Piotr Wozniak's [SuperMemo](https://supermemo.guru). You keep a pile of articles in flight, pull passages into smaller pieces as you go, and see those pieces again when they are due.

SuperMemo is Windows-only and stores knowledge in a proprietary format. Obsidian is where many people already keep notes, but its spaced-repetition plugins are flashcard tools: they do not model IR's element tree, extracts, or priority queue. This plugin is the IR workflow itself, in your vault.

## What makes this different

1. **A real element tree.** Source → extract → extract → cloze item, with a hierarchy you can browse. Anchored extracts stay in the source until you promote them. Cloze items (and extracts you promote) are notes.
2. **Postpone that does not lie.** When the queue is too big, overflow is pushed by priority. The scheduler is not told you reviewed a card you only postponed.
3. **FSRS scheduling, with an optional second opinion.** Grades follow [FSRS](https://github.com/open-spaced-repetition/free-spaced-repetition-scheduler). If you turn on **Settings → Show scheduler divergence picker**, you can choose when FSRS and classic SM-2 disagree a lot about the next interval. New vaults leave that off.
4. **Built to work on a phone.** SuperMemo does not. This plugin is meant to feel usable on Obsidian mobile as well as desktop.
5. **A privacy property, not a privacy policy.** See below.

## Security and trust

An incremental-reading plugin reads your knowledge base. Obsidian plugins are not sandboxed: they have filesystem and network access on the honor system.

This plugin takes the opposite stance and makes it checkable:

- No telemetry.
- A one-command reproducible build, so the shipped bundle matches the public source.
- A small, pinned, lockfile-committed dependency tree.

Your data never leaves your vault because the code cannot send it.

## Getting started

1. Open a markdown note or a PDF you want to read incrementally.
2. **Mark it as an IR topic** (`Alt+T`, or the file ⋯ menu on mobile).
3. **Start review** (`Alt+R`, the ribbon brain, or a click on the status bar). On a phone, tap the brain button in the corner.

If you have no topics yet, Start review opens a pane that says so — mark a note (`Alt+T`), then start review (`Alt+R`). It does not just flash “nothing due.”

A vault that already has IR material but nothing due today still says nothing is due.

## A review session

Review is one tab, not a popup that eats the rest of Obsidian.

The bar at the top shows **Due** or **Neural**, and how many cards are left in this pass. Extract or cloze while you are in that tab and the new card is queued **right after the current one** — you see it in this session, not the next time you press Alt+R.

Reading cards remember where you stopped (**Resumed from last time**, with **From the top** if you want that). The source sits beside the card; on a phone, **Source** lives on the session bar so it does not scroll away.

When the pass is finished, the tab stays on **Session complete**. Alt+R starts whatever is still due; Escape or Close leaves.

Success (extract, cloze, dismiss, undo) flashes a line in the review dock. Failures still toast.

If an extract's source has moved or disappeared, the card shows **Re-anchor / Detach / Open source** instead of hiding the problem in a menu.

## Extracts and notes

Two kinds of extract; the menus say this in those words:

- **Anchored extract** (default): a highlight in the source. No new file.
- **Standalone note**: a new markdown file. Turn on **Settings → Extract to standalone note**, or one-shot with `Alt+Shift+X`. `Alt+Shift+P` promotes an anchored extract later.

Only that default extract path skips a new file. Cloze items always get their own notes. Creating a cloze (`Alt+Z` or **Cloze** in review) offers an optional hint on a short inline bar — Enter confirms (empty = no hint), Escape cancels.

Deletions use Anki-compatible markup: `{{c1::hidden text}}` or `{{c1::hidden text::hint}}`.

If you run Extract or Cloze from **Reading view** and the selection cannot be mapped onto the markdown, the note switches to **Edit** and keeps the selection when it can.

If you delete a source note in Obsidian, the extracts stay and you get one prompt: make them notes, keep them as review cards only, or undo (tree unchanged). The same prompt appears on the next launch if the note vanished while Obsidian was closed. After you choose, a short Undo is offered.

If you restore that note, you are asked whether to attach the highlights again. Nothing is attached behind your back.

## Neural review

**Go neural** (`Alt+N`) is a second kind of session, not a replacement for today's due queue. It starts from the card you are reviewing, or from the IR note you have open — something already in IR. From a row in the element tree, use that row's menu. It then walks related material (children, wikilinks, tags). Grading still counts.

A muted line on the card says why it is here: `via wikilink ← Foo`, `via child of Bar`, or `via tag #dogs`. Escape (when you are not editing) ends the neural pass and offers **Start outstanding (Alt+R)** instead of closing the tab.

## The tree, the status bar, the log

The **IR element tree** (`Alt+I`) is a keyboard home: `j`/`k` or arrows move, Enter opens or jumps review, `o` opens the note, `p` edits priority, `d` dismisses, `m` postpones, Space folds. Click a row to find it in an open review (or open the note); double-click always opens the note. The card you are reviewing keeps a **reviewing** chip.

The **status bar** shows `due · postponed · +inflow/7d`. Click it to start review; right-click (or long-press) for the IR menu. **Stats** (`Alt+S`) refresh those counts when you open them. The **session log** (`Alt+L`) is this review pass — stamped when you actually start Alt+R or Alt+N — not everything since the plugin loaded. Click a row to jump that card or open the note.

The left ribbon has one IR icon: **Start IR review**. Everything else is in the command palette, the status-bar menu, or the tree.

## Keyboard

The SuperMemo-adjacent commands have default `Alt+…` bindings. Rebind or clear them under Settings → Hotkeys. Other IR commands (resume last read, undo last grade, split cloze, extract paragraph / heading / bulk) have no default — assign one there if you want it.

| | |
|---|---|
| `Alt+T` | Mark the current note or PDF as an IR topic |
| `Alt+R` | Start review (today's due queue) |
| `Alt+N` | Go neural (from something already in IR) |
| `Alt+X` | Extract selection (anchored, unless the setting is on). In a PDF, uses the viewer text selection. |
| `Alt+Shift+X` | Extract once to a standalone note |
| `Alt+Shift+P` | Promote the current anchored extract |
| `Alt+Z` | Cloze selection (optional hint) |
| `Alt+Shift+Z` | New cloze card (separate item from selection) |
| `Alt+I` | Open the IR element tree |
| `Alt+L` | Open this review's session log |
| `Alt+S` | Stats |
| `Alt+P` | Set priority (opens the tree editor when it can) |
| `Alt+M` | Postpone overload (mercy) |
| `Alt+D` | Dismiss or restore |
| `Alt+E` | Export items to Anki TSV |
| `Alt+B` | Import clipboard text as a topic |
| `Alt+Shift+U` | IR quick actions (radial wheel) |

In the **review tab:** `Space` / `Enter` advances a reading card. On a cloze, first `Space` reveals; after reveal, `Space` grades **Good** by default (Settings → Review → Space after cloze reveal). `[` is Previous, `L` / `D` later today / dismiss, `1`–`4` grade a revealed cloze, `Ctrl+Enter` (`Cmd+Enter` on macOS) is Next while the reading editor is focused. Escape closes a finished pass, or ends neural and offers outstanding due.

Already-clozed spans paint on the source (green underline) next to extract highlights (yellow), in the editor, reading view, and review source column. The source file is not rewritten.

## Mobile

On a phone, a **brain FAB** stays visible (file explorer included). It opens the same radial wheel, with **Start IR review** and **Open IR element tree** on the ring — including during a session. **Go neural** is on the ring while you are reviewing, or when the open note is already in IR. The note ⋯ menu still has the full command set.

In review, the dock keeps the primary actions (**Extract**, **Cloze**, **Next** / **Show answer** / grades). **⋯** is the rest for that card, not a fixed list: reading cards put Edit, Previous, Later today, and Dismiss there; an unrevealed cloze only has Previous; after the answer is showing, Previous, Edit, Dismiss, and Undo last grade. Priority and A-Factor collapse to a chip you tap to edit. Swipe the card to navigate and grade; a one-time legend explains the directions.

Pin these on the **mobile editor toolbar** (Settings → Mobile → Configure mobile toolbar) if you extract from the editor:

1. Extract selection
2. Cloze to IR item
3. Start IR review
4. IR quick actions
5. Mark note as IR topic

## Settings

Settings are grouped the way the work is: **Review**, **Extracts**, **Topics**, **Overload**, **Anki export**, **Danger zone**. **Restore defaults** at the top puts every control back to a new vault's values without touching notes or review history. Review includes how many items sit between reading cards, interleave, the scheduler divergence picker, and **Space after cloze reveal** (default Good). Overload is the daily ceiling and priority cutoff for postpone. Extracts includes what happens when a source note is deleted (make orphan highlights into notes, or keep them as cards only). Danger zone can reset IR state (keep notes) or trash every IR note.

## Roadmap

**Shipped through 0.6.13** — the daily loop: topics, anchored extracts and standalone notes, clozes with hints, interleaved due review, neural as a mode, a live session that keeps new extracts, a tree you can drive from the keyboard, postpone, status/stats/session log, mobile FAB (Start review stays on the ring mid-session), a prompt when a source note is gone or comes back, and Restore defaults in Settings.

PDF topics and extracts (Alt+T / Alt+X in the built-in viewer). Review splits the PDF beside the card and focuses it; extracts paint as yellow highlights on the text layer. Cloze stays markdown-only: extract first, then cloze the extract. Scanned PDFs with no text layer cannot be extracted. After a cloze reveal, Space grades Good by default; already-clozed spans paint on the source.

### Stretch

- [x] **PDF support.** Selection to extract from a PDF, with page references preserved. (Text-layer PDFs; no OCR / snapshots / page-split in v1.)
- [ ] **Image occlusion** for visual cards.
- [ ] **Browser extension** for one-click import of web pages into the IR queue.
- [ ] **Full mobile parity.** The plugin is already mobile-eligible; remaining work is whatever a real device still gets wrong, especially on very small screens.

### Under consideration

- **SuperMemo-direction export.** A one-way dump of the tree SuperMemo could import. Scheduling would not transfer (FSRS and SM-15/17/18 do not share parameters). Open an issue if that would matter to you.

### Not planned

- Reimplementing the proprietary SM-15/17/18 algorithm. FSRS is good enough.
- Importing `.kno` SuperMemo collection files. Revisit if demand is high.

The data model and the reasoning behind it are in [`docs/DESIGN.md`](docs/DESIGN.md).

## Installation

**Beta (BRAT):** Testers install from **[GitHub Releases](https://github.com/RecursiveFunctions/obsidian-incremental-reading/releases)**. Each version tag builds `main.js`, `manifest.json`, and `styles.css` and attaches them to that release. BRAT downloads those files. Installing from a random branch ZIP will not work — `main.js` is not in git.

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) from Community Plugins and enable it.
2. *Settings → BRAT → Add Beta plugin* → repository: **`RecursiveFunctions/obsidian-incremental-reading`**.
3. Install the **latest matching release**. If a tag was just pushed, wait until the **Release** workflow is green, then update in BRAT.
4. Enable **Incremental Reading** under Community Plugins.

Treat this as alpha: dogfooded in a real vault, mobile is much better than it was but not finished, and the store format may still change. Back up a vault you care about.

If BRAT reports a missing **`main.js`**, the [Releases](https://github.com/RecursiveFunctions/obsidian-incremental-reading/releases) page for that version must list those three files.

**Stable:** From the Obsidian Community Plugins directory after the plugin meets submission requirements.

## Development

Requirements: Node.js 20 or newer, and a throwaway Obsidian vault.

```bash
git clone https://github.com/RecursiveFunctions/obsidian-incremental-reading
cd obsidian-incremental-reading
npm install
npm run dev          # builds and watches; writes main.js next to manifest.json
```

Load it by symlinking the project into `<your-vault>/.obsidian/plugins/incremental-reading/`, then enable it under Settings → Community Plugins.

```bash
# from inside your test vault:
mkdir -p .obsidian/plugins
ln -s /absolute/path/to/obsidian-incremental-reading .obsidian/plugins/incremental-reading
```

`npm run build` is a one-shot production build with type-checking. `npm test` is the headless suite. It does not cover the live review surface, hotkeys, or `processFrontMatter` against the real app.

Release mechanics (BRAT, tags, repair) are in [`docs/RELEASE.md`](docs/RELEASE.md).

## Contributing

The project is early. Design discussion, bug reports, code, docs, and testing in your own vault all help.

Open an issue before sending a PR for a new feature. The plugin stays close to SuperMemo's IR model instead of inventing parallel mechanics, so aligning on approach early saves rework.

## Acknowledgments

- [Piotr Wozniak](https://supermemo.guru) for inventing incremental reading and writing about it for decades.
- The [FSRS team](https://github.com/open-spaced-repetition), in particular Jarrett Ye, for an open-source scheduler in SuperMemo's lineage.
- The [Obsidian sample plugin](https://github.com/obsidianmd/obsidian-sample-plugin) and community developers whose code taught me the API.

## License

[MIT](LICENSE). Fully open source, every feature free, no paid tier, no telemetry, no server, and a build you can reproduce. There is no future version where the core is gated.
