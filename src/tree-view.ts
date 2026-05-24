import {
  ItemView,
  Menu,
  Notice,
  Platform,
  TFile,
  WorkspaceLeaf,
  setIcon,
} from "obsidian";

import type { LogState } from "./ir/log";
import { IrStore } from "./ir/store";
import {
  buildTree,
  filterTreeByPredicate,
  rangeSelectIds,
  TreeNode,
} from "./ir/tree";
import { treeRowLabel } from "./ir/labels";
import { clampPriority, type IrElement, type IrType } from "./ir/model";
import type { ElementId } from "./ir/ids";
import { dueMsOf } from "./ir/queue-adapter";
import { findExtractEditorPosition } from "./ir/extract-range";
import { saveBody, stripFrontmatter } from "./ir/frontmatter-body";
import { hasCloze, listClozeGroups, setClozeHint } from "./cloze";

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

/** Fork a store extract (second reading element). */
export type CommitIrForkFn = (elementId: ElementId) => void | Promise<void>;

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

  /**
   * Element types currently visible. All three on means "no type filter".
   * Persisted only for the lifetime of the view (session-only); rebuilt on
   * each open. Click a chip in the header to toggle.
   */
  private visibleTypes: Set<IrType> = new Set([
    "topic",
    "extract",
    "item",
  ]);

  /**
   * Currently multi-selected row ids, session-only. Cmd/Ctrl+click toggles
   * a row in/out; Shift+click sets the selection to the inclusive range
   * from `selectionAnchorId` to the clicked row in visible-tree order. The
   * selection toolbar appears whenever this is non-empty.
   *
   * Pruned at the top of every `render()` to drop ids whose elements were
   * deleted between renders, so a stale id from a previous view of the
   * tree never lingers.
   */
  private selectedIds: Set<string> = new Set();
  private selectionAnchorId: string | null = null;

  /** Element id currently being dragged (session-only). */
  private dragSourceId: string | null = null;

  /**
   * Element id under review right now (set by the review pane). When set,
   * the matching row gets highlighted and scrolled into view so the user
   * can see their position in the tree while reviewing.
   */
  private currentElementId: ElementId | null = null;

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
    private readonly forkExtract?: CommitIrForkFn,
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
   * Called by the review pane when the current slot changes. We expand
   * ancestors so the row is visible, then re-render to apply the highlight.
   * Pass `null` when review closes.
   */
  async setCurrentElementId(id: ElementId | null): Promise<void> {
    this.currentElementId = id;
    if (id) {
      try {
        const state = await this.store.load();
        let cur = state.elements.get(id);
        while (cur?.parentId) {
          this.collapsed.delete(cur.parentId);
          cur = state.elements.get(cur.parentId);
        }
      } catch (e) {
        console.error("Incremental Reading: tree current-id expand failed", e);
      }
    }
    await this.render();
    if (id) this.scrollCurrentIntoView();
  }

  private scrollCurrentIntoView(): void {
    const row = this.contentEl.querySelector<HTMLElement>(
      ".ir-tree-row--current",
    );
    if (row) row.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

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

    const typeRow = container.createDiv({ cls: "ir-tree-type-filter" });
    typeRow.setAttribute("role", "group");
    typeRow.setAttribute("aria-label", "Filter by element type");
    const TYPE_LABELS: Record<IrType, string> = {
      topic: "Topics",
      extract: "Extracts",
      item: "Cloze items",
    };
    for (const t of ["topic", "extract", "item"] as const) {
      const active = this.visibleTypes.has(t);
      const chip = typeRow.createEl("button", {
        cls: active
          ? "ir-tree-type-chip ir-tree-type-chip--active"
          : "ir-tree-type-chip",
        text: TYPE_LABELS[t],
        attr: {
          type: "button",
          "aria-pressed": active ? "true" : "false",
        },
      });
      chip.addEventListener("click", () => {
        if (this.visibleTypes.has(t)) {
          // Refuse to deselect the last remaining type — leaving zero means
          // "show nothing", which is never what the user wants and is
          // indistinguishable from an empty store. Clicking the only-active
          // chip instead resets to all types on, matching the typical
          // pill-group convention.
          if (this.visibleTypes.size === 1) {
            this.visibleTypes = new Set(["topic", "extract", "item"]);
          } else {
            this.visibleTypes.delete(t);
          }
        } else {
          this.visibleTypes.add(t);
        }
        void this.render();
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

    this.maskSpoilers = this.currentElementId !== null;
    this.itemBodies = await this.loadItemBodies(elements);

    // Drop selection ids whose elements were deleted between renders. We
    // walk all elements (not just visible/non-dismissed) so toggling
    // showDismissed doesn't silently shrink the selection.
    const validIds = new Set(allElements.map((e) => e.id));
    for (const id of Array.from(this.selectedIds)) {
      if (!validIds.has(id as ElementId)) {
        this.selectedIds.delete(id);
        if (this.selectionAnchorId === id) this.selectionAnchorId = null;
      }
    }

    let roots = buildTree(elements);
    const queryRaw = this.filterText.trim();
    const query = queryRaw.toLowerCase();
    const hasTextFilter = queryRaw.length > 0;
    const hasTypeFilter = this.visibleTypes.size < 3;
    if (hasTextFilter || hasTypeFilter) {
      roots = filterTreeByPredicate(roots, (node) => {
        if (!this.visibleTypes.has(node.type)) return false;
        if (!hasTextFilter) return true;
        return this.rowLabel(node.element).toLowerCase().includes(query);
      });
      if (roots.length === 0) {
        body.createEl("p", {
          cls: "ir-tree-empty-filter",
          text: this.emptyFilterMessage(queryRaw, hasTypeFilter),
        });
        this.lastNodeIds = new Set();
        this.lastRenderedRoots = [];
        return;
      }
      for (const id of this.lastNodeIds) this.collapsed.delete(id);
    }
    this.lastNodeIds = this.collectNodeIds(roots);
    this.lastRenderedRoots = roots;

    if (this.selectedIds.size > 0) {
      this.renderSelectionToolbar(body, state);
    }

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
   * Whether the current render should hide cloze answers / extract source
   * text behind a neutral label. Refreshed at the top of each render based
   * on whether an IR review pane is open.
   */
  private maskSpoilers = false;

  /**
   * Cloze item note bodies (frontmatter stripped) keyed by element id. Two
   * UI features depend on it: (1) masked rows render the cloze question with
   * its answer redacted to `____`; (2) the row context menu offers
   * "Edit cloze hint(s)" only for items that actually contain `{{cN::…}}`
   * syntax. Populated at the top of every render via `vault.cachedRead`, so
   * the cost is bounded by the number of cloze items and shared with
   * Obsidian's read cache.
   */
  private itemBodies: Map<string, string> = new Map();

  /**
   * Read each cloze item's note body once per render so masked rows can show
   * the question with its answer redacted (`A is defined as ____`) instead
   * of the neutral `Cloze item (xxxxxx)` placeholder. Bodies are fetched in
   * parallel via `cachedRead`, which is in-memory after the first hit, so
   * this is essentially free on subsequent renders. Items whose note can't
   * be resolved (deleted, store-only, missing) silently fall through to the
   * placeholder via the helper in `labels.ts`.
   */
  private async loadItemBodies(
    elements: IrElement[],
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const items = elements.filter(
      (e) => e.type === "item" && !e.dismissed && e.notePath,
    );
    await Promise.all(
      items.map(async (e) => {
        try {
          const file = this.app.vault.getAbstractFileByPath(e.notePath!);
          if (!(file instanceof TFile)) return;
          const raw = await this.app.vault.cachedRead(file);
          const body = stripFrontmatter(raw);
          if (hasCloze(body)) out.set(e.id, body);
        } catch (err) {
          console.error(
            "Incremental Reading: tree masked-cloze body load failed",
            err,
          );
        }
      }),
    );
    return out;
  }

  private rowLabel(el: IrElement): string {
    return treeRowLabel(el, this.maskSpoilers, this.itemBodies.get(el.id));
  }

  /**
   * Pre-order walk of the currently-rendered tree, collapsed-children
   * excluded. Used by shift+click to define what "the range from anchor to
   * here" means in the user's visual model.
   */
  private visibleNodeOrder(): string[] {
    const out: string[] = [];
    const walk = (n: TreeNode): void => {
      out.push(n.id);
      if (this.collapsed.has(n.id)) return;
      for (const c of n.children) walk(c);
    };
    for (const r of this.lastRenderedRoots) walk(r);
    return out;
  }

  private toggleRowSelection(id: string): void {
    if (this.selectedIds.has(id)) {
      this.selectedIds.delete(id);
      // The anchor must always belong to the live selection so the next
      // shift-click extends from a meaningful row. Pick any remaining
      // selected id when the deleted one was the anchor; ordering doesn't
      // matter here because the next shift-click resets it anyway.
      if (this.selectionAnchorId === id) {
        this.selectionAnchorId = this.selectedIds.values().next().value ?? null;
      }
    } else {
      this.selectedIds.add(id);
      this.selectionAnchorId = id;
    }
  }

  private extendRowSelectionTo(id: string): void {
    if (this.selectionAnchorId === null) {
      // No anchor yet: shift+click as the first selection gesture is
      // treated as a plain toggle so the user gets a sensible selection
      // immediately rather than a no-op.
      this.toggleRowSelection(id);
      return;
    }
    const range = rangeSelectIds(
      this.visibleNodeOrder(),
      this.selectionAnchorId,
      id,
    );
    // Replace (rather than union with) any prior selection: shift+click is
    // "select range", not "add range". Cmd+click handles additive cases.
    this.selectedIds = new Set(range);
  }

  /**
   * Action bar that floats above the tree contents whenever the user has
   * one or more rows multi-selected. We compute counts up front so we can
   * decide which buttons make sense — e.g. only show "Restore" if at least
   * one selected row is currently dismissed.
   */
  private renderSelectionToolbar(parent: HTMLElement, state: LogState): void {
    const ids = Array.from(this.selectedIds) as ElementId[];
    const els: IrElement[] = [];
    for (const id of ids) {
      const el = state.elements.get(id);
      if (el) els.push(el);
    }
    if (els.length === 0) return;

    const activeCount = els.filter((e) => !e.dismissed).length;
    const dismissedCount = els.filter((e) => e.dismissed).length;

    const bar = parent.createDiv({ cls: "ir-tree-selection-bar" });
    bar.createSpan({
      cls: "ir-tree-selection-bar-count",
      text: `${els.length} selected`,
    });
    const actions = bar.createDiv({ cls: "ir-tree-selection-bar-actions" });

    if (this.commitDismiss && activeCount > 0) {
      const btn = actions.createEl("button", {
        cls: "ir-tree-selection-bar-btn",
        text: activeCount === els.length
          ? "Dismiss"
          : `Dismiss ${activeCount}`,
      });
      btn.addEventListener("click", () => void this.bulkDismiss(true, ids));
    }
    if (this.commitDismiss && dismissedCount > 0) {
      const btn = actions.createEl("button", {
        cls: "ir-tree-selection-bar-btn",
        text: dismissedCount === els.length
          ? "Restore"
          : `Restore ${dismissedCount}`,
      });
      btn.addEventListener("click", () => void this.bulkDismiss(false, ids));
    }
    if (this.commitPostpone && activeCount > 0) {
      const btn = actions.createEl("button", {
        cls: "ir-tree-selection-bar-btn",
        text: "Postpone\u2026",
      });
      btn.addEventListener("click", (e) => {
        // Reuse the per-row postpone increments so single-row and bulk
        // mental models match. Anchor the popup to the click event so the
        // dropdown lands under the button on every screen size.
        const menu = new Menu();
        for (const days of [1, 3, 7, 14, 30]) {
          const label = days === 1 ? "1 day" : `${days} days`;
          menu.addItem((item) =>
            item
              .setTitle(`Postpone ${label}`)
              .setIcon("clock")
              .onClick(() => void this.bulkPostpone(days, ids)),
          );
        }
        menu.showAtMouseEvent(e);
      });
    }
    if (this.commitDelete) {
      const btn = actions.createEl("button", {
        cls: "ir-tree-selection-bar-btn mod-warning",
        text: "Delete",
      });
      btn.addEventListener("click", () => void this.bulkDelete(ids));
    }
    const clear = actions.createEl("button", {
      cls: "ir-tree-selection-bar-btn",
      text: "Clear",
    });
    clear.addEventListener("click", () => {
      this.selectedIds.clear();
      this.selectionAnchorId = null;
      void this.render();
    });
  }

  /**
   * Resolve an element id back to its (TFile | null) for the commit hooks.
   * Bulk methods must re-load state to read the current note paths because
   * earlier iterations of the same loop may have moved/renamed things;
   * `state` is a snapshot from the moment the bulk action started.
   */
  private fileForElement(state: LogState, id: ElementId): TFile | null {
    const el = state.elements.get(id);
    if (!el?.notePath) return null;
    const abs = this.app.vault.getAbstractFileByPath(el.notePath);
    return abs instanceof TFile ? abs : null;
  }

  private async bulkDismiss(
    dismissed: boolean,
    ids: ElementId[],
  ): Promise<void> {
    if (!this.commitDismiss) return;
    const state = await this.store.load();
    let ok = 0;
    let fail = 0;
    for (const id of ids) {
      const el = state.elements.get(id);
      if (!el) continue;
      if (el.dismissed === dismissed) continue;
      try {
        await this.commitDismiss(id, this.fileForElement(state, id), dismissed);
        ok += 1;
      } catch (err) {
        console.error("Incremental Reading: bulk dismiss failed", err);
        fail += 1;
      }
    }
    new Notice(this.bulkSummary(dismissed ? "Dismissed" : "Restored", ok, fail));
    this.selectedIds.clear();
    this.selectionAnchorId = null;
    void this.render();
  }

  private async bulkPostpone(days: number, ids: ElementId[]): Promise<void> {
    if (!this.commitPostpone) return;
    const state = await this.store.load();
    let ok = 0;
    let fail = 0;
    for (const id of ids) {
      const el = state.elements.get(id);
      if (!el || el.dismissed) continue;
      try {
        await this.commitPostpone(id, this.fileForElement(state, id), days);
        ok += 1;
      } catch (err) {
        console.error("Incremental Reading: bulk postpone failed", err);
        fail += 1;
      }
    }
    new Notice(
      this.bulkSummary(`Postponed ${days}d`, ok, fail),
    );
    this.selectedIds.clear();
    this.selectionAnchorId = null;
    void this.render();
  }

  private async bulkDelete(ids: ElementId[]): Promise<void> {
    if (!this.commitDelete) return;
    if (ids.length === 0) return;
    if (
      !confirm(
        `Delete ${ids.length} selected element${ids.length !== 1 ? "s" : ""}? Their children will be reparented.`,
      )
    ) {
      return;
    }
    const state = await this.store.load();
    let ok = 0;
    let fail = 0;
    for (const id of ids) {
      const el = state.elements.get(id);
      if (!el) continue;
      try {
        await this.commitDelete(id, el.parentId);
        ok += 1;
      } catch (err) {
        console.error("Incremental Reading: bulk delete failed", err);
        fail += 1;
      }
    }
    new Notice(this.bulkSummary("Deleted", ok, fail));
    this.selectedIds.clear();
    this.selectionAnchorId = null;
    void this.render();
  }

  private bulkSummary(verb: string, ok: number, fail: number): string {
    if (fail > 0) {
      return `Incremental Reading: ${verb.toLowerCase()} ${ok}, ${fail} failed.`;
    }
    return `Incremental Reading: ${verb.toLowerCase()} ${ok}.`;
  }

  /**
   * Open an inline panel below `li` that lets the user edit every cloze
   * group's hint in the item's note. Opens at most once per row; clicking
   * the menu entry again while the panel is open is a no-op (otherwise we
   * would lose unsaved input from the first invocation).
   *
   * Reads the note body fresh on entry rather than relying on
   * `this.itemBodies`: that map is rendered-time stale and might predate a
   * recent edit. Saves go through `saveBody`, which preserves frontmatter
   * verbatim, so this is safe to call on items that have YAML metadata.
   *
   * UX shape: a labeled row per cloze group (`c1: <answer-preview>` plus an
   * input pre-filled with the current hint, or empty if there is none),
   * Save/Cancel buttons, focus on the first input. Esc cancels, Enter on
   * the last input saves; intermediate Enters move focus forward. The
   * row's spoiler-masking state is unaffected: the answer preview is the
   * point of editing here, and the user already saw it via the context
   * menu interaction.
   *
   * Trade-off vs a Modal: lives in the tree DOM so users can see other
   * rows while editing, and a tree re-render disposes the panel along
   * with everything else (we accept that drop-on-rerender is loss of
   * unsaved input — acceptable for v1; auto-saves on the keyboard path
   * are the right follow-up if it bites).
   */
  private async beginHintEdit(
    li: HTMLElement,
    node: TreeNode,
    file: TFile,
  ): Promise<void> {
    if (li.querySelector(".ir-tree-hint-editor")) return;

    let raw: string;
    try {
      raw = await this.app.vault.cachedRead(file);
    } catch (err) {
      console.error("Incremental Reading: hint edit read failed", err);
      new Notice("Incremental Reading: could not read note body.");
      return;
    }
    const body = stripFrontmatter(raw);
    const groups = listClozeGroups(body);
    if (groups.length === 0) {
      new Notice(
        "Incremental Reading: this item has no cloze syntax to edit.",
      );
      return;
    }

    const panel = createDiv({ cls: "ir-tree-hint-editor" });
    const rowEl = li.querySelector(".ir-tree-row");
    if (rowEl?.nextSibling) li.insertBefore(panel, rowEl.nextSibling);
    else li.appendChild(panel);

    panel.createEl("div", {
      cls: "ir-tree-hint-editor-header",
      text: groups.length === 1 ? "Edit cloze hint" : "Edit cloze hints",
    });

    const inputs: { n: number; el: HTMLInputElement }[] = [];
    for (const g of groups) {
      const grp = panel.createDiv({ cls: "ir-tree-hint-editor-row" });
      grp.createSpan({
        cls: "ir-tree-hint-editor-tag",
        text: `c${g.n}`,
      });
      const ans = g.answer.length > 30 ? g.answer.slice(0, 27) + "\u2026" : g.answer;
      grp.createSpan({
        cls: "ir-tree-hint-editor-answer",
        text: ans,
        attr: { title: g.answer },
      });
      const input = grp.createEl("input", {
        cls: "ir-tree-hint-editor-input",
        type: "text",
        attr: { placeholder: "hint (optional)" },
      });
      input.value = g.hint ?? "";
      inputs.push({ n: g.n, el: input });
    }

    const buttons = panel.createDiv({ cls: "ir-tree-hint-editor-buttons" });
    const save = buttons.createEl("button", {
      cls: "mod-cta ir-tree-hint-editor-save",
      text: "Save",
    });
    const cancel = buttons.createEl("button", {
      cls: "ir-tree-hint-editor-cancel",
      text: "Cancel",
    });

    let saving = false;
    const close = (): void => {
      panel.remove();
    };
    const doSave = (): void => {
      if (saving) return;
      saving = true;
      void (async () => {
        let next = body;
        for (const { n, el } of inputs) {
          const v = el.value.trim();
          if (v.includes("::")) {
            new Notice(
              'Incremental Reading: hints cannot contain "::" (reserved for cloze syntax).',
            );
            saving = false;
            return;
          }
          try {
            next = setClozeHint(next, n, v);
          } catch (err) {
            console.error("Incremental Reading: setClozeHint failed", err);
            new Notice("Incremental Reading: could not update hint.");
            saving = false;
            return;
          }
        }
        try {
          await saveBody(this.app, file, next);
          new Notice(
            inputs.length === 1
              ? "Cloze hint saved."
              : `Cloze hints saved (${inputs.length}).`,
          );
        } catch (err) {
          console.error("Incremental Reading: saveBody failed", err);
          new Notice("Incremental Reading: could not save note.");
          saving = false;
          return;
        }
        close();
        void this.render();
      })();
    };

    cancel.addEventListener("click", () => close());
    save.addEventListener("click", () => doSave());

    for (let i = 0; i < inputs.length; i += 1) {
      const isLast = i === inputs.length - 1;
      inputs[i].el.addEventListener("keydown", (ke: KeyboardEvent) => {
        if (ke.key === "Escape") {
          ke.preventDefault();
          close();
        } else if (ke.key === "Enter") {
          ke.preventDefault();
          if (isLast) {
            doSave();
          } else {
            inputs[i + 1].el.focus();
            inputs[i + 1].el.select();
          }
        }
      });
    }

    requestAnimationFrame(() => {
      inputs[0]?.el.focus();
      inputs[0]?.el.select();
    });
  }

  /**
   * Phrase the "no matches" placeholder so the user can tell which filter
   * dimension is empty — text alone, type alone, or both combined. Cheap
   * enough that we just rebuild it whenever the filter changes; called only
   * on the empty-result path.
   */
  private emptyFilterMessage(query: string, hasTypeFilter: boolean): string {
    const types = Array.from(this.visibleTypes);
    const typeNames = types
      .map((t) => (t === "item" ? "cloze items" : `${t}s`))
      .join(", ");
    if (query && hasTypeFilter) {
      return `No ${typeNames} matching "${query}".`;
    }
    if (query) {
      return `No elements matching "${query}".`;
    }
    return `No ${typeNames} in the tree.`;
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
    if (this.currentElementId && node.id === this.currentElementId) {
      row.addClass("ir-tree-row--current");
    }
    if (this.selectedIds.has(node.id)) {
      row.addClass("ir-tree-row--selected");
    }
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

    const label = this.rowLabel(node.element);
    const titleEl = row.createSpan({
      cls: "ir-tree-title",
      text: label,
    });
    // Anchored extracts have no `notePath` (they live in the store; their
    // text lives inside the parent note's body). Fall back to the anchor's
    // source path so the row stays clickable and jumps to where the extract
    // lives in the vault. Without this, only promoted extracts and items
    // are reachable from the tree.
    const titleTarget =
      node.element.notePath ?? node.element.anchor?.sourcePath ?? null;
    if (titleTarget) {
      titleEl.addClass("ir-tree-link");
      titleEl.addEventListener("click", (e) => {
        // Modifier clicks belong to multi-select; suppress navigation so a
        // shift-click that extends the selection doesn't also yank the
        // user into a different note.
        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
        void this.openNote(titleTarget, node.element);
      });
    }

    row.addEventListener("click", (e) => {
      // Click handlers further inside the row (the title link, priority
      // controls, action buttons) call stopPropagation when they want to
      // own the gesture. What lands here is "user clicked the row, but no
      // inner control claimed it" — exactly the gesture we want to map to
      // multi-select on modifier keys.
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        this.toggleRowSelection(node.id);
        void this.render();
      } else if (e.shiftKey) {
        e.preventDefault();
        this.extendRowSelectionTo(node.id);
        void this.render();
      }
    });

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
      this.showRowContextMenu(e, node, file, li);
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
    li: HTMLElement,
  ): void {
    const menu = new Menu();
    const elId = node.id as ElementId;

    const openTarget =
      node.element.notePath ?? node.element.anchor?.sourcePath ?? null;
    if (openTarget) {
      const title = node.element.notePath ? "Open note" : "Open source note";
      menu.addItem((item) =>
        item
          .setTitle(title)
          .setIcon("file-text")
          .onClick(() => void this.openNote(openTarget, node.element)),
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

    if (
      this.forkExtract &&
      node.element.type === "extract"
    ) {
      menu.addItem((item) =>
        item
          .setTitle("Fork extract (duplicate reading element)")
          .setIcon("git-branch")
          .onClick(() => {
            void (async () => {
              try {
                await this.forkExtract!(elId);
              } catch (err) {
                console.error("Incremental Reading: fork extract failed", err);
                new Notice("Incremental Reading: could not fork extract.");
              }
              void this.render();
            })();
          }),
      );
    }

    if (
      node.element.type === "item" &&
      file &&
      this.itemBodies.has(node.id)
    ) {
      const body = this.itemBodies.get(node.id)!;
      const groupCount = listClozeGroups(body).length;
      if (groupCount > 0) {
        menu.addItem((item) =>
          item
            .setTitle(
              groupCount === 1 ? "Edit cloze hint\u2026" : "Edit cloze hints\u2026",
            )
            .setIcon("pencil")
            .onClick(() => {
              void this.beginHintEdit(li, node, file);
            }),
        );
      }
    }

    if (this.commitDelete) {
      menu.addSeparator();
      menu.addItem((item) =>
        item
          .setTitle("Delete element")
          .setIcon("trash-2")
          .onClick(() => {
            const childCount = node.children.length;
            const deleteLabel = this.rowLabel(node.element);
            const msg = childCount > 0
              ? `Delete "${deleteLabel}"? Its ${childCount} child${childCount !== 1 ? "ren" : ""} will be reparented to its parent.`
              : `Delete "${deleteLabel}"?`;
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

  private async openNote(
    path: string,
    element?: IrElement,
  ): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      new Notice(`Incremental Reading: note "${path}" not found.`);
      return;
    }

    // When the row points at the extract's source body (i.e., we are opening
    // the parent note that contains the highlighted span, not the extract's
    // own promoted note), find the extract's line/ch and pass it via eState
    // so Obsidian scrolls the viewport straight to the highlight instead of
    // dropping the user at the top of the file.
    let openState: { eState: Record<string, unknown> } | undefined;
    if (element?.anchor && element.anchor.sourcePath === path) {
      try {
        const raw = await this.app.vault.cachedRead(file);
        const pos = findExtractEditorPosition(element, raw);
        if (pos) {
          openState = {
            eState: { line: pos.line, ch: pos.ch, scroll: pos.line },
          };
        }
      } catch (e) {
        console.error(
          "Incremental Reading: tree open-at-extract position failed",
          e,
        );
      }
    }

    await this.app.workspace.getLeaf(false).openFile(file, openState);
  }
}
