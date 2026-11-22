/**
 * Mobile capture FAB and sheet. Provides a thumb-reachable way to capture
 * text as an extract, cloze item, or topic on mobile devices.
 */

import { App, Notice, Platform, setIcon } from "obsidian";
import type { Plugin } from "obsidian";
import { buildClozedBody, suggestCaptureMode, validateCapture, type CaptureMode } from "./capture";
import { newElementId, newEventId, type ElementId, type EventId } from "./ids";
import { buildExtractEvent } from "./extract";
import { newElement, type IrElement } from "./model";
import { wrapCloze } from "../cloze";

export interface MobileCaptureHooks {
  /** Create an extract from text. Returns the element id. */
  createExtract: (text: string) => Promise<ElementId | null>;
  /** Create a cloze item from text. Returns the element id. */
  createCloze: (text: string, hint?: string) => Promise<ElementId | null>;
  /** Create a topic from text. Returns the element id. */
  createTopic: (text: string, title: string) => Promise<ElementId | null>;
}

const SHEET_CLASS = "ir-mobile-capture-sheet";
const SHEET_BACKDROP = "ir-mobile-capture-backdrop";

let activeCaptureClose: (() => void) | null = null;

/**
 * Open the thumb-friendly Quick Capture bottom sheet directly (invoked by
 * long-pressing the unified Workspace FAB or tapping Capture in the Mobile Hub, #65).
 */
export function openMobileCaptureSheet(hooks: MobileCaptureHooks): () => void {
  if (activeCaptureClose) return activeCaptureClose;
  const backdrop = document.body.createDiv({ cls: SHEET_BACKDROP });
  const sheet = document.body.createDiv({ cls: SHEET_CLASS });

  let closed = false;
  const closeSheet = () => {
    if (closed) return;
    closed = true;
    if (activeCaptureClose === closeSheet) activeCaptureClose = null;
    sheet.remove();
    backdrop.remove();
  };
  activeCaptureClose = closeSheet;
  backdrop.addEventListener("click", closeSheet);

  const header = sheet.createDiv({ cls: "ir-mobile-capture-header" });
  header.createSpan({ text: "Quick capture" });
  const closeBtn = header.createEl("button", { cls: "ir-mobile-capture-close", type: "button" });
  closeBtn.setText("×");
  closeBtn.addEventListener("click", closeSheet);

  const textarea = sheet.createEl("textarea", {
    cls: "ir-mobile-capture-textarea",
    attr: { placeholder: "Paste or type text to capture…" },
  });

  const modeRow = sheet.createDiv({ cls: "ir-mobile-capture-modes" });
  let mode: CaptureMode = "extract" as CaptureMode;
  const modeBtns: Record<CaptureMode, HTMLElement> = {} as Record<CaptureMode, HTMLElement>;

  for (const m of ["extract", "cloze", "topic"] as CaptureMode[]) {
    const btn = modeRow.createEl("button", {
      cls: `ir-mobile-capture-mode-btn${m === mode ? " is-active" : ""}`,
      type: "button",
      text: m === "extract" ? "Extract" : m === "cloze" ? "Cloze" : "Topic",
    });
    modeBtns[m] = btn;
    btn.addEventListener("click", () => {
      mode = m;
      for (const k of Object.keys(modeBtns) as CaptureMode[]) {
        modeBtns[k].toggleClass("is-active", k === m);
      }
      hintInput.style.display = mode === "cloze" ? "" : "none";
      titleInput.style.display = mode === "topic" ? "" : "none";
    });
  }

  const hintInput = sheet.createEl("input", {
    cls: "ir-mobile-capture-hint",
    attr: { placeholder: "Hint (optional, cloze only)" },
  });
  hintInput.style.display = mode === "cloze" ? "" : "none";

  const titleInput = sheet.createEl("input", {
    cls: "ir-mobile-capture-title",
    attr: { placeholder: "Title (topic only)" },
  });
  titleInput.style.display = mode === "topic" ? "" : "none";

  const saveBtn = sheet.createEl("button", {
    cls: "ir-mobile-capture-save",
    type: "button",
    text: "Save",
  });

  saveBtn.addEventListener("click", async () => {
    const text = textarea.value;
    const result = validateCapture({
      text,
      mode,
      clozedBody: mode === "cloze" ? buildClozedBody(text, 0, text.length, hintInput.value) : undefined,
      hint: mode === "cloze" ? hintInput.value : undefined,
      title: mode === "topic" ? titleInput.value : undefined,
    });
    if (!result.valid) {
      new Notice(`Incremental Reading: ${result.error}`);
      return;
    }
    saveBtn.disabled = true;
    saveBtn.setText("Saving…");
    try {
      let id: ElementId | null = null;
      if (mode === "extract") {
        id = await hooks.createExtract(result.text);
      } else if (mode === "cloze") {
        id = await hooks.createCloze(result.text, result.hint);
      } else {
        id = await hooks.createTopic(result.text, result.title!);
      }
      if (id) {
        new Notice(`Incremental Reading: ${mode} captured.`);
        closeSheet();
      }
    } catch (e) {
      console.error("Incremental Reading: mobile capture failed", e);
      new Notice("Incremental Reading: capture failed.");
    } finally {
      saveBtn.disabled = false;
      saveBtn.setText("Save");
    }
  });

  window.setTimeout(() => textarea.focus(), 100);
  return closeSheet;
}

export function registerMobileCapture(
  plugin: Plugin,
  _app: App,
  hooks: MobileCaptureHooks,
  isEnabled: () => boolean,
): () => void {
  if (!Platform.isMobile) return () => {};

  const fab = document.body.createDiv({ cls: "ir-mobile-capture-fab" });
  fab.setAttr("role", "button");
  fab.setAttr("aria-label", "IR Capture");
  fab.setAttr("title", "IR Capture");
  setIcon(fab, "plus-circle");

  let closeActive: (() => void) | null = null;
  fab.addEventListener("click", (ev) => {
    ev.stopPropagation();
    if (!isEnabled()) return;
    closeActive = openMobileCaptureSheet(hooks);
  });

  const sync = () => {
    fab.toggleClass("is-hidden", !isEnabled());
  };
  plugin.registerInterval(window.setInterval(sync, 1000));
  sync();

  return () => {
    closeActive?.();
    fab.remove();
  };
}
