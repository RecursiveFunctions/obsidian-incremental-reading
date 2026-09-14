/**
 * Optimizer stage 2 (PLAN-OPTIMIZER.md §2): replay a card's rating history
 * under a candidate weight vector. ts-fsrs is the forward pass by
 * construction, so training optimizes exactly what the shipped scheduler
 * executes; there is no second curve implementation to drift.
 *
 * Pure: no Obsidian imports, no I/O.
 */

import {
  Rating,
  createEmptyCard,
  fsrs,
  generatorParameters,
  type Card,
  type FSRS,
  type Grade as FsrsGrade,
} from "ts-fsrs";
import type { RevlogCard } from "./revlog";

/** The stock FSRS-6 weight vector (21 entries). */
export const FSRS6_DEFAULTS: readonly number[] = generatorParameters().w;

const RATINGS: Record<1 | 2 | 3 | 4, FsrsGrade> = {
  1: Rating.Again,
  2: Rating.Hard,
  3: Rating.Good,
  4: Rating.Easy,
};

/** Engine for a weight vector; `undefined` means the FSRS-6 defaults. */
export function engineFor(
  w?: readonly number[],
  desiredRetention?: number,
): FSRS {
  const params: Record<string, unknown> = {};
  if (w) params.w = [...w];
  if (desiredRetention !== undefined) params.request_retention = desiredRetention;
  return fsrs(params);
}

/**
 * A revlog card with its Date objects built once, so the thousands of
 * replays a fit performs don't reallocate them per weight vector.
 */
export interface PreparedCard {
  dates: Date[];
  ratings: (1 | 2 | 3 | 4)[];
  /** Number of loss terms this card contributes (reviews after the first). */
  n: number;
}

export function prepare(cards: readonly RevlogCard[]): PreparedCard[] {
  return cards.map((c) => ({
    dates: c.reviews.map((r) => new Date(r.ts)),
    ratings: c.reviews.map((r) => r.rating),
    n: Math.max(0, c.reviews.length - 1),
  }));
}

const EPS = 1e-6;

/**
 * Replay one card, accumulating binary cross-entropy on recall
 * (y = rating != Again) for every review after the first. A non-finite
 * retrievability (pathological state) is scored as p = 0.5 rather than
 * dropped, so the number of loss terms never varies with the weight
 * vector — losses stay comparable across candidates.
 *
 * `collect` receives each (p, y) pair; metrics use it, the fit does not.
 */
export function replay(
  pc: PreparedCard,
  engine: FSRS,
  collect?: (p: number, y: 0 | 1) => void,
): { loss: number; card: Card } {
  let card = createEmptyCard(pc.dates[0]!);
  let loss = 0;
  for (let i = 0; i < pc.ratings.length; i++) {
    const at = pc.dates[i]!;
    if (i > 0) {
      let p = engine.get_retrievability(card, at, false);
      if (!Number.isFinite(p)) p = 0.5;
      if (p < EPS) p = EPS;
      else if (p > 1 - EPS) p = 1 - EPS;
      const y: 0 | 1 = pc.ratings[i] === 1 ? 0 : 1;
      loss += y === 1 ? -Math.log(p) : -Math.log(1 - p);
      if (collect) collect(p, y);
    }
    card = engine.next(card, at, RATINGS[pc.ratings[i]!]).card;
  }
  return { loss, card };
}

/** Summed BCE loss and term count over a card set. */
export function datasetLoss(
  cards: readonly PreparedCard[],
  engine: FSRS,
): { loss: number; n: number } {
  let loss = 0;
  let n = 0;
  for (const pc of cards) {
    loss += replay(pc, engine).loss;
    n += pc.n;
  }
  return { loss, n };
}
