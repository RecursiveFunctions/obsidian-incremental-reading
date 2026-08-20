import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canUseReviewLivePreview,
  isLivePreviewEditorState,
  isSourceEditorState,
  livePreviewEditorState,
  sourceEditorState,
} from "../src/ir/review-live-preview";

test("livePreviewEditorState is editing + Live Preview, not source mode", () => {
  const state = livePreviewEditorState({ file: "Note.md" });
  assert.equal(state.mode, "source");
  assert.equal(state.source, false);
  assert.equal(state.file, "Note.md");
  assert.equal(isLivePreviewEditorState(state), true);
  assert.equal(isSourceEditorState(state), false);
});

test("sourceEditorState is raw markdown source mode", () => {
  const state = sourceEditorState({ file: "Note.md" });
  assert.equal(state.mode, "source");
  assert.equal(state.source, true);
  assert.equal(isSourceEditorState(state), true);
  assert.equal(isLivePreviewEditorState(state), false);
});

test("source mode is not Live Preview", () => {
  assert.equal(
    isLivePreviewEditorState({ mode: "source", source: true }),
    false,
  );
  assert.equal(isLivePreviewEditorState({ mode: "preview" }), false);
});

test("canUseReviewLivePreview: desktop markdown only", () => {
  assert.equal(canUseReviewLivePreview({ extension: "md" }, false), true);
  assert.equal(canUseReviewLivePreview({ extension: "md" }, true), false);
  assert.equal(canUseReviewLivePreview({ extension: "pdf" }, false), false);
  assert.equal(canUseReviewLivePreview(null, false), false);
});
