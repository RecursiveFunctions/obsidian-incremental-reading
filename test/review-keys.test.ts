import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canGradeInSession,
  restoreDismissedSlot,
  spacebarReviewAction,
  spliceDismissedSlot,
} from "../src/ir/review-keys";

test("spacebar: typing never hijacks the key", () => {
  assert.deepEqual(
    spacebarReviewAction({
      isReading: false,
      revealed: true,
      typing: true,
      spaceAfterReveal: "good",
    }),
    { kind: "none" },
  );
});

test("spacebar: reading cards still advance", () => {
  assert.deepEqual(
    spacebarReviewAction({
      isReading: true,
      revealed: false,
      typing: false,
      spaceAfterReveal: "good",
    }),
    { kind: "next" },
  );
});

test("spacebar: unrevealed cloze reveals first", () => {
  assert.deepEqual(
    spacebarReviewAction({
      isReading: false,
      revealed: false,
      typing: false,
      spaceAfterReveal: "good",
    }),
    { kind: "reveal" },
  );
});

test("spacebar: after reveal grades the configured rating", () => {
  assert.deepEqual(
    spacebarReviewAction({
      isReading: false,
      revealed: true,
      typing: false,
      spaceAfterReveal: "good",
    }),
    { kind: "grade", grade: "good" },
  );
  assert.deepEqual(
    spacebarReviewAction({
      isReading: false,
      revealed: true,
      typing: false,
      spaceAfterReveal: "easy",
    }),
    { kind: "grade", grade: "easy" },
  );
});

test("spacebar: off after reveal does not grade", () => {
  assert.deepEqual(
    spacebarReviewAction({
      isReading: false,
      revealed: true,
      typing: false,
      spaceAfterReveal: "off",
    }),
    { kind: "none" },
  );
});

test("canGradeInSession blocks duplicate grading after Previous until Undo (#33)", () => {
  const graded = new Set<string>();
  assert.equal(canGradeInSession("card_1", graded), true);

  // First Grade records the slot id
  graded.add("card_1");
  // Stepping back via Previous and pressing Grade again is blocked
  assert.equal(canGradeInSession("card_1", graded), false);
  // Other slots remain gradable
  assert.equal(canGradeInSession("card_2", graded), true);

  // Undo removes the slot id so the card can be graded again
  graded.delete("card_1");
  assert.equal(canGradeInSession("card_1", graded), true);
});

test("spliceDismissedSlot and restoreDismissedSlot prevent Previous from resurfacing dismissed cards (#33)", () => {
  const initial = ["card_a", "card_b", "card_c"];

  // Dismiss middle card (index 1): queue becomes [card_a, card_c], nextIndex stays 1 (card_c)
  const afterDismiss = spliceDismissedSlot(initial, 1);
  assert.equal(afterDismiss.removed, "card_b");
  assert.deepEqual(afterDismiss.queue, ["card_a", "card_c"]);
  assert.equal(afterDismiss.nextIndex, 1);
  assert.equal(afterDismiss.queue[afterDismiss.nextIndex], "card_c");

  // Pressing Previous from index 1 steps back to index 0 (card_a), never card_b
  const prevIndex = afterDismiss.nextIndex - 1;
  assert.equal(afterDismiss.queue[prevIndex], "card_a");

  // Undo restores card_b at index 1
  const afterUndo = restoreDismissedSlot(afterDismiss.queue, 1, "card_b");
  assert.deepEqual(afterUndo.queue, ["card_a", "card_b", "card_c"]);
  assert.equal(afterUndo.restoredIndex, 1);
  assert.equal(afterUndo.queue[afterUndo.restoredIndex], "card_b");

  // Dismissing first card (index 0): nextIndex is 0 (card_b), Previous at index 0 is at start
  const dismissFirst = spliceDismissedSlot(initial, 0);
  assert.deepEqual(dismissFirst.queue, ["card_b", "card_c"]);
  assert.equal(dismissFirst.nextIndex, 0);
});
