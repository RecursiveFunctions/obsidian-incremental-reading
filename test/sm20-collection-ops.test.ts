import assert from "node:assert/strict";
import { test } from "node:test";
import {
  auditAndRepairCollectionIntegrity,
  computeSpreadPrioritiesSchedule,
  countActiveElementFilterRules,
  matchesElementFilter,
  planSubsetSearchAndReplace,
  type Sm20ElementFilter,
} from "../src/ir/sm20-collection-ops";
import { newDeviceId, newElementId, newEventId } from "../src/ir/ids";
import { newElement, validateIrEvent, type IrElement, type IrEvent } from "../src/ir/model";

const NOW = 1_760_000_000_000;
const DAY_MS = 86_400_000;
const DEV = newDeviceId();

test("TElementFilter (0x00ca7040) filters across priority, interval, stability, difficulty, R%, reps, lapses, A-Factor, and due window", () => {
  const itemEasy: IrElement = {
    ...newElement({ id: newElementId(), type: "item", priority: 15, now: NOW }),
    card: {
      due: NOW + 5 * DAY_MS,
      stability: 20,
      difficulty: 3,
      elapsedDays: 5,
      scheduledDays: 20,
      reps: 4,
      lapses: 0,
      state: 2,
      lastReview: NOW - 2 * DAY_MS,
    },
  };
  const itemHard: IrElement = {
    ...newElement({ id: newElementId(), type: "item", priority: 65, now: NOW }),
    card: {
      due: NOW - DAY_MS,
      stability: 3,
      difficulty: 8.5,
      elapsedDays: 4,
      scheduledDays: 3,
      reps: 7,
      lapses: 4,
      state: 3,
      lastReview: NOW - 4 * DAY_MS,
    },
  };
  const topicRead: IrElement = {
    ...newElement({ id: newElementId(), type: "topic", priority: 30, now: NOW }),
    schedule: { due: NOW + 2 * DAY_MS, interval: 6, aFactor: 1.8 },
  };

  const fLapses: Sm20ElementFilter = {
    lapses: { min: 2 },
    difficulty10: { min: 7, max: 10 },
  };
  assert.equal(countActiveElementFilterRules(fLapses), 2);
  assert.equal(matchesElementFilter(itemHard, fLapses, NOW), true);
  assert.equal(matchesElementFilter(itemEasy, fLapses, NOW), false);
  assert.equal(matchesElementFilter(topicRead, fLapses, NOW), false);

  const fAFactor: Sm20ElementFilter = {
    aFactor: { min: 1.5, max: 2.0 },
    intervalDays: { min: 5, max: 10 },
  };
  assert.equal(matchesElementFilter(topicRead, fAFactor, NOW), true);
  assert.equal(matchesElementFilter(itemEasy, fAFactor, NOW), false);
});

test("planSubsetSearchAndReplace (0x00b797e0) plans case-sensitive/insensitive & whole-word replacements and guards noop", () => {
  const e1: IrElement = {
    ...newElement({ id: newElementId(), type: "item", priority: 20, now: NOW }),
    text: "Mitochondria produce ATP; mitochondria have mtDNA.",
  };
  const e2: IrElement = {
    ...newElement({ id: newElementId(), type: "extract", priority: 30, now: NOW }),
    text: "Chloroplast stroma reactions.",
  };

  assert.equal(planSubsetSearchAndReplace([e1, e2], "ATP", "ATP").totalReplacements, 0);
  assert.equal(planSubsetSearchAndReplace([e1, e2], "", "X").totalReplacements, 0);

  const planInsensitive = planSubsetSearchAndReplace([e1, e2], "mitochondria", "organelle", {
    caseSensitive: false,
  });
  assert.equal(planInsensitive.matches.length, 1);
  assert.equal(planInsensitive.totalReplacements, 2);
  assert.equal(planInsensitive.matches[0]!.afterText, "organelle produce ATP; organelle have mtDNA.");

  const planSensitive = planSubsetSearchAndReplace([e1, e2], "Mitochondria", "Organelle", {
    caseSensitive: true,
  });
  assert.equal(planSensitive.totalReplacements, 1);
  assert.equal(planSensitive.matches[0]!.afterText, "Organelle produce ATP; mitochondria have mtDNA.");
});

test("computeSpreadPrioritiesSchedule (0x00d4e980) clamps/swaps bounds, handles equal min/max, and preserves order", () => {
  const els = [
    newElement({ id: newElementId(), type: "topic", priority: 80, now: NOW }),
    newElement({ id: newElementId(), type: "extract", priority: 10, now: NOW }),
    newElement({ id: newElementId(), type: "item", priority: 45, now: NOW }),
  ];

  // Reversed bounds (90..10) auto-swap per 0x00d4e980
  const spread = computeSpreadPrioritiesSchedule(els, {
    minPriority: 90,
    maxPriority: 10,
  });
  assert.equal(spread.updates.length, 3);
  assert.equal(spread.updates[0]!.elementId, els[1]!.id);
  assert.equal(spread.updates[0]!.newPriority, 10);
  assert.equal(spread.updates[1]!.elementId, els[2]!.id);
  assert.equal(spread.updates[1]!.newPriority, 50);
  assert.equal(spread.updates[2]!.elementId, els[0]!.id);
  assert.equal(spread.updates[2]!.newPriority, 90);

  // Equal bounds (50..50) expand ±0.1 per 0x00d4e980
  const tight = computeSpreadPrioritiesSchedule(els, {
    minPriority: 50,
    maxPriority: 50,
  });
  assert.ok(tight.minPriority < 50 && tight.maxPriority > 50);
});

test("auditAndRepairCollectionIntegrity (0x00d32f50, 0x00d0cdc0) detects and repairs orphan parent, cycle, unscheduled topic, and card drift", () => {
  const orphanId = newElementId();
  const missingParentId = newElementId();
  const cycA = newElementId();
  const cycB = newElementId();
  const unschedTopicId = newElementId();
  const driftedItemId = newElementId();

  const orphan: IrElement = {
    ...newElement({ id: orphanId, type: "extract", priority: 20, now: NOW }),
    parentId: missingParentId,
    schedule: { due: NOW, interval: 2, aFactor: 2 },
  };
  const elCycA: IrElement = {
    ...newElement({ id: cycA, type: "topic", priority: 30, now: NOW }),
    parentId: cycB,
    schedule: { due: NOW, interval: 2, aFactor: 2 },
  };
  const elCycB: IrElement = {
    ...newElement({ id: cycB, type: "extract", priority: 35, now: NOW }),
    parentId: cycA,
    schedule: { due: NOW, interval: 2, aFactor: 2 },
  };
  const unschedTopic: IrElement = {
    ...newElement({ id: unschedTopicId, type: "topic", priority: 40, now: NOW }),
  };
  delete unschedTopic.schedule;

  const driftedItem: IrElement = {
    ...newElement({ id: driftedItemId, type: "item", priority: 50, now: NOW }),
    card: {
      due: NOW + 5 * DAY_MS,
      stability: 5,
      difficulty: 5,
      elapsedDays: 5,
      scheduledDays: 5,
      reps: 99, // Drifted vs actual 1 graded event
      lapses: 8,
      state: 2,
      lastReview: NOW - 5 * DAY_MS,
    },
  };

  const evGraded1: IrEvent = {
    id: newEventId(),
    ts: NOW - 2 * DAY_MS,
    lamport: 1,
    device: DEV,
    kind: "graded",
    target: driftedItemId,
    payload: {
      card: {
        due: NOW + 5 * DAY_MS,
        stability: 5,
        difficulty: 5,
        elapsedDays: 0,
        scheduledDays: 5,
        reps: 1,
        lapses: 0,
        state: 2,
        lastReview: NOW - 2 * DAY_MS,
      },
      grade: 3,
      smGrade: 4,
    },
  };
  // Backwardly rescheduled timestamp on later lamport (0x00d0cdc0)
  const evGradedBackward: IrEvent = {
    id: newEventId(),
    ts: NOW - 10 * DAY_MS,
    lamport: 2,
    device: DEV,
    kind: "graded",
    target: driftedItemId,
    payload: {
      card: {
        ...driftedItem.card!,
        reps: 1,
        lapses: 0,
        lastReview: NOW - 10 * DAY_MS,
      },
      grade: 3,
      smGrade: 4,
    },
  };

  const elementsMap = new Map<string, IrElement>([
    [orphan.id, orphan],
    [elCycA.id, elCycA],
    [elCycB.id, elCycB],
    [unschedTopic.id, unschedTopic],
    [driftedItem.id, driftedItem],
  ]);

  const report = auditAndRepairCollectionIntegrity({
    elements: elementsMap,
    events: [evGraded1, evGradedBackward],
    nowMs: NOW,
    device: DEV,
    startingLamport: 10,
  });

  assert.equal(report.counts.orphanParents, 1);
  assert.equal(report.counts.parentCycles, 1);
  assert.equal(report.counts.missingSchedules, 1);
  assert.equal(report.counts.historyAnomalies, 1);
  assert.equal(report.counts.cardCounterDrifts, 1);
  assert.ok(report.repairEvents.length >= 4);
  for (const ev of report.repairEvents) {
    assert.equal(validateIrEvent(ev), null);
  }
});
