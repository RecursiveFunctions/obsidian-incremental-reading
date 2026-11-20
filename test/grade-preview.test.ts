/**
 * Grade-button interval previews (src/ir/grade-preview.ts).
 *
 * The contract: the number a button shows is the scheduler's own answer for
 * that grade, with the retention the grade path uses — so pressing the button
 * does what its label says. Pure; no I/O.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatIntervalShort,
  PREVIEW_GRADES,
  previewGradeDelays,
} from "../src/ir/grade-preview";
import { schedule, storedToCard } from "../src/fsrs";
import { scheduleSm20Item } from "../src/ir/sm20-scheduler";
import { createEmptySm20Matrix, recordSm20Outcome } from "../src/ir/sm20-matrix";

const NOW = 1_760_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/* formatIntervalShort                                                 */

test("formatIntervalShort: sub-day grades read in minutes and hours", () => {
  assert.equal(formatIntervalShort(10 * MIN, NOW), "+10m");
  assert.equal(formatIntervalShort(2 * HOUR, NOW), "+2h");
});

test("formatIntervalShort: longer grades read in days, months, years", () => {
  assert.equal(formatIntervalShort(4 * DAY, NOW), "+4d");
  assert.equal(formatIntervalShort(30 * DAY, NOW), "+1mo");
  assert.equal(formatIntervalShort(365 * DAY, NOW), "+1y");
});

test("formatIntervalShort: no label for a non-positive delay", () => {
  assert.equal(formatIntervalShort(0, NOW), "");
  assert.equal(formatIntervalShort(-5 * MIN, NOW), "");
  assert.equal(formatIntervalShort(Number.NaN, NOW), "");
});

/* previewGradeDelays                                                  */

test("previewGradeDelays: every grade previews the scheduler's own delay", () => {
  const card = storedToCard(null);
  const retention = 0.9;
  const delays = previewGradeDelays(card, NOW, retention);
  for (const grade of PREVIEW_GRADES) {
    const expected = schedule(card, grade, new Date(NOW), retention).due.getTime() - NOW;
    assert.equal(delays[grade], expected, `grade ${grade}`);
  }
});

test("previewGradeDelays: covers all four grades with finite, non-negative delays", () => {
  const delays = previewGradeDelays(storedToCard(null), NOW, 0.9);
  assert.deepEqual(Object.keys(delays).sort(), ["again", "easy", "good", "hard"]);
  for (const grade of PREVIEW_GRADES) {
    assert.ok(Number.isFinite(delays[grade]), `grade ${grade} is finite`);
    assert.ok(delays[grade] >= 0, `grade ${grade} is non-negative`);
  }
});

test("previewGradeDelays: does not mutate the card it inspects", () => {
  const card = storedToCard(null);
  const before = JSON.stringify(card);
  previewGradeDelays(card, NOW, 0.9);
  assert.equal(JSON.stringify(card), before);
});

test("previewGradeDelays: a fresh card's Easy extends further than its Again", () => {
  const delays = previewGradeDelays(storedToCard(null), NOW, 0.9);
  assert.ok(
    delays.easy > delays.again,
    `easy (${delays.easy}) should exceed again (${delays.again})`,
  );
});

test("previewGradeDelays: matches SM-20 delays when primaryScheduler === 'sm20'", () => {
  const delays = previewGradeDelays(undefined, NOW, 0.9, "sm20");
  for (const grade of PREVIEW_GRADES) {
    const expected = scheduleSm20Item(undefined, grade, NOW, 0.9).due - NOW;
    assert.equal(delays[grade], expected, `SM-20 grade ${grade}`);
  }

  const matrix = createEmptySm20Matrix();
  for (let i = 0; i < 40; i += 1) {
    recordSm20Outcome(matrix, {
      prevDifficulty01: 4 / 9,
      prevStability: 2.0,
      retrievability: 0.995,
      nextStability: 14.0,
      smGrade: 4,
    });
  }
  const adapted = previewGradeDelays(undefined, NOW, 0.9, "sm20", matrix);
  for (const grade of PREVIEW_GRADES) {
    const expected = scheduleSm20Item(undefined, grade, NOW, 0.9, matrix).due - NOW;
    assert.equal(adapted[grade], expected, `adapted SM-20 grade ${grade}`);
  }
});
