/**
 * Workspace-level IR quick-actions FAB for Obsidian mobile.
 *
 * Fixed to the viewport on markdown source notes so extract/cloze and the
 * radial wheel are one tap away. Hidden only inside the IR review pane
 * (the dock already has extract/cloze there). Mounted on `document.body`
 * so Obsidian workspace transforms do not clip it.
 */

import type { App, Plugin } from "obsidian";
import { MarkdownView, Platform, setIcon } from "obsidian";
import { IR_REVIEW_VIEW_TYPE } from "./review-view";
import { layoutWorkspaceFab } from "./ir/mobile-viewport";

const FAB_CLASS = "ir-workspace-fab";

let workspaceFabSync: (() => void) | null = null;

/** Call after review edit-mode toggles so the FAB hides immediately. */
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
  fab.setAttr("aria-label", "IR quick actions");
  fab.setAttr("title", "IR quick actions");
  setIcon(fab, "layout-list");
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
    const show = shouldShowWorkspaceFab(plugin.app);
    if (show) {
      fab.removeClass("is-hidden");
      layoutWorkspaceFab(fab);
    } else {
      fab.addClass("is-hidden");
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

function shouldShowWorkspaceFab(app: App): boolean {
  if (!Platform.isMobile) return false;

  const leaf = app.workspace.activeLeaf;
  if (leaf?.view.getViewType() === IR_REVIEW_VIEW_TYPE) return false;

  const mv = app.workspace.getActiveViewOfType(MarkdownView);
  if (mv?.file?.extension === "md") return true;

  if (leaf?.view.getViewType() === "markdown") {
    const m = leaf.view as MarkdownView;
    return !!(m.file && m.file.extension === "md");
  }
  return false;
}
