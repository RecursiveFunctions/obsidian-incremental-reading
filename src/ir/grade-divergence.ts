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

/**
 * After grading, check whether FSRS and SM-2 diverge on the next interval.
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
): DivergenceCheck | null {
  const fsrsIntervalDays = fsrsNextCard.scheduledDays;
  const fsrsDue = fsrsNextCard.due;

  const sm2State = approximateSm2State(card);
  const sm2Prediction = sm2.predict(sm2State, grade, now);
  const sm2IntervalDays = sm2Prediction.intervalDays;
  const sm2Due = sm2Prediction.due;

  const config = buildDivergenceModal({
    members: [
      { id: "FSRS", intervalDays: fsrsIntervalDays, due: fsrsDue },
      { id: "SM-2", intervalDays: sm2IntervalDays, due: sm2Due },
    ],
    primaryId: "FSRS",
    threshold,
    floorDays,
  });

  if (!config) return null;
  return { config, fsrsIntervalDays, fsrsDue, sm2IntervalDays, sm2Due };
}
