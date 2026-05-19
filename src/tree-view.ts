import { ItemView, WorkspaceLeaf, TFile, setIcon, Notice } from "obsidian";

import { IrStore } from "./ir/store";
import { buildTree, TreeNode } from "./ir/tree";
import type { IrElement, IrType } from "./ir/model";

export const IR_TREE_VIEW_TYPE = "ir-tree-view";

const ICONS: Record<IrType, string> = {
  topic: "book-open",
  extract: "scissors",
  item: "brackets",
};

export class IrTreeView extends ItemView {
  private store: IrStore;

  constructor(leaf: WorkspaceLeaf, store: IrStore) {
    super(leaf);
    this.store = store;
  }

  getViewType(): string {
    return IR_TREE_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "IR element tree";
  }

  getIcon(): string {
    return "list-tree";
  }

  async onOpen(): Promise<void> {
    await this.render();
  }

  async onClose(): Promise<void> {}

  private async render(): Promise<void> {
    const container = this.contentEl;
    container.empty();
    container.addClass("ir-tree-view");

    const header = container.createDiv({ cls: "ir-tree-header" });
    header.createEl("h4", { text: "IR element tree" });
    const refresh = header.createEl("button", {
      text: "Refresh",
      cls: "ir-tree-refresh",
    });
    refresh.onclick = () => void this.render();

    const body = container.createDiv({ cls: "ir-tree-body" });

    let state;
    try {
      state = await this.store.load();
    } catch (e) {
      console.error("Incremental Reading: tree view load failed", e);
      body.createEl("p", {
        text:
          "Could not load the IR store. See the developer console.",
      });
      return;
    }

    const elements: IrElement[] = Array.from(state.elements.values()).filter(
      (e) => !e.dismissed,
    );
    if (elements.length === 0) {
      body.createEl("p", {
        text:
          "No IR elements yet. Mark a note as an IR topic to get started.",
      });
      return;
    }

    const roots = buildTree(elements);
    const ul = body.createEl("ul", { cls: "ir-tree-root" });
    for (const root of roots) {
      this.renderNode(ul, root);
    }
  }

  private renderNode(parent: HTMLElement, node: TreeNode): void {
    const li = parent.createEl("li", { cls: "ir-tree-node" });

    const row = li.createDiv({ cls: "ir-tree-row" });
    const iconSpan = row.createSpan({ cls: "ir-tree-icon" });
    setIcon(iconSpan, ICONS[node.type] ?? "circle");

    const label = labelFor(node.element);
    const titleEl = row.createSpan({
      cls: "ir-tree-title",
      text: label,
    });
    if (node.element.notePath) {
      titleEl.addClass("ir-tree-link");
      titleEl.onclick = () => void this.openNote(node.element.notePath!);
    }

    row.createSpan({
      cls: "ir-tree-priority",
      text: `p${node.element.priority}`,
    });
    row.createSpan({
      cls: "ir-tree-type",
      text: node.type,
    });

    if (node.children.length > 0) {
      const ul = li.createEl("ul", { cls: "ir-tree-children" });
      for (const child of node.children) {
        this.renderNode(ul, child);
      }
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

function labelFor(element: IrElement): string {
  if (element.notePath) {
    const base = element.notePath.split("/").pop() ?? element.notePath;
    return base.replace(/\.md$/i, "");
  }
  const text = element.text.trim().replace(/\s+/g, " ");
  if (text.length === 0) return `(${element.type})`;
  return text.length > 80 ? text.slice(0, 77) + "..." : text;
}
