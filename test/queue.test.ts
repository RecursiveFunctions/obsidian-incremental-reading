import { test } from "node:test";
import assert from "node:assert/strict";
import { interleavedQueue, type QueueEntry } from "../src/queue";

const NOW = 1_000_000;

function entry(p: Partial<QueueEntry> & { id: string }): QueueEntry {
  return {
    type: "item",
    priority: 50,
    dueMs: 0,
    dismissed: false,
    ...p,
  };
}

test("review items order by priority then due time", () => {
  const q = interleavedQueue(
    [
      entry({ id: "low", priority: 50, dueMs: 10 }),
      entry({ id: "high", priority: 10, dueMs: 20 }),
      entry({ id: "tieA", priority: 10, dueMs: 5 }),
    ],
    0,
    NOW,
  );
  assert.deepEqual(q, ["tieA", "high", "low"]);
});

test("excludes future, dismissed, and non-IR entries", () => {
  const q = interleavedQueue(
    [
      entry({ id: "due" }),
      entry({ id: "future", dueMs: NOW + 1 }),
      entry({ id: "dismissed", dismissed: true }),
      entry({ id: "notIR", type: "" }),
    ],
    0,
    NOW,
  );
  assert.deepEqual(q, ["due"]);
});

test("interleaves one reading element every N review items", () => {
  const items = Array.from({ length: 7 }, (_, i) =>
    entry({ id: `i${i + 1}`, priority: i }),
  );
  const reading = [
    entry({ id: "r1", type: "topic", priority: 1 }),
    entry({ id: "r2", type: "extract", priority: 2 }),
  ];
  const q = interleavedQueue([...items, ...reading], 3, NOW);
  assert.deepEqual(q, [
    "i1",
    "i2",
    "i3",
    "r1",
    "i4",
    "i5",
    "i6",
    "r2",
    "i7",
  ]);
});

test("ratio 0 returns review items only, no reading", () => {
  const q = interleavedQueue(
    [
      entry({ id: "i1", priority: 1 }),
      entry({ id: "r1", type: "topic", priority: 0 }),
    ],
    0,
    NOW,
  );
  assert.deepEqual(q, ["i1"]);
});

test("leftover reading elements are appended after the items run out", () => {
  const q = interleavedQueue(
    [
      entry({ id: "i1", priority: 1 }),
      entry({ id: "i2", priority: 2 }),
      entry({ id: "r1", type: "topic", priority: 1 }),
      entry({ id: "r2", type: "topic", priority: 2 }),
      entry({ id: "r3", type: "topic", priority: 3 }),
    ],
    3,
    NOW,
  );
  assert.deepEqual(q, ["i1", "i2", "r1", "r2", "r3"]);
});
