/**
 * Side-panel View: mark the active note/PDF as an IR topic with an explicit
 * placement priority (#89). Non-modal per UI commitment #6.
 */

import { ItemView, WorkspaceLeaf, type TFile } from "obsidian";
import { mountPlacementPriorityInput } from "./priority-prompt";

export const IR_MARK_PRIORITY_VIEW_TYPE = "ir-mark-priority-view";

export interface MarkPriorityViewHost {
  defaultPriority: number;
  onMark: (file: TFile, priority: number) => Promise<void>;
  onCancel?: () => void;
}

export class IrMarkPriorityView extends ItemView {
  private file: TFile | null = null;
  private handle: { cancel(): void } | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly host: MarkPriorityViewHost,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return IR_MARK_PRIORITY_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Mark IR topic";
  }

  getIcon(): string {
    return "book-plus";
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  async onClose(): Promise<void> {
    this.handle?.cancel();
    this.handle = null;
  }

  setTarget(file: TFile): void {
    this.file = file;
    this.render();
  }

  private render(): void {
    const container = this.contentEl;
    container.empty();
    container.addClass("ir-mark-priority-view");
    if (!this.file) {
      container.createEl("p", {
        text: "No active Markdown note or PDF to mark.",
      });
      return;
    }
    const target = this.file;
    const surface = container.createDiv({ cls: "ir-placement-priority-surface" });
    this.handle = mountPlacementPriorityInput(surface, {
      initial: this.host.defaultPriority,
      title: `Mark “${target.basename}” as IR topic`,
      commitLabel: "Mark",
      useDefaultLabel: "Use default",
      onCommit: (priority) => {
        void this.host.onMark(target, priority);
      },
      onCancel: () => this.host.onCancel?.(),
    });
  }
}
