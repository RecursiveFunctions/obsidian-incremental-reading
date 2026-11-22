import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hasWrongRepetitionGradeAndLapsesMatch,
  repairNonPositiveIntervalDays,
} from "../src/ir/sm-history-repair";

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
