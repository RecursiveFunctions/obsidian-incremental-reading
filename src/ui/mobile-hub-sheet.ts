/**
 * Adaptive Bottom Sheet Hub for mobile & coarse-pointer devices (#65).
 * Replaces the 18-char truncated radial wheel on narrow/touch viewports with
 * full-width, untruncated thumb-zone action rows and one-tap Quick Capture.
 */

import { setIcon } from "obsidian";
import type { IrHubEntry } from "../ir-actions-radial";

const HUB_BACKDROP_CLASS = "ir-mobile-hub-backdrop";
const HUB_SHEET_CLASS = "ir-mobile-hub-sheet";

let activeClose: (() => void) | null = null;

export interface MobileHubSheetOptions {
  dueCount?: number;
  onQuickCapture?: () => void;
}

export function openMobileHubSheet(
  entries: readonly IrHubEntry[],
  opts?: MobileHubSheetOptions,
): () => void {
  activeClose?.();

  const backdrop = document.body.createDiv({ cls: HUB_BACKDROP_CLASS });
  const sheet = document.body.createDiv({
    cls: HUB_SHEET_CLASS,
    attr: {
      role: "dialog",
      "aria-modal": "false",
      "aria-label": "Incremental Reading actions",
    },
  });

  const onKeyDown = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      close();
    }
  };

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    if (activeClose === close) activeClose = null;
    document.removeEventListener("keydown", onKeyDown, true);
    sheet.remove();
    backdrop.remove();
  };
  activeClose = close;

  backdrop.addEventListener("click", close);
  document.addEventListener("keydown", onKeyDown, true);

  const handle = sheet.createDiv({ cls: "ir-mobile-hub-handle" });
  handle.setAttr("aria-hidden", "true");

  const header = sheet.createDiv({ cls: "ir-mobile-hub-header" });
  const titleWrap = header.createDiv({ cls: "ir-mobile-hub-title-wrap" });
  titleWrap.createSpan({ cls: "ir-mobile-hub-title", text: "Incremental Reading" });
  if (opts?.dueCount !== undefined && opts.dueCount > 0) {
    titleWrap.createSpan({
      cls: "ir-mobile-hub-due-pill",
      text: `${opts.dueCount} due`,
    });
  }

  const headerActions = header.createDiv({ cls: "ir-mobile-hub-header-actions" });
  if (opts?.onQuickCapture) {
    const capBtn = headerActions.createEl("button", {
      cls: "ir-mobile-hub-capture-btn mod-cta",
      type: "button",
      attr: { "aria-label": "Quick capture extract, cloze, or topic" },
    });
    const capIcon = capBtn.createSpan({ cls: "ir-mobile-hub-btn-icon" });
    setIcon(capIcon, "plus-circle");
    capBtn.createSpan({ text: "Capture" });
    capBtn.addEventListener("click", () => {
      close();
      opts.onQuickCapture?.();
    });
  }

  const closeBtn = headerActions.createEl("button", {
    cls: "ir-mobile-hub-close",
    type: "button",
    text: "×",
    attr: { "aria-label": "Close Incremental Reading actions" },
  });
  closeBtn.addEventListener("click", close);

  const list = sheet.createDiv({ cls: "ir-mobile-hub-list" });
  for (const entry of entries) {
    const row = list.createEl("button", {
      cls: "ir-mobile-hub-row",
      type: "button",
    });
    const iconBox = row.createSpan({ cls: "ir-mobile-hub-row-icon" });
    setIcon(iconBox, entry.icon || "circle-dot");
    const textCol = row.createSpan({ cls: "ir-mobile-hub-row-copy" });
    textCol.createSpan({ cls: "ir-mobile-hub-row-title", text: entry.title });
    if (entry.description) {
      textCol.createSpan({ cls: "ir-mobile-hub-row-desc", text: entry.description });
    }
    row.addEventListener("click", () => {
      close();
      void entry.run();
    });
  }

  return close;
}
