/**
 * Golden contract for src/ir/log.ts (Q2 option D).
 *
 * Claude-authored and fenced out of the delegated scope: opencode implements
 * src/ir/log.ts from the TASK.md prose spec and is judged solely by this
 * suite plus `tsc -noEmit`. This file is the spec made executable.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fold,
  compact,
  nextLamport,
  type LogState,
} from "../src/ir/log";
import {
  newElement,
  isReviewEvent,
  type IrElement,
  type IrEvent,
  type IrEventKind,
  type StoredCard,
  type ReadSchedule,
} from "../src/ir/model";
import {
  newElementId,
  newEventId,
  newDeviceId,
  type ElementId,
  type DeviceId,
} from "../src/ir/ids";

const DEV_A: DeviceId = newDeviceId();
const DEV_B: DeviceId = newDeviceId();

function ev(p: {
  lamport: number;
  kind: IrEventKind;
  target: ElementId;
  payload?: Record<string, unknown>;
  device?: DeviceId;
  ts?: number;
}): IrEvent {
  return {
    id: newEventId(),
    ts: p.ts ?? p.lamport * 1000,
    lamport: p.lamport,
    device: p.device ?? DEV_A,
    kind: p.kind,
    target: p.target,
    payload: p.payload ?? {},
  };
}

function topic(id: ElementId): IrElement {
  return newElement({ id, type: "topic", priority: 50, now: 0 });
}

function card(due: number): StoredCard {
  return {
    due,
    stability: 1,
    difficulty: 5,
    elapsedDays: 0,
    scheduledDays: 1,
    reps: 1,
    lapses: 0,
    state: 2,
  };
}

function shuffle<T>(xs: T[], seed: number): T[] {
  const a = [...xs];
  let s = seed;
  for (let i = a.length - 1; i > 0; i -= 1) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

test("fold is deterministic regardless of input order", () => {
  const id = newElementId();
  const events = [
    ev({ lamport: 1, kind: "element-created", target: id, payload: { element: topic(id) } }),
    ev({ lamport: 2, kind: "priority-set", target: id, payload: { priority: 10 } }),
    ev({ lamport: 3, kind: "dismiss-set", target: id, payload: { dismissed: true } }),
  ];
  const base = fold(events);
  for (const seed of [1, 7, 42, 99]) {
    assert.deepEqual(fold(shuffle(events, seed)), base);
  }
});

test("element-created inserts; later events mutate the same element", () => {
  const id = newElementId();
  const s = fold([
    ev({ lamport: 1, kind: "element-created", target: id, payload: { element: topic(id) } }),
    ev({ lamport: 2, kind: "priority-set", target: id, payload: { priority: 12 } }),
    ev({ lamport: 3, kind: "dismiss-set", target: id, payload: { dismissed: true } }),
  ]);
  const el = s.elements.get(id);
  assert.ok(el);
  assert.equal(el.priority, 12);
  assert.equal(el.dismissed, true);
});

test("priority is clamped on fold", () => {
  const id = newElementId();
  const s = fold([
    ev({ lamport: 1, kind: "element-created", target: id, payload: { element: topic(id) } }),
    ev({ lamport: 2, kind: "priority-set", target: id, payload: { priority: 999 } }),
  ]);
  assert.equal(s.elements.get(id)?.priority, 100);
});

test("graded sets the item card; topic-advanced sets the read schedule", () => {
  const item = newElementId();
  const top = newElementId();
  const sched: ReadSchedule = { due: 5000, interval: 3, aFactor: 1.5 };
  const s = fold([
    ev({ lamport: 1, kind: "element-created", target: item, payload: { element: newElement({ id: item, type: "item", priority: 50, now: 0 }) } }),
    ev({ lamport: 2, kind: "graded", target: item, payload: { card: card(9000) } }),
    ev({ lamport: 1, kind: "element-created", target: top, payload: { element: topic(top) } }),
    ev({ lamport: 2, kind: "topic-advanced", target: top, payload: { schedule: sched } }),
  ]);
  assert.equal(s.elements.get(item)?.card?.due, 9000);
  assert.deepEqual(s.elements.get(top)?.schedule, sched);
});

test("conservative conflict: concurrent grades keep the earlier next-due", () => {
  const id = newElementId();
  const s = fold([
    ev({ lamport: 1, kind: "element-created", target: id, payload: { element: newElement({ id, type: "item", priority: 50, now: 0 }) } }),
    ev({ lamport: 2, kind: "graded", target: id, device: DEV_A, payload: { card: card(9_000_000) } }),
    ev({ lamport: 3, kind: "graded", target: id, device: DEV_B, payload: { card: card(5_000_000) } }),
  ]);
  // Default is conservative: earlier due wins so a review is never skipped,
  // even though the DEV_A grade has the higher lamport.
  assert.equal(s.elements.get(id)?.card?.due, 5_000_000);
});

test("clock-order conflict: highest lamport grade wins", () => {
  const id = newElementId();
  // Higher lamport (3) carries the LATER due. Conservative would keep the
  // earlier 5_000_000; clock-order must instead take the highest-lamport
  // grade, proving the toggle actually diverges.
  const events = [
    ev({ lamport: 1, kind: "element-created", target: id, payload: { element: newElement({ id, type: "item", priority: 50, now: 0 }) } }),
    ev({ lamport: 2, kind: "graded", target: id, device: DEV_A, payload: { card: card(5_000_000) } }),
    ev({ lamport: 3, kind: "graded", target: id, device: DEV_B, payload: { card: card(9_000_000) } }),
  ];
  const s = fold(events, { conflict: "clock-order" });
  assert.equal(s.elements.get(id)?.card?.due, 9_000_000);
});

test("element-deleted removes it; later events for it are no-ops", () => {
  const id = newElementId();
  const s = fold([
    ev({ lamport: 1, kind: "element-created", target: id, payload: { element: topic(id) } }),
    ev({ lamport: 2, kind: "element-deleted", target: id }),
    ev({ lamport: 3, kind: "priority-set", target: id, payload: { priority: 1 } }),
  ]);
  assert.equal(s.elements.has(id), false);
});

test("source-tombstoned is recorded keyed by path", () => {
  const id = newElementId();
  const tomb = { path: "src/Note.md", title: "Note", deletedAt: 123 };
  const s: LogState = fold([
    ev({ lamport: 1, kind: "element-created", target: id, payload: { element: topic(id) } }),
    ev({ lamport: 2, kind: "source-tombstoned", target: id, payload: { tombstone: tomb } }),
  ]);
  assert.deepEqual(s.tombstones.get("src/Note.md"), tomb);
});

test("anchor-detached flips anchorState without losing the element", () => {
  const id = newElementId();
  const s = fold([
    ev({ lamport: 1, kind: "element-created", target: id, payload: { element: newElement({ id, type: "extract", priority: 50, now: 0 }) } }),
    ev({ lamport: 2, kind: "anchor-detached", target: id }),
  ]);
  assert.equal(s.elements.get(id)?.anchorState, "detached");
});

test("nextLamport is max+1, and 1 on an empty log", () => {
  assert.equal(nextLamport([]), 1);
  const id = newElementId();
  assert.equal(
    nextLamport([
      ev({ lamport: 4, kind: "element-created", target: id }),
      ev({ lamport: 9, kind: "priority-set", target: id }),
      ev({ lamport: 2, kind: "dismiss-set", target: id }),
    ]),
    10,
  );
});

test("compaction keeps at most maxEvents and the most recent ones", () => {
  const id = newElementId();
  const shard: IrEvent[] = [
    ev({ lamport: 1, kind: "element-created", target: id, payload: { element: topic(id) } }),
  ];
  for (let i = 2; i <= 30; i += 1) {
    shard.push(ev({ lamport: i, kind: "priority-set", target: id, payload: { priority: i % 100 } }));
  }
  const r = compact(shard, 30_000, { maxEvents: 10, maxAgeDays: 9999 });
  assert.equal(r.keep.length, 10);
  // The kept events are the highest-lamport (most recent) ones.
  assert.deepEqual(
    r.keep.map((e) => e.lamport).sort((a, b) => a - b),
    [21, 22, 23, 24, 25, 26, 27, 28, 29, 30],
  );
});

test("compaction also evicts anything older than maxAgeDays", () => {
  const id = newElementId();
  const dayMs = 86_400_000;
  const now = 100 * dayMs;
  const shard: IrEvent[] = [
    ev({ lamport: 1, kind: "element-created", target: id, payload: { element: topic(id) }, ts: 1 * dayMs }),
    ev({ lamport: 2, kind: "priority-set", target: id, payload: { priority: 7 }, ts: 50 * dayMs }),
    ev({ lamport: 3, kind: "dismiss-set", target: id, payload: { dismissed: true }, ts: 99 * dayMs }),
  ];
  const r = compact(shard, now, { maxEvents: 9999, maxAgeDays: 7 });
  // Only the event within the last 7 days stays active.
  assert.deepEqual(r.keep.map((e) => e.lamport), [3]);
});

test("review-history guarantee: review events are never dropped", () => {
  const item = newElementId();
  const shard: IrEvent[] = [
    ev({ lamport: 1, kind: "element-created", target: item, payload: { element: newElement({ id: item, type: "item", priority: 50, now: 0 }) } }),
  ];
  for (let i = 2; i <= 40; i += 1) {
    const kind: IrEventKind = i % 2 === 0 ? "graded" : "priority-set";
    shard.push(
      ev({
        lamport: i,
        kind,
        target: item,
        payload: kind === "graded" ? { card: card(i * 1000) } : { priority: i % 100 },
      }),
    );
  }
  const r = compact(shard, 999_999_999, { maxEvents: 5, maxAgeDays: 9999 });

  const inKeepOrArchived = new Set(
    [...r.keep, ...r.archived].map((e) => e.id),
  );
  for (const e of shard) {
    if (isReviewEvent(e.kind)) {
      assert.ok(
        inKeepOrArchived.has(e.id),
        `review event ${e.lamport} must survive compaction`,
      );
    }
  }
  // Nothing in `dropped` is a review event.
  assert.equal(
    r.dropped.some((e) => isReviewEvent(e.kind)),
    false,
  );
  // `dropped` events were genuinely compacted (not kept).
  const keptIds = new Set(r.keep.map((e) => e.id));
  assert.equal(
    r.dropped.some((e) => keptIds.has(e.id)),
    false,
  );
});

test("compaction snapshot equals folding the compacted-away events", () => {
  const id = newElementId();
  const shard: IrEvent[] = [
    ev({ lamport: 1, kind: "element-created", target: id, payload: { element: topic(id) } }),
  ];
  for (let i = 2; i <= 20; i += 1) {
    shard.push(ev({ lamport: i, kind: "priority-set", target: id, payload: { priority: i } }));
  }
  const r = compact(shard, 999_999_999, { maxEvents: 5, maxAgeDays: 9999 });
  const keptIds = new Set(r.keep.map((e) => e.id));
  const compactedAway = shard.filter((e) => !keptIds.has(e.id));
  assert.deepEqual(r.snapshot, fold(compactedAway));
});
