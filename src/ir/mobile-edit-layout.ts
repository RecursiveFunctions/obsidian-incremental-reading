/**
 * Mobile IR review edit pane sizing. Android WebViews often ignore flex growth
 * on `<textarea>`, leaving a short box and dead space above the keyboard.
 */

export const MOBILE_EDIT_MIN_HEIGHT_PX = 120;

/** Height from the card host's top edge to the bottom of the visible viewport. */
export function computeMobileEditCardHeightPx(
  cardTopViewport: number,
  visibleTop: number,
  visibleHeight: number,
  minHeightPx = MOBILE_EDIT_MIN_HEIGHT_PX,
): number {
  const visibleBottom = visibleTop + visibleHeight;
  return Math.max(minHeightPx, Math.round(visibleBottom - cardTopViewport));
}

export interface MobileEditLayoutInput {
  cardHost: HTMLElement;
  keyboardOpen: boolean;
  visibleTop: number;
  visibleHeight: number;
}

/** Apply keyboard-aware card height; returns the scroll column's client height. */
export function applyMobileEditLayout(input: MobileEditLayoutInput): number {
  const { cardHost, keyboardOpen, visibleTop, visibleHeight } = input;
  if (keyboardOpen) {
    const cardTop = cardHost.getBoundingClientRect().top;
    const height = computeMobileEditCardHeightPx(
      cardTop,
      visibleTop,
      visibleHeight,
    );
    cardHost.style.height = `${height}px`;
    cardHost.style.maxHeight = `${height}px`;
    cardHost.style.flex = "none";
  } else {
    cardHost.style.removeProperty("height");
    cardHost.style.removeProperty("max-height");
    cardHost.style.removeProperty("flex");
  }

  const scroll = cardHost.querySelector<HTMLElement>(".ir-review-scroll");
  return scroll?.clientHeight ?? 0;
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
