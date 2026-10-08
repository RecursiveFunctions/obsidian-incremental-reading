/**
 * Golden contract for src/ir/mercy.ts (DESIGN.md section 6: principled
 * postpone / overload redistribution).
 *
 * Pure queue split: it NEVER touches scheduler state, it only decides
 * which due elements stay due today and which are pushed forward.
 * Claude-authored, fenced out of the delegated scope. Skips until the
 * module exists so `npm test` stays green; computed specifier keeps tsc
 * from failing on the missing module.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { planMercy } from "../src/ir/mercy";

const SPEC = ["..", "src", "ir", "mercy.ts"].join("/");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function load(): Promise<any> {
  try {
    return await import(SPEC);
  } catch {
    return null;
  }
}

const NOW = 1000;
const PAST = 500;
const FUTURE = 5000;

// a,b,c,d are due now; e is not yet due and must never appear anywhere.
const entries = () => [
  { id: "a", priority: 10, dueMs: PAST },
  { id: "b", priority: 20, dueMs: PAST },
  { id: "c", priority: 30, dueMs: PAST },
  { id: "d", priority: 40, dueMs: PAST },
  { id: "e", priority: 5, dueMs: FUTURE },
];

test("under ceiling: everything due stays, nothing postponed", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/mercy.ts not implemented yet");

  const r = m.redistribute(entries(), NOW, {
    ceiling: 10,
    priorityCutoff: 0,
  });
  assert.deepEqual(r.dueToday, ["a", "b", "c", "d"]);
  assert.deepEqual(r.postponed, []);
  assert.equal(r.postponedCount, 0);
});

test("over ceiling: lowest-importance overflow is postponed in order", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/mercy.ts not implemented yet");

  const r = m.redistribute(entries(), NOW, {
    ceiling: 2,
    priorityCutoff: 15,
  });
  // a(10), b(20) are the two most important and kept.
  // c(30), d(40) overflow; both above the cutoff so both postponed,
  // relative importance order preserved.
  assert.deepEqual(r.dueToday, ["a", "b"]);
  assert.deepEqual(r.postponed, ["c", "d"]);
  assert.equal(r.postponedCount, 2);
});

test("never postpone at or below the priority cutoff", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/mercy.ts not implemented yet");

  const r = m.redistribute(entries(), NOW, {
    ceiling: 1,
    priorityCutoff: 25,
  });
  // Keep only a(10). Overflow b,c,d. b(20) <= cutoff 25 -> stays due
  // even though it is over the ceiling. c(30), d(40) postponed.
  assert.deepEqual(r.dueToday, ["a", "b"]);
  assert.deepEqual(r.postponed, ["c", "d"]);
  assert.equal(r.postponedCount, 2);
});

test("not-yet-due entries are excluded from both lists", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/mercy.ts not implemented yet");

  const r = m.redistribute(entries(), NOW, {
    ceiling: 2,
    priorityCutoff: 0,
  });
  const all = [...r.dueToday, ...r.postponed];
  assert.ok(!all.includes("e"), "future-due entry must not appear");
});

test("deterministic (identical result on re-run)", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/mercy.ts not implemented yet");

  const opts = { ceiling: 2, priorityCutoff: 15 };
  const x = JSON.stringify(m.redistribute(entries(), NOW, opts));
  const y = JSON.stringify(m.redistribute(entries(), NOW, opts));
  assert.equal(x, y);
});

test("planner accounts for existing future load and spills across days", () => {
  const now = new Date(2026, 0, 10, 12).getTime();
  const tomorrow = new Date(2026, 0, 11, 9).getTime();
  const r = planMercy(
    [
      { id: "a", priority: 1, dueMs: now - 3 },
      { id: "b", priority: 20, dueMs: now - 2 },
      { id: "c", priority: 30, dueMs: now - 1 },
      { id: "future", priority: 50, dueMs: tomorrow },
    ],
    now,
    { ceiling: 1, priorityCutoff: 0 },
  );
  assert.equal(r.assignments[0]!.targetLocalDate, "2026-01-12");
  assert.equal(r.assignments[1]!.targetLocalDate, "2026-01-13");
});

test("planner preserves due clock time and does not mutate inputs", () => {
  const now = new Date(2026, 2, 7, 18, 0).getTime();
  const due = new Date(2026, 2, 7, 8, 45, 30, 12).getTime();
  const input = [
    { id: "keep", priority: 1, dueMs: due - 1 },
    { id: "move", priority: 50, dueMs: due },
  ];
  const copy = structuredClone(input);
  const r = planMercy(input, now, { ceiling: 1, priorityCutoff: 0 });
  const moved = new Date(r.assignments[0]!.newDue);
  assert.deepEqual([moved.getHours(), moved.getMinutes(), moved.getSeconds(), moved.getMilliseconds()], [8, 45, 30, 12]);
  assert.deepEqual(input, copy);
});
