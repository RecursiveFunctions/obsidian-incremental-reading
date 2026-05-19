/**
 * Golden contract for src/ir/stats.ts (v0.2 "Statistics": daily reviews,
 * retention, queue size, due count). Pure aggregation over the store's
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
