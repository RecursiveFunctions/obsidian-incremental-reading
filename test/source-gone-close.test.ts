import assert from "node:assert/strict";
import { test } from "node:test";
import { sourceGoneNonButtonCloseChoice } from "../src/ir/source-gone-close";

test("non-button source-gone dismissal always preserves the tree", () => {
  assert.equal(sourceGoneNonButtonCloseChoice(), "undo");
});
