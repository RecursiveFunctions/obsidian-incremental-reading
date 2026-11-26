import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mergeContiguousPdfSegments,
  pdfMarksBySourcePath,
  pdfTextItemPaint,
  selectLeafPdfTextSpans,
} from "../src/ir/pdf-marks";
import type { IrElement } from "../src/ir/model";
import type { ElementId } from "../src/ir/ids";

test("pdfTextItemPaint: inclusive index range, focus only the current card", () => {
  const marks = [
    {
      elementId: "el_a",
      page: 1,
      selection: [2, 0, 4, 1] as [number, number, number, number],
    },
    {
      elementId: "el_b",
      page: 1,
      selection: [10, 0, 10, 8] as [number, number, number, number],
    },
  ];
  assert.deepEqual(pdfTextItemPaint(1, marks, "el_a"), {
    source: false,
    focus: false,
  });
  assert.deepEqual(pdfTextItemPaint(2, marks, "el_a"), {
    source: true,
    focus: true,
  });
  assert.deepEqual(pdfTextItemPaint(4, marks, "el_a"), {
    source: true,
    focus: true,
  });
  assert.deepEqual(pdfTextItemPaint(10, marks, "el_a"), {
    source: true,
    focus: false,
  });
});

function extract(p: Omit<Partial<IrElement>, "id"> & { id: string }): IrElement {
  return {
    type: "extract",
    priority: 50,
    parentId: "el_parent" as ElementId,
    dismissed: false,
    created: 0,
    text: "hello",
    anchorState: "ok",
    ...p,
    id: p.id as ElementId,
  };
}

test("pdfMarksBySourcePath groups unpromoted PDF extracts by sourcePath", () => {
  const a = extract({
    id: "el_a",
    anchor: {
      sourcePath: "Papers/x.pdf",
      quote: { exact: "hello", prefix: "", suffix: "" },
      pdf: { page: 2, selection: [1, 0, 1, 5] },
    },
  });
  const b = extract({
    id: "el_b",
    anchor: {
      sourcePath: "Papers/x.pdf",
      quote: { exact: "world", prefix: "", suffix: "" },
      pdf: { page: 3, selection: [4, 0, 4, 5] },
    },
  });
  const md = extract({
    id: "el_md",
    anchor: {
      sourcePath: "Notes/a.md",
      quote: { exact: "nope", prefix: "", suffix: "" },
      position: { start: 0, end: 4 },
    },
  });
  const promoted = extract({
    id: "el_p",
    notePath: "Extracts/hello.md",
    anchor: {
      sourcePath: "Papers/x.pdf",
      quote: { exact: "hello", prefix: "", suffix: "" },
      pdf: { page: 2, selection: [1, 0, 1, 5] },
    },
  });
  const pageOnly = extract({
    id: "el_page",
    anchor: {
      sourcePath: "Papers/x.pdf",
      quote: { exact: "", prefix: "", suffix: "" },
      pdf: { page: 9, selection: [0, 0, 0, 0] },
    },
  });

  const map = pdfMarksBySourcePath([a, b, md, promoted, pageOnly]);
  assert.equal(map.size, 1);
  const marks = map.get("Papers/x.pdf") ?? [];
  assert.equal(marks.length, 2);
  assert.deepEqual(
    marks.map((m) => m.elementId).sort(),
    ["el_a", "el_b"],
  );
});

test("pdfTextItemPaint normalizes reversed [beginIndex, endIndex] tuples from out-of-order bullet streams (#119)", () => {
  const marks = [
    {
      elementId: "el_bullets",
      page: 1,
      selection: [12, 0, 4, 18] as [number, number, number, number],
    },
  ];
  assert.deepEqual(pdfTextItemPaint(3, marks, "el_bullets"), {
    source: false,
    focus: false,
  });
  assert.deepEqual(pdfTextItemPaint(4, marks, "el_bullets"), {
    source: true,
    focus: true,
  });
  assert.deepEqual(pdfTextItemPaint(8, marks, "el_bullets"), {
    source: true,
    focus: true,
  });
  assert.deepEqual(pdfTextItemPaint(12, marks, "el_bullets"), {
    source: true,
    focus: true,
  });
});

test("mergeContiguousPdfSegments coalesces out-of-order bullet & body text indices into sorted contiguous segments (#119)", () => {
  // Bullet glyphs emitted at idx 30..32 while bullet body lines are idx 2..5
  const segs = mergeContiguousPdfSegments(1, [
    { idx: 30, startOffset: 0, endOffset: 1 },
    { idx: 2, startOffset: 0, endOffset: 24 },
    { idx: 3, startOffset: 0, endOffset: 19 },
    { idx: 31, startOffset: 0, endOffset: 1 },
    { idx: 4, startOffset: 0, endOffset: 30 },
    { idx: 32, startOffset: 0, endOffset: 1 },
    { idx: 5, startOffset: 0, endOffset: 15 },
  ]);
  assert.deepEqual(segs, [
    { page: 1, selection: [2, 0, 5, 15] },
    { page: 1, selection: [30, 0, 32, 1] },
  ]);

  // Single-char bullet at idx=0 stays non-zero so pdfSelectionIsRange treats it as a real range
  const zeroIdx = mergeContiguousPdfSegments(1, [
    { idx: 0, startOffset: 0, endOffset: 0 },
  ]);
  assert.deepEqual(zeroIdx, [{ page: 1, selection: [0, 0, 0, 1] }]);
});

test("selectLeafPdfTextSpans unwraps pdf.js .markedContent wrappers so bullet list spans match leaf indices and have non-zero rects (#119)", () => {
  interface FakeSpan {
    tagName: string;
    classList: { contains(cls: string): boolean };
    dataset: { idx?: string };
    children: FakeSpan[];
    text?: string;
  }
  const leaf = (text: string, idx?: string): FakeSpan => ({
    tagName: "SPAN",
    classList: { contains: () => false },
    dataset: idx !== undefined ? { idx } : {},
    children: [],
    text,
  });
  const markedContent = (children: FakeSpan[]): FakeSpan => ({
    tagName: "SPAN",
    classList: { contains: (c) => c === "markedContent" },
    dataset: {},
    children,
  });

  const heading = leaf("Slide title");
  const b1Dot = leaf("• ");
  const b1Text = leaf("First bullet point");
  const b2Dot = leaf("• ");
  const b2Text = leaf("Second bullet point");
  const allSpans: FakeSpan[] = [
    heading,
    markedContent([b1Dot, b1Text]),
    b1Dot,
    b1Text,
    markedContent([b2Dot, b2Text]),
    b2Dot,
    b2Text,
  ];

  const leaves = selectLeafPdfTextSpans(allSpans);
  assert.deepEqual(
    leaves.map((s) => s.text),
    ["Slide title", "• ", "First bullet point", "• ", "Second bullet point"],
  );
});
