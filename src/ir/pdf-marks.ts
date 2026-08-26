/**
 * Pure grouping of store extracts that live in a PDF. The painter in
 * `pdf-decorations.ts` consumes this; tests do not need a pdf.js runtime.
 */

import type { IrElement } from "./model";
import { pdfSelectionIsRange } from "./pdf-fragment";

export interface PdfExtractMark {
  elementId: string;
  page: number;
  selection: [number, number, number, number];
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
    if (idx < beginIndex || idx > endIndex) continue;
    source = true;
    if (emphasizeId && m.elementId === emphasizeId) focus = true;
  }
  return { source, focus };
}
