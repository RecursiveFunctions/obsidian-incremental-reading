import assert from "node:assert/strict";
import { test } from "node:test";
import { mobileReviewControlLabel } from "../src/ir/mobile-review-control";

test("mobile review control: names a fresh queue and caps its due count", () => {
  assert.equal(mobileReviewControlLabel(7, false), "Review · 7");
  assert.equal(mobileReviewControlLabel(120, false), "Review · 99+");
});

test("mobile review control: names the resume action or an empty queue", () => {
  assert.equal(mobileReviewControlLabel(7, true), "Resume · 7");
  assert.equal(mobileReviewControlLabel(0, true), "Review");
});
