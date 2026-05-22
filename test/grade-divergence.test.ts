import { test } from "node:test";
import assert from "node:assert/strict";
import { checkGradeDivergence } from "../src/ir/grade-divergence";
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

test("checkGradeDivergence: returns null when intervals agree", () => {
  const card = makeCard({ scheduledDays: 1, reps: 0 });
  const fsrsNext = makeCard({
    due: NOW + MS_PER_DAY,
    scheduledDays: 1,
  });
  const result = checkGradeDivergence(card, fsrsNext, "good", NOW);
  assert.equal(result, null);
});

test("checkGradeDivergence: returns null when intervals below floor", () => {
  const card = makeCard({ scheduledDays: 2, reps: 2, difficulty: 5 });
  const fsrsNext = makeCard({
    due: NOW + 5 * MS_PER_DAY,
    scheduledDays: 5,
  });
  const result = checkGradeDivergence(card, fsrsNext, "good", NOW, 1.5, 100);
  assert.equal(result, null);
});

test("checkGradeDivergence: detects large divergence (low reps, long FSRS interval)", () => {
  // SM-2 with reps=1 gives intervalDays=6 for "good"; FSRS says 60 days.
  const card = makeCard({ scheduledDays: 6, reps: 1, difficulty: 5 });
  const fsrsNext = makeCard({
    due: NOW + 60 * MS_PER_DAY,
    scheduledDays: 60,
  });
  const result = checkGradeDivergence(card, fsrsNext, "good", NOW, 1.5, 1);
  if (!result) {
    assert.fail("Expected divergence to be detected");
  }
  assert.ok(result.config);
  assert.equal(result.config.members.length, 2);
  assert.equal(result.fsrsIntervalDays, 60);
  assert.ok(result.sm2IntervalDays > 0);
});

test("checkGradeDivergence: config message includes spread info", () => {
  // SM-2 reps=0 gives 1 day for "good"; FSRS says 90 days.
  const card = makeCard({ scheduledDays: 1, reps: 0, difficulty: 5 });
  const fsrsNext = makeCard({
    due: NOW + 90 * MS_PER_DAY,
    scheduledDays: 90,
  });
  const result = checkGradeDivergence(card, fsrsNext, "easy", NOW, 1.1, 1);
  if (!result) {
    assert.fail("Expected divergence to be detected");
  }
  assert.ok(result.config.message.includes("diverge"));
});

test("checkGradeDivergence: returns both due timestamps", () => {
  // SM-2 reps=1 gives 6 days for "good"; FSRS says 50 days.
  const card = makeCard({ scheduledDays: 6, reps: 1, difficulty: 5 });
  const fsrsNext = makeCard({
    due: NOW + 50 * MS_PER_DAY,
    scheduledDays: 50,
  });
  const result = checkGradeDivergence(card, fsrsNext, "good", NOW, 1.1, 1);
  if (!result) {
    assert.fail("Expected divergence to be detected");
  }
  assert.equal(result.fsrsDue, NOW + 50 * MS_PER_DAY);
  assert.ok(result.sm2Due > NOW);
});
