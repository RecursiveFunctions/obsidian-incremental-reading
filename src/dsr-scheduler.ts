/**
 * Power-law DSR (Difficulty, Stability, Retrievability) one-step repetition
 * scheduler.
 *
 * Standalone module with zero external dependencies, used alongside FSRS-6 and
 * SM-2 for multi-scheduler interval prediction and divergence checks.
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
  has_history: boolean;
  priority_position: number;
  kind: number;
  postpones: number;
}

export const GRADE_FAIL = 0x0001;
export const GRADE_PASS = 0x0002;
export const GRADE_IS_8 = 0x0004;
export const GRADE_GRADED = 0x0008;
export const GRADE_0_5_OR_8 = 0x0010;
export const GRADE_IS_10 = 0x0020;
export const GRADE_SCORED = 0x0040;
export const GRADE_IS_9 = 0x0080;

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

export function classifyGrade(grade: number): number {
  let flags = GRADE_FLAG_BASE;
  for (const [predicate, word] of GRADE_FLAG_TABLE) {
    if (predicate(grade)) flags |= word;
  }
  return flags;
}

export const GRADE_8_AS = 3;
export const PASS_GRADE_EXCEPTION = 11;

export const STABILITY_MIN = 0.7;
export const STABILITY_MAX = 44530.0;

export const RETRIEVABILITY_MIN = 0.005;
export const RETRIEVABILITY_MAX = 0.995;

export const DIFFICULTY_SCALE = 19.0;
export const LOG_AXIS_BASE = 20.0;
export const TIME_BIN_BASE = 1.4;
export const TIME_BIN_OFFSET = 12;
export const DECAY = -Math.log(0.9);
export const FI_RATIO = 1.0;

function trunc(value: number): number {
  return Math.trunc(value);
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export function difficultyBucket(difficulty: number): number {
  if (difficulty < 0.0) return 10;
  return clamp(trunc(Math.min(1.0, difficulty) * DIFFICULTY_SCALE) + 1, 1, 20);
}

export function retrievabilityBucket(retrievability: number): number {
  const x = clamp(retrievability, 0.0, 1.0);
  return clamp(trunc(Math.pow(LOG_AXIS_BASE, x)), 1, 20);
}

export function stabilityBucket(stability: number, exponent = 1.8): number {
  return clamp(
    trunc(Math.pow(Math.max(0.0, stability - 2.0), 1.0 / exponent)) + 1,
    1,
    20,
  );
}

export function lapseBucket(lapses: number): number {
  return clamp(trunc(lapses), 1, 20);
}

export function timeBin(elapsedDays: number): number {
  const t = Math.max(1.0, elapsedDays);
  return clamp(trunc(Math.log(t) / Math.log(TIME_BIN_BASE)) + TIME_BIN_OFFSET, 1, 36);
}

export const INTERVAL_MAX_DAYS = 65535.0;

function roundHalfToEven(value: number): number {
  if (Math.abs(value % 1) === 0.5) return 2 * Math.round(value / 2);
  return Math.round(value);
}

export function wholeDays(interval: number): number {
  if (!Number.isFinite(interval)) {
    throw new Error(`not a finite interval in days: ${interval}`);
  }
  return clamp(roundHalfToEven(interval), 0.0, INTERVAL_MAX_DAYS);
}

export const STABILITY_INCREASE_DEFAULT = 2.75;
export const STABILITY_INCREASE_DECAY = 0.1;
export const POST_LAPSE_STABILITY = 2.0;
export const TOPIC_INTERVAL_FACTOR = 3.3;
export const TOPIC_INTERVAL_EXPONENT = 0.75;
export const TOPIC_AFACTOR_EXPONENT = -0.75;
export const TOPIC_LAPSE_EXPONENT = -3.0;

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

export const PRIORITY_POSITION_MEDIAN = 300.0;
export const LATER_PRIORITY_EXPONENT_GRADED = 0.0;
export const LATER_PRIORITY_EXPONENT_TOPIC = 0.0;
export const LATER_DELAY_EXPONENT_GRADED = 0.0;
export const LATER_DELAY_EXPONENT_TOPIC = 0.0;
export const TOPIC_INTERVAL_MIN = 0.0;

export const A_FACTOR_DEFAULT = 1.2;
export const A_FACTOR_HARDEST = 1.2;
export const A_FACTOR_EASIEST = 12.0;
export const DIFFICULTY_STEP_UP = 0.04;
export const DIFFICULTY_STEP_DOWN = 0.01;
export const MIN_MATRIX_CASES = 1;
export const CONSULT_STABILITY_INCREASE_CUBE = false;

export interface Matrices {
  stability_increase?: number[][][] | null;
  stability_increase_cases?: number[][][] | null;
}

const EMPTY_MATRICES: Matrices = {};

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

export function difficultyFromAFactor(aFactor: number): number {
  const span = A_FACTOR_EASIEST - A_FACTOR_HARDEST;
  return clamp((A_FACTOR_EASIEST - aFactor) / span, 0.0, 1.0);
}

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
