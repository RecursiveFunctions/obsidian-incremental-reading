/**
 * Preserve Markdown editor selections across UI that steals focus (mobile FAB,
 * radial overlay). Capture on pointerdown before blur; restore when an action runs.
 */

import type { Editor, EditorPosition, TFile } from "obsidian";

export type EditorSelectionSnapshot = {
  path: string;
  from: EditorPosition;
  to: EditorPosition;
  text: string;
  capturedAt: number;
};

export function captureEditorSelection(
  file: TFile,
  editor: Editor,
): EditorSelectionSnapshot | null {
  const text = editor.getSelection().trim();
  if (!text) return null;
  const from = editor.getCursor("from");
  const to = editor.getCursor("to");
  return {
    path: file.path,
    from: { line: from.line, ch: from.ch },
    to: { line: to.line, ch: to.ch },
    text,
    capturedAt: Date.now(),
  };
}

/** Prefer a live selection; fall back to a recent snapshot for the same file. */
export function snapshotSelectionText(
  snap: EditorSelectionSnapshot | null,
  file: TFile,
  editor: Editor,
  maxAgeMs = 60_000,
): string {
  const live = editor.getSelection().trim();
  if (live) return live;
  if (!snap || snap.path !== file.path) return "";
  if (Date.now() - snap.capturedAt > maxAgeMs) return "";
  return snap.text;
}

export function restoreEditorSelection(
  snap: EditorSelectionSnapshot | null,
  file: TFile,
  editor: Editor,
  maxAgeMs = 60_000,
): boolean {
  if (!snap || snap.path !== file.path) return false;
  if (Date.now() - snap.capturedAt > maxAgeMs) return false;
  editor.setSelection(snap.from, snap.to);
  return true;
}
