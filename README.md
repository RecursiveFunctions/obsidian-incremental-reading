# Incremental Reading for Obsidian

The full SuperMemo element tree in Obsidian: read sources, extract passages into a real source-to-extract-to-item hierarchy, and review it on a queue that interleaves reading and recall.

**Status:** Pre-release alpha. I'm testing it on my own vault. If you want to give it a try, treat everything as unstable until the first tagged release. The plugin is being rebuilt against the architecture in [`docs/DESIGN.md`](docs/DESIGN.md). This niche is briefly open and the work is moving fast.

## What this is

Incremental reading (IR) is a learning method from Piotr Wozniak's [SuperMemo](https://supermemo.guru). You read many sources in parallel, pull the important passages into progressively smaller pieces, and review those pieces on a spaced schedule.

Two things keep IR out of reach. SuperMemo is Windows-only and stores your knowledge in a proprietary format. Obsidian is where many people already keep their notes, but its spaced-repetition plugins are flashcard tools: they do not model IR's element tree, its extracts, or its priority queue. This plugin aims to bridge that gap by bringing the IR workflow itself to Obsidian.

## What makes this different from other plugins

1. **A faithful SuperMemo element tree.** Source to extract to extract to item, with a dedicated hierarchy view and a graph that stays clean instead of drowning in review scaffolding. No other Obsidian plugin models this; the only tool that does is Logseq-only and stalled.
2. **Principled postpone.** When the queue overloads it redistributes by priority and never tells the scheduler a card was reviewed when it was not. Overload handling that does not corrupt your scheduling data.
3. **A multi-scheduler divergence picker.** Default FSRS, FSRS optimized on your own review history, and classic SM-2 run in parallel; when they disagree enough about an interval you can see why and choose. Opt-in, off by default, out of the way otherwise.
4. **Developed with mobile in mind.** One thing I lamented about SuperMemo was the inability to use it on the go without some hacky workarounds. I intend to make this plugin feel good to use on both mobile and the desktop version.
5. **A privacy property, not a privacy policy.** See below.

## Security and trust

An incremental-reading plugin reads your entire knowledge base. That is exactly where "trust me" is not good enough. Obsidian's plugin model has no sandbox: every plugin runs with full filesystem and network access on the honor system, and 2026's real-world plugin-abuse campaigns showed how that ends.

This plugin takes the opposite stance and makes it checkable rather than promised:

- No telemetry.
- A one-command reproducible build, so the shipped bundle provably equals the public source.
- A minimal, fully pinned, lockfile-committed dependency tree.

Your data never leaves your vault because the code physically cannot send it. 

## How it works

The plugin has two layers.

The workflow layer is the element tree, extracts, cloze deletions, the priority queue, the interleaved review-and-reading session, postpone, and dismissals. SuperMemo documents these models publicly at [supermemo.guru](https://supermemo.guru).

The scheduling layer is [FSRS](https://github.com/open-spaced-repetition/free-spaced-repetition-scheduler), used through the [`ts-fsrs`](https://github.com/open-spaced-repetition/ts-fsrs) package. FSRS is an open-source scheduler in the same Difficulty/Stability/Retrievability family as SuperMemo's SM-17 and SM-18, with parameters trained on real review data.

State lives in a local store inside your vault, designed to survive multi-device Obsidian Sync without losing reviews. The data model and the reasoning behind it are in [`docs/DESIGN.md`](docs/DESIGN.md). None of it leaves your machine.

## Keyboard

Every IR command ships with a default `Alt+letter` binding. The full set:

- `Alt+X`: extract selection into a child note.
- `Alt+Z`: cloze selection into a review item.
- `Alt+R`: start a review session.
- `Alt+T`: mark current note as an IR topic.
- `Alt+P`: set IR priority of current element.
- `Alt+I`: open the IR element tree.
- `Alt+L`: open the IR session log.
- `Alt+S`: show IR stats.
- `Alt+M`: postpone overdue elements (mercy).
- `Alt+D`: dismiss or restore the current element.
- `Alt+E`: export IR items to Anki TSV.

Rebind or clear any of them under Settings, Hotkeys.

## Roadmap

### MVP (v0.1)

Smallest plugin that delivers real IR value. Open an issue before building any item so we can coordinate.

- [x] **Topic mark.** A command/ribbon action that marks the current note as an IR *topic* (reading source). Adds frontmatter: `ir-type: topic`, `ir-priority: <0-100>`, FSRS state fields.
- [x] **Priority slider UI.** Inline 0-100 priority control on every element in the review modal, plus a *Set IR priority of current element* command. Reordering the queue is part of the SuperMemo flow, so priority is editable wherever an element is shown.
- [x] **Extract from selection.** Select text in a topic, run *Extract*. Creates a new child note containing just that text, with `ir-parent: <source>`, inherited priority, queued as a sub-topic.
- [x] **Cloze from selection.** Select a span inside a topic/extract, run *Cloze*. Creates a child *item* note with the cloze deletion ready to review.
- [x] **Review UI.** Modal or side panel showing the next due item with grade buttons (Again / Hard / Good / Easy mapping to FSRS grades 1-4). Updates FSRS state, schedules next review.
- [x] **Interleaved queue.** Daily session: alternates due items (review queue) with topics surfaced by priority (reading queue). Configurable ratio.
- [x] **Dismiss action.** Remove an element from the queue without deleting the note. Reversible.

The v0.1 MVP is complete. State has since moved off frontmatter into the structured store described in [`docs/DESIGN.md`](docs/DESIGN.md); v0.2 builds on that substrate.

### v0.2 (shipped, current release 0.0.4)

- [x] **Reading bookmarks.** When you stop mid-topic, the next review of that topic resumes from where you stopped.
- [x] **Element tree view.** Side panel showing parent, extracts, and clozes for any element, with expand/collapse and a breadcrumb in the review pane.
- [x] **Bulk import.** Paste a long article; it becomes a topic in one step. Paste-only by design: the plugin never fetches a URL, because the zero-network privacy property is not negotiable for a one-off convenience.
- [x] **Statistics.** Daily reviews completed, retention rate, queue size.
- [x] **Anki TSV export.** One-way export of IR items into Anki's import format.
- [x] **Mercy / postpone.** Single command to redistribute an overloaded queue by priority without lying to the scheduler.
- [x] **Status-bar queue load.** Glanceable due / postponed / inflow counts at all times.
- [x] **Session audit log.** Per-session view of every item, extract, and source you touched.
- [x] **Multi-cloze on items.** Add more cloze deletions to an existing item in place.
- [x] **Auto-mark plain notes.** Optional setting: notes you start reviewing are promoted to topics automatically.
- [x] **Mobile surfaces.** Mark-as-topic, priority, dismiss, **start review, tree, session log, stats, mercy, and Anki export** are on the note file menu on mobile. Session/stats leaf polish and other small-screen UX remain.

### Now (toward v0.3)

Per the [UI commitments contract](docs/UI-COMMITMENTS.md), the modal-removal pass replaced Stats, Priority, and Review with workspace views / non-modal controls (see [`docs/SCOPE-MODAL-REMOVAL.md`](docs/SCOPE-MODAL-REMOVAL.md)). **Done:** stats leaf, status-bar priority prompt (fallback when a note has no store element), review `ItemView` with a **source column** for parent context (commitment #2), in-tree priority click-to-edit, **Alt+P** opens the tree and focuses that inline editor when the active note maps to an element.

### Stretch

- [ ] **PDF support.** Selection to extract from a PDF, with page references preserved.
- [ ] **Image occlusion** for visual cards.
- [ ] **Browser extension** for one-click import of web pages into the IR queue.
- [ ] **Full mobile parity.** Manifest already marks the plugin mobile-eligible (`isDesktopOnly: false`) and the bundle uses no Node-only APIs; remaining work includes session/stats leaves on very small screens and any gaps found in real-device testing.

### Under consideration

- **SuperMemo-direction export.** A one-way export of the IR tree (topics, extracts, cloze items, priorities) into a format SuperMemo can import: HTML topics with `[...]` markers for clozes, plus a Q&A item file per cloze. Scheduling state would not transfer (FSRS and SM-15/17/18 don't share parameters), so SM would re-schedule on import. Open an issue if this would matter to you so we can scope it.

### Not planned

- Reimplementing the proprietary SM-15/17/18 algorithm. FSRS is good enough. Reverse engineering it costs too much time and legal risk for a small scheduling gain.
- Importing `.kno` SuperMemo collection files. This is a large side project on its own. Revisit if demand is high.

## Installation

**Beta (BRAT):** current pre-release is `v0.0.6`, installable via [BRAT](https://github.com/TfTHacker/obsidian42-brat).

1. Install BRAT from Community Plugins and enable it.
2. *Settings -> BRAT -> Add Beta plugin*, paste `RecursiveFunctions/obsidian-incremental-reading`.
3. Enable *Incremental Reading* under Community Plugins.

Treat the beta as alpha-quality: I am dogfooding it in my own vault, mobile support is improved but not complete, and the store format may still change between releases. Back up before adding to a vault you care about.

**Stable:** From the Obsidian Community Plugins directory after the plugin meets submission requirements.

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

`npm test` runs the headless suite. It covers cloze offset math, FSRS round-trip, queue ordering, the structured store, mercy/postpone, tree and tree-action plans, bookmark math, bulk-import parsing, divergence picker config, anki-export, stats, and the extract/cloze/dismiss/topic-mark file flows against an in-memory fake of the Obsidian API. Not covered there, and still needing a real vault: the review surface itself, hotkeys, ribbons, and `processFrontMatter` against the live app.

## Contributing

The project is early. Contributions of any size help: design discussion, bug reports, code, docs, testing in your own vault. Good first issues will come once the MVP scope is broken down further.

Open an issue before sending a PR for a new feature. The plugin stays close to SuperMemo's IR model instead of inventing parallel mechanics, so aligning on approach early saves rework.

## Acknowledgments

- [Piotr Wozniak](https://supermemo.guru) for inventing incremental reading and writing about it for decades.
- The [FSRS team](https://github.com/open-spaced-repetition), in particular Jarrett Ye, for an open-source scheduler in SuperMemo's lineage.
- The [Obsidian sample plugin](https://github.com/obsidianmd/obsidian-sample-plugin) and community developers whose code taught me the API.

## License

[MIT](LICENSE). Concretely: fully open source, every feature free, no paid tier, no telemetry, no server, and a build you can reproduce and verify yourself. There is no future version of this where the core is gated.
