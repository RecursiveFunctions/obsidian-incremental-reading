# Incremental Reading for Obsidian

SuperMemo-style incremental reading and spaced repetition for Obsidian, built on FSRS.

**Status:** Pre-alpha. Scaffold plus one working feature (topic mark). Not yet usable for real work.

## What this is

Incremental reading (IR) is a learning method. You read many sources in parallel. You pull the important passages out into smaller pieces. You review those pieces on a spaced-repetition schedule. Piotr Wozniak created it as part of [SuperMemo](https://supermemo.guru).

Two problems make IR hard to use today. SuperMemo runs only on Windows and stores your knowledge in a proprietary format. Obsidian is where many people keep their notes, but its spaced-repetition plugins use the 1990s SM-2 algorithm and do not model IR's element tree, extracts, or priority queue.

This plugin brings IR into Obsidian. It uses a modern scheduler and keeps everything in plain Markdown notes you own.

## How it works

The plugin has two layers.

The workflow layer covers the element tree, extracts, cloze deletions, the priority slider, the interleaved review-and-reading queue, dismissals, and reading bookmarks. It is written in TypeScript on Obsidian's plugin API. SuperMemo documents these models publicly at [supermemo.guru](https://supermemo.guru), so no reverse engineering is involved.

The scheduling layer is [FSRS](https://github.com/open-spaced-repetition/free-spaced-repetition-scheduler), used through the [`ts-fsrs`](https://github.com/open-spaced-repetition/ts-fsrs) package. FSRS is an open-source algorithm in the same Difficulty/Stability/Retrievability family as SuperMemo's SM-17 and SM-18. Anki adopted it in v23.12. Its parameters are trained on real review data.

Your reading material and extracts stay as ordinary Markdown notes. Per-note IR state (priority, FSRS fields, parent element, reading position) lives in frontmatter, so it round-trips through Git, Obsidian Sync, and other Markdown tools.

## Keyboard

Defaults follow SuperMemo:

- `Alt+X`: extract the selection into a child note.
- `Alt+Z`: cloze the selection into a review item.

Rebind or clear them under Settings, Hotkeys.

## Roadmap

### MVP (v0.1)

Smallest plugin that delivers real IR value. Open an issue before building any item so we can coordinate.

- [x] **Topic mark.** A command/ribbon action that marks the current note as an IR *topic* (reading source). Adds frontmatter: `ir-type: topic`, `ir-priority: <0-100>`, FSRS state fields.
- [ ] **Priority slider UI.** Set/adjust priority on any IR note.
- [x] **Extract from selection.** Select text in a topic, run *Extract*. Creates a new child note containing just that text, with `ir-parent: <source>`, inherited priority, queued as a sub-topic.
- [x] **Cloze from selection.** Select a span inside a topic/extract, run *Cloze*. Creates a child *item* note with the cloze deletion ready to review.
- [x] **Review UI.** Modal or side panel showing the next due item with grade buttons (Again / Hard / Good / Easy mapping to FSRS grades 1-4). Updates FSRS state, schedules next review.
- [ ] **Interleaved queue.** Daily session: alternates due items (review queue) with topics surfaced by priority (reading queue). Configurable ratio.
- [ ] **Dismiss action.** Remove an element from the queue without deleting the note. Reversible.

### v0.2

- [ ] **Reading bookmarks.** When you stop mid-topic, the next review of that topic resumes from where you stopped (highlighted line plus scroll to position).
- [ ] **Element tree view.** A side panel showing the parent, extracts, and clozes hierarchy for any element.
- [ ] **Bulk import.** Paste a long article or web URL; it becomes a topic in one step.
- [ ] **Statistics.** Daily reviews completed, retention rate, queue size, FSRS parameter optimization.

### Stretch

- [ ] **PDF support.** Selection to extract from a PDF, with page references preserved.
- [ ] **Image occlusion** for visual cards.
- [ ] **Browser extension** for one-click import of web pages into the IR queue.
- [ ] **Mobile support.** Currently desktop-only (`isDesktopOnly: true` in manifest).

### Not planned

- Reimplementing the proprietary SM-15/17/18 algorithm. FSRS is good enough. Reverse engineering it costs too much time and legal risk for a small scheduling gain.
- Importing `.kno` SuperMemo collection files. This is a large side project on its own. Revisit if demand is high.

## Installation

Not installable yet. When there is something to use:

- Via [BRAT](https://github.com/TfTHacker/obsidian42-brat) after the first `v0.0.1` release.
- From the Obsidian Community Plugins directory after the plugin meets submission requirements.

## Development

Requirements:
- Node.js 20 or newer
- A throwaway Obsidian vault to test against

```bash
git clone https://github.com/RecursiveFunctions/obsidian-incremental-reading
cd obsidian-incremental-reading
npm install
npm run dev          # builds and watches; writes main.js next to manifest.json
```

Load the in-development plugin by symlinking the project into `<your-vault>/.obsidian/plugins/incremental-reading/`, then enable it under Settings, Community Plugins.

```bash
# from inside your test vault:
mkdir -p .obsidian/plugins
ln -s /absolute/path/to/obsidian-incremental-reading .obsidian/plugins/incremental-reading
```

`npm run build` runs a one-shot production build with type-checking.

## Contributing

The project is early. Contributions of any size help: design discussion, bug reports, code, docs, testing in your own vault. Good first issues will come once the MVP scope is broken down further.

Open an issue before sending a PR for a new feature. The plugin stays close to SuperMemo's IR model instead of inventing parallel mechanics, so aligning on approach early saves rework.

## Acknowledgments

- [Piotr Wozniak](https://supermemo.guru) for inventing incremental reading and writing about it for decades.
- The [FSRS team](https://github.com/open-spaced-repetition), in particular Jarrett Ye, for an open-source scheduler in SuperMemo's lineage.
- The [Obsidian sample plugin](https://github.com/obsidianmd/obsidian-sample-plugin) and community developers whose code taught me the API.

## License

[MIT](LICENSE).
