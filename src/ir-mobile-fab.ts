/**
 * Workspace-level IR quick-actions FAB for Obsidian mobile.
 *
 * The review-only FAB was easy to miss because it lived inside a flex child
 * with absolute positioning. This button is fixed to the viewport when the
 * user is reading a source markdown note, so extract/cloze and the radial
 * wheel are one tap away. It is suppressed inside the IR review pane (the
 * dock already has a "Quick actions" button there) and when text input is
 * focused (the keyboard is up, the FAB would float over it).
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

  // When the soft keyboard opens, visualViewport.height shrinks below the
  // layout viewport. On some devices that signal is unreliable (the WebView
  // does not always shrink the visual viewport on IME open), so we also
  // check whether a text input has focus.
  const isKeyboardOpen = (): boolean => {
    const vv = window.visualViewport;
    if (vv && window.innerHeight - vv.height > 150) return true;
    return isEditingTextInput();
  };

  const sync = () => {
    const show = shouldShowWorkspaceFab(plugin.app) && !isKeyboardOpen();
    fab.toggleClass("is-hidden", !show);
  };

  const focusHandler = () => sync();
  document.addEventListener("focusin", focusHandler, true);
  document.addEventListener("focusout", focusHandler, true);

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
    document.removeEventListener("focusin", focusHandler, true);
    document.removeEventListener("focusout", focusHandler, true);
    fab.remove();
  };
}

function isEditingTextInput(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return true;
  }
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  return false;
}

function shouldShowWorkspaceFab(app: App): boolean {
  if (!Platform.isMobile) return false;

  // The review pane already has a "Quick actions" button in the dock, so the
  // FAB would be redundant there and competes with grade/edit buttons for
  // the bottom-right corner.
  const reviewLeaf = app.workspace.activeLeaf;
  if (reviewLeaf?.view.getViewType() === IR_REVIEW_VIEW_TYPE) return false;

  const mv = app.workspace.getActiveViewOfType(MarkdownView);
  return !!(mv?.file && mv.file.extension === "md");
}
