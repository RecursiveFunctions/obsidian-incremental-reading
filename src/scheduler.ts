import type { Grade } from "./fsrs";

export interface Sm2State {
  repetitions: number;
  easeFactor: number;
  intervalDays: number;
}

export interface Prediction {
  intervalDays: number;
  due: number;
  nextState: Sm2State;
}

export interface Scheduler {
  predict(state: Sm2State, grade: Grade, now: number): Prediction;
}

const MS_PER_DAY = 86_400_000;

/** SM-2 quality: again=0, hard=3, good=4, easy=5 (fixed map). */
function quality(grade: Grade): number {
  switch (grade) {
    case "again":
      return 0;
    case "hard":
      return 3;
    case "good":
      return 4;
    case "easy":
      return 5;
  }
}

function nextEaseFactor(easeFactor: number, q: number): number {
  const efPrime =
    easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  return efPrime < 1.3 ? 1.3 : efPrime;
}

function predictSm2(state: Sm2State, grade: Grade, now: number): Prediction {
  const q = quality(grade);
  const preEase = state.easeFactor;
  const easeFactor = nextEaseFactor(preEase, q);

  let repetitions: number;
  let intervalDays: number;

  if (q < 3) {
    repetitions = 0;
    intervalDays = 1;
  } else {
    repetitions = state.repetitions + 1;
    if (repetitions === 1) {
      intervalDays = 1;
    } else if (repetitions === 2) {
      intervalDays = 6;
    } else {
      intervalDays = Math.round(state.intervalDays * preEase);
    }
  }

  const due = now + intervalDays * MS_PER_DAY;
  const nextState: Sm2State = { repetitions, easeFactor, intervalDays };

  return { intervalDays, due, nextState };
}

export const sm2: Scheduler = {
  predict: predictSm2,
};

/**
 * Interval-ratio divergence test (DESIGN.md §5): true when the spread of
 * strictly-positive finite intervals exceeds ratio `k` and the largest
 * interval is at least `floorDays` (short schedules never nag).
 */
export function diverges(
  intervalsDays: number[],
  k: number,
  floorDays: number,
): boolean {
  const usable = intervalsDays.filter(
    (d) => typeof d === "number" && Number.isFinite(d) && d > 0,
  );
  if (usable.length < 2) {
    return false;
  }
  let mx = usable[0]!;
  let mn = usable[0]!;
  for (let i = 1; i < usable.length; i++) {
    const v = usable[i]!;
    if (v > mx) mx = v;
    if (v < mn) mn = v;
  }
  if (mx < floorDays) {
    return false;
  }
  return mx / mn > k;
}
