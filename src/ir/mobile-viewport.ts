/**
 * Mobile WebView layout helpers. Obsidian's Android shell often ignores
 * `env(safe-area-inset-*)` for plugin UI; `visualViewport` plus fixed
 * offsets for Obsidian's bottom nav are more reliable.
 */

export interface MobileViewportInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
  layoutHeight: number;
  layoutWidth: number;
  visibleTop: number;
  visibleLeft: number;
  visibleWidth: number;
  visibleHeight: number;
}

/** Obsidian mobile floating bottom toolbar (back/search/tabs). */
export const OBSIDIAN_MOBILE_NAV_PX = 80;
/** Android 3-button / gesture bar clearance below Obsidian nav. */
export const ANDROID_SYS_NAV_PX = 28;
export const MOBILE_EDGE_MARGIN_PX = 12;
export const FAB_SIZE_PX = 52;

export function readMobileViewportInsets(): MobileViewportInsets {
  const vv = window.visualViewport;
  const layoutHeight = window.innerHeight;
  const layoutWidth = window.innerWidth;
  if (!vv) {
    return {
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      layoutHeight,
      layoutWidth,
      visibleTop: 0,
      visibleLeft: 0,
      visibleWidth: layoutWidth,
      visibleHeight: layoutHeight,
    };
  }
  const visibleTop = vv.offsetTop;
  const visibleLeft = vv.offsetLeft;
  const visibleHeight = vv.height;
  const visibleWidth = vv.width;
  return {
    top: visibleTop,
    left: visibleLeft,
    right: layoutWidth - (visibleLeft + visibleWidth),
    bottom: layoutHeight - (visibleTop + visibleHeight),
    layoutHeight,
    layoutWidth,
    visibleTop,
    visibleLeft,
    visibleWidth,
    visibleHeight,
  };
}

/** Tracks the tallest visualViewport seen (keyboard dismissed). */
let keyboardBaselineHeight = 0;

export function resetMobileKeyboardBaseline(): void {
  keyboardBaselineHeight = 0;
}

/**
 * Pure helper: keyboard likely open when visible height drops sharply vs baseline.
 * Exported for unit tests.
 */
export function keyboardShrinkLikelyOpen(
  baselineHeight: number,
  currentHeight: number,
): boolean {
  if (baselineHeight <= 0) return false;
  const shrink = baselineHeight - currentHeight;
  if (shrink >= 180) return true;
  return shrink / baselineHeight >= 0.22;
}

/**
 * True when the soft keyboard is likely open. Uses a running baseline of
 * `visualViewport.height` — do **not** compare to `window.innerHeight`,
 * which on Android/Obsidian is often 120–200px taller than the visible
 * viewport even with the keyboard closed (status bar + bottom nav).
 */
export function isMobileKeyboardLikelyOpen(): boolean {
  const vv = window.visualViewport;
  if (!vv) return false;
  if (vv.height > keyboardBaselineHeight) {
    keyboardBaselineHeight = vv.height;
  }
  return keyboardShrinkLikelyOpen(keyboardBaselineHeight, vv.height);
}

/** Pin the workspace FAB above Obsidian + system nav; left in landscape. */
export function layoutWorkspaceFab(fab: HTMLElement): void {
  const insets = readMobileViewportInsets();
  const landscape = insets.layoutWidth > insets.layoutHeight;
  const bottomGap =
    insets.bottom +
    OBSIDIAN_MOBILE_NAV_PX +
    ANDROID_SYS_NAV_PX +
    MOBILE_EDGE_MARGIN_PX;

  fab.style.bottom = `${bottomGap}px`;
  fab.style.top = "auto";

  if (landscape) {
    fab.style.left = `${insets.left + MOBILE_EDGE_MARGIN_PX}px`;
    fab.style.right = "auto";
  } else {
    fab.style.left = "auto";
    fab.style.right = `${insets.right + MOBILE_EDGE_MARGIN_PX}px`;
  }
}

export function radialAnchorCenterBottom(
  insets: MobileViewportInsets = readMobileViewportInsets(),
): { cx: number; cy: number } {
  return clampRadialOrigin(
    {
      cx: insets.visibleLeft + insets.visibleWidth / 2,
      cy:
        insets.visibleTop +
        insets.visibleHeight -
        (OBSIDIAN_MOBILE_NAV_PX + ANDROID_SYS_NAV_PX + 56),
    },
    insets,
  );
}

export function clampRadialOrigin(
  origin: { cx: number; cy: number },
  insets: MobileViewportInsets = readMobileViewportInsets(),
  diskRadius = 160,
): { cx: number; cy: number } {
  const minX = insets.visibleLeft + diskRadius + MOBILE_EDGE_MARGIN_PX;
  const maxX =
    insets.visibleLeft + insets.visibleWidth - diskRadius - MOBILE_EDGE_MARGIN_PX;
  const minY = insets.visibleTop + diskRadius + MOBILE_EDGE_MARGIN_PX;
  const maxY =
    insets.visibleTop +
    insets.visibleHeight -
    OBSIDIAN_MOBILE_NAV_PX -
    diskRadius -
    MOBILE_EDGE_MARGIN_PX;
  return {
    cx: Math.min(maxX, Math.max(minX, origin.cx)),
    cy: Math.min(maxY, Math.max(minY, origin.cy)),
  };
}
