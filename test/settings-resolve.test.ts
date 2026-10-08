import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSettings, resolveShowDivergencePicker } from "../src/ir/settings-resolve";

test("resolveShowDivergencePicker: new install (no data.json) is off", () => {
  assert.equal(resolveShowDivergencePicker(null), false);
  assert.equal(resolveShowDivergencePicker(undefined), false);
});

test("resolveShowDivergencePicker: existing install without the key stays on", () => {
  assert.equal(
    resolveShowDivergencePicker({} as { showDivergencePicker?: boolean }),
    true,
  );
  assert.equal(
    resolveShowDivergencePicker({ autoMarkSourceAsTopic: true } as {
      showDivergencePicker?: boolean;
    }),
    true,
  );
});

test("resolveShowDivergencePicker: explicit false stays off", () => {
  assert.equal(resolveShowDivergencePicker({ showDivergencePicker: false }), false);
});

test("resolveShowDivergencePicker: explicit true stays on", () => {
  assert.equal(resolveShowDivergencePicker({ showDivergencePicker: true }), true);
});

test("resolveSettings migrates legacy queue and mercy values", () => {
  const settings = resolveSettings({
    reviewsPerReading: 4,
    interleaveSimilarPriority: false,
    mercyCeiling: 12,
    mercyPriorityCutoff: 7,
  } as never);
  assert.equal(settings.sortingPolicy.readingProportion, 0.2);
  assert.equal(settings.sortingPolicy.itemJitter, 0);
  assert.equal(settings.sortingPolicy.readingJitter, 0);
  assert.equal(settings.autoPostponePolicy.enabled, false);
  assert.equal(settings.autoPostponePolicy.keepOverdue, 12);
  assert.equal(settings.autoPostponePolicy.priorityCutoff, 7);
});

test("resolveSettings deep-merges and clamps partial grouped settings", () => {
  const settings = resolveSettings({
    sortingPolicy: { itemJitter: 9, readingProportion: -1 },
    prioritySchedulingPolicy: { enabled: true, itemHighRetention: 2 },
  } as never);
  assert.equal(settings.sortingPolicy.itemJitter, 1);
  assert.equal(settings.sortingPolicy.readingProportion, 0);
  assert.equal(settings.sortingPolicy.readingJitter, 0.3);
  assert.equal(settings.prioritySchedulingPolicy.enabled, true);
  assert.equal(settings.prioritySchedulingPolicy.itemHighRetention, 0.99);
  assert.equal(settings.prioritySchedulingPolicy.itemLowRetention, 0.85);
});
