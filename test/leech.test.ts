import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCardResetCard,
  diagnoseLeech,
  findLeeches,
  isLeech,
} from "../src/ir/leech";
import { fold } from "../src/ir/log";
import { newElement, validateIrEvent, type IrElement, type IrEvent } from "../src/ir/model";
import { extractRevlog } from "../src/ir/optimizer/revlog";
import type { DeviceId, ElementId, EventId } from "../src/ir/ids";

const NOW = 1_760_000_000_000;
const DAY_MS = 86_400_000;
const DEV = "dev_1" as DeviceId;

function eid(s: string): ElementId {
  return s as ElementId;
}

function makeItem(id: string, overrides: Partial<IrElement> = {}): IrElement {
  const base = newElement({
    id: eid(id),
    type: "item",
    priority: 40,
    text: "Q {{c1::A}}",
    now: NOW - 30 * DAY_MS,
  });
  return { ...base, ...overrides, id: eid(id) };
}

test("diagnoseLeech detects lapses, high-difficulty-short-interval, and chronic-postpones", () => {
  const lapseLeech = makeItem("lapses", {
    card: {
      due: NOW,
      stability: 2,
      difficulty: 5,
      elapsedDays: 1,
      scheduledDays: 2,
      reps: 8,
      lapses: 5,
      state: 2,
    },
  });
  const d1 = diagnoseLeech(lapseLeech);
  assert.deepEqual(d1?.reasons, ["lapses"]);

  const stuckLeech = makeItem("stuck", {
    card: {
      due: NOW,
      stability: 4,
      difficulty: 9.2,
      elapsedDays: 3,
      scheduledDays: 7,
      reps: 6,
      lapses: 1,
      state: 2,
    },
  });
  const d2 = diagnoseLeech(stuckLeech);
  assert.deepEqual(d2?.reasons, ["high-difficulty-short-interval"]);

  const postponeLeech = makeItem("postponed", { type: "topic" });
  const d3 = diagnoseLeech(postponeLeech, {}, 8);
  assert.deepEqual(d3?.reasons, ["chronic-postpones"]);

  const healthy = makeItem("healthy", {
    card: {
      due: NOW,
      stability: 30,
      difficulty: 4,
      elapsedDays: 10,
      scheduledDays: 30,
      reps: 10,
      lapses: 1,
      state: 2,
    },
  });
  assert.equal(isLeech(healthy), false);
});

test("findLeeches combines card state with mercy-postponed history and excludes dismissed unless requested", () => {
  const a = makeItem("a");
  const b = makeItem("b", { dismissed: true, card: { due: NOW, stability: 1, difficulty: 5, elapsedDays: 1, scheduledDays: 1, reps: 7, lapses: 6, state: 2 } });
  const events: IrEvent[] = [
    { id: "c1" as EventId, ts: 1, lamport: 1, device: DEV, kind: "element-created", target: a.id, payload: { element: a } },
    { id: "c2" as EventId, ts: 2, lamport: 2, device: DEV, kind: "element-created", target: b.id, payload: { element: b } },
    ...Array.from({ length: 8 }, (_, i) => ({
      id: `p${i}` as EventId,
      ts: 10 + i,
      lamport: 10 + i,
      device: DEV,
      kind: "mercy-postponed" as const,
      target: a.id,
      payload: { newDue: NOW + (i + 1) * DAY_MS, batchId: `b${i}` },
    })),
  ];
  const state = fold(events);
  assert.deepEqual(findLeeches(state, events).map((d) => d.elementId), [a.id]);
  assert.deepEqual(
    findLeeches(state, events, { includeDismissed: true }).map((d) => d.elementId),
    [b.id, a.id],
  );
});

test("card-reset resets card state, preserves conservative fold for subsequent grades, and voids prior reviews in extractRevlog", () => {
  const el = makeItem("item_1");
  const resetCard = buildCardResetCard(NOW);
  const nextCard = {
    due: NOW + 5 * DAY_MS,
    stability: 5,
    difficulty: 5,
    elapsedDays: 0,
    scheduledDays: 5,
    reps: 1,
    lapses: 0,
    state: 2,
  };
  const events: IrEvent[] = [
    { id: "e1" as EventId, ts: 1, lamport: 1, device: DEV, kind: "element-created", target: el.id, payload: { element: el } },
    { id: "g1" as EventId, ts: 2, lamport: 2, device: DEV, kind: "graded", target: el.id, payload: { grade: 1, card: { ...nextCard, due: NOW + 100 * DAY_MS, lapses: 5, reps: 5 } } },
    { id: "g2" as EventId, ts: 3, lamport: 3, device: DEV, kind: "graded", target: el.id, payload: { grade: 1, card: { ...nextCard, due: NOW + 100 * DAY_MS, lapses: 6, reps: 6 } } },
    { id: "r1" as EventId, ts: NOW, lamport: 4, device: DEV, kind: "card-reset", target: el.id, payload: { card: resetCard } },
    { id: "g3" as EventId, ts: NOW + 1000, lamport: 5, device: DEV, kind: "graded", target: el.id, payload: { grade: 3, card: nextCard } },
  ];
  for (const ev of events) {
    assert.equal(validateIrEvent(ev), null);
  }
  const state = fold(events);
  const folded = state.elements.get(el.id)!;
  assert.equal(folded.card?.reps, 1);
  assert.equal(folded.card?.lapses, 0);
  assert.equal(folded.card?.due, NOW + 5 * DAY_MS);

  const revlog = extractRevlog(events, state);
  assert.equal(revlog.report.rows.find((r) => r.reason === "cardReset")?.count, 2);
  assert.equal(revlog.cards.length, 0);
});

test("cured long-interval items exit leech wizard and post-reset failRate flags high-fail-rate items", () => {
  const cured = makeItem("cured", {
    card: {
      due: NOW + 45 * DAY_MS,
      stability: 45,
      difficulty: 6,
      elapsedDays: 35,
      scheduledDays: 45,
      reps: 12,
      lapses: 6,
      state: 2,
    },
  });
  assert.equal(diagnoseLeech(cured), null);
  assert.ok(diagnoseLeech(cured, { maxLapseIntervalDays: 60 })?.reasons.includes("lapses"));

  const failing = makeItem("failing", {
    card: {
      due: NOW,
      stability: 3,
      difficulty: 5.5,
      elapsedDays: 2,
      scheduledDays: 3,
      reps: 6,
      lapses: 2,
      state: 2,
    },
  });
  const events: IrEvent[] = [
    { id: "e0" as EventId, ts: 1, lamport: 1, device: DEV, kind: "element-created", target: failing.id, payload: { element: failing } },
    // Pre-reset failures should not taint post-reset failRate
    { id: "pre1" as EventId, ts: 2, lamport: 2, device: DEV, kind: "graded", target: failing.id, payload: { grade: 1, card: failing.card } },
    { id: "rst" as EventId, ts: 3, lamport: 3, device: DEV, kind: "card-reset", target: failing.id, payload: { card: buildCardResetCard(3) } },
    // 6 post-reset graded reps: 3 again, 3 good -> 50% failRate >= 0.45
    ...([1, 3, 1, 3, 1, 3] as const).map((grade, i) => ({
      id: `g${i}` as EventId,
      ts: 10 + i,
      lamport: 10 + i,
      device: DEV,
      kind: "graded" as const,
      target: failing.id,
      payload: { grade, card: failing.card },
    })),
  ];
  const state = fold(events);
  const hits = findLeeches(state, events);
  assert.equal(hits.length, 1);
  assert.ok(hits[0]!.reasons.includes("high-fail-rate"));
  assert.equal(hits[0]!.failRate, 0.5);
});
