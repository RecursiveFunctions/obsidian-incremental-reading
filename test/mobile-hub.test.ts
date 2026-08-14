import assert from "node:assert/strict";
import { test } from "node:test";
import {
  irWorkspaceFabShouldShow,
  sessionHubKinds,
} from "../src/ir/mobile-hub";

test("session hub always offers Start review outside an IR session", () => {
  assert.deepEqual(
    sessionHubKinds({
      inReview: false,
      hasMarkdownFile: false,
      alreadyIr: false,
    }),
    ["start-review", "go-neural"],
  );
});

test("session hub adds Mark as IR topic on a plain markdown note", () => {
  assert.deepEqual(
    sessionHubKinds({
      inReview: false,
      hasMarkdownFile: true,
      alreadyIr: false,
    }),
    ["start-review", "go-neural", "mark-topic"],
  );
});

test("session hub skips Mark as topic when the note is already IR", () => {
  assert.deepEqual(
    sessionHubKinds({
      inReview: false,
      hasMarkdownFile: true,
      alreadyIr: true,
    }),
    ["start-review", "go-neural"],
  );
});

test("session hub stays out of the way during review", () => {
  assert.deepEqual(
    sessionHubKinds({
      inReview: true,
      hasMarkdownFile: true,
      alreadyIr: true,
    }),
    [],
  );
});

test("workspace FAB is mobile-only and not gated on an open note", () => {
  assert.equal(irWorkspaceFabShouldShow(true), true);
  assert.equal(irWorkspaceFabShouldShow(false), false);
});
