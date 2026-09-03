import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeLoad,
  computeUpcoming,
  describeNextDue,
  endOfDayMs,
  formatLoad,
  formatLoadTooltip,
} from "../src/status-bar";
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

function dueChange(
  kind: "mercy-postponed" | "graded" | "topic-advanced",
  target: string,
  ts: number,
  lamport = ts,
): IrEvent {
  return {
    id: `ev-${kind}-${target}-${lamport}` as EventId,
    ts,
    lamport,
    device: "dev" as DeviceId,
    kind,
    target: target as ElementId,
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
  assert.deepEqual(load.dueByType, { topic: 1, extract: 0, item: 2 });
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
    formatLoad({
      due: 12,
      later: 3,
      postponed: 4,
      inflow7d: 21,
      dueByType: { topic: 2, extract: 3, item: 7 },
    }),
    "12 due  ·  4 postponed  ·  +21/7d",
  );
});

test("formatLoad: zeros render explicitly, not blank", () => {
  assert.equal(
    formatLoad({
      due: 0,
      later: 0,
      postponed: 0,
      inflow7d: 0,
      dueByType: { topic: 0, extract: 0, item: 0 },
    }),
    "0 due  ·  0 postponed  ·  +0/7d",
  );
});

test("formatLoadTooltip: due split, later today, postponed", () => {
  const tip = formatLoadTooltip({
    due: 12,
    later: 3,
    postponed: 4,
    inflow7d: 21,
    dueByType: { topic: 2, extract: 3, item: 7 },
  });
  assert.match(tip, /12 due now \(2 topics, 3 extracts, 7 items\)/);
  assert.match(tip, /3 later today/);
  assert.match(tip, /4 postponed/);
  assert.match(tip, /21 added in last 7 days/);
});

test("computeLoad: mercy-postponed with future due counts as postponed", () => {
  const load = computeLoad(
    [item({ id: "i1", dueMs: NOW + DAY })],
    [dueChange("mercy-postponed", "i1", NOW - 1)],
    NOW,
  );
  assert.equal(load.due, 0);
  assert.equal(load.postponed, 1);
  assert.equal(load.later, 0);
});

test("computeLoad: graded after mercy is not postponed", () => {
  const load = computeLoad(
    [item({ id: "i1", dueMs: NOW + DAY })],
    [
      dueChange("mercy-postponed", "i1", NOW - 10, 1),
      dueChange("graded", "i1", NOW - 1, 2),
    ],
    NOW,
  );
  assert.equal(load.postponed, 0);
});

test("computeLoad: due-now mercy counts as due, not postponed", () => {
  const load = computeLoad(
    [item({ id: "i1", dueMs: NOW })],
    [dueChange("mercy-postponed", "i1", NOW - 1)],
    NOW,
  );
  assert.equal(load.due, 1);
  assert.equal(load.postponed, 0);
});

test("computeLoad: topic-advanced later today is later, not postponed", () => {
  const load = computeLoad(
    [topic({ id: "t1", dueMs: NOW + 60_000 })],
    [dueChange("topic-advanced", "t1", NOW - 1)],
    NOW,
  );
  assert.equal(load.later, 1);
  assert.equal(load.postponed, 0);
});

test("computeLoad: dismissed mercy-postponed is ignored", () => {
  const load = computeLoad(
    [item({ id: "i1", dueMs: NOW + DAY, dismissed: true })],
    [dueChange("mercy-postponed", "i1", NOW - 1)],
    NOW,
  );
  assert.equal(load.postponed, 0);
});

// --- computeUpcoming / describeNextDue (nothing-due panel) ---

test("computeUpcoming: nextDueMs is the soonest future due", () => {
  const up = computeUpcoming(
    [
      item({ id: "a", dueMs: NOW + 5 * DAY }),
      item({ id: "b", dueMs: NOW + 2 * 60 * 60 * 1000 }),
      item({ id: "c", dueMs: NOW - DAY }),
    ],
    NOW,
  );
  assert.equal(up.nextDueMs, NOW + 2 * 60 * 60 * 1000);
});

test("computeUpcoming: past-due and dismissed elements never set nextDueMs", () => {
  const up = computeUpcoming(
    [
      item({ id: "a", dueMs: NOW - DAY }),
      item({ id: "b", dueMs: NOW + DAY, dismissed: true }),
    ],
    NOW,
  );
  assert.equal(up.nextDueMs, undefined);
  assert.equal(up.dueTomorrow, 0);
  assert.equal(up.due7d, 0);
});

test("computeUpcoming: dueTomorrow counts only the next calendar day", () => {
  const endToday = endOfDayMs(NOW);
  const up = computeUpcoming(
    [
      // later today: not tomorrow
      item({ id: "a", dueMs: endToday - 1000 }),
      // tomorrow morning and tomorrow night: both count
      item({ id: "b", dueMs: endToday + 60 * 60 * 1000 }),
      item({ id: "c", dueMs: endOfDayMs(endToday + 1) - 1000 }),
      // day after: does not
      item({ id: "d", dueMs: endOfDayMs(endToday + 1) + 60 * 60 * 1000 }),
    ],
    NOW,
  );
  assert.equal(up.dueTomorrow, 2);
});

test("computeUpcoming: due7d is every future due inside seven days", () => {
  const up = computeUpcoming(
    [
      item({ id: "a", dueMs: NOW + 60 * 60 * 1000 }),
      item({ id: "b", dueMs: NOW + 6 * DAY }),
      item({ id: "c", dueMs: NOW + 8 * DAY }),
      item({ id: "d", dueMs: NOW - 60 * 60 * 1000 }),
    ],
    NOW,
  );
  assert.equal(up.due7d, 2);
});

test("describeNextDue: minutes, today, tomorrow, weekday, far future", () => {
  assert.equal(describeNextDue(NOW + 30 * 1000, NOW), "in under a minute");
  assert.equal(describeNextDue(NOW + 20 * 60 * 1000, NOW), "in 20 min");
  assert.match(describeNextDue(NOW + 3 * 60 * 60 * 1000, NOW), /^today 13:00/);
  const tomorrow9 = new Date(2026, 4, 20, 9, 0, 0, 0).getTime();
  assert.equal(describeNextDue(tomorrow9, NOW), "tomorrow 09:00");
  // 2026-05-19 is a Tuesday, so +3 days is Friday.
  const friday = new Date(2026, 4, 22, 8, 30, 0, 0).getTime();
  assert.equal(describeNextDue(friday, NOW), "Fri 08:30");
  assert.equal(describeNextDue(NOW + 30 * DAY, NOW), "in 30 days");
});

test("describeNextDue: a due time already past reads as now", () => {
  assert.equal(describeNextDue(NOW - 1000, NOW), "now");
});
