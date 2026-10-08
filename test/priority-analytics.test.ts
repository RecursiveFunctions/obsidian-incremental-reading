import { test } from "node:test";
import assert from "node:assert/strict";
import type { ElementId } from "../src/ir/ids";
import {
  forgettingIndexByPriority,
  mergeAnalyticsSessions,
  priorityProtection,
  type DailyPriorityAnalytics,
} from "../src/ir/priority-analytics";

const id = (value: string) => value as ElementId;
const day: DailyPriorityAnalytics = {
  schemaVersion: 1,
  deviceId: "device",
  dayKey: "2026-10-08",
  createdAt: 1,
  utcOffsetMinutes: 0,
  policyVersion: 1,
  due: [
    { id: id("i1"), priority: 5, type: "item" },
    { id: id("i2"), priority: 20, type: "item" },
    { id: id("r1"), priority: 10, type: "reading" },
  ],
  sessions: [{ id: "s", mode: "due", processedIds: [id("i1")], skippedIds: [], remainingIds: [id("i2"), id("r1")] }],
};

test("priority protection reports highest-priority outstanding per type", () => {
  assert.deepEqual(priorityProtection(day), {
    item: 20,
    reading: 10,
    itemOutstanding: 1,
    readingOutstanding: 1,
    itemProcessed: 1,
    readingProcessed: 0,
  });
});

test("analytics sessions merge idempotently by session and element IDs", () => {
  const merged = mergeAnalyticsSessions([
    { id: "s", mode: "due", processedIds: [id("a")], skippedIds: [], remainingIds: [id("b")] },
    { id: "s", mode: "due", processedIds: [id("a"), id("b")], skippedIds: [id("c")], remainingIds: [] },
  ]);
  assert.deepEqual(merged[0]?.processedIds, [id("a"), id("b")]);
  assert.deepEqual(merged[0]?.skippedIds, [id("c")]);
});

test("forgetting index buckets exact priority snapshots and treats Again as failure", () => {
  assert.deepEqual(forgettingIndexByPriority([
    { grade: 1, priority: 4 },
    { grade: 3, priority: 7 },
    { grade: 1, priority: 25 },
    { grade: 1 },
  ]), [
    { start: 0, end: 10, failures: 1, samples: 2, rate: 0.5 },
    { start: 20, end: 30, failures: 1, samples: 1, rate: 1 },
  ]);
});
