# Incremental Reading for Obsidian

The full SuperMemo element tree in Obsidian: read sources, extract passages into a real source-to-extract-to-item hierarchy, and review it on a queue that interleaves reading and recall. No network. No account. Nothing gated.

**Status:** Pre-release alpha. Not yet tested in a real vault; treat everything as unstable until the first tagged release. The plugin is being rebuilt against the architecture in [`docs/DESIGN.md`](docs/DESIGN.md). This niche is briefly open and the work is moving fast.

## What this is

Incremental reading (IR) is a learning method from Piotr Wozniak's [SuperMemo](https://supermemo.guru). You read many sources in parallel, pull the important passages into progressively smaller pieces, and review those pieces on a spaced schedule.

Two things keep IR out of reach. SuperMemo is Windows-only and stores your knowledge in a proprietary format. Obsidian is where many people already keep their notes, but its spaced-repetition plugins are flashcard tools: they do not model IR's element tree, its extracts, or its priority queue. This plugin is the missing piece, the IR workflow itself, native to Obsidian.

## What makes this different

The scheduler is not the pitch. FSRS, plain files, an open license, and cloze deletions are table stakes now; other tools have them. Three things are not available anywhere else in Obsidian:

1. **A faithful SuperMemo element tree.** Source to extract to extract to item, with a dedicated hierarchy view and a graph that stays clean instead of drowning in review scaffolding. No other Obsidian plugin models this; the only tool that does is Logseq-only and stalled.
2. **Principled postpone.** When the queue overloads it redistributes by priority and never tells the scheduler a card was reviewed when it was not. Overload handling that does not corrupt your scheduling data.
3. **A multi-scheduler divergence picker.** Default FSRS, FSRS optimized on your own review history, and classic SM-2 run in parallel; when they disagree enough about an interval you can see why and choose. Opt-in, off by default, out of the way otherwise.

And a fourth, which is the reason to trust the other three:

4. **A privacy property, not a privacy policy.** See below.

## Security and trust

An incremental-reading plugin reads your entire knowledge base. That is exactly where "trust me" is not good enough. Obsidian's plugin model has no sandbox: every plugin runs with full filesystem and network access on the honor system, and 2026's real-world plugin-abuse campaigns showed how that ends.

This plugin takes the opposite stance and makes it checkable rather than promised:

- Zero network calls. No telemetry, no license server, no account, enforced by the absence of any networking code in a `main.js` you can grep yourself.
- A one-command reproducible build, so the shipped bundle provably equals the public source.
- A minimal, fully pinned, lockfile-committed dependency tree.

Your data never leaves your vault because the code physically cannot send it. That is the difference between a privacy policy and a privacy property.

## How it works

The plugin has two layers.

The workflow layer is the element tree, extracts, cloze deletions, the priority queue, the interleaved review-and-reading session, postpone, and dismissals. SuperMemo documents these models publicly at [supermemo.guru](https://supermemo.guru), so no reverse engineering is involved.

The scheduling layer is [FSRS](https://github.com/open-spaced-repetition/free-spaced-repetition-scheduler), used through the [`ts-fsrs`](https://github.com/open-spaced-repetition/ts-fsrs) package. FSRS is an open-source scheduler in the same Difficulty/Stability/Retrievability family as SuperMemo's SM-17 and SM-18, with parameters trained on real review data.

State lives in a local store inside your vault, designed to survive multi-device Obsidian Sync without losing reviews. The data model and the reasoning behind it are in [`docs/DESIGN.md`](docs/DESIGN.md). None of it leaves your machine.

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
- [x] **Interleaved queue.** Daily session: alternates due items (review queue) with topics surfaced by priority (reading queue). Configurable ratio.
- [x] **Dismiss action.** Remove an element from the queue without deleting the note. Reversible.

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

`npm test` runs the headless suite. It covers cloze offset math, FSRS frontmatter round-trip, queue ordering, and the extract/cloze/dismiss/topic-mark file flows against an in-memory fake of the Obsidian API. Not covered there, and still needing a real vault: the review modal, hotkeys, ribbons, and `processFrontMatter` against the live app.

## Contributing

The project is early. Contributions of any size help: design discussion, bug reports, code, docs, testing in your own vault. Good first issues will come once the MVP scope is broken down further.

Open an issue before sending a PR for a new feature. The plugin stays close to SuperMemo's IR model instead of inventing parallel mechanics, so aligning on approach early saves rework.

## Acknowledgments

- [Piotr Wozniak](https://supermemo.guru) for inventing incremental reading and writing about it for decades.
- The [FSRS team](https://github.com/open-spaced-repetition), in particular Jarrett Ye, for an open-source scheduler in SuperMemo's lineage.
- The [Obsidian sample plugin](https://github.com/obsidianmd/obsidian-sample-plugin) and community developers whose code taught me the API.

## License

[MIT](LICENSE). Concretely: fully open source, every feature free, no paid tier, no telemetry, no server, and a build you can reproduce and verify yourself. There is no future version of this where the core is gated.
