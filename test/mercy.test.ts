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
