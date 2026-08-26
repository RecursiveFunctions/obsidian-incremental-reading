/**
 * Crop a region out of a rendered pdf.js page. Reads only the public DOM
 * (`.page[data-page-number] canvas`); the private viewer API stays fenced
 * in `pdf-view.ts`.
 */

import type { NormalizedRect } from "./model";

export function pdfPageNumber(page: HTMLElement): number {
  const n = Number(page.getAttribute("data-page-number"));
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/**
 * Crop `rect` (normalized to the page box) out of the page's rendered
 * canvas as a PNG. Null when pdf.js has not painted the page yet (the user
 * scrolled it out of view) so the caller can ask them to scroll back.
 */
export async function cropPdfPage(
  page: HTMLElement,
  rect: NormalizedRect,
): Promise<ArrayBuffer | null> {
  const canvas = page.querySelector("canvas");
  if (!(canvas instanceof HTMLCanvasElement)) return null;
  if (canvas.width === 0 || canvas.height === 0) return null;
  const sx = Math.floor(rect.x * canvas.width);
  const sy = Math.floor(rect.y * canvas.height);
  const sw = Math.max(1, Math.round(rect.w * canvas.width));
  const sh = Math.max(1, Math.round(rect.h * canvas.height));
  const out = document.createElement("canvas");
  out.width = sw;
  out.height = sh;
  const ctx = out.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
  const blob = await new Promise<Blob | null>((resolve) =>
    out.toBlob((b) => resolve(b), "image/png"),
  );
  if (!blob) return null;
  return blob.arrayBuffer();
}

/** Normalized rect of a pointer drag inside `page`'s box. */
export function pointerRectInPage(
  page: HTMLElement,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): { ax: number; ay: number; bx: number; by: number } {
  const box = page.getBoundingClientRect();
  const w = Math.max(1, box.width);
  const h = Math.max(1, box.height);
  return {
    ax: (x1 - box.left) / w,
    ay: (y1 - box.top) / h,
    bx: (x2 - box.left) / w,
    by: (y2 - box.top) / h,
  };
}

/** Stem for an attachment cropped out of a PDF page: `Paper p3`. */
export function pdfCropStem(pdfPath: string, page: number): string {
  const base = pdfPath.split("/").pop() ?? pdfPath;
  const stem = base.replace(/\.pdf$/i, "").replace(/[\\/:*?"<>|#^[\]]/g, "");
  return `${stem || "pdf"} p${page}`;
}

/**
 * Join the texts of several selections into one extract body. Each span
 * becomes its own paragraph, in the order the user made them, so a
 * Ctrl-built extract reads as "passage / passage / passage" the way a
 * SuperMemo multi-fragment extract does.
 */
export function joinSelectionTexts(texts: ReadonlyArray<string>): string {
  return texts
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .join("\n\n");
}

/** Human label for a set of pages: `p. 3` or `pp. 3, 5`. */
export function pageLabel(pages: ReadonlyArray<number>): string {
  const uniq = Array.from(new Set(pages)).sort((a, b) => a - b);
  if (uniq.length === 0) return "";
  if (uniq.length === 1) return `p. ${uniq[0]}`;
  return `pp. ${uniq.join(", ")}`;
}
