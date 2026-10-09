/**
 * Mobile shell: a persistent bottom bar with Review, Capture, and Collection
 * tabs. Collapsible to a pill. Replaces the need to hunt through menus on
 * mobile.
 */

import { Platform, setIcon } from "obsidian";
import type { Plugin } from "obsidian";

export interface MobileShellHooks {
  openReview: () => void;
  openCapture: () => void;
  openCollection: () => void;
  onCollapseChange: (collapsed: boolean) => void;
}

const SHELL_CLASS = "ir-mobile-shell";
const SHELL_COLLAPSED_CLASS = "ir-mobile-shell--collapsed";

export function registerMobileShell(
  plugin: Plugin,
  hooks: MobileShellHooks,
  isEnabled: () => boolean,
  isCollapsed: () => boolean,
): () => void {
  if (!Platform.isMobile) return () => {};

  const shell = document.body.createDiv({ cls: SHELL_CLASS });
  shell.setAttr("role", "toolbar");
  shell.setAttr("aria-label", "IR Mobile Shell");

  const pill = shell.createDiv({ cls: "ir-mobile-shell-pill" });
  pill.setAttr("role", "button");
  pill.setAttr("aria-label", "Expand IR shell");
  setIcon(pill, "brain-circuit");

  const bar = shell.createDiv({ cls: "ir-mobile-shell-bar" });

  const reviewBtn = bar.createEl("button", { cls: "ir-mobile-shell-btn" });
  setIcon(reviewBtn, "play-circle");
  reviewBtn.createSpan({ text: "Review" });
  reviewBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    hooks.openReview();
  });

  const captureBtn = bar.createEl("button", { cls: "ir-mobile-shell-btn" });
  setIcon(captureBtn, "plus-circle");
  captureBtn.createSpan({ text: "Capture" });
  captureBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    hooks.openCapture();
  });

  const collectionBtn = bar.createEl("button", { cls: "ir-mobile-shell-btn" });
  setIcon(collectionBtn, "list-tree");
  collectionBtn.createSpan({ text: "Collection" });
  collectionBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    hooks.openCollection();
  });

  const collapseBtn = bar.createEl("button", { cls: "ir-mobile-shell-collapse" });
  collapseBtn.setText("—");
  collapseBtn.setAttr("aria-label", "Collapse shell");
  collapseBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    shell.addClass(SHELL_COLLAPSED_CLASS);
    hooks.onCollapseChange(true);
  });

  pill.addEventListener("click", (ev) => {
    ev.stopPropagation();
    shell.removeClass(SHELL_COLLAPSED_CLASS);
    hooks.onCollapseChange(false);
  });

  const sync = () => {
    shell.toggleClass("is-hidden", !isEnabled());
    shell.toggleClass(SHELL_COLLAPSED_CLASS, isCollapsed());
  };
  plugin.registerInterval(window.setInterval(sync, 1000));
  sync();

  return () => {
    shell.remove();
  };
}
