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
  hooks: {
    /** Run before focus leaves the editor (pointerdown / touchstart). */
    prepareOpenHub: () => void;
    openHub: () => void;
  },
): () => void {
  if (!Platform.isMobile) return () => {};

  const root = plugin.app.workspace.containerEl;
  const fab = root.createDiv({ cls: FAB_CLASS });
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

  // When the soft keyboard opens, visualViewport.height shrinks well below the
  // layout viewport (window.innerHeight). The FAB would otherwise float over
  // the keyboard and obscure typing on iOS/Android. Threshold: layout viewport
  // shrunk by more than 150px is the IME, not just URL bar collapse.
  const isKeyboardOpen = (): boolean => {
    const vv = window.visualViewport;
    if (!vv) return false;
    return window.innerHeight - vv.height > 150;
  };

  const sync = () => {
    const show = shouldShowWorkspaceFab(plugin.app) && !isKeyboardOpen();
    fab.toggleClass("is-hidden", !show);
  };

  plugin.registerEvent(plugin.app.workspace.on("active-leaf-change", sync));
  plugin.registerEvent(plugin.app.workspace.on("layout-change", sync));
  plugin.registerInterval(window.setInterval(sync, 500));
  const vv = window.visualViewport;
  if (vv) {
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
  }
  workspaceFabSync = sync;
  sync();

  return () => {
    workspaceFabSync = null;
    if (vv) {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
    }
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
