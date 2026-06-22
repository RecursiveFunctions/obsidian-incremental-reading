/**
 * Session audit view (UI commitment #7). A workspace leaf that lists every
 * IR action taken since the current Obsidian session started, newest first,
 * with click-to-open links back to the touched notes.
 *
 * Pure compute lives in src/ir/session-log.ts; this file is the thin
 * Obsidian wiring. Lives in a leaf, NOT a modal, per commitment #6.
 */

import { ItemView, Notice, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import { IrStore } from "./ir/store";
import {
  actionLabel,
  formatTimestamp,
  sessionEntries,
  type SessionEntry,
} from "./ir/session-log";

export const IR_SESSION_VIEW_TYPE = "ir-session-view";

const KIND_ICON: Record<string, string> = {
  graded: "check-circle",
  "topic-advanced": "fast-forward",
  "mercy-postponed": "clock",
  "dismiss-set": "ban",
  "priority-set": "sliders-horizontal",
  "element-created": "plus-circle",
  promoted: "arrow-up",
  reparented: "git-branch",
  "source-tombstoned": "trash",
  "source-renamed": "pencil",
  "element-deleted": "trash",
  "anchor-repaired": "wrench",
  "anchor-detached": "unlink",
};

export class IrSessionView extends ItemView {
  private store: IrStore;
  private sessionStartMs: number;

  constructor(leaf: WorkspaceLeaf, store: IrStore, sessionStartMs: number) {
    super(leaf);
    this.store = store;
    this.sessionStartMs = sessionStartMs;
  }

  getViewType(): string {
    return IR_SESSION_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "IR session log";
  }

  getIcon(): string {
    return "history";
  }

  async onOpen(): Promise<void> {
    await this.render();
  }

  async onClose(): Promise<void> {}

  /** Re-render from the store. Safe to call repeatedly. */
  async render(): Promise<void> {
    const container = this.contentEl;
    container.empty();
    container.addClass("ir-session-view");

    const header = container.createDiv({ cls: "ir-session-header" });
    header.createEl("h4", { text: "IR session log" });
    const refresh = header.createEl("button", {
      text: "Refresh",
      cls: "ir-session-refresh",
    });
    refresh.onclick = () => void this.render();

    const body = container.createDiv({ cls: "ir-session-body" });

    let entries: SessionEntry[];
    try {
      const state = await this.store.load();
      const events = await this.store.loadEvents();
      entries = sessionEntries(events, state.elements, this.sessionStartMs);
    } catch (e) {
      console.error("Incremental Reading: session log load failed", e);
      body.createEl("p", {
        text: "Could not load the session log. See the developer console.",
      });
      return;
    }

    if (entries.length === 0) {
      body.createEl("p", {
        cls: "ir-session-empty",
        text:
          "No IR actions yet in this session. Anything you do " +
          "(extract, grade, postpone, dismiss, change priority) will " +
          "appear here so you can audit your own pass.",
      });
      return;
    }

    const ul = body.createEl("ul", { cls: "ir-session-list" });
    for (const entry of entries) {
      this.renderEntry(ul, entry);
    }
  }

  private renderEntry(parent: HTMLElement, entry: SessionEntry): void {
    const li = parent.createEl("li", { cls: "ir-session-entry" });

    const timeEl = li.createSpan({
      cls: "ir-session-time",
      text: formatTimestamp(entry.ts),
    });
    timeEl.setAttribute("aria-label", new Date(entry.ts).toLocaleString());

    const iconSpan = li.createSpan({ cls: "ir-session-icon" });
    setIcon(iconSpan, KIND_ICON[entry.kind] ?? "circle");

    li.createSpan({
      cls: "ir-session-action",
      text: actionLabel(entry.kind),
    });

    const label = li.createSpan({
      cls: "ir-session-label",
      text: entry.label,
    });
    if (entry.notePath) {
      label.addClass("ir-session-link");
      label.onclick = () => void this.openNote(entry.notePath!);
    }
  }

  private async openNote(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      new Notice(`Incremental Reading: note "${path}" not found.`);
      return;
    }
    await this.app.workspace.getLeaf(false).openFile(file);
  }
}
