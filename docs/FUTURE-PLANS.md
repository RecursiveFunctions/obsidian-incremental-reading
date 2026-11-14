# Future plans (SuperMemo parity and beyond)

Living plan for features not yet shipped. This is not a commitment order or
a release schedule. For what is already released, see the README roadmap and
`CHANGELOG.md`. For locked architecture, see `DESIGN.md`.

## Explicitly not planned

- **SuperMemo Plan** (day planner / tasklists as a subsystem). Use Obsidian
  tasks, calendar, or daily notes for life scheduling; IR stays the review
  queue.
- **Sleep, circadian, and auto-sleep** subsystems. Overload is handled with
  Mercy, postpone, dismiss, and priority protection instead.
- **Propagating reference registry** like SuperMemo. Obsidian wikilinks,
  backlinks, and transclusion are the reference layer.
- **Reimplementing SM-15/17/18** as schedulers. FSRS is the recall engine;
  the divergence picker is expert tooling, not a second product.

## Near-term product roadmap (README order)

These stay the current execution focus before large new subsystems:

1. Community directory submission (likely plugin id / name change + BRAT note).
2. Full mobile parity on real devices.
3. Stats: calendar heatmap and retention trend.
4. Browser extension for one-click web import (separate artifact; writes into
   the vault).

## High priority — review sessions and scheduling UX

### Semantic review (branch, subset, search)

**Goal:** SuperMemo’s “review a part of the collection” without copying SM’s
exact UI if something vault-native works better.

**Directions to explore (not final design):**

- **Branch session:** start from a topic or extract → queue only descendants
  (reading + items), optional “due only” vs “include not yet due.”
- **Subset session:** multi-select in Collection → run a pass on that set
  (similar to neural, but user-chosen, not graph-walk).
- **Search session:** Obsidian search hits (or a saved query) → filter to IR
  elements whose notes match → review pass.

**Implementation note:** Likely reuses the same review leaf and session
builder as neural/due queue, with a different **eligibility filter** and
provenance line (“via branch”, “via subset”, “via search”). No second modal
review surface.

### Early review tools (Advance, add to outstanding)

**Goal:** SM Vital options users recognize — pull work forward without lying
to FSRS or faking a repetition.

**To define precisely before coding:**

- **Advance** (items): reschedule earlier with explicit semantics (FSRS-safe
  vs “display-only for today”).
- **Add to today’s pass** (topics/extracts/items): inject into the current
  session or today’s outstanding set without counting as Mercy/postpone/review.

Ship only after each operation’s ledger events and scheduler interaction are
specified in tests.

## Incremental video and audio

### Privacy and network (common sense)

The plugin’s **privacy promise** is: **no telemetry, no third-party analytics,
no hidden phone-home in the shipped bundle**, and a **verifiable** build (see
`SECURITY.md`). Most of the app works **fully offline** on local vault files.

**Streaming sources (YouTube, podcasts, etc.) necessarily use the network when
you use them** — that is not a contradiction. The user (or Obsidian’s embed)
loads the stream; the plugin does not need to exfiltrate vault data to do IR
on a timestamped extract. **Local media** (files in the vault or attachments)
stays offline-capable.

Today’s **zero-network gate** on `main.js` reflects the **current** codebase.
Future media features may add **optional, user-initiated** network paths for
streaming; those should stay explicit (open URL / embed), never background.

### Who owns playback and seeking?

| Owner | Pros | Cons |
|-------|------|------|
| **Obsidian native embed** (`![[file]]`, markdown embeds) | Theme-consistent, mobile/desktop parity, less code | Seek API limited; per-format quirks; hard to sync highlight ↔ timecode tightly |
| **Custom `ItemView` / leaf with HTML5 `<video>` / `<audio>`** | Full control of currentTime, side-by-side layout, keyboard | Must maintain players, mobile layout, large files, codec support |
| **External app / system player** (open at timestamp) | Simplest; SM often feels clunky here | Breaks flow; poor “incremental reading in one pane” |

**Recommendation:** **Custom review/source column player for IR sessions** on
desktop and tablet, with **fallback** to “open attachment at bookmark” when
the host cannot embed (or on mobile if a dedicated player is not ready).
Reuse the same **reading-mode split** as markdown topics: card + source column,
not a modal.

**Seeking:** Ledger stores **bookmark time** (seconds or ms) per topic; review
restores `currentTime` on enter; extract creation records **start/end** (or
start + duration) on the anchor. Keyboard: same family as reading (space,
advance, later today) plus optional ±N s jumps.

### Data model (recommendation)

Align with PDF and markdown: **do not invent a new scheduling species** unless
forced.

- **Topic:** vault path to media file *or* a structured “stream descriptor”
  note (YouTube URL, podcast feed entry) that the UI knows how to open.
- **Extract:** ledger element with **anchor** carrying:
  - `sourcePath` (file) or `streamId` + platform metadata (URL, stable id)
  - `timeRange: { start, end }` (and optional `quote` / label)
  - `bookmark` for resume position on the **topic** (reuse bookmark machinery)
- **Items:** unchanged (clozes from transcript text in extract note or
  ledger-held text).

Optional **stream descriptor** frontmatter or a small JSON block in the topic
note keeps streams auditable in git; the ledger remains authoritative for
schedule and lineage.

### Review UX target

**Side-by-side player + extract**, like reading mode — goal is to be **clearer
and faster than SuperMemo’s media readers**, not to copy SM’s chrome:

- One review leaf; source column shows player + transcript/extract list;
- Active extract highlighted on timeline (chapters / markers);
- Extract and cloze from selection without leaving the pass;
- Resume banner (“continue at 12:34”) like reading topics.

### Phased delivery (“scope ladder”)

Phases are **incremental ship targets**, not separate products:

1. **Local files only** — `mp4` / `mp3` / `m4a` in vault; topic + timestamp
   extracts; bookmarks; side-by-side review.
2. **Hosted embeds** — YouTube (and similar) via Obsidian/embed or controlled
   iframe in the IR source column; anchors store URL + time range; network only
   when playing.
3. **Import pipeline** — extension or companion writes local copies or
   descriptor notes; optional duplicate-source detection on import.

Out of scope for the plugin: bundled **yt-dlp** or circumvention tools; users
who want offline YouTube use their own downloader.

### How competitors roughly handle media

| Product | Playback | Anchors | Offline |
|---------|----------|---------|---------|
| **SuperMemo** | Built-in readers per format; long history of quirks | Timestamp + extract tree | Mixed; often local collection |
| **EtchMind / Incremento** (standalone) | Native players; video/audio as first-class | Timestamp endpoints, extract cards | Local-first; streams where supported |
| **Obsidian IR plugins (Syro, etc.)** | Usually markdown/PDF-first; limited media IR | Varies | Vault-local |
| **This plugin (target)** | IR review column player + embed fallback | Ledger anchors like PDF | Local files offline; streams when user plays |

## Items, clozes, and “duplicate element” (clarification)

SuperMemo users often **duplicate** an extract or item to make **another cloze
or another card from the same passage** without losing lineage.

**Planned direction (needs design pass):**

- **Duplicate as sibling item** under the same extract (or topic): new element
  id, copy body or selected cloze variant, inherit priority parent policy.
- **Split clozes** into separate notes (partially exists via commands) made
  discoverable and tree-visible.

**Not committed:** per-cloze **independent FSRS state inside one markdown
note** (Anki-style `c1`/`c2` scheduling per field). That is a large model change;
duplicate/sibling items are the likely first step.

## Formats and import

| Area | Intent | Priority |
|------|--------|----------|
| **SuperMemo collection import** | One-way import of collection/knowledge tree; scheduling will not map 1:1 to FSRS | **Want** — spec SM versions and failure modes |
| **Duplicate-source on import** | Detect same URL/file/RSS item before creating a second topic | **Want** |
| **EPUB** | First-class or “convert to managed copy” like competitors | Explore |
| **PowerPoint / OneNote** | Plausible if import path exists (export → markdown/html) | Explore with evidence |
| **Mail** | Only if users ask with examples | **Skeptical** — need evidence |
| **Browser / RSS import** | Extension writing into vault | Near-term (README) |

## Scheduling, Queue & Import Refinements

Planned workflow and fidelity improvements across queue management, collection import, and diagnostics:

1. **Multi-Factor Mercy & Postpone:**
   - Score due overflow across five weighted dimensions (*Importance*, *Lateness*, *Easiness*, *Investment*, *Recency*, plus scoring *Mode*) alongside a typical-interval baseline curve.
   - Wire the 5 dimension weights and scoring mode into `src/ir/mercy.ts`, the Mercy preview modal (`src/ir/mercy-modal.ts`), and plugin settings (`src/settings.ts`).
   - Track total vs. recent postpone counts (resetting recent postpones on a graded review) so advanced postpone policies do not permanently lock out older elements.
2. **Rich-Content Collection Import:**
   - Decode HTML and image component records to import full formatted bodies and attached media rather than falling back to plaintext titles.
   - Synthesize Q&A and cloze items from multi-component records by inspecting question/answer display flags.
   - Distinguish **Extracts vs. Topics** on import via source-article provenance and extraction timestamps, and restore reading caret/scroll bookmarks into `.ir/` ledger bookmarks.
   - Handle variable-stride record resynchronization when scanning component streams with surplus bytes.
3. **Multi-Scheduler Divergence Ensemble:**
   - Expand `src/ir/grade-divergence.ts` beyond FSRS-6 vs. SM-2 by adding a power-law DSR shadow scheduler with priority-scaled initial intervals and bounded interval clamping.
4. **Dynamic Neural Review & Queue Diagnostics:**
   - Support incremental spreading-activation expansion when the active neural queue runs low, plus optional due-today filtering.
   - Add a randomization probability curve preview in Settings and multi-criteria leech filtering in Stats.
   - Ground Incremental Video/Audio bookmark anchors in `resume / start / stop` timestamp event semantics and check incoming URLs for duplicates on import.

## Stats and analytics (lower priority)

- Calendar heatmap and retention trend (README near-term).
- Leech detection, branch-level FSRS parameters, richer learning diagnostics —
  **later**, after core sessions and media MVP.

## Under consideration (unchanged)

- One-way **export** toward something SuperMemo could import (structure only;
  scheduling does not transfer).

## Design doc alignment

`DESIGN.md` records what shipped in v1. **Direction** for video/audio and
other post-v1 work lives here until a feature ships and `DESIGN.md` is updated
in the release that adds it.
