/**
 * Session audit view (UI commitment #7). A workspace leaf that lists every
 * IR action taken since the current review session started, newest first.
 * Click an entry to jump the review cursor when that id is in the queue,
 * otherwise open the note.
 *
 * Pure compute lives in src/ir/session-log.ts; this file is the thin
 * Obsidian wiring. Lives in a leaf, NOT a modal, per commitment #6.
 */

import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
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
  demoted: "arrow-down",
  reparented: "git-branch",
  "source-tombstoned": "trash",
  "source-restored": "undo-2",
  "source-renamed": "pencil",
  "element-deleted": "trash",
  "anchor-repaired": "wrench",
  "anchor-detached": "unlink",
};

export class IrSessionView extends ItemView {
  private store: IrStore;
  private sessionStartMs: number;
  private readonly onOpenEntry?: (elementId: string, notePath?: string) => void;

  constructor(
    leaf: WorkspaceLeaf,
    store: IrStore,
    sessionStartMs: number,
    onOpenEntry?: (elementId: string, notePath?: string) => void,
  ) {
    super(leaf);
    this.store = store;
    this.sessionStartMs = sessionStartMs;
    this.onOpenEntry = onOpenEntry;
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

  setSessionStart(ms: number): void {
    this.sessionStartMs = ms;
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
          "No IR actions yet in this review. Start a session (Alt+R / Alt+N), " +
          "then extract, grade, or postpone — this list is that pass.",
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
    li.setAttribute("role", "button");
    li.setAttribute("tabindex", "0");

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
      cls: "ir-session-label ir-session-link",
      text: entry.label,
    });
    const open = (): void => {
      this.onOpenEntry?.(entry.elementId, entry.notePath);
    };
    label.onclick = (ev) => {
      ev.stopPropagation();
      open();
    };
    li.addEventListener("click", () => open());
    li.addEventListener("keydown", (ev: KeyboardEvent) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        open();
      }
    });
  }
}
