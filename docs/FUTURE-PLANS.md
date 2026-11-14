# Roadmap

Single authoritative roadmap for **Incremental Reading for Obsidian**. For full release history see [`CHANGELOG.md`](../CHANGELOG.md); for architectural invariants see [`DESIGN.md`](DESIGN.md).

---

## 1. Shipped Baseline (Through `v0.13.0`)

- **Core Domain & Vault Storage:** Append-only `.ir/` event ledger, block-anchored extracts (with one-key standalone note promotion), Markdown clozes with hints, text-layer PDF topics and extracts, Ctrl multi-span extracts, and PDF/image region crops with interactive image occlusion (`ir-occlusion`).
- **5-Dimension Mercy & Postpone (`v0.13.0`):** Due overflow scored across five configurable dimensions (*Importance*, *Lateness*, *Easiness*, *Investment*, *Recency*) against a 400-point baseline interval-growth curve; interactive `Alt+M` preview modal with live sliders; separate `totalPostponeCount` and `recentPostponeCount` tracking (resetting `recentPostponeCount` upon review so older items are never permanently starved).
- **Schedulers & 3-Model Divergence (`v0.13.0`):** FSRS-6 primary recall engine with local parameter optimizer; post-grade Divergence Picker comparing `FSRS-6`, power-law `DSR`, and `SM-2`; and priority-scaled first topic intervals (`[1, 44530]`-day clamp).
- **Queue & Overload Controls:** Deterministic priority queue policies (`Strict`, `Balanced`, `Discovery`), item/reading jitter, daily ceiling, priority cutoff, startup auto-postpone, and full undo for grades, Mercy batches, Later today, and Dismiss.
- **Views & Mobile:** Collection view (`Alt+I`) with global Priority and nested Sources trees, Stats view (`Alt+S`) with 7-day forecast and retention, Session log (`Alt+L`), Help panel (`Alt+H`), and mobile capture/review FAB with bottom navigation.

---

## 2. Phase 1 — Rich Collection Import & Duplicate Guards (Immediate Priority)

Unblock full-fidelity desktop collection migration (solving the v0 plaintext/title-only limitations) and prevent duplicate topic creation during capture.

### 2.1 Rich-Content Collection Import
- **Component Stream Decoding (`compon` records):**
  - Decode rich HTML (`Type 13` / `0x1c`-byte buffer at text slot `+0x11`) and attached image (`Type 2`) component records by resolving registry member paths and filespace slots into clean Markdown notes and vault attachments instead of falling back to plaintext registry titles.
  - Use byte-level resynchronization (`stride = 1`) when scanning component streams so records with under-reported `body_length` do not swallow subsequent valid records.
- **Question / Answer & Cloze Synthesis (`DisplayAt` bitmask):**
  - Inspect the component `DisplayAt` bitmask (`+0x08`) on multi-component items (`[13, 13]` or `[0, 0]`): components with `0xff` render on Question + Answer, while components with `0xd7` / `0xdf` (clearing bit `0x20`) render on Answer only. Automatically synthesize `{{c1::...}}` clozes or Q&A splits.
- **Extract vs. Topic Provenance & Lineage:**
  - Distinguish **Extracts** from root **Topics** during import using `source_article` (`+0x5d`) and `extraction_date` (`+0x4d`) metadata (non-zero if and only if extracted from a parent source), preserving parent-child lineage and concept-group affiliation (`+0x41`).
  - Preserve floating-point priority percentiles from `priority.sub` (`projectRelativePriorities`) rather than rounding to integers so collections with `>100` elements do not suffer tie-breaking order loss.
- **Read-Point Caret & Scroll Bookmark Recovery:**
  - Decode the 43-byte `element_parameters` block (`read_point_start`, `read_point_length`, `read_point_component`, `read_point_scroll_top`) and map reading carets directly into `.ir/` ledger bookmarks.

### 2.2 Duplicate-Source Detection & Additional Formats
- **Duplicate URL / Source Guard on Import:**
  - Before minting a new topic from clipboard/web capture or bulk import, normalize incoming URLs and content hashes against existing vault/ledger topics and offer to jump to the existing topic or append as a new extract.
- **EPUB & Document Import:**
  - Explore managed-copy Markdown conversion for EPUB and structured document exports.

---

## 3. Phase 2 — Review Session Modes, Final Drill & Queue Diagnostics

Bring high-leverage session mechanics and visual calibration tools into the existing single-leaf review and stats surfaces.

### 3.1 Final Drill & Early Review Tools
- **In-Session Final Drill Queue (`drill` parity):**
  - Track items graded below threshold (`Again` / lapsed or explicitly flagged during the pass) in a dedicated end-of-session **Final Drill** stage that cycles until every item achieves a passing recall grade, without mutating long-term FSRS stability after the first graded exposure of the day.
- **Semantic Review Passes (Branch, Subset, Search):**
  - **Branch session:** Start from any topic or extract in Collection (`Alt+I`) and queue only its descendant tree (reading + items), with an eligibility toggle for *Due only* vs. *Include unscheduled / not-yet-due*.
  - **Subset & Search sessions:** Multi-select rows in Collection or pipe an Obsidian search query into a focused review pass using the standard review leaf and provenance badge (`via branch`, `via subset`, `via search`).
- **Advance & Add to Outstanding:**
  - **Advance:** Pull future items forward safely (recomputing elapsed retrievability `R` honestly at review time).
  - **Add to today's pass:** Inject selected topics, extracts, or items into today's active queue without recording a synthetic review or altering Mercy/postpone counters.
- **Duplicate / Sibling Item Workflow:**
  - Add a one-key command to duplicate an extract or item as a sibling under the same parent so users can formulate multiple clozes or variations from the same passage while preserving lineage and priority inheritance.

### 3.2 Dynamic Neural Review (`Alt+N`)
- **Incremental Spreading-Activation Expansion:**
  - Upgrade Neural Review from a static upfront 3-layer BFS walk to dynamic spreading activation: re-seed activation from the element just reviewed/graded and expand deeper graph layers incrementally using bounded per-step budgets (`15` then `30` nodes) whenever the active neural queue drops below threshold.
  - Add an optional **Due-today filter** inside Neural sessions so users can restrict graph exploration to overdue/due material when desired.

### 3.3 Queue Randomization Preview & Leech Manager
- **Queue Randomization Curve Preview:**
  - Add a compact visual probability-curve preview in Settings beside `itemJitter` / `readingJitter` (`Strict`, `Balanced`, `Discovery` presets) plotting the cumulative selection probability and `(position, 100 - priority)` stair-step curve.
- **Multi-Criteria Leech Diagnostics & Triage (`Stats` view):**
  - Expand `Stats` (`Alt+S`) with a dedicated **Leech & Lapses** panel filtering items by combined criteria (lapses vs. threshold, interval ceiling, forgetting index / retention rate, and difficulty/A-Factor), paired with one-click triage actions (**Dismiss**, **Reset / Forget**, **Rewrite / Split**, or **Duplicate as sibling item**).
  - Include the calendar review heatmap and rolling 30-day true retention trend.

---

## 4. Phase 3 — Incremental Video, Audio & Web Capture

### 4.1 Timestamp-Anchored Media IR
- **Resume / Start / Stop Event Model:**
  - Ground video and audio extracts in explicit `{ resume, start, stop }` timestamp anchors stored in the `.ir/` ledger.
  - **Topic:** Vault media file (`mp4`, `mp3`, `m4a`) or structured stream descriptor note (YouTube / podcast URL) with automatic resume-position bookmarking.
  - **Extract:** Ledger element carrying `timeRange: { start, end }`, parent media provenance, and optional transcript span.
- **Side-by-Side Review Player:**
  - Render media in the review source column alongside the extract/transcript pane, restoring `resume` on open, highlighting active extract ranges on the timeline, and supporting keyboard-driven timestamp extraction without leaving the review pass.
  - Maintain strict offline privacy (`SECURITY.md`): local media works 100% offline; hosted embeds connect only on explicit user playback, with zero background network calls in `main.js`.

### 4.2 Companion Web Capture & Directory Release
- **Browser Extension for One-Click Capture:**
  - Ship the companion browser extension that writes captured articles and selections directly into the vault as Markdown topics (keeping the plugin bundle 100% free of network code).
- **Community Directory Submission & Mobile Polish:**
  - Finalize plugin ID/name for the official Obsidian Community Plugins directory (with a seamless BRAT migration path) and complete real-device mobile layout refinements.

---

## 5. Explicitly Not Planned

- **Day-planner / tasklist subsystems:** Use Obsidian tasks, calendar, or daily notes for life scheduling; IR owns the reading and review queue.
- **Sleep / circadian tracking subsystems:** Overload is handled with 5-dimension Mercy, postpone, dismiss, and priority protection.
- **Propagating reference registry:** Obsidian wikilinks, backlinks, and transclusion are the reference layer.
- **Streaks or guilt mechanics:** Excluded in favor of honest 7-day load forecasts and true retention metrics.
- **AI card / exam generation, TTS, handwriting canvas, shared learning backends:** Competitor territory (FreeMemo exams, Piper TTS/canvas, Mycel API); conflicts with vault-native + offline focus (`SECURITY.md`, `DESIGN.md`).

---

## 6. Discord 2026-11 competitive notes (Incremental Learners)

Evidence from guild `1507281499508965476` (readable channels only; role-gated tool channels incomplete). Reorders emphasis within §§2–4; does not add phases. Full matrix: plan `1794636029312-obsidian-ir-discord-competitive-roadmap`.

### Ranked priorities (implement)

| Rank | Item | Phase / cite | Discord evidence |
|------|------|--------------|------------------|
| P0 | Duplicate URL/hash guards + HTML/image-rich import | §2.1–2.2 | Capture→hoard; Incremento snapshot demand |
| P0 | Browser extension one-click capture (network in extension only) | §4.2; `SECURITY.md` | Tab-Tinder / low-friction inbox |
| P0 | EPUB → managed Markdown topics | §2.2 | Increader/Piper/Incremento books-as-core; PDF reflow hate |
| P1 | Final Drill + branch/subset/search sessions | §3.1 | Overload without losing hard items |
| P1 | Leech triage + retention trends | §3.3 | “Graduate early” / bury low-value cards |
| P1 | Dynamic Neural Review (spreading activation) | §3.2 | ZK/linking desire; deepen Neural, no canvas |
| P2 | Timestamp video/audio extracts + review player | §4.1; vault-local / no `fetch` in `main.js` | FreeMemo YouTube clips; Incremento A/V asks |
| P2 | Community directory rename + mobile polish | §4.2 | Wrong-plugin linking; BRAT friction |
| P3 | Optional Easy-streak graduation / soft-bury → Dismiss (opt-in; append-only ledger; never graduate priority ≤ cutoff) | New small setting; aligns with §3.3 leech triage | `#general` Leitner-graduate wishlist |
| P3 | Multi-target PDF passage links **or** document multi-span extracts as the answer | `DESIGN.md` PDF anchors; multi-span already shipped | Incremento multi-position PDF ask |

### Defer / reject (from Discord + invariants)

| Idea | Verdict | Why |
|------|---------|-----|
| OCR for scanned PDFs | Defer | `DESIGN.md` out of early PDF scope; external OCR → MD → Alt+T |
| Increader-style annotation queue | Defer | Scheduled extracts already cover gradual card formation |
| Anki `.apkg` import | Defer | One-way TSV export + vault notes suffice (`DESIGN.md`) |
| AI exams / TTS / canvas / Mycel backend | Reject | See §5; wrong architecture for offline vault-native plugin |
| Kitchen-sink Plethora/Piper parity | Reject | Completeness praised then abandoned on bugs/lock-in |

### Constraints that stay binding

- `.ir/` ledger authoritative; never rewrite source notes for highlights (`DESIGN.md`).
- Zero network in plugin `main.js`; browser capture belongs in a companion extension (`SECURITY.md`).
- Cloze remains markdown-only (PDF → extract → cloze); Anki TSV still skips `ir-occlusion`.
