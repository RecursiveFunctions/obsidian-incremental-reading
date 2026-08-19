import { test } from "node:test";
import assert from "node:assert/strict";
import { spacebarReviewAction } from "../src/ir/review-keys";

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
