/**
 * The only module that may touch Obsidian's private PDF viewer APIs.
 *
 * Core (since ~1.3) hosts pdf.js in a view of type `"pdf"`. Selection deep
 * links (`#page=N&selection=a,b,c,d`) are public. The objects that *produce*
 * those tuples (`view.viewer.child.getTextSelectionRangeStr`) are not.
 * PDF++ uses the same path and warns that Obsidian updates can break it.
 *
 * If the private method is missing, we fall back to `data-idx` on the
 * text layer (the same indices the core linker stores). Paint uses
 * `data-idx` either way, so capture and highlight stay aligned.
 */

import type { App, TFile } from "obsidian";
import {
  formatPdfLinktext,
  parsePdfFragment,
  pdfSelectionIsRange,
} from "./pdf-fragment";

export const PDF_VIEW_TYPE = "pdf";

interface PdfViewerChild {
  file?: TFile;
  containerEl?: HTMLElement;
  pdfViewer?: {
    currentPageNumber?: number;
    eventBus?: {
      on?: (name: string, cb: (...args: unknown[]) => void) => void;
      off?: (name: string, cb: (...args: unknown[]) => void) => void;
    };
  };
  getTextSelectionRangeStr?: (pageEl: HTMLElement) => string | undefined;
}

interface PdfViewLike {
  file?: TFile;
  containerEl?: HTMLElement;
  contentEl?: HTMLElement;
  viewer?: { child?: PdfViewerChild };
  getViewType?: () => string;
}

export interface PdfTextSelection {
  file: TFile;
  text: string;
  page: number;
  selection: [number, number, number, number];
}

function asPdfView(view: unknown): PdfViewLike | null {
  if (!view || typeof view !== "object") return null;
  const v = view as PdfViewLike;
  if (typeof v.getViewType !== "function") return null;
  if (v.getViewType() !== PDF_VIEW_TYPE) return null;
  return v;
}

function pdfChild(view: unknown): PdfViewerChild | null {
  return asPdfView(view)?.viewer?.child ?? null;
}

export function isPdfView(view: unknown): boolean {
  const v = asPdfView(view);
  if (!v) return false;
  if (typeof v.getViewType === "function") return v.getViewType() === PDF_VIEW_TYPE;
  return false;
}

export function pdfFileFromView(view: unknown): TFile | null {
  const v = asPdfView(view);
  const file = v?.file ?? pdfChild(view)?.file;
  return file ?? null;
}

/** PDF in the active leaf, or null. `getActiveFile()` is often empty on PDF views. */
export function activePdfFile(app: App): TFile | null {
  const leaf = app.workspace.activeLeaf;
  if (!leaf) return null;
  return pdfFileFromView(leaf.view);
}

/** Markdown `getActiveFile()`, else the PDF in the active leaf. */
export function activeIrFile(app: App): TFile | null {
  const pdf = activePdfFile(app);
  if (pdf) return pdf;
  return app.workspace.getActiveFile();
}

export function pdfContainerEl(view: unknown): HTMLElement | null {
  const child = pdfChild(view);
  if (child?.containerEl) return child.containerEl;
  const v = asPdfView(view);
  return v?.contentEl ?? v?.containerEl ?? null;
}

export function getPdfCurrentPage(view: unknown): number | null {
  const n = pdfChild(view)?.pdfViewer?.currentPageNumber;
  if (typeof n === "number" && Number.isInteger(n) && n >= 1) return n;
  return null;
}

function pageElForNode(node: Node | null): HTMLElement | null {
  const el =
    node instanceof HTMLElement ? node : node?.parentElement ?? null;
  return el?.closest(".page") ?? null;
}

function elWithIdx(node: Node | null): HTMLElement | null {
  const el =
    node instanceof HTMLElement ? node : node?.parentElement ?? null;
  return el?.closest("[data-idx]") ?? null;
}

function parseSelectionTuple(
  raw: string,
): [number, number, number, number] | null {
  const parts = raw.split(",").map((s) => Number(s.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0)) {
    return null;
  }
  return [parts[0], parts[1], parts[2], parts[3]];
}

function selectionFromPrivateApi(
  view: unknown,
  pageEl: HTMLElement,
): [number, number, number, number] | null {
  const fn = pdfChild(view)?.getTextSelectionRangeStr;
  if (typeof fn !== "function") return null;
  try {
    const raw = fn.call(pdfChild(view), pageEl);
    if (typeof raw !== "string" || !raw.trim()) return null;
    return parseSelectionTuple(raw);
  } catch {
    return null;
  }
}

function selectionFromDom(
  sel: Selection,
  pageEl: HTMLElement,
): [number, number, number, number] | null {
  if (sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const startEl = elWithIdx(range.startContainer);
  const endEl = elWithIdx(range.endContainer);
  if (!startEl || !endEl) return null;
  if (!pageEl.contains(startEl) || !pageEl.contains(endEl)) return null;
  const beginIndex = Number(startEl.dataset.idx);
  const endIndex = Number(endEl.dataset.idx);
  if (!Number.isInteger(beginIndex) || !Number.isInteger(endIndex)) return null;
  const beginOffset = startEl.contains(
    range.startContainer instanceof HTMLElement
      ? range.startContainer
      : range.startContainer.parentElement ?? startEl,
  )
    ? range.startOffset
    : 0;
  const endOffset = endEl.contains(
    range.endContainer instanceof HTMLElement
      ? range.endContainer
      : range.endContainer.parentElement ?? endEl,
  )
    ? range.endOffset
    : (endEl.textContent?.length ?? 0);
  if (beginIndex < endIndex || (beginIndex === endIndex && beginOffset <= endOffset)) {
    return [beginIndex, beginOffset, endIndex, endOffset];
  }
  return [endIndex, endOffset, beginIndex, beginOffset];
}

export function getPdfTextSelection(view: unknown): PdfTextSelection | null {
  const file = pdfFileFromView(view);
  if (!file) return null;
  const container = pdfContainerEl(view);
  const doc = container?.ownerDocument ?? (typeof document !== "undefined" ? document : null);
  if (!doc) return null;
  const sel = doc.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const text = sel.toString().trim();
  if (!text) return null;
  const pageEl = pageElForNode(sel.anchorNode) ?? pageElForNode(sel.focusNode);
  if (!pageEl) return null;
  const page = Number(pageEl.getAttribute("data-page-number"));
  if (!Number.isInteger(page) || page < 1) return null;
  const tuple =
    selectionFromPrivateApi(view, pageEl) ?? selectionFromDom(sel, pageEl);
  if (!tuple || !pdfSelectionIsRange(tuple)) return null;
  return { file, text, page, selection: tuple };
}

/** First PDF leaf with a live text selection, preferring the active leaf. */
export function findPdfTextSelection(app: App): PdfTextSelection | null {
  const leaves = app.workspace.getLeavesOfType(PDF_VIEW_TYPE);
  const activeLeaf = app.workspace.activeLeaf;
  const ordered =
    activeLeaf && leaves.includes(activeLeaf)
      ? [activeLeaf, ...leaves.filter((l) => l !== activeLeaf)]
      : leaves;
  for (const leaf of ordered) {
    const sel = getPdfTextSelection(leaf.view);
    if (sel) return sel;
  }
  return null;
}

export function getPdfPageForPath(app: App, path: string): number | null {
  for (const leaf of app.workspace.getLeavesOfType(PDF_VIEW_TYPE)) {
    const file = pdfFileFromView(leaf.view);
    if (file?.path !== path) continue;
    return getPdfCurrentPage(leaf.view);
  }
  return null;
}

/**
 * Open (or reuse) the core PDF viewer at a page, optionally with a
 * selection highlight. Uses the public `openLinkText` fragment, not a
 * second pdf.js instance.
 */
export async function openPdfAt(
  app: App,
  path: string,
  page: number,
  selection?: [number, number, number, number],
): Promise<void> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!file || !("extension" in file)) return;
  const sel = selection && pdfSelectionIsRange(selection) ? selection : undefined;
  const subpath = formatPdfLinktext("", page, sel); // "#page=…"
  const leaves = app.workspace.getLeavesOfType(PDF_VIEW_TYPE);
  for (const leaf of leaves) {
    if (pdfFileFromView(leaf.view)?.path === path) {
      await leaf.openFile(file as TFile, { eState: { subpath } });
      return;
    }
  }
  await app.workspace.openLinkText(`${path}${subpath}`, "", "tab");
}

export function subscribePdfTextLayer(
  view: unknown,
  onRendered: () => void,
): (() => void) | null {
  const bus = pdfChild(view)?.pdfViewer?.eventBus;
  if (bus?.on && bus?.off) {
    const handler = () => onRendered();
    try {
      bus.on("textlayerrendered", handler);
      bus.on("pagerendered", handler);
      return () => {
        try {
          bus.off?.("textlayerrendered", handler);
          bus.off?.("pagerendered", handler);
        } catch {
          /* viewer gone */
        }
      };
    } catch {
      /* fall through to MutationObserver */
    }
  }
  const container = pdfContainerEl(view);
  if (!container || typeof MutationObserver === "undefined") return null;
  let timer: number | null = null;
  const obs = new MutationObserver(() => {
    if (timer != null) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      onRendered();
    }, 50);
  });
  obs.observe(container, { childList: true, subtree: true });
  return () => {
    if (timer != null) window.clearTimeout(timer);
    obs.disconnect();
  };
}

/** Re-export for callers that already have a fragment string. */
export function pdfSelectorFromFragment(hash: string) {
  return parsePdfFragment(hash);
}
