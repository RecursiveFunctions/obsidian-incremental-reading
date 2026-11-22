import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildReversibleUndoEvent,
  computeSessionTrackSegments,
  contextSourceParentId,
  EMPTY_COLLECTION_COPY,
  EMPTY_NEURAL_COPY,
  sessionBarLabel,
  refreshQueuedSlot,
  type ReviewSlot,
} from "../src/review";
import { findLeeches } from "../src/ir/leech";
import { fold } from "../src/ir/log";
import { computeElementHistoryCounts } from "../src/ir/mercy";
import { activityHeatmap } from "../src/ir/stats";
import type { IrElement, IrEvent } from "../src/ir/model";
import type { DeviceId, ElementId, EventId } from "../src/ir/ids";

function el(
  id: string,
  type: IrElement["type"],
  parentId: string | null = null,
): IrElement {
  return {
    id: id as ElementId,
    type,
    priority: 50,
    parentId: parentId as ElementId | null,
    dismissed: false,
    created: 0,
    text: "body",
    anchorState: "ok",
  };
}

function slot(id: string, type: IrElement["type"] = "extract"): ReviewSlot {
  return { id: id as ElementId, element: el(id, type), file: null };
}

test("refreshQueuedSlot: absent ids leave queue order and length unchanged", () => {
  const q = [slot("a", "topic"), slot("b", "extract")];
  const out = refreshQueuedSlot(q, slot("child"));
  assert.deepEqual(out.map((s) => s.id), ["a", "b"]);
  assert.equal(out.length, q.length);
});

test("refreshQueuedSlot: existing id refreshes metadata in place", () => {
  const child = slot("child");
  child.element = { ...child.element, notePath: "x.md" };
  const q = [slot("a", "topic"), slot("child")];
  const out = refreshQueuedSlot(q, child);
  assert.equal(out.length, 2);
  assert.equal(out[1]!.element.notePath, "x.md");
});

test("sessionBarLabel: due, neural, and complete", () => {
  assert.equal(
    sessionBarLabel({ done: false, isNeural: false, remaining: 8 }),
    "Due · 8 left",
  );
  assert.equal(
    sessionBarLabel({
      done: false,
      isNeural: true,
      remaining: 12,
      seedLabel: "dogs",
    }),
    "Neural · 12 left · dogs",
  );
  assert.equal(
    sessionBarLabel({ done: false, isNeural: true, remaining: 12 }),
    "Neural · 12 left",
  );
  assert.equal(
    sessionBarLabel({ done: true, isNeural: false, remaining: 0 }),
    "Session complete",
  );
  assert.equal(
    sessionBarLabel({ done: false, isNeural: false, remaining: 4, phase: "drill" }),
    "Final Drill · 4 left",
  );
  assert.deepEqual(
    computeSessionTrackSegments({
      done: false,
      phase: "due",
      index: 4,
      queueLength: 8,
      drillPendingCount: 2,
    }),
    { primaryPct: 40, drillPct: 20 },
  );
  assert.deepEqual(
    computeSessionTrackSegments({
      done: false,
      phase: "drill",
      index: 1,
      queueLength: 4,
      drillPendingCount: 4,
    }),
    { primaryPct: 0, drillPct: 25 },
  );
  assert.equal(
    sessionBarLabel({
      done: false,
      isNeural: false,
      remaining: 5,
      seedLabel: "Networking",
      phase: "branch",
    }),
    "Branch · 5 left · Networking",
  );
  assert.equal(
    sessionBarLabel({ done: false, isNeural: false, remaining: 3, phase: "subset" }),
    "Subset · 3 left",
  );
  assert.equal(
    sessionBarLabel({ done: false, isNeural: false, remaining: 4, phase: "search" }),
    "Search · 4 left",
  );
});

test("EMPTY_NEURAL_COPY tells the user what to do", () => {
  assert.match(EMPTY_NEURAL_COPY, /wikilinks/);
  assert.match(EMPTY_NEURAL_COPY, /extract/);
});

test("EMPTY_COLLECTION_COPY tells a first-run user what to do", () => {
  assert.match(EMPTY_COLLECTION_COPY, /Alt\+T/);
  assert.match(EMPTY_COLLECTION_COPY, /Alt\+R/);
});

test("contextSourceParentId: item walks up to the nearest extract", () => {
  const topic = el("t", "topic");
  const extract = el("e", "extract", "t");
  const item = el("i", "item", "e");
  const map = new Map<ElementId, IrElement>([
    [topic.id, topic],
    [extract.id, extract],
    [item.id, item],
  ]);
  assert.equal(contextSourceParentId(item, map), extract.id);
  assert.equal(contextSourceParentId(extract, map), topic.id);
  assert.equal(contextSourceParentId(topic, map), null);
});

test("contextSourceParentId: item whose parent is a topic stays on the topic", () => {
  const topic = el("t", "topic");
  const item = el("i", "item", "t");
  const map = new Map<ElementId, IrElement>([
    [topic.id, topic],
    [item.id, item],
  ]);
  assert.equal(contextSourceParentId(item, map), topic.id);
});

test("buildReversibleUndoEvent (#74): undoing later-today preserves readingReps=0, postpone streak, leech status, and zero heatmap reads", () => {
  const now = 1_760_000_000_000;
  const dayMs = 86_400_000;
  const dev = "dev_test" as DeviceId;
  const restored: IrElement = {
    ...el("topic_leech", "topic"),
    schedule: { due: now - 1_000, interval: 2, aFactor: 1.5 },
  };
  const deferredSchedule = { due: now + 3_600_000, interval: 2, aFactor: 1.5 };
  const undoEv = buildReversibleUndoEvent("later", restored);
  assert.equal(undoEv.kind, "topic-advanced");
  assert.equal(undoEv.payload.operation, "later-today");

  const events: IrEvent[] = [
    {
      id: "ev_create" as EventId,
      ts: now - 10 * dayMs,
      lamport: 1,
      device: dev,
      kind: "element-created",
      target: restored.id,
      payload: { element: restored },
    },
    ...Array.from({ length: 8 }, (_, i) => ({
      id: `ev_post_${i}` as EventId,
      ts: now - (8 - i) * dayMs,
      lamport: 2 + i,
      device: dev,
      kind: "mercy-postponed" as const,
      target: restored.id,
      payload: { newDue: now - (7 - i) * dayMs, batchId: `batch_${i}` },
    })),
    {
      id: "ev_later" as EventId,
      ts: now - 2_000,
      lamport: 20,
      device: dev,
      kind: "topic-advanced",
      target: restored.id,
      payload: { schedule: deferredSchedule, operation: "later-today" },
    },
    {
      id: "ev_later_undo" as EventId,
      ts: now - 1_000,
      lamport: 21,
      device: dev,
      kind: undoEv.kind,
      target: restored.id,
      payload: undoEv.payload,
    },
  ];

  const counts = computeElementHistoryCounts(events).get(restored.id);
  assert.deepEqual(counts, {
    readingReps: 0,
    totalPostponeCount: 8,
    recentPostponeCount: 8,
  });

  const state = fold(events);
  const leeches = findLeeches(state, events);
  assert.equal(leeches.length, 1);
  assert.equal(leeches[0]!.elementId, restored.id);
  assert.ok(leeches[0]!.reasons.includes("chronic-postpones"));

  const heatmap = activityHeatmap(events, now, 26);
  assert.equal(heatmap.totalCount, 0);
});
