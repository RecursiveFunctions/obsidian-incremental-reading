/**
 * Workspace-level IR review controls for Obsidian mobile.
 *
 * Fixed to the viewport on every mobile surface (file explorer included)
 * so Start review is one tap away. Mounted on `document.body` so Obsidian
 * workspace transforms do not clip it.
 */

import type { App, Plugin } from "obsidian";
import { Platform, setIcon } from "obsidian";
import { IR_REVIEW_VIEW_TYPE, IrReviewView } from "./review-view";
import { irWorkspaceFabShouldShow } from "./ir/mobile-hub";
import { mobileReviewControlLabel } from "./ir/mobile-review-control";
import { layoutWorkspaceFab } from "./ir/mobile-viewport";
import type { QueueLoad } from "./status-bar";

const FAB_CLASS = "ir-workspace-fab";
const PRIMARY_CLASS = "ir-workspace-fab-primary";
const ACTIONS_CLASS = "ir-workspace-fab-actions";

let workspaceFabSync: (() => void) | null = null;
let workspaceFabLoad: ((load: QueueLoad) => void) | null = null;

/** Call after review chrome changes so the workspace control resyncs immediately. */
export function notifyWorkspaceFabSync(): void {
  workspaceFabSync?.();
}

/**
 * Paint the queue load on the workspace review control.
 *
 * Obsidian mobile has no status bar, so the glanceable queue-load indicator
 * had no mobile implementation at all: `renderStatusBar` was painting into
 * an element the platform never shows. The FAB is the only always-visible
 * IR surface on a phone, so the due count rides its primary action.
 *
 * Push, not poll: the host plugin already recomputes the load on every
 * mutation and calls this. The FAB's own 500 ms interval stays layout-only.
 * No-op on desktop, where no FAB exists.
 */
export function setWorkspaceIrFabLoad(load: QueueLoad): void {
  workspaceFabLoad?.(load);
}

/** @deprecated Use {@link setWorkspaceIrFabLoad} with the complete QueueLoad. */
export function setWorkspaceIrFabDue(due: number): void {
  setWorkspaceIrFabLoad({
    due,
    later: 0,
    postponed: 0,
    inflow7d: 0,
    dueByType: { topic: 0, extract: 0, item: 0 },
  });
}

export function registerWorkspaceIrFab(
  plugin: Plugin,
  hooks: {
    /** Start a fresh review or reveal an existing review session. */
    startOrResumeReview: () => void;
    /** Run before focus leaves the editor (pointerdown / touchstart). */
    prepareOpenHub: () => void;
    openHub: () => void;
  },
): () => void {
  if (!Platform.isMobile) return () => {};

  const fab = document.body.createDiv({ cls: FAB_CLASS });
  const primary = fab.createEl("button", { cls: PRIMARY_CLASS, type: "button" });
  const actions = fab.createEl("button", {
    cls: ACTIONS_CLASS,
    type: "button",
    attr: { "aria-label": "IR Actions", title: "IR Actions" },
  });
  setIcon(actions, "ellipsis");
  actions.createSpan({ text: "Actions" });
  let lastLoad: QueueLoad = {
    due: 0,
    later: 0,
    postponed: 0,
    inflow7d: 0,
    dueByType: { topic: 0, extract: 0, item: 0 },
  };
  const paintLoad = (load: QueueLoad) => {
    lastLoad = load;
    const { resume } = fabLayoutContext(plugin.app);
    const label = mobileReviewControlLabel(load.due, resume);
    primary.setText(label);
    primary.setAttr("aria-label", label);
    primary.setAttr("title", label);
  };
  workspaceFabLoad = paintLoad;
  paintLoad(lastLoad);

  const prepare = () => hooks.prepareOpenHub();
  actions.addEventListener(
    "pointerdown",
    (ev) => {
      if (ev.pointerType === "mouse" && ev.button !== 0) return;
      prepare();
      ev.preventDefault();
    },
    { capture: true },
  );
  actions.addEventListener(
    "touchstart",
    () => {
      prepare();
    },
    { capture: true, passive: true },
  );
  primary.addEventListener("click", (ev) => {
    ev.stopPropagation();
    hooks.startOrResumeReview();
  });
  actions.addEventListener("click", (ev) => {
    ev.stopPropagation();
    hooks.openHub();
  });

  const sync = () => {
    const ctx = fabLayoutContext(plugin.app);
    if (ctx.show) {
      fab.removeClass("is-hidden");
      layoutWorkspaceFab(fab, {
        reviewDock: false,
      });
      paintLoad(lastLoad);
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
    workspaceFabLoad = null;
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
  resume: boolean;
} {
  if (!irWorkspaceFabShouldShow(Platform.isMobile)) {
    return { show: false, resume: false };
  }

  const leaf = app.workspace.activeLeaf;
  const vt = leaf?.view.getViewType();
  if (leaf?.view instanceof IrReviewView || vt === IR_REVIEW_VIEW_TYPE) {
    return { show: false, resume: false };
  }

  return {
    show: true,
    resume: app.workspace.getLeavesOfType(IR_REVIEW_VIEW_TYPE).length > 0,
  };
}
