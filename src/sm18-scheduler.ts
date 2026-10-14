/**
 * SuperMemo 18's one-step repetition update, ported from the reverse-engineered
 * Python reference `sm18-re:smfmt/scheduler.py`.
 *
 * The reference itself is derived from two procedures in the shipped
 * `sm18.exe` (PE32 x86, Delphi): `FUN_007a6b08`, the driver that walks an
 * element's `RepetitionHistory.dat` rows, and `FUN_007a65fc`, the one-step
 * update. `predict` below is the one-step update. The driver (`replay`) is not
 * ported: it reads SuperMemo's on-disk collection, which this plugin has no
 * business touching.
 *
 * Every constant here carries the value the Python module gives it. Which ones
 * were read out of the executable's initialised data and which had to be
 * calibrated against recorded history is argued in
 * `sm18-re:docs/findings/scheduler.md`; the port adds no constant of its own.
 *
 * Conformance is pinned by `test/sm18-port-scheduler.test.ts` against
 * `test/fixtures/sm18-port-scheduler.json`, a mirror of the fixture
 * `sm18-re:scripts/export-port-scheduler-fixture.py` generates from the Python
 * reference. Nothing in this module may change without that test agreeing.
 *
 * This module is deliberately standalone: no imports, no plugin types, no
 * Obsidian surface. It is a transcription, and keeping it isolated is what
 * lets the fixture be the whole specification. Wiring it to the review queue
 * is separate work; `src/scheduler.ts` (SM-2) and `src/fsrs.ts` are what the
 * plugin currently schedules with.
 */

/**
 * One element's memory variables, as the driver carries them between rows.
 *
 * `elapsed` is the interval that has actually run since the previous
 * repetition — the executable recomputes it as `date[i] - date[i-1]` rather
 * than trusting the stored interval.
 *
 * The field names are the Python dataclass's, snake_case included. They are
 * the fixture's own keys, and renaming them to this repo's camelCase would put
 * a translation layer between the reference and the thing being verified.
 */
export interface SchedulerStatePrimitive {
  stability: number;
  difficulty: number;
  retrievability: number;
  interval: number;
  next_interval: number;
  elapsed: number;
  lapses: number;
  repetition: number;
  a_factor: number;
  graded: boolean;
  /**
   * False until this element's first recorded repetition has been consumed.
   * The driver starts its loop at `i = 1` and has no `date[i-1]` for the first
   * row, so a first row is structurally a different case — not merely a row
   * whose elapsed time happens to be zero.
   */
  has_history: boolean;
  /** `0x1b` of the row being consumed: a one-based historical priority position. */
  priority_position: number;
  /** `0x21` of the row being consumed: 0..3, keys the first-interval table. */
  kind: number;
  /** `0x1f` of the row being consumed: a postponement count, 0..13. */
  postpones: number;
}

// ---------------------------------------------------------------------------
// Grade classification — FUN_008a71dc at 0x8a71dc.
//
// That routine ORs one flag word per grade-byte predicate into a 16-bit set.
// The driver tests bit 0x08 to decide whether a row updates the memory
// variables at all, and the one-step update tests bit 0x02 for "this
// repetition was a pass".
// ---------------------------------------------------------------------------

/** Grade byte in 0..2. */
export const GRADE_FAIL = 0x0001;
/** Grade byte in 3..5 — the pass test in `FUN_007a65fc`. */
export const GRADE_PASS = 0x0002;
export const GRADE_IS_8 = 0x0004;
/** Grade byte in 0..5 — the memory-update gate. */
export const GRADE_GRADED = 0x0008;
export const GRADE_0_5_OR_8 = 0x0010;
export const GRADE_IS_10 = 0x0020;
export const GRADE_SCORED = 0x0040;
export const GRADE_IS_9 = 0x0080;

/**
 * The seven (predicate, flag word) pairs `FUN_008a71dc` ORs together, with the
 * words taken verbatim from `0x8a729c` through `0x8a72b4` in that order. The
 * accumulator starts from the word at `0x8a7298`, which is zero.
 */
const GRADE_FLAG_BASE = 0x0000;
const GRADE_FLAG_TABLE: ReadonlyArray<[(g: number) => boolean, number]> = [
  [(g) => g >= 0 && g < 3, 0x0001],
  [(g) => g - 3 >= 0 && g - 3 < 3, 0x0002],
  [(g) => g === 8, 0x00c4],
  [(g) => g >= 0 && g < 6, 0x0048],
  [(g) => (g >= 0 && g < 6) || g === 8, 0x0010],
  [(g) => g === 10, 0x0060],
  [(g) => g === 9, 0x0080],
];

/** `FUN_008a71dc`'s flag word for a raw `RepetitionHistory.dat` grade byte. */
export function classifyGrade(grade: number): number {
  let flags = GRADE_FLAG_BASE;
  for (const [predicate, word] of GRADE_FLAG_TABLE) {
    if (predicate(grade)) flags |= word;
  }
  return flags;
}

/**
 * `FUN_007a6b08` rewrites the grade byte 8 to 3 before classifying it, which
 * is what turns an ungraded "learned" row into a passing grade-3 repetition.
 */
export const GRADE_8_AS = 3;

/**
 * `FUN_007a65fc` takes the stability-increase branch when the pass bit is set
 * *or* the grade byte is 11, so 11 falls through to the pass branch. The
 * driver never reaches that exception, because byte 11 fails the `0x08` gate
 * upstream; it is kept because it is what the binary says.
 */
export const PASS_GRADE_EXCEPTION = 11;

// ---------------------------------------------------------------------------
// Clamps and quantisers, all read out of the image.
// ---------------------------------------------------------------------------

/** `FUN_0070fed4` clamps a stability to [0.7, 44530] days. */
export const STABILITY_MIN = 0.7;
export const STABILITY_MAX = 44530.0;

/** `FUN_0070ff58` clamps a retrievability to [0.005, 0.995]. */
export const RETRIEVABILITY_MIN = 0.005;
export const RETRIEVABILITY_MAX = 0.995;

/** `FUN_0070f9cc`: `Trunc(difficulty * 19.0) + 1`. */
export const DIFFICULTY_SCALE = 19.0;

/** `FUN_0070fc44`: `Trunc(Power(20.0, x))`. */
export const LOG_AXIS_BASE = 20.0;

/** `FUN_0070fdb8`: the 36-bin forgetting-curve axis, `Trunc(Ln(t)/Ln(1.4)) + 12`. */
export const TIME_BIN_BASE = 1.4;
export const TIME_BIN_OFFSET = 12;

/**
 * The retrievability-to-stability constant. The driver computes
 * `R = Exp(-k * t / S)` and the one-step update inverts it. `k` is a
 * runtime-initialised global, so the value is the one its own axis label
 * implies: "Stabilization at retrievability of 90%" makes stability the
 * interval at R = 0.9, hence `-ln(0.9)`.
 */
export const DECAY = -Math.log(0.9);

/**
 * Requested forgetting index, as the interval/stability ratio
 * `ln(1 - FI) / ln(0.9)`. SuperMemo's default FI is 10%, so the ratio is 1.
 */
export const FI_RATIO = 1.0;

/**
 * Python's `int()` truncates toward zero. Every quantiser input below is
 * non-negative, so `Math.floor` would agree, but truncation is the faithful
 * operation and the one Delphi's `Trunc` performs.
 */
function trunc(value: number): number {
  return Math.trunc(value);
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** `FUN_0070f9cc`: quantise a difficulty in [0, 1] to a one-based 1..20. */
export function difficultyBucket(difficulty: number): number {
  if (difficulty < 0.0) return 10;
  return clamp(trunc(Math.min(1.0, difficulty) * DIFFICULTY_SCALE) + 1, 1, 20);
}

/** `FUN_0070fc44`: `Trunc(20 ** x)`, so a logarithmic 1..20 axis. */
export function retrievabilityBucket(retrievability: number): number {
  const x = clamp(retrievability, 0.0, 1.0);
  return clamp(trunc(Math.pow(LOG_AXIS_BASE, x)), 1, 20);
}

/**
 * `FUN_0070fc8c`: `Trunc(max(0, x - 2.0) ** (1 / g)) + 1`, clamped 1..20.
 *
 * The subtracted 2.0 is a float32 in the image; `g` is the reciprocal of a
 * runtime-initialised global, so its value is calibrated.
 */
export function stabilityBucket(stability: number, exponent = 1.8): number {
  return clamp(
    trunc(Math.pow(Math.max(0.0, stability - 2.0), 1.0 / exponent)) + 1,
    1,
    20,
  );
}

/** `FUN_0070f980`: a lapse count clamped to 1..20. */
export function lapseBucket(lapses: number): number {
  return clamp(trunc(lapses), 1, 20);
}

/** `FUN_0070fdb8`: the one-based 36-bin forgetting-curve time axis. */
export function timeBin(elapsedDays: number): number {
  const t = Math.max(1.0, elapsedDays);
  return clamp(trunc(Math.log(t) / Math.log(TIME_BIN_BASE)) + TIME_BIN_OFFSET, 1, 36);
}

/**
 * The widest interval a history record can hold: `Interval` at `0x08` is a
 * uint16, and `STABILITY_MAX` already sits inside it, so this clamp never
 * fires on a finite prediction from this model.
 */
export const INTERVAL_MAX_DAYS = 65535.0;

/**
 * Round half to even, which is what Python's `round` does to a float and what
 * `numpy.round` does in the reference's own harness. `Math.round` rounds half
 * *up*, so a tie like 2.5 would come out 3 here and 2 there.
 *
 * The Python docstring reports that the tie rule is measured not to change the
 * replay's match rate (half-up scores the same 11,362 of 18,710 steps), but
 * the fixture compares predicted values rather than match rates, so the port
 * has to reproduce the rule and not merely its statistics.
 *
 * `value % 1 === 0.5` is exactly the tie condition: it holds only for a double
 * whose fractional part is the representable value one half.
 */
function roundHalfToEven(value: number): number {
  if (Math.abs(value % 1) === 0.5) return 2 * Math.round(value / 2);
  return Math.round(value);
}

/**
 * Quantise a predicted interval the way the record stores one.
 *
 * `Interval` is the uint16 at offset `0x08` of a `RepetitionHistory.dat`
 * record, so SuperMemo's own answer to "when next" is always a whole number of
 * days: a prediction of 2.4 days is a prediction of 2. The reference applies
 * that at the output and only at the output — the carried stability stays
 * continuous — because held out in four expanding-window folds of recorded
 * history it gains in every fold and costs no parameter.
 *
 * A non-finite interval is thrown rather than quantised: it can only come from
 * a diverged update, and rounding it to some sentinel would hide that.
 */
export function wholeDays(interval: number): number {
  if (!Number.isFinite(interval)) {
    throw new Error(`not a finite interval in days: ${interval}`);
  }
  return clamp(roundHalfToEven(interval), 0.0, INTERVAL_MAX_DAYS);
}

// ---------------------------------------------------------------------------
// Calibrated coefficients.
//
// Each of these stands in for a runtime-initialised global or for a procedure
// whose constants are not in the image's initialised data. They were fitted on
// recorded history and the fit is reported in
// `sm18-re:docs/findings/scheduler.md`. Numbers that *are* in the image are
// above, not here.
// ---------------------------------------------------------------------------

/** SInc at the one-day stability anchor. */
export const STABILITY_INCREASE_DEFAULT = 2.75;
/** SInc falls as `stability ** -this`. */
export const STABILITY_INCREASE_DECAY = 0.1;
/** `FUN_007b32f8`'s output: a constant, because no alg17 file persists its table. */
export const POST_LAPSE_STABILITY = 2.0;
/** Ungraded (topic) interval growth. */
export const TOPIC_INTERVAL_FACTOR = 3.3;
export const TOPIC_INTERVAL_EXPONENT = 0.75;
export const TOPIC_AFACTOR_EXPONENT = -0.75;
export const TOPIC_LAPSE_EXPONENT = -3.0;

/**
 * `nxt = max(floor, scale * priority_position ** exponent)`, as
 * `[floor, scale, exponent]` keyed by the raw grade byte and the `0x21` byte,
 * for the first recorded repetition of an element.
 *
 * The floor is not cosmetic: the best single prediction per priority-position
 * bucket is flat at 2.0 days for positions 1 through 720 and only then rises.
 * A plain power law has to choose between fitting the flat part and the
 * growing part; the floor lets it fit both.
 */
export const FIRST_INTERVAL_PRIORITY: {
  readonly [key: string]: readonly [number, number, number];
} = {
  "8,0": [2.0, 0.03036, 0.82],
  "9,0": [2.0, 0.00224, 1.12],
  "9,1": [0.8, 0.002, 0.92],
  "10,0": [2.0, 0.3673, 0.68],
};
export const FIRST_INTERVAL_PRIORITY_DEFAULT: readonly [number, number, number] = [
  1.0,
  1.0,
  0.0,
];

/**
 * The same term on later rows, as a multiplier normalised at the corpus median
 * priority position so the SM-17 constants keep their meaning.
 */
export const PRIORITY_POSITION_MEDIAN = 300.0;
export const LATER_PRIORITY_EXPONENT_GRADED = 0.0;
export const LATER_PRIORITY_EXPONENT_TOPIC = 0.0;

/** The postponement term's exponents. */
export const LATER_DELAY_EXPONENT_GRADED = 0.0;
export const LATER_DELAY_EXPONENT_TOPIC = 0.0;

/** The later-row ungraded branch's floor, the counterpart of the first-row one. */
export const TOPIC_INTERVAL_MIN = 0.0;

// The four exponents above and this floor are pinned to neutral, not fitted
// away. Coordinate ascent over the whole replay did move them and bought
// 0.0017 of match rate in total, with the postpones exponent coming out
// negative against a raw median profile that rises steeply. On a later row the
// elapsed interval is already in hand and carries whatever `0x1b` and `0x1f`
// would have added; both fields earn their place on first rows and nowhere
// else.

/** SuperMemo's unlearned A-factor. */
export const A_FACTOR_DEFAULT = 1.2;
export const A_FACTOR_HARDEST = 1.2;
export const A_FACTOR_EASIEST = 12.0;
/** Rebias on a lapse, toward harder. */
export const DIFFICULTY_STEP_UP = 0.04;
/** Rebias on a pass, toward easier. */
export const DIFFICULTY_STEP_DOWN = 0.01;
/** Cells with fewer recorded cases are SuperMemo's own approximation, not data. */
export const MIN_MATRIX_CASES = 1;

/**
 * Whether the pass branch reads `StabilityIncrease.dat` instead of the fitted
 * scalar above. **False, on measurement, not on absence of data**: with the
 * cube's index order corrected the lookup resolves 846 of 4,015 pass-branch
 * steps, and SuperMemo's own learned stability increases predict SuperMemo's
 * own recorded next interval *worse* than the fitted scalar does — by a gap
 * that widens monotonically with the weight of evidence behind the cell
 * (0.69 vs 0.44 at one case, 0.83 vs 0.21 at twenty-five). The reason is
 * structural: under any rule that derives the stability from the interval that
 * just ran, retrievability is a constant, so every lookup lands in one bucket
 * of the axis the cube's values actually vary along.
 *
 * It is false on the exporter's side too, so the fixture compares the fallback
 * and this port embeds no alg17 grid. See the `Matrices` note below.
 */
export const CONSULT_STABILITY_INCREASE_CUBE = false;

/**
 * The alg17 grids a prediction may consult.
 *
 * `SchedulerStatePrimitive` carries no matrices, which is exactly the
 * exporter's "empty-default" mode: the lookup can only report "unknown" and
 * the pass branch always takes the fitted fallback. The shape is kept — and
 * the index order with it — so that a later lane embedding the real cubes has
 * a seam to attach them to rather than a rewrite.
 */
export interface Matrices {
  /** `[difficulty][stability][retrievability]`, one-based on each axis. */
  stability_increase?: number[][][] | null;
  stability_increase_cases?: number[][][] | null;
}

const EMPTY_MATRICES: Matrices = {};

/**
 * Read one `[difficulty][stability][retrievability]` cell, one-based.
 *
 * The storage arithmetic is the executable's own,
 * `base + 441*(a-1) + 21*(b-1) + (c-1)`. The middle axis is the *stability*
 * bucket and the inner one the retrievability bucket: `FUN_0070fc8c` opens by
 * clamping its argument to [0.7, 44530] days, a stability range rather than a
 * probability, and `FUN_0070fc44` is the unclamped `Trunc(20 ** x)` axis.
 *
 * A cell with fewer than `MIN_MATRIX_CASES` recorded cases is reported as
 * unknown, because the on-disk value there is SuperMemo's own approximation
 * rather than measured data. So is a cell at or below 1.0, which is not a
 * stability *increase*.
 */
export function stabilityIncreaseAt(
  matrices: Matrices,
  difficultyIndex: number,
  retrievabilityIndex: number,
  stabilityIndex: number,
): number | null {
  const grid = matrices.stability_increase;
  if (!grid) return null;
  const cell = grid[difficultyIndex - 1][stabilityIndex - 1][retrievabilityIndex - 1];
  const cases = matrices.stability_increase_cases;
  if (cases && cases[difficultyIndex - 1][stabilityIndex - 1][retrievabilityIndex - 1] < MIN_MATRIX_CASES) {
    return null;
  }
  return cell > 1.0 ? cell : null;
}

/** Map an `ElementInfo` A-factor onto the [0, 1] difficulty axis. */
export function difficultyFromAFactor(aFactor: number): number {
  const span = A_FACTOR_EASIEST - A_FACTOR_HARDEST;
  return clamp((A_FACTOR_EASIEST - aFactor) / span, 0.0, 1.0);
}

/** The state an element starts its history in. */
export function newElement(aFactor: number = A_FACTOR_DEFAULT): SchedulerStatePrimitive {
  return {
    stability: STABILITY_MIN,
    difficulty: difficultyFromAFactor(aFactor),
    retrievability: 1.0,
    interval: 0.0,
    next_interval: 0.0,
    elapsed: 0.0,
    lapses: 0,
    repetition: 0,
    a_factor: aFactor,
    graded: false,
    has_history: false,
    priority_position: 1.0,
    kind: 0,
    postpones: 0,
  };
}

/**
 * One deterministic post-repetition update.
 *
 * `grade` is the raw signed byte from `RepetitionHistory.dat` offset `0x18`.
 * Returns a new state carrying the next interval, the new difficulty,
 * retrievability and stability, and the updated lapse count. The input state
 * is not mutated.
 */
export function predict(
  state: SchedulerStatePrimitive,
  grade: number,
  matrices: Matrices = EMPTY_MATRICES,
): SchedulerStatePrimitive {
  const g = Math.trunc(grade);
  const flags = classifyGrade(g === 8 ? GRADE_8_AS : g);
  const elapsed = Math.max(0.0, state.elapsed);
  let stability = clamp(state.stability, STABILITY_MIN, STABILITY_MAX);
  let difficulty = state.difficulty;
  let lapses = Math.trunc(state.lapses);
  let retrievability: number;
  let nxt: number;

  const priorityPosition = Math.max(1.0, state.priority_position);
  const postpones = 1.0 + Math.max(0, Math.trunc(state.postpones));

  if (!state.has_history) {
    // The element's first recorded repetition: `0x22` is zero, so there is no
    // prior row and no forgetting curve to measure. What the interval then
    // tracks is the schedule position, not stability.
    const [floor, scale, exponent] =
      FIRST_INTERVAL_PRIORITY[`${g},${Math.trunc(state.kind)}`] ??
      FIRST_INTERVAL_PRIORITY_DEFAULT;
    nxt = Math.max(floor, scale * Math.pow(priorityPosition, exponent));
    if (flags & GRADE_GRADED) {
      stability = clamp(nxt, STABILITY_MIN, STABILITY_MAX);
      retrievability = 1.0;
      if (flags & GRADE_FAIL) lapses += 1;
    } else {
      retrievability = state.retrievability;
    }
  } else if (!(flags & GRADE_GRADED)) {
    // `FUN_007a6b08` stores the row and skips the memory update entirely for
    // these bytes, so SM-17 never runs. What moves such an element is the
    // topic rule: the interval grows off the one that was just used.
    nxt = Math.max(
      TOPIC_INTERVAL_MIN,
      TOPIC_INTERVAL_FACTOR *
        Math.pow(elapsed, TOPIC_INTERVAL_EXPONENT) *
        Math.pow(state.a_factor, TOPIC_AFACTOR_EXPONENT) *
        Math.pow(1 + lapses, TOPIC_LAPSE_EXPONENT) *
        Math.pow(priorityPosition / PRIORITY_POSITION_MEDIAN, LATER_PRIORITY_EXPONENT_TOPIC) *
        Math.pow(postpones, LATER_DELAY_EXPONENT_TOPIC),
    );
    retrievability = state.retrievability;
  } else {
    retrievability = clamp(
      Math.exp((-DECAY * elapsed) / stability),
      RETRIEVABILITY_MIN,
      RETRIEVABILITY_MAX,
    );
    // SM-17 estimates the stability the element actually had from the interval
    // it survived: `FUN_007a65fc` computes `-k*t/Ln(R_predicted)`, which is
    // proportional to the used interval. The proportionality is folded into
    // STABILITY_INCREASE_DEFAULT, so the anchor here is the used interval
    // itself and not the carried-forward stability.
    const measured = clamp(elapsed, STABILITY_MIN, STABILITY_MAX);
    const dI = difficultyBucket(difficulty);
    const rI = retrievabilityBucket(retrievability);
    const sI = stabilityBucket(measured);
    if (flags & GRADE_PASS || g === PASS_GRADE_EXCEPTION) {
      let cell = CONSULT_STABILITY_INCREASE_CUBE
        ? stabilityIncreaseAt(matrices, dI, rI, sI)
        : null;
      if (cell === null) {
        cell = STABILITY_INCREASE_DEFAULT * Math.pow(measured, -STABILITY_INCREASE_DECAY);
      }
      stability = clamp(measured * cell, STABILITY_MIN, STABILITY_MAX);
      difficulty = Math.max(0.0, difficulty - DIFFICULTY_STEP_DOWN);
    } else {
      // `FUN_007b32f8`: post-lapse stability. It quantises a float through
      // `FUN_0070fc44` and the lapse count through `FUN_0070f980`, then
      // tail-calls with the pair — so it is a (retrievability bucket, lapse
      // bucket) table read, and the pre-lapse stability is not one of its
      // arguments. No alg17 file persists that table, and recorded history
      // says a constant is adequate anyway: the best single prediction is
      // 1.6 days in every elapsed bucket from 1 to 155.
      lapses += 1;
      stability = clamp(POST_LAPSE_STABILITY, STABILITY_MIN, STABILITY_MAX);
      difficulty = Math.min(1.0, difficulty + DIFFICULTY_STEP_UP);
    }
    nxt =
      stability *
      FI_RATIO *
      Math.pow(priorityPosition / PRIORITY_POSITION_MEDIAN, LATER_PRIORITY_EXPONENT_GRADED) *
      Math.pow(postpones, LATER_DELAY_EXPONENT_GRADED);
  }

  return {
    ...state,
    stability,
    difficulty,
    retrievability,
    interval: state.next_interval,
    next_interval: wholeDays(nxt),
    lapses,
    repetition: Math.trunc(state.repetition) + 1,
    graded: Boolean(flags & GRADE_GRADED),
    has_history: true,
  };
}
