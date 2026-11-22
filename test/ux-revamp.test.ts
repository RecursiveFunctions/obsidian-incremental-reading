import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveViewportCapability,
  resolveWidthTier,
  resolveUnifiedMobileHubEnabled,
  shouldLatchHardwareKeyboard,
} from "../src/ir/viewport-tiers";
import {
  SELECTION_COLLAPSE_GRACE_MS,
  TouchSelectionModel,
} from "../src/ir/touch-selection";
import { computeElementTelemetry } from "../src/ir/element-telemetry";
import {
  buildActionablePriorityFiBuckets,
  formatReviewsPerReadingSummary,
} from "../src/ir/stats-presenter";
import { escapeReviewAction } from "../src/ir/review-escape";
import { irWorkspaceFabShouldShow } from "../src/ir/mobile-hub";
import { computeElementHistoryCounts } from "../src/ir/mercy";
import { activityHeatmap } from "../src/ir/stats";
import { fold } from "../src/ir/log";
import { findLeeches } from "../src/ir/leech";
import { newElement, type IrElement, type IrEvent } from "../src/ir/model";
import type { DeviceId, ElementId, EventId } from "../src/ir/ids";

const NOW = 1_760_000_000_000;
const DAY_MS = 86_400_000;
const DEV = "dev_ux" as DeviceId;

test("viewport-tiers (#65): maps container width + pointer + physical keyboard into orthogonal capability tiers", () => {
  assert.equal(resolveWidthTier(375, true), "compact");
  assert.equal(resolveWidthTier(639, false), "compact");
  assert.equal(resolveWidthTier(640, true), "medium");
  assert.equal(resolveWidthTier(960, true), "medium");
  assert.equal(resolveWidthTier(961, true), "expanded");
  assert.equal(resolveWidthTier(0, true), "compact");
  assert.equal(resolveWidthTier(0, false), "medium");

  // Phone: touch targets ON, hotkeys OFF, source sheet
  assert.deepEqual(
    resolveViewportCapability({
      inlineWidthPx: 390,
      coarsePointer: true,
      latchedHardwareKeyboard: false,
    }),
    {
      tier: "compact",
      touchTargets: true,
      showHotkeys: false,
      sourceLayout: "sheet",
    },
  );

  // iPad Pro landscape + Magic Keyboard: touch targets ON, hotkeys ON, resizable split
  assert.deepEqual(
    resolveViewportCapability({
      inlineWidthPx: 1180,
      coarsePointer: true,
      latchedHardwareKeyboard: true,
    }),
    {
      tier: "expanded",
      touchTargets: true,
      showHotkeys: true,
      sourceLayout: "resizable-split",
    },
  );

  // Narrow desktop split: fine pointer, hotkeys ON, compact sheet so controls never clip
  assert.deepEqual(
    resolveViewportCapability({
      inlineWidthPx: 420,
      coarsePointer: false,
      latchedHardwareKeyboard: false,
    }),
    {
      tier: "compact",
      touchTargets: false,
      showHotkeys: true,
      sourceLayout: "sheet",
    },
  );

  // IME keyCode 229 / composing / typing inside input does NOT latch hardware keyboard
  assert.equal(shouldLatchHardwareKeyboard({ key: "a" }, true), false);
  assert.equal(shouldLatchHardwareKeyboard({ key: "Unidentified", keyCode: 229 }, false), false);
  assert.equal(shouldLatchHardwareKeyboard({ key: "e", isComposing: true }, false), false);
  // Pressing shortcut outside editable or with modifier latches hardware keyboard
  assert.equal(shouldLatchHardwareKeyboard({ key: " " }, false), true);
  assert.equal(shouldLatchHardwareKeyboard({ key: "x", altKey: true }, true), true);

  // Unified mobile hub setting migration
  assert.equal(resolveUnifiedMobileHubEnabled({ mobileWorkspaceFab: false, mobileShell: true }), false);
  assert.equal(resolveUnifiedMobileHubEnabled({ mobileShell: false, mobileCaptureFab: false, mobileReviewFab: true }), true);
  assert.equal(resolveUnifiedMobileHubEnabled({ mobileShell: false, mobileCaptureFab: false, mobileReviewFab: false }), false);
  assert.equal(irWorkspaceFabShouldShow(true), true);
  assert.equal(irWorkspaceFabShouldShow(true, true, true), false);
});

test("TouchSelectionModel (#65): buffers WebKit 350ms collapse race and prevents cross-surface multi-span holds", () => {
  const model = new TouchSelectionModel();
  const slotId = "el_topic_1" as ElementId;

  model.updateLiveSelection({
    slotId,
    surface: "main",
    text: "First span",
    offsets: { start: 10, end: 20 },
    capturedAtMs: 1_000,
  });

  // WebKit collapses selection on pointerdown at t=1_120 (within 350ms grace window)
  model.notifySelectionCollapsed(1_120);
  const recovered = model.resolveForAction(slotId, 1_200, true);
  assert.equal(recovered?.text, "First span");

  // Hold first span on "main"
  assert.equal(model.holdSnapshot(recovered!), true);
  assert.equal(model.getHeldCount(slotId), 1);

  // Selecting on "context" while holding a "main" span blocks cross-surface hold
  const ctxSnap = {
    slotId,
    surface: "context" as const,
    text: "Parent span",
    offsets: { start: 0, end: 11 },
    capturedAtMs: 2_000,
  };
  assert.equal(model.canHoldSnapshot(ctxSnap).ok, false);
  assert.equal(model.holdSnapshot(ctxSnap), false);

  // Expired collapse (>350ms) discards stale snapshot
  model.clearAll();
  model.updateLiveSelection({
    slotId,
    surface: "main",
    text: "Ephemeral",
    offsets: { start: 0, end: 9 },
    capturedAtMs: 5_000,
  });
  assert.equal(
    model.resolveForAction(slotId, 5_000 + SELECTION_COLLAPSE_GRACE_MS + 50, true),
    null,
  );
});

test("computeElementTelemetry & Escape hierarchy (#62): computes item/reading diagnostics and excludes a-factor-edit from reps", () => {
  // Escape closes telemetry drawer before exiting edit / neural / detaching
  assert.deepEqual(
    escapeReviewAction({
      sessionComplete: false,
      emptyVault: false,
      editing: true,
      isNeural: true,
      telemetryOpen: true,
    }),
    { kind: "close-telemetry" },
  );

  const topic: IrElement = {
    ...newElement({
      id: "t_root" as ElementId,
      type: "topic",
      priority: 20,
      now: NOW - 10 * DAY_MS,
      notePath: "Reading/Root.md",
      text: "One two three four five.",
    }),
    schedule: { due: NOW - DAY_MS, interval: 4, aFactor: 1.8 },
  };
  const childExtract: IrElement = {
    ...newElement({
      id: "e_child" as ElementId,
      type: "extract",
      parentId: topic.id,
      priority: 15,
      now: NOW - 5 * DAY_MS,
      text: "Child extract",
    }),
    schedule: { due: NOW, interval: 2, aFactor: 1.5 },
  };
  const item: IrElement = {
    ...newElement({
      id: "i_card" as ElementId,
      type: "item",
      parentId: topic.id,
      priority: 10,
      now: NOW - 5 * DAY_MS,
      notePath: "Reading/Item.md",
      text: "{{c1::SM-20}} uses SInc.",
    }),
    card: {
      due: NOW,
      stability: 12,
      difficulty: 4.5,
      elapsedDays: 10,
      scheduledDays: 10,
      reps: 4,
      lapses: 1,
      state: 2,
      lastReview: NOW - 10 * DAY_MS,
    },
  };

  const all = [topic, childExtract, item];
  const itemTel = computeElementTelemetry({
    element: item,
    allElements: all,
    nowMs: NOW,
    rawBodyText: item.text,
    activeScheduler: "sm20",
    requestRetention: 0.9,
  });
  assert.equal(itemTel.kind, "item");
  assert.equal(itemTel.priorityRank, 1);
  assert.equal(itemTel.totalActive, 3);
  assert.ok(itemTel.retrievabilityPct !== null && itemTel.retrievabilityPct > 0 && itemTel.retrievabilityPct <= 100);
  assert.equal(itemTel.stabilityDays, 12);
  assert.ok(itemTel.sincFactor !== null && itemTel.sincFactor >= 1.05);
  assert.ok(itemTel.predictedGoodDays.sm20 > 0);
  assert.ok(itemTel.predictedGoodDays.fsrs > 0);

  const topicTel = computeElementTelemetry({
    element: topic,
    allElements: all,
    nowMs: NOW,
    rawBodyText: "Alpha beta gamma delta epsilon",
    activeScheduler: "sm20",
    requestRetention: 0.9,
    nextReadingIntervalDays: 7.2,
  });
  assert.equal(topicTel.kind, "reading");
  assert.equal(topicTel.wordCount, 5);
  assert.equal(topicTel.childExtractCount, 1);
  assert.equal(topicTel.childItemCount, 1);
  assert.equal(topicTel.aFactor, 1.8);
  assert.equal(topicTel.nextIntervalDays, 7.2);

  // Verify operation: "a-factor-edit" does NOT increment readingReps, heatmap, or clear leech streak
  const events: IrEvent[] = [
    {
      id: "ev_c" as EventId,
      ts: NOW - 10 * DAY_MS,
      lamport: 1,
      device: DEV,
      kind: "element-created",
      target: topic.id,
      payload: { element: topic },
    },
    ...Array.from({ length: 8 }, (_, idx) => ({
      id: `ev_p_${idx}` as EventId,
      ts: NOW - (8 - idx) * DAY_MS,
      lamport: 2 + idx,
      device: DEV,
      kind: "mercy-postponed" as const,
      target: topic.id,
      payload: { newDue: NOW - (7 - idx) * DAY_MS, batchId: `b_${idx}` },
    })),
    {
      id: "ev_af" as EventId,
      ts: NOW - 1_000,
      lamport: 20,
      device: DEV,
      kind: "topic-advanced",
      target: topic.id,
      payload: {
        schedule: { due: NOW - DAY_MS, interval: 4, aFactor: 2.2 },
        operation: "a-factor-edit",
      },
    },
  ];

  const counts = computeElementHistoryCounts(events).get(topic.id);
  assert.deepEqual(counts, {
    readingReps: 0,
    totalPostponeCount: 8,
    recentPostponeCount: 8,
  });
  assert.equal(activityHeatmap(events, NOW, 26).totalCount, 0);
  assert.equal(findLeeches(fold(events), events).length, 1);
});

test("stats-presenter (#63, #64): computes actionable Priority FI buckets and Reviews-per-reading ratio copy", () => {
  const itemHighFail = newElement({
    id: "i_high" as ElementId,
    type: "item",
    priority: 12,
    now: NOW,
    text: "Q",
  });
  const itemOk = newElement({
    id: "i_ok" as ElementId,
    type: "item",
    priority: 52,
    now: NOW,
    text: "Q2",
  });

  const grades = [
    // 10-15% bucket: 3 failures out of 6 reviews = 50% FI (> 10% + 5% -> elevated)
    { grade: 1, priority: 11 },
    { grade: 1, priority: 12 },
    { grade: 1, priority: 14 },
    { grade: 3, priority: 12 },
    { grade: 3, priority: 13 },
    { grade: 4, priority: 14 },
    // 50-55% bucket: 0 failures out of 6 reviews = 0% FI (-> ok)
    { grade: 3, priority: 51 },
    { grade: 3, priority: 52 },
    { grade: 3, priority: 53 },
    { grade: 4, priority: 52 },
    { grade: 3, priority: 54 },
    { grade: 3, priority: 50 },
  ];

  const buckets = buildActionablePriorityFiBuckets(grades, [itemHighFail, itemOk], 0.9, 5);
  assert.equal(buckets.length, 2);
  assert.equal(buckets[0]!.start, 10);
  assert.equal(buckets[0]!.status, "elevated");
  assert.deepEqual(buckets[0]!.activeItemIds, [itemHighFail.id]);
  assert.equal(buckets[1]!.start, 50);
  assert.equal(buckets[1]!.status, "ok");
  assert.deepEqual(buckets[1]!.activeItemIds, [itemOk.id]);

  // Reviews-per-reading live summary + custom override preservation
  const std3 = formatReviewsPerReadingSummary(3, { preset: "balanced", readingProportion: 0.25 });
  assert.equal(std3.hasCustomOverride, false);
  assert.match(std3.description, /25% reading, 75% items/);

  const custom37 = formatReviewsPerReadingSummary(3, { preset: "custom", readingProportion: 0.37 });
  assert.equal(custom37.hasCustomOverride, true);
  assert.match(custom37.description, /Custom reading proportion active \(37% reading/);
});
