import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeReviewAction } from "../src/ir/review-escape";

test("escape: edit mode returns to preview before leaving IR", () => {
  assert.deepEqual(
    escapeReviewAction({
      sessionComplete: false,
      emptyVault: false,
      editing: true,
      isNeural: false,
    }),
    { kind: "exit-edit" },
  );
});

test("escape: edit wins over neural", () => {
  assert.deepEqual(
    escapeReviewAction({
      sessionComplete: false,
      emptyVault: false,
      editing: true,
      isNeural: true,
    }),
    { kind: "exit-edit" },
  );
});

test("escape: reading mode leaves IR", () => {
  assert.deepEqual(
    escapeReviewAction({
      sessionComplete: false,
      emptyVault: false,
      editing: false,
      isNeural: false,
    }),
    { kind: "detach" },
  );
});

test("escape: neural (not editing) ends the pass", () => {
  assert.deepEqual(
    escapeReviewAction({
      sessionComplete: false,
      emptyVault: false,
      editing: false,
      isNeural: true,
    }),
    { kind: "end-neural" },
  );
});

test("escape: session complete / empty vault leave the tab", () => {
  assert.deepEqual(
    escapeReviewAction({
      sessionComplete: true,
      emptyVault: false,
      editing: true,
      isNeural: false,
    }),
    { kind: "detach" },
  );
  assert.deepEqual(
    escapeReviewAction({
      sessionComplete: false,
      emptyVault: true,
      editing: false,
      isNeural: false,
    }),
    { kind: "detach" },
  );
});
