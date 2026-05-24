/**
 * Workspace-level IR quick-actions FAB for Obsidian mobile.
 *
 * The review-only FAB was easy to miss because it lived inside a flex child
 * with absolute positioning. This button is fixed to the viewport whenever
 * the user is in a markdown note or the IR review pane, so extract/cloze and
 * the radial wheel are one tap away while reading source material.
 */

import type { App, Plugin } from "obsidian";
import { MarkdownView, Platform, setIcon } from "obsidian";
import { IR_REVIEW_VIEW_TYPE } from "./review-view";

const FAB_CLASS = "ir-workspace-fab";

let workspaceFabSync: (() => void) | null = null;

/** Call after review edit-mode toggles so the FAB hides immediately. */
export function notifyWorkspaceFabSync(): void {
  workspaceFabSync?.();
}

export function registerWorkspaceIrFab(
  plugin: Plugin,
  onOpenHub: () => void,
): () => void {
  if (!Platform.isMobile) return () => {};

  const root = plugin.app.workspace.containerEl;
  const fab = root.createDiv({ cls: FAB_CLASS });
  fab.setAttr("role", "button");
  fab.setAttr("aria-label", "IR quick actions");
  fab.setAttr("title", "IR quick actions");
  setIcon(fab, "layout-list");
  fab.addEventListener("click", (ev) => {
    ev.stopPropagation();
    onOpenHub();
  });

  const sync = () => {
    const show = shouldShowWorkspaceFab(plugin.app);
    fab.toggleClass("is-hidden", !show);
  };

  plugin.registerEvent(plugin.app.workspace.on("active-leaf-change", sync));
  plugin.registerEvent(plugin.app.workspace.on("layout-change", sync));
  plugin.registerInterval(window.setInterval(sync, 500));
  workspaceFabSync = sync;
  sync();

  return () => {
    workspaceFabSync = null;
    fab.remove();
  };
}

function shouldShowWorkspaceFab(app: App): boolean {
  if (!Platform.isMobile) return false;

  const reviewLeaf = app.workspace.activeLeaf;
  if (reviewLeaf?.view.getViewType() === IR_REVIEW_VIEW_TYPE) {
    const reviewEl = reviewLeaf.view.containerEl;
    if (reviewEl.hasClass("ir-review--editing")) return false;
    return true;
  }

  const mv = app.workspace.getActiveViewOfType(MarkdownView);
  return !!(mv?.file && mv.file.extension === "md");
}
