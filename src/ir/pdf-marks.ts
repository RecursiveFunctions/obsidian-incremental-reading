/**
 * Pure grouping of ledger extracts that live in a PDF. The painter in
 * `pdf-decorations.ts` consumes this; tests do not need a pdf.js runtime.
 */

import type { IrElement, PdfSegment } from "./model";
import { pdfSelectionIsRange } from "./pdf-fragment";

export interface PdfExtractMark {
  elementId: string;
  page: number;
  selection: [number, number, number, number];
}

export interface PdfSpanLike {
  classList: { contains(cls: string): boolean };
  dataset: { idx?: string };
  children: ArrayLike<{ tagName?: string }>;
}

/**
 * Filter `.textLayer span` descendants down to leaf text spans, unwrapping
 * PDF.js v4 `.markedContent` (`display: contents`) structural wrappers (#119).
 */
export function selectLeafPdfTextSpans<T extends PdfSpanLike>(
  spans: ArrayLike<T> | Iterable<T>,
): T[] {
  const arr = Array.from(spans);
  const withIdx = arr.filter(
    (el) => el.dataset.idx !== undefined && el.dataset.idx !== "",
  );
  if (withIdx.length > 0) return withIdx;
  return arr.filter((el) => {
    if (el.classList.contains("markedContent")) return false;
    if (el.classList.contains("endOfContent")) return false;
    for (let i = 0; i < el.children.length; i += 1) {
      if (el.children[i]?.tagName?.toUpperCase() === "SPAN") return false;
    }
    return true;
  });
}

/**
 * Coalesce intersected PDF text-layer item indices into sorted contiguous
 * `PdfSegment` runs on `page`. Handles non-monotonic `data-idx` ordering
 * (e.g. bullet glyphs emitted after body lines in the PDF stream, #119).
 */
export function mergeContiguousPdfSegments(
  page: number,
  hits: ReadonlyArray<{ idx: number; startOffset: number; endOffset: number }>,
): PdfSegment[] {
  if (hits.length === 0) return [];
  const byIdx = new Map<number, { startOffset: number; endOffset: number }>();
  for (const h of hits) {
    if (!Number.isInteger(h.idx) || h.idx < 0) continue;
    const s = Math.max(0, Math.trunc(h.startOffset));
    const e = Math.max(s, Math.trunc(h.endOffset));
    const prev = byIdx.get(h.idx);
    if (!prev) {
      byIdx.set(h.idx, { startOffset: s, endOffset: e });
    } else {
      byIdx.set(h.idx, {
        startOffset: Math.min(prev.startOffset, s),
        endOffset: Math.max(prev.endOffset, e),
      });
    }
  }
  const sorted = Array.from(byIdx.entries()).sort((a, b) => a[0] - b[0]);
  if (sorted.length === 0) return [];

  const out: PdfSegment[] = [];
  let curStartIdx = sorted[0]![0];
  let curStartOff = sorted[0]![1].startOffset;
  let curEndIdx = sorted[0]![0];
  let curEndOff = sorted[0]![1].endOffset;

  const pushCurrent = () => {
    // Guard against [0, 0, 0, 0] (the page-only placeholder) when a single span at idx=0 is selected.
    const safeEndOff =
      curStartIdx === 0 && curStartOff === 0 && curEndIdx === 0 && curEndOff === 0
        ? 1
        : curEndOff;
    out.push({
      page,
      selection: [curStartIdx, curStartOff, curEndIdx, safeEndOff],
    });
  };

  for (let i = 1; i < sorted.length; i += 1) {
    const [idx, offs] = sorted[i]!;
    if (idx === curEndIdx + 1) {
      curEndIdx = idx;
      curEndOff = offs.endOffset;
    } else {
      pushCurrent();
      curStartIdx = idx;
      curStartOff = offs.startOffset;
      curEndIdx = idx;
      curEndOff = offs.endOffset;
    }
  }
  pushCurrent();
  return out;
}

/**
 * Vault path → extract highlights to paint. Promoted extracts (they have a
 * markdown `notePath`) are skipped: those are notes now, not source marks.
 * Page-only placeholders (`0,0,0,0`) are not paint targets.
 */
export function pdfMarksBySourcePath(
  elements: Iterable<IrElement>,
): Map<string, PdfExtractMark[]> {
  const out = new Map<string, PdfExtractMark[]>();
  for (const el of elements) {
    if (el.type !== "extract") continue;
    if (el.notePath !== undefined) continue;
    const pdf = el.anchor?.pdf;
    if (!pdf || !el.anchor) continue;
    const path = el.anchor.sourcePath;
    const bucket = out.get(path) ?? [];
    // Multi-selection extracts paint every span; single ones paint the
    // top-level selector (which equals their only span).
    const spans =
      pdf.segments && pdf.segments.length > 0
        ? pdf.segments
        : [{ page: pdf.page, selection: pdf.selection }];
    for (const span of spans) {
      if (!pdfSelectionIsRange(span.selection)) continue;
      bucket.push({
        elementId: el.id,
        page: span.page,
        selection: span.selection,
      });
    }
    if (bucket.length > 0) out.set(path, bucket);
  }
  return out;
}

/**
 * Which CSS classes a text-layer item (pdf.js `data-idx`) should get.
 * Selection tuples are inclusive on both indices.
 */
export function pdfTextItemPaint(
  idx: number,
  marks: readonly PdfExtractMark[],
  emphasizeId: string | null,
): { source: boolean; focus: boolean } {
  let source = false;
  let focus = false;
  for (const m of marks) {
    const [beginIndex, , endIndex] = m.selection;
    const lo = Math.min(beginIndex, endIndex);
    const hi = Math.max(beginIndex, endIndex);
    if (idx < lo || idx > hi) continue;
    source = true;
    if (emphasizeId && m.elementId === emphasizeId) focus = true;
  }
  return { source, focus };
}
