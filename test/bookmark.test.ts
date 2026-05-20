/**
 * Golden contract for src/ir/bookmark.ts (v0.2 roadmap: reading bookmarks).
 *
 * Pure per-topic reading-position state. set / get / clear, immutable,
 * deterministic: identical inputs yield byte-identical JSON. Claude-authored,
 * fenced out of the delegated scope. Skips until the module exists so
 * `npm test` stays green; computed specifier keeps tsc from failing on the
 * missing module.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const SPEC = ["..", "src", "ir", "bookmark.ts"].join("/");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function load(): Promise<any> {
  try {
    return await import(SPEC);
  } catch {
    return null;
  }
}

const T0 = 1_700_000_000_000;
const T1 = 1_700_000_001_000;

function mkBookmark(
  id: string,
  line: number,
  ch: number,
  scrollTop: number,
  updatedAt: number,
) {
  return { elementId: id, line, ch, scrollTop, updatedAt };
}

test("getBookmark on an empty map returns null", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/bookmark.ts not implemented yet");
  const empty = {} as Record<string, unknown>;
  assert.equal(m.getBookmark(empty, "el_missing"), null);
});

test("setBookmark adds a new entry and returns a new map (purity)", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/bookmark.ts not implemented yet");
  const empty = {};
  const b = mkBookmark("el_a", 12, 4, 240, T0);
  const next = m.setBookmark(empty, b);
  assert.notEqual(next, empty);
  assert.deepEqual(empty, {}, "original state must not be mutated");
  assert.deepEqual(m.getBookmark(next, "el_a"), b);
});

test("setBookmark replaces an existing entry for the same elementId", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/bookmark.ts not implemented yet");
  let s = m.setBookmark({}, mkBookmark("el_a", 1, 0, 0, T0));
  s = m.setBookmark(s, mkBookmark("el_a", 99, 7, 1024, T1));
  const got = m.getBookmark(s, "el_a");
  assert.deepEqual(got, mkBookmark("el_a", 99, 7, 1024, T1));
});

test("clearBookmark removes the entry; idempotent on a missing id", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/bookmark.ts not implemented yet");
  let s = m.setBookmark({}, mkBookmark("el_a", 1, 0, 0, T0));
  s = m.setBookmark(s, mkBookmark("el_b", 2, 0, 0, T0));
  const cleared = m.clearBookmark(s, "el_a");
  assert.equal(m.getBookmark(cleared, "el_a"), null);
  assert.deepEqual(m.getBookmark(cleared, "el_b"), mkBookmark("el_b", 2, 0, 0, T0));

  // clearing a nonexistent id is a no-op that still returns a value equal to
  // the input (allowed to be either same ref or a fresh equal copy).
  const cleared2 = m.clearBookmark(cleared, "el_missing");
  assert.deepEqual(cleared2, cleared);
});

test("clearBookmark does not mutate the input map", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/bookmark.ts not implemented yet");
  const s = m.setBookmark({}, mkBookmark("el_a", 1, 0, 0, T0));
  const snap = JSON.parse(JSON.stringify(s));
  m.clearBookmark(s, "el_a");
  assert.deepEqual(s, snap, "clearBookmark must not mutate its input");
});

test("setBookmark output is deterministic regardless of insertion order", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/bookmark.ts not implemented yet");
  const a = mkBookmark("el_a", 1, 0, 0, T0);
  const b = mkBookmark("el_b", 2, 0, 0, T0);
  const c = mkBookmark("el_c", 3, 0, 0, T0);

  const s1 = m.setBookmark(m.setBookmark(m.setBookmark({}, a), b), c);
  const s2 = m.setBookmark(m.setBookmark(m.setBookmark({}, c), a), b);
  const s3 = m.setBookmark(m.setBookmark(m.setBookmark({}, b), c), a);

  assert.equal(
    JSON.stringify(s1),
    JSON.stringify(s2),
    "different insertion order must yield byte-identical JSON",
  );
  assert.equal(JSON.stringify(s1), JSON.stringify(s3));
});

test("clear then set the same id is equivalent to set on the original", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/bookmark.ts not implemented yet");
  const b1 = mkBookmark("el_a", 5, 2, 100, T0);
  const b2 = mkBookmark("el_a", 7, 3, 200, T1);
  const direct = m.setBookmark(m.setBookmark({}, b1), b2);
  const viaClear = m.setBookmark(m.clearBookmark(m.setBookmark({}, b1), "el_a"), b2);
  assert.equal(JSON.stringify(direct), JSON.stringify(viaClear));
});
