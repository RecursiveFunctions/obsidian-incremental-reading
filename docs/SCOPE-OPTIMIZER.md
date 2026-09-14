# Scope: local FSRS parameter optimizer

Status: scoping (2026-09-13). Roadmap item P0.2; the FSRS-6 upgrade
(0.7.14) and the revlog fix (0.7.15) are its prerequisites and shipped.

## Why this feature, and why these two properties

FSRS optimization exists elsewhere (Anki, Decks). What does not exist
anywhere, and what the 2026 complaint record demands (MARKET-RESEARCH.md
Section 10.5), is an optimizer that fails loudly instead of silently:

1. **Exclusion report.** Before fitting, list exactly which reviews were
   excluded and why, with counts. Anki's optimizer silently excluding
   suspended cards produced garbage parameters and an "ease hell" thread;
   that silence is the failure mode we refuse to copy.
2. **Preview before apply.** Show the schedule delta (interval changes,
   due-load forecast shift, log-loss before/after) and require an explicit
   Apply. Applying stores the previous parameters and offers one-click
   revert.

Non-goals for v1: cross-vault aggregation (never), server anything
(never), automatic background re-optimization (explicit user action
only), optimizing the topic A-Factor schedule (FSRS items only).

## Data audit (done 2026-09-13)

The store is an append-only event log (`src/ir/log.ts`); `graded` events
are the revlog. Findings:

- Until 0.7.15, `graded` payloads carried only the rescheduled card, NOT
  the rating. **Reviews from before 0.7.15 have no rating and cannot be
  training data.** The exclusion report gets a dedicated line for them:
  "N reviews from before 0.7.15 (no recorded rating)".
- From 0.7.15 the payload is `{ card, grade (1-4), overridden? }`, and
  the event's `ts` supplies the review timestamp. Grade-undone events
  already void their target grade in the fold and must be excluded the
  same way here.
- Mercy postpone and Later today never write review events (by design),
  so they cannot pollute training. Divergence-picker SM-2 overrides are
  flagged `overridden` on the event; they remain valid (rating, elapsed)
  pairs, so they train, but the report counts them.
- Reconstructing pre-0.7.15 ratings from card-state deltas (lapse bump =
  Again, interval ratio heuristics) is possible but produces exactly the
  low-confidence data this feature exists to refuse. Not in v1; revisit
  only if real vaults turn out to have too little post-0.7.15 history.

Implication: the trainable dataset starts accumulating on 0.7.15 install
day. Shipping the revlog fix early was the point; the optimizer UI can
land later without losing data.

## Exclusion rules (v1)

Excluded, each with a counted reason in the report:

| Rule | Reason shown |
|---|---|
| Events before 0.7.15 | no recorded rating |
| Grade-undone targets | you undid this review |
| Elements deleted since | element no longer exists |
| Cards with < 2 rated reviews | too short to inform the fit |
| Same-timestamp duplicates (sync artifacts) | duplicate event |

Included but called out: `overridden` reviews (divergence picker).

Global gate: below a minimum total of rated reviews (exact threshold to
match upstream guidance; Anki's rule of thumb is ~400, Decks fits after
~100), the button explains the gate instead of fitting. Never fit
quietly on thin data.

## UX sketch

Lives in the Stats view (Alt+S), bottom section "Scheduler parameters":

1. Header row: current parameter source (default FSRS-6 / optimized on
   DATE over N reviews), target retention setting.
2. "Optimize from my review log" button. Runs chunked/async with a
   progress bar; never blocks the UI thread.
3. Result panel, BEFORE anything changes:
   - Exclusion report (table above, only non-zero rows).
   - Fit quality: log-loss and calibration (predicted vs actual recall
     in bins), current vs candidate.
   - Schedule delta: how many cards move closer / further, median
     interval change, 7-day forecast bars current vs candidate.
   - Buttons: Apply, Discard. Apply archives the previous parameters
     in settings and shows a persistent "Revert to previous parameters"
     until the next optimization.
4. Everything computed locally; no network APIs (CI will enforce).

## Engine decision (settled 2026-09-13)

**Decision: pure TypeScript optimizer, written here, validated in CI
against the canonical Rust optimizer as a dev-only test oracle.**

The obvious alternative was fsrs-browser (fsrs-rs compiled to WASM, the
same engine Anki uses). Research (2026-09-13, all claims verified from
tarballs/source unless noted) killed it and every other Rust route:

- **fsrs-browser 6.6.0 is unusable in Obsidian.** The published WASM is
  compiled with atomics and its glue creates
  `WebAssembly.Memory({shared:true})`, so instantiation requires
  SharedArrayBuffer, which requires a cross-origin-isolated context.
  Obsidian's `app://` renderer and the mobile webviews are not
  cross-origin isolated. The Decks author evaluated it and hit the same
  wall (their FSRS_OPTIMIZER.md says so explicitly).
- **@open-spaced-repetition/binding 0.5.0** (the official ts-fsrs
  optimizer companion, WASI build): same shared-memory + worker
  requirement in webviews; the Node path is desktop-only. Blocked.
- **fsrs-rs-nodejs** (native .node binding): no native modules on
  Obsidian mobile. Disqualified as a runtime dependency, but it runs
  fine in Linux CI, which is exactly where we will use it (below).
- **Custom single-threaded fsrs-rs WASM rebuild**: technically viable
  (plain wasm works in WKWebView/Android), but it means owning a Rust
  build pipeline, a ~300 KB binary blob in a bundle we advertise as
  readable, and a much harder reproducible-build story. Rejected while
  a validated TS path exists.
- **No pure-TS optimizer exists upstream to adopt.** ts-fsrs rejected a
  TS optimizer PR (#209) in favor of the Rust binding; npm has none.
  The only prior art is Decks' in-plugin optimizer (Adam + BCE +
  numerical central-difference gradients over the 21 weights, main
  thread with UI yielding, ~20 s for 5k reviews), which is
  store-approved and mobile-enabled, proving feasibility. Its core is
  unpublished and AGPL: **precedent only, zero code reuse.**

Why pure TS also fits the positioning: the bundle stays end-to-end
readable, the runtime dependency count stays at one (ts-fsrs), the
reproducible build stays npm-only, and the CI zero-network gate stays
trivially checkable. The correctness risk (the real argument for Rust)
is handled by testing, not by shipping the Rust engine:

- **CI oracle:** add `fsrs-rs-nodejs` as a devDependency (never
  bundled; the network/dep claims are about the shipped artifact).
  Golden tests feed identical synthetic revlogs to our optimizer and to
  fsrs-rs and assert the resulting parameters are within tolerance and,
  more importantly, that the resulting log-loss on a held-out slice is
  within a small epsilon of the reference fit. Decks estimates the
  numerical-gradient approach lands ~0.01-0.03 log-loss behind the
  reference; that is the budget, enforced by CI, printed in the UI.
- **Forward pass = ts-fsrs itself** (the shipped scheduler), so
  predicted retrievability in training matches what the plugin will
  actually do. No second implementation to drift.

Implementation shape (v1): Adam over BCE loss on recall (rating != 1),
central-difference numerical gradients over the 21 FSRS-6 weights,
parameter clamping to the published py-fsrs bounds, mini-batching by
card, chunked with UI yielding (Worker optional later; Decks proves
yielding suffices on mobile). Later upgrade path: fsrs-rs PR #447
replaces Burn with hand-rolled scalar analytic gradients for FSRS-6/7;
once merged it is a documented blueprint for porting analytic gradients
to TS for a ~40x speedup, without changing this architecture.

FSRS-7 note: FSRS-7 (34 parameters) is merged in fsrs-rs master but
unreleased anywhere (fsrs-rs latest release 6.6.2, 2026-08-28; ts-fsrs
still FSRS-6). We stay FSRS-6 and re-evaluate when ts-fsrs ships 7; the
optimizer's weight-vector length and bounds are already data, not
hardcoded, for that reason.

### Upstream facts that shape the exclusion rules and gates

- fsrs-rs minimum-data behavior: under 8 training items it returns the
  defaults; under 64 it fits only initial-stability ("pretrain");
  full training from 64 up. Anki's UX guidance: meaningful fits need "a
  few hundred" reviews, re-optimize about monthly. Our gate: follow the
  8/64 tiers mechanically, and below ~400 rated reviews show the fit
  but label it clearly as low-data alongside the exclusion report.
  (Decks gates at 100.)
- Anki's own filter set (from `reviews_for_fsrs`): drop manual
  reschedules and rating-less entries, drop history before a
  Forget/Reset, skip cards whose history lacks learning steps. Our
  event-log equivalents are already in the table above; "manual
  reschedule" maps to mercy/Later (never logged as reviews) and the
  `overridden` flag.
- Revlog contract (fsrs-rs `computeParameters`): per card, ratings plus
  day-deltas since previous review (0 = same day), same-day reviews
  included (they feed FSRS-6's short-term component). Our extraction
  therefore keeps same-day reviews rather than collapsing them, and
  day-bucketing must use the local day boundary consistently.

## Delivery plan

The implementation build order, module layout, test plan and milestones
live in `PLAN-OPTIMIZER.md`; the phases below are the summary.

1. **0.7.15 (done).** Revlog records ratings; loss of training data
   stops.
2. **Optimizer core behind a lab flag.** Revlog extraction + exclusion
   engine + Adam/BCE fit with numerical gradients, plus the CI oracle:
   fsrs-rs-nodejs as a devDependency, golden tests asserting our fit's
   held-out log-loss lands within the documented epsilon of the
   reference fit on the same revlog.
3. **Preview/apply UI in Stats.** Parameter storage in settings,
   engine construction from stored parameters (today `fsrs()` uses
   defaults only), revert path, forecast delta rendering.
4. **Ship as 0.8.0 once verified in real use** (minor bump per release policy:
   user-verified feature).

Open questions carried into implementation:

- Where parameters live: settings JSON (plugin data) vs a vault note.
  Leaning settings; parameters are device-agnostic and small, and
  settings already sync with the vault for most setups.
- Whether to expose target retention in the same panel (probably yes;
  it is the one knob FSRS expects users to own).
- Threshold values for the data gate; align with upstream guidance and
  say the number in the UI.
