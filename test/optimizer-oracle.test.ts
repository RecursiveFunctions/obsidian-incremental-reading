/**
 * The CI oracle (PLAN-OPTIMIZER.md, "CI oracle"): our pure-TS fit and the
 * canonical Rust optimizer (fsrs-rs via fsrs-rs-nodejs, a devDependency
 * that never ships) train on the same synthetic revlog; our held-out
 * log-loss must land within EPSILON of the reference and beat the
 * defaults. Skips loudly when the native module can't load.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { runFit, splitCards } from "../src/ir/optimizer/fit";
import { meanLogLoss } from "../src/ir/optimizer/metrics";
import { simulateRevlog } from "./optimizer-sim";
import type { RevlogCard } from "../src/ir/optimizer/revlog";

const EPSILON = 0.03;
const DAY = 86_400_000;

interface OracleItem {
  longTermReviewCnt(): number;
}

interface OracleModule {
  FSRS: new (parameters?: number[] | null) => {
    computeParameters(
      trainSet: unknown[],
      options?: Record<string, unknown>,
    ): Promise<number[]>;
  };
  FSRSItem: new (reviews: unknown[]) => OracleItem;
  FSRSReview: new (rating: number, deltaT: number) => unknown;
}

function loadOracle(): OracleModule | null {
  try {
    const require = createRequire(import.meta.url);
    return require("fsrs-rs-nodejs") as OracleModule;
  } catch (e) {
    console.warn(
      `[optimizer-oracle] fsrs-rs-nodejs unavailable on this platform; SKIPPING the oracle comparison. (${String(e).slice(0, 120)})`,
    );
    return null;
  }
}

/**
 * fsrs-rs training items, mirroring the upstream optimize.js example: one
 * FSRSItem per review carrying its full prefix history, delta_t in whole
 * UTC days since the previous review (0 = same day), keeping only items
 * with at least one long-term review (longTermReviewCnt > 0).
 */
function toOracleItems(cards: readonly RevlogCard[], oracle: OracleModule) {
  const items: OracleItem[] = [];
  for (const card of cards) {
    const reviews: unknown[] = [];
    for (let i = 0; i < card.reviews.length; i++) {
      const deltaT =
        i === 0
          ? 0
          : Math.max(
              0,
              Math.floor(card.reviews[i]!.ts / DAY) -
                Math.floor(card.reviews[i - 1]!.ts / DAY),
            );
      reviews.push(new oracle.FSRSReview(card.reviews[i]!.rating, deltaT));
      items.push(new oracle.FSRSItem([...reviews]));
    }
  }
  return items.filter((item) => item.longTermReviewCnt() > 0);
}

test("oracle: our fit lands within EPSILON of fsrs-rs on the same revlog", async (t) => {
  const oracle = loadOracle();
  if (!oracle) {
    t.skip("fsrs-rs-nodejs not loadable");
    return;
  }

  const SEED = 7;
  const cards = simulateRevlog(300, 21);
  const { heldOut } = splitCards(cards, SEED);
  assert.ok(heldOut.length >= 4, "synthetic split must produce a holdout");

  const ours = await runFit(cards, { seed: SEED, steps: 40, batchSize: 64 });

  const refFsrs = new oracle.FSRS([]);
  const ref = await refFsrs.computeParameters(toOracleItems(cards, oracle), {
    enableShortTerm: true,
  });
  assert.equal(ref.length, 21, "reference optimizer must return FSRS-6");

  // Same forward pass (ts-fsrs), same held-out cards, three vectors.
  const ourLoss = meanLogLoss(heldOut, ours.w);
  const refLoss = meanLogLoss(heldOut, ref);
  const defLoss = meanLogLoss(heldOut, undefined);

  console.log(
    `[optimizer-oracle] held-out logloss ours=${ourLoss.toFixed(4)} ref=${refLoss.toFixed(4)} defaults=${defLoss.toFixed(4)}`,
  );

  assert.equal(ours.improved, true, "fit must improve on warped-learner data");
  assert.ok(
    ourLoss < defLoss,
    `must beat defaults: ours=${ourLoss} defaults=${defLoss}`,
  );
  assert.ok(
    ourLoss <= refLoss + EPSILON,
    `must land within ${EPSILON} of the reference: ours=${ourLoss} ref=${refLoss}`,
  );
});
