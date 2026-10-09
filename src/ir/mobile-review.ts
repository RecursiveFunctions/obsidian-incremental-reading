/**
 * Mobile review helpers: FAB, layout configuration, and card rendering
 * adjustments for mobile devices.
 */

import { Platform, setIcon } from "obsidian";
import type { Plugin } from "obsidian";
import type { MobileReviewConfig } from "./mobile-review-logic";

export type { MobileReviewLayout, MobileReviewButtons, MobileReviewConfig } from "./mobile-review-logic";
export { mobileGradeLabels } from "./mobile-review-logic";

export function registerMobileReviewFab(
  plugin: Plugin,
  onOpenReview: () => void,
  isEnabled: () => boolean,
): () => void {
  if (!Platform.isMobile) return () => {};

  const fab = document.body.createDiv({ cls: "ir-mobile-review-fab" });
  fab.setAttr("role", "button");
  fab.setAttr("aria-label", "IR Review");
  fab.setAttr("title", "IR Review");
  setIcon(fab, "play-circle");

  fab.addEventListener("click", (ev) => {
    ev.stopPropagation();
    if (!isEnabled()) return;
    onOpenReview();
  });

  const sync = () => {
    fab.toggleClass("is-hidden", !isEnabled());
  };
  plugin.registerInterval(window.setInterval(sync, 1000));
  sync();

  return () => {
    fab.remove();
  };
}

/**
 * Apply mobile review layout classes to the review container.
 * Returns a cleanup function.
 */
export function applyMobileReviewLayout(
  container: HTMLElement,
  config: MobileReviewConfig,
): () => void {
  const cls = "ir-mobile-review";
  container.addClass(cls);
  container.toggleClass("ir-mobile-review--minimal", config.layout === "minimal");
  container.toggleClass("ir-mobile-review--compact", config.buttons === "compact");
  container.style.setProperty("--ir-mobile-font-scale", String(config.fontSize));

  return () => {
    container.removeClass(cls);
    container.removeClass("ir-mobile-review--minimal");
    container.removeClass("ir-mobile-review--compact");
    container.style.removeProperty("--ir-mobile-font-scale");
  };
}
