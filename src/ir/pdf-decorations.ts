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
import { pdfTextItemPaint, type PdfExtractMark } from "./pdf-marks";
import {
  PDF_VIEW_TYPE,
  pdfContainerEl,
  pdfFileFromView,
  subscribePdfTextLayer,
} from "./pdf-view";

const SOURCE_CLASS = "ir-extract-source";
const FOCUS_CLASS = "ir-extract-highlight";
export const PDF_MARK_LAYER_CLASS = "ir-pdf-mark-layer";

function clearPaint(container: HTMLElement): void {
  container
    .querySelectorAll(`.${SOURCE_CLASS}, .${FOCUS_CLASS}`)
    .forEach((el) => {
      el.classList.remove(SOURCE_CLASS, FOCUS_CLASS);
    });
  container
    .querySelectorAll(`.${PDF_MARK_LAYER_CLASS}`)
    .forEach((el) => el.remove());
}

/**
 * pdf.js keeps the text layer nearly transparent (its spans exist for
 * selection, not display), so a background on a text span is barely
 * visible. Paint the highlight as its own layer between the canvas and
 * the text layer, one rect per marked span, sized from the span's box.
 */
export function paintOverlayRects(
  pageEl: HTMLElement,
  rects: ReadonlyArray<{ el: HTMLElement; focus: boolean }>,
): void {
  pageEl.querySelectorAll(`:scope > .${PDF_MARK_LAYER_CLASS}`).forEach((el) => el.remove());
  if (rects.length === 0) return;
  const pageBox = pageEl.getBoundingClientRect();
  if (pageBox.width === 0 || pageBox.height === 0) return;
  const layer = document.createElement("div");
  layer.className = PDF_MARK_LAYER_CLASS;
  for (const r of rects) {
    const b = r.el.getBoundingClientRect();
    if (b.width === 0 || b.height === 0) continue;
    const d = document.createElement("div");
    d.className = r.focus ? "ir-pdf-mark ir-pdf-mark--focus" : "ir-pdf-mark";
    d.style.left = `${((b.left - pageBox.left) / pageBox.width) * 100}%`;
    d.style.top = `${((b.top - pageBox.top) / pageBox.height) * 100}%`;
    d.style.width = `${(b.width / pageBox.width) * 100}%`;
    d.style.height = `${(b.height / pageBox.height) * 100}%`;
    layer.appendChild(d);
  }
  const textLayer = pageEl.querySelector(":scope > .textLayer");
  if (textLayer) pageEl.insertBefore(layer, textLayer);
  else pageEl.appendChild(layer);
}

function textLayerItems(pageEl: HTMLElement): HTMLElement[] {
  const withIdx = Array.from(
    pageEl.querySelectorAll<HTMLElement>("[data-idx]"),
  );
  if (withIdx.length > 0) return withIdx;
  const layer = pageEl.querySelector(".textLayer");
  return layer
    ? Array.from(layer.querySelectorAll<HTMLElement>(":scope > span"))
    : [];
}

function paintPage(
  pageEl: HTMLElement,
  marks: PdfExtractMark[],
  emphasizeId: string | null,
): void {
  const items = textLayerItems(pageEl);
  const rects: Array<{ el: HTMLElement; focus: boolean }> = [];
  items.forEach((el, i) => {
    const fromAttr = Number(el.dataset.idx);
    const idx = Number.isInteger(fromAttr) ? fromAttr : i;
    const paint = pdfTextItemPaint(idx, marks, emphasizeId);
    if (paint.source) el.classList.add(SOURCE_CLASS);
    if (paint.focus) el.classList.add(FOCUS_CLASS);
    if (paint.source) rects.push({ el, focus: paint.focus });
  });
  paintOverlayRects(pageEl, rects);
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
      const view = leaf.view;
      const paint = () => {
        const file = pdfFileFromView(view);
        const marks = file ? (marksByPath.get(file.path) ?? []) : [];
        paintPdfView(view, marks, emphasizeId);
      };
      paint();
      const unsub = subscribePdfTextLayer(view, paint);
      if (unsub) this.unsubs.push(unsub);
      // pdf.js often has no text layer on the first layout-change.
      let n = 0;
      const tick = () => {
        n += 1;
        paint();
        if (n < 15) {
          const id = window.setTimeout(tick, 120);
          this.unsubs.push(() => window.clearTimeout(id));
        }
      };
      const id = window.setTimeout(tick, 120);
      this.unsubs.push(() => window.clearTimeout(id));
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
