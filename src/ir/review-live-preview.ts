/**
 * View-state helpers for review Live Preview vs source.
 * Pure: no Obsidian. `mode: "source"` is editing view; `source: false`
 * is Live Preview; `source: true` is the raw markdown editor.
 */

export type ReviewEditorKind = "live" | "source";

export function reviewEditorState(
  kind: ReviewEditorKind,
  prev?: Record<string, unknown>,
): Record<string, unknown> {
  return { ...prev, mode: "source", source: kind === "source" };
}

export function livePreviewEditorState(
  prev?: Record<string, unknown>,
): Record<string, unknown> {
  return reviewEditorState("live", prev);
}

export function sourceEditorState(
  prev?: Record<string, unknown>,
): Record<string, unknown> {
  return reviewEditorState("source", prev);
}

export function isReviewEditorState(
  state: unknown,
  kind: ReviewEditorKind,
): boolean {
  if (!state || typeof state !== "object") return false;
  const s = state as Record<string, unknown>;
  return s.mode === "source" && s.source === (kind === "source");
}

export function isLivePreviewEditorState(state: unknown): boolean {
  return isReviewEditorState(state, "live");
}

export function isSourceEditorState(state: unknown): boolean {
  return isReviewEditorState(state, "source");
}

export function canUseReviewLivePreview(
  file: { extension: string } | null | undefined,
  isMobile: boolean,
): boolean {
  if (isMobile || !file) return false;
  return file.extension === "md";
}
