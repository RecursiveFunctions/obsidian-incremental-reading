/**
 * Mobile IR review edit layout. Obsidian Android often shrinks the review leaf
 * when the IME opens without updating visualViewport — size from the layout
 * root's getBoundingClientRect(), not vv.height alone. Android WebViews also
 * ignore flex growth on <textarea>; set explicit pixel heights on the chain.
 */

import { readMobileViewportInsets } from "./mobile-viewport";

export const MOBILE_EDIT_MIN_HEIGHT_PX = 120;
export const MOBILE_EDIT_EDGE_MARGIN_PX = 8;

/** Tallest visible bottom seen while editing (keyboard dismissed). */
let editLayoutBaselineBottom = 0;

export function resetMobileEditLayoutBaseline(): void {
  editLayoutBaselineBottom = 0;
}

/** Card-host height from its top edge to the bottom of the visible viewport. */
export function computeMobileEditHostHeightPx(
  hostTopViewport: number,
  visibleBottomViewport: number,
  marginPx = MOBILE_EDIT_EDGE_MARGIN_PX,
  minHeightPx = MOBILE_EDIT_MIN_HEIGHT_PX,
): number {
  return Math.max(
    minHeightPx,
    Math.round(visibleBottomViewport - hostTopViewport - marginPx),
  );
}

/** Bottom of the area the plugin may use (min of vv and layout root). */
export function readEffectiveVisibleBottom(layoutRoot: HTMLElement): number {
  const insets = readMobileViewportInsets();
  const vvBottom = insets.visibleTop + insets.visibleHeight;
  const layoutBottom = layoutRoot.getBoundingClientRect().bottom;
  return Math.min(vvBottom, layoutBottom);
}

/**
 * True when the usable edit viewport shrank vs baseline — vv shrink, leaf
 * shrink, or both. Does not rely on visualViewport alone.
 */
export function isMobileEditViewportCompressed(
  layoutRoot: HTMLElement,
): boolean {
  const visibleBottom = readEffectiveVisibleBottom(layoutRoot);
  if (
    editLayoutBaselineBottom <= 0 ||
    visibleBottom > editLayoutBaselineBottom - 4
  ) {
    editLayoutBaselineBottom = visibleBottom;
  }
  const shrink = editLayoutBaselineBottom - visibleBottom;
  if (shrink >= 120) return true;
  if (editLayoutBaselineBottom <= 0) return false;
  return shrink / editLayoutBaselineBottom >= 0.18;
}

export interface MobileEditLayoutMetrics {
  hostHeight: number;
  scrollHeight: number;
  textareaHeight: number;
  columnDeadSpacePx: number;
  fillsColumn: boolean;
}

function measure(cardHost: HTMLElement): MobileEditLayoutMetrics {
  const scroll = cardHost.querySelector<HTMLElement>(".ir-review-scroll");
  const ta = cardHost.querySelector<HTMLTextAreaElement>(".ir-review-textarea");
  const mainCol = cardHost.querySelector<HTMLElement>(".ir-review-main-col");
  if (!scroll || !ta || !mainCol) {
    return {
      hostHeight: 0,
      scrollHeight: 0,
      textareaHeight: 0,
      columnDeadSpacePx: 0,
      fillsColumn: false,
    };
  }
  const columnDeadSpacePx = mainCol.clientHeight - scroll.offsetHeight;
  return {
    hostHeight: cardHost.offsetHeight,
    scrollHeight: scroll.clientHeight,
    textareaHeight: ta.offsetHeight,
    columnDeadSpacePx,
    fillsColumn: columnDeadSpacePx <= 4,
  };
}

const INLINE_PROPS = [
  "height",
  "min-height",
  "max-height",
  "flex",
  "display",
  "width",
  "margin",
  "margin-bottom",
  "resize",
  "box-sizing",
  "overflow",
  "overflow-y",
  "flex-direction",
  "position",
  "top",
  "left",
  "right",
  "bottom",
  "z-index",
] as const;

function clearInlineStyles(el: HTMLElement): void {
  if (!el.style?.removeProperty) return;
  for (const prop of INLINE_PROPS) {
    el.style.removeProperty(prop);
  }
}

/** Pin edit UI to the visible layout root and size scroll + textarea in px. */
export function applyMobileEditLayout(
  cardHost: HTMLElement,
  layoutRoot: HTMLElement,
): MobileEditLayoutMetrics {
  const layoutRect = layoutRoot.getBoundingClientRect();
  const visibleBottom = readEffectiveVisibleBottom(layoutRoot);
  const top = Math.round(layoutRect.top);
  const height = computeMobileEditHostHeightPx(top, visibleBottom);
  const width = Math.round(layoutRect.width);

  cardHost.style.position = "fixed";
  cardHost.style.top = `${top}px`;
  cardHost.style.left = `${Math.round(layoutRect.left)}px`;
  cardHost.style.width = `${width}px`;
  cardHost.style.height = `${height}px`;
  cardHost.style.maxHeight = `${height}px`;
  cardHost.style.bottom = "auto";
  cardHost.style.right = "auto";
  cardHost.style.zIndex = "50";
  cardHost.style.flex = "none";
  cardHost.style.boxSizing = "border-box";
  cardHost.style.overflow = "hidden";

  const topbar = cardHost.querySelector<HTMLElement>(".ir-review-edit-topbar");
  const scroll = cardHost.querySelector<HTMLElement>(".ir-review-scroll");
  const ta = cardHost.querySelector<HTMLTextAreaElement>(".ir-review-textarea");
  const topbarH = topbar?.offsetHeight ?? 0;
  const scrollH = Math.max(0, height - topbarH);

  if (scroll && ta) {
    scroll.style.flex = "none";
    scroll.style.height = `${scrollH}px`;
    scroll.style.maxHeight = `${scrollH}px`;
    scroll.style.minHeight = "0";
    scroll.style.display = "flex";
    scroll.style.flexDirection = "column";
    scroll.style.overflow = "hidden";

    ta.style.flex = "none";
    ta.style.height = `${scrollH}px`;
    ta.style.maxHeight = `${scrollH}px`;
    ta.style.minHeight = "0";
    ta.style.width = "100%";
    ta.style.margin = "0";
    ta.style.marginBottom = "0";
    ta.style.resize = "none";
    ta.style.boxSizing = "border-box";
    ta.style.overflowY = "auto";
  }

  return measure(cardHost);
}

/** Leave edit mode: strip all inline sizing so CSS flex owns the pane again. */
export function clearMobileEditLayout(cardHost: HTMLElement): void {
  const selectors = [
    ".ir-review-columns",
    ".ir-review-main-col",
    ".ir-review-scroll",
    ".ir-review-textarea",
  ];
  for (const sel of selectors) {
    for (const el of Array.from(cardHost.querySelectorAll<HTMLElement>(sel))) {
      clearInlineStyles(el);
    }
  }
  clearInlineStyles(cardHost);
}

/** @deprecated Use applyMobileEditLayout */
export function applyMobileEditKeyboardLayout(
  cardHost: HTMLElement,
): MobileEditLayoutMetrics {
  const root =
    cardHost.closest<HTMLElement>(".ir-review-modal") ??
    cardHost.parentElement ??
    cardHost;
  return applyMobileEditLayout(cardHost, root);
}

/** @deprecated Use readEffectiveVisibleBottom */
export function readVisibleViewportBottom(): number {
  const vv = window.visualViewport;
  if (vv) return vv.offsetTop + vv.height;
  return window.innerHeight;
}
