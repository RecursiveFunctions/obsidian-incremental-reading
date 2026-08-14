import assert from "node:assert/strict";
import { test } from "node:test";
import {
  irWorkspaceFabShouldShow,
  sessionHubKinds,
} from "../src/ir/mobile-hub";

test("session hub offers Start review and the tree outside an IR session", () => {
  assert.deepEqual(
    sessionHubKinds({
      inReview: false,
      hasMarkdownFile: false,
      alreadyIr: false,
    }),
    ["start-review", "open-tree"],
  );
});

test("session hub adds Mark as IR topic on a plain markdown note", () => {
  assert.deepEqual(
    sessionHubKinds({
      inReview: false,
      hasMarkdownFile: true,
      alreadyIr: false,
    }),
    ["start-review", "open-tree", "mark-topic"],
  );
});

test("Go neural is only on the hub when the current note is already IR", () => {
  assert.deepEqual(
    sessionHubKinds({
      inReview: false,
      hasMarkdownFile: true,
      alreadyIr: true,
    }),
    ["start-review", "open-tree", "go-neural"],
  );
});

test("review hub keeps Start review, the tree, and Go neural", () => {
  assert.deepEqual(
    sessionHubKinds({
      inReview: true,
      hasMarkdownFile: true,
      alreadyIr: true,
    }),
    ["start-review", "open-tree", "go-neural"],
  );
});

test("workspace FAB is mobile-only and not gated on an open note", () => {
  assert.equal(irWorkspaceFabShouldShow(true), true);
  assert.equal(irWorkspaceFabShouldShow(false), false);
});
