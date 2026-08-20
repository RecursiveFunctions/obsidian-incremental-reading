/**
 * Shared reading progress (0–1) for review reader and editor.
 *
 * Pixel scrollTop is not comparable across those viewports: the reader
 * scrolls `.ir-review-scroll`, Live Preview scrolls CodeMirror. A fraction
 * of the scrollable range is.
 */

/** True when the body fits in the viewport (nothing to scroll). */
export function scrollFits(scrollHeight: number, clientHeight: number): boolean {
  return scrollHeight - clientHeight <= 1;
}

/** 0 at the top, 1 at the bottom. Fits-in-view is 1. */
export function scrollProgress(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): number {
  const max = scrollHeight - clientHeight;
  if (max <= 1) return 1;
  return Math.max(0, Math.min(1, scrollTop / max));
}

export function scrollTopFromProgress(
  progress: number,
  scrollHeight: number,
  clientHeight: number,
): number {
  const max = scrollHeight - clientHeight;
  if (max <= 1) return 0;
  const p = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
  return p * max;
}

export function readScrollProgress(el: HTMLElement): number {
  return scrollProgress(el.scrollTop, el.scrollHeight, el.clientHeight);
}

export function applyScrollProgress(el: HTMLElement, progress: number): void {
  el.scrollTop = scrollTopFromProgress(
    progress,
    el.scrollHeight,
    el.clientHeight,
  );
}

export function formatReadLabel(progress: number, fits: boolean): string {
  if (fits) return "Fits in view";
  return `${Math.round(progress * 100)}% read`;
}
