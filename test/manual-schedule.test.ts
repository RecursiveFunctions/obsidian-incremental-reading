import { test } from "node:test";
import assert from "node:assert/strict";
import { planManualSchedule } from "../src/ir/manual-schedule";
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
