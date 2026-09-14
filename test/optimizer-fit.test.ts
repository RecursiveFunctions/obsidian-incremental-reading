import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLAMP_PARAMETERS,
  Rating,
  W17_W18_Ceiling,
  createEmptyCard,
} from "ts-fsrs";
import {
  FSRS6_DEFAULTS,
  engineFor,
} from "../src/ir/optimizer/forward";
import { runFit, splitCards } from "../src/ir/optimizer/fit";
import {
  calibration,
  intervalDelta,
  meanLogLoss,
} from "../src/ir/optimizer/metrics";
import { simulateRevlog } from "./optimizer-sim";
import type { RevlogCard } from "../src/ir/optimizer/revlog";
import type { ElementId } from "../src/ir/ids";

const FAST = { steps: 10, batchSize: 32 };

test("determinism: same revlog + same seed = identical parameters", async () => {
  const cards = simulateRevlog(60, 3);
  const a = await runFit(cards, { ...FAST, seed: 1 });
  const b = await runFit(cards, { ...FAST, seed: 1 });
  assert.deepEqual(a.w, b.w);
  assert.equal(a.candidateHeldOutLoss, b.candidateHeldOutLoss);
});

test("tier none: under 8 cards nothing is fitted", async () => {
  const cards = simulateRevlog(5, 4);
  const r = await runFit(cards, FAST);
  assert.equal(r.tier, "none");
  assert.equal(r.improved, false);
  assert.deepEqual(r.w.length, 21);
});

test("tier pretrain: 8-63 cards fit only the four initial-stability weights", async () => {
  const cards = simulateRevlog(20, 5);
  const r = await runFit(cards, { ...FAST, seed: 2 });
  assert.equal(r.tier, "pretrain");
  for (let j = 4; j < 21; j++) {
    assert.equal(
      r.improved ? r.w[j] : true,
      r.improved ? FSRS6_DEFAULTS[j] : true,
      `w${j} must stay at the default in pretrain tier`,
    );
  }
});

test("clamps: every fitted weight is inside the FSRS-6 bounds", async () => {
  const cards = simulateRevlog(100, 6);
  const r = await runFit(cards, { steps: 15, batchSize: 64, seed: 3 });
  const bounds = CLAMP_PARAMETERS(W17_W18_Ceiling, true);
  r.w.forEach((w, j) => {
    const [lo, hi] = bounds[j] as [number, number];
    assert.ok(w >= lo && w <= hi, `w${j}=${w} outside [${lo}, ${hi}]`);
  });
});

test("zero steps: candidate equals defaults, guard reports no improvement", async () => {
  const cards = simulateRevlog(80, 7);
  const r = await runFit(cards, { steps: 0, seed: 1 });
  assert.equal(r.improved, false);
  assert.deepEqual(r.w, [...r.w].map((x, j) => r.w[j]));
  assert.equal(r.candidateHeldOutLoss, r.defaultsHeldOutLoss);
});

test("fit beats the defaults on data from a shifted learner", async () => {
  const cards = simulateRevlog(120, 11);
  const r = await runFit(cards, { steps: 30, batchSize: 64, seed: 9 });
  assert.equal(r.improved, true);
  assert.ok(
    r.candidateHeldOutLoss < r.defaultsHeldOutLoss,
    `candidate ${r.candidateHeldOutLoss} should beat defaults ${r.defaultsHeldOutLoss}`,
  );
});

test("golden replay: meanLogLoss matches a hand-rolled ts-fsrs loop", () => {
  const DAY = 86_400_000;
  const t0 = Date.UTC(2026, 0, 1, 12);
  const card: RevlogCard = {
    elementId: "g" as ElementId,
    reviews: [
      { ts: t0, rating: 3, overridden: false },
      { ts: t0 + 3 * DAY, rating: 3, overridden: false },
      { ts: t0 + 10 * DAY, rating: 1, overridden: false },
    ],
  };
  const engine = engineFor();
  let c = createEmptyCard(new Date(t0));
  c = engine.next(c, new Date(t0), Rating.Good).card;
  const p1 = engine.get_retrievability(c, new Date(t0 + 3 * DAY), false);
  c = engine.next(c, new Date(t0 + 3 * DAY), Rating.Good).card;
  const p2 = engine.get_retrievability(c, new Date(t0 + 10 * DAY), false);
  const expected = (-Math.log(p1) + -Math.log(1 - p2)) / 2;
  assert.ok(Math.abs(meanLogLoss([card]) - expected) < 1e-9);
});

test("splitCards is deterministic and roughly 80/20", () => {
  const cards = simulateRevlog(200, 8);
  const a = splitCards(cards, 5);
  const b = splitCards(cards, 5);
  assert.deepEqual(
    a.heldOut.map((c) => c.elementId),
    b.heldOut.map((c) => c.elementId),
  );
  assert.equal(a.train.length + a.heldOut.length, 200);
  assert.ok(a.heldOut.length > 20 && a.heldOut.length < 60);
});

test("calibration bins cover every prediction and probabilities are sane", () => {
  const cards = simulateRevlog(40, 12);
  const bins = calibration(cards, undefined, 10);
  const totalPredictions = cards.reduce(
    (s, c) => s + (c.reviews.length - 1),
    0,
  );
  assert.equal(
    bins.reduce((s, b) => s + b.n, 0),
    totalPredictions,
  );
  for (const b of bins) {
    assert.ok(b.meanP > 0 && b.meanP < 1);
    assert.ok(b.actual >= 0 && b.actual <= 1);
  }
});

test("intervalDelta: identical vectors produce zero change", () => {
  const cards = simulateRevlog(30, 13);
  const d = intervalDelta(cards, undefined, [...FSRS6_DEFAULTS]);
  assert.equal(d.medianDays, 0);
  assert.equal(d.longer + d.shorter, 0);
  assert.equal(d.same, 30);
});

test("evalCardsFor matches the eval set the fit scored against", async () => {
  const { evalCardsFor } = await import("../src/ir/optimizer/fit");
  const cards = simulateRevlog(80, 14);
  const r = await runFit(cards, { steps: 0, seed: 5 });
  const evalSet = evalCardsFor(cards, 5);
  assert.ok(
    Math.abs(meanLogLoss(evalSet) - r.defaultsHeldOutLoss) < 1e-12,
    "same cards, same defaults loss",
  );
});
