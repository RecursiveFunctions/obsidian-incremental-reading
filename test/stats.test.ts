/**
 * Golden contract for src/ir/stats.ts (v0.2 "Statistics": daily reviews,
 * retention, queue size, due count). Pure aggregation over the ledger's
 * elements plus the review-history grade events.
 *
 * Claude-authored, fenced out of scope. Skips until the module exists;
 * computed specifier keeps tsc green.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { newElement } from "../src/ir/model";
import type { IrElement } from "../src/ir/model";
import type { ElementId } from "../src/ir/ids";

const SPEC = ["..", "src", "ir", "stats.ts"].join("/");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function load(): Promise<any> {
  try {
    return await import(SPEC);
  } catch {
    return null;
  }
}

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;
const WINDOW_START = NOW - DAY;

function withCard(id: string, due: number, dismissed = false): IrElement {
  const e = newElement({
    id: id as ElementId,
    type: "item",
    priority: 50,
    now: 0,
  });
  e.card = {
    due,
    stability: 1,
    difficulty: 5,
    elapsedDays: 0,
    scheduledDays: 1,
    reps: 1,
    lapses: 0,
    state: 2,
  };
  e.dismissed = dismissed;
  return e;
}

function withSchedule(id: string, due: number): IrElement {
  const e = newElement({
    id: id as ElementId,
    type: "topic",
    priority: 50,
    now: 0,
  });
  e.schedule = { due, interval: 3, aFactor: 2 };
  return e;
}

function world(): IrElement[] {
  return [
    withCard("el_due1", NOW - 10), // due (card.due <= now)
    withCard("el_due2", NOW - 5), // due
    withCard("el_future", NOW + DAY), // not due
    withCard("el_dismissed", NOW - 1, true), // dismissed: excluded everywhere
    withSchedule("el_topic_due", NOW - 2), // due (schedule)
    withSchedule("el_topic_future", NOW + DAY), // not due
    newElement({
      id: "el_bare" as ElementId,
      type: "extract",
      priority: 50,
      now: 0,
    }), // no card/schedule: not in queue
  ];
}

// grade: 1 Again, 2 Hard, 3 Good, 4 Easy. recalled = grade >= 2.
function grades() {
  return [
    { ts: NOW - 100, grade: 1 }, // in window, lapse
    { ts: NOW - 200, grade: 3 }, // in window, recalled
    { ts: NOW - 300, grade: 4 }, // in window, recalled
    { ts: WINDOW_START - 1, grade: 4 }, // before window: excluded
    { ts: NOW + 50, grade: 3 }, // after now: excluded
  ];
}

test("computeStats: counts and retention", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/stats.ts not implemented yet");

  const s = m.computeStats(world(), grades(), NOW, WINDOW_START);
  assert.equal(s.total, 7); // every element, dismissed included
  // queue = non-dismissed elements with a card or a schedule:
  // el_due1, el_due2, el_future, el_topic_due, el_topic_future = 5
  assert.equal(s.queueSize, 5);
  // due = non-dismissed AND (card.due<=now OR schedule.due<=now):
  // el_due1, el_due2, el_topic_due = 3
  assert.equal(s.dueCount, 3);
  // in-window grades: the three with ts in [WINDOW_START, NOW]
  assert.equal(s.reviewsInWindow, 3);
  // recalled (grade>=2) = 2 of 3 -> 0.6667 (4 dp)
  assert.equal(s.retention, 0.6667);
});

test("computeStats: empty grade log -> retention 0, no divide-by-zero", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/stats.ts not implemented yet");

  const s = m.computeStats(world(), [], NOW, WINDOW_START);
  assert.equal(s.reviewsInWindow, 0);
  assert.equal(s.retention, 0);
});

test("computeStats: deterministic", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/stats.ts not implemented yet");
  assert.equal(
    JSON.stringify(m.computeStats(world(), grades(), NOW, WINDOW_START)),
    JSON.stringify(m.computeStats(world(), grades(), NOW, WINDOW_START)),
  );
});

test("startOfLocalDayMs: midnight of the local day", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/stats.ts not implemented yet");
  const now = new Date(2026, 4, 19, 15, 30, 45, 123).getTime();
  const start = m.startOfLocalDayMs(now);
  const d = new Date(start);
  assert.equal(d.getHours(), 0);
  assert.equal(d.getMinutes(), 0);
  assert.equal(d.getSeconds(), 0);
  assert.equal(d.getMilliseconds(), 0);
  assert.equal(d.getDate(), 19);
});

test("gradeSpark: 14 days, today in last bucket, older excluded", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/stats.ts not implemented yet");
  const now = new Date(2026, 4, 19, 15, 0, 0, 0).getTime();
  const today = m.startOfLocalDayMs(now);
  const spark = m.gradeSpark(
    [
      { ts: today + 1, grade: 3 },
      { ts: today + 2, grade: 4 },
      { ts: today - DAY, grade: 2 },
      { ts: today - 14 * DAY, grade: 3 },
    ],
    now,
    14,
  );
  assert.equal(spark.length, 14);
  assert.equal(spark[13], 2);
  assert.equal(spark[12], 1);
  assert.equal(spark[0], 0);
});

// --- forecast / dueByType / gradeBreakdown (stats view v2) ---

test("forecast: buckets future dues by local day, overdue kept separate", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/stats.ts not implemented yet");
  const now = new Date(2026, 4, 19, 15, 0, 0, 0).getTime();
  const today = m.startOfLocalDayMs(now);
  const fc = m.forecast(
    [
      withCard("el_overdue", now - DAY),
      withCard("el_today_later", now + 60 * 60 * 1000),
      withCard("el_tomorrow", today + DAY + 60 * 60 * 1000),
      withCard("el_tomorrow2", today + DAY + 2 * 60 * 60 * 1000),
      withSchedule("el_day6", today + 6 * DAY + 1000),
      withCard("el_beyond", today + 9 * DAY),
    ],
    now,
    7,
  );
  assert.equal(fc.byDay.length, 7);
  assert.equal(fc.byDay[0], 1, "later today");
  assert.equal(fc.byDay[1], 2, "tomorrow");
  assert.equal(fc.byDay[6], 1, "day 6");
  assert.equal(fc.overdue, 1);
  assert.equal(fc.windowTotal, 4, "beyond the window is not counted");
});

test("forecast: dismissed and unscheduled elements are invisible", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/stats.ts not implemented yet");
  const now = new Date(2026, 4, 19, 15, 0, 0, 0).getTime();
  const today = m.startOfLocalDayMs(now);
  const fc = m.forecast(
    [
      withCard("el_dismissed", today + DAY, true),
      newElement({
        id: "el_bare" as ElementId,
        type: "extract",
        priority: 50,
        now: 0,
      }),
    ],
    now,
    7,
  );
  assert.equal(fc.windowTotal, 0);
  assert.equal(fc.overdue, 0);
});

test("dueByType: splits due elements by type, skips future and dismissed", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/stats.ts not implemented yet");
  const byType = m.dueByType(world(), NOW);
  assert.equal(byType.item, 2);
  assert.equal(byType.topic, 1);
  assert.equal(byType.extract, 0);
});

test("gradeBreakdown: counts each grade inside the window only", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/stats.ts not implemented yet");
  const b = m.gradeBreakdown(
    [
      { ts: NOW - 100, grade: 1 },
      { ts: NOW - 100, grade: 2 },
      { ts: NOW - 100, grade: 3 },
      { ts: NOW - 100, grade: 3 },
      { ts: NOW - 100, grade: 4 },
      { ts: NOW - 5 * DAY, grade: 3 },
      { ts: NOW + DAY, grade: 3 },
    ],
    WINDOW_START,
    NOW,
  );
  assert.deepEqual(b, { again: 1, hard: 1, good: 2, easy: 1 });
});

test("activityHeatmap counts graded + reading topic-advanced and excludes undone & extract-parent-decay", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/stats.ts not implemented yet");
  const now = new Date(2026, 4, 19, 15, 0, 0, 0).getTime();
  const today = m.startOfLocalDayMs(now);
  const events = [
    { id: "g1", ts: today + 1000, lamport: 1, device: "d", kind: "graded", target: "e1", payload: { grade: 3 } },
    { id: "g2", ts: today + 2000, lamport: 2, device: "d", kind: "graded", target: "e1", payload: { grade: 1 } },
    { id: "u1", ts: today + 2500, lamport: 3, device: "d", kind: "grade-undone", target: "e1", payload: { eventId: "g2" } },
    { id: "r1", ts: today - DAY + 1000, lamport: 4, device: "d", kind: "topic-advanced", target: "t1", payload: {} },
    { id: "r2", ts: today - DAY + 2000, lamport: 5, device: "d", kind: "topic-advanced", target: "t1", payload: { operation: "extract-parent-decay" } },
    { id: "r3", ts: today - DAY + 3000, lamport: 6, device: "d", kind: "topic-advanced", target: "t1", payload: { operation: "later-today" } },
  ];

  const hm = m.activityHeatmap(events, now, 26);
  assert.equal(hm.days.length, 26 * 7);
  assert.equal(hm.totalCount, 2);
  assert.equal(hm.activeDays, 2);
  assert.equal(hm.days[hm.days.length - 1].grades, 1);
  assert.equal(hm.days[hm.days.length - 2].reads, 1);
});

test("rollingTrueRetention excludes first unmemorized rep & undone grades across rolling window", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/stats.ts not implemented yet");
  const now = new Date(2026, 4, 19, 15, 0, 0, 0).getTime();
  const today = m.startOfLocalDayMs(now);
  const freshEl = withCard("el1", today);
  freshEl.card!.reps = 0;
  const events = [
    { id: "c1", ts: today - 10 * DAY, lamport: 1, device: "d", kind: "element-created", target: "el1", payload: { element: freshEl } },
    // First unmemorized rep (Again) -> excluded from True Retention!
    { id: "g0", ts: today - 3 * DAY + 100, lamport: 2, device: "d", kind: "graded", target: "el1", payload: { grade: 1, card: { reps: 1 } } },
    // Second rep (Good) -> counted as passed!
    { id: "g1", ts: today - 2 * DAY + 100, lamport: 3, device: "d", kind: "graded", target: "el1", payload: { grade: 3, card: { reps: 2 } } },
    // Third rep (Again) -> counted as failed!
    { id: "g2", ts: today + 100, lamport: 4, device: "d", kind: "graded", target: "el1", payload: { grade: 1, card: { reps: 3 } } },
  ];

  const tr = m.rollingTrueRetention(events, now, 30, 7);
  assert.equal(tr.totalReviewReps, 2);
  assert.equal(tr.totalPassedReps, 1);
  assert.equal(tr.overallRetention, 0.5);
  assert.equal(tr.points.length, 30);
  assert.equal(tr.points[29].retention, 0.5);
  assert.equal(tr.points[27].retention, 1);
});
