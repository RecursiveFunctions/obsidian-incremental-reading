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
    if (!pdfSelectionIsRange(pdf.selection)) continue;
    const path = el.anchor.sourcePath;
    const bucket = out.get(path) ?? [];
    bucket.push({
      elementId: el.id,
      page: pdf.page,
      selection: pdf.selection,
    });
    out.set(path, bucket);
  }
  return out;
}
