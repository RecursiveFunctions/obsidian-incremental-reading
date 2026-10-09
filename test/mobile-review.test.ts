import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mobileGradeLabels,
  type MobileReviewConfig,
} from "../src/ir/mobile-review-logic";

test("mobileGradeLabels: comfortable mode", () => {
  const labels = mobileGradeLabels(false);
  assert.equal(labels.again, "Again");
  assert.equal(labels.hard, "Hard");
  assert.equal(labels.good, "Good");
  assert.equal(labels.easy, "Easy");
});

test("mobileGradeLabels: compact mode", () => {
  const labels = mobileGradeLabels(true);
  assert.equal(labels.again, "Again");
  assert.equal(labels.hard, "Hard");
  assert.equal(labels.good, "Good");
  assert.equal(labels.easy, "Easy");
});

test("MobileReviewConfig: full layout", () => {
  const config: MobileReviewConfig = {
    layout: "full",
    fontSize: 1,
    buttons: "comfortable",
  };
  assert.equal(config.layout, "full");
  assert.equal(config.fontSize, 1);
  assert.equal(config.buttons, "comfortable");
});

test("MobileReviewConfig: minimal layout with compact buttons", () => {
  const config: MobileReviewConfig = {
    layout: "minimal",
    fontSize: 0.9,
    buttons: "compact",
  };
  assert.equal(config.layout, "minimal");
  assert.equal(config.fontSize, 0.9);
  assert.equal(config.buttons, "compact");
});
