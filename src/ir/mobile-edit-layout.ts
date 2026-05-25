/**
 * Mobile IR review edit pane sizing. Obsidian's Android WebView often ignores
 * flex/absolute fill on `<textarea>`. Measure the scroll column top → visible
 * bottom and set explicit pixel heights on scroll + textarea.
 */

export const MOBILE_EDIT_MIN_HEIGHT_PX = 120;
export const MOBILE_EDIT_EDGE_MARGIN_PX = 8;

/** @deprecated card-top sizing mis-measures when the leaf scrolls; use scroll-top. */
export function computeMobileEditCardHeightPx(
  cardTopViewport: number,
  visibleTop: number,
  visibleHeight: number,
  minHeightPx = MOBILE_EDIT_MIN_HEIGHT_PX,
): number {
  const visibleBottom = visibleTop + visibleHeight;
  return Math.max(minHeightPx, Math.round(visibleBottom - cardTopViewport));
}

/** Height for the scroll/textarea column from viewport + layout clip rects. */
export function computeMobileEditScrollHeightPx(
  scrollTopViewport: number,
  visibleBottomViewport: number,
  layoutBottomViewport: number,
  marginPx = MOBILE_EDIT_EDGE_MARGIN_PX,
  minHeightPx = MOBILE_EDIT_MIN_HEIGHT_PX,
): number {
  const clipBottom = Math.min(visibleBottomViewport, layoutBottomViewport);
  return Math.max(
    minHeightPx,
    Math.round(clipBottom - scrollTopViewport - marginPx),
  );
}

export interface MobileEditLayoutResult {
  applied: boolean;
  computedHeight: number;
  scrollHeight: number;
  textareaHeight: number;
  fills: boolean;
}

function readVisibleBottom(): number {
  const vv = window.visualViewport;
  if (vv) return vv.offsetTop + vv.height;
  return window.innerHeight;
}

/** Apply measured heights; always run while mobile edit is active. */
export function applyMobileEditLayout(
  cardHost: HTMLElement,
): MobileEditLayoutResult {
  const scroll = cardHost.querySelector<HTMLElement>(".ir-review-scroll");
  const ta = cardHost.querySelector<HTMLTextAreaElement>(".ir-review-textarea");
  if (!scroll || !ta) {
    return {
      applied: false,
      computedHeight: 0,
      scrollHeight: 0,
      textareaHeight: 0,
      fills: false,
    };
  }

  const layoutRoot =
    cardHost.closest<HTMLElement>(".ir-review-layout") ?? cardHost;
  const scrollTop = scroll.getBoundingClientRect().top;
  const layoutBottom = layoutRoot.getBoundingClientRect().bottom;
  const height = computeMobileEditScrollHeightPx(
    scrollTop,
    readVisibleBottom(),
    layoutBottom,
  );

  scroll.style.flex = "none";
  scroll.style.height = `${height}px`;
  scroll.style.minHeight = `${height}px`;
  scroll.style.maxHeight = `${height}px`;

  ta.style.display = "block";
  ta.style.width = "100%";
  ta.style.boxSizing = "border-box";
  ta.style.height = `${height}px`;
  ta.style.minHeight = `${height}px`;
  ta.style.maxHeight = `${height}px`;
  ta.style.margin = "0";
  ta.style.resize = "none";

  const fills = mobileEditTextareaFillsScroll(scroll, ta);
  return {
    applied: true,
    computedHeight: height,
    scrollHeight: scroll.clientHeight,
    textareaHeight: ta.offsetHeight,
    fills,
  };
}

export function clearMobileEditLayout(cardHost: HTMLElement): void {
  for (const el of Array.from(
    cardHost.querySelectorAll<HTMLElement>(
      ".ir-review-scroll, .ir-review-textarea",
    ),
  )) {
    el.style.removeProperty("height");
    el.style.removeProperty("min-height");
    el.style.removeProperty("max-height");
    el.style.removeProperty("flex");
    el.style.removeProperty("display");
    el.style.removeProperty("width");
    el.style.removeProperty("margin");
    el.style.removeProperty("resize");
    el.style.removeProperty("box-sizing");
  }
  cardHost.style.removeProperty("height");
  cardHost.style.removeProperty("max-height");
  cardHost.style.removeProperty("flex");
}

/** True when the textarea fills the scroll column (≤2px slack for rounding). */
export function mobileEditTextareaFillsScroll(
  scroll: HTMLElement,
  textarea: HTMLElement,
  slackPx = 2,
): boolean {
  if (scroll.clientHeight <= 0) return false;
  return textarea.offsetHeight >= scroll.clientHeight - slackPx;
}

/** Whether the IME likely reduced usable height (for chrome class toggles). */
export function mobileEditKeyboardLikelyOpen(
  scrollHeightPx: number,
  baselineScrollHeightPx: number,
): boolean {
  if (baselineScrollHeightPx <= 0) return false;
  const shrink = baselineScrollHeightPx - scrollHeightPx;
  return shrink >= 120 || shrink / baselineScrollHeightPx >= 0.18;
}
