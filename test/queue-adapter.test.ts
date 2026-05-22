import { test } from "node:test";
import assert from "node:assert/strict";
import { dueMsOf, scheduleToTopicState, topicStateToSchedule } from "../src/ir/queue-adapter";
import type { IrElement, ReadSchedule } from "../src/ir/model";
import type { ElementId } from "../src/ir/ids";

function makeElement(overrides: Partial<IrElement> = {}): IrElement {
  return {
    id: "el-1" as ElementId,
    type: "topic",
    priority: 50,
    parentId: null,
    dismissed: false,
    created: 0,
    text: "",
    anchorState: "ok",
    ...overrides,
  } as IrElement;
}

/* ------------------------------------------------------------------ */
/* dueMsOf                                                             */
/* ------------------------------------------------------------------ */

test("dueMsOf: topic with schedule returns schedule.due", () => {
  const el = makeElement({ type: "topic", schedule: { due: 1000, interval: 1, aFactor: 2 } });
  assert.equal(dueMsOf(el), 1000);
});

test("dueMsOf: extract with schedule returns schedule.due", () => {
  const el = makeElement({ type: "extract", schedule: { due: 2000, interval: 3, aFactor: 1.5 } });
  assert.equal(dueMsOf(el), 2000);
});

test("dueMsOf: item with card returns card.due", () => {
  const el = makeElement({
    type: "item",
    card: { due: 3000, stability: 1, difficulty: 5, elapsedDays: 0, scheduledDays: 1, reps: 0, lapses: 0, state: 0 },
  });
  assert.equal(dueMsOf(el), 3000);
});

test("dueMsOf: topic without schedule returns NaN", () => {
  const el = makeElement({ type: "topic" });
  assert.ok(Number.isNaN(dueMsOf(el)));
});

test("dueMsOf: item without card returns NaN", () => {
  const el = makeElement({ type: "item" });
  assert.ok(Number.isNaN(dueMsOf(el)));
});

/* ------------------------------------------------------------------ */
/* scheduleToTopicState                                                */
/* ------------------------------------------------------------------ */

test("scheduleToTopicState: undefined returns null", () => {
  assert.equal(scheduleToTopicState(undefined), null);
});

test("scheduleToTopicState: maps fields correctly", () => {
  const s: ReadSchedule = { due: 5000, interval: 7, aFactor: 2.5 };
  const ts = scheduleToTopicState(s);
  assert.ok(ts);
  assert.equal(ts.dueMs, 5000);
  assert.equal(ts.interval, 7);
  assert.equal(ts.aFactor, 2.5);
});

/* ------------------------------------------------------------------ */
/* topicStateToSchedule                                                */
/* ------------------------------------------------------------------ */

test("topicStateToSchedule: maps fields correctly", () => {
  const ts = { dueMs: 8000, interval: 14, aFactor: 1.8 };
  const s = topicStateToSchedule(ts);
  assert.equal(s.due, 8000);
  assert.equal(s.interval, 14);
  assert.equal(s.aFactor, 1.8);
});

test("topicStateToSchedule + scheduleToTopicState roundtrip", () => {
  const original = { dueMs: 42000, interval: 30, aFactor: 3.0 };
  const schedule = topicStateToSchedule(original);
  const back = scheduleToTopicState(schedule);
  assert.deepEqual(back, original);
});
