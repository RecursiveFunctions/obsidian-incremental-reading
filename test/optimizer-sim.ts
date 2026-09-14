/**
 * Synthetic revlog generator for optimizer tests: a simulated learner
 * whose recall follows FSRS-6 under a known "true" parameter vector that
 * differs from the defaults. Seeded and deterministic. Not a test file.
 */

import { clipParameters } from "ts-fsrs";
import {
  FSRS6_DEFAULTS,
  engineFor,
} from "../src/ir/optimizer/forward";
import { mulberry32 } from "../src/ir/optimizer/fit";
import type { RevlogCard, Review } from "../src/ir/optimizer/revlog";
import type { ElementId } from "../src/ir/ids";
import { Rating, createEmptyCard } from "ts-fsrs";

const RATINGS = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as const;

/** Defaults, warped enough that a working fit must beat them. */
export function trueParams(): number[] {
  const w = [...FSRS6_DEFAULTS];
  w[0]! *= 0.4;
  w[1]! *= 0.4;
  w[2]! *= 0.5;
  w[3]! *= 0.5;
  w[4] = 6.0;
  w[20] = 0.25;
  return clipParameters(w, 1, true);
}

export function simulateRevlog(
  nCards: number,
  seed: number,
): RevlogCard[] {
  const rand = mulberry32(seed);
  const world = engineFor(trueParams());
  const start = Date.UTC(2026, 0, 1, 12, 0, 0);
  const DAY = 86_400_000;
  const cards: RevlogCard[] = [];

  for (let i = 0; i < nCards; i++) {
    const reviews: Review[] = [];
    let at = start + Math.floor(rand() * 60) * DAY;
    let card = createEmptyCard(new Date(at));
    const nReviews = 5 + Math.floor(rand() * 5);

    for (let r = 0; r < nReviews; r++) {
      let rating: 1 | 2 | 3 | 4;
      if (r === 0) {
        rating = rand() < 0.3 ? 1 : rand() < 0.8 ? 3 : 4;
      } else {
        const p = world.get_retrievability(card, new Date(at), false);
        const recalled = rand() < (Number.isFinite(p) ? p : 0.5);
        if (!recalled) rating = 1;
        else rating = rand() < 0.15 ? 2 : rand() < 0.85 ? 3 : 4;
      }
      reviews.push({ ts: at, rating, overridden: false });
      card = world.next(card, new Date(at), RATINGS[rating - 1]!).card;
      const dueDelta = Math.max(60_000, card.due.getTime() - at);
      at = at + Math.round(dueDelta * (0.7 + rand() * 0.7));
    }
    cards.push({ elementId: `sim-${i}` as ElementId, reviews });
  }
  return cards;
}
