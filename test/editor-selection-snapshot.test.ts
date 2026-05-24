import assert from "node:assert/strict";
import { test } from "node:test";
import type { Editor, TFile } from "obsidian";
import {
  captureEditorSelection,
  restoreEditorSelection,
  snapshotSelectionText,
} from "../src/ir/editor-selection-snapshot";

const file = { path: "notes/a.md", extension: "md" } as TFile;

function editorWithSelection(
  text: string,
  from: { line: number; ch: number },
  to: { line: number; ch: number },
): Editor {
  let selFrom = { ...from };
  let selTo = { ...to };
  const value = text;
  return {
    getSelection: () => {
      if (selFrom.line === selTo.line) {
        return value.split("\n")[selFrom.line]!.slice(selFrom.ch, selTo.ch);
      }
      const lines = value.split("\n");
      return [
        lines[selFrom.line]!.slice(selFrom.ch),
        ...lines.slice(selFrom.line + 1, selTo.line),
        lines[selTo.line]!.slice(0, selTo.ch),
      ].join("\n");
    },
    getCursor: (which: "from" | "to") => (which === "from" ? selFrom : selTo),
    setSelection: (f, t) => {
      selFrom = { ...f };
      selTo = { ...t };
    },
  } as unknown as Editor;
}

test("captureEditorSelection returns null when nothing selected", () => {
  const ed = editorWithSelection("hello", { line: 0, ch: 2 }, { line: 0, ch: 2 });
  assert.equal(captureEditorSelection(file, ed), null);
});

test("snapshotSelectionText uses snapshot when live selection cleared", () => {
  const ed = editorWithSelection("alpha beta", { line: 0, ch: 0 }, { line: 0, ch: 5 });
  const snap = captureEditorSelection(file, ed);
  assert.ok(snap);
  ed.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 0 });
  assert.equal(ed.getSelection().trim(), "");
  assert.equal(snapshotSelectionText(snap, file, ed), "alpha");
});

test("restoreEditorSelection puts cursors back for hub actions", () => {
  const ed = editorWithSelection("alpha beta", { line: 0, ch: 0 }, { line: 0, ch: 5 });
  const snap = captureEditorSelection(file, ed)!;
  ed.setSelection({ line: 0, ch: 6 }, { line: 0, ch: 6 });
  assert.ok(restoreEditorSelection(snap, file, ed));
  assert.equal(ed.getSelection(), "alpha");
});
