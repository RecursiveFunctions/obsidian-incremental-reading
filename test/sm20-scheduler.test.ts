import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeInitialSincPrior,
  computeSm20Retrievability,
  difficulty01ToIndex20,
  difficulty01ToStored,
  difficultyIndex20ToLogFraction,
  enforceMinimumIntervalGrowthFactor,
  evaluateSincModelV2,
  repetitionIndexToFraction19,
  scheduleSm20Item,
  SM20_RETRIEVABILITY_MAX,
  SM20_RETRIEVABILITY_MIN,
  SM20_STABILITY_MIN,
  stabilityIndex20ToTransformed,
  stabilityToIndex20,
  storedDifficultyTo01,
} from "../src/ir/sm20-scheduler";
import { scheduleItem } from "../src/ir/item-scheduler";
import { validateIrEvent } from "../src/ir/model";
import { newElementId, newEventId, newDeviceId } from "../src/ir/ids";

const NOW = 1_760_000_000_000;
const DAY_MS = 86_400_000;

test("computeSm20Retrievability: hits 0.9 at elapsed === stability and clamps to [0.005, 0.995]", () => {
  assert.ok(Math.abs(computeSm20Retrievability(10, 10) - 0.9) < 1e-12);
  assert.equal(computeSm20Retrievability(0, 10), SM20_RETRIEVABILITY_MAX);
  assert.equal(computeSm20Retrievability(10_000, 1), SM20_RETRIEVABILITY_MIN);
  assert.equal(computeSm20Retrievability(Number.NaN, 10), SM20_RETRIEVABILITY_MAX);
});

test("SM-20 axis mappers match sm20.exe 1..20 indices and transforms", () => {
  assert.equal(difficulty01ToIndex20(0), 1);
  assert.equal(difficulty01ToIndex20(1), 20);
  assert.equal(difficulty01ToIndex20(-0.5), 10);
  assert.equal(difficultyIndex20ToLogFraction(1), 0);
  assert.ok(Math.abs(difficultyIndex20ToLogFraction(20) - 1) < 1e-12);

  assert.equal(repetitionIndexToFraction19(1), 0);
  assert.equal(repetitionIndexToFraction19(20), 1);

  assert.equal(stabilityToIndex20(0.7), 1);
  assert.equal(stabilityToIndex20(44_530), 20);
  assert.equal(stabilityIndex20ToTransformed(1), 2.0);
  assert.ok(stabilityIndex20ToTransformed(20) > 5_000);
});

test("computeInitialSincPrior and evaluateSincModelV2 stay finite and decreasing with difficulty", () => {
  const easyPrior = computeInitialSincPrior(0, 2.0, difficultyIndex20ToLogFraction(2));
  const hardPrior = computeInitialSincPrior(0, 2.0, difficultyIndex20ToLogFraction(18));
  assert.ok(easyPrior > hardPrior);
  assert.ok(easyPrior <= 20.0 && hardPrior >= 0.8);

  const easySinc = evaluateSincModelV2(2 / 19, 10.0, difficultyIndex20ToLogFraction(2));
  const hardSinc = evaluateSincModelV2(2 / 19, 10.0, difficultyIndex20ToLogFraction(18));
  assert.ok(easySinc > hardSinc);
});

test("enforceMinimumIntervalGrowthFactor: enforces 0x00cf29c0 growth floor only for reps > 1 and prevIv < 1461", () => {
  assert.equal(enforceMinimumIntervalGrowthFactor(10, 10, 1), 10);
  const boostedShort = enforceMinimumIntervalGrowthFactor(10, 10, 2);
  assert.ok(boostedShort > 10);
  const boostedMedium = enforceMinimumIntervalGrowthFactor(100, 102, 3);
  assert.equal(boostedMedium, 111);
  assert.equal(enforceMinimumIntervalGrowthFactor(1500, 1505, 4), 1505);
});

test("storedDifficultyTo01 <-> difficulty01ToStored is lossless across [1, 10]", () => {
  for (const d of [1, 2.5, 5, 7.25, 10]) {
    assert.ok(Math.abs(difficulty01ToStored(storedDifficultyTo01(d)) - d) < 1e-12);
  }
});

test("scheduleSm20Item: first review grades order monotonically and respect desiredRetention", () => {
  const again = scheduleSm20Item(undefined, "again", NOW, 0.9);
  const hard = scheduleSm20Item(undefined, "hard", NOW, 0.9);
  const good = scheduleSm20Item(undefined, "good", NOW, 0.9);
  const easy = scheduleSm20Item(undefined, "easy", NOW, 0.9);

  assert.equal(again.scheduledDays, 1);
  assert.equal(again.stability, SM20_STABILITY_MIN);
  assert.equal(again.lapses, 1);
  assert.ok(hard.scheduledDays <= good.scheduledDays);
  assert.ok(good.scheduledDays <= easy.scheduledDays);
  assert.ok(easy.stability > hard.stability);

  const highRet = scheduleSm20Item(undefined, "good", NOW, 0.96);
  const lowRet = scheduleSm20Item(undefined, "good", NOW, 0.82);
  assert.ok(lowRet.scheduledDays >= highRet.scheduledDays);
});

test("scheduleSm20Item: subsequent reviews grow intervals on pass and shrink stability on lapse", () => {
  let card = scheduleSm20Item(undefined, "good", NOW, 0.9);
  const t1 = card.due;
  const passHard = scheduleSm20Item(card, "hard", t1, 0.9);
  const passGood = scheduleSm20Item(card, "good", t1, 0.9);
  const passEasy = scheduleSm20Item(card, "easy", t1, 0.9);

  assert.ok(passGood.scheduledDays > card.scheduledDays);
  assert.ok(passHard.scheduledDays <= passGood.scheduledDays);
  assert.ok(passGood.scheduledDays <= passEasy.scheduledDays);

  const lapsed = scheduleSm20Item(passGood, "again", passGood.due, 0.9);
  assert.equal(lapsed.scheduledDays, 1);
  assert.equal(lapsed.lapses, passGood.lapses + 1);
  assert.ok(lapsed.stability <= 2.0);
  assert.ok(lapsed.difficulty > passGood.difficulty);
});

test("scheduleItem: switches seamlessly between SM-20 and FSRS without card migration and passes ledger validation", () => {
  const step1 = scheduleItem(undefined, "good", NOW, {
    primaryScheduler: "sm20",
    requestRetention: 0.9,
  });
  assert.equal(step1.scheduler, "sm20");

  const step2 = scheduleItem(step1.stored, "good", step1.stored.due, {
    primaryScheduler: "fsrs",
    requestRetention: 0.9,
  });
  assert.equal(step2.scheduler, "fsrs");
  assert.ok(step2.stored.scheduledDays >= step1.stored.scheduledDays);

  const step3 = scheduleItem(step2.stored, "easy", step2.stored.due, {
    primaryScheduler: "sm20",
    requestRetention: 0.9,
  });
  assert.equal(step3.scheduler, "sm20");
  assert.ok(step3.stored.scheduledDays > step2.stored.scheduledDays);

  const err = validateIrEvent({
    id: newEventId(),
    ts: step3.stored.lastReview!,
    lamport: 1,
    device: newDeviceId(),
    kind: "graded",
    target: newElementId(),
    payload: {
      card: step3.stored,
      grade: 4,
      scheduler: step3.scheduler,
    },
  });
  assert.equal(err, null);
});
