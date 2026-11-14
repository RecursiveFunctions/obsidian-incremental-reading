/**
 * Golden contract for src/ir/mercy.ts (DESIGN.md section 6: principled
 * postpone / overload redistribution).
 *
 * Pure queue split: it NEVER touches scheduler state, it only decides
 * which due elements stay due today and which are pushed forward.
 * Claude-authored, fenced out of the delegated scope. Skips until the
 * module exists so `npm test` stays green; computed specifier keeps tsc
 * from failing on the missing module.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MERCY_WEIGHTS,
  computeElementHistoryCounts,
  computeMercyOrdinals,
  planAdvancedPostpone,
  planAutoPostpone,
  planMercy,
  redistribute,
  resolveBranchDelay,
  typicalInterval,
} from "../src/ir/mercy";
import { buildMercyLoadChart } from "../src/ir/mercy-chart";

const NOW = 1000;
const PAST = 500;
const FUTURE = 5000;

// a,b,c,d are due now; e is not yet due and must never appear anywhere.
const entries = () => [
  { id: "a", priority: 10, dueMs: PAST },
  { id: "b", priority: 20, dueMs: PAST },
  { id: "c", priority: 30, dueMs: PAST },
  { id: "d", priority: 40, dueMs: PAST },
  { id: "e", priority: 5, dueMs: FUTURE },
];

test("under ceiling: everything due stays, nothing postponed", () => {
  const r = redistribute(entries(), NOW, {
    ceiling: 10,
    priorityCutoff: 0,
  });
  assert.deepEqual(r.dueToday, ["a", "b", "c", "d"]);
  assert.deepEqual(r.postponed, []);
  assert.equal(r.postponedCount, 0);
});

test("over ceiling: lowest-importance overflow is postponed in order", () => {
  const r = redistribute(entries(), NOW, {
    ceiling: 2,
    priorityCutoff: 15,
  });
  assert.deepEqual(r.dueToday, ["a", "b"]);
  assert.deepEqual(r.postponed, ["c", "d"]);
  assert.equal(r.postponedCount, 2);
});

test("never postpone at or below the priority cutoff", () => {
  const r = redistribute(entries(), NOW, {
    ceiling: 1,
    priorityCutoff: 25,
  });
  assert.deepEqual(r.dueToday, ["a", "b"]);
  assert.deepEqual(r.postponed, ["c", "d"]);
  assert.equal(r.postponedCount, 2);
});

test("not-yet-due entries are excluded from both lists", () => {
  const r = redistribute(entries(), NOW, {
    ceiling: 2,
    priorityCutoff: 0,
  });
  const all = [...r.dueToday, ...r.postponed];
  assert.ok(!all.includes("e"), "future-due entry must not appear");
});

test("deterministic (identical result on re-run)", () => {
  const opts = { ceiling: 2, priorityCutoff: 15 };
  const x = JSON.stringify(redistribute(entries(), NOW, opts));
  const y = JSON.stringify(redistribute(entries(), NOW, opts));
  assert.equal(x, y);
});

test("planner accounts for existing future load and spills across days", () => {
  const now = new Date(2026, 0, 10, 12).getTime();
  const tomorrow = new Date(2026, 0, 11, 9).getTime();
  const r = planMercy(
    [
      { id: "a", priority: 1, dueMs: now - 3 },
      { id: "b", priority: 20, dueMs: now - 2 },
      { id: "c", priority: 30, dueMs: now - 1 },
      { id: "future", priority: 50, dueMs: tomorrow },
    ],
    now,
    { ceiling: 1, priorityCutoff: 0 },
  );
  assert.equal(r.assignments[0]!.targetLocalDate, "2026-01-12");
  assert.equal(r.assignments[1]!.targetLocalDate, "2026-01-13");
});

test("planner preserves due clock time and does not mutate inputs", () => {
  const now = new Date(2026, 2, 7, 18, 0).getTime();
  const due = new Date(2026, 2, 7, 8, 45, 30, 12).getTime();
  const input = [
    { id: "keep", priority: 1, dueMs: due - 1 },
    { id: "move", priority: 50, dueMs: due },
  ];
  const copy = structuredClone(input);
  const r = planMercy(input, now, { ceiling: 1, priorityCutoff: 0 });
  const moved = new Date(r.assignments[0]!.newDue);
  assert.deepEqual([moved.getHours(), moved.getMinutes(), moved.getSeconds(), moved.getMilliseconds()], [8, 45, 30, 12]);
  assert.deepEqual(input, copy);
});

test("auto-postpone protects work newly due today", () => {
  const now = new Date(2026, 0, 10, 12).getTime();
  const yesterday = new Date(2026, 0, 9, 9).getTime();
  const today = new Date(2026, 0, 10, 8).getTime();
  const plan = planAutoPostpone([
    { id: "keep", priority: 1, dueMs: yesterday },
    { id: "move", priority: 50, dueMs: yesterday },
    { id: "today", priority: 99, dueMs: today },
  ], now, { keepOverdue: 1, priorityCutoff: 0 });
  assert.deepEqual(plan.dueToday, ["keep", "today"]);
  assert.deepEqual(plan.postponed, ["move"]);
});

test("auto-postpone never includes future or dismissed work", () => {
  const now = new Date(2026, 0, 10, 12).getTime();
  const plan = planAutoPostpone([
    { id: "old", priority: 50, dueMs: now - 86_400_000 },
    { id: "future", priority: 1, dueMs: now + 1 },
    { id: "dismissed", priority: 99, dueMs: now - 86_400_000, dismissed: true },
  ], now, { keepOverdue: 0, priorityCutoff: 0 });
  assert.deepEqual(plan.postponed, ["old"]);
});

test("advanced postpone applies bounds, inclusion, and skip rules", () => {
  const plan = planAdvancedPostpone([
    { id: "item", type: "item", priority: 50, dueMs: NOW, interval: 10 },
    { id: "reading", type: "reading", priority: 50, dueMs: NOW, interval: 10 },
    { id: "protected", type: "item", priority: 5, dueMs: NOW, interval: 10 },
  ], NOW, {
    operation: "postpone", includeItems: true, includeReading: false,
    itemDelayFactor: 2, readingDelayFactor: 1, minDelayDays: 2, maxDelayDays: 7,
    skipPriorityAtOrBelow: 10,
  });
  assert.deepEqual(plan.assignments.map((assignment) => assignment.id), ["item"]);
  assert.deepEqual(plan.skippedIds, ["reading"]);
  assert.deepEqual(plan.protectedIds, ["protected"]);
});

test("branch delay resolution supports every policy mode", () => {
  assert.equal(resolveBranchDelay(5, 9, "respect"), 9);
  assert.equal(resolveBranchDelay(5, 9, "ignore"), 5);
  assert.equal(resolveBranchDelay(5, 9, "conservative"), 5);
  assert.equal(resolveBranchDelay(5, 9, "liberal"), 9);
});

test("typicalInterval matches baseline interval table vectors", () => {
  assert.ok(Math.abs(typicalInterval(1) - 2.484) < 1e-9);
  assert.ok(Math.abs(typicalInterval(2) - 2.9808) < 1e-9);
  assert.ok(Math.abs(typicalInterval(5) - 5.1508224) < 1e-9);
  assert.ok(Math.abs(typicalInterval(20) - 79.35883184366267) < 1e-9);
  assert.equal(typicalInterval(0), typicalInterval(1));
  assert.equal(typicalInterval(30), typicalInterval(20));
});

test("computeMercyOrdinals matches 5-dimension reference vectors", () => {
  const v1 = computeMercyOrdinals(DEFAULT_MERCY_WEIGHTS, [
    { importance: 0.05, lateness: 1, investment: 0.0, easiness: 0.5 },
  ]);
  assert.ok(Math.abs(v1[0]! - 0.565417329774) < 1e-9);

  const v2 = computeMercyOrdinals(DEFAULT_MERCY_WEIGHTS, [
    { importance: 0.5, lateness: 30, investment: 100.0, easiness: 0.8 },
  ]);
  assert.ok(Math.abs(v2[0]! - 0.281561713755) < 1e-9);

  const v3 = computeMercyOrdinals(DEFAULT_MERCY_WEIGHTS, [
    { importance: 1.0, lateness: 1, investment: 500.0, easiness: 0.9 },
  ]);
  assert.ok(Math.abs(v3[0]! - 0.170641489496) < 1e-9);

  const zero = computeMercyOrdinals(
    { importance: 0, lateness: 0, easiness: 0, investment: 0, recency: 0, mode: 3 },
    [{ importance: 0.5, lateness: 10, investment: 5, easiness: 0.5 }],
  );
  assert.equal(zero[0], 0.0);

  assert.throws(
    () => computeMercyOrdinals(DEFAULT_MERCY_WEIGHTS, [
      { importance: 0.5, lateness: -2, investment: 0, easiness: 0.5 },
    ]),
    /negative/,
  );
});

test("computeElementHistoryCounts tracks readingReps, totalPostponeCount, and resets recentPostponeCount on grade or topic-advanced", () => {
  const counts = computeElementHistoryCounts([
    { id: "e1", lamport: 1, kind: "mercy-postponed", target: "itemA", payload: { batchId: "b1" } },
    { id: "e2", lamport: 2, kind: "mercy-postponed", target: "itemA", payload: { batchId: "b2" } },
    { id: "e3", lamport: 3, kind: "graded", target: "itemA", payload: {} },
    { id: "e4", lamport: 4, kind: "mercy-postponed", target: "itemA", payload: { batchId: "b3" } },
    { id: "e5", lamport: 5, kind: "mercy-postponed", target: "itemA", payload: { batchId: "b4" } },
    { id: "e6", lamport: 6, kind: "mercy-undone", target: "itemA", payload: { batchId: "b4" } },
    { id: "e7", lamport: 7, kind: "topic-advanced", target: "topicB", payload: {} },
    { id: "e8", lamport: 8, kind: "mercy-postponed", target: "topicB", payload: { batchId: "b5" } },
    { id: "e9", lamport: 9, kind: "topic-advanced", target: "topicB", payload: {} },
  ]);
  assert.deepEqual(counts.get("itemA"), {
    readingReps: 0,
    totalPostponeCount: 3,
    recentPostponeCount: 1,
  });
  assert.deepEqual(counts.get("topicB"), {
    readingReps: 2,
    totalPostponeCount: 1,
    recentPostponeCount: 0,
  });
});

test("planMercy with multi-factor weights protects high-investment difficult items over fresh easy items", () => {
  const now = new Date(2026, 0, 10, 12).getTime();
  const due = now - 5 * 86_400_000;
  // 'freshEasy' has slightly better flat priority (25 vs 30), but 0 reps and very easy (difficulty 1).
  // 'investedHard' has 50 reps and high difficulty (9.5), so its multi-factor Mercy ordinal is much lower (keep today).
  const entries = [
    { id: "freshEasy", priority: 25, dueMs: due, reps: 0, difficulty: 1.0, interval: 1 },
    { id: "investedHard", priority: 30, dueMs: due, reps: 50, difficulty: 9.5, interval: 30 },
  ];
  const flatPlan = planMercy(entries, now, { ceiling: 1, priorityCutoff: 0 });
  assert.deepEqual(flatPlan.dueToday, ["freshEasy"]);
  assert.deepEqual(flatPlan.postponed, ["investedHard"]);

  const weightedPlan = planMercy(entries, now, {
    ceiling: 1,
    priorityCutoff: 0,
    weights: DEFAULT_MERCY_WEIGHTS,
  });
  assert.deepEqual(weightedPlan.dueToday, ["investedHard"]);
  assert.deepEqual(weightedPlan.postponed, ["freshEasy"]);
});

test("buildMercyLoadChart separates existing scheduled load from newly postponed overflow across 14 days", () => {
  const now = new Date(2026, 0, 10, 12).getTime();
  const tomorrow = new Date(2026, 0, 11, 9).getTime();
  const dayAfter = new Date(2026, 0, 12, 9).getTime();
  const entries = [
    { id: "due1", priority: 5, dueMs: now - 4000 },
    { id: "due2", priority: 30, dueMs: now - 3000 },
    { id: "due3", priority: 40, dueMs: now - 2000 },
    { id: "due4", priority: 50, dueMs: now - 1000 },
    { id: "fut1", priority: 20, dueMs: tomorrow },
    { id: "fut2", priority: 25, dueMs: tomorrow },
    { id: "fut3", priority: 35, dueMs: dayAfter },
  ];
  const plan = planMercy(entries, now, { ceiling: 2, priorityCutoff: 0 });
  const chart = buildMercyLoadChart(plan, now, 2, 14);

  assert.equal(chart.days.length, 14);
  assert.equal(chart.maxCount, 2);
  assert.equal(chart.ceilingPct, 100);

  // Tomorrow (2026-01-11) already has 2 existing items (at ceiling), so 0 postponed land there.
  const d1 = chart.days[0]!;
  assert.equal(d1.date, "2026-01-11");
  assert.equal(d1.existingCount, 2);
  assert.equal(d1.postponedCount, 0);
  assert.equal(d1.totalCount, 2);
  assert.equal(d1.existingPct, 100);
  assert.equal(d1.postponedPct, 0);
  assert.equal(d1.overCeiling, false);

  // Day 2 (2026-01-12) has 1 existing item and gets 1 postponed item to reach ceiling=2.
  const d2 = chart.days[1]!;
  assert.equal(d2.date, "2026-01-12");
  assert.equal(d2.existingCount, 1);
  assert.equal(d2.postponedCount, 1);
  assert.equal(d2.totalCount, 2);
  assert.equal(d2.existingPct, 50);
  assert.equal(d2.postponedPct, 50);

  // Day 3 (2026-01-13) has 0 existing items and gets the remaining 1 postponed item.
  const d3 = chart.days[2]!;
  assert.equal(d3.date, "2026-01-13");
  assert.equal(d3.existingCount, 0);
  assert.equal(d3.postponedCount, 1);
  assert.equal(d3.totalCount, 1);
  assert.equal(d3.existingPct, 0);
  assert.equal(d3.postponedPct, 50);
});
