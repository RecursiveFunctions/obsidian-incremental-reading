import { test } from "node:test";
import assert from "node:assert/strict";
import {
  newCard,
  readCardFromFrontmatter,
  schedule,
  writeCardToFrontmatter,
  type Grade,
} from "../src/fsrs";

const NOW = new Date("2026-05-16T00:00:00.000Z");

test("newCard is a fresh New-state card due now", () => {
  const c = newCard(NOW);
  assert.equal(c.state, 0);
  assert.equal(c.reps, 0);
  assert.equal(c.lapses, 0);
  assert.equal(c.stability, 0);
  assert.equal(c.due.getTime(), NOW.getTime());
});

test("write then read round-trips losslessly, including last_review", () => {
  const c = schedule(newCard(NOW), "good", NOW); // has last_review set
  const fm: Record<string, unknown> = {};
  writeCardToFrontmatter(fm, c);
  const back = readCardFromFrontmatter(fm);

  assert.equal(back.stability, c.stability);
  assert.equal(back.difficulty, c.difficulty);
  assert.equal(back.reps, c.reps);
  assert.equal(back.lapses, c.lapses);
  assert.equal(back.state, c.state);
  assert.equal(back.due.getTime(), c.due.getTime());
  assert.equal(back.last_review?.getTime(), c.last_review?.getTime());
});

test("absent last_review is not invented and key is cleared", () => {
  const fm: Record<string, unknown> = { "ir-last-review": "stale" };
  writeCardToFrontmatter(fm, newCard(NOW));
  assert.equal(fm["ir-last-review"], undefined);
  assert.equal(readCardFromFrontmatter(fm).last_review, undefined);
});

test("read tolerates missing and garbage frontmatter", () => {
  const fromNull = readCardFromFrontmatter(null);
  assert.ok(fromNull.due instanceof Date);
  assert.equal(Number.isFinite(fromNull.stability), true);

  const garbage = readCardFromFrontmatter({
    "ir-stability": "nope",
    "ir-due": "not-a-date",
    "ir-reps": NaN,
  });
  assert.equal(Number.isFinite(garbage.stability), true);
  assert.ok(garbage.due instanceof Date);
  assert.equal(Number.isNaN(garbage.due.getTime()), false);
});

test("every grade reschedules forward and counts the rep", () => {
  for (const g of ["again", "hard", "good", "easy"] as Grade[]) {
    const next = schedule(newCard(NOW), g, NOW);
    assert.ok(
      next.due.getTime() > NOW.getTime(),
      `${g} should push due into the future`,
    );
    assert.equal(next.reps, 1);
    assert.equal(next.last_review?.getTime(), NOW.getTime());
  }
});
