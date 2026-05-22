import {
  ItemView,
  Menu,
  Notice,
  Platform,
  TFile,
  WorkspaceLeaf,
  setIcon,
} from "obsidian";

import { IrStore } from "./ir/store";
import { buildTree, TreeNode } from "./ir/tree";
import { treeRowLabel } from "./ir/labels";
import { clampPriority, type IrElement, type IrType } from "./ir/model";
import type { ElementId } from "./ir/ids";
import { dueMsOf } from "./ir/queue-adapter";

export const IR_TREE_VIEW_TYPE = "ir-tree-view";

/** Persist priority to the append-only store + note frontmatter (dual-write). */
export type CommitIrPriorityFn = (
  elementId: ElementId,
  file: TFile | null,
  priority: number,
) => Promise<void>;

/** Toggle dismiss in the store + note frontmatter. */
export type CommitIrDismissFn = (
  elementId: ElementId,
  file: TFile | null,
  dismissed: boolean,
) => Promise<void>;

/** Postpone an element by N days in the store + note frontmatter. */
export type CommitIrPostponeFn = (
  elementId: ElementId,
  file: TFile | null,
  days: number,
) => Promise<void>;

/** Move an element to a new parent in the store. */
export type CommitIrReparentFn = (
  elementId: ElementId,
  newParentId: ElementId | null,
) => Promise<void>;

/** Delete an element from the store, reparenting its children. */
export type CommitIrDeleteFn = (
  elementId: ElementId,
  parentId: ElementId | null,
) => Promise<void>;

/** Promote an extract to a standalone note. */
export type CommitIrPromoteFn = (
  elementId: ElementId,
  element: IrElement,
) => Promise<void>;

/** Attempt to re-anchor a drifted extract against its current source. */
export type CommitIrReanchorFn = (
  elementId: ElementId,
  element: IrElement,
) => Promise<boolean>;

const ICONS: Record<IrType, string> = {
  topic: "book-open",
  extract: "scissors",
  item: "brackets",
};

import { formatDueLabel } from "./ir/due-label";
export { formatDueLabel };

export class IrTreeView extends ItemView {
  private store: IrStore;
  /**
   * Element ids the user has explicitly collapsed. Session-only state
   * (UI commitment #5: expand/collapse per node). Default = expanded.
   */
  private collapsed: Set<string> = new Set();

  /** When true, dismissed elements are visible with a restore action. */
  private showDismissed = false;

  /** Current search/filter text (case-insensitive substring match). */
  private filterText = "";

  /** Element id currently being dragged (session-only). */
  private dragSourceId: string | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    store: IrStore,
    private readonly commitPriority?: CommitIrPriorityFn,
    private readonly commitDismiss?: CommitIrDismissFn,
    private readonly commitPostpone?: CommitIrPostponeFn,
    private readonly commitReparent?: CommitIrReparentFn,
    private readonly commitDelete?: CommitIrDeleteFn,
    private readonly commitPromote?: CommitIrPromoteFn,
    private readonly commitReanchor?: CommitIrReanchorFn,
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
    if (Platform.isMobile) {
      container.addClass("ir-tree--mobile");
    }

    const header = container.createDiv({ cls: "ir-tree-header" });
    header.createEl("h4", { text: "IR element tree" });

    const actions = header.createDiv({ cls: "ir-tree-actions" });
    const expandAll = actions.createEl("button", {
      cls: "ir-tree-refresh",
      attr: { "aria-label": "Expand all" },
    });
    setIcon(expandAll, "chevrons-down-up");
    expandAll.onclick = () => {
      this.collapsed.clear();
      void this.render();
    };
    const collapseAll = actions.createEl("button", {
      cls: "ir-tree-refresh",
      attr: { "aria-label": "Collapse all" },
    });
    setIcon(collapseAll, "chevrons-up-down");
    collapseAll.onclick = () => {
      for (const id of this.lastNodeIds) this.collapsed.add(id);
      void this.render();
    };

    const dismissToggle = actions.createEl("button", {
      cls: "ir-tree-refresh",
      text: this.showDismissed ? "Hide dismissed" : "Show dismissed",
    });
    dismissToggle.onclick = () => {
      this.showDismissed = !this.showDismissed;
      void this.render();
    };

    const refresh = actions.createEl("button", {
      text: "Refresh",
      cls: "ir-tree-refresh",
    });
    refresh.onclick = () => void this.render();

    const searchRow = container.createDiv({ cls: "ir-tree-search" });
    const searchInput = searchRow.createEl("input", {
      cls: "ir-tree-search-input",
      type: "search",
      placeholder: "Filter elements\u2026",
    });
    searchInput.value = this.filterText;
    searchInput.addEventListener("input", () => {
      this.filterText = searchInput.value;
      void this.render();
    });
    if (this.filterText) {
      requestAnimationFrame(() => {
        searchInput.focus();
        searchInput.setSelectionRange(
          searchInput.value.length,
          searchInput.value.length,
        );
      });
    }

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

    const allElements = Array.from(state.elements.values());
    const elements = this.showDismissed
      ? allElements
      : allElements.filter((e) => !e.dismissed);
    const dismissedCount = allElements.filter((e) => e.dismissed).length;

    if (elements.length === 0) {
      body.createEl("p", {
        text: dismissedCount > 0
          ? `No active IR elements. ${dismissedCount} dismissed (toggle above).`
          : "No IR elements yet. Mark a note as an IR topic to get started.",
      });
      return;
    }

    let roots = buildTree(elements);
    if (this.filterText.trim()) {
      roots = this.filterTree(roots, this.filterText.trim().toLowerCase());
      if (roots.length === 0) {
        body.createEl("p", {
          cls: "ir-tree-empty-filter",
          text: `No elements matching "${this.filterText.trim()}".`,
        });
        this.lastNodeIds = new Set();
        this.lastRenderedRoots = [];
        return;
      }
      for (const id of this.lastNodeIds) this.collapsed.delete(id);
    }
    this.lastNodeIds = this.collectNodeIds(roots);
    this.lastRenderedRoots = roots;

    if (this.commitReparent) {
      const dropRoot = body.createDiv({ cls: "ir-tree-drop-root" });
      dropRoot.setText("Drop here to make a root element");
      dropRoot.addEventListener("dragover", (e) => {
        if (!this.dragSourceId) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        dropRoot.addClass("ir-tree-drop-root--active");
      });
      dropRoot.addEventListener("dragleave", () => {
        dropRoot.removeClass("ir-tree-drop-root--active");
      });
      dropRoot.addEventListener("drop", (e) => {
        e.preventDefault();
        dropRoot.removeClass("ir-tree-drop-root--active");
        const sourceId = this.dragSourceId;
        if (!sourceId) return;
        this.dragSourceId = null;
        void (async () => {
          try {
            await this.commitReparent!(sourceId as ElementId, null);
          } catch (err) {
            console.error("Incremental Reading: reparent to root failed", err);
            new Notice("Incremental Reading: could not move element.");
          }
          void this.render();
        })();
      });
    }

    const ul = body.createEl("ul", { cls: "ir-tree-root" });
    for (const root of roots) {
      this.renderNode(ul, root);
    }
  }

  private lastNodeIds: Set<string> = new Set();
  private lastRenderedRoots: TreeNode[] = [];

  /**
   * Return a pruned copy of the tree keeping only nodes whose label matches
   * the query (case-insensitive) plus all ancestors needed to reach them.
   */
  private filterTree(roots: TreeNode[], query: string): TreeNode[] {
    const filter = (node: TreeNode): TreeNode | null => {
      const label = treeRowLabel(node.element).toLowerCase();
      const selfMatch = label.includes(query);
      const filteredChildren = node.children
        .map(filter)
        .filter((c): c is TreeNode => c !== null);
      if (selfMatch || filteredChildren.length > 0) {
        return { ...node, children: filteredChildren };
      }
      return null;
    };
    return roots
      .map(filter)
      .filter((r): r is TreeNode => r !== null);
  }

  private collectNodeIds(nodes: TreeNode[]): Set<string> {
    const ids = new Set<string>();
    const walk = (n: TreeNode) => {
      if (n.children.length > 0) ids.add(n.id);
      for (const c of n.children) walk(c);
    };
    for (const r of nodes) walk(r);
    return ids;
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

    const label = treeRowLabel(node.element);
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

    const dueMs = dueMsOf(node.element);
    if (Number.isFinite(dueMs)) {
      const dueLabel = formatDueLabel(dueMs, Date.now());
      const dueEl = row.createSpan({
        cls: "ir-tree-due",
        text: dueLabel,
      });
      if (dueMs <= Date.now()) dueEl.addClass("ir-tree-due--now");
    }

    row.createSpan({
      cls: "ir-tree-type",
      text: node.type,
    });

    if (node.element.anchorState === "needs-reanchor") {
      const badge = row.createSpan({ cls: "ir-tree-anchor-badge ir-tree-anchor-badge--warn" });
      setIcon(badge, "alert-triangle");
      badge.setAttribute("aria-label", "Anchor needs re-resolution");
    } else if (node.element.anchorState === "detached") {
      const badge = row.createSpan({ cls: "ir-tree-anchor-badge ir-tree-anchor-badge--detached" });
      setIcon(badge, "unlink");
      badge.setAttribute("aria-label", "Source deleted; element survives on stored text");
    }

    if (node.element.dismissed && this.commitDismiss) {
      row.addClass("ir-tree-row--dismissed");
      const restoreBtn = row.createEl("button", {
        cls: "ir-tree-restore-btn",
        text: "Restore",
      });
      restoreBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        void (async () => {
          try {
            await this.commitDismiss!(node.id as ElementId, file, false);
          } catch (err) {
            console.error("Incremental Reading: restore failed", err);
            new Notice("Incremental Reading: could not restore. See the developer console.");
          }
          void this.render();
        })();
      });
    } else if (node.element.dismissed) {
      row.addClass("ir-tree-row--dismissed");
      row.createSpan({ cls: "ir-tree-dismissed-badge", text: "dismissed" });
    }

    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.showRowContextMenu(e, node, file);
    });

    if (this.commitReparent) {
      row.draggable = true;
      row.setAttribute("data-ir-drag-id", node.id);

      row.addEventListener("dragstart", (e) => {
        this.dragSourceId = node.id;
        e.dataTransfer?.setData("text/plain", node.id);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
        requestAnimationFrame(() => row.addClass("ir-tree-row--dragging"));
      });
      row.addEventListener("dragend", () => {
        this.dragSourceId = null;
        this.contentEl
          .querySelectorAll(".ir-tree-row--dragging, .ir-tree-row--drop-target")
          .forEach((el) => {
            el.removeClass("ir-tree-row--dragging");
            el.removeClass("ir-tree-row--drop-target");
          });
      });
      row.addEventListener("dragover", (e) => {
        if (!this.dragSourceId || this.dragSourceId === node.id) return;
        if (this.isDescendantOf(this.dragSourceId, node.id)) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        row.addClass("ir-tree-row--drop-target");
      });
      row.addEventListener("dragleave", () => {
        row.removeClass("ir-tree-row--drop-target");
      });
      row.addEventListener("drop", (e) => {
        e.preventDefault();
        row.removeClass("ir-tree-row--drop-target");
        const sourceId = this.dragSourceId;
        if (!sourceId || sourceId === node.id) return;
        if (this.isDescendantOf(sourceId, node.id)) return;
        this.dragSourceId = null;
        void (async () => {
          try {
            await this.commitReparent!(
              sourceId as ElementId,
              node.id as ElementId,
            );
          } catch (err) {
            console.error("Incremental Reading: reparent failed", err);
            new Notice("Incremental Reading: could not move element.");
          }
          void this.render();
        })();
      });
    }

    if (hasChildren && !isCollapsed) {
      const ul = li.createEl("ul", { cls: "ir-tree-children" });
      for (const child of node.children) {
        this.renderNode(ul, child);
      }
    }
  }

  /** Check if `candidateAncestorId` is an ancestor of `nodeId` in the current tree. */
  private isDescendantOf(candidateAncestorId: string, nodeId: string): boolean {
    const find = (nodes: TreeNode[], target: string): TreeNode | undefined => {
      for (const n of nodes) {
        if (n.id === target) return n;
        const found = find(n.children, target);
        if (found) return found;
      }
      return undefined;
    };
    const subtreeContains = (node: TreeNode, id: string): boolean => {
      if (node.id === id) return true;
      return node.children.some((c) => subtreeContains(c, id));
    };
    const roots = this.lastRenderedRoots;
    const ancestor = find(roots, candidateAncestorId);
    if (!ancestor) return false;
    return subtreeContains(ancestor, nodeId);
  }

  private showRowContextMenu(
    e: MouseEvent,
    node: TreeNode,
    file: TFile | null,
  ): void {
    const menu = new Menu();
    const elId = node.id as ElementId;

    if (node.element.notePath) {
      menu.addItem((item) =>
        item
          .setTitle("Open note")
          .setIcon("file-text")
          .onClick(() => void this.openNote(node.element.notePath!)),
      );
    }

    if (this.commitDismiss) {
      const isDismissed = node.element.dismissed;
      menu.addItem((item) =>
        item
          .setTitle(isDismissed ? "Restore" : "Dismiss")
          .setIcon(isDismissed ? "rotate-ccw" : "eye-off")
          .onClick(() => {
            void (async () => {
              try {
                await this.commitDismiss!(elId, file, !isDismissed);
              } catch (err) {
                console.error("Incremental Reading: dismiss toggle failed", err);
                new Notice("Incremental Reading: could not toggle dismiss.");
              }
              void this.render();
            })();
          }),
      );
    }

    if (this.commitPostpone && !node.element.dismissed) {
      for (const days of [1, 3, 7, 14, 30]) {
        const label = days === 1 ? "1 day" : `${days} days`;
        menu.addItem((item) =>
          item
            .setTitle(`Postpone ${label}`)
            .setIcon("clock")
            .onClick(() => {
              void (async () => {
                try {
                  await this.commitPostpone!(elId, file, days);
                } catch (err) {
                  console.error("Incremental Reading: postpone failed", err);
                  new Notice("Incremental Reading: could not postpone.");
                }
                void this.render();
              })();
            }),
        );
      }
    }

    if (
      this.commitPromote &&
      node.element.type === "extract" &&
      !node.element.notePath
    ) {
      menu.addItem((item) =>
        item
          .setTitle("Promote to standalone note")
          .setIcon("file-plus")
          .onClick(() => {
            void (async () => {
              try {
                await this.commitPromote!(elId, node.element);
              } catch (err) {
                console.error("Incremental Reading: promote failed", err);
                new Notice("Incremental Reading: could not promote extract.");
              }
              void this.render();
            })();
          }),
      );
    }

    if (
      this.commitReanchor &&
      node.element.anchor &&
      node.element.anchorState === "needs-reanchor"
    ) {
      menu.addItem((item) =>
        item
          .setTitle("Re-anchor to source")
          .setIcon("anchor")
          .onClick(() => {
            void (async () => {
              try {
                const ok = await this.commitReanchor!(elId, node.element);
                if (ok) {
                  new Notice("Anchor repaired.");
                } else {
                  new Notice("Could not re-anchor: text not found in source.");
                }
              } catch (err) {
                console.error("Incremental Reading: re-anchor failed", err);
                new Notice("Incremental Reading: could not re-anchor.");
              }
              void this.render();
            })();
          }),
      );
    }

    if (this.commitDelete) {
      menu.addSeparator();
      menu.addItem((item) =>
        item
          .setTitle("Delete element")
          .setIcon("trash-2")
          .onClick(() => {
            const childCount = node.children.length;
            const msg = childCount > 0
              ? `Delete "${treeRowLabel(node.element)}"? Its ${childCount} child${childCount !== 1 ? "ren" : ""} will be reparented to its parent.`
              : `Delete "${treeRowLabel(node.element)}"?`;
            if (!confirm(msg)) return;
            void (async () => {
              try {
                await this.commitDelete!(elId, node.element.parentId);
              } catch (err) {
                console.error("Incremental Reading: delete failed", err);
                new Notice("Incremental Reading: could not delete element.");
              }
              void this.render();
            })();
          }),
      );
    }

    menu.showAtMouseEvent(e);
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
