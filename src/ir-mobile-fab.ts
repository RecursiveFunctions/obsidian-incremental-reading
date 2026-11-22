/**
 * Workspace-level IR quick-actions FAB for Obsidian mobile.
 *
 * Fixed to the viewport on every mobile surface (file explorer included)
 * so Start review is one tap away. Mounted on `document.body` so Obsidian
 * workspace transforms do not clip it.
 */

import type { App, Plugin } from "obsidian";
import { Platform, setIcon } from "obsidian";
import { IR_REVIEW_VIEW_TYPE, IrReviewView } from "./review-view";
import { irWorkspaceFabShouldShow } from "./ir/mobile-hub";
import { layoutWorkspaceFab } from "./ir/mobile-viewport";

const FAB_CLASS = "ir-workspace-fab";
const BADGE_CLASS = "ir-workspace-fab-badge";
const LONG_PRESS_MS = 450;

let workspaceFabSync: (() => void) | null = null;
let workspaceFabBadge: ((due: number) => void) | null = null;
let lastWorkspaceDueCount = 0;

/** Call after review edit-mode toggles or setting updates so the FAB syncs immediately. */
export function notifyWorkspaceFabSync(): void {
  workspaceFabSync?.();
}

export function getWorkspaceIrFabDue(): number {
  return lastWorkspaceDueCount;
}

/**
 * Paint the due count on the workspace FAB (UI commitment #4 on mobile).
 *
 * Obsidian mobile has no status bar, so the glanceable queue-load indicator
 * had no mobile implementation at all: `renderStatusBar` was painting into
 * an element the platform never shows. The FAB is the only always-visible
 * IR surface on a phone, so the count rides there.
 *
 * Push, not poll: the host plugin already recomputes the load on every
 * mutation and calls this. The FAB's own 500 ms interval stays layout-only.
 * No-op on desktop, where no FAB exists.
 */
export function setWorkspaceIrFabDue(due: number): void {
  lastWorkspaceDueCount = Math.max(0, due);
  workspaceFabBadge?.(due);
}

export function registerWorkspaceIrFab(
  plugin: Plugin,
  hooks: {
    /** Run before focus leaves the editor (pointerdown / touchstart). */
    prepareOpenHub: () => void;
    openHub: () => void;
    /** Optional long-press action (450 ms) — opens Quick Capture (#65). */
    onLongPress?: () => void;
    /** Optional setting gate (#65). Defaults to true. */
    isEnabled?: () => boolean;
  },
): () => void {
  if (!Platform.isMobile) return () => {};

  const fab = document.body.createDiv({ cls: FAB_CLASS });
  fab.setAttr("role", "button");
  fab.setAttr("aria-label", "Incremental Reading");
  fab.setAttr("title", "Incremental Reading");
  setIcon(fab, "brain-circuit");

  // Created after setIcon: setIcon replaces the element's children, so a
  // badge added before it would be wiped out.
  const badge = fab.createDiv({ cls: BADGE_CLASS });
  badge.addClass("is-hidden");
  let lastDue = 0;
  const paintBadge = (due: number) => {
    lastDue = due;
    if (due <= 0) {
      badge.addClass("is-hidden");
      badge.setText("");
      fab.setAttr("aria-label", "Incremental Reading");
      fab.setAttr("title", "Incremental Reading");
      return;
    }
    badge.removeClass("is-hidden");
    badge.setText(due > 99 ? "99+" : String(due));
    const label = `Incremental Reading · ${due} due`;
    fab.setAttr("aria-label", label);
    fab.setAttr("title", label);
  };
  workspaceFabBadge = paintBadge;
  paintBadge(lastDue);

  const prepare = () => hooks.prepareOpenHub();
  let longPressTimer: number | null = null;
  let longPressFired = false;
  let downX = 0;
  let downY = 0;

  const clearLongPress = () => {
    if (longPressTimer !== null) {
      window.clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  };

  fab.addEventListener(
    "pointerdown",
    (ev) => {
      if (ev.pointerType === "mouse" && ev.button !== 0) return;
      prepare();
      longPressFired = false;
      downX = ev.clientX;
      downY = ev.clientY;
      clearLongPress();
      if (hooks.onLongPress) {
        longPressTimer = window.setTimeout(() => {
          longPressTimer = null;
          longPressFired = true;
          hooks.onLongPress?.();
        }, LONG_PRESS_MS);
      }
      ev.preventDefault();
    },
    { capture: true },
  );
  fab.addEventListener("pointermove", (ev) => {
    if (longPressTimer === null) return;
    if (Math.hypot(ev.clientX - downX, ev.clientY - downY) > 10) {
      clearLongPress();
    }
  });
  fab.addEventListener("pointerup", clearLongPress);
  fab.addEventListener("pointercancel", clearLongPress);
  fab.addEventListener(
    "touchstart",
    () => {
      prepare();
    },
    { capture: true, passive: true },
  );
  fab.addEventListener("click", (ev) => {
    ev.stopPropagation();
    clearLongPress();
    if (longPressFired) {
      longPressFired = false;
      return;
    }
    hooks.openHub();
  });

  const sync = () => {
    const enabled = hooks.isEnabled ? hooks.isEnabled() : true;
    const ctx = fabLayoutContext(plugin.app, enabled);
    if (ctx.show) {
      fab.removeClass("is-hidden");
      fab.toggleClass("ir-workspace-fab--review", ctx.review);
      layoutWorkspaceFab(fab, {
        reviewDock: ctx.reviewDock,
        layoutRoot: ctx.layoutRoot,
      });
    } else {
      fab.addClass("is-hidden");
      fab.removeClass("ir-workspace-fab--review");
    }
  };

  plugin.registerEvent(plugin.app.workspace.on("active-leaf-change", sync));
  plugin.registerEvent(plugin.app.workspace.on("layout-change", sync));
  plugin.registerEvent(plugin.app.workspace.on("file-open", sync));
  plugin.registerInterval(window.setInterval(sync, 500));
  const vv = window.visualViewport;
  if (vv) {
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
  }
  window.addEventListener("orientationchange", sync);
  window.addEventListener("resize", sync);
  workspaceFabSync = sync;
  sync();

  return () => {
    workspaceFabSync = null;
    workspaceFabBadge = null;
    if (vv) {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
    }
    window.removeEventListener("orientationchange", sync);
    window.removeEventListener("resize", sync);
    fab.remove();
  };
}

function fabLayoutContext(
  app: App,
  enabled = true,
): {
  show: boolean;
  review: boolean;
  reviewDock: boolean;
  layoutRoot?: HTMLElement;
} {
  const leaf = app.workspace.activeLeaf;
  const inReview =
    leaf?.view instanceof IrReviewView ||
    leaf?.view.getViewType() === IR_REVIEW_VIEW_TYPE;
  if (!irWorkspaceFabShouldShow(Platform.isMobile, inReview, enabled)) {
    return { show: false, review: inReview, reviewDock: false };
  }

  return { show: true, review: false, reviewDock: false };
}
