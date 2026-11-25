import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_LAST_REPETITION_DAY,
  hasWrongRepetitionGradeAndLapsesMatch,
  repairLastRepetitionDateInElementInfo,
  repairNonPositiveIntervalDays,
  repairReviewDateVsIntervalDiscrepancy,
} from "../src/ir/sm-history-repair";

const DAY_MS = 86_400_000;
const DELPHI_EPOCH_MS = Date.UTC(1899, 11, 30);

function epochMsToDelphi(ms: number): number {
  return (ms - DELPHI_EPOCH_MS) / DAY_MS;
}

test("repairNonPositiveIntervalDays: clamps non-positive to 1 day", () => {
  assert.deepEqual(repairNonPositiveIntervalDays(3), {
    intervalDays: 3,
    repaired: false,
  });
  assert.deepEqual(repairNonPositiveIntervalDays(0), {
    intervalDays: 1,
    repaired: true,
  });
  assert.deepEqual(repairNonPositiveIntervalDays(-2), {
    intervalDays: 1,
    repaired: true,
  });
});

test("hasWrongRepetitionGradeAndLapsesMatch: pass requires reps+1 unchanged lapses", () => {
  assert.equal(
    hasWrongRepetitionGradeAndLapsesMatch(
      { reps: 2, lapses: 1 },
      { reps: 3, lapses: 1, grade: 4 },
    ),
    false,
  );
  assert.equal(
    hasWrongRepetitionGradeAndLapsesMatch(
      { reps: 2, lapses: 1 },
      { reps: 2, lapses: 1, grade: 4 },
    ),
    true,
  );
});

test("hasWrongRepetitionGradeAndLapsesMatch: fail with non-increasing reps needs lapses+1", () => {
  assert.equal(
    hasWrongRepetitionGradeAndLapsesMatch(
      { reps: 3, lapses: 0 },
      { reps: 1, lapses: 1, grade: 1 },
    ),
    false,
  );
  assert.equal(
    hasWrongRepetitionGradeAndLapsesMatch(
      { reps: 3, lapses: 0 },
      { reps: 1, lapses: 0, grade: 1 },
    ),
    true,
  );
});

test("repairReviewDateVsIntervalDiscrepancy: back-fills missing dates from intervals", () => {
  const lastMs = Date.UTC(2024, 0, 20);
  const last = epochMsToDelphi(lastMs);
  const fixed = repairReviewDateVsIntervalDiscrepancy(
    [
      { repetitionNumber: 1, intervalDays: 0, date: 0 },
      { repetitionNumber: 2, intervalDays: 5, date: 0 },
      { repetitionNumber: 3, intervalDays: 10, date: last },
    ],
    0,
    lastMs,
  );
  assert.ok(fixed.repairedCount >= 2);
  assert.equal(fixed.rows[2]!.date, last);
  assert.equal(fixed.rows[1]!.date, last - 10);
  assert.equal(fixed.rows[0]!.date, last - 10 - 5);
});

test("repairLastRepetitionDateInElementInfo: advances stale ElementInfo when drift > 1 day", () => {
  const hist = epochMsToDelphi(Date.UTC(2024, 5, 10));
  const stale = epochMsToDelphi(Date.UTC(2024, 5, 1));
  const fixed = repairLastRepetitionDateInElementInfo(stale, [
    { date: hist, intervalDays: 9 },
  ]);
  assert.equal(fixed.repairedCount, 1);
  assert.equal(fixed.lastRepetitionDate, hist);
});

test("repairLastRepetitionDateInElementInfo: clamps day beyond 0x7ffe", () => {
  const fixed = repairLastRepetitionDateInElementInfo(40000, [], MAX_LAST_REPETITION_DAY + 50);
  assert.equal(fixed.repairedCount, 1);
  assert.equal(fixed.lastRepetitionDate, 40000);
  assert.equal(fixed.lastRepetitionDay, MAX_LAST_REPETITION_DAY);
});
