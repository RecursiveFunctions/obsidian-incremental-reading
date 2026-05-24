import {
  Editor,
  MarkdownView,
  Menu,
  Modal,
  Notice,
  Platform,
  Plugin,
  TFile,
  WorkspaceLeaf,
} from "obsidian";
import { DEFAULT_SETTINGS, IrSettingTab, IrSettings } from "./src/settings";
import { IR_TREE_VIEW_TYPE, IrTreeView } from "./src/tree-view";
import { IR_SESSION_VIEW_TYPE, IrSessionView } from "./src/session-view";
import { IR_STATS_VIEW_TYPE, IrStatsView } from "./src/stats-view";
import {
  IrNoteResult,
  createCloze,
  createIrItemChildNote,
  markExtractedSpan,
  getIrType,
  getPriority,
  isDismissed,
  markAsTopic,
  setDismissed,
  setPriority,
  uniqueMarkdownNotePath,
} from "./src/ir-note";
import { dueQueue, type ReviewSlot } from "./src/review";
import { IR_REVIEW_VIEW_TYPE, IrReviewView } from "./src/review-view";
import { openPriorityPrompt } from "./src/priority-prompt";
import { IrStore, META } from "./src/ir/store";
import {
  computeLoad,
  disposeStatusBar,
  renderStatusBar,
} from "./src/status-bar";
import {
  ObsidianVaultFs,
  type ObsidianDataAdapter,
} from "./src/ir/obsidian-vault-fs";
import { migrateNotes, elementIdForPath, type FrontmatterNote } from "./src/ir/migrate";
import { toAnkiTsv } from "./src/ir/anki-export";
import { planSourceDeletion } from "./src/ir/deletion";
import { findLastUndoableGrade, nextLamport } from "./src/ir/log";
import { mostRecentBookmark } from "./src/ir/bookmark";
import { newCard, storedToCard, writeCardToFrontmatter } from "./src/fsrs";
import { labelFor } from "./src/ir/labels";
import { newElementId, newEventId } from "./src/ir/ids";
import {
  clampPriority,
  type IrElement,
  type IrEvent,
} from "./src/ir/model";
import type { ElementId } from "./src/ir/ids";
import { IR_KEYS } from "./src/types";
import { newTopicState, writeTopicToFrontmatter } from "./src/topic";
import { topicStateToSchedule } from "./src/ir/queue-adapter";
import { redistribute, type MercyEntry } from "./src/ir/mercy";
import {
  bodyWithSingleClozeGroup,
  listClozeGroupNumbers,
  nextClozeNumber,
  wrapCloze,
} from "./src/cloze";
import { promptClozeHint } from "./src/cloze-hint-modal";
import { planBulkImport } from "./src/ir/bulk-import";
import { buildExtractEvent, buildPromoteEvent } from "./src/ir/extract";
import { resolveAnchor } from "./src/ir/anchor";
import {
  bodyOffsetsFromFullOffsets,
  saveBody,
  stripExtractMarks,
  stripFrontmatter,
  wrapExtractHighlight,
} from "./src/ir/frontmatter-body";
import { locateTextInBody } from "./src/ir/selection-map";
import {
  findAllBlockquotes,
  findAllListItems,
  findAllParagraphs,
  findHeadingSectionAtOffset,
  findParagraphAtOffset,
  spanIsInsideExtractMark,
  type Span,
} from "./src/ir/extract-spans";
import {
  openIrRadialQuickMenu,
  type IrHubEntry,
} from "./src/ir-actions-radial";

/**
 * The bulk-extract commands ask for confirmation above this many candidate
 * spans. Picked to be permissive for typical fact-list notes (40 bullets is
 * fine without a prompt) while still catching the "I accidentally selected
 * a 300-paragraph book chapter" mistake before it explodes the queue.
 */
const BULK_EXTRACT_CONFIRM_THRESHOLD = 50;

export default class IncrementalReadingPlugin extends Plugin {
  settings: IrSettings = DEFAULT_SETTINGS;

  /**
   * Ephemeral review session: set in {@link startReview} before
   * `setViewState`, consumed exactly once when the `registerView` factory
   * constructs {@link IrReviewView}. Never clear in a `finally` after
   * `await setViewState` — the factory can run later than the promise
   * resolution, which left globals null and threw "review session not
   * prepared". A missing session (e.g. workspace restored an IR review leaf
   * from an older build) yields an empty queue; the view shows a recovery UI.
   */
  private irReviewSession: {
    queue: ReviewSlot[];
    elementsById: Map<ElementId, IrElement>;
  } | null = null;

  /**
   * The store, constructed once the layout exists (after a migration, or
   * immediately when `.ir/` is already present). It is the source of truth
   * for the queue and review loop; frontmatter is dual-written on every
   * action only as the migration fallback.
   */
  private store?: IrStore;

  /** Status bar queue-load indicator (UI commitment #4). */
  private statusBarEl?: HTMLElement;

  /**
   * Wall-clock at plugin load; the session audit (UI commitment #7) filters
   * the store event log to events newer than this.
   */
  private sessionStartMs = Date.now();

  async onload() {
    await this.loadSettings();
    await this.runMigrationIfOwed();
    this.addSettingTab(new IrSettingTab(this.app, this));

    // Glanceable queue-load indicator. Built before any other UI so it shows
    // up immediately, and refreshed once the store is ready below.
    this.statusBarEl = this.addStatusBarItem();
    renderStatusBar(
      this.statusBarEl,
      { due: 0, later: 0, inflow7d: 0 },
      () => void this.startReview(),
    );
    void this.refreshStatusBar();

    // Background tick: refreshes the "+N/7d" rolling window so it does not
    // drift when nothing in the plugin is triggering a redraw. Cheap (reads
    // a folded in-memory state). Cleaned up automatically on unload via
    // registerInterval.
    this.registerInterval(
      window.setInterval(() => void this.refreshStatusBar(), 60_000),
    );

    this.addRibbonIcon("book-open", "Mark note as IR topic", () => {
      void this.markActiveFileAsTopic();
    });

    this.addRibbonIcon("brain-circuit", "Start IR review", () => {
      void this.startReview();
    });

    this.addRibbonIcon(
      "layout-list",
      "IR quick actions (radial, Alt+Shift+U) — new cloze / split / fork when this note matches",
      () => {
        void this.openIrActionsHub();
      },
    );

    this.addCommand({
      id: "start-review",
      name: "Start IR review",
      icon: "play-circle",
      hotkeys: [{ modifiers: ["Alt"], key: "r" }],
      callback: () => void this.startReview(),
    });

    this.registerView(
      IR_TREE_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => {
        if (!this.store) {
          throw new Error(
            "Incremental Reading: store not ready for tree view.",
          );
        }
        return new IrTreeView(
          leaf,
          this.store,
          (elementId, file, priority) =>
            this.applyIrPriorityChange(elementId, file, priority),
          (elementId, file, dismissed) =>
            this.applyIrDismissChange(elementId, file, dismissed),
          (elementId, file, days) =>
            this.applyIrPostponeChange(elementId, file, days),
          (elementId, newParentId) =>
            this.applyIrReparent(elementId, newParentId),
          (elementId, parentId) =>
            this.applyIrDelete(elementId, parentId),
          (elementId, element) =>
            this.applyIrPromote(elementId, element),
          (elementId, element) =>
            this.applyIrReanchor(elementId, element),
          (elementId) => void this.forkStoreExtract(elementId),
          (elementId) => this.resumeReadingBookmark(elementId),
        );
      },
    );

    this.registerView(
      IR_SESSION_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => {
        if (!this.store) {
          throw new Error(
            "Incremental Reading: store not ready for session view.",
          );
        }
        return new IrSessionView(leaf, this.store, this.sessionStartMs);
      },
    );

    this.registerView(
      IR_STATS_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => {
        if (!this.store) {
          throw new Error(
            "Incremental Reading: store not ready for stats view.",
          );
        }
        return new IrStatsView(leaf, this.store);
      },
    );

    this.registerView(IR_REVIEW_VIEW_TYPE, (leaf: WorkspaceLeaf) => {
        if (!this.store) {
          throw new Error(
            "Incremental Reading: store not ready for review view.",
          );
        }
        const session = this.irReviewSession;
        this.irReviewSession = null;
        const queue = session?.queue ?? [];
        const elementsById =
          session?.elementsById ?? new Map<ElementId, IrElement>();
        return new IrReviewView(
          leaf,
          this,
          this.settings,
          this.store,
          queue,
          elementsById,
          () => void this.refreshStatusBar(),
          () => void this.openIrActionsHub(),
          (id) => void this.notifyTreeOfReviewSlot(id),
          () => this.undoLastGrade(),
        );
      },
    );

    this.addRibbonIcon("list-tree", "Open IR element tree", () => {
      void this.openTreeView();
    });

    this.addCommand({
      id: "open-tree-view",
      name: "Open IR element tree",
      icon: "list-tree",
      hotkeys: [{ modifiers: ["Alt"], key: "i" }],
      callback: () => void this.openTreeView(),
    });

    this.addCommand({
      id: "open-session-log",
      name: "Open IR session log",
      icon: "history",
      hotkeys: [{ modifiers: ["Alt"], key: "l" }],
      callback: () => void this.openSessionView(),
    });

    this.addCommand({
      id: "set-ir-priority",
      name: "Set IR priority of current element",
      icon: "sliders-horizontal",
      hotkeys: [{ modifiers: ["Alt"], key: "p" }],
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md" || !getIrType(this.app, file)) {
          return false;
        }
        if (!checking) {
          void this.openTreeAndFocusPriorityEditor(file);
        }
        return true;
      },
    });

    this.addCommand({
      id: "export-anki-tsv",
      name: "Export IR items to Anki TSV",
      icon: "download",
      hotkeys: [{ modifiers: ["Alt"], key: "e" }],
      callback: () => void this.exportAnkiTsv(),
    });

    this.addCommand({
      id: "show-stats",
      name: "Show IR stats",
      icon: "bar-chart-3",
      hotkeys: [{ modifiers: ["Alt"], key: "s" }],
      callback: () => void this.openStatsView(),
    });

    this.addCommand({
      id: "mercy-postpone",
      name: "Postpone overdue elements (mercy)",
      icon: "clock",
      hotkeys: [{ modifiers: ["Alt"], key: "m" }],
      callback: () => void this.runMercy(),
    });

    this.addCommand({
      id: "resume-last-read",
      name: "Resume last read topic",
      icon: "bookmark",
      callback: () => void this.resumeReadingBookmark(),
    });

    this.addCommand({
      id: "undo-last-grade",
      name: "Undo last grade",
      icon: "undo-2",
      // No default hotkey: Cmd/Ctrl+Z is a platform expectation we can't
      // safely steal (Obsidian uses it for editor undo), and the obvious
      // Alt+Z slot is already bound to "Cloze selection". Users who want
      // a binding can pick one in Settings → Hotkeys.
      callback: () => {
        void (async () => {
          const result = await this.undoLastGrade();
          if (!result) {
            new Notice("Incremental Reading: nothing to undo.");
            return;
          }
          new Notice(
            `Incremental Reading: undid grade for "${result.targetLabel}".`,
          );
        })();
      },
    });

    this.addCommand({
      id: "toggle-dismiss",
      name: "Dismiss / restore current IR element",
      icon: "ban",
      hotkeys: [{ modifiers: ["Alt"], key: "d" }],
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md" || !getIrType(this.app, file)) {
          return false;
        }
        if (!checking) void this.toggleDismiss(file);
        return true;
      },
    });

    this.addCommand({
      id: "mark-as-ir-topic",
      name: "Mark current note as IR topic",
      icon: "book-open",
      hotkeys: [{ modifiers: ["Alt"], key: "t" }],
      // checkCallback so the command only appears when there's a markdown
      // note to act on, per Obsidian command-design guidance.
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") return false;
        if (!checking) void this.markActiveFileAsTopic(file);
        return true;
      },
    });

    // SuperMemo parity: Alt+X extract, Alt+Z cloze. Defaults only; users
    // can rebind or clear them in Settings -> Hotkeys.
    // Uses checkCallback (not editorCheckCallback) so the hotkey also works
    // inside the IR review ItemView, which is not a MarkdownView.
    this.addCommand({
      id: "extract-selection",
      name: "Extract selection (anchored in source)",
      icon: "scissors",
      hotkeys: [{ modifiers: ["Alt"], key: "x" }],
      checkCallback: (checking) => {
        const rv = this.getActiveReviewView();
        if (rv) {
          if (!checking) void rv.handleExtract();
          return true;
        }
        const mv = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (mv?.file && mv.editor.getSelection().trim()) {
          if (!checking) void this.extractSelection(mv.editor, mv.file);
          return true;
        }
        return false;
      },
    });

    this.addCommand({
      id: "cloze-selection",
      name: "Cloze selection into an IR item",
      icon: "brackets",
      hotkeys: [{ modifiers: ["Alt"], key: "z" }],
      checkCallback: (checking) => {
        const rv = this.getActiveReviewView();
        if (rv) {
          if (!checking) void rv.handleCloze();
          return true;
        }
        const mv = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (mv?.file && mv.editor.getSelection().trim()) {
          if (!checking) void this.clozeSelection(mv.editor, mv.file);
          return true;
        }
        return false;
      },
    });

    this.addCommand({
      id: "ir-actions-hub",
      name: "IR quick actions (radial wheel)",
      icon: "layout-list",
      /** Alt+Shift+U: avoids single-modifier Alt+letter core bindings. */
      hotkeys: [{ modifiers: ["Alt", "Shift"], key: "u" }],
      callback: () => void this.openIrActionsHub(),
    });

    this.addCommand({
      id: "ir-new-cloze-card-separate",
      name: "New cloze card (separate item from selection)",
      icon: "copy-plus",
      hotkeys: [{ modifiers: ["Alt", "Shift"], key: "z" }],
      editorCheckCallback: (checking, editor, view) => {
        const file = view.file;
        if (!file || file.extension !== "md") return false;
        if (!editor.getSelection().trim()) return false;
        if (!checking) void this.newClozeCardFromSelection(editor, file);
        return true;
      },
    });

    this.addCommand({
      id: "ir-split-cloze-items",
      name: "Split cloze into separate IR item notes",
      icon: "split",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") return false;
        if (getIrType(this.app, file) !== "item") return false;
        if (!checking) void this.splitClozeInActiveEditor();
        return true;
      },
    });

    // Fast extract-authoring commands: paragraph/heading-section at cursor
    // skip the "select first" ceremony for the most common single-shot case,
    // and the three bulk commands turn list-style notes (e.g. an imported
    // glossary or fact list) into N anchored extracts in one keystroke.
    this.addCommand({
      id: "ir-extract-paragraph-at-cursor",
      name: "Extract paragraph at cursor",
      icon: "pilcrow",
      editorCheckCallback: (checking, editor, view) => {
        const file = view.file;
        if (!file || file.extension !== "md") return false;
        if (!checking) void this.extractParagraphAtCursor(editor, file);
        return true;
      },
    });

    this.addCommand({
      id: "ir-extract-heading-section-at-cursor",
      name: "Extract heading section at cursor",
      icon: "heading",
      editorCheckCallback: (checking, editor, view) => {
        const file = view.file;
        if (!file || file.extension !== "md") return false;
        if (!checking) void this.extractHeadingSectionAtCursor(editor, file);
        return true;
      },
    });

    this.addCommand({
      id: "ir-extract-every-blockquote",
      name: "Extract every blockquote (in selection or note)",
      icon: "quote",
      editorCheckCallback: (checking, editor, view) => {
        const file = view.file;
        if (!file || file.extension !== "md") return false;
        if (!checking) void this.extractEveryBlockquote(editor, file);
        return true;
      },
    });

    this.addCommand({
      id: "ir-extract-every-list-item-in-selection",
      name: "Extract every list item in selection",
      icon: "list",
      editorCheckCallback: (checking, editor, view) => {
        const file = view.file;
        if (!file || file.extension !== "md") return false;
        if (!editor.getSelection().trim()) return false;
        if (!checking) void this.extractEveryListItemInSelection(editor, file);
        return true;
      },
    });

    this.addCommand({
      id: "ir-extract-every-paragraph-in-selection",
      name: "Extract every paragraph in selection",
      icon: "align-left",
      editorCheckCallback: (checking, editor, view) => {
        const file = view.file;
        if (!file || file.extension !== "md") return false;
        if (!editor.getSelection().trim()) return false;
        if (!checking) void this.extractEveryParagraphInSelection(editor, file);
        return true;
      },
    });

    this.addCommand({
      id: "bulk-import",
      name: "Import clipboard as IR topic",
      icon: "clipboard-paste",
      hotkeys: [{ modifiers: ["Alt"], key: "b" }],
      callback: () => void this.bulkImport(),
    });

    this.registerEvent(
      this.app.workspace.on(
        "editor-menu",
        (menu: Menu, editor: Editor, view: MarkdownView) => {
          if (!view.file) return;
          menu.addItem((item) =>
            item
              .setTitle("IR quick actions (radial wheel)…")
              .setIcon("layout-list")
              .onClick(() => void this.openIrActionsHub()),
          );
          const file = view.file;
          const hasSel = editor.getSelection().trim().length > 0;
          if (!hasSel) {
            // No selection: surface the cursor-driven extracts so the user
            // never has to select anything for the common "extract this
            // paragraph / heading" case.
            menu.addItem((item) =>
              item
                .setTitle("Extract paragraph at cursor")
                .setIcon("pilcrow")
                .onClick(() =>
                  void this.extractParagraphAtCursor(editor, file),
                ),
            );
            menu.addItem((item) =>
              item
                .setTitle("Extract heading section at cursor")
                .setIcon("heading")
                .onClick(() =>
                  void this.extractHeadingSectionAtCursor(editor, file),
                ),
            );
            return;
          }
          menu.addItem((item) =>
            item
              .setTitle("Extract to IR child note")
              .setIcon("scissors")
              .onClick(() => void this.extractSelection(editor, file)),
          );
          menu.addItem((item) =>
            item
              .setTitle("Cloze to IR item")
              .setIcon("brackets")
              .onClick(() => void this.clozeSelection(editor, file)),
          );
          menu.addItem((item) =>
            item
              .setTitle("New cloze card (separate item)")
              .setIcon("copy-plus")
              .onClick(() => void this.newClozeCardFromSelection(editor, file)),
          );
          menu.addItem((item) =>
            item
              .setTitle("Extract every list item in selection")
              .setIcon("list")
              .onClick(() =>
                void this.extractEveryListItemInSelection(editor, file),
              ),
          );
          menu.addItem((item) =>
            item
              .setTitle("Extract every paragraph in selection")
              .setIcon("align-left")
              .onClick(() =>
                void this.extractEveryParagraphInSelection(editor, file),
              ),
          );
          menu.addItem((item) =>
            item
              .setTitle("Extract every blockquote in selection")
              .setIcon("quote")
              .onClick(() => void this.extractEveryBlockquote(editor, file)),
          );
        },
      ),
    );

    // file-menu carries the note-level actions that have no hotkey path on
    // mobile (no keyboard, ribbon is hidden behind a swipe). Tapping the
    // three-dot button on a note surfaces this menu, so mark-as-topic,
    // priority, dismiss, and (on mobile) the full IR command set live here.
    // Vault delete handler: when a source note disappears, the pure
    // planSourceDeletion decides which extracts auto-promote to standalone
    // notes (so their reviewable text never disappears) and emits a
    // source-tombstone event so the UI can offer re-link if the source ever
    // comes back via Sync/git/trash.
    this.registerEvent(
      this.app.vault.on("delete", (deleted) => {
        if (!(deleted instanceof TFile) || deleted.extension !== "md") return;
        void this.handleSourceDeletion(deleted);
      }),
    );

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu: Menu, file) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;
        const irType = getIrType(this.app, file);
        if (!irType) {
          menu.addItem((item) =>
            item
              .setTitle("Mark as IR topic")
              .setIcon("book-open")
              .onClick(() => void this.markActiveFileAsTopic(file)),
          );
          this.addMobileIrFileMenuNav(menu);
          return;
        }
        menu.addItem((item) =>
          item
            .setTitle("IR quick actions (radial wheel)…")
            .setIcon("layout-list")
            .onClick(() => void this.openIrActionsHub()),
        );
        menu.addItem((item) =>
          item
            .setTitle("Set IR priority")
            .setIcon("sliders-horizontal")
            .onClick(() => {
              const cur = getPriority(
                this.app,
                file,
                this.settings.defaultPriority,
              );
              this.promptPriority(file, cur);
            }),
        );
        const dismissed = isDismissed(this.app, file);
        menu.addItem((item) =>
          item
            .setTitle(dismissed ? "Restore IR element" : "Dismiss IR element")
            .setIcon(dismissed ? "rotate-ccw" : "ban")
            .onClick(() => void this.toggleDismiss(file)),
        );
        this.addMobileIrFileMenuNav(menu);
      }),
    );
  }

  /**
   * Obsidian mobile hides the ribbon behind a swipe; hotkeys are unavailable
   * without hardware keys. Mirror the main IR commands on the per-note file
   * menu so review, tree, session log, stats, mercy, and Anki export stay
   * reachable (README stretch: mobile parity).
   */
  private addMobileIrFileMenuNav(menu: Menu): void {
    if (!Platform.isMobile) return;
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle("IR quick actions (radial wheel)…")
        .setIcon("layout-list")
        .onClick(() => void this.openIrActionsHub()),
    );
    menu.addItem((item) =>
      item
        .setTitle("Start IR review")
        .setIcon("play-circle")
        .onClick(() => void this.startReview()),
    );
    menu.addItem((item) =>
      item
        .setTitle("Open IR element tree")
        .setIcon("list-tree")
        .onClick(() => void this.openTreeView()),
    );
    menu.addItem((item) =>
      item
        .setTitle("Open IR session log")
        .setIcon("history")
        .onClick(() => void this.openSessionView()),
    );
    menu.addItem((item) =>
      item
        .setTitle("Show IR stats")
        .setIcon("bar-chart-3")
        .onClick(() => void this.openStatsView()),
    );
    menu.addItem((item) =>
      item
        .setTitle("Postpone overdue elements (mercy)")
        .setIcon("clock")
        .onClick(() => void this.runMercy()),
    );
    menu.addItem((item) =>
      item
        .setTitle("Export IR items to Anki TSV")
        .setIcon("download")
        .onClick(() => void this.exportAnkiTsv()),
    );
    menu.addItem((item) =>
      item
        .setTitle("Import clipboard as IR topic")
        .setIcon("clipboard-paste")
        .onClick(() => void this.bulkImport()),
    );
  }

  private getActiveReviewView(): IrReviewView | null {
    const leaf = this.app.workspace.getActiveViewOfType(IrReviewView);
    return leaf ?? null;
  }

  /**
   * Forward the review pane's current slot to any open IR tree view, so the
   * tree highlights and scrolls to the row the user is reviewing. No-op when
   * the tree is not open.
   */
  private async notifyTreeOfReviewSlot(
    id: ElementId | null,
  ): Promise<void> {
    const leaf = this.app.workspace.getLeavesOfType(IR_TREE_VIEW_TYPE)[0];
    const view = leaf?.view;
    if (view instanceof IrTreeView) {
      await view.setCurrentElementId(id);
    }
  }

  onunload() {
    this.irReviewSession = null;
    this.app.workspace.detachLeavesOfType(IR_TREE_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(IR_SESSION_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(IR_STATS_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(IR_REVIEW_VIEW_TYPE);
    if (this.statusBarEl) {
      disposeStatusBar(this.statusBarEl);
      this.statusBarEl = undefined;
    }
  }

  /**
   * Re-render the status bar from the current store state. Safe to call
   * before the store is ready (it leaves a zero-state placeholder); safe to
   * call repeatedly (the render is idempotent).
   */
  private async refreshStatusBar(): Promise<void> {
    if (!this.statusBarEl) return;
    if (!this.store) return;
    try {
      const state = await this.store.load();
      const events = await this.store.loadEvents();
      const load = computeLoad(state.elements.values(), events, Date.now());
      renderStatusBar(
        this.statusBarEl,
        load,
        () => void this.startReview(),
      );
    } catch (e) {
      console.error("Incremental Reading: status bar refresh failed", e);
    }
  }

  private async extractSelection(editor: Editor, source: TFile) {
    if (!(await this.ensureIrSource(source))) return;
    if (!this.store) {
      new Notice("Incremental Reading: store is not ready.");
      return;
    }
    const fromPos = editor.getCursor("from");
    const toPos = editor.getCursor("to");
    const fromOffset = editor.posToOffset(fromPos);
    const toOffset = editor.posToOffset(toPos);
    const rawSelection = editor.getRange(fromPos, toPos);
    // Shrink the range past surrounding whitespace so the wrap and the
    // ancestor-propagation text stay aligned and don't include stray spaces.
    const leadingWs = rawSelection.length - rawSelection.trimStart().length;
    const trailingWs = rawSelection.length - rawSelection.trimEnd().length;
    const selection = rawSelection.trim();
    if (!selection) {
      new Notice("Incremental Reading: nothing selected.");
      return;
    }
    const offsets = bodyOffsetsFromFullOffsets(
      editor.getValue(),
      fromOffset + leadingWs,
      toOffset - trailingWs,
    );
    if (!offsets) {
      new Notice(
        "Incremental Reading: selection is outside the note body.",
      );
      return;
    }
    const bodyBeforeExtract = stripFrontmatter(
      await this.app.vault.cachedRead(source),
    );
    await markExtractedSpan(
      this.app,
      source,
      offsets.start,
      offsets.end,
      selection,
    );
    const parentId =
      (await this.resolveElementIdForFile(source)) ??
      elementIdForPath(source.path);
    const now = Date.now();
    try {
      const ev = buildExtractEvent({
        sourcePath: source.path,
        sourceText: bodyBeforeExtract,
        selStart: offsets.start,
        selEnd: offsets.end,
        parentId,
        priority: getPriority(this.app, source, this.settings.defaultPriority),
        elementId: newElementId(),
        eventId: newEventId(),
        device: await this.store.getDeviceId(),
        lamport: now,
        now,
        schedule: topicStateToSchedule(
          newTopicState(this.settings, new Date(now)),
        ),
        persistedExtractMark: true,
      });
      await this.store.appendEvent(ev);
      await this.store.reconcile();
      void this.refreshStatusBar();
      new Notice(
        `Extracted (anchored in "${source.basename}", not a separate note).`,
      );
    } catch (e) {
      console.error("Incremental Reading: anchored extract failed", e);
      new Notice(
        "Incremental Reading: could not record the extract in the store. See the developer console.",
      );
    }
  }

  /* ----------------------------------------------------------------- */
  /* Fast extract-authoring (paragraph / heading section / bulk)        */
  /* ----------------------------------------------------------------- */

  /** Cursor-driven: no selection needed. Grabs the paragraph the cursor sits in. */
  private async extractParagraphAtCursor(
    editor: Editor,
    source: TFile,
  ): Promise<void> {
    const cursor = editor.posToOffset(editor.getCursor());
    const fullText = editor.getValue();
    const body = stripFrontmatter(fullText);
    const cursorInBody = this.bodyOffsetOfFullCursor(fullText, body, cursor);
    const span = findParagraphAtOffset(body, cursorInBody);
    if (!span) {
      new Notice(
        "Incremental Reading: cursor isn't inside a paragraph.",
      );
      return;
    }
    await this.bulkExtractAnchored(source, [span], "Paragraph extracted");
  }

  /** Cursor-driven: extracts the heading section the cursor sits inside. */
  private async extractHeadingSectionAtCursor(
    editor: Editor,
    source: TFile,
  ): Promise<void> {
    const cursor = editor.posToOffset(editor.getCursor());
    const fullText = editor.getValue();
    const body = stripFrontmatter(fullText);
    const cursorInBody = this.bodyOffsetOfFullCursor(fullText, body, cursor);
    const span = findHeadingSectionAtOffset(body, cursorInBody);
    if (!span) {
      new Notice(
        "Incremental Reading: no heading above the cursor to extract.",
      );
      return;
    }
    await this.bulkExtractAnchored(
      source,
      [span],
      "Heading section extracted",
    );
  }

  /**
   * Translate a full-file cursor offset to its body-relative offset. The
   * body the span-finders work on excludes the YAML block AND any blank
   * lines between the frontmatter and the first prose line, so a naive
   * `cursor - (fullText.length - body.length)` over-corrects whenever the
   * note has trailing whitespace (which `stripFrontmatter` also trims).
   */
  private bodyOffsetOfFullCursor(
    fullText: string,
    body: string,
    cursor: number,
  ): number {
    const fm = fullText.match(/^---\n[\s\S]*?\n---\n?/);
    const fmLen = fm ? fm[0].length : 0;
    const afterFm = fullText.slice(fmLen);
    const leadingWs = afterFm.length - afterFm.trimStart().length;
    const bodyStartInFull = fmLen + leadingWs;
    if (cursor <= bodyStartInFull) return 0;
    const offset = cursor - bodyStartInFull;
    return Math.min(body.length, Math.max(0, offset));
  }

  /**
   * Bulk: every contiguous blockquote in the selection (or whole note when
   * there is no selection). Skips quotes that already sit inside an extract
   * mark so it's safe to re-run on a partially extracted note.
   */
  private async extractEveryBlockquote(
    editor: Editor,
    source: TFile,
  ): Promise<void> {
    const fullText = editor.getValue();
    const body = stripFrontmatter(fullText);
    const range = this.editorSelectionAsBodyRange(editor, fullText, body);
    const spans = findAllBlockquotes(body, range ?? undefined);
    await this.bulkExtractAnchored(source, spans, "Blockquotes extracted");
  }

  /** Bulk: every top-level list item whose marker line is inside the selection. */
  private async extractEveryListItemInSelection(
    editor: Editor,
    source: TFile,
  ): Promise<void> {
    const fullText = editor.getValue();
    const body = stripFrontmatter(fullText);
    const range = this.editorSelectionAsBodyRange(editor, fullText, body);
    if (!range) {
      new Notice("Incremental Reading: select a range first.");
      return;
    }
    const spans = findAllListItems(body, range);
    await this.bulkExtractAnchored(source, spans, "List items extracted");
  }

  /** Bulk: every paragraph (blank-line block) intersecting the selection. */
  private async extractEveryParagraphInSelection(
    editor: Editor,
    source: TFile,
  ): Promise<void> {
    const fullText = editor.getValue();
    const body = stripFrontmatter(fullText);
    const range = this.editorSelectionAsBodyRange(editor, fullText, body);
    if (!range) {
      new Notice("Incremental Reading: select a range first.");
      return;
    }
    const spans = findAllParagraphs(body, range);
    await this.bulkExtractAnchored(source, spans, "Paragraphs extracted");
  }

  /** Translate the editor's selection to body-relative offsets, or null. */
  private editorSelectionAsBodyRange(
    editor: Editor,
    fullText: string,
    body: string,
  ): Span | null {
    const from = editor.posToOffset(editor.getCursor("from"));
    const to = editor.posToOffset(editor.getCursor("to"));
    if (to <= from) return null;
    const offsets = bodyOffsetsFromFullOffsets(fullText, from, to);
    if (!offsets) return null;
    const start = Math.max(0, Math.min(body.length, offsets.start));
    const end = Math.max(start, Math.min(body.length, offsets.end));
    if (end <= start) return null;
    return { start, end };
  }

  /**
   * Engine for the bulk-extract commands. Spans are processed last-to-first
   * so each `<mark>` insertion never invalidates the offsets of remaining
   * spans, the source body is rewritten exactly once, and ancestors are
   * located by text-match so multi-level reading chains stay in sync.
   *
   * Already-marked spans are silently skipped — running the command twice
   * on the same note doesn't duplicate extracts on the same passage.
   */
  private async bulkExtractAnchored(
    source: TFile,
    rawSpans: Span[],
    headlineLabel: string,
  ): Promise<void> {
    if (!(await this.ensureIrSource(source))) return;
    if (!this.store) {
      new Notice("Incremental Reading: store is not ready.");
      return;
    }

    const initialBody = stripFrontmatter(await this.app.vault.read(source));
    const candidates: Span[] = [];
    for (const s of rawSpans) {
      if (s.end <= s.start) continue;
      if (s.end > initialBody.length) continue;
      if (spanIsInsideExtractMark(initialBody, s)) continue;
      candidates.push(s);
    }
    if (candidates.length === 0) {
      new Notice("Incremental Reading: nothing new to extract.");
      return;
    }
    if (candidates.length > BULK_EXTRACT_CONFIRM_THRESHOLD) {
      const ok = await this.confirmBulkExtract(candidates.length);
      if (!ok) return;
    }

    // Desc by start: marking the last span never shifts the offsets of any
    // earlier span, so the in-memory body and recorded offsets stay aligned.
    candidates.sort((a, b) => b.start - a.start);

    const parentId =
      (await this.resolveElementIdForFile(source)) ??
      elementIdForPath(source.path);
    const priority = getPriority(
      this.app,
      source,
      this.settings.defaultPriority,
    );
    const device = await this.store.getDeviceId();

    let body = initialBody;
    const acceptedTexts: string[] = [];
    let created = 0;
    for (const span of candidates) {
      const sourceTextBefore = body;
      const now = Date.now();
      try {
        const ev = buildExtractEvent({
          sourcePath: source.path,
          sourceText: sourceTextBefore,
          selStart: span.start,
          selEnd: span.end,
          parentId,
          priority,
          elementId: newElementId(),
          eventId: newEventId(),
          device,
          lamport: now,
          now,
          schedule: topicStateToSchedule(
            newTopicState(this.settings, new Date(now)),
          ),
          persistedExtractMark: true,
        });
        await this.store.appendEvent(ev);
        const txt = stripExtractMarks(
          body.slice(span.start, span.end),
        ).trim();
        body = wrapExtractHighlight(body, span.start, span.end);
        if (txt) acceptedTexts.push(txt);
        created += 1;
      } catch (e) {
        console.error(
          "Incremental Reading: bulk extract failed for span",
          span,
          e,
        );
      }
    }

    if (created === 0) {
      new Notice("Incremental Reading: no extracts were created.");
      return;
    }

    if (body !== initialBody) {
      await saveBody(this.app, source, body);
    }
    await this.markTextsInAncestors(source, acceptedTexts);

    await this.store.reconcile();
    void this.refreshStatusBar();
    new Notice(
      `${headlineLabel}: ${created} extract${created === 1 ? "" : "s"} created.`,
    );
  }

  /**
   * Walk the parent chain of `source` and wrap each text in `texts` once
   * per ancestor, in-memory, writing each ancestor exactly once. Skips
   * ambiguous matches (the uniqueness guard in `locateTextInBody`) so a
   * common phrase doesn't get mis-marked on an upstream note.
   */
  private async markTextsInAncestors(
    source: TFile,
    texts: string[],
  ): Promise<void> {
    if (texts.length === 0) return;
    let parentPath = this.app.metadataCache.getFileCache(source)?.frontmatter?.[
      IR_KEYS.parent
    ];
    while (typeof parentPath === "string" && parentPath.length > 0) {
      const parent = this.app.vault.getAbstractFileByPath(parentPath);
      if (!(parent instanceof TFile)) break;
      let parentBody = stripFrontmatter(await this.app.vault.read(parent));
      let changed = false;
      for (const text of texts) {
        const located = locateTextInBody(parentBody, text);
        if (!located) continue;
        const wrapped = wrapExtractHighlight(
          parentBody,
          located.start,
          located.end,
        );
        if (wrapped !== parentBody) {
          parentBody = wrapped;
          changed = true;
        }
      }
      if (changed) await saveBody(this.app, parent, parentBody);
      parentPath = this.app.metadataCache.getFileCache(parent)?.frontmatter?.[
        IR_KEYS.parent
      ];
    }
  }

  /** Above this many spans the bulk commands prompt before writing. */
  private async confirmBulkExtract(count: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const modal = new Modal(this.app);
      modal.titleEl.setText(`Create ${count} extracts?`);
      modal.contentEl.createEl("p", {
        text:
          `This will mint ${count} anchored extracts in the source note, ` +
          "wrap each span with a highlight, and propagate the marks to any " +
          "ancestor topics. The action is reversible per-extract from the " +
          "element tree.",
      });
      const btns = modal.contentEl.createDiv({ cls: "modal-button-container" });
      const cancel = btns.createEl("button", { text: "Cancel" });
      const ok = btns.createEl("button", {
        text: `Create ${count}`,
        cls: "mod-cta",
      });
      let resolved = false;
      const done = (v: boolean) => {
        if (resolved) return;
        resolved = true;
        modal.close();
        resolve(v);
      };
      cancel.addEventListener("click", () => done(false));
      ok.addEventListener("click", () => done(true));
      modal.onClose = () => done(false);
      modal.open();
    });
  }

  private async clozeSelection(editor: Editor, source: TFile) {
    if (!(await this.ensureIrSource(source))) return;
    if (getIrType(this.app, source) === "item") {
      await this.addClozeInPlace(editor, source);
      return;
    }
    const hintR = await promptClozeHint(this.app);
    if (!hintR.ok) return;
    // Snapshot the selection BEFORE createCloze: that call doesn't mutate
    // the editor here, but read offsets while the cursor state is known
    // so we can mark the source span as soon as the child note exists.
    const sourceMarkSpan = this.bodyOffsetsForEditorSelection(editor);
    const selectedText = editor.getSelection();
    const result = await createCloze(
      this.app,
      source,
      editor,
      this.settings,
      hintR.hint,
    );
    if (result.file && sourceMarkSpan && selectedText.trim().length > 0) {
      await this.markSourceClozeSpan(
        source,
        sourceMarkSpan.start,
        sourceMarkSpan.end,
        selectedText,
      );
    }
    await this.openResult(result, "Cloze item created:");
  }

  /** Body-offset span of the editor's current selection, or null. */
  private bodyOffsetsForEditorSelection(
    editor: Editor,
  ): { start: number; end: number } | null {
    const from = editor.posToOffset(editor.getCursor("from"));
    const to = editor.posToOffset(editor.getCursor("to"));
    return bodyOffsetsFromFullOffsets(editor.getValue(), from, to);
  }

  /**
   * Wrap the clozed span in the source body (and propagate up the parent
   * chain) so the user sees which passages have already been clozed —
   * mirrors the Extract creation behavior. Best-effort; logs but does not
   * surface failures to the user since the child note is already saved.
   */
  private async markSourceClozeSpan(
    source: TFile,
    start: number,
    end: number,
    selectedText: string,
  ): Promise<void> {
    try {
      await markExtractedSpan(this.app, source, start, end, selectedText);
    } catch (e) {
      console.error(
        "Incremental Reading: marking clozed span in source failed",
        e,
      );
    }
  }

  /**
   * Splice another `{{cN::...}}` into the *current* item note instead of
   * creating a child. Items are leaves in the IR tree, so each additional
   * cloze must reuse the same note; Anki's multi-cloze format ({{c1::}},
   * {{c2::}}, ...) means N is the next unused group number and Anki will
   * generate one card per N on import. Inside the plugin's own review the
   * extra cloze just expands the hidden span on the same card, which is
   * usually what the user wants when they're elaborating an existing item.
   */
  private async addClozeInPlace(
    editor: Editor,
    source: TFile,
  ): Promise<void> {
    const answer = editor.getSelection().trim();
    if (!answer) {
      new Notice("Incremental Reading: nothing selected.");
      return;
    }
    const hintR = await promptClozeHint(this.app);
    if (!hintR.ok) return;
    const n = nextClozeNumber(editor.getValue());
    editor.replaceSelection(wrapCloze(answer, n, hintR.hint));
    new Notice(`Added cloze c${n} to "${source.basename}".`);
  }

  /**
   * Resolve "is this note ready to be a cloze/extract parent?" Returns true
   * if the source is already a topic/extract/item; if it's a plain note and
   * the auto-mark setting is on, marks it as a topic (recording in the
   * store) and returns true. Returns false (with a Notice) only when the
   * user has opted out and the source still isn't an IR element.
   */
  private async ensureIrSource(source: TFile): Promise<boolean> {
    if (getIrType(this.app, source)) return true;
    if (!this.settings.autoMarkSourceAsTopic) {
      new Notice(
        `"${source.basename}" is not an IR topic. ` +
          "Mark it as a topic first, or enable auto-mark in settings.",
      );
      return false;
    }
    const marked = await markAsTopic(this.app, source, this.settings);
    if (marked) await this.recordElement(source);
    return true;
  }

  private async startReview() {
    if (!this.store) {
      new Notice("Incremental Reading: store is not ready.");
      return;
    }
    const state = await this.store.load();
    const queue = dueQueue(this.app, this.settings.reviewsPerReading, state);
    if (queue.length === 0) {
      new Notice("Incremental Reading: nothing due for review.");
      return;
    }
    const counts = { topics: 0, extracts: 0, items: 0 };
    for (const s of queue) {
      const t = s.element.type;
      if (t === "topic") counts.topics++;
      else if (t === "extract") counts.extracts++;
      else counts.items++;
    }
    const parts: string[] = [];
    if (counts.topics > 0) parts.push(`${counts.topics} topic${counts.topics !== 1 ? "s" : ""}`);
    if (counts.extracts > 0) parts.push(`${counts.extracts} extract${counts.extracts !== 1 ? "s" : ""}`);
    if (counts.items > 0) parts.push(`${counts.items} item${counts.items !== 1 ? "s" : ""}`);
    new Notice(`Starting review: ${parts.join(", ")} (${queue.length} total).`);

    this.app.workspace.detachLeavesOfType(IR_REVIEW_VIEW_TYPE);
    this.irReviewSession = { queue, elementsById: state.elements };
    try {
      // Main workspace tab (not the right sidebar) so review uses the full
      // editor width and mobile does not keep the previous note visible in a
      // split beside a 90vw-wide pane that overflows the narrow leaf.
      const leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: IR_REVIEW_VIEW_TYPE, active: true });
      this.app.workspace.revealLeaf(leaf);
    } catch (e) {
      this.irReviewSession = null;
      console.error("Incremental Reading: opening review view failed", e);
      new Notice(
        "Incremental Reading: could not open the review view. See the developer console.",
      );
    }
  }

  /**
   * Open the review pane focused on the topic with the most recent reading
   * bookmark, regardless of whether that topic is currently due. The
   * existing review-pane bookmark-restore code scrolls the body to where
   * the user left off.
   *
   * Returns false (with a notice) when there is no bookmark, when the
   * bookmarked element has been deleted from the store, or when the
   * element is no longer a reading element (e.g. the user converted it
   * into a cloze item). The caller decides whether to surface a "nothing
   * to resume" notice or stay quiet — the command palette entry shows
   * one; tree-view click handlers don't need to (they only render rows
   * for valid bookmarks).
   *
   * Single-element queue rather than splicing into the due queue: the
   * user's gesture here is "I want to read THAT topic NOW", not "extend
   * my current session." Reusing `dueQueue` would either skip the topic
   * (not due) or rebuild a full queue the user didn't ask for. The cost
   * is that the user has to start a normal review separately if they
   * want to keep grading after resuming; that's a deliberate trade.
   */
  async resumeReadingBookmark(
    elementId?: ElementId,
  ): Promise<boolean> {
    if (!this.store) {
      new Notice("Incremental Reading: store is not ready.");
      return false;
    }
    let targetId = elementId ?? null;
    if (!targetId) {
      const bookmarks = await this.store.loadBookmarks();
      const most = mostRecentBookmark(bookmarks);
      if (!most) {
        new Notice("Incremental Reading: no reading bookmarks yet.");
        return false;
      }
      targetId = most.elementId as ElementId;
    }

    const state = await this.store.load();
    const el = state.elements.get(targetId);
    if (!el) {
      new Notice(
        "Incremental Reading: that bookmark's element no longer exists.",
      );
      return false;
    }
    if (el.type !== "topic" && el.type !== "extract") {
      new Notice(
        "Incremental Reading: bookmarks only apply to reading elements.",
      );
      return false;
    }

    const file = el.notePath
      ? (this.app.vault.getAbstractFileByPath(el.notePath) as TFile | null)
      : null;
    const slot: ReviewSlot = { id: targetId, element: el, file };

    this.app.workspace.detachLeavesOfType(IR_REVIEW_VIEW_TYPE);
    this.irReviewSession = {
      queue: [slot],
      elementsById: state.elements,
    };
    try {
      const leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: IR_REVIEW_VIEW_TYPE, active: true });
      this.app.workspace.revealLeaf(leaf);
      return true;
    } catch (e) {
      this.irReviewSession = null;
      console.error("Incremental Reading: opening review for resume failed", e);
      new Notice(
        "Incremental Reading: could not open the review view. See the developer console.",
      );
      return false;
    }
  }

  private async openTreeView(): Promise<void> {
    if (!this.store) {
      new Notice("Incremental Reading: store is not ready.");
      return;
    }
    const existing = this.app.workspace.getLeavesOfType(IR_TREE_VIEW_TYPE);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      await this.syncTreeToActiveReview();
      return;
    }
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: IR_TREE_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
    await this.syncTreeToActiveReview();
  }

  /**
   * If a review pane is open, push its current slot id to the tree so the
   * highlight is in sync the moment the tree appears.
   */
  private async syncTreeToActiveReview(): Promise<void> {
    const reviewLeaf =
      this.app.workspace.getLeavesOfType(IR_REVIEW_VIEW_TYPE)[0];
    const review = reviewLeaf?.view;
    if (review instanceof IrReviewView) {
      await this.notifyTreeOfReviewSlot(review.getCurrentElementId());
    }
  }

  /**
   * Alt+P: reveal the IR tree and open the inline `pNN` editor for the active
   * note when it maps to a store element; otherwise fall back to the
   * status-bar prompt (SCOPE-MODAL-REMOVAL.md).
   */
  private async openTreeAndFocusPriorityEditor(file: TFile): Promise<void> {
    const current = getPriority(
      this.app,
      file,
      this.settings.defaultPriority,
    );
    await this.openTreeView();
    const leaf = this.app.workspace.getLeavesOfType(IR_TREE_VIEW_TYPE)[0];
    const view = leaf?.view;
    if (view instanceof IrTreeView) {
      const ok = await view.revealPriorityEditorForNotePath(file.path);
      if (ok) return;
    }
    this.promptPriority(file, current);
  }

  /**
   * Open (or reveal) the session-log view. Refreshes its contents when
   * revealed so the user sees what's there now, not what was there last
   * time the view rendered.
   */
  private async openSessionView(): Promise<void> {
    if (!this.store) {
      new Notice("Incremental Reading: store is not ready.");
      return;
    }
    const existing = this.app.workspace.getLeavesOfType(IR_SESSION_VIEW_TYPE);
    if (existing.length > 0) {
      const leaf = existing[0];
      this.app.workspace.revealLeaf(leaf);
      const view = leaf.view;
      if (view instanceof IrSessionView) void view.render();
      return;
    }
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: IR_SESSION_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  /**
   * Resolve the store element id for a vault note path (queue + tree use the
   * folded store, not frontmatter alone).
   */
  private async resolveElementIdForFile(
    file: TFile,
  ): Promise<ElementId | null> {
    if (!this.store) return null;
    const state = await this.store.load();
    for (const el of state.elements.values()) {
      if (el.notePath === file.path) return el.id;
    }
    return null;
  }

  /** Append `priority-set`, dual-write frontmatter, reconcile `.ir/state`. */
  private async applyIrPriorityChange(
    elementId: ElementId,
    file: TFile | null,
    priority: number,
  ): Promise<void> {
    if (!this.store) return;
    const p = clampPriority(priority);
    await this.store.appendEvent({
      id: newEventId(),
      ts: Date.now(),
      lamport: Date.now(),
      device: await this.store.getDeviceId(),
      kind: "priority-set",
      target: elementId,
      payload: { priority: p },
    });
    if (file) await setPriority(this.app, file, p);
    await this.store.reconcile().catch((e) => {
      console.error("Incremental Reading: reconcile after priority failed", e);
    });
    void this.refreshStatusBar();
  }

  /** Append `dismiss-set`, dual-write frontmatter, reconcile `.ir/state`. */
  private async applyIrDismissChange(
    elementId: ElementId,
    file: TFile | null,
    dismissed: boolean,
  ): Promise<void> {
    if (!this.store) return;
    await this.store.appendEvent({
      id: newEventId(),
      ts: Date.now(),
      lamport: Date.now(),
      device: await this.store.getDeviceId(),
      kind: "dismiss-set",
      target: elementId,
      payload: { dismissed },
    });
    if (file) await setDismissed(this.app, file, dismissed);
    await this.store.reconcile().catch((e) => {
      console.error("Incremental Reading: reconcile after dismiss failed", e);
    });
    void this.refreshStatusBar();
  }

  /** Postpone an element by N days via a mercy-postponed event. */
  /** Delete an element, reparenting its children to its parent. */
  private async applyIrDelete(
    elementId: ElementId,
    parentId: ElementId | null,
  ): Promise<void> {
    if (!this.store) return;
    const state = await this.store.load();
    const device = await this.store.getDeviceId();
    const now = Date.now();
    let lamport = now;

    for (const el of state.elements.values()) {
      if (el.parentId === elementId) {
        await this.store.appendEvent({
          id: newEventId(),
          ts: now,
          lamport,
          device,
          kind: "reparented",
          target: el.id,
          payload: { parentId },
        });
        lamport++;
      }
    }

    await this.store.appendEvent({
      id: newEventId(),
      ts: now,
      lamport,
      device,
      kind: "element-deleted",
      target: elementId,
      payload: {},
    });
    await this.store.reconcile().catch((e) => {
      console.error("Incremental Reading: reconcile after delete failed", e);
    });
    void this.refreshStatusBar();
  }

  /**
   * Promote an extract to a standalone note. Creates the note on disk,
   * emits a `promoted` event pointing the element at the new note path.
   */
  private async applyIrPromote(
    elementId: ElementId,
    element: IrElement,
  ): Promise<void> {
    if (!this.store) return;
    const notePath = this.promoteOrphanPath(element);
    await this.materializePromotedNote(notePath, element);

    const ev = buildPromoteEvent({
      elementId,
      notePath,
      eventId: newEventId(),
      device: await this.store.getDeviceId(),
      lamport: Date.now(),
      now: Date.now(),
    });
    await this.store.appendEvent(ev);
    await this.store.reconcile().catch((e) => {
      console.error("Incremental Reading: reconcile after promote failed", e);
    });
    new Notice(`Promoted extract to "${notePath}".`);
    void this.refreshStatusBar();
  }

  /**
   * Re-anchor a drifted extract by re-resolving its anchor against the
   * current source text. Returns true if the anchor was repaired.
   */
  private async applyIrReanchor(
    elementId: ElementId,
    element: IrElement,
  ): Promise<boolean> {
    if (!this.store || !element.anchor) return false;

    const sourceFile = this.app.vault.getAbstractFileByPath(
      element.anchor.sourcePath,
    );
    if (!(sourceFile instanceof TFile)) return false;

    const raw = await this.app.vault.cachedRead(sourceFile);
    const result = resolveAnchor(element.anchor, raw);
    if (result.status !== "ok") return false;

    const repairedAnchor = {
      ...element.anchor,
      position: { start: result.start, end: result.end },
    };

    await this.store.appendEvent({
      id: newEventId(),
      ts: Date.now(),
      lamport: Date.now(),
      device: await this.store.getDeviceId(),
      kind: "anchor-repaired",
      target: elementId,
      payload: { anchor: repairedAnchor },
    });
    await this.store.reconcile().catch((e) => {
      console.error("Incremental Reading: reconcile after re-anchor failed", e);
    });
    return true;
  }

  /** Move an element to a new parent via a reparented event. */
  private async applyIrReparent(
    elementId: ElementId,
    newParentId: ElementId | null,
  ): Promise<void> {
    if (!this.store) return;
    await this.store.appendEvent({
      id: newEventId(),
      ts: Date.now(),
      lamport: Date.now(),
      device: await this.store.getDeviceId(),
      kind: "reparented",
      target: elementId,
      payload: { parentId: newParentId },
    });
    await this.store.reconcile().catch((e) => {
      console.error("Incremental Reading: reconcile after reparent failed", e);
    });
    void this.refreshStatusBar();
  }

  private async applyIrPostponeChange(
    elementId: ElementId,
    _file: TFile | null,
    days: number,
  ): Promise<void> {
    if (!this.store) return;
    const now = Date.now();
    const newDue = now + days * 24 * 60 * 60 * 1000;
    await this.store.appendEvent({
      id: newEventId(),
      ts: now,
      lamport: now,
      device: await this.store.getDeviceId(),
      kind: "mercy-postponed",
      target: elementId,
      payload: { newDue },
    });
    await this.store.reconcile().catch((e) => {
      console.error("Incremental Reading: reconcile after postpone failed", e);
    });
    void this.refreshStatusBar();
  }

  /**
   * Retract the most recently-recorded grade event. Appends a
   * `grade-undone` event referencing the target grade by id; the fold
   * skips both events on next load, so the affected element's `card`
   * reverts to its pre-grade value (or `undefined` if the undone grade
   * was the first ever for that card). The note's frontmatter is
   * rewritten in lockstep so YAML and the store agree.
   *
   * Returns the affected element's id and a human label for the toast,
   * or `null` when the log holds no un-undone grade events. Callers (the
   * command palette and the review pane button) decide whether to
   * surface a "nothing to undo" notice or stay quiet.
   *
   * Out of scope (v1): undoing `topic-advanced` events. Reading-element
   * advances ship their own UX path, and rewinding a ReadSchedule has
   * different semantics than rewinding an FSRS card. Tracked for a later
   * pass.
   */
  async undoLastGrade(): Promise<
    | {
        targetId: ElementId;
        targetLabel: string;
      }
    | null
  > {
    if (!this.store) return null;
    const events = await this.store.loadEvents();
    const target = findLastUndoableGrade(events);
    if (!target) return null;

    const now = Date.now();
    await this.store.appendEvent({
      id: newEventId(),
      ts: now,
      // Live single-device events sort after migration lamports and among
      // themselves by wall clock; ties break on the unique event id. Same
      // policy as `IrReviewView.emit`.
      lamport: now,
      device: await this.store.getDeviceId(),
      kind: "grade-undone",
      target: target.target,
      payload: { eventId: target.id },
    });

    // Re-fold the log so we can read the rolled-back card state and push
    // it into the note's frontmatter. If the undone grade was the only
    // grade for this card, `el.card` is now undefined — write a freshly
    // constructed card so the YAML reflects "ungraded" rather than
    // leaving the prior post-grade values in place.
    const state = await this.store.load();
    const el = state.elements.get(target.target);
    if (el?.notePath) {
      const file = this.app.vault.getAbstractFileByPath(el.notePath);
      if (file instanceof TFile) {
        try {
          await this.app.fileManager.processFrontMatter(file, (fm) => {
            const card = el.card ? storedToCard(el.card) : newCard();
            writeCardToFrontmatter(fm, card);
          });
        } catch (err) {
          console.error(
            "Incremental Reading: rewriting frontmatter after undo failed",
            err,
          );
        }
      }
    }

    await this.store.reconcile().catch((e) => {
      console.error("Incremental Reading: reconcile after undo failed", e);
    });
    void this.refreshStatusBar();

    const targetLabel = el ? labelFor(el) : "card";
    return { targetId: target.target, targetLabel };
  }

  private promptPriority(file: TFile, current: number): void {
    if (!this.statusBarEl) {
      new Notice("Incremental Reading: status bar is not available.");
      return;
    }
    openPriorityPrompt(this.statusBarEl, current, (p) => {
      void (async () => {
        const id = await this.resolveElementIdForFile(file);
        if (id) {
          await this.applyIrPriorityChange(id, file, p);
        } else {
          await setPriority(this.app, file, p);
          void this.refreshStatusBar();
        }
        new Notice(
          `Priority of "${file.basename}" set to ${clampPriority(p)}.`,
        );
      })();
    }, () => {
      void this.refreshStatusBar();
    });
  }

  private async openStatsView(): Promise<void> {
    if (!this.store) {
      new Notice("Incremental Reading: store is not ready.");
      return;
    }
    const existing = this.app.workspace.getLeavesOfType(IR_STATS_VIEW_TYPE);
    if (existing.length > 0) {
      const leaf = existing[0];
      this.app.workspace.revealLeaf(leaf);
      const view = leaf.view;
      if (view instanceof IrStatsView) void view.onOpen();
      return;
    }
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: IR_STATS_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  /**
   * Write a TSV of every active item to `<vault>/anki-ir.tsv`. The pure core
   * filters dismissed items, sorts by id, and writes the row guid as the
   * element id, so Anki imports merge in place across runs (deck definition
   * line in the header tells Anki where to put new items).
   */
  private async exportAnkiTsv(): Promise<void> {
    if (!this.store) {
      new Notice("Incremental Reading: store is not ready.");
      return;
    }
    const state = await this.store.load();
    const elements = Array.from(state.elements.values());
    const tsv = toAnkiTsv(elements, { deck: this.settings.ankiDeckName });
    const outPath = "anki-ir.tsv";
    await this.app.vault.adapter.write(outPath, tsv);
    const itemCount = elements.filter(
      (e) => e.type === "item" && !e.dismissed,
    ).length;
    new Notice(
      `Incremental Reading: wrote ${itemCount} item` +
        `${itemCount === 1 ? "" : "s"} to ${outPath}.`,
    );
  }

  /**
   * Import the current clipboard text as a new IR topic. The pure
   * `planBulkImport` resolves title, body, and frontmatter; this method
   * creates the vault note, records it in the store, and opens it.
   * The plugin never fetches a URL; paste-only is the privacy contract.
   */
  private async bulkImport(): Promise<void> {
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      new Notice(
        "Incremental Reading: could not read the clipboard. " +
          "Copy some text first, then run this command.",
      );
      return;
    }
    if (!text.trim()) {
      new Notice("Incremental Reading: clipboard is empty.");
      return;
    }

    const plan = planBulkImport({
      text,
      defaultPriority: this.settings.defaultPriority,
      now: Date.now(),
    });

    const folder = this.settings.extractFolder.trim().replace(/^\/+|\/+$/g, "");
    const stem = plan.title.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "IR import";
    const dir = folder ? `${folder}/` : "";
    let path = `${dir}${stem}.md`;
    let n = 2;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = `${dir}${stem} ${n}.md`;
      n += 1;
    }

    if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
      await this.app.vault.createFolder(folder);
    }

    const file = await this.app.vault.create(path, plan.body.trim() + "\n");
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      for (const [k, v] of Object.entries(plan.frontmatter)) fm[k] = v;
      writeTopicToFrontmatter(fm, newTopicState(this.settings));
    });

    await this.recordElement(file);
    new Notice(`Imported "${plan.title}" as an IR topic.`);
    await this.app.workspace.getLeaf(true).openFile(file);
  }

  /**
   * Apply mercy: if more than `mercyCeiling` elements are due today, push
   * the lowest-priority overflow forward by one day. Pure `redistribute`
   * decides which ids overflow and which are protected by the cutoff; the
   * wiring just bumps their due timestamps via `mercy-postponed` events.
   *
   * Scheduler state is untouched (DESIGN.md section 6 invariant). A later
   * grade or topic-advance lands at a higher lamport and overwrites the
   * postponement, so a postponed item that does get reviewed today keeps
   * its real next-due.
   */
  private async runMercy(): Promise<void> {
    if (!this.store) {
      new Notice("Incremental Reading: store is not ready.");
      return;
    }
    const now = Date.now();
    const state = await this.store.load();
    const elements = Array.from(state.elements.values());

    const entries: MercyEntry[] = [];
    for (const el of elements) {
      if (el.dismissed) continue;
      const due = el.card?.due ?? el.schedule?.due ?? null;
      if (due === null) continue;
      entries.push({ id: el.id, priority: el.priority, dueMs: due });
    }

    const result = redistribute(entries, now, {
      ceiling: this.settings.mercyCeiling,
      priorityCutoff: this.settings.mercyPriorityCutoff,
    });

    if (result.postponedCount === 0) {
      const due = result.dueToday.length;
      new Notice(
        `Incremental Reading: ${due} due, within ceiling ` +
          `(${this.settings.mercyCeiling}). Nothing to postpone.`,
      );
      return;
    }

    const events = await this.store.loadEvents();
    let lamport = nextLamport(events);
    const device = await this.store.getDeviceId();
    const newDue = now + 24 * 60 * 60 * 1000;

    for (const id of result.postponed) {
      const ev: IrEvent = {
        id: newEventId(),
        ts: now,
        lamport,
        device,
        kind: "mercy-postponed",
        target: id as ElementId,
        payload: { newDue },
      };
      await this.store.appendEvent(ev);
      lamport += 1;
    }
    await this.store.reconcile();

    new Notice(
      `Incremental Reading: postponed ${result.postponedCount} element` +
        `${result.postponedCount === 1 ? "" : "s"} to tomorrow ` +
        `(${result.dueToday.length} kept due today).`,
    );
    void this.refreshStatusBar();
  }

  /**
   * Build a fresh standalone-note path for an orphaned extract. Derived
   * from the first line of the verbatim extracted text plus an id tag so
   * two extracts with the same opening text don't collide. Lands inside
   * `extractFolder` if configured.
   */
  private promoteOrphanPath(el: IrElement): string {
    const folder = this.settings.extractFolder.trim().replace(/^\/+|\/+$/g, "");
    const firstLine = (el.text ?? "").split("\n")[0] ?? "";
    const safe = firstLine
      .replace(/[\\/:*?"<>|#^[\]]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60);
    const tag = el.id.slice(0, 8);
    const stem = safe ? `${safe} (${tag})` : `orphan-${tag}`;
    return folder ? `${folder}/${stem}.md` : `${stem}.md`;
  }

  /**
   * Create the on-disk standalone note for a freshly-promoted orphan extract.
   * The new note carries the extract's verbatim text as body (the store
   * already had that text; this just makes it user-visible) plus the IR
   * frontmatter a normal extract gets, so it slots into the queue
   * indistinguishably from a user-created one.
   */
  private async materializePromotedNote(
    notePath: string,
    el: IrElement,
  ): Promise<void> {
    if (await this.app.vault.adapter.exists(notePath)) return;
    const folder = notePath.includes("/")
      ? notePath.slice(0, notePath.lastIndexOf("/"))
      : "";
    if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
      await this.app.vault.createFolder(folder);
    }
    const body = (el.text ?? "").trim() + "\n";
    const file = await this.app.vault.create(notePath, body);
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm[IR_KEYS.type] = "extract";
      fm[IR_KEYS.priority] = el.priority;
      writeTopicToFrontmatter(fm, newTopicState(this.settings));
    });
  }

  /**
   * Vault-delete handler. Routes the deletion through the pure
   * planSourceDeletion: source-tombstone, reparent children to grandparent,
   * delete source-element shadows, detach anchors, auto-promote
   * genuinely-rootless extracts to standalone notes. Filesystem work
   * (creating promoted notes) happens before the events are appended so the
   * store and disk land consistent; a write failure leaves the store
   * untouched.
   */
  private async handleSourceDeletion(deleted: TFile): Promise<void> {
    if (!this.store) return;
    try {
      const events = await this.store.loadEvents();
      const state = await this.store.load();
      const elements = Array.from(state.elements.values());
      const affected = elements.some(
        (e) =>
          e.notePath === deleted.path ||
          e.anchor?.sourcePath === deleted.path,
      );
      if (!affected) return;

      const newEvents = planSourceDeletion(
        elements,
        deleted.path,
        deleted.basename,
        Date.now(),
        nextLamport(events),
        await this.store.getDeviceId(),
        () => newEventId(),
        (el) => this.promoteOrphanPath(el),
        { autoPromoteRootless: true },
      );

      const byId = new Map(elements.map((e) => [e.id, e]));
      for (const ev of newEvents) {
        if (ev.kind === "promoted") {
          const path = (ev.payload as { notePath?: string }).notePath;
          const el = byId.get(ev.target);
          if (path && el) await this.materializePromotedNote(path, el);
        }
      }

      for (const ev of newEvents) await this.store.appendEvent(ev);
      await this.store.reconcile();

      const promoted = newEvents.filter((e) => e.kind === "promoted").length;
      const reparented = newEvents.filter((e) => e.kind === "reparented")
        .length;
      const parts: string[] = [];
      if (promoted)
        parts.push(`${promoted} extract${promoted === 1 ? "" : "s"} promoted`);
      if (reparented)
        parts.push(`${reparented} reparented`);
      const detail = parts.length > 0 ? ` (${parts.join(", ")})` : "";
      new Notice(
        `Incremental Reading: source "${deleted.basename}" removed${detail}.`,
      );
    } catch (e) {
      console.error("Incremental Reading: deletion handling failed", e);
    }
  }

  private async toggleDismiss(file: TFile) {
    const dismiss = !isDismissed(this.app, file);
    await setDismissed(this.app, file, dismiss);
    new Notice(
      `${dismiss ? "Dismissed" : "Restored"} "${file.basename}".`,
    );
    void this.refreshStatusBar();
  }

  /** Radial wheel: contextual IR actions; always opens so placement stays predictable. */
  private irRadialAnchor(): { cx: number; cy: number } {
    const leaf = this.app.workspace.activeLeaf;
    const el = leaf?.view?.containerEl;
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.width > 40 && r.height > 40) {
        return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
      }
    }
    return { cx: window.innerWidth / 2, cy: window.innerHeight / 2 };
  }

  /** Command palette / ribbon / review: contextual IR actions as a radial wheel. */
  private async openIrActionsHub(): Promise<void> {
    if (!this.store) {
      new Notice("Incremental Reading: store is not ready.");
      return;
    }
    const entries = await this.buildIrHubEntries();
    openIrRadialQuickMenu(this.app, entries, this.irRadialAnchor());
  }

  private async buildIrHubEntries(): Promise<IrHubEntry[]> {
    const out: IrHubEntry[] = [];
    const mv = this.app.workspace.getActiveViewOfType(MarkdownView);
    const file = mv?.file ?? this.app.workspace.getActiveFile();
    const editor = mv?.editor;
    const sel = editor?.getSelection().trim() ?? "";

    if (editor && file && sel) {
      out.push({
        title: "New cloze card (separate item)",
        description:
          "Creates a new FSRS item under the reading parent. On an IR item note, uses ir-parent instead of adding to the same file.",
        icon: "copy-plus",
        run: () => this.newClozeCardFromSelection(editor, file),
      });
    }

    if (file?.extension === "md" && getIrType(this.app, file) === "item") {
      let raw = "";
      if (mv?.file === file) raw = mv.editor.getValue();
      else raw = await this.app.vault.cachedRead(file);
      const body = stripFrontmatter(raw);
      if (listClozeGroupNumbers(body).length >= 2) {
        out.push({
          title: "Split cloze into separate item notes",
          description:
            "One new note per {{cN::…}} group; each gets its own FSRS card. The original note is left unchanged.",
          icon: "split",
          run: () => this.splitClozeInActiveEditor(),
        });
      }
    }

    if (file?.extension === "md" && this.store) {
      const state = await this.store.load();
      for (const el of state.elements.values()) {
        if (el.type === "extract" && el.notePath === file.path) {
          out.push({
            title: "Fork this extract",
            description:
              "Duplicate this reading element (promoted extract: copy note; anchored: second store element).",
            icon: "git-branch",
            run: () => this.forkStoreExtract(el.id),
          });
          break;
        }
      }
    }

    // Fast extract-authoring entries: only surface ones that would actually
    // do something from the current cursor/selection so the wheel stays a
    // contextual launcher, not a static menu. Editor + IR-source-typed file
    // is the gate — items don't extract from themselves, plain notes get
    // the mark-as-topic prompt elsewhere.
    if (editor && file?.extension === "md") {
      const irType = getIrType(this.app, file);
      if (irType === "topic" || irType === "extract") {
        out.push(...this.bulkExtractRadialEntries(editor, file, sel));
      }
    }

    return out;
  }

  /**
   * Compute which of the 5 fast-extract commands are applicable to the
   * current cursor/selection state, with counts in the description so the
   * user knows what a bulk action will mint before clicking. Entries are
   * built in priority order: cursor-driven (paragraph, heading section)
   * first, then selection-bounded bulk extracts.
   */
  private bulkExtractRadialEntries(
    editor: Editor,
    file: TFile,
    selection: string,
  ): IrHubEntry[] {
    const out: IrHubEntry[] = [];
    const fullText = editor.getValue();
    const body = stripFrontmatter(fullText);
    const cursor = editor.posToOffset(editor.getCursor());
    const cursorInBody = this.bodyOffsetOfFullCursor(fullText, body, cursor);
    const range = selection
      ? this.editorSelectionAsBodyRange(editor, fullText, body)
      : null;

    if (findParagraphAtOffset(body, cursorInBody)) {
      out.push({
        title: "Extract paragraph at cursor",
        description:
          "Anchored extract of the paragraph the cursor sits in. No selection needed.",
        icon: "pilcrow",
        run: () => this.extractParagraphAtCursor(editor, file),
      });
    }

    if (findHeadingSectionAtOffset(body, cursorInBody)) {
      out.push({
        title: "Extract heading section at cursor",
        description:
          "Anchored extract from the nearest preceding heading down to the next same-or-higher heading.",
        icon: "heading",
        run: () => this.extractHeadingSectionAtCursor(editor, file),
      });
    }

    // Blockquotes: scope to selection when present, else whole note. Surface
    // when there are at least 2 (or 1 with an explicit selection — then the
    // user clearly meant "extract this quote"). A 1-quote whole-note hit is
    // redundant with the regular Extract command.
    const bqs = findAllBlockquotes(body, range ?? undefined);
    if (bqs.length >= 2 || (bqs.length === 1 && range !== null)) {
      out.push({
        title: `Extract every blockquote (${bqs.length})`,
        description: range
          ? `Anchored extract per contiguous blockquote in your selection (${bqs.length} found).`
          : `Anchored extract per contiguous blockquote in this note (${bqs.length} found).`,
        icon: "quote",
        run: () => this.extractEveryBlockquote(editor, file),
      });
    }

    if (range) {
      const items = findAllListItems(body, range);
      if (items.length >= 2) {
        out.push({
          title: `Extract every list item (${items.length})`,
          description: `One anchored extract per bullet/numbered item in the selection (${items.length} found). Indent-aware: nested items split into their own extracts.`,
          icon: "list",
          run: () => this.extractEveryListItemInSelection(editor, file),
        });
      }

      const paras = findAllParagraphs(body, range);
      if (paras.length >= 2) {
        out.push({
          title: `Extract every paragraph (${paras.length})`,
          description: `One anchored extract per blank-line-separated block in the selection (${paras.length} found).`,
          icon: "align-left",
          run: () => this.extractEveryParagraphInSelection(editor, file),
        });
      }
    }

    return out;
  }

  /**
   * Like Alt+Z on a topic/extract, but when the editor is on an **item** note
   * the new cloze is still placed under the item's `ir-parent` reading source
   * instead of splicing into the current note.
   */
  private async newClozeCardFromSelection(
    editor: Editor,
    file: TFile,
  ): Promise<void> {
    let parentFile = file;
    if (getIrType(this.app, file) === "item") {
      const p = this.app.metadataCache.getFileCache(file)?.frontmatter?.[
        IR_KEYS.parent
      ];
      if (typeof p !== "string" || !p.length) {
        new Notice(
          "Incremental Reading: this item has no ir-parent; cannot place a sibling card.",
        );
        return;
      }
      const abs = this.app.vault.getAbstractFileByPath(p);
      if (!(abs instanceof TFile)) {
        new Notice("Incremental Reading: parent note not found.");
        return;
      }
      parentFile = abs;
    }
    if (!(await this.ensureIrSource(parentFile))) return;
    const hintR = await promptClozeHint(this.app);
    if (!hintR.ok) return;
    // Editor is on the item note, not the parent — its offsets only mark the
    // item itself (which is harmless but redundant). Skip source marking here
    // because the parent's matching span needs text-based lookup, not editor
    // offsets, and the user can re-cloze inside the parent if they want a
    // visible mark on the source.
    const result = await createCloze(
      this.app,
      parentFile,
      editor,
      this.settings,
      hintR.hint,
    );
    await this.openResult(result, "New cloze item created:");
  }

  private async splitClozeInActiveEditor(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") {
      new Notice("Incremental Reading: open an IR item note.");
      return;
    }
    if (getIrType(this.app, file) !== "item") {
      new Notice("Incremental Reading: split cloze requires an IR item note.");
      return;
    }
    const mv = this.app.workspace.getActiveViewOfType(MarkdownView);
    const raw =
      mv?.file === file ? mv.editor.getValue() : await this.app.vault.cachedRead(file);
    const body = stripFrontmatter(raw);
    const groups = listClozeGroupNumbers(body);
    if (groups.length < 2) {
      new Notice(
        "Incremental Reading: need at least two {{cN::…}} groups to split.",
      );
      return;
    }
    const p = this.app.metadataCache.getFileCache(file)?.frontmatter?.[
      IR_KEYS.parent
    ];
    if (typeof p !== "string" || !p.length) {
      new Notice("Incremental Reading: this item has no ir-parent path.");
      return;
    }
    const parentAbs = this.app.vault.getAbstractFileByPath(p);
    if (!(parentAbs instanceof TFile)) {
      new Notice("Incremental Reading: parent note not found.");
      return;
    }
    if (!(await this.ensureIrSource(parentAbs))) return;

    let created = 0;
    for (const n of groups) {
      const piece = bodyWithSingleClozeGroup(body, n);
      const stem = `split c${n}`;
      const result = await createIrItemChildNote(
        this.app,
        parentAbs,
        piece,
        stem,
        this.settings,
      );
      if (!result.file) {
        new Notice(`Incremental Reading: ${result.error}`);
        return;
      }
      await this.recordElement(result.file);
      created += 1;
    }
    new Notice(
      `Incremental Reading: created ${created} separate item note${created === 1 ? "" : "s"}.`,
    );
  }

  /**
   * Second reading element with the same text/anchor as an existing extract.
   * Promoted extracts (vault note) are forked by copying the markdown file.
   */
  private async forkStoreExtract(elementId: ElementId): Promise<void> {
    if (!this.store) {
      new Notice("Incremental Reading: store is not ready.");
      return;
    }
    const state = await this.store.load();
    const el = state.elements.get(elementId);
    if (!el || el.type !== "extract") {
      new Notice("Incremental Reading: fork only applies to IR extracts.");
      return;
    }
    const device = await this.store.getDeviceId();
    const now = Date.now();

    if (el.notePath) {
      const src = this.app.vault.getAbstractFileByPath(el.notePath);
      if (!(src instanceof TFile)) {
        new Notice("Incremental Reading: extract note not found in vault.");
        return;
      }
      const parentDir = src.parent?.path ?? "";
      const baseStem = src.basename.replace(/\.md$/i, "");
      const newPath = uniqueMarkdownNotePath(
        this.app,
        parentDir,
        `${baseStem} (fork)`,
      );
      await this.app.vault.copy(src, newPath);
      const nf = this.app.vault.getAbstractFileByPath(newPath);
      if (!(nf instanceof TFile)) {
        new Notice("Incremental Reading: fork copy failed.");
        return;
      }
      await this.app.fileManager.processFrontMatter(nf, (fm) => {
        writeTopicToFrontmatter(fm, newTopicState(this.settings, new Date(now)));
      });
      await this.recordElement(nf);
      new Notice(`Incremental Reading: forked extract to "${nf.basename}".`);
      void this.refreshStatusBar();
      return;
    }

    const newEl: IrElement = {
      ...el,
      id: newElementId(),
      created: now,
      dismissed: false,
      schedule: topicStateToSchedule(
        newTopicState(this.settings, new Date(now)),
      ),
      anchor: el.anchor
        ? {
            sourcePath: el.anchor.sourcePath,
            quote: { ...el.anchor.quote },
            position: el.anchor.position
              ? { ...el.anchor.position }
              : undefined,
            blockId: el.anchor.blockId,
          }
        : undefined,
    };

    await this.store.appendEvent({
      id: newEventId(),
      ts: now,
      lamport: now,
      device,
      kind: "element-created",
      target: newEl.id,
      payload: { element: newEl },
    });
    await this.store.reconcile().catch((e) => {
      console.error("Incremental Reading: reconcile after fork failed", e);
    });
    new Notice("Incremental Reading: forked extract (second reading element).");
    void this.refreshStatusBar();
  }

  private async openResult(result: IrNoteResult, verb: string) {
    if (!result.file) {
      new Notice(`Incremental Reading: ${result.error}`);
      return;
    }
    await this.recordElement(result.file);
    new Notice(`${verb} "${result.file.basename}".`);
    await this.app.workspace.getLeaf(true).openFile(result.file);
  }

  private async markActiveFileAsTopic(file?: TFile) {
    const target = file ?? this.app.workspace.getActiveFile();
    if (!target || target.extension !== "md") {
      new Notice("Incremental Reading: no active Markdown note.");
      return;
    }

    const existing = getIrType(this.app, target);
    if (existing === "topic") {
      new Notice(`"${target.basename}" is already an IR topic.`);
      return;
    }

    const marked = await markAsTopic(this.app, target, this.settings);
    if (marked) {
      await this.recordElement(target);
      new Notice(`Marked "${target.basename}" as an IR topic.`);
    }
  }

  /**
   * Mirror a just-created/marked note into the store as an `element-created`
   * event so it reaches the store-backed queue. Reuses the *pure*
   * `migrateNotes` transform on a single note: the element is built exactly
   * as a migration would build it, with the same path-derived id, so this is
   * idempotent and consistent with the rest of the store. Frontmatter (just
   * written by the ir-note helpers) is the dual-write fallback and is read
   * back atomically via `processFrontMatter`, which is reliable immediately
   * after creation where `metadataCache` may still be stale.
   */
  private async recordElement(file: TFile): Promise<void> {
    if (!this.store) return;
    try {
      let fm: Record<string, unknown> = {};
      await this.app.fileManager.processFrontMatter(file, (f) => {
        fm = { ...f };
      });
      const events = migrateNotes(
        [{ path: file.path, frontmatter: fm }],
        Date.now(),
      );
      for (const ev of events) {
        await this.store.appendEvent(ev);
      }
      await this.store.reconcile();
      void this.refreshStatusBar();
    } catch (e) {
      console.error("Incremental Reading: recording element failed", e);
      new Notice(
        "Incremental Reading: could not record the new element in the " +
          "store; it is still in the note. See the developer console.",
      );
    }
  }

  /**
   * Migration controller (maintainer-owned; see docs/DESIGN.md "Integration").
   *
   * This is the one place that touches both worlds: it constructs the store
   * over the Obsidian data adapter, decides whether a migration is owed,
   * drives the *pure* `migrateNotes` transform with frontmatter read out of
   * `metadataCache`, and lands the result through the store's append +
   * reconcile path.
   *
   * Three invariants make this safe enough to run unattended on load, since
   * no mechanical oracle can gate a one-way data move:
   *
   * - Guarded / runs once. The presence of `.ir/meta.json` is the marker.
   *   `store.init()` writes it (with `device.json`) before any append, so a
   *   second load short-circuits here.
   * - Reversible. The controller itself never touches note frontmatter; the
   *   migrated log is written alongside under `.ir/`, never in place of
   *   anything. Post-cutover the store drives the queue, but every review
   *   action still dual-writes the old `ir-` keys, so frontmatter remains a
   *   complete, hand-readable fallback.
   * - Idempotent. `migrateNotes` derives element and event ids from the note
   *   path, so even if the marker were lost and this re-ran, the fold
   *   collapses the re-created elements to the identical state.
   *
   * A failure is reported and swallowed: a half-written `.ir/` is inert while
   * frontmatter remains authoritative, and breaking `onload` would take the
   * whole plugin (commands, review) down with it.
   */
  private async runMigrationIfOwed(): Promise<void> {
    const fs = new ObsidianVaultFs(
      this.app.vault.adapter as unknown as ObsidianDataAdapter,
    );
    // clock-order, not conservative: on the live single-device plugin the
    // newest event must win, otherwise a "graded" event whose due moves
    // later than the migrated card is folded away and the item never
    // reschedules. This matches the Obsidian-Sync last-write-wins model the
    // log is designed around; the raw log is intact either way, so a
    // re-fold under another policy stays possible.
    const store = new IrStore(fs, { conflict: "clock-order" });

    try {
      // Detection happens before init(): init() is what writes the marker.
      if (await fs.exists(META)) {
        this.store = store;
        return;
      }

      // Marker + device id first, so the append below has a shard to write
      // to and a re-run sees the marker.
      await store.init();

      const notes = this.enumerateIrNotes();
      const events = migrateNotes(notes, Date.now());
      for (const ev of events) {
        await store.appendEvent(ev);
      }
      await store.reconcile();

      this.store = store;
      if (events.length > 0) {
        new Notice(
          `Incremental Reading: migrated ${events.length} element` +
            `${events.length === 1 ? "" : "s"} into the new store. ` +
            `Frontmatter is kept as a fallback.`,
        );
      }
    } catch (e) {
      console.error("Incremental Reading: migration failed", e);
      new Notice(
        "Incremental Reading: store migration failed; your notes are " +
          "untouched and still drive the plugin. See the developer console.",
      );
    }
  }

  /**
   * Enumerate IR notes via `metadataCache` and shape them for the pure
   * migration. We hand `migrateNotes` only notes that already declare an
   * `ir-type` (it filters again by construction); the cached frontmatter is
   * exactly what the old frontmatter readers consumed, so migrated state is
   * equivalent to what the live plugin saw.
   */
  private enumerateIrNotes(): FrontmatterNote[] {
    const out: FrontmatterNote[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (fm && getIrType(this.app, file)) {
        out.push({
          path: file.path,
          frontmatter: fm as Record<string, unknown>,
        });
      }
    }
    return out;
  }

  async loadSettings() {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      (await this.loadData()) as Partial<IrSettings> | null,
    );
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
