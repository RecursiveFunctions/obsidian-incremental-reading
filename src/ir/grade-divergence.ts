/**
 * Divergence check at grading time (DESIGN.md Section 5).
 *
 * After the user grades an item, both FSRS and SM-2 produce predicted next
 * intervals. When the two diverge (spread > threshold), the review view
 * shows an inline picker so the user can choose which interval to use.
 *
 * SM-2 state is approximated from the FSRS card since we don't maintain a
 * separate SM-2 shadow. The approximation is good enough to detect
 * meaningful divergence; the exact interval the user picks is what gets
 * applied regardless.
 */

import type { StoredCard } from "./model";
import type { Grade } from "../fsrs";
import { sm2, type Sm2State } from "../scheduler";
import { predict as predictDsr, type SchedulerStatePrimitive } from "../dsr-scheduler";
import { buildDivergenceModal, type DivergenceModalConfig } from "./divergence-modal";

const MS_PER_DAY = 86_400_000;
const DEFAULT_THRESHOLD = 1.5;
const DEFAULT_FLOOR_DAYS = 7;

export interface DivergenceCheck {
  config: DivergenceModalConfig;
  fsrsIntervalDays: number;
  fsrsDue: number;
  sm2IntervalDays: number;
  sm2Due: number;
  dsrIntervalDays: number;
  dsrDue: number;
}

/**
 * Approximate an SM-2 state from the current FSRS card. The mapping is
 * intentionally loose — both schedulers model different things. We just need
 * a plausible SM-2 trajectory so divergence detection is meaningful.
 */
function approximateSm2State(card: StoredCard): Sm2State {
  const easeFactor = Math.max(1.3, 2.5 - (card.difficulty - 5) * 0.15);
  return {
    repetitions: card.reps,
    easeFactor,
    intervalDays: card.scheduledDays || 1,
  };
}

function gradeToSmGrade(grade: Grade): number {
  switch (grade) {
    case "again":
      return 1;
    case "hard":
      return 3;
    case "good":
      return 4;
    case "easy":
      return 5;
  }
}

/**
 * Predict next interval and state using the power-law DSR model (`src/dsr-scheduler.ts`).
 */
export function predictPowerLawDsr(
  card: StoredCard,
  grade: Grade,
  now: number,
  priority = 33,
): { intervalDays: number; due: number; stability: number; difficulty: number } {
  const elapsedDays =
    card.lastReview !== undefined && card.lastReview > 0
      ? Math.max(1, (now - card.lastReview) / MS_PER_DAY)
      : Math.max(1, card.elapsedDays || card.scheduledDays || 1);
  const state: SchedulerStatePrimitive = {
    stability: Math.max(0.7, card.stability || card.scheduledDays || 1),
    difficulty: Math.min(1, Math.max(0, ((card.difficulty || 5) - 1) / 9)),
    retrievability: 0.9,
    interval: card.scheduledDays || 0,
    next_interval: card.scheduledDays || 0,
    elapsed: elapsedDays,
    lapses: card.lapses || 0,
    repetition: card.reps || 0,
    a_factor: Math.max(1.2, 5.0 - ((card.difficulty || 5) - 1) * 0.35),
    graded: card.reps > 0,
    has_history: card.reps > 0,
    priority_position: Math.max(1, Math.round((priority / 100) * 1000)),
    kind: 1,
    postpones: 0,
  };
  const next = predictDsr(state, gradeToSmGrade(grade));
  // Apply the grade-4 / grade-5 bonus on first and later pass intervals
  const smGrade = gradeToSmGrade(grade);
  const gradeBonus = smGrade >= 3 ? 1 + 0.08 * (smGrade - 3) : 1;
  const intervalDays = Math.max(1, Math.round(next.next_interval * gradeBonus));
  return {
    intervalDays,
    due: now + intervalDays * MS_PER_DAY,
    stability: next.stability,
    difficulty: Math.min(10, Math.max(1, 1 + next.difficulty * 9)),
  };
}

/**
 * After grading, check whether FSRS, DSR, and SM-2 diverge on the next interval.
 * Returns null when they agree (or data is insufficient), or a
 * DivergenceCheck with the config for the inline picker.
 */
export function checkGradeDivergence(
  card: StoredCard,
  fsrsNextCard: StoredCard,
  grade: Grade,
  now: number,
  threshold = DEFAULT_THRESHOLD,
  floorDays = DEFAULT_FLOOR_DAYS,
  priority = 33,
): DivergenceCheck | null {
  const fsrsIntervalDays = fsrsNextCard.scheduledDays;
  const fsrsDue = fsrsNextCard.due;

  const sm2State = approximateSm2State(card);
  const sm2Prediction = sm2.predict(sm2State, grade, now);
  const sm2IntervalDays = sm2Prediction.intervalDays;
  const sm2Due = sm2Prediction.due;

  const dsrPrediction = predictPowerLawDsr(card, grade, now, priority);
  const dsrIntervalDays = dsrPrediction.intervalDays;
  const dsrDue = dsrPrediction.due;

  const config = buildDivergenceModal({
    members: [
      { id: "FSRS", intervalDays: fsrsIntervalDays, due: fsrsDue },
      { id: "DSR", intervalDays: dsrIntervalDays, due: dsrDue },
      { id: "SM-2", intervalDays: sm2IntervalDays, due: sm2Due },
    ],
    primaryId: "FSRS",
    threshold,
    floorDays,
  });

  if (!config) return null;
  return {
    config,
    fsrsIntervalDays,
    fsrsDue,
    sm2IntervalDays,
    sm2Due,
    dsrIntervalDays,
    dsrDue,
  };
}
