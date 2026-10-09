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

export function registerMobileCapture(
  plugin: Plugin,
  app: App,
  hooks: MobileCaptureHooks,
  isEnabled: () => boolean,
): () => void {
  if (!Platform.isMobile) return () => {};

  const fab = document.body.createDiv({ cls: "ir-mobile-capture-fab" });
  fab.setAttr("role", "button");
  fab.setAttr("aria-label", "IR Capture");
  fab.setAttr("title", "IR Capture");
  setIcon(fab, "plus-circle");

  let sheet: HTMLElement | null = null;
  let backdrop: HTMLElement | null = null;

  const closeSheet = () => {
    sheet?.remove();
    backdrop?.remove();
    sheet = null;
    backdrop = null;
  };

  const openSheet = () => {
    if (sheet) return;
    backdrop = document.body.createDiv({ cls: SHEET_BACKDROP });
    backdrop.addEventListener("click", closeSheet);

    sheet = document.body.createDiv({ cls: SHEET_CLASS });
    const header = sheet.createDiv({ cls: "ir-mobile-capture-header" });
    header.createSpan({ text: "Capture" });
    const closeBtn = header.createEl("button", { cls: "ir-mobile-capture-close" });
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
        text: m === "extract" ? "Extract" : m === "cloze" ? "Cloze" : "Topic",
      });
      modeBtns[m] = btn;
      btn.addEventListener("click", () => {
        mode = m;
        for (const k of Object.keys(modeBtns) as CaptureMode[]) {
          modeBtns[k].toggleClass("is-active", k === m);
        }
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

    // Focus the textarea after a short delay so the keyboard opens.
    window.setTimeout(() => textarea.focus(), 100);
  };

  fab.addEventListener("click", (ev) => {
    ev.stopPropagation();
    if (!isEnabled()) return;
    openSheet();
  });

  const sync = () => {
    fab.toggleClass("is-hidden", !isEnabled());
  };
  plugin.registerInterval(window.setInterval(sync, 1000));
  sync();

  return () => {
    closeSheet();
    fab.remove();
  };
}
