import { test } from "node:test";
import assert from "node:assert/strict";
import { checkGradeDivergence } from "../src/ir/grade-divergence";
import { scheduleSm20Item } from "../src/ir/sm20-scheduler";
import type { StoredCard } from "../src/ir/model";

const NOW = 1_700_000_000_000;
const MS_PER_DAY = 86_400_000;

function makeCard(overrides: Partial<StoredCard> = {}): StoredCard {
  return {
    due: NOW,
    stability: 5,
    difficulty: 5,
    elapsedDays: 1,
    scheduledDays: 7,
    reps: 3,
    lapses: 0,
    state: 2,
    lastReview: NOW - MS_PER_DAY,
    ...overrides,
  };
}

test("checkGradeDivergence: returns null when intervals are below floor", () => {
  const card = makeCard({ scheduledDays: 1, reps: 0 });
  const fsrsNext = makeCard({
    due: NOW + MS_PER_DAY,
    scheduledDays: 1,
  });
  const result = checkGradeDivergence(card, fsrsNext, "good", NOW);
  assert.equal(result, null);
});

test("checkGradeDivergence: returns null when max interval stays below custom floor", () => {
  const card = makeCard({ scheduledDays: 2, reps: 2, difficulty: 5 });
  const fsrsNext = makeCard({
    due: NOW + 5 * MS_PER_DAY,
    scheduledDays: 5,
  });
  const result = checkGradeDivergence(card, fsrsNext, "good", NOW, 1.5, 100);
  assert.equal(result, null);
});

test("checkGradeDivergence: includes all 4 ensemble members (SM-20, FSRS, DSR, SM-2)", () => {
  const card = makeCard({ scheduledDays: 6, reps: 1, difficulty: 5 });
  const fsrsNext = makeCard({
    due: NOW + 60 * MS_PER_DAY,
    scheduledDays: 60,
  });
  const result = checkGradeDivergence(card, fsrsNext, "good", NOW, 1.5, 1);
  if (!result) {
    assert.fail("Expected divergence to be detected");
  }
  assert.equal(result.config.primaryId, "FSRS");
  assert.equal(result.config.members.length, 4);
  assert.deepEqual(
    result.config.members.map((m) => m.id),
    ["DSR", "FSRS", "SM-2", "SM-20"],
  );
  assert.equal(result.fsrsIntervalDays, 60);
  assert.ok(result.sm20IntervalDays > 0);
  assert.ok(result.sm2IntervalDays > 0);
  assert.ok(result.dsrIntervalDays > 0);
});

test("checkGradeDivergence: uses SM-20 as primaryId when primaryScheduler === 'sm20'", () => {
  const card = makeCard({ scheduledDays: 10, stability: 10, reps: 2, difficulty: 3 });
  const sm20Next = scheduleSm20Item(card, "easy", NOW, 0.9);
  const result = checkGradeDivergence(card, sm20Next, "easy", NOW, 1.1, 1, 20, {
    primaryScheduler: "sm20",
    effectiveRetention: 0.9,
  });
  if (!result) {
    assert.fail("Expected divergence to be detected under SM-20 primary");
  }
  assert.equal(result.config.primaryId, "SM-20");
  assert.equal(result.primaryScheduler, "sm20");
  assert.equal(result.sm20IntervalDays, sm20Next.scheduledDays);
  assert.ok(result.fsrsIntervalDays > 0);
});

test("checkGradeDivergence: config message includes spread info and due timestamps", () => {
  const card = makeCard({ scheduledDays: 6, reps: 1, difficulty: 5 });
  const fsrsNext = makeCard({
    due: NOW + 50 * MS_PER_DAY,
    scheduledDays: 50,
  });
  const result = checkGradeDivergence(card, fsrsNext, "good", NOW, 1.1, 1);
  if (!result) {
    assert.fail("Expected divergence to be detected");
  }
  assert.ok(result.config.message.includes("diverge"));
  assert.equal(result.fsrsDue, NOW + 50 * MS_PER_DAY);
  assert.ok(result.sm20Due > NOW);
  assert.ok(result.dsrDue > NOW);
  assert.ok(result.sm2Due > NOW);
});
