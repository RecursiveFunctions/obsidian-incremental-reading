import { test } from "node:test";
import assert from "node:assert/strict";
import type { ElementId } from "../src/ir/ids";
import {
  parseSessionSnapshot,
  repetitionDayKey,
  restoreSessionSnapshot,
  type SessionSnapshot,
} from "../src/ir/session-snapshot";

const id = (value: string) => value as ElementId;
const snapshot: SessionSnapshot = {
  schemaVersion: 1,
  mode: "due",
  orderedIds: [id("a"), id("b"), id("c")],
  cursor: 1,
  seed: 42,
  policyVersion: 1,
  repetitionDayKey: "2026-10-08",
  createdAt: 1,
};

test("session snapshots round-trip and deduplicate IDs", () => {
  assert.deepEqual(parseSessionSnapshot(JSON.parse(JSON.stringify(snapshot))), snapshot);
  assert.deepEqual(parseSessionSnapshot({ ...snapshot, orderedIds: ["a", "a", "b"] })?.orderedIds,
    [id("a"), id("b")]);
});

test("invalid or future session snapshot schemas fail closed", () => {
  assert.equal(parseSessionSnapshot({ ...snapshot, schemaVersion: 2 }), null);
  assert.equal(parseSessionSnapshot({ ...snapshot, cursor: -1 }), null);
  assert.equal(parseSessionSnapshot("broken"), null);
});

test("restore preserves current ID while dropping missing entries", () => {
  const restored = restoreSessionSnapshot(snapshot, new Set([id("b"), id("c")]), "2026-10-08", 1);
  assert.deepEqual(restored?.orderedIds, [id("b"), id("c")]);
  assert.equal(restored?.cursor, 0);
});

test("due sessions expire at repetition-day rollover but random sessions do not", () => {
  const available = new Set(snapshot.orderedIds);
  assert.equal(restoreSessionSnapshot(snapshot, available, "2026-10-09", 1), null);
  assert.ok(restoreSessionSnapshot({ ...snapshot, mode: "random" }, available, "2026-10-09", 1));
});

test("repetition day keys use the local calendar date", () => {
  const date = new Date(2026, 9, 8, 23, 30);
  assert.equal(repetitionDayKey(date), "2026-10-08");
});
