import assert from "node:assert/strict";
import { test } from "node:test";
import { auditAndRepairCollectionIntegrity } from "../src/ir/sm20-collection-ops";
import { newDeviceId, newElementId, newEventId } from "../src/ir/ids";
import { newElement, type IrElement, type IrEvent } from "../src/ir/model";

const NOW = 1_760_000_000_000;
const DAY = 86_400_000;
const DEV = newDeviceId();

function card(reps: number, lapses: number, lastReview: number) {
  return {
    due: NOW + 5 * DAY,
    stability: 5,
    difficulty: 5,
    elapsedDays: 0,
    scheduledDays: 5,
    reps,
    lapses,
    state: 2,
    lastReview,
  };
}

function item(id: ReturnType<typeof newElementId>, c: ReturnType<typeof card>): IrElement {
  return { ...newElement({ id, type: "item", priority: 50, now: NOW }), card: c };
}

function created(id: ReturnType<typeof newElementId>, el: IrElement): IrEvent {
  return {
    id: newEventId(),
    ts: NOW - 5 * DAY,
    lamport: 1,
    device: DEV,
    kind: "element-created",
    target: id,
    payload: { element: el },
  };
}

function graded(
  id: ReturnType<typeof newElementId>,
  lamport: number,
  ts: number,
  c?: ReturnType<typeof card>,
): IrEvent {
  return {
    id: newEventId(),
    ts,
    lamport,
    device: DEV,
    kind: "graded",
    target: id,
    payload: { ...(c ? { card: c } : {}), grade: 3, smGrade: 4 },
  };
}

test("audit derives counters from graded snapshots, not imported final counters plus increments", () => {
  const id = newElementId();
  const authoritative = card(3, 1, NOW - DAY);
  const el = item(id, authoritative);
  const events = [
    created(id, el),
    graded(id, 2, NOW - 3 * DAY, card(1, 0, NOW - 3 * DAY)),
    graded(id, 3, NOW - 2 * DAY, card(2, 0, NOW - 2 * DAY)),
    graded(id, 4, NOW - DAY, authoritative),
  ];
  const report = auditAndRepairCollectionIntegrity({
    elements: new Map([[id, el]]),
    events,
    nowMs: NOW,
    device: DEV,
    startingLamport: 10,
  });
  assert.equal(report.counts.cardCounterDrifts, 0);
  assert.equal(report.counts.historyAnomalies, 0);
});

test("audit still reports a backwardly rescheduled repetition between graded snapshots", () => {
  const id = newElementId();
  const last = card(2, 0, NOW - 4 * DAY);
  const el = item(id, card(99, 0, NOW));
  const events = [
    created(id, el),
    graded(id, 2, NOW - 2 * DAY, card(1, 0, NOW - 2 * DAY)),
    graded(id, 3, NOW - 4 * DAY, last),
  ];
  const report = auditAndRepairCollectionIntegrity({
    elements: new Map([[id, el]]),
    events,
    nowMs: NOW,
    device: DEV,
    startingLamport: 10,
  });
  assert.equal(report.counts.historyAnomalies, 1);
  const reset = report.repairEvents.find((e) => e.kind === "card-reset");
  assert.equal((reset?.payload.card as ReturnType<typeof card> | undefined)?.lastReview, NOW - 4 * DAY);
});

test("audit still repairs genuine card counter drift against graded snapshots", () => {
  const id = newElementId();
  const authoritative = card(3, 0, NOW - DAY);
  const el = item(id, card(99, 0, NOW - DAY));
  const events = [
    created(id, el),
    graded(id, 2, NOW - 2 * DAY, card(1, 0, NOW - 2 * DAY)),
    graded(id, 3, NOW - DAY, authoritative),
  ];
  const report = auditAndRepairCollectionIntegrity({
    elements: new Map([[id, el]]),
    events,
    nowMs: NOW,
    device: DEV,
    startingLamport: 10,
  });
  assert.equal(report.counts.cardCounterDrifts, 1);
  const reset = report.repairEvents.find((e) => e.kind === "card-reset");
  assert.equal((reset?.payload.card as ReturnType<typeof card> | undefined)?.reps, 3);
});

test("audit falls back to incrementing counters for graded events without a card snapshot", () => {
  const id = newElementId();
  const el = item(id, card(0, 0, NOW));
  const events = [
    graded(id, 1, NOW - 2 * DAY),
    graded(id, 2, NOW - DAY),
  ];
  const report = auditAndRepairCollectionIntegrity({
    elements: new Map([[id, el]]),
    events,
    nowMs: NOW,
    device: DEV,
    startingLamport: 10,
  });
  const reset = report.repairEvents.find((e) => e.kind === "card-reset");
  assert.equal((reset?.payload.card as ReturnType<typeof card> | undefined)?.reps, 2);
});
