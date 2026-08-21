/**
 * Decide when a rendered-card gesture should leave reading mode for the
 * in-card editor. Highlight → extract/cloze must win over click-to-edit.
 */

/** Pointer travel (px) that counts as drag-to-select, not an edit gesture. */
export const PREVIEW_EDIT_DRAG_THRESHOLD_PX = 6;

export type PreviewEditGesture = {
  /** Euclidean distance from pointerdown to the edit gesture. */
  movedPx: number;
  /** True when the document selection is empty / caret-only. */
  selectionCollapsed: boolean;
  /** True when the selection anchor sits inside the preview body. */
  selectionInBody: boolean;
  /**
   * Ctrl/Cmd-click: force edit even when a selection exists (caret landing).
   * Plain double-click still respects selection so word-select stays in preview.
   */
  forceEdit?: boolean;
};

/**
 * Whether a preview-body gesture should open the source editor.
 * Drag-to-highlight and non-empty in-body selections stay in reading mode.
 */
export function shouldEnterEditFromPreviewGesture(
  g: PreviewEditGesture,
  dragThresholdPx: number = PREVIEW_EDIT_DRAG_THRESHOLD_PX,
): boolean {
  if (g.forceEdit) return true;
  if (g.movedPx > dragThresholdPx) return false;
  if (!g.selectionCollapsed && g.selectionInBody) return false;
  return true;
}
