/**
 * Rectangle-select mode over a PDF viewer: the user drags a box on a page
 * and the callback receives the page element plus the normalized rect.
 * Used for "extract image region" (crop to an attachment) and as the entry
 * to image occlusion from a PDF figure. One-shot: the mode ends after a
 * single drag or on Escape.
 */

import type { NormalizedRect } from "./model";
import { normalizeDragRect } from "./occlusion";
import { pointerRectInPage } from "./pdf-canvas";

export interface RectSelectHandlers {
  onDone: (page: HTMLElement, rect: NormalizedRect) => void;
  onCancel?: () => void;
}

export const PDF_RECT_MODE_CLASS = "ir-pdf-rect-mode";

/** Start the mode; returns a disposer that also cancels if still active. */
export function startPdfRectSelect(
  container: HTMLElement,
  handlers: RectSelectHandlers,
): () => void {
  const doc = container.ownerDocument;
  let page: HTMLElement | null = null;
  let overlay: HTMLElement | null = null;
  let box: HTMLElement | null = null;
  let startX = 0;
  let startY = 0;
  let active = true;

  const cleanup = () => {
    if (!active) return;
    active = false;
    container.classList.remove(PDF_RECT_MODE_CLASS);
    container.removeEventListener("mousedown", onDown, true);
    doc.removeEventListener("mousemove", onMove, true);
    doc.removeEventListener("mouseup", onUp, true);
    doc.removeEventListener("keydown", onKey, true);
    overlay?.remove();
    overlay = null;
    box = null;
    page = null;
  };

  const onDown = (evt: MouseEvent) => {
    if (evt.button !== 0) return;
    const target = evt.target as HTMLElement | null;
    const p = target?.closest<HTMLElement>(".page[data-page-number]") ?? null;
    if (!p) return;
    evt.preventDefault();
    evt.stopPropagation();
    page = p;
    startX = evt.clientX;
    startY = evt.clientY;
    overlay = p.createDiv({ cls: "ir-pdf-rect-overlay" });
    box = overlay.createDiv({ cls: "ir-pdf-rect-box" });
    paint(evt.clientX, evt.clientY);
  };

  const paint = (x: number, y: number) => {
    if (!page || !box) return;
    const r = pointerRectInPage(page, startX, startY, x, y);
    const left = Math.min(r.ax, r.bx);
    const top = Math.min(r.ay, r.by);
    const w = Math.abs(r.bx - r.ax);
    const h = Math.abs(r.by - r.ay);
    box.style.left = `${left * 100}%`;
    box.style.top = `${top * 100}%`;
    box.style.width = `${w * 100}%`;
    box.style.height = `${h * 100}%`;
  };

  const onMove = (evt: MouseEvent) => {
    if (!page) return;
    evt.preventDefault();
    paint(evt.clientX, evt.clientY);
  };

  const onUp = (evt: MouseEvent) => {
    if (!page) return;
    evt.preventDefault();
    evt.stopPropagation();
    const r = pointerRectInPage(page, startX, startY, evt.clientX, evt.clientY);
    const rect = normalizeDragRect(r.ax, r.ay, r.bx, r.by);
    const p = page;
    cleanup();
    if (rect) handlers.onDone(p, rect);
    else handlers.onCancel?.();
  };

  const onKey = (evt: KeyboardEvent) => {
    if (evt.key !== "Escape") return;
    cleanup();
    handlers.onCancel?.();
  };

  container.classList.add(PDF_RECT_MODE_CLASS);
  container.addEventListener("mousedown", onDown, true);
  doc.addEventListener("mousemove", onMove, true);
  doc.addEventListener("mouseup", onUp, true);
  doc.addEventListener("keydown", onKey, true);
  return cleanup;
}

/**
 * Same one-shot drag, but over a single element (an `<img>` in a note or
 * on the review card). The overlay is fixed-positioned on top of the
 * element's box because images cannot host children.
 */
export function startRectSelectOnElement(
  target: HTMLElement,
  handlers: { onDone: (rect: NormalizedRect) => void; onCancel?: () => void },
): () => void {
  const doc = target.ownerDocument;
  const box = target.getBoundingClientRect();
  const overlay = doc.body.createDiv({ cls: "ir-rect-overlay-fixed" });
  overlay.style.left = `${box.left}px`;
  overlay.style.top = `${box.top}px`;
  overlay.style.width = `${box.width}px`;
  overlay.style.height = `${box.height}px`;
  const drawn = overlay.createDiv({ cls: "ir-pdf-rect-box" });
  drawn.style.display = "none";
  let sx = 0;
  let sy = 0;
  let dragging = false;
  let active = true;

  const norm = (x: number, y: number) => ({
    x: (x - box.left) / Math.max(1, box.width),
    y: (y - box.top) / Math.max(1, box.height),
  });
  const cleanup = () => {
    if (!active) return;
    active = false;
    doc.removeEventListener("keydown", onKey, true);
    overlay.remove();
  };
  const onKey = (evt: KeyboardEvent) => {
    if (evt.key !== "Escape") return;
    cleanup();
    handlers.onCancel?.();
  };
  overlay.addEventListener("mousedown", (evt) => {
    if (evt.button !== 0) return;
    evt.preventDefault();
    dragging = true;
    sx = evt.clientX;
    sy = evt.clientY;
    drawn.style.display = "block";
  });
  overlay.addEventListener("mousemove", (evt) => {
    if (!dragging) return;
    const a = norm(sx, sy);
    const b = norm(evt.clientX, evt.clientY);
    drawn.style.left = `${Math.min(a.x, b.x) * 100}%`;
    drawn.style.top = `${Math.min(a.y, b.y) * 100}%`;
    drawn.style.width = `${Math.abs(b.x - a.x) * 100}%`;
    drawn.style.height = `${Math.abs(b.y - a.y) * 100}%`;
  });
  overlay.addEventListener("mouseup", (evt) => {
    if (!dragging) return;
    dragging = false;
    const a = norm(sx, sy);
    const b = norm(evt.clientX, evt.clientY);
    const rect = normalizeDragRect(a.x, a.y, b.x, b.y);
    cleanup();
    if (rect) handlers.onDone(rect);
    else handlers.onCancel?.();
  });
  doc.addEventListener("keydown", onKey, true);
  return cleanup;
}
