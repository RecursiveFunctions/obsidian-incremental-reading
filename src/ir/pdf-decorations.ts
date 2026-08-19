/**
 * Paint store-backed PDF extracts onto the core pdf.js text layer.
 *
 * Same contract as markdown decorations (DESIGN §Q3): never mutate the
 * source file. Classes match the markdown marks (`ir-extract-source`,
 * `ir-extract-highlight`) so styles.css can share the highlight color.
 *
 * pdf.js builds text layers lazily per page, so this re-paints on
 * `textlayerrendered` / DOM mutation (see `subscribePdfTextLayer`).
 */

import type { App } from "obsidian";
import type { PdfExtractMark } from "./pdf-marks";
import {
  PDF_VIEW_TYPE,
  pdfContainerEl,
  pdfFileFromView,
  subscribePdfTextLayer,
} from "./pdf-view";

const SOURCE_CLASS = "ir-extract-source";
const FOCUS_CLASS = "ir-extract-highlight";

function clearPaint(container: HTMLElement): void {
  container
    .querySelectorAll(`.${SOURCE_CLASS}, .${FOCUS_CLASS}`)
    .forEach((el) => {
      el.classList.remove(SOURCE_CLASS, FOCUS_CLASS);
    });
}

function paintPage(
  pageEl: HTMLElement,
  marks: PdfExtractMark[],
  emphasizeId: string | null,
): void {
  const items = Array.from(pageEl.querySelectorAll<HTMLElement>("[data-idx]"));
  for (const el of items) {
    const idx = Number(el.dataset.idx);
    if (!Number.isInteger(idx)) continue;
    for (const m of marks) {
      const [beginIndex, , endIndex] = m.selection;
      if (idx < beginIndex || idx > endIndex) continue;
      el.classList.add(SOURCE_CLASS);
      if (emphasizeId && m.elementId === emphasizeId) {
        el.classList.add(FOCUS_CLASS);
      }
    }
  }
}

export function paintPdfView(
  view: unknown,
  marks: PdfExtractMark[],
  emphasizeId: string | null,
): void {
  const container = pdfContainerEl(view);
  if (!container) return;
  clearPaint(container);
  if (marks.length === 0) return;
  const byPage = new Map<number, PdfExtractMark[]>();
  for (const m of marks) {
    const bucket = byPage.get(m.page) ?? [];
    bucket.push(m);
    byPage.set(m.page, bucket);
  }
  container.querySelectorAll<HTMLElement>(".page").forEach((pageEl) => {
    const page = Number(pageEl.getAttribute("data-page-number"));
    if (!Number.isInteger(page)) return;
    const pageMarks = byPage.get(page);
    if (!pageMarks) return;
    paintPage(pageEl, pageMarks, emphasizeId);
  });
}

export class PdfHighlightPainter {
  private unsubs: Array<() => void> = [];

  constructor(private readonly app: App) {}

  refresh(
    marksByPath: Map<string, PdfExtractMark[]>,
    emphasizeId: string | null,
  ): void {
    this.detach();
    for (const leaf of this.app.workspace.getLeavesOfType(PDF_VIEW_TYPE)) {
      const file = pdfFileFromView(leaf.view);
      if (!file) continue;
      const marks = marksByPath.get(file.path) ?? [];
      const view = leaf.view;
      paintPdfView(view, marks, emphasizeId);
      const unsub = subscribePdfTextLayer(view, () => {
        paintPdfView(view, marks, emphasizeId);
      });
      if (unsub) this.unsubs.push(unsub);
    }
  }

  detach(): void {
    for (const u of this.unsubs) {
      try {
        u();
      } catch {
        /* viewer already gone */
      }
    }
    this.unsubs = [];
  }
}
