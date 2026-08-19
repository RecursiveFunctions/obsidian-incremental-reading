/**
 * Parse and format Obsidian's public PDF deep-link fragments.
 *
 * `[[file.pdf#page=10&selection=16,0,16,20]]` is core (since ~1.3.7), not
 * PDF++. The selection tuple is text-layer item index + offset × 2.
 * Pure: no Obsidian, no DOM.
 */

import type { PdfSelector } from "./model";

export function isPdfPath(path: string): boolean {
  return /\.pdf$/i.test(path);
}

export function isPdfAnchor(anchor: {
  pdf?: PdfSelector;
  sourcePath: string;
}): boolean {
  return !!anchor.pdf || isPdfPath(anchor.sourcePath);
}

export function formatPdfFragment(
  page: number,
  selection?: [number, number, number, number],
): string {
  const p = Math.max(1, Math.floor(page));
  if (!selection) return `#page=${p}`;
  return `#page=${p}&selection=${selection.join(",")}`;
}

export function formatPdfLinktext(
  path: string,
  page: number,
  selection?: [number, number, number, number],
): string {
  return `${path}${formatPdfFragment(page, selection)}`;
}

export function parsePdfFragment(hash: string): PdfSelector | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const params = new URLSearchParams(raw.replace(/&/g, "&"));
  const pageRaw = params.get("page");
  if (pageRaw == null || pageRaw === "") return null;
  const page = Number(pageRaw);
  if (!Number.isInteger(page) || page < 1) return null;

  const selRaw = params.get("selection");
  if (selRaw == null || selRaw === "") {
    return { page, selection: [0, 0, 0, 0] };
  }
  const parts = selRaw.split(",").map((s) => Number(s.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0)) {
    return null;
  }
  return {
    page,
    selection: [parts[0], parts[1], parts[2], parts[3]],
  };
}

/** True when the selection tuple is a real range, not the page-only placeholder. */
export function pdfSelectionIsRange(
  sel: [number, number, number, number],
): boolean {
  return !(sel[0] === 0 && sel[1] === 0 && sel[2] === 0 && sel[3] === 0);
}
