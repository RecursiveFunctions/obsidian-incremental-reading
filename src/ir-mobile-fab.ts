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

let workspaceFabSync: (() => void) | null = null;

/** Call after review edit-mode toggles so the FAB repositions immediately. */
export function notifyWorkspaceFabSync(): void {
  workspaceFabSync?.();
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
