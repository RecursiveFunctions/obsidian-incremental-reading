# Incremental reading in Obsidian: read in parallel, extract what matters, review on a spaced schedule

You probably have a pile of articles, notes, and PDFs you have meant to get through. The problem is not reading speed — it is that you read many things at once, the interesting passages get buried, and the parts worth remembering fade before you ever revisit them.

Incremental Reading for Obsidian is a complete incremental-reading workflow built for that situation. You mark your existing notes and PDFs as topics, read them from a single prioritized queue, extract the passages worth keeping as you go, turn durable knowledge into cloze and image-occlusion cards, and come back to everything on a spaced schedule — without leaving Obsidian.

## How a session looks

1. Open a markdown note or a PDF and mark it as a topic (`Alt+T`), or pick an explicit placement priority / evenly space a batch of folders and files from the side panel.
2. Start review (`Alt+R`, the ribbon icon, or a click on the status bar). Reading cards remember where you stopped, and the source note sits beside the card.
3. When a passage is worth keeping, extract it (`Alt+X`, or with an explicit priority for urgent passages). Extracts stay linked to their source, and you can build one extract from several spans across pages.
4. When a fact is worth remembering, cloze it (`Alt+Z`) or make an image-occlusion card from a figure. New cards join the current session right away.
5. Open Collection (`Alt+I`) to see the whole tree: every topic, the extracts cut from it, and the items cut from those extracts.

## Vault-native by design

The plugin is vault-native: your topics, extracts, and items live in your existing markdown files, in the places you already put them. There is no copied content library and no external database. The scheduling and review metadata the plugin needs to run — due dates, review history, anchors — is stored inside the vault under `.ir/`, so everything that belongs to your knowledge base stays in one place you can open, inspect, and move.

## Staying ahead of overload

The status bar shows three numbers at a glance: how many elements are due now, how many are currently postponed, and how many new elements landed in the last seven days. That third number tells you when you are importing faster than you can process.

When the queue runs away, Mercy (`Alt+M`) previews a fix before applying it: it keeps the work that matters most due today (a priority cutoff protects it), and spreads the lower-priority overflow across future days that have free capacity. Postponing is not reviewing — Mercy records no review and does not change FSRS stability or reading A-Factor, so the scheduler state stays exactly as your grades left it. The latest Mercy batch can be undone.

## What it does

- Element tree with source → extract → item lineage in Collection, plus inline numeric range filters, Spread Priorities, subset search-and-replace, Concept Groups, and two-way SuperMemo `.xml` / Q&A `.txt` / binary import & export
- Priority queue (0 to 100, lower is more important) with global and nested views, plus non-modal placement-priority panels for marking, bulk staging, and extracting
- Inherited Concept Groups and source citations (`ir_concept`, `ir_ref`) synced between YAML frontmatter and `.ir/`
- Mercy with load visibility: due, postponed, and seven-day inflow in the status bar
- Calm progressive disclosure across desktop, tablet, and phone (with an on-demand `Element Info (I)` forgetting-curve drawer, 4-tab Stats with a 3-year Workload Simulator, unified Mobile Hub FAB, and Touch Selection Bar)
- Markdown, PDF, EPUB/HTML, and local/streamed audio & video topics (`mp4`, `mp3`, timestamped clip extracts), plus cloze, typed Spell-Pad (`{{c1:=...}}`), multiple-choice (`ir-mcq`), sequence-ordering (`ir-order`), and rectangle/polygon image-occlusion cards
- SuperMemo 20 default item scheduling (5-model Algorithm Arena across `SM-2`, `SM-15`, `SM-19`, `SM-20`, and `FSRS`, optional `0–5` grading) alongside FSRS-6 with a local parameter optimizer that fits to your own review log, plus same-day Final Drill and spreading-activation Neural Review (`Alt+N`)
- Offline operation: no network calls in plugin code, no telemetry, one runtime dependency

## Honest limitations

- Alpha software. Expect breaking changes between updates.
- PDF support covers text-layer PDFs. Scanned PDFs with no text layer cannot be extracted.
- Cloze creation is limited to markdown: to cloze something from a PDF, extract the passage first, then cloze the extract.

## Links

- Repository and current installation instructions: [README](https://github.com/RecursiveFunctions/obsidian-incremental-reading)
- Bug reports and feedback: [GitHub Issues](https://github.com/RecursiveFunctions/obsidian-incremental-reading/issues)
