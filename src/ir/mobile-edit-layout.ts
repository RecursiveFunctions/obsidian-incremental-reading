/**
 * Mobile IR review edit layout. Do not set fixed heights on scroll/textarea —
 * that leaves parent columns full-height with a white gap (0.3.19 regression).
 * When the keyboard is open, size only the card host; inner flex fills it.
 */

export const MOBILE_EDIT_MIN_HEIGHT_PX = 120;
export const MOBILE_EDIT_EDGE_MARGIN_PX = 8;

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

export function readVisibleViewportBottom(): number {
  const vv = window.visualViewport;
  if (vv) return vv.offsetTop + vv.height;
  return window.innerHeight;
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

/** Keyboard open: clamp card host to visible viewport; children use flex fill. */
export function applyMobileEditKeyboardLayout(
  cardHost: HTMLElement,
): MobileEditLayoutMetrics {
  const hostTop = cardHost.getBoundingClientRect().top;
  const height = computeMobileEditHostHeightPx(
    hostTop,
    readVisibleViewportBottom(),
  );
  cardHost.style.flex = "none";
  cardHost.style.height = `${height}px`;
  cardHost.style.maxHeight = `${height}px`;
  cardHost.style.overflow = "hidden";
  return measure(cardHost);
}

/** Keyboard closed: remove all inline sizing so CSS flex layout owns the pane. */
export function clearMobileEditLayout(cardHost: HTMLElement): void {
  const selectors = [
    ".ir-review-card-host",
    ".ir-review-columns",
    ".ir-review-main-col",
    ".ir-review-scroll",
    ".ir-review-textarea",
  ];
  for (const sel of selectors) {
    for (const el of Array.from(cardHost.querySelectorAll<HTMLElement>(sel))) {
      if (!el.style?.removeProperty) continue;
      el.style.removeProperty("height");
      el.style.removeProperty("min-height");
      el.style.removeProperty("max-height");
      el.style.removeProperty("flex");
      el.style.removeProperty("display");
      el.style.removeProperty("width");
      el.style.removeProperty("margin");
      el.style.removeProperty("resize");
      el.style.removeProperty("box-sizing");
      el.style.removeProperty("overflow");
    }
  }
  cardHost.style.removeProperty("height");
  cardHost.style.removeProperty("max-height");
  cardHost.style.removeProperty("flex");
  cardHost.style.removeProperty("overflow");
}
