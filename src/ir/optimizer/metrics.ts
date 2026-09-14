/**
 * Optimizer stage 2 (PLAN-OPTIMIZER.md §4): the numbers the preview panel
 * shows. Pure: no Obsidian imports, no I/O.
 */

import { Rating } from "ts-fsrs";
import { engineFor, prepare, replay } from "./forward";
import type { RevlogCard } from "./revlog";

/** Mean BCE of `w` (defaults when undefined) over the cards. */
export function meanLogLoss(
  cards: readonly RevlogCard[],
  w?: readonly number[],
): number {
  const engine = engineFor(w);
  let loss = 0;
  let n = 0;
  for (const pc of prepare(cards)) {
    loss += replay(pc, engine).loss;
    n += pc.n;
  }
  return n > 0 ? loss / n : 0;
}

export interface CalibrationBin {
  /** Mean predicted recall probability of the bin. */
  meanP: number;
  /** Observed recall rate of the bin. */
  actual: number;
  n: number;
}

/**
 * Predicted-vs-observed recall in equal-width probability bins: the
 * "does this parameter set fit my memory" view. Bins with no samples are
 * omitted.
 */
export function calibration(
  cards: readonly RevlogCard[],
  w?: readonly number[],
  bins = 10,
): CalibrationBin[] {
  const engine = engineFor(w);
  const sumP = new Array<number>(bins).fill(0);
  const sumY = new Array<number>(bins).fill(0);
  const count = new Array<number>(bins).fill(0);
  for (const pc of prepare(cards)) {
    replay(pc, engine, (p, y) => {
      const b = Math.min(bins - 1, Math.floor(p * bins));
      sumP[b] += p;
      sumY[b] += y;
      count[b] += 1;
    });
  }
  const out: CalibrationBin[] = [];
  for (let b = 0; b < bins; b++) {
    if (count[b]! === 0) continue;
    out.push({
      meanP: sumP[b]! / count[b]!,
      actual: sumY[b]! / count[b]!,
      n: count[b]!,
    });
  }
  return out;
}

export interface IntervalDelta {
  medianDays: number;
  p10Days: number;
  p90Days: number;
  longer: number;
  shorter: number;
  same: number;
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round(q * (sorted.length - 1))),
  );
  return sorted[idx]!;
}

/**
 * For each card: replay its full history under both weight vectors, then
 * compare the interval a Good grade would produce at its next review.
 * This is the honest preview — applying parameters moves no existing due
 * date; the change lands at each card's next review.
 */
export function intervalDelta(
  cards: readonly RevlogCard[],
  wOld: readonly number[] | undefined,
  wNew: readonly number[],
  desiredRetention = 0.9,
): IntervalDelta {
  const oldEngine = engineFor(wOld, desiredRetention);
  const newEngine = engineFor(wNew, desiredRetention);
  const diffs: number[] = [];
  let longer = 0;
  let shorter = 0;
  let same = 0;
  for (const pc of prepare(cards)) {
    const oldCard = replay(pc, oldEngine).card;
    const newCard = replay(pc, newEngine).card;
    const oldIvl = oldEngine.next(oldCard, oldCard.due, Rating.Good).card
      .scheduled_days;
    const newIvl = newEngine.next(newCard, newCard.due, Rating.Good).card
      .scheduled_days;
    const d = newIvl - oldIvl;
    diffs.push(d);
    if (d > 0) longer++;
    else if (d < 0) shorter++;
    else same++;
  }
  diffs.sort((a, b) => a - b);
  return {
    medianDays: percentile(diffs, 0.5),
    p10Days: percentile(diffs, 0.1),
    p90Days: percentile(diffs, 0.9),
    longer,
    shorter,
    same,
  };
}
