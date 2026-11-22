import { ItemView, WorkspaceLeaf } from "obsidian";
import {
  mountPlacementPriorityInput,
  type PlacementPriorityOptions,
} from "./priority-prompt";

export const IR_PLACEMENT_PRIORITY_VIEW_TYPE = "ir-placement-priority-view";

export interface PlacementPriorityViewPrompt extends PlacementPriorityOptions {
  displayText?: string;
  icon?: string;
}

export class IrPlacementPriorityView extends ItemView {
  private prompt: PlacementPriorityViewPrompt | null = null;
  private handle: { cancel(): void } | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return IR_PLACEMENT_PRIORITY_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.prompt?.displayText ?? "IR priority";
  }

  getIcon(): string {
    return this.prompt?.icon ?? "sliders-horizontal";
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  async onClose(): Promise<void> {
    this.handle?.cancel();
    this.handle = null;
  }

  setPrompt(prompt: PlacementPriorityViewPrompt): void {
    this.handle?.cancel();
    this.prompt = prompt;
    this.render();
  }

  private render(): void {
    const container = this.contentEl;
    container.empty();
    container.addClass("ir-placement-priority-view");
    if (!this.prompt) {
      container.createEl("p", { text: "No action staged." });
      return;
    }
    const prompt = this.prompt;
    const surface = container.createDiv({ cls: "ir-placement-priority-surface" });
    this.handle = mountPlacementPriorityInput(surface, {
      ...prompt,
      onCommit: (priority) => {
        this.handle = null;
        prompt.onCommit(priority);
        this.leaf.detach();
      },
      onCancel: () => {
        this.handle = null;
        prompt.onCancel?.();
        this.leaf.detach();
      },
    });
  }
}
