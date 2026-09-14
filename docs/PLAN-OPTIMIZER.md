# Plan: local FSRS optimizer (implementation)

Status: planned 2026-09-13. Companion to `SCOPE-OPTIMIZER.md`, which
holds the why, the engine decision (pure TS + CI oracle), and the UX
sketch. This file is the build order. Work happens on a feature branch
off `origin/main`, PR into `main`, `npm run ship:*` per AGENTS.md.

## Ground truth this plan builds on (verified in-repo 2026-09-13)

- Revlog: `graded` events since 0.7.15 carry `{ card, grade (1-4),
  overridden? }`; event `ts` is the review timestamp. Raw access is
  `store.loadEvents()` (stats and session views already use it).
  Undo voiding: `grade-undone` events reference the voided event id;
  `fold()` in `src/ir/log.ts` computes the undone set in a first pass.
- Scheduler boundary: `src/fsrs.ts` owns the ts-fsrs singleton,
  currently `fsrs()` with defaults only. Nothing else imports ts-fsrs.
- Settings: flat pure interface in `src/ir/settings-data.ts` with
  defaults; no retention or parameter fields yet.
- Stats view: `src/stats-view.ts` (264 lines), section renderers
  (`renderCounts` / `renderForecast` / `renderReviewHistory`); the
  optimizer panel becomes a fourth section. `startOfLocalDayMs` lives
  in `src/ir/stats.ts`.

## Module layout

All optimizer logic is pure (no Obsidian imports) under
`src/ir/optimizer/`, tested with the normal `node --test` suite.

### 1. `revlog.ts` — extraction + exclusion engine

In: `IrEvent[]` (from `loadEvents()`), fold state (for existence
checks). Out:

```ts
interface RevlogCard { elementId: ElementId; reviews: Review[] }
interface Review { ts: number; rating: 1|2|3|4; overridden: boolean }
interface ExclusionReport {
  rows: { reason: ExclusionReason; count: number }[];
  includedReviews: number; includedCards: number;
  overriddenIncluded: number;
}
```

Rules, applied in order, every drop counted:

1. Non-`graded` events: not reviews (not reported; they are not
   candidates).
2. `payload.grade` missing or not 1-4 → **no recorded rating**
   (this is the pre-0.7.15 bucket; keying off the payload rather than
   a version number also covers foreign/hand-edited events).
3. Event id in the grade-undone set → **you undid this review**.
   Reuse the fold's logic: extract its first pass into an exported
   `undoneEventIds(events)` helper in `log.ts` rather than
   reimplementing.
4. Target element not in the folded state → **element no longer
   exists**.
5. Same (target, lamport, id) seen twice (shard duplication) →
   **duplicate event**.
6. After grouping: cards with < 2 rated reviews → **too short to
   inform the fit** (counted in cards, not reviews).

Ordering matches the fold exactly: lamport, then event id. Day deltas
use `startOfLocalDayMs`; `delta_t` in whole local days, 0 = same-day
(kept, feeds FSRS-6 short-term). `overridden` reviews are included and
counted separately.

### 2. `forward.ts` — replay under a weight vector

`replayCard(reviews, w, desiredRetention)` walks a card's rating
sequence through a ts-fsrs instance (`fsrs({ w, request_retention })`),
returning per-review predicted retrievability R_i (undefined for the
first review) and the final card state. ts-fsrs is the forward pass by
construction, so training optimizes exactly what the shipped scheduler
will execute. Instances are cached per weight vector within a fit step
(42 vectors per step under central differences).

### 3. `fit.ts` — Adam over BCE, numerical gradients

- Loss: binary cross-entropy on recall, `y = (rating != 1)`, predicted
  `p = R_i`, summed over reviews 2..n of each card in the batch.
- Gradients: central differences over the 21 weights (42 replays of
  the minibatch per step). Analytic gradients are a later port from
  fsrs-rs PR #447 once merged; the interface (`gradient(batch, w)`)
  isolates that swap.
- Optimizer: Adam, lr 4e-2, cosine annealing, per-weight clamping to
  the published py-fsrs bounds after every step.
- Batching: minibatch of cards, seeded shuffle (mulberry32). Steps:
  `max(100, 5 * ceil(nCards / 512))`.
- Data tiers (mirrors fsrs-rs): < 8 usable cards → return defaults
  with a "not enough data" result; < 64 → fit only w0..w3 (initial
  stability) with the same machinery; >= 64 → full fit. Below ~400
  rated reviews the result carries a `lowData: true` flag the UI must
  render as a warning, not a blocker.
- Contract: `fit(cards, opts)` is an async generator yielding
  `{ step, totalSteps, loss }` once per step so the caller can await
  UI frames and honor cancellation; final yield carries
  `{ w, trainLoss, heldOutLoss, defaultsHeldOutLoss }`.
- Determinism: same revlog + same seed → identical parameters. This is
  a test, not an aspiration.
- Held-out split: 20% of cards by seeded hash, never trained on;
  held-out log-loss is what the UI reports and what the oracle test
  compares.

### 4. `metrics.ts` — what the preview shows

- `logLoss(cards, w)` over a card set.
- `calibration(cards, w, bins=10)`: predicted-R deciles vs observed
  recall rate, for the "does it fit my memory" plot.
- `intervalDelta(cards, wOld, wNew)`: replay each card's history under
  both vectors, compare the interval a Good grade would produce next.
  Returns median/p10/p90 change and the count moving longer vs
  shorter. This is the honest preview: **applying parameters does not
  move existing due dates**; new parameters take effect at each card's
  next review, and the panel says so in those words.

## Persistence and engine plumbing

`settings-data.ts` additions (all optional, defaults preserve today's
behavior exactly):

```ts
interface FittedParams {
  w: number[];            // length 21, FSRS-6
  fsrsVersion: 6;
  fittedAt: number;       // epoch ms
  reviewCount: number;    // included reviews at fit time
  heldOutLogLoss: number;
  lowData: boolean;
}
fsrsParams?: FittedParams;         // active, absent = ts-fsrs defaults
fsrsPreviousParams?: FittedParams; // one-deep revert slot
desiredRetention: number;          // default 0.9, exposed in the panel
```

`src/fsrs.ts`: add `configureEngine(opts: { w?: number[];
requestRetention?: number })` that rebuilds the module singleton.
Called from plugin `onload` (from settings) and after Apply / Revert.
`schedule()` signature unchanged; no other caller moves. Guard: a
stored `w` of the wrong length or non-finite values is ignored with a
Notice, falling back to defaults (hand-edited data.json must not brick
grading).

## UI (stats view, fourth section: "Scheduler parameters")

Per UI-COMMITMENTS: inline, no modal, keyboard reachable.

1. Header: parameter source ("FSRS-6 defaults" or "Optimized DATE, N
   reviews, log-loss X"), desired retention control, and, when a
   previous set exists, "Revert to previous parameters".
2. "Optimize from my review log" button → progress bar (step count)
   with Cancel; runs through the async generator, awaiting
   `requestAnimationFrame` between steps.
3. Result panel, nothing applied yet: exclusion table (non-zero rows
   only, plus the included/overridden counts), held-out log-loss
   current vs candidate vs defaults, calibration summary, interval
   delta line ("median next interval +2.1d; 61% of cards get longer
   intervals"), the low-data warning when flagged, and Apply /
   Discard. Apply archives current params to the revert slot,
   persists, calls `configureEngine`, and re-renders the header.
4. No lab flag. The panel ships visible: it is an explicit action that
   changes nothing until Apply, refuses to apply a fit that loses to
   the defaults, and has one-click revert. Those rails are automated;
   a settings gate would add ceremony, not safety.

## CI oracle

- `fsrs-rs-nodejs` as a **devDependency** (never bundled; the shipped
  artifact keeps one runtime dep, and the CI network gate is about
  `main.js`).
- `test/optimizer-oracle.test.ts`:
  - Synthetic revlog generator: seeded simulated learner with known
    true parameters + noise, ~300 cards / ~2k reviews.
  - Run our fit (fixed seed, capped steps) and fsrs-rs
    `computeParameters` on the identical revlog.
  - Assert: our held-out log-loss <= reference's + **0.03** (the
    epsilon SCOPE documents), and ours < defaults' (we never ship a
    fit worse than not fitting; the fit code itself must also enforce
    this at runtime by returning defaults + a "no improvement" result
    if the candidate loses to defaults on held-out data).
  - Budget: < 90 s in CI. If it grows past that, the full run moves
    behind `IR_ORACLE=1` and a tiny smoke variant stays in the
    default suite.
- `test/optimizer-fit.test.ts` (no native dep): determinism (same
  seed, same params), clamps respected, tier behavior (<8, <64),
  golden BCE values on a 3-card fixture, exclusion-report counts on a
  crafted event log covering every rule including undo and duplicate
  shards.

## Performance budget

Dominant cost: 42 minibatch replays per step. With batch 256 cards at
~8 reviews/card, a step touches ~86k scheduled transitions; at an
estimated 1-2M transitions/s for ts-fsrs on desktop, that is ~0.05-0.1
s/step → 100 steps in 5-10 s, comfortably inside the 30 s desktop /
90 s mobile budget for a 5k-review vault. If real numbers miss the
estimate: shrink batch, cap steps, and (last resort) precompute the
replay as plain arithmetic instead of ts-fsrs objects — but only with
a parity test pinning it to ts-fsrs output, since forward-pass drift
is the failure mode the architecture forbids.

## Build order (one continuous effort, no waiting periods)

The three stages below are a build order, not a schedule: they ship
back to back as soon as each is green. Correctness is proven by the
automated oracle in CI, not by a soak period. The only slow-moving
input is the user's own post-0.7.15 review history, and the data
tiers make the feature honest at any history size, so nothing waits
on it.

- **Stage 1 — revlog + exclusions.** `revlog.ts`, `undoneEventIds`
  extraction from `log.ts`, `metrics.logLoss`, tests, plus the
  command "IR: Copy optimizer data report" (exclusion report to
  clipboard).
- **Stage 2 — fit + oracle.** `forward.ts`, `fit.ts`,
  determinism/tier/golden tests, fsrs-rs-nodejs oracle in CI.
- **Stage 3 — plumbing + panel.** Settings fields, `configureEngine`,
  stats section with exclusion table / preview / Apply / Revert /
  desired-retention. Ships visible, no flag.

Release mechanics: stages ship as patch releases as they land
(dark code in 1-2 is fine to ship). The version becomes 0.8.0 with
the release policy's meaning (minor = user-verified) the first time
the user runs a fit and confirms the panel behaves; that is a
version-number formality on an afternoon's check, not a testing
phase. README/changelog copy then leads with the exclusion report +
preview, the two properties nobody else has.

Rough effort: stages 1 and 3 are each a focused session; stage 2 is
the long pole (fit correctness + oracle tuning).

## Risks and their handles

- **Numerical-gradient noise / divergence** → central differences,
  clamps every step, cosine lr decay, and the never-worse-than-
  defaults guard at the end of every fit.
- **ts-fsrs replay too slow on phones** → budget above, knobs listed;
  panel remains desktop-usable regardless since parameters sync with
  the vault settings.
- **Thin post-0.7.15 data for months** → tiers make the tool honest
  from day one (pretrain-only under 64 cards, lowData flag under 400
  reviews); the data report command sets expectations early.
- **fsrs-rs-nodejs platform gaps in CI/dev machines** → linux-x64
  covers GitHub CI; oracle test skips (with a loud console note, not
  a silent pass) when the native module fails to load.
- **FSRS-7 lands upstream mid-build** → weight length and bounds are
  data (`fsrsVersion` field, bounds table keyed by version); the fit
  machinery is dimension-agnostic. We do not start FSRS-7 work until
  ts-fsrs ships it.
