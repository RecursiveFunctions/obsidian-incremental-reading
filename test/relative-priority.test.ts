import { test } from "node:test";
import assert from "node:assert/strict";
import type { ElementId } from "../src/ir/ids";
import { newElement, validateIrEvent, type IrEvent } from "../src/ir/model";
import {
  applyPriorityPlacement,
  buildPriorityPlacement,
  buildPositionPlacement,
  formatPriority,
  insertionIndexForPriority,
  collectionSortOrder,
  planAdjacentBlockMove,
  planAdjust,
  planBlockInsertion,
  planMultiplierChange,
  planSpread,
  positionForPriority,
  previewPriorityPlacement,
  priorityForPosition,
  projectRelativePriorities,
} from "../src/ir/relative-priority";

const id = (value: string) => value as ElementId;
const element = (value: string, priority: number, created: number) =>
  newElement({ id: id(value), type: "topic", priority, now: created });

test("collectionSortOrder resolves ties newest-first then by id", () => {
  assert.deepEqual(collectionSortOrder([
    element("old", 20, 1),
    element("b", 20, 2),
    element("a", 20, 2),
    element("first", 10, 0),
  ]), [id("first"), id("a"), id("b"), id("old")]);
});

test("percentage maps to the final collection index", () => {
  assert.equal(insertionIndexForPriority(0, 11), 0);
  assert.equal(insertionIndexForPriority(10, 11), 1);
  assert.equal(insertionIndexForPriority(10.9, 11), 1);
  assert.equal(insertionIndexForPriority(100, 11), 10);
});

test("one-based positions and percentages stay synchronized", () => {
  assert.equal(positionForPriority(50, 5), 3);
  assert.equal(priorityForPosition(3, 5), 50);
  assert.equal(priorityForPosition(-2, 5), 0);
  assert.equal(priorityForPosition(99, 5), 100);
  assert.deepEqual(buildPositionPlacement([
    element("a", 0, 1), element("b", 50, 1), element("c", 100, 1),
  ], id("c"), 2), { requestedPriority: 50, beforeId: id("b"), afterId: id("a") });
});

test("preview removes the target and reports final neighbors", () => {
  const preview = previewPriorityPlacement([
    element("a", 0, 1), element("b", 50, 1), element("c", 100, 1),
  ], id("c"), 50);
  assert.equal(preview.finalPosition, 2);
  assert.equal(preview.total, 3);
  assert.equal(preview.afterId, id("a"));
  assert.equal(preview.beforeId, id("b"));
  assert.equal(preview.projectedPriority, 50);
});

test("stable blocks insert and move by one unselected position", () => {
  const order = ["a", "b", "c", "d", "e"].map(id);
  assert.deepEqual(planBlockInsertion(order, [id("b"), id("d")], 4).finalOrder,
    [id("a"), id("c"), id("e"), id("b"), id("d")]);
  assert.deepEqual(planAdjacentBlockMove(order, [id("b"), id("d")], -1).finalOrder,
    [id("b"), id("d"), id("a"), id("c"), id("e")]);
  assert.deepEqual(planAdjacentBlockMove(order, [id("b"), id("d")], 1).finalOrder,
    [id("a"), id("c"), id("b"), id("d"), id("e")]);
});

test("multiplier, spread, and adjust preserve selected relative order", () => {
  const order = ["a", "b", "c", "d", "e", "f"].map(id);
  for (const plan of [
    planMultiplierChange(order, [id("b"), id("e")], 0.5),
    planSpread(order, [id("b"), id("e")], 25, 75),
    planAdjust(order, [id("b"), id("e")], 25, 75),
  ]) {
    assert.ok(plan.finalOrder.indexOf(id("b")) < plan.finalOrder.indexOf(id("e")));
    assert.deepEqual(plan.selectedIds, [id("b"), id("e")]);
    assert.equal(plan.intents.length, 2);
  }
});

test("placement moves an element and exact collisions insert before", () => {
  const elements = [element("a", 0, 1), element("b", 50, 1), element("c", 100, 1)];
  const placement = buildPriorityPlacement(elements, id("c"), 50);
  assert.deepEqual(placement, { requestedPriority: 50, beforeId: id("b"), afterId: id("a") });
  assert.deepEqual(applyPriorityPlacement([id("a"), id("b"), id("c")], id("c"), placement), [id("a"), id("c"), id("b")]);
});

test("anchors fall back from before to after to requested percentage", () => {
  assert.deepEqual(applyPriorityPlacement([id("a"), id("b")], id("x"), {
    requestedPriority: 100,
    beforeId: id("missing"),
    afterId: id("a"),
  }), [id("a"), id("x"), id("b")]);
  assert.deepEqual(applyPriorityPlacement([id("a"), id("b")], id("x"), {
    requestedPriority: 100,
    beforeId: id("missing"),
    afterId: id("also-missing"),
  }), [id("a"), id("b"), id("x")]);
});

test("later insertion at the same anchor lands first", () => {
  const placement = { requestedPriority: 50, beforeId: id("b"), afterId: id("a") };
  const first = applyPriorityPlacement([id("a"), id("b")], id("x"), placement);
  assert.deepEqual(applyPriorityPlacement(first, id("y"), placement), [id("a"), id("y"), id("x"), id("b")]);
});

test("projection is finite and strictly increasing", () => {
  const order = Array.from({ length: 100_001 }, (_, index) => id(String(index)));
  const priorities = projectRelativePriorities(order);
  assert.equal(priorities.get(id("0")), 0);
  assert.equal(priorities.get(id("100000")), 100);
  let previous = -1;
  for (const value of priorities.values()) {
    assert.ok(Number.isFinite(value));
    assert.ok(value > previous);
    previous = value;
  }
  assert.equal(projectRelativePriorities([id("only")]).get(id("only")), 0);
});

test("priority formatting uses at most four decimal places", () => {
  assert.equal(formatPriority(0), "0");
  assert.equal(formatPriority(10.5), "10.5");
  assert.equal(formatPriority(10.123456), "10.1235");
  assert.equal(formatPriority(100), "100");
});

test("placement validation is optional but rejects malformed metadata", () => {
  const target = id("a");
  const base: IrEvent = {
    id: "event" as IrEvent["id"],
    ts: 1,
    lamport: 1,
    device: "device" as IrEvent["device"],
    kind: "priority-set",
    target,
    payload: { priority: 25 },
  };
  assert.equal(validateIrEvent(base), null);
  assert.equal(validateIrEvent({
    ...base,
    payload: { priority: 25, placement: { requestedPriority: 25, beforeId: "b" } },
  }), null);
  assert.equal(validateIrEvent({
    ...base,
    payload: { priority: 25, placement: { requestedPriority: Number.NaN } },
  }), "priority payload is invalid");
  assert.equal(validateIrEvent({
    ...base,
    payload: { priority: 25, placement: { requestedPriority: 25, beforeId: "" } },
  }), "priority payload is invalid");
});
