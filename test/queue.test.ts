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

test("review items order by priority then due time (interleave off)", () => {
  // With interleave on (the new default) two items at priority 10 would
  // shuffle relative to each other. Disable for this test, which exists
  // to pin the deterministic fallback ordering.
  const q = interleavedQueue(
    [
      entry({ id: "low", priority: 50, dueMs: 10 }),
      entry({ id: "high", priority: 10, dueMs: 20 }),
      entry({ id: "tieA", priority: 10, dueMs: 5 }),
    ],
    0,
    NOW,
    { interleaveSimilarPriority: false },
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

/* ------------------------------------------------------------------ */
/* Interleave (SuperMemo "interwoven learning")                        */
/* ------------------------------------------------------------------ */

const SAME_DAY = 1_700_000_000_000;
const NEXT_DAY = SAME_DAY + 86_400_000;

test("interleave: same priority shuffles, different priorities still ordered", () => {
  // Four items at priority 10, one each at 0 and 99. Priority-10 items must
  // come AFTER 0 and BEFORE 99 regardless of shuffle.
  const entries = [
    entry({ id: "top", priority: 0 }),
    entry({ id: "a", priority: 10 }),
    entry({ id: "b", priority: 10 }),
    entry({ id: "c", priority: 10 }),
    entry({ id: "d", priority: 10 }),
    entry({ id: "bottom", priority: 99 }),
  ];
  const q = interleavedQueue(entries, 0, SAME_DAY, {
    interleaveSimilarPriority: true,
  });
  assert.equal(q[0], "top", "priority-0 first");
  assert.equal(q[q.length - 1], "bottom", "priority-99 last");
  const mid = q.slice(1, -1).sort();
  assert.deepEqual(
    mid,
    ["a", "b", "c", "d"],
    "every priority-10 id present exactly once",
  );
});

test("interleave: same day is stable across calls (resumable session)", () => {
  const entries = [
    entry({ id: "a", priority: 10 }),
    entry({ id: "b", priority: 10 }),
    entry({ id: "c", priority: 10 }),
    entry({ id: "d", priority: 10 }),
  ];
  const q1 = interleavedQueue(entries, 0, SAME_DAY, {
    interleaveSimilarPriority: true,
  });
  const q2 = interleavedQueue(entries, 0, SAME_DAY + 60_000, {
    interleaveSimilarPriority: true,
  });
  assert.deepEqual(
    q1,
    q2,
    "same calendar day → same permutation, even minutes apart",
  );
});

test("interleave: different days produce different permutations (usually)", () => {
  // With 4 items there are 24 permutations; consecutive day-keys ought to
  // map to different ones in the LCG. If this ever flakes, raise the
  // sample size; the contract is "shuffle each day," not "every adjacent
  // pair of days must differ."
  const entries = [
    entry({ id: "a", priority: 10 }),
    entry({ id: "b", priority: 10 }),
    entry({ id: "c", priority: 10 }),
    entry({ id: "d", priority: 10 }),
  ];
  const dayA = interleavedQueue(entries, 0, SAME_DAY, {
    interleaveSimilarPriority: true,
  });
  const dayB = interleavedQueue(entries, 0, NEXT_DAY, {
    interleaveSimilarPriority: true,
  });
  assert.notDeepEqual(dayA, dayB, "next day → different order");
});

test("interleave off: deterministic priority + due-time order", () => {
  const entries = [
    entry({ id: "a", priority: 10, dueMs: 3 }),
    entry({ id: "b", priority: 10, dueMs: 1 }),
    entry({ id: "c", priority: 10, dueMs: 2 }),
  ];
  const q = interleavedQueue(entries, 0, SAME_DAY, {
    interleaveSimilarPriority: false,
  });
  assert.deepEqual(q, ["b", "c", "a"]);
});

test("interleave: default is on (SM-authentic)", () => {
  // No opts → interleave should engage. We can't assert the exact order
  // without baking in implementation details, but we CAN assert it differs
  // from the deterministic fallback when there are ties to shuffle.
  const entries = [
    entry({ id: "a", priority: 10, dueMs: 1 }),
    entry({ id: "b", priority: 10, dueMs: 2 }),
    entry({ id: "c", priority: 10, dueMs: 3 }),
    entry({ id: "d", priority: 10, dueMs: 4 }),
    entry({ id: "e", priority: 10, dueMs: 5 }),
    entry({ id: "f", priority: 10, dueMs: 6 }),
    entry({ id: "g", priority: 10, dueMs: 7 }),
    entry({ id: "h", priority: 10, dueMs: 8 }),
  ];
  const deterministic = interleavedQueue(entries, 0, SAME_DAY, {
    interleaveSimilarPriority: false,
  });
  const defaulted = interleavedQueue(entries, 0, SAME_DAY);
  assert.notDeepEqual(
    deterministic,
    defaulted,
    "default behavior should differ from explicitly-off",
  );
});
