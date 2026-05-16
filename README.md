# Incremental Reading for Obsidian

> SuperMemo-style incremental reading and spaced repetition for Obsidian, built on FSRS.

**Status:** Pre-alpha. Repository scaffold only. No usable functionality yet. Built in the open from day one.

---

## What this is

Incremental reading (IR) is the technique of reading many sources in parallel, extracting the most important passages into smaller and smaller pieces, and reviewing those pieces on a spaced-repetition schedule. It was developed by Piotr Wozniak as part of [SuperMemo](https://supermemo.guru) and is, in the opinion of many practitioners, the most powerful learning workflow ever designed for dense text.

The problem: SuperMemo only runs on Windows, hasn't been meaningfully redesigned in years, and locks your knowledge inside a proprietary file format. Meanwhile, Obsidian has become the de-facto home for personal knowledge management — but its existing spaced-repetition plugins implement the basic 1990s SM-2 algorithm and don't model IR's element tree, extracts, or priority queue at all.

This plugin aims to close that gap: a faithful implementation of incremental reading inside Obsidian, with modern spaced-repetition scheduling, on top of plain Markdown notes that you own.

## How it works

The plugin is two layers:

1. **The IR workflow layer** — element tree, extracts, cloze deletions, priority slider, interleaved review-and-reading queue, dismissals, reading bookmarks. Built from scratch in TypeScript on top of Obsidian's plugin API. Models are documented openly by SuperMemo at [supermemo.guru](https://supermemo.guru); no reverse engineering required.
2. **The scheduling core** — [FSRS](https://github.com/open-spaced-repetition/free-spaced-repetition-scheduler) via the [`ts-fsrs`](https://github.com/open-spaced-repetition/ts-fsrs) package. FSRS is an open-source spaced-repetition algorithm in the same DSR (Difficulty / Stability / Retrievability) family as SuperMemo's SM-17/18, adopted by Anki as of v23.12. It's competitive with proprietary algorithms and the parameters are openly trained on real review data.

Your reading material and extracts live as ordinary Markdown notes in your vault. The plugin stores per-note metadata (priority, FSRS state, parent element, reading position) in note frontmatter so it round-trips through Git, Obsidian Sync, and any other Markdown tooling.

## Roadmap

### MVP (v0.1) — minimal but actually useful

The goal is the smallest plugin that delivers core IR value. If you'd like to help build any of these, open an issue first to coordinate.

- [ ] **Topic mark.** A command/ribbon action that marks the current note as an IR *topic* (reading source). Adds frontmatter: `ir-type: topic`, `ir-priority: <0-100>`, FSRS state fields.
- [ ] **Priority slider UI.** Set/adjust priority on any IR note.
- [ ] **Extract from selection.** Select text in a topic, run *Extract*. Creates a new child note containing just that text, with `ir-parent: <source>`, inherited priority, queued as a sub-topic.
- [ ] **Cloze from selection.** Select a span inside a topic/extract, run *Cloze*. Creates a child *item* note with the cloze deletion ready to review.
- [ ] **Review UI.** Modal or side panel showing the next due item with grade buttons (Again / Hard / Good / Easy mapping to FSRS grades 1–4). Updates FSRS state, schedules next review.
- [ ] **Interleaved queue.** Daily session: alternates due items (review queue) with topics surfaced by priority (reading queue). Configurable ratio.
- [ ] **Dismiss action.** Remove an element from the queue without deleting the note. Reversible.

### v0.2 — the things that make IR feel like IR

- [ ] **Reading bookmarks.** When you stop mid-topic, the next review of that topic resumes from where you stopped (highlighted line + scroll to position).
- [ ] **Element tree view.** A side panel showing the parent → extracts → clozes hierarchy for any element.
- [ ] **Bulk import.** Paste a long article or web URL; it becomes a topic in one step.
- [ ] **Statistics.** Daily reviews completed, retention rate, queue size, FSRS parameter optimization.

### Stretch — the genuinely hard ones

- [ ] **PDF support.** Selection → extract from a PDF, with page references preserved.
- [ ] **Image occlusion** for visual cards.
- [ ] **Browser extension** for one-click import of web pages into the IR queue.
- [ ] **Mobile support** (currently desktop-only — `isDesktopOnly: true` in manifest).

### Explicitly *not* on the roadmap

- Reimplementing the proprietary SM-15/17/18 algorithm. FSRS is good enough; the legal and time costs of reverse engineering aren't justified by the marginal scheduling improvement.
- Importing from `.kno` (SuperMemo collection) files. If demand is high we'll revisit, but it's a substantial side project on its own.

## Installation

Not yet installable. Once there's something to use:

- **Via [BRAT](https://github.com/TfTHacker/obsidian42-brat)** (Beta Reviewer's Auto-update Tool) once we ship a `v0.0.1` release.
- **From the Obsidian Community Plugins directory** once the plugin meets Obsidian's submission requirements.

## Development

Requirements:
- Node.js 20 or newer
- An Obsidian vault you don't mind testing against (a throwaway test vault is recommended)

```bash
git clone https://github.com/RecursiveFunctions/obsidian-incremental-reading
cd obsidian-incremental-reading
npm install
npm run dev          # builds and watches; produces main.js next to manifest.json
```

To load the in-development plugin into Obsidian, symlink or copy the project directory into `<your-vault>/.obsidian/plugins/incremental-reading/`, then enable it under Settings → Community Plugins.

```bash
# from inside your test vault:
mkdir -p .obsidian/plugins
ln -s /absolute/path/to/obsidian-incremental-reading .obsidian/plugins/incremental-reading
```

`npm run build` does a one-shot production build with type-checking.

## Contributing

The project is genuinely early, and contributions of any size are welcome — design discussion, bug reports, code, docs, plugin testing in your own vault. Some good first issues to come once the MVP scope is broken down further.

Before opening a PR for a new feature, please open an issue to discuss the design. The plugin has strong opinions about staying faithful to SuperMemo's IR model rather than inventing parallel mechanics, so it's worth aligning on approach early.

## Acknowledgments

- [Piotr Wozniak](https://supermemo.guru) for inventing incremental reading and decades of patient writing about how it works.
- The [FSRS team](https://github.com/open-spaced-repetition) — particularly Jarrett Ye — for an open-source scheduler in SuperMemo's intellectual lineage.
- The [Obsidian community plugin developers](https://github.com/obsidianmd/obsidian-sample-plugin) whose code I've read to learn the API.

## License

[MIT](LICENSE).
