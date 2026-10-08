import { test } from "node:test";
import assert from "node:assert/strict";
import { reprioritizationAction } from "../src/ir/reprioritization";
import { DEFAULT_SETTINGS } from "../src/ir/settings-data";

const policy = DEFAULT_SETTINGS.reprioritizationPolicy;

test("repeated failure suggests only at the configured threshold", () => {
  assert.equal(reprioritizationAction("repeated-failure", policy, { consecutiveFailures: 2 }), "off");
  assert.equal(reprioritizationAction("repeated-failure", policy, { consecutiveFailures: 3 }), "suggest");
});

test("ordinary early success is off by default", () => {
  assert.equal(reprioritizationAction("early-success", policy, { successfulReviews: 1 }), "off");
});

test("completion and large batches suggest without mutating priority", () => {
  assert.equal(reprioritizationAction("article-completion", policy, { articleCompleted: true }), "suggest");
  assert.equal(reprioritizationAction("large-batch", policy, { batchSize: 10 }), "suggest");
});

test("suppressed triggers remain off", () => {
  assert.equal(reprioritizationAction("article-completion", policy,
    { articleCompleted: true }, new Set(["article-completion"])), "off");
});
