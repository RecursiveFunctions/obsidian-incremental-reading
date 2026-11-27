/**
 * Pure container-width and input-capability tier resolution (#65).
 * Zero Obsidian imports so every breakpoint, hardware-keyboard latch rule,
 * and mobile-hub migration rule runs directly under `node --test`.
 */

export type IrWidthTier = "compact" | "medium" | "expanded";

export type IrSourceLayout = "sheet" | "collapsible-rail" | "resizable-split";

export const COMPACT_MAX_PX = 640;
export const MEDIUM_MAX_PX = 960;

export interface ViewportCapabilityInput {
  inlineWidthPx: number;
  coarsePointer: boolean;
  latchedHardwareKeyboard: boolean;
}

export interface ViewportCapability {
  tier: IrWidthTier;
  touchTargets: boolean;
  showHotkeys: boolean;
  sourceLayout: IrSourceLayout;
}

export function resolveWidthTier(inlineWidthPx: number, coarsePointer = false): IrWidthTier {
  if (!Number.isFinite(inlineWidthPx) || inlineWidthPx <= 0) {
    return coarsePointer ? "compact" : "medium";
  }
  if (inlineWidthPx < COMPACT_MAX_PX) return "compact";
  if (inlineWidthPx <= MEDIUM_MAX_PX) return "medium";
  return "expanded";
}

export function shouldUseCompactReviewDock(tier: IrWidthTier, isMobile: boolean): boolean {
  return tier === "compact" || Boolean(isMobile);
}

/**
 * True on mobile tablets, including 8-inch 800x1280 @ 240dpi (1.5x DPR ->
 * 533x853 CSS px) Android tablets such as the TCL TAB 8 Plus where Obsidian's
 * `Platform.isTablet` (`min >= 600`) returns false.
 */
export function isTabletViewport(
  isMobile: boolean,
  isPlatformTablet: boolean,
  winWidth: number,
  winHeight: number,
): boolean {
  if (!isMobile) return false;
  if (isPlatformTablet) return true;
  const shortSide = Math.min(winWidth, winHeight);
  const longSide = Math.max(winWidth, winHeight);
  return shortSide >= 500 && longSide >= 800;
}

export function resolveViewportCapability(input: ViewportCapabilityInput): ViewportCapability {
  const tier = resolveWidthTier(input.inlineWidthPx, input.coarsePointer);
  const touchTargets = Boolean(input.coarsePointer);
  const showHotkeys = !touchTargets || Boolean(input.latchedHardwareKeyboard);
  const sourceLayout: IrSourceLayout =
    tier === "compact"
      ? "sheet"
      : tier === "medium"
        ? "collapsible-rail"
        : "resizable-split";
  return {
    tier,
    touchTargets,
    showHotkeys,
    sourceLayout,
  };
}

export interface KeydownProbe {
  key?: string;
  keyCode?: number;
  isComposing?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

/**
 * Distinguish a physical keyboard event from Android/iOS virtual-keyboard IME
 * keystrokes (`isComposing`, `keyCode === 229`, `Unidentified`/`Process`, or
 * unmodified typing inside an editable `<input>`/`<textarea>`/`.cm-editor`).
 */
export function shouldLatchHardwareKeyboard(
  ev: KeydownProbe,
  activeElementIsEditable: boolean,
): boolean {
  if (ev.isComposing || ev.keyCode === 229) return false;
  const key = ev.key ?? "";
  if (!key || key === "Unidentified" || key === "Process" || key === "Dead") {
    return false;
  }
  if (ev.altKey || ev.ctrlKey || ev.metaKey) return true;
  if (activeElementIsEditable) return false;
  return true;
}

/**
 * Migrate legacy 3-bar mobile chrome toggles (`mobileShell`, `mobileCaptureFab`,
 * `mobileReviewFab`) into the unified Workspace FAB setting (`mobileWorkspaceFab`).
 */
export function resolveUnifiedMobileHubEnabled(settings: {
  mobileWorkspaceFab?: boolean;
  mobileShell?: boolean;
  mobileCaptureFab?: boolean;
  mobileReviewFab?: boolean;
}): boolean {
  if (typeof settings.mobileWorkspaceFab === "boolean") {
    return settings.mobileWorkspaceFab;
  }
  if (
    typeof settings.mobileShell === "boolean" ||
    typeof settings.mobileCaptureFab === "boolean" ||
    typeof settings.mobileReviewFab === "boolean"
  ) {
    return Boolean(settings.mobileShell || settings.mobileCaptureFab || settings.mobileReviewFab);
  }
  return true;
}
