import { test } from "node:test";
import assert from "node:assert/strict";
import { parseJumpIntervalInput, planManualSchedule } from "../src/ir/manual-schedule";
import { newElement } from "../src/ir/model";
import type { ElementId } from "../src/ir/ids";

test("manual item reschedule changes due and interval without review state", () => {
  const element = newElement({ id: "item" as ElementId, type: "item", priority: 50, now: 0 });
  element.card = { due: 1, stability: 2, difficulty: 3, elapsedDays: 4,
    scheduledDays: 8, reps: 9, lapses: 1, state: 2 };
  const plan = planManualSchedule(element, 100, 4, 1)!;
  assert.equal(plan.card?.due, 100);
  assert.equal(plan.card?.scheduledDays, 4);
  assert.equal(plan.card?.reps, 9);
  assert.ok(plan.priorityAfter < plan.priorityBefore);
});

test("manual reading reschedule preserves base A-Factor", () => {
  const element = newElement({ id: "topic" as ElementId, type: "topic", priority: 50, now: 0 });
  element.schedule = { due: 1, interval: 8, aFactor: 2.4 };
  const plan = planManualSchedule(element, 100, 16, 1)!;
  assert.equal(plan.schedule?.aFactor, 2.4);
  assert.equal(plan.schedule?.interval, 16);
  assert.ok(plan.priorityAfter > plan.priorityBefore);
});

test("parseJumpIntervalInput parses day counts and YYYY-MM-DD dates", () => {
  const now = new Date(2026, 10, 19, 10, 0, 0).getTime();
  const byDays = parseJumpIntervalInput("14", now);
  assert.equal(byDays?.intervalDays, 14);

  const byDate = parseJumpIntervalInput("2026-11-29", now);
  assert.equal(byDate?.intervalDays, 10);

  assert.equal(parseJumpIntervalInput("0", now), null);
  assert.equal(parseJumpIntervalInput("2026-11-18", now), null);
  assert.equal(parseJumpIntervalInput("not-a-date", now), null);
});

test("JumpInterval adjusts topic A-Factor via adjustTopicAFactor and optionally disperses", () => {
  const element = newElement({ id: "topic2" as ElementId, type: "topic", priority: 50, now: 0 });
  element.schedule = { due: 1, interval: 4, aFactor: 2.0 };
  const jumpedUp = planManualSchedule(element, 100 * 86_400_000, 100, {
    nowMs: 0,
    adjustAFactor: true,
  })!;
  assert.ok(jumpedUp.schedule!.aFactor > 2.0);

  const dispersed = planManualSchedule(element, 100 * 86_400_000, 100, {
    nowMs: 0,
    disperseRng: () => 0.9,
  })!;
  assert.ok(dispersed.newInterval !== 100);
});
