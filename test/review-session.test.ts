import { test } from "node:test";
import assert from "node:assert/strict";
import {
  contextSourceParentId,
  EMPTY_COLLECTION_COPY,
  EMPTY_NEURAL_COPY,
  sessionBarLabel,
  refreshQueuedSlot,
  type ReviewSlot,
} from "../src/review";
import type { IrElement } from "../src/ir/model";
import type { ElementId } from "../src/ir/ids";

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
