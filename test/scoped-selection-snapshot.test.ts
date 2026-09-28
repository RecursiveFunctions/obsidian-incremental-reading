import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isScopedSelectionCurrent,
  scopeSelectionSnapshot,
} from "../src/ir/scoped-selection-snapshot";

test("scoped selection only matches its originating leaf and file", () => {
  const leaf = {};
  const snapshot = scopeSelectionSnapshot(leaf, "notes/a.md", "alpha");
  assert.ok(isScopedSelectionCurrent(snapshot, leaf, "notes/a.md"));
  assert.equal(isScopedSelectionCurrent(snapshot, {}, "notes/a.md"), false);
  assert.equal(isScopedSelectionCurrent(snapshot, leaf, "notes/b.md"), false);
});
