import { test } from "node:test";
import assert from "node:assert/strict";
import { computeLoad, endOfDayMs, formatLoad } from "../src/status-bar";
import type { IrElement, IrEvent } from "../src/ir/model";
import type { ElementId, EventId, DeviceId } from "../src/ir/ids";

// 2026-05-19 10:00:00 local. We anchor every test around a fixed `now` so
// "end of day" and the 7-day inflow window are deterministic.
const NOW = new Date(2026, 4, 19, 10, 0, 0, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;

function item(
  p: Omit<Partial<IrElement>, "id"> & { id: string; dueMs?: number },
): IrElement {
  const { id, dueMs, ...rest } = p;
  const due = dueMs ?? NOW;
  return {
    type: "item",
    priority: 50,
    parentId: null,
    dismissed: false,
    created: NOW,
    text: "",
    anchorState: "ok",
    card: {
      due,
      stability: 1,
      difficulty: 1,
      elapsedDays: 0,
      scheduledDays: 0,
      reps: 0,
      lapses: 0,
      state: 0,
    },
    ...rest,
    id: id as ElementId,
  };
}

function topic(
  p: Omit<Partial<IrElement>, "id"> & { id: string; dueMs?: number },
): IrElement {
  const { id, dueMs, ...rest } = p;
  const due = dueMs ?? NOW;
  return {
    type: "topic",
    priority: 50,
    parentId: null,
    dismissed: false,
    created: NOW,
    text: "",
    anchorState: "ok",
    schedule: { due, interval: 1, aFactor: 1.5 },
    ...rest,
    id: id as ElementId,
  };
}

function created(id: string, ts: number): IrEvent {
  return {
    id: `ev-${id}` as EventId,
    ts,
    lamport: ts,
    device: "dev" as DeviceId,
    kind: "element-created",
    target: id as ElementId,
    payload: {},
  };
}

test("endOfDayMs lands on 23:59:59.999 of the same local day", () => {
  const end = endOfDayMs(NOW);
  const d = new Date(end);
  assert.equal(d.getHours(), 23);
  assert.equal(d.getMinutes(), 59);
  assert.equal(d.getSeconds(), 59);
  assert.equal(d.getDate(), new Date(NOW).getDate());
});

test("computeLoad: due is everything with due <= now", () => {
  const load = computeLoad(
    [
      item({ id: "i1", dueMs: NOW - DAY }), // overdue
      item({ id: "i2", dueMs: NOW }), // exactly now
      topic({ id: "t1", dueMs: NOW - 1 }),
      item({ id: "i3", dueMs: NOW + 1 }), // not due yet
    ],
    [],
    NOW,
  );
  assert.equal(load.due, 3);
  assert.equal(load.later, 1);
});

test("computeLoad: later counts items due after now but on or before end-of-day", () => {
  const endToday = endOfDayMs(NOW);
  const load = computeLoad(
    [
      item({ id: "i1", dueMs: NOW + 1000 }), // later today
      item({ id: "i2", dueMs: endToday }), // end-of-day boundary, inclusive
      item({ id: "i3", dueMs: endToday + 1 }), // tomorrow
      topic({ id: "t1", dueMs: NOW + 5 * 60 * 1000 }), // later today (read element)
    ],
    [],
    NOW,
  );
  assert.equal(load.due, 0);
  assert.equal(load.later, 3);
});

test("computeLoad: dismissed elements never count", () => {
  const load = computeLoad(
    [
      item({ id: "i1", dueMs: NOW - DAY, dismissed: true }),
      item({ id: "i2", dueMs: NOW - DAY }),
    ],
    [],
    NOW,
  );
  assert.equal(load.due, 1);
  assert.equal(load.later, 0);
});

test("computeLoad: elements without a card or schedule are skipped", () => {
  const noCard: IrElement = {
    id: "i1" as ElementId,
    type: "item",
    priority: 50,
    parentId: null,
    dismissed: false,
    created: NOW,
    text: "",
    anchorState: "ok",
  };
  const load = computeLoad([noCard], [], NOW);
  assert.equal(load.due, 0);
  assert.equal(load.later, 0);
});

test("computeLoad: inflow counts element-created events within 7 days", () => {
  const sevenDaysAgo = NOW - 7 * DAY;
  const load = computeLoad(
    [],
    [
      created("a", NOW),
      created("b", NOW - DAY),
      created("c", sevenDaysAgo), // boundary, inclusive
      created("d", sevenDaysAgo - 1), // out of window
    ],
    NOW,
  );
  assert.equal(load.inflow7d, 3);
});

test("computeLoad: non-create events do not count toward inflow", () => {
  const load = computeLoad(
    [],
    [
      {
        id: "x" as EventId,
        ts: NOW,
        lamport: 1,
        device: "dev" as DeviceId,
        kind: "graded",
        target: "i1" as ElementId,
        payload: {},
      },
      {
        id: "y" as EventId,
        ts: NOW,
        lamport: 2,
        device: "dev" as DeviceId,
        kind: "priority-set",
        target: "i1" as ElementId,
        payload: {},
      },
    ],
    NOW,
  );
  assert.equal(load.inflow7d, 0);
});

test("formatLoad: compact human-readable summary", () => {
  assert.equal(
    formatLoad({ due: 12, later: 3, inflow7d: 21 }),
    "12 due  ·  3 later  ·  +21/7d",
  );
});

test("formatLoad: zeros render explicitly, not blank", () => {
  assert.equal(
    formatLoad({ due: 0, later: 0, inflow7d: 0 }),
    "0 due  ·  0 later  ·  +0/7d",
  );
});
