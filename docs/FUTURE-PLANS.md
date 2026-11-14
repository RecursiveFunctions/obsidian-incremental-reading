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

**Discord 2026-11 urgency:** Low-friction capture without duplicate topics is the community’s loudest unmet need (“Tab Tinder” / “TikTok for reading” inbox → IR queue). Competitors already ship EPUB + offline HTML snapshots; we still clip via clipboard and lack managed EPUB. Raise §2.2 from explore-to-ship once import guards land.

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
  - Ship managed-copy Markdown conversion for EPUB (and structured document exports where cheap). DRM-locked EPUBs are out; document limitations in README. Prefer reflowable Markdown topics over “webpage → PDF” capture (community consensus against PDF as a web-archive format on mobile).

---

## 3. Phase 2 — Review Session Modes, Final Drill & Queue Diagnostics

Bring high-leverage session mechanics and visual calibration tools into the existing single-leaf review and stats surfaces.

**Discord 2026-11 urgency:** SM incrementalists want chaos→structure session tools (Final Drill, branch/subset passes) and workload triage (“graduate early” / bury low-value cards) without a second scheduler. Deepen Neural Review (ZK/linking desire) instead of chasing Piper-style canvas/TTS.

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
- **Optional Easy-streak graduation / soft-bury (Discord P3):**
  - Opt-in setting: after N consecutive Easy grades (or interval ≥ threshold), append a ledger event that Dismisses or marks `graduated`, reversible from Collection.
  - Does not rewrite FSRS history; never auto-graduates priority ≤ Mercy cutoff. Closes the `#general` Leitner-graduate ask without a second scheduler.

---

## 4. Phase 3 — Incremental Video, Audio & Web Capture

**Discord 2026-11 urgency:** FreeMemo already ships YouTube clip in/out + offline desktop; Incremento users ask for audio-range cuts and a media “Resource Shelf”; Incremento ships offline webpage snapshots + companion browser. Our media IR and browser extension must stay vault-local / companion-extension-only (`SECURITY.md`). Directory rename remains a submission blocker (wrong-plugin linking to `gpanakkal/incremental-reading-obsidian`).

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
  - Prefer HTML/Markdown snapshots over PDF archives; run URL/content-hash dedupe against §2.2 before minting topics.
  - Pull forward relative to older Phase 3 planning whenever Phase 1 import/guards are stable — capture friction is the community’s top funnel problem.
- **Community Directory Submission & Mobile Polish:**
  - Finalize plugin ID/name for the official Obsidian Community Plugins directory (with a seamless BRAT migration path) and complete real-device mobile layout refinements.
  - Rename still open in `#obsidian-ir` (collision with `gpanakkal/incremental-reading-obsidian`; users hit wrong Community Plugin links). Mobile polish is the stated BRAT→directory gate.

---

## 5. Explicitly Not Planned

- **Day-planner / tasklist subsystems:** Use Obsidian tasks, calendar, or daily notes for life scheduling; IR owns the reading and review queue.
- **Sleep / circadian tracking subsystems:** Overload is handled with 5-dimension Mercy, postpone, dismiss, and priority protection.
- **Propagating reference registry:** Obsidian wikilinks, backlinks, and transclusion are the reference layer.
- **Streaks or guilt mechanics:** Excluded in favor of honest 7-day load forecasts and true retention metrics.
- **AI card / exam generation:** FreeMemo exam/comprehension pipelines and Plethora-style AI quizzes are competitor territory; community distrust of LLM cards as a core wedge; not our product.
- **TTS, handwriting, infinite canvas:** Piper territory; breaks focus for a vault-native IR plugin.
- **Shared learning backend / Mycel-style API clients:** Conflicts with ledger-in-vault + zero-network `main.js` (`DESIGN.md`, `SECURITY.md`). Capture stays a filesystem-writing companion extension, not a remote learning service.
- **Kitchen-sink Plethora / Piper / FreeMemo parity:** Users praise completeness then abandon on bugs, lock-in, or disappearance (Incrementum → Plethora rename/DMCA churn). Prefer Phase 1–2 quality over feature dump.

---

## 6. Discord 2026-11 competitive notes (Incremental Learners)

Research pass over guild **Incremental Learners** (`1507281499508965476`), November 2026. Baseline product is **this plugin** (`RecursiveFunctions/obsidian-incremental-reading`), not PWA-alpha or SM20. Discord evidence **reorders emphasis inside §§2–4** and adds two small P3 items; it does not invent new phases.

Working plan with the full exec backlog: `sm20-re/.kilo/plans/1794636029312-obsidian-ir-discord-competitive-roadmap.md` (Plan Mode workspace path; implementation lands here).

### 6.1 Evidence scope & caveats

**Readable without role unlock:** `#start-here`, `#announcements`, `#general`, `#obsidian-ir`, `#freememo`, `#incremento-anki-addon`, `#increader`, `#mycelium`, `#foliole`, `#plethora-incrementum`.

**Role-gated (403 / onboarding opt-in — incomplete sample):** `#ir-obsidian`, `#incremental-writing-obsidian`, `#incremental-everything-remnote`, `#渐进阅读-ir-reader`, `#buboflash`, `#amber`, `#piper-and-quail`, `#etchmind`, and similar. For locked tools, treat product pages / announcements as secondary evidence only (Piper, Kioku, IR Reader, Amber). Do not treat Foliole / Plethora / ZKMemo as stable competitive targets without re-checking — Discord shows rename / DMCA / repo churn.

### 6.2 What the community wants (themes)

1. **Priority discipline / anti-hoarding** — Mental hoarding is the failure mode; Mercy, daily ceilings, and priority cutoffs are table stakes (we already differentiate here with 5-dim Mercy + preview).
2. **Low-friction capture** — “TikTok for reading” / Tab-Tinder inbox → IR queue (`#mycelium`, noscorpion): swipe/close/keep/save-to-reading-list with almost no ceremony, then sync into IR.
3. **True ownership** — Local files, open licensing, no dead-vendor lock-in. `#general` proprietary scare around Incremento → AGPL-3.0 move (tiruces); Plethora/Incrementum disappearance trauma (`#plethora-incrementum`). Our vault-native + offline + open-source posture is a moat — protect it.
4. **Cross-format reading** — Web, EPUB, PDF, YouTube/audio as first-class topics with extract → card lineage (Increader/Piper/Incremento treat books + media as core).
5. **Reflowable web snapshots** — HTML/Markdown snapshots preferred over “webpage → PDF”; PDFs hated for mobile/accessibility (Incremento offline snapshot + editable reading copies).
6. **Gradual card formation** — Annotation/scratchpad queue before forced cloze (Increader flavor, version467); do not force Anki-template decisions up front. We already schedule extracts as reading elements — deepen that path rather than a second annotation product.
7. **Mobile IR that works** — Ankrimento (Incremento-on-AnkiDroid + LAN sync) and FreeMemo offline desktop/flight demos prove demand; our mobile polish is still the directory-submit gate (`#obsidian-ir`).
8. **Interoperability** — Anki/other SRS export; parent/source context always visible (Incremento parent-context sidebar; we have Source column + Collection — polish mobile Source toggle).
9. **Media extracts** — YouTube clip in/out (FreeMemo), audio range cuts + resource shelf (Incremento `#incremento-anki-addon`, meenotek), multi-position PDF/passage links.
10. **Onboarding to IR concepts** — Tools alone are not enough; users ask where to learn the method (Help / docs, not a new subsystem).

### 6.3 Cross-tool pain points → relevance to us

| Pain | Where heard | Relevance to us |
|------|-------------|-----------------|
| Workload explosion from capturing everything | `#general`, Mycelium Tab-Tinder thread | Mercy/Dismiss already help; “early graduate” / bury low-value cards still requested → §3.3 graduation |
| Scanned / OCR PDFs (incl. Arabic scans) | Incremento / FreeMemo OCR talk | We explicitly lack OCR; `DESIGN.md` keeps OCR out of early PDF scope — suggest external OCR → MD → Alt+T |
| PDF used as web-capture format | Incremento | Prefer HTML/MD import + browser extension (§2.2, §4.2) |
| Proprietary lock-in / abandoned apps | Incremento license thread; Plethora gone → renamed | Keep vault-native + offline + OSS; never put learning state in a vendor DB |
| SM UI/UX drive-away | `#obsidian-ir` (Ray), Increader (version467) | UX/mobile polish > SuperMemo feature parity |
| Too many apps / fragmentation | Piper marketing; Mycel “shared backend” pitch | Stay vault-native; companion capture extension only — reject Mycel client |
| Naming collision with other Obsidian IR plugins | `#obsidian-ir` WrongPluginLinking.webm | Directory rename still planned (§4.2) |
| Bugs / polish over feature dump | Foliole, Plethora “too complete?” | Prefer shipping Phase 1–2 quality over kitchen-sink |

### 6.4 Competitor landscape (who outpaces us where today)

| Competitor | Strengths vs us | Do not chase |
|------------|-----------------|--------------|
| **FreeMemo** | YouTube clips, offline desktop install, TSV/export paths, AI exam pipelines, flight-offline demos | AI exams as core product; SaaS-shaped library |
| **Incremento** | EPUB/PDF/writing tabs, offline webpage snapshots, parent sidebar, precise passage links, companion browser, AGPL after lock-in pushback; Ankrimento mobile proof | Kitchen-sink Anki-addon parity inside Obsidian |
| **Increader** | Cross-platform reading (web/EPUB/PDF/MD), annotation scratchpad queue, “addictive” bookmark UX | Dual annotation-product workflow; we keep extract→item |
| **Piper** | Local-first library, transcript/TTS, canvas/notes | TTS, handwriting, infinite canvas |
| **Kioku** | Live + snapshot pages, Anki import, Android desktop naming confusion in `#general` | Proprietary stack; `.apkg` import sink |
| **IR Reader (渐进阅读)** | EPUB/web clip, local-first macOS/open project (announced) | Treat as peer local-first reader, not a feature checklist |
| **Mycel / Mycelium** | Shared learning backend + clients; Tab-Tinder capture fantasy adjacent | Backend API architecture — incompatible with `.ir/` + zero-network plugin |
| **Plethora / Incrementum** | Once “too complete” (PDF/EPUB/video/TTS/SRS); then repo vanish / rename / trust damage | Completeness theater; churn risk |
| **Foliole** | Obsidian-adjacent IR experiments | Unstable target; polish > parity |

### 6.5 Gap matrix vs Obsidian IR

| Capability | Us today | Who has it | Verdict |
|------------|----------|------------|---------|
| Topic→Extract→Item + priority Mercy | Strong (5-dim Mercy, FSRS/DSR/SM-2) | SM, Foliole, Incremento | **Keep / deepen** |
| Vault-native notes + no network in plugin | Unique moat (`SECURITY.md` gate) | — | **Protect** — never `fetch` in `main.js` |
| Neural / ZK-ish graph review | Neural via wikilinks/tags/children | Piper canvas; users say most IR apps lack ZK | **Keep / §3.2 dynamic Neural** |
| PDF text extracts + image occlusion | Shipped | Incremento, Foliole, Kioku | Parity OK; OCR still gap (defer) |
| EPUB | Planned (§2.2) | Increader, Piper, Incremento, Plethora | **Implement** |
| HTML/MD web snapshot import | Clipboard topic only | Incremento snapshots, Kioku live/snapshot | **Implement** (§2 + §4.2) |
| Browser companion capture | Planned §4.2 | Incremento companion, Piper | **Implement** (pull forward after §2) |
| YouTube / A/V timestamp extracts | Planned §4.1 | FreeMemo clips; Incremento A/V asks | **Implement** after Phase 1–2 |
| Annotation scratchpad queue | Extracts are scheduled reading elements | Increader | **Defer** — avoid dual workflows |
| AI quizzes / local+cloud AI | Not core | FreeMemo, Plethora | **Reject** |
| TTS / handwriting canvas | No | Piper | **Reject** |
| Anki `.apkg` import | TSV export only (skips `ir-occlusion`) | Kioku | **Defer** |
| Card graduation / soft-bury | Dismiss + Mercy | `#general` wishlist | **Small implement** (§3.3) |
| Parent-context during review | Source column + Collection | Incremento parent sidebar | **Parity OK**; polish mobile |
| Official community plugin listing | BRAT only | — | **Implement** (§4.2) |
| Shared learning backend | N/A | Mycel | **Reject** |

### 6.6 Ranked priorities (implement) — evidence & constraints

| Rank | Item | Phase / cite | Discord evidence | Why / constraint |
|------|------|--------------|------------------|------------------|
| P0 | Duplicate URL/hash guards + HTML/image-rich import | §2.1–2.2 | Capture→hoard; Incremento snapshot demand; FreeMemo library scale pressure | Makes web/SM migration trustworthy; stops duplicate topics |
| P0 | Browser extension one-click capture | §4.2; `SECURITY.md` | Tab-Tinder / “addictive IR inbox” (`#mycelium`) | Extension owns network; plugin only watches vault/ledger |
| P0 | EPUB → managed Markdown topics | §2.2 | Increader/Piper/Incremento books-as-core; PDF reflow hate | DRM out; default anchored extracts; standalone notes stay opt-in |
| P1 | Final Drill + branch/subset/search sessions | §3.1 | SM chaos→structure; overload without losing hard items | Ledger events; no FSRS stability mutation on drill regrades per §3.1 |
| P1 | Leech triage + retention trends | §3.3 | “Graduate early” / bury low-value cards | Stats panel + triage actions already specified |
| P1 | Dynamic Neural Review | §3.2 | ZK/linking desire; Neural is a rare IR differentiator | Spreading-activation budgets; no canvas |
| P2 | Timestamp video/audio extracts + review player | §4.1 | FreeMemo YouTube clips; Incremento audio-range + shelf asks | Vault-local media; embeds only on explicit playback |
| P2 | Community directory rename + mobile polish | §4.2 | WrongPluginLinking.webm; BRAT friction; Ankrimento proves mobile IR demand | Rename string still open |
| P3 | Optional Easy-streak graduation / soft-bury → Dismiss | §3.3 addendum | `#general` Leitner-graduate wishlist | Opt-in; append-only; never graduate priority ≤ cutoff |
| P3 | Multi-target PDF passage links **or** document multi-span as the answer | `DESIGN.md` PDF anchors | Incremento multi-position PDF ask | Multi-span extracts already shipped; only extend anchor model if needed |

### 6.7 Defer / reject (binding unless planning reopens)

| Idea | Verdict | Why |
|------|---------|-----|
| OCR for scanned PDFs | Defer | `DESIGN.md` out of early PDF scope; huge surface; external OCR → MD → Alt+T |
| Increader-style annotation queue | Defer | Scheduled extracts already cover gradual card formation |
| Anki `.apkg` import | Defer | One-way TSV export + vault notes suffice; import is a sink |
| AI exams / TTS / canvas / Mycel backend | Reject | §5; wrong architecture for offline vault-native plugin |
| Day planner / streaks / sleep tracking | Reject | Already §5 |
| Kitchen-sink Plethora/Piper parity | Reject | Completeness praised then abandoned on bugs/lock-in/DMCA |

### 6.8 Constraints that stay binding

- `.ir/` ledger is authoritative for scheduling, history, bookmarks, tombstones, anchors; frontmatter is migration/compat only (`DESIGN.md`).
- Never rewrite source notes to paint extract/cloze highlights (`DESIGN.md`).
- Zero network in plugin `main.js` — enforced by `scripts/check-zero-network.mjs` / CI (`SECURITY.md`). Browser capture belongs in a companion extension that writes files into the vault.
- Cloze remains markdown-only (PDF → extract → cloze). Scanned PDFs without a text layer cannot extract. Anki TSV export continues to skip `ir-occlusion` and report the count.
- Append-only ledger events for Mercy, Dismiss, graduation, drill; no silent scheduler rewrites.

### 6.9 Open questions (non-blocking)

- Exact community-plugin rename string (still soliciting in `#obsidian-ir`).
- Whether graduation is dismiss-equivalent or a distinct ledger state — default to dismiss + `graduated` flag for reversibility.
- Whether multi-target PDF links need new anchor fields or README guidance pointing at shipped multi-span extracts.
