import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifySwipeDirection,
  mobileSwipeCoachShowCount,
  reviewSwipeMode,
  resetMobileReviewTips,
  shouldShowMobileSwipeCoach,
  swipeHintLabel,
  swipeOutcomeFor,
  touchStartsInEdgeDeadZone,
} from "../src/ir/review-touch-gestures";

test("resetMobileReviewTips clears device-local swipe coaching keys", () => {
  const removed: string[] = [];
  resetMobileReviewTips({ removeItem: (key: string) => removed.push(key) });
  assert.deepEqual(removed, [
    "incremental-reading:swipe-legend-seen",
    "incremental-reading:swipe-coach-shown",
  ]);
});

test("mobile swipe coach: parses its device-local display count defensively", () => {
  assert.equal(mobileSwipeCoachShowCount(null), 0);
  assert.equal(mobileSwipeCoachShowCount("bad"), 0);
  assert.equal(mobileSwipeCoachShowCount("2"), 2);
});

test("mobile swipe coach: stops after three displays or dismissal", () => {
  assert.equal(shouldShowMobileSwipeCoach(false, 0), true);
  assert.equal(shouldShowMobileSwipeCoach(false, 2), true);
  assert.equal(shouldShowMobileSwipeCoach(false, 3), false);
  assert.equal(shouldShowMobileSwipeCoach(true, 0), false);
});

test("touchStartsInEdgeDeadZone: rejects left and right edges", () => {
  assert.equal(touchStartsInEdgeDeadZone(10, 400), true);
  assert.equal(touchStartsInEdgeDeadZone(390, 400), true);
  assert.equal(touchStartsInEdgeDeadZone(200, 400), false);
});

test("classifySwipeDirection: picks horizontal when dominant", () => {
  assert.equal(classifySwipeDirection(-60, 5), "left");
  assert.equal(classifySwipeDirection(60, 5), "right");
});

test("classifySwipeDirection: leaves vertical movement to scrolling", () => {
  assert.equal(classifySwipeDirection(5, -60), null);
  assert.equal(classifySwipeDirection(5, 60), null);
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

test("swipeOutcomeFor: nav mode maps horizontal directions", () => {
  assert.deepEqual(swipeOutcomeFor("nav", "left"), {
    kind: "nav",
    action: "previous",
  });
  assert.deepEqual(swipeOutcomeFor("nav", "right"), {
    kind: "nav",
    action: "next",
  });
});

test("swipeOutcomeFor: grade mode maps horizontal shortcuts", () => {
  assert.deepEqual(swipeOutcomeFor("grade", "left"), {
    kind: "grade",
    grade: "again",
  });
  assert.deepEqual(swipeOutcomeFor("grade", "right"), {
    kind: "grade",
    grade: "good",
  });
});

test("swipeHintLabel: arrows point in the direction that produces the outcome", () => {
  assert.equal(
    swipeHintLabel({ kind: "grade", grade: "good" }),
    "Good →",
  );
  assert.equal(
    swipeHintLabel({ kind: "grade", grade: "again" }),
    "← Again",
  );
  assert.equal(
    swipeHintLabel({ kind: "nav", action: "previous" }),
    "← Previous",
  );
});
