/**
 * Side-panel View: extract the current selection with an explicit child
 * placement priority (#91). Parent A-Factor decay stays unchanged.
 */

import { ItemView, WorkspaceLeaf } from "obsidian";
import { formatPriority } from "./ir/relative-priority";
import { mountPlacementPriorityInput } from "./priority-prompt";

export const IR_EXTRACT_PRIORITY_VIEW_TYPE = "ir-extract-priority-view";

export interface ExtractPriorityRequest {
  /** Computed child priority from parent spread (Use computed). */
  computedPriority: number;
  defaultPriority: number;
  label: string;
  onExtract: (priority: number) => Promise<void>;
  onCancel?: () => void;
}

export class IrExtractPriorityView extends ItemView {
  private request: ExtractPriorityRequest | null = null;
  private handle: { cancel(): void } | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return IR_EXTRACT_PRIORITY_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Extract with priority";
  }

  getIcon(): string {
    return "scissors";
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  async onClose(): Promise<void> {
    this.handle?.cancel();
    this.handle = null;
  }

  setRequest(request: ExtractPriorityRequest): void {
    this.request = request;
    this.render();
  }

  private render(): void {
    const container = this.contentEl;
    container.empty();
    container.addClass("ir-extract-priority-view");
    if (!this.request) {
      container.createEl("p", {
        text: "No extract selection staged.",
      });
      return;
    }
    const req = this.request;
    const surface = container.createDiv({ cls: "ir-placement-priority-surface" });
    this.handle = mountPlacementPriorityInput(surface, {
      initial: req.defaultPriority,
      title: `Extract “${req.label}” with priority`,
      commitLabel: "Extract",
      useDefaultLabel: "Use default",
      useComputed: {
        label: `Use computed (${formatPriority(req.computedPriority)})`,
        value: req.computedPriority,
      },
      onCommit: (priority) => {
        void req.onExtract(priority);
      },
      onCancel: () => req.onCancel?.(),
    });
  }
}
