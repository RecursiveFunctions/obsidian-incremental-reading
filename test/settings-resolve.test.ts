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

test("resolveSettings defaults Collection to Priority and migrates hierarchy to Sources", () => {
  assert.equal(resolveSettings(null).treeDisplayMode, "priority");
  assert.equal(resolveSettings({ treeDisplayMode: "hierarchy" } as never).treeDisplayMode, "sources");
  assert.equal(resolveSettings({ treeDisplayMode: "sources" } as never).treeDisplayMode, "sources");
});

test("resolveSettings syncs readingProportion from reviewsPerReading when readingProportion is still default (#29)", () => {
  const initial = resolveSettings(null);
  assert.equal(initial.reviewsPerReading, 3);
  assert.equal(initial.sortingPolicy.readingProportion, 0.25);

  // Simulate user changing reviewsPerReading to 10 on a vault that already has default sortingPolicy saved
  const saved = {
    ...initial,
    reviewsPerReading: 10,
  };
  const reloaded = resolveSettings(saved);
  assert.ok(Math.abs(reloaded.sortingPolicy.readingProportion - 1 / 11) < 1e-12);
});

test("resolveSettings defaults fresh installs to sm20 and grandfathers existing installs to fsrs with one-time offer pending", () => {
  const fresh = resolveSettings(null);
  assert.equal(fresh.primaryScheduler, "sm20");
  assert.equal(fresh.notices.sm20SchedulerOffer, true);

  const existingLegacy = resolveSettings({ reviewsPerReading: 3 });
  assert.equal(existingLegacy.primaryScheduler, "fsrs");
  assert.equal(existingLegacy.notices.sm20SchedulerOffer, false);

  const existingDeclined = resolveSettings({
    primaryScheduler: "fsrs",
    notices: { sm20SchedulerOffer: true } as never,
  });
  assert.equal(existingDeclined.primaryScheduler, "fsrs");
  assert.equal(existingDeclined.notices.sm20SchedulerOffer, true);

  const existingSwitched = resolveSettings({
    primaryScheduler: "sm20",
    notices: { sm20SchedulerOffer: true } as never,
  });
  assert.equal(existingSwitched.primaryScheduler, "sm20");
  assert.equal(existingSwitched.notices.sm20SchedulerOffer, true);
});
