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

let workspaceFabSync: (() => void) | null = null;
let workspaceFabBadge: ((due: number) => void) | null = null;

/** Call after review edit-mode toggles so the FAB repositions immediately. */
export function notifyWorkspaceFabSync(): void {
  workspaceFabSync?.();
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
  workspaceFabBadge?.(due);
}

export function registerWorkspaceIrFab(
  plugin: Plugin,
  hooks: {
    /** Run before focus leaves the editor (pointerdown / touchstart). */
    prepareOpenHub: () => void;
    openHub: () => void;
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
  fab.addEventListener(
    "pointerdown",
    (ev) => {
      if (ev.pointerType === "mouse" && ev.button !== 0) return;
      prepare();
      ev.preventDefault();
    },
    { capture: true },
  );
  fab.addEventListener(
    "touchstart",
    () => {
      prepare();
    },
    { capture: true, passive: true },
  );
  fab.addEventListener("click", (ev) => {
    ev.stopPropagation();
    hooks.openHub();
  });

  const sync = () => {
    const ctx = fabLayoutContext(plugin.app);
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

function fabLayoutContext(app: App): {
  show: boolean;
  review: boolean;
  reviewDock: boolean;
  layoutRoot?: HTMLElement;
} {
  if (!irWorkspaceFabShouldShow(Platform.isMobile)) {
    return { show: false, review: false, reviewDock: false };
  }

  const leaf = app.workspace.activeLeaf;
  if (leaf?.view instanceof IrReviewView) {
    return {
      show: true,
      review: true,
      reviewDock: leaf.view.mobileFabAboveDock(),
      layoutRoot: leaf.view.mobileFabLayoutRoot(),
    };
  }

  const vt = leaf?.view.getViewType();
  if (vt === IR_REVIEW_VIEW_TYPE) {
    return { show: true, review: true, reviewDock: true };
  }

  return { show: true, review: false, reviewDock: false };
}
