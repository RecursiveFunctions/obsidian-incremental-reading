import type { App } from "obsidian";
import { setIcon } from "obsidian";

export type IrHubEntry = {
  title: string;
  description?: string;
  icon?: string;
  run: () => void | Promise<void>;
};

type ActionPanelController = {
  close: () => void;
};

// One document can host more than one workspace container during Obsidian
// layout changes, so keep the action surface singleton at the document level.
const actionPanels = new WeakMap<Document, ActionPanelController>();

function editableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.matches("input, textarea, select, [contenteditable='true']")
  );
}

/**
 * Opens the singleton non-modal IR Actions surface. Calling it while the
 * surface is open closes it, which makes the command and FAB natural toggles.
 * `origin` remains accepted for callers that previously anchored the radial UI.
 */
export function openIrRadialQuickMenu(
  app: App,
  entries: IrHubEntry[],
  _origin: { cx: number; cy: number },
): () => void {
  const doc = app.workspace.containerEl.ownerDocument;
  const existing = actionPanels.get(doc);
  if (existing) {
    existing.close();
    return existing.close;
  }

  const win = doc.defaultView ?? window;
  const previouslyFocused =
    doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
  const panel = doc.body.createDiv({ cls: "ir-action-panel" });
  panel.setAttr("role", "region");
  panel.setAttr("aria-label", "IR Actions");

  const header = panel.createDiv({ cls: "ir-action-panel-header" });
  header.createDiv({ cls: "ir-action-panel-title", text: "IR Actions" });
  const closeBtn = header.createEl("button", {
    cls: "clickable-icon ir-action-panel-close",
    text: "Close",
    type: "button",
    attr: { "aria-label": "Close IR Actions" },
  });
  const closeIcon = closeBtn.createSpan({ cls: "ir-action-panel-close-icon" });
  setIcon(closeIcon, "x");

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    win.removeEventListener("keydown", onKey, true);
    panel.remove();
    if (actionPanels.get(doc)?.close === close) actionPanels.delete(doc);
    if (panel.contains(doc.activeElement)) previouslyFocused?.focus?.();
  };
  const runEntry = (entry: IrHubEntry) => {
    close();
    void Promise.resolve(entry.run()).catch((error) => {
      console.error("Incremental Reading: action failed", error);
    });
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      editableTarget(event.target)
    ) {
      return;
    }
    const match = event.code.match(/^Digit([1-9])$/);
    if (!match) return;
    const entry = entries[Number(match[1]) - 1];
    if (!entry) return;
    event.preventDefault();
    event.stopPropagation();
    runEntry(entry);
  };

  closeBtn.addEventListener("click", close);
  const list = panel.createDiv({ cls: "ir-action-panel-list" });
  if (entries.length === 0) {
    list.createDiv({
      cls: "ir-action-panel-empty",
      text: "No IR actions are available here.",
    });
  } else {
    entries.forEach((entry, index) => {
      const button = list.createEl("button", {
        cls: "ir-action-panel-item",
        type: "button",
        attr: { title: entry.description ?? entry.title },
      });
      if (entry.icon) {
        const icon = button.createSpan({ cls: "ir-action-panel-icon" });
        setIcon(icon, entry.icon);
      }
      const copy = button.createSpan({ cls: "ir-action-panel-copy" });
      copy.createSpan({ cls: "ir-action-panel-label", text: entry.title });
      if (entry.description) {
        copy.createSpan({
          cls: "ir-action-panel-description",
          text: entry.description,
        });
      }
      if (index < 9) {
        button.createSpan({
          cls: "ir-action-panel-key",
          text: String(index + 1),
          attr: { "aria-hidden": "true" },
        });
      }
      button.addEventListener("click", () => runEntry(entry));
    });
  }

  actionPanels.set(doc, { close });
  win.addEventListener("keydown", onKey, true);
  return close;
}
