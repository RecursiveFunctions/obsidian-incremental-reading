import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PREVIEW_EDIT_DRAG_THRESHOLD_PX,
  shouldEnterEditFromPreviewGesture,
} from "../src/ir/preview-edit-gesture";

describe("shouldEnterEditFromPreviewGesture", () => {
  it("allows a still click with no selection", () => {
    assert.equal(
      shouldEnterEditFromPreviewGesture({
        movedPx: 0,
        selectionCollapsed: true,
        selectionInBody: false,
      }),
      true,
    );
  });

  it("blocks drag beyond the threshold", () => {
    assert.equal(
      shouldEnterEditFromPreviewGesture({
        movedPx: PREVIEW_EDIT_DRAG_THRESHOLD_PX + 1,
        selectionCollapsed: true,
        selectionInBody: false,
      }),
      false,
    );
  });

  it("blocks a non-empty selection inside the body", () => {
    assert.equal(
      shouldEnterEditFromPreviewGesture({
        movedPx: 0,
        selectionCollapsed: false,
        selectionInBody: true,
      }),
      false,
    );
  });

  it("allows forceEdit even with a body selection", () => {
    assert.equal(
      shouldEnterEditFromPreviewGesture({
        movedPx: 0,
        selectionCollapsed: false,
        selectionInBody: true,
        forceEdit: true,
      }),
      true,
    );
  });

  it("ignores selections outside the body", () => {
    assert.equal(
      shouldEnterEditFromPreviewGesture({
        movedPx: 0,
        selectionCollapsed: false,
        selectionInBody: false,
      }),
      true,
    );
  });
});
