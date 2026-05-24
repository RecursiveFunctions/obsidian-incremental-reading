import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifySwipeDirection,
  reviewSwipeMode,
  swipeHintLabel,
  swipeOutcomeFor,
  touchStartsInEdgeDeadZone,
} from "../src/ir/review-touch-gestures";

test("touchStartsInEdgeDeadZone: rejects left and right edges", () => {
  assert.equal(touchStartsInEdgeDeadZone(10, 400), true);
  assert.equal(touchStartsInEdgeDeadZone(390, 400), true);
  assert.equal(touchStartsInEdgeDeadZone(200, 400), false);
});

test("classifySwipeDirection: picks horizontal when dominant", () => {
  assert.equal(classifySwipeDirection(-60, 5), "left");
  assert.equal(classifySwipeDirection(60, 5), "right");
});

test("classifySwipeDirection: picks vertical when dominant", () => {
  assert.equal(classifySwipeDirection(5, -60), "up");
  assert.equal(classifySwipeDirection(5, 60), "down");
});

test("classifySwipeDirection: returns null when too short or ambiguous", () => {
  assert.equal(classifySwipeDirection(10, 10), null);
  assert.equal(classifySwipeDirection(40, 35), null);
});

test("reviewSwipeMode: reading vs cloze-hidden vs grade", () => {
  assert.equal(reviewSwipeMode(true, false, false), "reading");
  assert.equal(reviewSwipeMode(false, true, false), "nav");
  assert.equal(reviewSwipeMode(false, true, true), "grade");
  assert.equal(reviewSwipeMode(false, false, false), "grade");
});

test("swipeOutcomeFor: nav mode maps cardinals", () => {
  assert.deepEqual(swipeOutcomeFor("nav", "left"), {
    kind: "nav",
    action: "previous",
  });
  assert.deepEqual(swipeOutcomeFor("nav", "right"), {
    kind: "nav",
    action: "next",
  });
  assert.deepEqual(swipeOutcomeFor("nav", "up"), {
    kind: "nav",
    action: "reveal",
  });
  assert.equal(swipeOutcomeFor("nav", "down"), null);
});

test("swipeOutcomeFor: grade mode maps Anki cardinals", () => {
  assert.deepEqual(swipeOutcomeFor("grade", "left"), {
    kind: "grade",
    grade: "again",
  });
  assert.deepEqual(swipeOutcomeFor("grade", "down"), {
    kind: "grade",
    grade: "hard",
  });
  assert.deepEqual(swipeOutcomeFor("grade", "right"), {
    kind: "grade",
    grade: "good",
  });
  assert.deepEqual(swipeOutcomeFor("grade", "up"), {
    kind: "grade",
    grade: "easy",
  });
});

test("swipeOutcomeFor: reading treats up as next", () => {
  assert.deepEqual(swipeOutcomeFor("reading", "up"), {
    kind: "nav",
    action: "next",
  });
});

test("swipeHintLabel: includes arrow suffix", () => {
  assert.equal(
    swipeHintLabel({ kind: "grade", grade: "good" }),
    "Good →",
  );
  assert.equal(
    swipeHintLabel({ kind: "nav", action: "reveal" }),
    "Show answer →",
  );
});
