/**
 * Golden contract for the StoredCard <-> ts-fsrs Card conversion added to
 * src/fsrs.ts (Task 5). Claude-authored, fenced out of the delegated scope.
 *
 * The existing frontmatter helpers in src/fsrs.ts stay (their own test still
 * runs); this task only ADDS the store-native conversion. Removal of the
 * frontmatter path is task #6.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { newCard, schedule, cardToStored, storedToCard } from "../src/fsrs";

test("cardToStored maps fields and dates to epoch ms", () => {
  const c = newCard(new Date("2026-05-18T00:00:00.000Z"));
  const s = cardToStored(c);
  assert.equal(s.due, c.due.getTime());
  assert.equal(s.stability, c.stability);
  assert.equal(s.difficulty, c.difficulty);
  assert.equal(s.elapsedDays, c.elapsed_days);
  assert.equal(s.scheduledDays, c.scheduled_days);
  assert.equal(s.reps, c.reps);
  assert.equal(s.lapses, c.lapses);
  assert.equal(s.state, c.state);
});

test("a fresh card has no lastReview in its stored form", () => {
  const s = cardToStored(newCard(new Date("2026-05-18T00:00:00.000Z")));
  assert.equal(s.lastReview, undefined);
  assert.equal("lastReview" in s && s.lastReview !== undefined, false);
});

test("round-trip Card -> Stored -> Card preserves a fresh card", () => {
  const c = newCard(new Date("2026-05-18T00:00:00.000Z"));
  assert.deepEqual(storedToCard(cardToStored(c)), c);
});

test("round-trip preserves last_review on a scheduled card", () => {
  const reviewed = schedule(
    newCard(new Date("2026-05-18T00:00:00.000Z")),
    "good",
    new Date("2026-05-18T12:00:00.000Z"),
  );
  assert.ok(reviewed.last_review instanceof Date);
  const back = storedToCard(cardToStored(reviewed));
  assert.deepEqual(back, reviewed);
  assert.equal(
    back.last_review?.getTime(),
    reviewed.last_review?.getTime(),
  );
});

test("round-trip Stored -> Card -> Stored is stable", () => {
  const s0 = cardToStored(
    schedule(newCard(new Date("2026-05-18T00:00:00.000Z")), "hard"),
  );
  assert.deepEqual(cardToStored(storedToCard(s0)), s0);
});

test("storedToCard defends against missing input with a fresh card", () => {
  const c = storedToCard(undefined);
  assert.equal(c.reps, 0);
  assert.equal(c.lapses, 0);
  assert.equal(c.state, 0); // New
  assert.equal(c.last_review, undefined);
});
