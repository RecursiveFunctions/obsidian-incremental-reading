import { ItemView, WorkspaceLeaf, TFile, setIcon, Notice } from "obsidian";

import { IrStore } from "./ir/store";
import { buildTree, TreeNode } from "./ir/tree";
import { labelFor } from "./ir/labels";
import { clampPriority, type IrElement, type IrType } from "./ir/model";
import type { ElementId } from "./ir/ids";

export const IR_TREE_VIEW_TYPE = "ir-tree-view";

/** Persist priority to the append-only store + note frontmatter (dual-write). */
export type CommitIrPriorityFn = (
  elementId: ElementId,
  file: TFile | null,
  priority: number,
) => Promise<void>;

const ICONS: Record<IrType, string> = {
  topic: "book-open",
  extract: "scissors",
  item: "brackets",
};

export class IrTreeView extends ItemView {
  private store: IrStore;
  /**
   * Element ids the user has explicitly collapsed. Session-only state
   * (UI commitment #5: expand/collapse per node). Default = expanded.
   */
  private collapsed: Set<string> = new Set();

  constructor(
    leaf: WorkspaceLeaf,
    store: IrStore,
    private readonly commitPriority?: CommitIrPriorityFn,
  ) {
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

  /**
   * Expand every ancestor so the row is visible, re-render, then swap the
   * priority badge for the inline editor. Used by Alt+P (main.ts).
   *
   * @returns false when no IR element claims this vault path.
   */
  async revealPriorityEditorForNotePath(notePath: string): Promise<boolean> {
    const commitFn = this.commitPriority;
    if (!commitFn || !notePath) return false;

    let state;
    try {
      state = await this.store.load();
    } catch (e) {
      console.error("Incremental Reading: tree priority reveal load failed", e);
      return false;
    }

    let target: IrElement | null = null;
    for (const el of state.elements.values()) {
      if (el.notePath === notePath) {
        target = el;
        break;
      }
    }
    if (!target) return false;

    let cur: IrElement | undefined = target;
    while (cur?.parentId) {
      this.collapsed.delete(cur.parentId);
      cur = state.elements.get(cur.parentId);
    }

    await this.render();

    const wraps = Array.from(
      this.contentEl.querySelectorAll<HTMLElement>("[data-ir-element-id]"),
    );
    const priWrap = wraps.find(
      (w) => w.getAttribute("data-ir-element-id") === target!.id,
    );
    if (!priWrap) return false;

    const abs = target.notePath
      ? this.app.vault.getAbstractFileByPath(target.notePath)
      : null;
    const file = abs instanceof TFile ? abs : null;
    this.beginPriorityEdit(
      priWrap,
      target.id as ElementId,
      file,
      target.priority,
    );
    priWrap.closest(".ir-tree-node")?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
    return true;
  }

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
    const hasChildren = node.children.length > 0;
    const isCollapsed = this.collapsed.has(node.id);

    if (hasChildren) {
      const toggle = row.createSpan({ cls: "ir-tree-toggle" });
      setIcon(toggle, isCollapsed ? "chevron-right" : "chevron-down");
      toggle.setAttribute(
        "aria-label",
        isCollapsed ? "Expand subtree" : "Collapse subtree",
      );
      toggle.onclick = (e) => {
        e.stopPropagation();
        if (isCollapsed) this.collapsed.delete(node.id);
        else this.collapsed.add(node.id);
        void this.render();
      };
    } else {
      // Spacer keeps leaf rows aligned with their non-leaf siblings.
      row.createSpan({ cls: "ir-tree-toggle-empty" });
    }

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

    const notePath = node.element.notePath ?? "";
    const abs = notePath ? this.app.vault.getAbstractFileByPath(notePath) : null;
    const file = abs instanceof TFile ? abs : null;

    const priWrap = row.createSpan({
      cls: "ir-tree-priority-wrap",
      attr: {
        "data-ir-element-id": node.id,
        "data-ir-note-path": notePath,
        "data-ir-priority": String(node.element.priority),
      },
    });
    const priEl = priWrap.createSpan({
      cls: "ir-tree-priority",
      text: `p${node.element.priority}`,
    });
    if (this.commitPriority) {
      priEl.addClass("ir-tree-priority--clickable");
      priEl.setAttribute("role", "button");
      priEl.setAttribute("tabindex", "0");
      priEl.setAttribute("aria-label", "Edit IR priority");
      const startEdit = (ev: Event) => {
        ev.stopPropagation();
        this.beginPriorityEdit(
          priWrap,
          node.id as ElementId,
          file,
          node.element.priority,
        );
      };
      priEl.addEventListener("click", startEdit);
      priEl.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          startEdit(e);
        }
      });
    }

    row.createSpan({
      cls: "ir-tree-type",
      text: node.type,
    });

    if (hasChildren && !isCollapsed) {
      const ul = li.createEl("ul", { cls: "ir-tree-children" });
      for (const child of node.children) {
        this.renderNode(ul, child);
      }
    }
  }

  /**
   * Inline priority editor: click the `pNN` badge, edit, Enter or blur to
   * commit, Esc to cancel (docs/SCOPE-MODAL-REMOVAL.md phase B1).
   */
  private beginPriorityEdit(
    priWrap: HTMLElement,
    elementId: ElementId,
    file: TFile | null,
    initial: number,
  ): void {
    const commitFn = this.commitPriority;
    if (!commitFn) return;
    if (priWrap.querySelector("input")) return;

    priWrap.empty();
    const input = priWrap.createEl("input", {
      cls: "ir-tree-priority-input",
      type: "number",
    });
    input.min = "0";
    input.max = "100";
    input.step = "1";
    input.value = String(initial);

    let finished = false;
    const restore = () => {
      void this.render();
    };
    const cancel = () => {
      if (finished) return;
      finished = true;
      restore();
    };
    const commit = async () => {
      if (finished) return;
      finished = true;
      const n = Number(input.value);
      if (!Number.isFinite(n)) {
        restore();
        return;
      }
      const p = clampPriority(n);
      try {
        await commitFn(elementId, file, p);
      } catch (e) {
        console.error("Incremental Reading: tree priority commit failed", e);
        new Notice(
          "Incremental Reading: could not save priority. See the developer console.",
        );
      }
      void this.render();
    };

    input.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void commit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
    });
    input.addEventListener("blur", () => void commit());
    window.setTimeout(() => input.focus(), 0);
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
