import {
  Editor,
  MarkdownView,
  Menu,
  Modal,
  Notice,
  Platform,
  Plugin,
  TFile,
  TFolder,
  WorkspaceLeaf,
} from "obsidian";
import { DEFAULT_SETTINGS, IrSettingTab, IrSettings } from "./src/settings";
import { resolveShowDivergencePicker } from "./src/ir/settings-resolve";
import { isSpaceAfterReveal } from "./src/ir/review-keys";
import { buildTextQuoteAnchor } from "./src/ir/cloze-marks";
import { IR_TREE_VIEW_TYPE, IrTreeView } from "./src/tree-view";
import { IR_SESSION_VIEW_TYPE, IrSessionView } from "./src/session-view";
import { IR_STATS_VIEW_TYPE, IrStatsView } from "./src/stats-view";
import {
  IrNoteResult,
  applyInheritedFrontmatter,
  createCloze,
  createClozeFromText,
  createIrItemChildNote,
  getIrType,
  getPriority,
  inheritableFrontmatter,
  isDismissed,
  markAsTopic,
  quietFrontmatterWrite,
  setDismissed,
  setPriority,
  uniqueMarkdownNotePath,
} from "./src/ir-note";
import { dueQueue, neuralQueue, EMPTY_COLLECTION_COPY, EMPTY_NEURAL_COPY, type ReviewSlot } from "./src/review";
import { makeLcg } from "./src/ir/neural";
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
import { planOrphanRecoveries } from "./src/ir/orphan-notes";
import { toAnkiTsv } from "./src/ir/anki-export";
import { planClearTombstone, planSourceDeletion, planSourceRelink, planSourceTombstoneOnly, planUndoSourceDeletion, missingSourcePaths, relinkCandidates, titleFromSourcePath } from "./src/ir/deletion";
import {
  basenameOf,
  inferPrefixRewrite,
  pathIsUnder,
  relocatedBySuffix,
  rewriteStoredPath,
  sourcePathRewrites,
  uniqueMovedPath,
} from "./src/ir/source-paths";
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
import { promptClozeHintInline } from "./src/cloze-hint-bar";
import {
  promptNukeConfirm,
  promptStateResetConfirm,
} from "./src/nuke-confirm-modal";
import { promptSourceRelink } from "./src/relink-confirm-modal";
import { promptSourceGone, type SourceGoneChoice } from "./src/source-gone-modal";
import { planBulkImport } from "./src/ir/bulk-import";
import { folderTopicCandidates } from "./src/ir/folder-topics";
import { buildExtractEvent, buildPdfExtractEvent, buildPromoteEvent } from "./src/ir/extract";
import { resolveAnchor } from "./src/ir/anchor";
import {
  IrDecorationCache,
  createIrExtractMarkdownPostProcessor,
  irExtractDecorationsExtension,
  pushIrDecorations,
  refreshIrDecorationCache,
} from "./src/ir/extract-decorations";
import { isPdfPath, formatPdfLinktext } from "./src/ir/pdf-fragment";
import { buildPdfTopicEvent } from "./src/ir/pdf-topic";
import { pdfMarksBySourcePath, type PdfExtractMark } from "./src/ir/pdf-marks";
import { PdfHighlightPainter } from "./src/ir/pdf-decorations";
import {
  findPdfTextSelection,
  type PdfTextSelection,
  activeIrFile,
} from "./src/ir/pdf-view";
import {
  bodyOffsetsFromFullOffsets,
  fullOffsetsFromBodyOffsets,
  stripFrontmatter,
} from "./src/ir/frontmatter-body";
import {
  locateTextInBody,
  mapRenderedSelectionToRaw,
  SWITCH_TO_EDIT_COPY,
} from "./src/ir/selection-map";
import {
  captureEditorSelection,
  restoreEditorSelection,
  snapshotSelectionText,
  type EditorSelectionSnapshot,
} from "./src/ir/editor-selection-snapshot";
import {
  findAllBlockquotes,
  findAllListItems,
  findAllParagraphs,
  findHeadingSectionAtOffset,
  findParagraphAtOffset,
  type Span,
} from "./src/ir/extract-spans";
import {
  openIrRadialQuickMenu,
  type IrHubEntry,
} from "./src/ir-actions-radial";
import {
  notifyWorkspaceFabSync,
  registerWorkspaceIrFab,
} from "./src/ir-mobile-fab";
import { sessionHubKinds } from "./src/ir/mobile-hub";
import { radialAnchorCenterBottom } from "./src/ir/mobile-viewport";

/**
 * The bulk-extract commands ask for confirmation above this many candidate
 * spans. Picked to be permissive for typical fact-list notes (40 bullets is
 * fine without a prompt) while still catching the "I accidentally selected
 * a 300-paragraph book chapter" mistake before it explodes the queue.
 */
const BULK_EXTRACT_CONFIRM_THRESHOLD = 50;

/** Folder "mark all as topics" asks before writing this many new frontmatters. */
const FOLDER_TOPIC_CONFIRM_THRESHOLD = 10;

/**
 * Machine-identifying string passed to `IrStore.init` so each physical
 * Obsidian install gets its own device id (DESIGN §Q2 fix). Falls back to
 * `"unknown"` on platforms where `os.hostname()` isn't reachable — a single
 * "unknown" device is still an improvement over every device sharing the
 * id baked into a synced `.ir/device.json`. Wrapped in try/catch because
 * Obsidian Mobile sandboxes Node modules and may throw on `require`.
 */
function getMachineHostname(): string {
  try {
    const os = (window as unknown as { require?: (m: string) => unknown })
      .require?.("os") as { hostname?: () => string } | undefined;
    const h = os?.hostname?.();
    if (typeof h === "string" && h.length > 0) return h;
  } catch {
    // fall through
  }
  return "unknown";
}

/** Bound a vault-adapter call so a hung Capacitor/iCloud exists() cannot stall onload. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(
      () =>
        reject(
          new Error(
            `Incremental Reading: ${label} timed out after ${ms}ms`,
          ),
        ),
      ms,
    );
    p.then(
      (v) => {
        window.clearTimeout(t);
        resolve(v);
      },
      (e) => {
        window.clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** True when `span` shares any byte with at least one range in `ranges`. */
function rangesOverlapAny(
  span: Span,
  ranges: ReadonlyArray<Span>,
): boolean {
  for (const r of ranges) {
    if (span.start < r.end && r.start < span.end) return true;
  }
  return false;
}

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
  private irReviewSession: { queue: ReviewSlot[]; elementsById: Map<ElementId, IrElement>; isNeural?: boolean; emptyVault?: boolean; } | null = null;

  /**
   * The store, constructed once the layout exists (after a migration, or
   * immediately when `.ir/` is already present). It is the source of truth
   * for the queue and review loop; frontmatter is dual-written on every
   * action only as the migration fallback.
   */
  private store?: IrStore;

  /**
   * Store init / first-run migration. Started from onload but not awaited
   * there: a hung `.ir/` exists() on mobile must not block command and FAB
   * registration. Callers that need a ready store await this.
   */
  private storeInit: Promise<void> = Promise.resolve();

  /** Status bar queue-load indicator (UI commitment #4). */
  private statusBarEl?: HTMLElement;

  /**
   * Markdown selection captured on FAB pointerdown before mobile blur clears
   * it; used to build the radial and restore cursors when a petal runs.
   */
  private hubSelectionSnapshot: EditorSelectionSnapshot | null = null;

  /**
   * Wall-clock when the current review pass started (Alt+R / Alt+N). The
   * session audit (UI commitment #7) filters the store event log to events
   * newer than this. Infinity until the first pass so plugin-load noise
   * does not masquerade as a review.
   */
  private sessionStartMs = Number.POSITIVE_INFINITY;

  /**
   * Set true while {@link nukeAllIrData} is trashing notes so the vault
   * delete listener skips its auto-promote / tombstone work — otherwise the
   * handler would spawn replacement "orphan-…" notes for every extract whose
   * parent we just trashed, defeating the whole point of a reset.
   */
  private nuking = false;

  /** Serialize Q1 comes-back prompts so create + load scan don't stack modals. */
  private relinkBusy = false;
  private relinkQueue: TFile[] = [];

  /** Serialize source-gone prompts (live delete + load-time reconcile). */
  private sourceGoneBusy = false;
  private sourceGoneQueue: { path: string; title: string }[] = [];
  private sourceGoneApplyAll: SourceGoneChoice | null = null;
  /**
   * Deletes that may actually be a folder move (Obsidian often fires
   * delete+create, or only a folder-level rename). Settled after a quiet
   * period so we can rewrite paths instead of prompting per file.
   */
  private pendingGone = new Map<string, { title: string }>();
  private goneSettleTimer: number | null = null;
  private lastSourceDeletionUndo: {
    before: IrElement[];
    deletionEvents: IrEvent[];
    promotedPaths: string[];
  } | null = null;

  /**
   * Decoration cache that the CM6 extension reads from. Rebuilt by
   * {@link refreshExtractDecorations} after every store reconcile so new
   * extracts paint instantly without re-resolving anchors on each keystroke.
   */
  private decorationCache = new IrDecorationCache();

  /** Store-only PDF topics (`notePath` ends in .pdf). Sync after each reconcile. */
  private irPdfPaths = new Set<string>();

  private pdfHighlights?: PdfHighlightPainter;
  private lastPdfMarks = new Map<string, PdfExtractMark[]>();
  /** Survives the click that focuses review and collapses the PDF selection. */
  private lastPdfSelection: PdfTextSelection | null = null;

  async onload() {
    await this.loadSettings();
    const fs = new ObsidianVaultFs(
      this.app.vault.adapter as unknown as ObsidianDataAdapter,
    );
    this.store = new IrStore(fs, { conflict: "clock-order" });
    this.storeInit = this.runMigrationIfOwed(fs);
    this.addSettingTab(new IrSettingTab(this.app, this));
    this.pdfHighlights = new PdfHighlightPainter(this.app);
    this.registerDomEvent(document, "selectionchange", () => {
      const sel = findPdfTextSelection(this.app);
      if (sel) this.lastPdfSelection = sel;
    });

    // Editor decoration extension (DESIGN §Q3). Registered before any extract
    // command so the first highlight after onload paints into a wired editor.
    this.registerEditorExtension(irExtractDecorationsExtension());
    // Reading-view post-processor (DESIGN §Q3 follow-up). Best-effort
    // text-quote search; see `createIrExtractMarkdownPostProcessor` for the
    // limitations.
    this.registerMarkdownPostProcessor(
      createIrExtractMarkdownPostProcessor(this.decorationCache),
    );
    // Repaint when the workspace mounts a different file in a leaf — the new
    // editor's decoration field starts empty until we push.
    this.registerEvent(
      this.app.workspace.on("file-open", () => {
        pushIrDecorations(this.app, this.decorationCache);
        this.paintPdfHighlights();
      }),
    );
    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        pushIrDecorations(this.app, this.decorationCache);
        this.paintPdfHighlights();
      }),
    );
    // Initial decoration paint runs once the store is ready, below.
    void this.refreshExtractDecorations();

    // Glanceable queue-load indicator. Built before any other UI so it shows
    // up immediately, and refreshed once the store is ready below.
    this.statusBarEl = this.addStatusBarItem();
    renderStatusBar(
      this.statusBarEl,
      { due: 0, later: 0, postponed: 0, inflow7d: 0, dueByType: { topic: 0, extract: 0, item: 0 } },
      () => void this.startReview(),
      (evt) => this.showStatusBarMenu(evt),
    );
    void this.refreshStatusBar();
    void this.storeInit.then(() => {
      void this.refreshStatusBar();
      void this.reconcileMissingSources().then(() => this.offerPendingRelinks());
    });

    // Background tick: refreshes the "+N/7d" rolling window so it does not
    // drift when nothing in the plugin is triggering a redraw. Cheap (reads
    // a folded in-memory state). Cleaned up automatically on unload via
    // registerInterval.
    this.registerInterval(
      window.setInterval(() => void this.refreshStatusBar(), 60_000),
    );

    if (Platform.isMobile) {
      this.register(
        registerWorkspaceIrFab(this, {
          prepareOpenHub: () => this.captureHubEditorSelection(),
          openHub: () => void this.openIrActionsHub(),
        }),
      );
    }

    this.addRibbonIcon("brain-circuit", "Start IR review", () => {
      void this.startReview();
    });

    this.addCommand({
      id: "start-neural-review",
      name: "Go neural",
      icon: "network",
      hotkeys: [{ modifiers: ["Alt"], key: "n" }],
      checkCallback: (checking) => {
        if (!this.canGoNeuralFromContext()) return false;
        if (!checking) void this.startNeuralReviewFromActiveNote();
        return true;
      },
    });

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
          (elementId) => void this.startNeuralReview(elementId, null),
          (elementId) =>
            this.getActiveReviewView()?.jumpToElement(elementId) ?? false,
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
        return new IrSessionView(
          leaf,
          this.store,
          this.sessionStartMs,
          (id, notePath) => this.revealSessionEntry(id, notePath),
        );
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
        const isNeural = session?.isNeural ?? false;
        const emptyVault = session?.emptyVault ?? false;
        this.irReviewSession = null;
        const queue = session?.queue ?? [];
        const elementsById = session?.elementsById ?? new Map<ElementId, IrElement>();
        return new IrReviewView(
          leaf,
          this,
          this.settings,
          this.store,
          queue,
          elementsById,
          isNeural,
          () => void this.refreshStatusBar(),
          () => void this.openIrActionsHub(),
          (id) => {
            this.notifyTreeOfReviewSlot(id);
            this.paintPdfHighlights();
          },
          notifyWorkspaceFabSync,
          () => this.undoLastGrade(),
          (path) => this.decorationCache.rangesFor(path),
          () => this.refreshExtractDecorations(),
          (id, el) => this.applyIrPromote(id, el),
          () => this.restoreEmptyReviewSession(),
          (id, el) => this.applyIrReanchor(id, el),
          (id, el) => this.applyIrDetachAnchor(id, el),
          () => void this.startReview(),
          emptyVault,
          (opts) => this.extractFromPdfInReview(opts),
        );
      },
    );

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
      // Markdown notes and PDFs (store-only; PDFs have no YAML).
      checkCallback: (checking: boolean) => {
        const file = activeIrFile(this.app);
        if (!file || (file.extension !== "md" && file.extension !== "pdf")) {
          return false;
        }
        if (!checking) void this.markActiveFileAsTopic(file);
        return true;
      },
    });

    this.addCommand({
      id: "mark-folder-as-ir-topics",
      name: "Mark folder notes as IR topics",
      icon: "book-open",
      checkCallback: (checking) => {
        const folder = this.folderForTopicCommand();
        if (!folder) return false;
        if (!checking) void this.markFolderAsTopics(folder);
        return true;
      },
    });

    // SuperMemo parity: Alt+X extract, Alt+Z cloze. Defaults only; users
    // can rebind or clear them in Settings -> Hotkeys.
    // Uses checkCallback (not editorCheckCallback) so the hotkey also works
    // inside the IR review ItemView, which is not a MarkdownView.
    this.addCommand({
      id: "extract-selection",
      name: "Extract selection",
      icon: "scissors",
      hotkeys: [{ modifiers: ["Alt"], key: "x" }],
      checkCallback: (checking) => {
        const pdfSel = findPdfTextSelection(this.app);
        if (pdfSel) this.lastPdfSelection = pdfSel;
        if (pdfSel || this.lastPdfSelection) {
          if (!checking) {
            void this.extractFromPdfSelection(
              pdfSel ?? this.lastPdfSelection!,
            );
          }
          return true;
        }
        const rv = this.getActiveReviewView();
        if (rv) {
          if (!checking) void rv.handleExtract();
          return true;
        }
        const mv = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (mv?.file && this.markdownViewHasSelection(mv)) {
          if (!checking) void this.extractFromMarkdownView(mv);
          return true;
        }
        return false;
      },
    });

    // DESIGN §2: extracts stay anchored by default. This command is the
    // explicit promotion-at-extract-time path (GitHub #1) so a standalone
    // note is opt-in, not the default.
    this.addCommand({
      id: "extract-selection-to-note",
      name: "Extract selection to standalone note",
      icon: "file-plus",
      hotkeys: [{ modifiers: ["Alt", "Shift"], key: "x" }],
      checkCallback: (checking) => {
        const pdfSel = findPdfTextSelection(this.app);
        if (pdfSel) this.lastPdfSelection = pdfSel;
        if (pdfSel || this.lastPdfSelection) {
          if (!checking) {
            void this.extractFromPdfSelection(
              pdfSel ?? this.lastPdfSelection!,
              { promote: true },
            );
          }
          return true;
        }
        const rv = this.getActiveReviewView();
        if (rv) {
          if (!checking) void this.extractSelectionToNoteFromReview(rv);
          return true;
        }
        const mv = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (mv?.file && this.markdownViewHasSelection(mv)) {
          if (!checking) {
            void this.extractFromMarkdownView(mv, { promote: true });
          }
          return true;
        }
        return false;
      },
    });

    this.addCommand({
      id: "promote-extract-to-note",
      name: "Promote extract to standalone note",
      icon: "file-output",
      hotkeys: [{ modifiers: ["Alt", "Shift"], key: "p" }],
      checkCallback: (checking) => {
        if (!this.canPromoteCurrentExtract()) return false;
        if (!checking) void this.promoteCurrentExtract();
        return true;
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
        if (mv?.file && this.markdownViewHasSelection(mv)) {
          if (!checking) void this.clozeFromMarkdownView(mv);
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
          if (Platform.isMobile) {
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
          }
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
              .setTitle(
                this.settings.extractCreatesStandaloneNote
                  ? "Extract to standalone note"
                  : "Extract (anchored in source)",
              )
              .setIcon("scissors")
              .onClick(() => void this.extractSelection(editor, file)),
          );
          if (!this.settings.extractCreatesStandaloneNote) {
            menu.addItem((item) =>
              item
                .setTitle("Extract to standalone note")
                .setIcon("file-plus")
                .onClick(() =>
                  void this.extractSelection(editor, file, { promote: true }),
                ),
            );
          }
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
    // Vault delete handler: a real delete is queued after a short settle so
    // a folder move (delete+create, or folder-level rename) can rewrite
    // stored paths instead of prompting once per file.
    this.registerEvent(
      this.app.vault.on("delete", (deleted) => {
        if (!(deleted instanceof TFile)) return;
        if (deleted.extension !== "md" && deleted.extension !== "pdf") return;
        this.irPdfPaths.delete(deleted.path);
        this.notePendingGone(deleted.path, deleted.basename);
      }),
    );

    this.registerEvent(
      this.app.vault.on("create", (created) => {
        if (!(created instanceof TFile)) return;
        if (created.extension !== "md" && created.extension !== "pdf") return;
        void this.tryMatchPendingGone(created);
        void this.maybeOfferRelink(created);
      }),
    );

    // File or folder. A folder rename does not always fire per-file rename.
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        this.clearPendingGoneUnder(oldPath);
        if (file instanceof TFolder) {
          void this.handleSourceRename(file, oldPath);
          return;
        }
        if (!(file instanceof TFile)) return;
        void this.handleSourceRename(file, oldPath).then(() =>
          this.maybeOfferRelink(file),
        );
      }),
    );

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu: Menu, file) => {
        if (file instanceof TFolder) {
          menu.addItem((item) =>
            item
              .setTitle("Mark folder notes as IR topics")
              .setIcon("book-open")
              .onClick(() => void this.markFolderAsTopics(file)),
          );
          return;
        }
        if (!(file instanceof TFile)) return;
        if (file.extension === "pdf") {
          if (!this.irPdfPaths.has(file.path)) {
            menu.addItem((item) =>
              item
                .setTitle("Mark as IR topic")
                .setIcon("book-open")
                .onClick(() => void this.markActiveFileAsTopic(file)),
            );
          }
          this.addMobileIrFileMenuNav(menu);
          return;
        }
        if (file.extension !== "md") return;
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

    this.registerEvent(
      // pdf-menu is an untyped core event (same hook PDF++ uses).
      this.app.workspace.on("pdf-menu" as "file-menu", (menu: Menu) => {
        const sel = findPdfTextSelection(this.app);
        if (!sel) return;
        menu.addItem((item) =>
          item
            .setTitle("Extract selection")
            .setIcon("scissors")
            .onClick(() => void this.extractFromPdfSelection(sel)),
        );
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
    const active = this.app.workspace.getActiveViewOfType(IrReviewView);
    if (active) return active;
    for (const leaf of this.app.workspace.getLeavesOfType(IR_REVIEW_VIEW_TYPE)) {
      if (leaf.view instanceof IrReviewView) return leaf.view;
    }
    return null;
  }

  private getTreeView(): IrTreeView | null {
    const leaf = this.app.workspace.getLeavesOfType(IR_TREE_VIEW_TYPE)[0];
    const view = leaf?.view;
    return view instanceof IrTreeView ? view : null;
  }

  private canPromoteCurrentExtract(): boolean {
    const rv = this.getActiveReviewView();
    if (rv?.getCurrentExtractForPromote()) return true;
    return this.getTreeView()?.hasUnpromotedExtractToPromote() ?? false;
  }

  private async promoteCurrentExtract(): Promise<void> {
    const rv = this.getActiveReviewView();
    const fromReview = rv?.getCurrentExtractForPromote();
    if (fromReview) {
      await this.applyIrPromote(fromReview.id, fromReview.element);
      return;
    }
    const fromTree = this.getTreeView()?.unpromotedExtractsToPromote() ?? [];
    if (fromTree.length === 0) {
      new Notice("Incremental Reading: no anchored extract to promote.");
      return;
    }
    for (const { id, element } of fromTree) {
      await this.applyIrPromote(id, element);
    }
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
    if (this.goneSettleTimer != null) {
      window.clearTimeout(this.goneSettleTimer);
      this.goneSettleTimer = null;
    }
    this.pdfHighlights?.detach();
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
   * Re-render the status bar from the current store state and repaint the
   * editor extract decorations from the same load. Safe to call before the
   * store is ready (it leaves a zero-state placeholder); safe to call
   * repeatedly (both renders are idempotent).
   *
   * Decorations piggyback here because they react to the same trigger the
   * status bar does (store changed) and pushing them on every reconcile from
   * its caller would require touching ~20 sites instead of one.
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
        (evt) => this.showStatusBarMenu(evt),
      );
      this.refreshAuxiliaryViews();
    } catch (e) {
      console.error("Incremental Reading: status bar refresh failed", e);
    }
    void this.refreshExtractDecorations();
  }

  private refreshAuxiliaryViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(IR_STATS_VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof IrStatsView) void view.refresh();
    }
    for (const leaf of this.app.workspace.getLeavesOfType(IR_SESSION_VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof IrSessionView) void view.render();
    }
  }

  /** Session log is this review, not plugin-load. Stamp when a pass starts. */
  private beginReviewSession(): void {
    this.sessionStartMs = Date.now();
    for (const leaf of this.app.workspace.getLeavesOfType(IR_SESSION_VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof IrSessionView) {
        view.setSessionStart(this.sessionStartMs);
        void view.render();
      }
    }
  }

  private revealSessionEntry(id: string, notePath?: string): void {
    const eid = id as ElementId;
    for (const leaf of this.app.workspace.getLeavesOfType(IR_REVIEW_VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof IrReviewView && view.jumpToElement(eid)) {
        this.app.workspace.revealLeaf(leaf);
        return;
      }
    }
    if (!notePath) {
      new Notice("Incremental Reading: that element has no note to open.");
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(notePath);
    if (!(file instanceof TFile)) {
      new Notice(`Incremental Reading: note "${notePath}" not found.`);
      return;
    }
    void this.app.workspace.getLeaf(false).openFile(file);
  }

  /**
   * Right-click (or long-press) on the status-bar load indicator. Replaces
   * the extra ribbon icons: tree, hub, mark-as-topic, neural, session, stats.
   */
  private showStatusBarMenu(evt: MouseEvent): void {
    evt.preventDefault();
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle("Start IR review")
        .setIcon("brain-circuit")
        .onClick(() => void this.startReview()),
    );
    if (this.canGoNeuralFromContext()) {
      menu.addItem((item) =>
        item
          .setTitle("Go neural")
          .setIcon("network")
          .onClick(() => void this.startNeuralReviewFromActiveNote()),
      );
    }
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle("Open IR element tree")
        .setIcon("list-tree")
        .onClick(() => void this.openTreeView()),
    );
    menu.addItem((item) =>
      item
        .setTitle("IR quick actions")
        .setIcon("layout-list")
        .onClick(() => void this.openIrActionsHub()),
    );
    menu.addItem((item) =>
      item
        .setTitle("Mark note as IR topic")
        .setIcon("book-open")
        .onClick(() => void this.markActiveFileAsTopic()),
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle("Open IR session log")
        .setIcon("history")
        .onClick(() => void this.openSessionView()),
    );
    menu.addItem((item) =>
      item
        .setTitle("Open IR stats")
        .setIcon("bar-chart")
        .onClick(() => void this.openStatsView()),
    );
    menu.showAtMouseEvent(evt);
  }

  /**
   * Workspace restore of an IR review leaf has no live session. Rebuild
   * today's due queue so the tab is usable, or return null so the view
   * can detach instead of showing a dead pane.
   */
  private async restoreEmptyReviewSession(): Promise<{
    queue: ReviewSlot[];
    elementsById: Map<ElementId, IrElement>;
    isNeural: boolean;
  } | null> {
    if (!this.store) return null;
    await this.storeInit;
    const state = await this.store.load();
    const queue = dueQueue(
      this.app,
      this.settings.reviewsPerReading,
      state,
      new Date(),
      this.settings.interleaveSimilarPriority,
    );
    if (queue.length === 0) return null;
    this.beginReviewSession();
    return { queue, elementsById: state.elements, isNeural: false };
  }

  private markdownViewHasSelection(mv: MarkdownView): boolean {
    if (mv.editor.getSelection().trim()) return true;
    return this.previewSelectionRange(mv) !== null;
  }

  private previewRoot(mv: MarkdownView): HTMLElement | null {
    return mv.contentEl.querySelector(".markdown-preview-view");
  }

  private previewSelectionRange(mv: MarkdownView): Range | null {
    const root = this.previewRoot(mv);
    if (!root) return null;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    if (!sel.anchorNode || !root.contains(sel.anchorNode)) return null;
    return sel.getRangeAt(0);
  }

  private clozeHintHost(): HTMLElement {
    const mv = this.app.workspace.getActiveViewOfType(MarkdownView);
    return mv?.contentEl ?? document.body;
  }

  private async switchMarkdownToSource(
    mv: MarkdownView,
    needle: string,
  ): Promise<void> {
    const vs = mv.leaf.getViewState();
    const prev =
      vs.state && typeof vs.state === "object"
        ? (vs.state as Record<string, unknown>)
        : {};
    await mv.leaf.setViewState({
      ...vs,
      state: { ...prev, mode: "source" },
    });
    const editor = mv.editor;
    const full = editor.getValue();
    const located = locateTextInBody(stripFrontmatter(full), needle);
    if (located) {
      const { from, to } = fullOffsetsFromBodyOffsets(
        full,
        located.start,
        located.end,
      );
      editor.setSelection(editor.offsetToPos(from), editor.offsetToPos(to));
    }
    new Notice(`Incremental Reading: ${SWITCH_TO_EDIT_COPY}`);
  }

  private async extractFromMarkdownView(
    mv: MarkdownView,
    opts?: { promote?: boolean },
  ): Promise<void> {
    const file = mv.file;
    if (!file) return;
    if (mv.editor.getSelection().trim()) {
      await this.extractSelection(mv.editor, file, opts);
      return;
    }
    const range = this.previewSelectionRange(mv);
    const root = this.previewRoot(mv);
    if (!range || !root) {
      new Notice("Incremental Reading: nothing selected.");
      return;
    }
    const body = stripFrontmatter(await this.app.vault.cachedRead(file));
    const mapped = mapRenderedSelectionToRaw(body, root, range);
    if (!mapped) {
      await this.switchMarkdownToSource(mv, range.toString());
      return;
    }
    await this.extractMappedBodyRange(file, mapped, opts);
  }

  private async extractMappedBodyRange(
    source: TFile,
    mapped: { start: number; end: number; text: string },
    opts?: { promote?: boolean },
  ): Promise<void> {
    if (!(await this.ensureIrSource(source))) return;
    if (!this.store) {
      new Notice("Incremental Reading: store is not ready.");
      return;
    }
    const selection = mapped.text.trim();
    if (!selection) {
      new Notice("Incremental Reading: nothing selected.");
      return;
    }
    const bodyBeforeExtract = stripFrontmatter(
      await this.app.vault.cachedRead(source),
    );
    const parentId =
      (await this.resolveElementIdForFile(source)) ??
      elementIdForPath(source.path);
    const now = Date.now();
    try {
      const ev = buildExtractEvent({
        sourcePath: source.path,
        sourceText: bodyBeforeExtract,
        selStart: mapped.start,
        selEnd: mapped.end,
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
      });
      await this.store.appendEvent(ev);
      await this.store.reconcile();
      void this.refreshStatusBar();
      const created = ev.payload.element as IrElement;
      const promote =
        opts?.promote ?? this.settings.extractCreatesStandaloneNote;
      if (promote) {
        await this.applyIrPromote(created.id, created);
        return;
      }
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

  private async clozeFromMarkdownView(mv: MarkdownView): Promise<void> {
    const file = mv.file;
    if (!file) return;
    if (mv.editor.getSelection().trim()) {
      await this.clozeSelection(mv.editor, file);
      return;
    }
    const range = this.previewSelectionRange(mv);
    const root = this.previewRoot(mv);
    if (!range || !root) {
      new Notice("Incremental Reading: nothing selected.");
      return;
    }
    const body = stripFrontmatter(await this.app.vault.cachedRead(file));
    const mapped = mapRenderedSelectionToRaw(body, root, range);
    if (!mapped) {
      await this.switchMarkdownToSource(mv, range.toString());
      return;
    }
    if (getIrType(this.app, file) === "item") {
      await this.switchMarkdownToSource(mv, mapped.text);
      return;
    }
    if (!(await this.ensureIrSource(file))) return;
    const hintR = await promptClozeHintInline(mv.contentEl);
    if (!hintR.ok) return;
    const result = await createClozeFromText(
      this.app,
      file,
      body,
      mapped.start,
      mapped.end,
      this.settings,
      hintR.hint,
    );
    await this.openResult(result, "Cloze item created:");
  }

  private async extractSelection(
    editor: Editor,
    source: TFile,
    opts?: { promote?: boolean },
  ) {
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
      });
      await this.store.appendEvent(ev);
      await this.store.reconcile();
      void this.refreshStatusBar();
      const created = ev.payload.element as IrElement;
      const promote =
        opts?.promote ?? this.settings.extractCreatesStandaloneNote;
      if (promote) {
        await this.applyIrPromote(created.id, created);
        return;
      }
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

  /**
   * Review-pane counterpart of extract-selection-to-note: force-promote
   * this extract even when the settings toggle is off.
   */
  private async extractSelectionToNoteFromReview(
    rv: IrReviewView,
  ): Promise<void> {
    await rv.handleExtract({ silent: true, promote: true });
  }

  private async extractFromPdfInReview(opts?: {
    promote?: boolean;
  }): Promise<IrElement | undefined> {
    const sel = findPdfTextSelection(this.app) ?? this.lastPdfSelection;
    if (!sel) return undefined;
    return this.extractFromPdfSelection(sel, opts);
  }

  private async extractFromPdfSelection(
    sel: PdfTextSelection,
    opts?: { promote?: boolean },
  ): Promise<IrElement | undefined> {
    if (!(await this.ensureIrSource(sel.file))) return;
    if (!this.store) {
      new Notice("Incremental Reading: store is not ready.");
      return;
    }
    const reviewParent = this.getActiveReviewView()?.pdfExtractParentId(
      sel.file.path,
    );
    const parentId =
      reviewParent ??
      (await this.resolveElementIdForFile(sel.file)) ??
      elementIdForPath(sel.file.path);
    const state = await this.store.load();
    const parent = state.elements.get(parentId);
    const now = Date.now();
    try {
      const ev = buildPdfExtractEvent({
        sourcePath: sel.file.path,
        text: sel.text,
        pdf: { page: sel.page, selection: sel.selection },
        parentId,
        priority: parent?.priority ?? this.settings.defaultPriority,
        elementId: newElementId(),
        eventId: newEventId(),
        device: await this.store.getDeviceId(),
        lamport: now,
        now,
        schedule: topicStateToSchedule(
          newTopicState(this.settings, new Date(now)),
        ),
      });
      await this.store.appendEvent(ev);
      await this.store.reconcile();
      void this.refreshStatusBar();
      const created = ev.payload.element as IrElement;
      const promote =
        opts?.promote ?? this.settings.extractCreatesStandaloneNote;
      if (promote) {
        await this.applyIrPromote(created.id, created);
        await this.refreshExtractDecorations();
        this.lastPdfSelection = null;
        return created;
      }
      this.getActiveReviewView()?.adoptElement(created);
      await this.refreshExtractDecorations();
      this.lastPdfSelection = null;
      new Notice(
        `Extracted (anchored in "${sel.file.basename}", page ${sel.page}).`,
      );
      return created;
    } catch (e) {
      console.error("Incremental Reading: PDF extract failed", e);
      new Notice(
        "Incremental Reading: could not record the extract in the store. See the developer console.",
      );
      return undefined;
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
  /** Public entry for review-pane radial bulk actions. */
  async runBulkExtractAnchored(
    source: TFile,
    spans: Span[],
    headlineLabel: string,
  ): Promise<void> {
    return this.bulkExtractAnchored(source, spans, headlineLabel);
  }

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
    // Decoration-only highlights (DESIGN §Q3) mean the source body holds no
    // `<mark>` chrome for new extracts, so the old "is this span inside a
    // mark?" test would always say no. Idempotency now comes from the store:
    // skip a span when its body offsets overlap any anchor we've already
    // recorded for this source path.
    const existingRanges = await this.existingExtractRangesForSource(
      source.path,
      initialBody,
    );
    const candidates: Span[] = [];
    for (const s of rawSpans) {
      if (s.end <= s.start) continue;
      if (s.end > initialBody.length) continue;
      if (rangesOverlapAny(s, existingRanges)) continue;
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

    // Order doesn't matter for offsets any more (the body isn't mutated),
    // but keep a stable descending sort so events written to the log have a
    // predictable order if the user inspects the shard.
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

    let created = 0;
    const createdEls: IrElement[] = [];
    for (const span of candidates) {
      const now = Date.now();
      try {
        const ev = buildExtractEvent({
          sourcePath: source.path,
          sourceText: initialBody,
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
        });
        await this.store.appendEvent(ev);
        createdEls.push(ev.payload.element as IrElement);
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

    await this.store.reconcile();
    void this.refreshStatusBar();
    const rv = this.getActiveReviewView();
    if (rv && rv.getCurrentReviewFile()?.path === source.path) {
      for (const el of createdEls) rv.adoptElement(el);
      rv.refreshView();
    }
    new Notice(
      `${headlineLabel}: ${created} extract${created === 1 ? "" : "s"} created.`,
    );
  }

  /**
   * Rebuild the editor decoration cache from the store, then push the result
   * to every open MarkdownView. Called after every reconcile path that can
   * change the set of resolved extract anchors (new extract, deletion,
   * re-anchor, store load on startup).
   */
  async refreshExtractDecorations(): Promise<void> {
    if (!this.store) return;
    try {
      await refreshIrDecorationCache(this.app, this.store, this.decorationCache);
      pushIrDecorations(this.app, this.decorationCache);
      const state = await this.store.load();
      this.irPdfPaths.clear();
      for (const el of state.elements.values()) {
        if (el.notePath && isPdfPath(el.notePath)) {
          this.irPdfPaths.add(el.notePath);
        }
      }
      this.lastPdfMarks = pdfMarksBySourcePath(state.elements.values());
      this.paintPdfHighlights();
    } catch (e) {
      console.error("Incremental Reading: decoration refresh failed", e);
    }
  }

  private paintPdfHighlights(): void {
    this.pdfHighlights?.refresh(
      this.lastPdfMarks,
      this.getActiveReviewView()?.getCurrentElementId() ?? null,
    );
  }

  /**
   * Resolve every extract anchor in the store whose `sourcePath` matches this
   * source against `body`, returning the in-body ranges the decoration would
   * paint over. Used to make bulk-extract idempotent: re-running on the same
   * note never duplicates an extract over a passage that already has one.
   *
   * Anchors that no longer resolve (needs-reanchor) are simply absent from
   * the returned set, which is the right behavior: a needs-reanchor extract
   * shouldn't block a re-extract of the same span.
   */
  private async existingExtractRangesForSource(
    sourcePath: string,
    body: string,
  ): Promise<Span[]> {
    if (!this.store) return [];
    const state = await this.store.load();
    const out: Span[] = [];
    for (const [, element] of state.elements) {
      if (element.type !== "extract") continue;
      // Include promoted extracts: their anchors still mark the source span.
      const a = element.anchor;
      if (!a || a.pdf || a.sourcePath !== sourcePath) continue;
      if (element.anchorState === "detached") continue;
      const r = resolveAnchor(a, body);
      if (r.status !== "ok") continue;
      out.push({ start: r.start, end: r.end });
    }
    return out;
  }

  /** Above this many spans the bulk commands prompt before writing. */
  private async confirmBulkExtract(count: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const modal = new Modal(this.app);
      modal.titleEl.setText(`Create ${count} extracts?`);
      modal.contentEl.createEl("p", {
        text:
          `This will mint ${count} anchored extracts against the source note. ` +
          "The note itself is not modified; highlights render as editor and " +
          "reading-view decorations. Reversible per-extract from the element " +
          "tree.",
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
    const fromPos = editor.getCursor("from");
    const toPos = editor.getCursor("to");
    const hintR = await promptClozeHintInline(this.clozeHintHost());
    if (!hintR.ok) return;
    editor.setSelection(fromPos, toPos);
    const fullBefore = editor.getValue();
    const body = stripFrontmatter(fullBefore);
    const off = this.bodyOffsetsForEditorSelection(editor);
    const result = await createCloze(
      this.app,
      source,
      editor,
      this.settings,
      hintR.hint,
    );
    await this.openResult(result, "Cloze item created:");
    if (result.file && off) {
      await this.attachClozeSourceAnchor(
        result.file,
        source.path,
        body,
        off.start,
        off.end,
      );
    }
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
    const fromPos = editor.getCursor("from");
    const toPos = editor.getCursor("to");
    const hintR = await promptClozeHintInline(this.clozeHintHost());
    if (!hintR.ok) return;
    editor.setSelection(fromPos, toPos);
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
    if (source.extension === "pdf") {
      if (this.irPdfPaths.has(source.path)) return true;
      if (await this.resolveElementIdForFile(source)) {
        this.irPdfPaths.add(source.path);
        return true;
      }
      if (!this.settings.autoMarkSourceAsTopic) {
        new Notice(
          `"${source.basename}" is not an IR topic. ` +
            "Mark it as a topic first, or enable auto-mark in settings.",
        );
        return false;
      }
      await this.markPdfAsTopic(source, { silentIfExists: true });
      return true;
    }
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

  /**
   * Go neural is subset review of the IR graph. It is available only on an
   * existing IR element (review card, or a note already in the collection).
   * Auto-marking a plain note and walking from that singleton is not useful.
   */
  private canGoNeuralFromContext(): boolean {
    if (this.getActiveReviewView()?.getCurrentElementId()) return true;
    const file = activeIrFile(this.app);
    if (!file) return false;
    if (file.extension === "pdf") return this.irPdfPaths.has(file.path);
    return file.extension === "md" && !!getIrType(this.app, file);
  }

  private async startNeuralReviewFromActiveNote() {
    const reviewing = this.getActiveReviewView()?.getCurrentElementId();
    if (reviewing) {
      await this.startNeuralReview(reviewing, null);
      return;
    }
    const active = activeIrFile(this.app);
    if (!active || (active.extension !== "md" && active.extension !== "pdf")) {
      new Notice("Incremental Reading: no active note to start Neural Review from.");
      return;
    }
    if (
      (active.extension === "md" && !getIrType(this.app, active)) ||
      (active.extension === "pdf" && !this.irPdfPaths.has(active.path))
    ) {
      new Notice(
        `"${active.basename}" is not in Incremental Reading. ` +
          "Mark it as a topic first, then Go neural from there.",
      );
      return;
    }
    const seedId = await this.resolveElementIdForFile(active);
    if (!seedId) {
      new Notice(
        "Incremental Reading: that note is marked IR but is not in the store yet. Try again in a moment.",
      );
      return;
    }
    await this.startNeuralReview(seedId, null);
  }

  public async startNeuralReview(seedElementId: ElementId | null, seedNotePath: string | null) {
    if (!this.store) {
      new Notice("Incremental Reading: store is not ready.");
      return;
    }
    const state = await this.store.load();
    const queue = neuralQueue(
      this.app,
      state,
      seedElementId,
      seedNotePath,
      makeLcg(Date.now() ^ 0x9e3779b9),
    );
    
    if (queue.length < 2) {
      new Notice(`Incremental Reading: ${EMPTY_NEURAL_COPY}`);
      return;
    }

    this.beginReviewSession();
    this.app.workspace.detachLeavesOfType(IR_REVIEW_VIEW_TYPE);
    this.irReviewSession = { queue, elementsById: state.elements, isNeural: true };
    try {
      const leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: IR_REVIEW_VIEW_TYPE, active: true });
      this.app.workspace.revealLeaf(leaf);
    } catch (e) {
      this.irReviewSession = null;
      console.error("Incremental Reading: opening neural review view failed", e);
      new Notice(
        "Incremental Reading: could not open the review view. See the developer console.",
      );
    }
  }

  private async startReview() {
    if (!this.store) {
      new Notice("Incremental Reading: store is not ready.");
      return;
    }
    try {
      await withTimeout(this.storeInit, 8000, "store init");
    } catch (e) {
      console.error("Incremental Reading: store init still running", e);
      new Notice(
        "Incremental Reading: still starting up. Try Start IR review again in a moment.",
      );
      return;
    }
    const state = await this.store.load();
    if (state.elements.size === 0) {
      this.app.workspace.detachLeavesOfType(IR_REVIEW_VIEW_TYPE);
      this.irReviewSession = {
        queue: [],
        elementsById: state.elements,
        emptyVault: true,
      };
      try {
        const leaf = this.app.workspace.getLeaf("tab");
        await leaf.setViewState({ type: IR_REVIEW_VIEW_TYPE, active: true });
        this.app.workspace.revealLeaf(leaf);
      } catch (e) {
        this.irReviewSession = null;
        console.error("Incremental Reading: opening review view failed", e);
        new Notice(EMPTY_COLLECTION_COPY);
      }
      return;
    }
    const queue = dueQueue(
      this.app,
      this.settings.reviewsPerReading,
      state,
      new Date(),
      this.settings.interleaveSimilarPriority,
    );
    if (queue.length === 0) {
      new Notice("Incremental Reading: nothing due for review.");
      return;
    }

    this.beginReviewSession();
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
    if (file && file.extension === "md") {
      await quietFrontmatterWrite(
        () => setPriority(this.app, file, p).then(() => undefined),
        "priority",
      );
    }
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
    if (file && file.extension === "md") {
      await quietFrontmatterWrite(
        () => setDismissed(this.app, file, dismissed).then(() => undefined),
        "dismiss",
      );
    }
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
    if (element.notePath) {
      new Notice("Incremental Reading: that extract is already a note.");
      return;
    }
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
    element.notePath = notePath;
    await this.store.reconcile().catch((e) => {
      console.error("Incremental Reading: reconcile after promote failed", e);
    });
    new Notice(`Promoted extract to "${notePath}".`);
    void this.refreshStatusBar();
    this.getActiveReviewView()?.adoptElement(element);
    const tree = this.getTreeView();
    if (tree) void tree.refresh();
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
    if (element.anchor.pdf || isPdfPath(element.anchor.sourcePath)) {
      return false;
    }

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

  /** Mark a drifted extract as detached; it keeps stored text for review. */
  private async applyIrDetachAnchor(
    elementId: ElementId,
    _element: IrElement,
  ): Promise<void> {
    if (!this.store) return;
    await this.store.appendEvent({
      id: newEventId(),
      ts: Date.now(),
      lamport: Date.now(),
      device: await this.store.getDeviceId(),
      kind: "anchor-detached",
      target: elementId,
      payload: {},
    });
    await this.store.reconcile().catch((e) => {
      console.error("Incremental Reading: reconcile after detach failed", e);
    });
    void this.refreshStatusBar();
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
      if (view instanceof IrStatsView) void view.refresh();
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
    const bodyText = (el.text ?? "").trim();
    let body = bodyText + "\n";
    if (el.anchor?.pdf) {
      const link = formatPdfLinktext(
        el.anchor.sourcePath,
        el.anchor.pdf.page,
        el.anchor.pdf.selection,
      );
      body += `\n[[${link}]]\n`;
    }
    const file = await this.app.vault.create(notePath, body);
    const parentPath = el.anchor?.sourcePath;
    const parentFile = parentPath
      ? this.app.vault.getAbstractFileByPath(parentPath)
      : null;
    const inheritedMeta =
      parentFile instanceof TFile
        ? inheritableFrontmatter(
            this.app.metadataCache.getFileCache(parentFile)?.frontmatter,
          )
        : {};
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm[IR_KEYS.type] = "extract";
      fm[IR_KEYS.priority] = el.priority;
      if (parentPath) fm[IR_KEYS.parent] = parentPath;
      writeTopicToFrontmatter(fm, newTopicState(this.settings));
      applyInheritedFrontmatter(fm, inheritedMeta);
    });
  }

  /**
   * Queue a vanished source path. Live vault deletes and the load-time
   * reconcile share this so prompts never stack.
   */
  private enqueueSourceGone(path: string, title: string): void {
    this.sourceGoneQueue.push({ path, title });
    void this.drainSourceGoneQueue();
  }

  private vaultFilePaths(): string[] {
    return this.app.vault.getFiles().map((f) => f.path);
  }

  private notePendingGone(path: string, title: string): void {
    if (this.nuking) return;
    this.pendingGone.set(path, { title });
    this.scheduleGoneSettle();
  }

  private clearPendingGoneUnder(oldPath: string): void {
    for (const path of [...this.pendingGone.keys()]) {
      if (pathIsUnder(path, oldPath)) this.pendingGone.delete(path);
    }
    this.scheduleGoneSettle();
  }

  private scheduleGoneSettle(): void {
    if (this.goneSettleTimer != null) window.clearTimeout(this.goneSettleTimer);
    this.goneSettleTimer = window.setTimeout(() => {
      this.goneSettleTimer = null;
      void this.settlePendingGone();
    }, 500);
  }

  private async tryMatchPendingGone(file: TFile): Promise<void> {
    if (this.nuking) return;
    const pending = [...this.pendingGone.keys()];
    const bySuffix = pending.filter((g) => file.path.endsWith(`/${g}`));
    const match =
      bySuffix.length === 1
        ? bySuffix[0]!
        : pending.filter((g) => basenameOf(g) === file.name).length === 1
          ? pending.find((g) => basenameOf(g) === file.name)!
          : null;
    if (match) {
      this.pendingGone.delete(match);
      await this.handleSourceRename(file, match);
    }
    this.scheduleGoneSettle();
  }

  /**
   * After deletes/creates go quiet: rewrite moved paths, then prompt for
   * whatever is still actually gone.
   */
  private async settlePendingGone(): Promise<void> {
    if (this.nuking || !this.store || this.pendingGone.size === 0) return;
    const existing = this.vaultFilePaths();
    const missing = [...this.pendingGone.keys()];
    const prefix = inferPrefixRewrite(missing, existing);
    if (prefix) {
      await this.rewriteSourcePaths(prefix.from, prefix.to);
      for (const gone of missing) {
        if (pathIsUnder(gone, prefix.from)) this.pendingGone.delete(gone);
      }
    }
    for (const [gone, meta] of [...this.pendingGone]) {
      if (this.app.vault.getAbstractFileByPath(gone) instanceof TFile) {
        this.pendingGone.delete(gone);
        continue;
      }
      const moved =
        relocatedBySuffix(gone, existing) ?? uniqueMovedPath(gone, existing);
      if (moved) {
        const af = this.app.vault.getAbstractFileByPath(moved);
        this.pendingGone.delete(gone);
        if (af instanceof TFile) await this.handleSourceRename(af, gone);
        continue;
      }
      this.pendingGone.delete(gone);
      this.enqueueSourceGone(gone, meta.title);
    }
  }

  private async drainSourceGoneQueue(): Promise<void> {
    if (this.sourceGoneBusy) return;
    this.sourceGoneBusy = true;
    try {
      const seen = new Set<string>();
      while (this.sourceGoneQueue.length > 0) {
        const next = this.sourceGoneQueue.shift();
        if (!next || seen.has(next.path)) continue;
        seen.add(next.path);
        const remaining = 1 + this.sourceGoneQueue.length;
        await this.offerSourceGone(next.path, next.title, remaining);
      }
    } finally {
      this.sourceGoneBusy = false;
      this.sourceGoneApplyAll = null;
      if (this.sourceGoneQueue.length > 0) {
        await this.drainSourceGoneQueue();
      }
    }
  }

  /**
   * Deletes that happened while Obsidian was closed never fire
   * vault.on("delete"). After store init, any path the collection still
   * names whose file is gone and which has no tombstone gets the same
   * prompt as a live delete — unless we can see it moved.
   */
  private async reconcileMissingSources(): Promise<void> {
    if (this.nuking || !this.store) return;
    try {
      const state = await this.store.load();
      const missing = missingSourcePaths(
        Array.from(state.elements.values()),
        state.tombstones.keys(),
        (path) => this.app.vault.getAbstractFileByPath(path) instanceof TFile,
      );
      const existing = this.vaultFilePaths();
      const prefix = inferPrefixRewrite(missing, existing);
      if (prefix) {
        await this.rewriteSourcePaths(prefix.from, prefix.to);
      }
      const still = missing.filter(
        (path) => !prefix || !pathIsUnder(path, prefix.from),
      );
      for (const path of still) {
        const moved =
          relocatedBySuffix(path, existing) ?? uniqueMovedPath(path, existing);
        if (moved) {
          const af = this.app.vault.getAbstractFileByPath(moved);
          if (af instanceof TFile) await this.handleSourceRename(af, path);
        }
      }
      await this.restoreOrphanIrNotes();
      const after = await this.store.load();
      const leftover = missingSourcePaths(
        Array.from(after.elements.values()),
        after.tombstones.keys(),
        (path) => this.app.vault.getAbstractFileByPath(path) instanceof TFile,
      );
      const existingNow = this.vaultFilePaths();
      for (const path of leftover) {
        const moved =
          relocatedBySuffix(path, existingNow) ??
          uniqueMovedPath(path, existingNow);
        if (moved) {
          const af = this.app.vault.getAbstractFileByPath(moved);
          if (af instanceof TFile) await this.handleSourceRename(af, path);
          continue;
        }
        this.enqueueSourceGone(path, titleFromSourcePath(path));
      }
      await this.drainSourceGoneQueue();
    } catch (e) {
      console.error("Incremental Reading: missing-source reconcile failed", e);
    }
  }

  private async offerSourceGone(
    path: string,
    title: string,
    remaining: number,
  ): Promise<void> {
    if (this.nuking || !this.store) return;
    try {
      const state = await this.store.load();
      if (state.tombstones.has(path)) return;
      if (this.app.vault.getAbstractFileByPath(path) instanceof TFile) return;

      const existing = this.vaultFilePaths();
      const moved =
        relocatedBySuffix(path, existing) ?? uniqueMovedPath(path, existing);
      if (moved) {
        const af = this.app.vault.getAbstractFileByPath(moved);
        if (af instanceof TFile) {
          await this.handleSourceRename(af, path);
          return;
        }
      }

      const elements = Array.from(state.elements.values());
      const affected = elements.filter(
        (e) => e.notePath === path || e.anchor?.sourcePath === path,
      );
      if (affected.length === 0) return;

      const labels = affected
        .filter((e) => e.anchor?.sourcePath === path && e.notePath !== path)
        .map((e) => labelFor(e));
      const defaultPromote = this.settings.makeNotesWhenSourceDeleted;
      const repeating = this.sourceGoneApplyAll != null;
      let choice = this.sourceGoneApplyAll;
      if (!choice) {
        const result = await promptSourceGone(this.app, {
          title,
          path,
          labels,
          defaultPromote,
          remaining,
        });
        choice = result.choice;
        if (result.applyToAll) this.sourceGoneApplyAll = choice;
      }
      await this.applySourceGone(path, title, elements, choice, repeating);
    } catch (e) {
      console.error("Incremental Reading: source-gone handling failed", e);
    }
  }

  /**
   * Notes still marked `ir-type` whose path is not in the store — typical
   * after a folder move was treated as a mass delete. Resurrect with the
   * original element id when the log names the old path.
   */
  private async restoreOrphanIrNotes(): Promise<void> {
    if (!this.store) return;
    try {
      const notes = this.enumerateIrNotes();
      const state = await this.store.load();
      const events = await this.store.loadEvents();
      const plan = planOrphanRecoveries(
        notes,
        state.elements.values(),
        events,
        state.tombstones.keys(),
        this.vaultFilePaths(),
        Date.now(),
        nextLamport(events),
        await this.store.getDeviceId(),
        () => newEventId(),
      );
      if (plan.events.length === 0) return;
      await this.appendRelinkEvents(plan.events);
      void this.refreshStatusBar();
      void this.refreshExtractDecorations();
      const n = plan.restored;
      new Notice(
        `Incremental Reading: restored ${n} note${n === 1 ? "" : "s"} that were still marked IR into the store.`,
      );
    } catch (e) {
      console.error("Incremental Reading: orphan-note restore failed", e);
    }
  }

  private async applySourceGone(
    path: string,
    title: string,
    elements: IrElement[],
    choice: SourceGoneChoice,
    quiet = false,
  ): Promise<void> {
    if (!this.store) return;
    if (this.app.vault.getAbstractFileByPath(path) instanceof TFile) return;
    const existing = this.vaultFilePaths();
    const moved =
      relocatedBySuffix(path, existing) ?? uniqueMovedPath(path, existing);
    if (moved) {
      const af = this.app.vault.getAbstractFileByPath(moved);
      if (af instanceof TFile) {
        await this.handleSourceRename(af, path);
        return;
      }
    }
    const events = await this.store.loadEvents();
    const device = await this.store.getDeviceId();
    const now = Date.now();
    const lamport = nextLamport(events);
    const before = elements.map((e) => structuredClone(e));

    if (choice === "undo") {
      const tomb = planSourceTombstoneOnly(
        elements,
        path,
        title,
        now,
        lamport,
        device,
        () => newEventId(),
      );
      await this.appendRelinkEvents(tomb);
      if (!quiet) {
        new Notice(
          `Incremental Reading: remembered that “${title}” is gone. Tree unchanged.`,
        );
      }
      return;
    }

    const newEvents = planSourceDeletion(
      elements,
      path,
      title,
      now,
      lamport,
      device,
      () => newEventId(),
      (el) => this.promoteOrphanPath(el),
      { autoPromoteRootless: choice === "promote-all" },
    );

    const byId = new Map(elements.map((e) => [e.id, e]));
    const promotedPaths: string[] = [];
    for (const ev of newEvents) {
      if (ev.kind === "promoted") {
        const notePath = (ev.payload as { notePath?: string }).notePath;
        const el = byId.get(ev.target);
        if (notePath && el) {
          await this.materializePromotedNote(notePath, el);
          promotedPaths.push(notePath);
        }
      }
    }

    for (const ev of newEvents) await this.store.appendEvent(ev);
    await this.store.reconcile();

    this.lastSourceDeletionUndo = {
      before,
      deletionEvents: newEvents,
      promotedPaths,
    };
    if (!quiet) this.showSourceGoneNotice(choice, promotedPaths.length, title);
  }

  private showSourceGoneNotice(
    choice: SourceGoneChoice,
    promoted: number,
    title: string,
  ): void {
    const text =
      choice === "promote-all"
        ? `Incremental Reading: “${title}” is gone. ${promoted} note${promoted === 1 ? "" : "s"} created.`
        : `Incremental Reading: “${title}” is gone. Highlights kept without new notes.`;
    const notice = new Notice("", 10000);
    notice.noticeEl.empty();
    const row = notice.noticeEl.createDiv();
    row.createSpan({ text: `${text} ` });
    const btn = row.createEl("button", { text: "Undo" });
    btn.addEventListener("click", () => {
      notice.hide();
      void this.undoLastSourceDeletion();
    });
  }

  private async undoLastSourceDeletion(): Promise<void> {
    if (!this.store || !this.lastSourceDeletionUndo) {
      new Notice("Incremental Reading: nothing to undo.");
      return;
    }
    const pending = this.lastSourceDeletionUndo;
    this.lastSourceDeletionUndo = null;
    try {
      const events = await this.store.loadEvents();
      const undo = planUndoSourceDeletion(
        pending.before,
        pending.deletionEvents,
        Date.now(),
        nextLamport(events),
        await this.store.getDeviceId(),
        () => newEventId(),
      );
      await this.appendRelinkEvents(undo);

      this.nuking = true;
      try {
        for (const notePath of pending.promotedPaths) {
          const af = this.app.vault.getAbstractFileByPath(notePath);
          if (af instanceof TFile) await this.app.fileManager.trashFile(af);
        }
      } finally {
        this.nuking = false;
      }

      new Notice(
        "Incremental Reading: undid source-delete handling. Restore the note from trash if you still want it.",
      );
    } catch (e) {
      console.error("Incremental Reading: undo source-delete failed", e);
      new Notice(
        "Incremental Reading: could not undo. See the developer console.",
      );
    }
  }

  /**
   * Vault-rename handler. Without this, renaming a source note (or the
   * folder that contains it) leaves stored `notePath` / `anchor.sourcePath`
   * pointing at the old path, and review treats the move as a mass delete.
   */
  private async handleSourceRename(
    file: TFile | TFolder,
    oldPath: string,
  ): Promise<void> {
    if (this.nuking) return;
    if (!this.store) return;
    if (file instanceof TFile) {
      if (file.extension !== "md" && file.extension !== "pdf") return;
    }
    if (oldPath === file.path) return;
    await this.rewriteSourcePaths(oldPath, file.path);
  }

  private async rewriteSourcePaths(from: string, to: string): Promise<void> {
    if (!this.store || from === to) return;
    for (const p of [...this.irPdfPaths]) {
      const next = rewriteStoredPath(p, from, to);
      if (next) {
        this.irPdfPaths.delete(p);
        this.irPdfPaths.add(next);
      }
    }
    try {
      const events = await this.store.loadEvents();
      const state = await this.store.load();
      const rewrites = sourcePathRewrites(state.elements.values(), from, to);
      if (rewrites.length === 0) return;

      const device = await this.store.getDeviceId();
      let lamport = nextLamport(events);
      const now = Date.now();
      for (const rw of rewrites) {
        await this.store.appendEvent({
          id: newEventId(),
          ts: now,
          lamport,
          device,
          kind: "source-renamed",
          target: rw.elementId,
          payload: { oldPath: rw.oldPath, newPath: rw.newPath },
        });
        lamport += 1;
      }
      await this.store.reconcile();
    } catch (e) {
      console.error("Incremental Reading: rename handling failed", e);
    }
  }

  /**
   * Q1 comes-back: if a note exists at a tombstoned path (plugin load after
   * trash restore, or a create we missed), offer re-link once per path.
   */
  private async offerPendingRelinks(): Promise<void> {
    if (this.nuking || !this.store) return;
    try {
      const state = await this.store.load();
      for (const path of state.tombstones.keys()) {
        const af = this.app.vault.getAbstractFileByPath(path);
        if (af instanceof TFile && (af.extension === "md" || af.extension === "pdf")) {
          await this.maybeOfferRelink(af);
        }
      }
    } catch (e) {
      console.error("Incremental Reading: pending re-link scan failed", e);
    }
  }

  private async maybeOfferRelink(file: TFile): Promise<void> {
    if (this.nuking || !this.store) return;
    if (file.extension !== "md" && file.extension !== "pdf") return;
    this.relinkQueue.push(file);
    if (this.relinkBusy) return;
    this.relinkBusy = true;
    try {
      const seen = new Set<string>();
      while (this.relinkQueue.length > 0) {
        const next = this.relinkQueue.shift();
        if (!next || seen.has(next.path)) continue;
        seen.add(next.path);
        await this.offerRelinkForFile(next);
      }
    } finally {
      this.relinkBusy = false;
    }
  }

  private async offerRelinkForFile(file: TFile): Promise<void> {
    if (this.nuking || !this.store) return;
    try {
      const state = await this.store.load();
      const tomb = state.tombstones.get(file.path);
      if (!tomb) return;

      const elements = Array.from(state.elements.values());
      const candidates = relinkCandidates(elements, tomb.path);
      const events = await this.store.loadEvents();
      const device = await this.store.getDeviceId();
      const now = Date.now();
      const lamport = nextLamport(events);

      if (candidates.length === 0) {
        await this.appendRelinkEvents(
          planClearTombstone(
            tomb.path,
            `el_restored:${tomb.path}` as ElementId,
            now,
            lamport,
            device,
            () => newEventId(),
          ),
        );
        return;
      }

      const ok = await promptSourceRelink(this.app, {
        title: tomb.title,
        path: file.path,
        labels: candidates.map((el) => labelFor(el)),
      });

      const planned = ok
        ? planSourceRelink(
            elements,
            tomb.path,
            file.path,
            now,
            lamport,
            device,
            () => newEventId(),
          )
        : planClearTombstone(
            tomb.path,
            candidates[0].id,
            now,
            lamport,
            device,
            () => newEventId(),
          );
      await this.appendRelinkEvents(planned);
      if (ok) {
        const n = candidates.length;
        new Notice(
          `Incremental Reading: re-linked ${n} extract${n === 1 ? "" : "s"} to "${file.basename}".`,
        );
      }
    } catch (e) {
      console.error("Incremental Reading: source re-link failed", e);
    }
  }

  private async appendRelinkEvents(events: IrEvent[]): Promise<void> {
    if (!this.store) return;
    for (const ev of events) await this.store.appendEvent(ev);
    await this.store.reconcile();
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
    if (Platform.isMobile) {
      return radialAnchorCenterBottom();
    }
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

  /** Snapshot the active markdown selection before focus moves to the FAB. */
  private captureHubEditorSelection(): void {
    const mv = this.app.workspace.getActiveViewOfType(MarkdownView);
    const file = mv?.file;
    const editor = mv?.editor;
    if (!file || !editor || file.extension !== "md") {
      this.hubSelectionSnapshot = null;
      return;
    }
    this.hubSelectionSnapshot = captureEditorSelection(file, editor);
  }

  private hubSelectionFor(file: TFile, editor: Editor): string {
    return snapshotSelectionText(this.hubSelectionSnapshot, file, editor);
  }

  private restoreHubSelection(file: TFile, editor: Editor): void {
    restoreEditorSelection(this.hubSelectionSnapshot, file, editor);
  }

  /** Run a hub action on the active markdown editor, restoring a FAB snapshot. */
  private runMarkdownHubAction(
    file: TFile,
    fn: (editor: Editor, file: TFile) => void | Promise<void>,
  ): void {
    void (async () => {
      const mv = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!mv?.file || mv.file.path !== file.path) return;
      this.restoreHubSelection(file, mv.editor);
      await fn(mv.editor, file);
    })();
  }

  /** Command palette / ribbon / review: contextual IR actions as a radial wheel. */
  private async openIrActionsHub(): Promise<void> {
    if (!this.hubSelectionSnapshot) this.captureHubEditorSelection();
    const mv = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (mv?.file && mv.editor) {
      this.restoreHubSelection(mv.file, mv.editor);
    }
    const entries = await this.buildIrHubEntries();
    openIrRadialQuickMenu(this.app, entries, this.irRadialAnchor());
  }

  private async buildIrHubEntries(): Promise<IrHubEntry[]> {
    const out: IrHubEntry[] = [];

    const review = this.getActiveReviewView();
    const mvForHub = this.app.workspace.getActiveViewOfType(MarkdownView);
    const hubFile = mvForHub?.file ?? this.app.workspace.getActiveFile();
    for (const kind of sessionHubKinds({
      inReview: !!review,
      hasMarkdownFile:
        hubFile?.extension === "md" || hubFile?.extension === "pdf",
      alreadyIr: !!(
        hubFile &&
        ((hubFile.extension === "md" && getIrType(this.app, hubFile)) ||
          (hubFile.extension === "pdf" && this.irPdfPaths.has(hubFile.path)))
      ),
    })) {
      if (kind === "start-review") {
        out.push({
          title: "Start IR review",
          description: "Open today's due queue.",
          icon: "play-circle",
          run: () => this.startReview(),
        });
      } else if (kind === "open-tree") {
        out.push({
          title: "Open IR element tree",
          description: "Browse topics, extracts, and items.",
          icon: "list-tree",
          run: () => this.openTreeView(),
        });
      } else if (kind === "go-neural") {
        out.push({
          title: "Go neural",
          description: "Subset review from the current IR element.",
          icon: "network",
          run: () => this.startNeuralReviewFromActiveNote(),
        });
      } else {
        out.push({
          title: "Mark as IR topic",
          description: "Queue this note as a reading source.",
          icon: "book-open",
          run: () => this.markActiveFileAsTopic(hubFile ?? undefined),
        });
      }
    }

    if (review) {
      out.push(
        ...review.buildHubExtractEntries(
          (source, spans, headline) =>
            this.runBulkExtractAnchored(source, spans, headline),
          this.settings.extractCreatesStandaloneNote
            ? undefined
            : () => this.extractSelectionToNoteFromReview(review),
        ),
      );
      if (review.getCurrentExtractForPromote()) {
        out.push({
          title: "Promote this extract to a note",
          description:
            "Turn the anchored extract into a standalone note (Alt+Shift+P). Inherits tags from the source.",
          icon: "file-output",
          run: () => this.promoteCurrentExtract(),
        });
      }
      const reviewFile = review.getCurrentReviewFile();
      if (reviewFile?.extension === "md" && this.store) {
        const state = await this.store.load();
        for (const el of state.elements.values()) {
          if (el.type === "extract" && el.notePath === reviewFile.path) {
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
      return out;
    }

    const mv = this.app.workspace.getActiveViewOfType(MarkdownView);
    const file = mv?.file ?? this.app.workspace.getActiveFile();
    const editor = mv?.editor;
    const sel =
      editor && file?.extension === "md"
        ? this.hubSelectionFor(file, editor)
        : "";

    if (editor && file?.extension === "md" && sel) {
      out.push({
        title: this.settings.extractCreatesStandaloneNote
          ? "Extract to standalone note"
          : "Extract selection",
        description: this.settings.extractCreatesStandaloneNote
          ? "Creates a standalone note (Alt+X). Inherits tags from the parent."
          : "Anchored extract in this note (Alt+X).",
        icon: "scissors",
        run: () =>
          this.runMarkdownHubAction(file, (ed, f) => this.extractSelection(ed, f)),
      });
      if (!this.settings.extractCreatesStandaloneNote) {
        out.push({
          title: "Extract to standalone note",
          description:
            "One-shot: create a standalone note without changing Settings (Alt+Shift+X).",
          icon: "file-plus",
          run: () =>
            this.runMarkdownHubAction(file, (ed, f) =>
              this.extractSelection(ed, f, { promote: true }),
            ),
        });
      }
      out.push({
        title: "Cloze selection",
        description: "Cloze item from selection (Alt+Z).",
        icon: "brackets",
        run: () =>
          this.runMarkdownHubAction(file, (ed, f) => this.clozeSelection(ed, f)),
      });
      out.push({
        title: "New cloze card (separate item)",
        description:
          "Creates a new FSRS item under the reading parent. On an IR item note, uses ir-parent instead of adding to the same file.",
        icon: "copy-plus",
        run: () =>
          this.runMarkdownHubAction(file, (ed, f) =>
            this.newClozeCardFromSelection(ed, f),
          ),
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
    this.restoreHubSelection(file, editor);
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
        run: () =>
          this.runMarkdownHubAction(file, (ed, f) =>
            this.extractParagraphAtCursor(ed, f),
          ),
      });
    }

    if (findHeadingSectionAtOffset(body, cursorInBody)) {
      out.push({
        title: "Extract heading section at cursor",
        description:
          "Anchored extract from the nearest preceding heading down to the next same-or-higher heading.",
        icon: "heading",
        run: () =>
          this.runMarkdownHubAction(file, (ed, f) =>
            this.extractHeadingSectionAtCursor(ed, f),
          ),
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
        run: () =>
          this.runMarkdownHubAction(file, (ed, f) =>
            this.extractEveryBlockquote(ed, f),
          ),
      });
    }

    if (range) {
      const items = findAllListItems(body, range);
      if (items.length >= 2) {
        out.push({
          title: `Extract every list item (${items.length})`,
          description: `One anchored extract per bullet/numbered item in the selection (${items.length} found). Indent-aware: nested items split into their own extracts.`,
          icon: "list",
          run: () =>
            this.runMarkdownHubAction(file, (ed, f) =>
              this.extractEveryListItemInSelection(ed, f),
            ),
        });
      }

      const paras = findAllParagraphs(body, range);
      if (paras.length >= 2) {
        out.push({
          title: `Extract every paragraph (${paras.length})`,
          description: `One anchored extract per blank-line-separated block in the selection (${paras.length} found).`,
          icon: "align-left",
          run: () =>
            this.runMarkdownHubAction(file, (ed, f) =>
              this.extractEveryParagraphInSelection(ed, f),
            ),
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
    const fromPos = editor.getCursor("from");
    const toPos = editor.getCursor("to");
    const hintR = await promptClozeHintInline(this.clozeHintHost());
    if (!hintR.ok) return;
    editor.setSelection(fromPos, toPos);
    const sourceIsEditor = parentFile.path === file.path;
    const fullBefore = sourceIsEditor ? editor.getValue() : "";
    const body = sourceIsEditor ? stripFrontmatter(fullBefore) : "";
    const off = sourceIsEditor
      ? this.bodyOffsetsForEditorSelection(editor)
      : null;
    const result = await createCloze(
      this.app,
      parentFile,
      editor,
      this.settings,
      hintR.hint,
    );
    await this.openResult(result, "New cloze item created:");
    if (result.file && off && sourceIsEditor) {
      await this.attachClozeSourceAnchor(
        result.file,
        parentFile.path,
        body,
        off.start,
        off.end,
      );
    }
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
      if (this.store) {
        const state = await this.store.load();
        const created = state.elements.get(elementIdForPath(newPath));
        if (created) this.getActiveReviewView()?.adoptElement(created);
      }
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
    this.getActiveReviewView()?.adoptElement(newEl);
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

  /** Record a text-quote anchor so source decorations can paint the cloze. */
  private async attachClozeSourceAnchor(
    itemFile: TFile,
    sourcePath: string,
    sourceBody: string,
    selStart: number,
    selEnd: number,
  ): Promise<void> {
    if (!this.store || selEnd <= selStart) return;
    const id = await this.resolveElementIdForFile(itemFile);
    if (!id) return;
    const anchor = buildTextQuoteAnchor(
      sourcePath,
      sourceBody,
      selStart,
      selEnd,
    );
    try {
      await this.store.appendEvent({
        id: newEventId(),
        ts: Date.now(),
        lamport: Date.now(),
        device: await this.store.getDeviceId(),
        kind: "anchor-repaired",
        target: id,
        payload: { anchor },
      });
      await this.store.reconcile();
    } catch (e) {
      console.error("Incremental Reading: recording cloze source span failed", e);
      return;
    }
    void this.refreshExtractDecorations();
  }

  /** File-explorer folder, or the folder of the active note (command palette). */
  private folderForTopicCommand(): TFolder | null {
    const file = this.app.workspace.getActiveFile();
    if (file?.parent instanceof TFolder) return file.parent;
    return null;
  }

  /**
   * Mark every markdown note and PDF under `folder` as an IR topic.
   * Skips notes already in IR (topic/extract/item). Nested folders included.
   */
  private async markFolderAsTopics(folder: TFolder): Promise<void> {
    const skip = new Set<string>();
    if (this.store) {
      const state = await this.store.load();
      for (const el of state.elements.values()) {
        if (el.notePath) skip.add(el.notePath);
      }
    }
    const refs = this.app.vault.getFiles().map((f) => ({
      path: f.path,
      extension: f.extension,
    }));
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (getIrType(this.app, f)) skip.add(f.path);
    }
    const planned = folderTopicCandidates(refs, folder.path, skip);
    if (planned.length === 0) {
      new Notice(
        `Incremental Reading: no unmarked notes in "${folder.name || "/"}".`,
      );
      return;
    }
    const needConfirm =
      folder.path === "" ||
      folder.path === "/" ||
      planned.length > FOLDER_TOPIC_CONFIRM_THRESHOLD;
    if (needConfirm) {
      const ok = await this.confirmMarkFolderTopics(
        folder.name || "/",
        planned.length,
      );
      if (!ok) return;
    }
    let marked = 0;
    for (const ref of planned) {
      const abs = this.app.vault.getAbstractFileByPath(ref.path);
      if (!(abs instanceof TFile)) continue;
      if (abs.extension === "pdf") {
        if (await this.markPdfAsTopic(abs, { silent: true })) marked += 1;
        continue;
      }
      const did = await markAsTopic(this.app, abs, this.settings);
      if (!did) continue;
      await this.recordElement(abs, { skipReconcile: true });
      marked += 1;
    }
    if (this.store) {
      await this.store.reconcile().catch((e) => {
        console.error(
          "Incremental Reading: reconcile after folder topics failed",
          e,
        );
      });
      void this.refreshStatusBar();
    }
    const skipped = planned.length - marked;
    const skipBit = skipped > 0 ? ` · ${skipped} skipped` : "";
    new Notice(
      `Marked ${marked} note${marked === 1 ? "" : "s"} in "${folder.name || "/"}" as IR topics${skipBit}.`,
    );
    const tree = this.getTreeView();
    if (tree) void tree.refresh();
  }

  private async confirmMarkFolderTopics(
    folderName: string,
    count: number,
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const modal = new Modal(this.app);
      modal.titleEl.setText(`Mark ${count} notes as IR topics?`);
      modal.contentEl.createEl("p", {
        text:
          `This will mark every unmarked markdown note and PDF under "${folderName}" ` +
          "(including nested folders) as an IR topic. Notes that are already " +
          "topics, extracts, or items are left alone.",
      });
      const btns = modal.contentEl.createDiv({ cls: "modal-button-container" });
      const cancel = btns.createEl("button", { text: "Cancel" });
      const ok = btns.createEl("button", {
        text: `Mark ${count}`,
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

  private async markActiveFileAsTopic(file?: TFile) {
    const target = file ?? activeIrFile(this.app);
    if (!target) {
      new Notice("Incremental Reading: no active Markdown note or PDF.");
      return;
    }
    if (target.extension === "pdf") {
      await this.markPdfAsTopic(target);
      return;
    }
    if (target.extension !== "md") {
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
   * PDFs have no frontmatter. Record a store-only topic whose `notePath` is
   * the PDF. Idempotent: the id is path-derived, same as migration.
   */
  private async markPdfAsTopic(
    file: TFile,
    opts?: { silentIfExists?: boolean; silent?: boolean },
  ): Promise<boolean> {
    if (!this.store) {
      if (!opts?.silent) {
        new Notice("Incremental Reading: store is not ready.");
      }
      return false;
    }
    const existing = await this.resolveElementIdForFile(file);
    if (existing) {
      this.irPdfPaths.add(file.path);
      if (!opts?.silent && !opts?.silentIfExists) {
        new Notice(`"${file.basename}" is already an IR topic.`);
      }
      return false;
    }
    const now = Date.now();
    try {
      const ev = buildPdfTopicEvent({
        path: file.path,
        elementId: elementIdForPath(file.path),
        eventId: newEventId(),
        device: await this.store.getDeviceId(),
        lamport: now,
        now,
        priority: this.settings.defaultPriority,
        schedule: topicStateToSchedule(
          newTopicState(this.settings, new Date(now)),
        ),
      });
      await this.store.appendEvent(ev);
      await this.store.reconcile();
      this.irPdfPaths.add(file.path);
      void this.refreshStatusBar();
      if (!opts?.silent) {
        new Notice(`Marked "${file.basename}" as an IR topic.`);
      }
      return true;
    } catch (e) {
      console.error("Incremental Reading: marking PDF as topic failed", e);
      if (!opts?.silent) {
        new Notice(
          "Incremental Reading: could not record the PDF topic. See the developer console.",
        );
      }
      return false;
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
  private async recordElement(
    file: TFile,
    opts?: { skipReconcile?: boolean },
  ): Promise<void> {
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
      if (opts?.skipReconcile) return;
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
  private async runMigrationIfOwed(fs: ObsidianVaultFs): Promise<void> {
    const store = this.store;
    if (!store) return;
    // clock-order, not conservative: on the live single-device plugin the
    // newest event must win, otherwise a "graded" event whose due moves
    // later than the migrated card is folded away and the item never
    // reschedules. This matches the Obsidian-Sync last-write-wins model the
    // log is designed around; the raw log is intact either way, so a
    // re-fold under another policy stays possible.
    const hostname = getMachineHostname();

    try {
      // Detection happens before init(): init() is what writes the marker.
      // Timeout: Capacitor/iCloud can hang on hidden `.ir/` exists() and
      // that used to stall the whole plugin (no commands, no FAB).
      const hasMeta = await withTimeout(
        fs.exists(META),
        4000,
        "exists(.ir/meta.json)",
      );
      if (hasMeta) {
        // Still call init() so the per-host device.json resolution runs and
        // this machine's device id is stable for the session. init() is a
        // no-op for META in the already-initialized branch; it only touches
        // .ir/device.json.
        await withTimeout(
          store.init({ hostname }),
          8000,
          "IrStore.init",
        );
        return;
      }

      // Marker + device id first, so the append below has a shard to write
      // to and a re-run sees the marker.
      await withTimeout(store.init({ hostname }), 8000, "IrStore.init");

      const notes = this.enumerateIrNotes();
      const events = migrateNotes(notes, Date.now());
      for (const ev of events) {
        await store.appendEvent(ev);
      }
      await store.reconcile();

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
    const saved = (await this.loadData()) as Partial<IrSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
    // New key: new vaults stay off (DEFAULT). Vaults that already had
    // plugin data without this key keep the old always-on picker.
    const resolved = resolveShowDivergencePicker(saved);
    if (this.settings.showDivergencePicker !== resolved) {
      this.settings.showDivergencePicker = resolved;
      await this.saveSettings();
    }
    if (!isSpaceAfterReveal(this.settings.spaceAfterReveal)) {
      this.settings.spaceAfterReveal = DEFAULT_SETTINGS.spaceAfterReveal;
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  /**
   * Settings-tab entry point for the Danger zone "Nuke everything" button.
   * Enumerates every IR-marked note in the vault by reading `ir-type:`
   * frontmatter — including notes the user marked as topics by hand, which
   * is the footgun the path list in the modal exists to surface. Runs the
   * destructive sweep if the user types the confirm phrase, then notices
   * the outcome.
   */
  async runNuke(): Promise<void> {
    const summary = {
      topics: 0,
      extracts: 0,
      items: 0,
      paths: [] as string[],
    };
    for (const file of this.app.vault.getMarkdownFiles()) {
      const t = getIrType(this.app, file);
      if (t === "topic") summary.topics++;
      else if (t === "extract") summary.extracts++;
      else if (t === "item") summary.items++;
      if (t) summary.paths.push(file.path);
    }
    summary.paths.sort();

    const ok = await promptNukeConfirm(this.app, summary);
    if (!ok) return;

    try {
      const result = await this.nukeAllIrData();
      const trashed = result.notesTrashed;
      const noteWord = trashed === 1 ? "note" : "notes";
      const stateMsg = result.stateRemoved
        ? ", .ir/ state removed"
        : ", .ir/ state could not be fully removed (check console)";
      new Notice(
        `Incremental Reading: nuke complete — ${trashed} ${noteWord} trashed${stateMsg}.`,
      );
    } catch (e) {
      console.error("Incremental Reading: nuke failed", e);
      new Notice(
        "Incremental Reading: nuke failed; see developer console for details.",
      );
    }
  }

  /**
   * Settings-tab entry point for the gentler "Reset state" button. Wipes
   * `.ir/` (event log, schedule, bookmarks, tombstones) but leaves every
   * vault note in place — IR notes keep their `ir-type:` frontmatter and
   * become inert until the user re-imports or strips the keys. Useful when
   * you want a fresh schedule without throwing away your notes.
   */
  async runResetState(): Promise<void> {
    const ok = await promptStateResetConfirm(this.app);
    if (!ok) return;

    try {
      const removed = await this.wipeIrState();
      new Notice(
        removed
          ? "Incremental Reading: .ir/ state removed."
          : "Incremental Reading: .ir/ state could not be fully removed (check console).",
      );
    } catch (e) {
      console.error("Incremental Reading: reset state failed", e);
      new Notice(
        "Incremental Reading: reset state failed; see developer console for details.",
      );
    }
  }

  /**
   * Trash every IR-marked note via Obsidian's trash (so the user can recover
   * from their system/vault trash) and then wipe `.ir/` via the shared
   * state-cleanup helper. The vault delete handler is suppressed for the
   * duration so no auto-promote notes spawn.
   */
  private async nukeAllIrData(): Promise<{
    notesTrashed: number;
    stateRemoved: boolean;
  }> {
    this.nuking = true;
    try {
      const irFiles: TFile[] = [];
      for (const file of this.app.vault.getMarkdownFiles()) {
        if (getIrType(this.app, file)) irFiles.push(file);
      }

      let trashed = 0;
      for (const file of irFiles) {
        try {
          await this.app.fileManager.trashFile(file);
          trashed++;
        } catch (e) {
          console.error(
            "Incremental Reading: nuke could not trash",
            file.path,
            e,
          );
        }
      }

      const stateRemoved = await this.wipeIrState();
      return { notesTrashed: trashed, stateRemoved };
    } finally {
      this.nuking = false;
    }
  }

  /**
   * Remove the `.ir/` state folder, drop the in-memory store, detach IR
   * leaves so they do not render against the now-empty store, then
   * re-initialise so subsequent commands work without a plugin reload.
   * Shared by the full nuke flow and the state-only reset flow.
   */
  private async wipeIrState(): Promise<boolean> {
    const adapter = this.app.vault.adapter as unknown as ObsidianDataAdapter;
    let stateRemoved = true;
    try {
      if (await adapter.exists(".ir")) {
        await adapter.rmdir(".ir", true);
      }
    } catch (e) {
      console.error("Incremental Reading: could not remove .ir/", e);
      stateRemoved = false;
    }

    this.store = undefined;
    this.app.workspace.detachLeavesOfType(IR_TREE_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(IR_SESSION_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(IR_STATS_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(IR_REVIEW_VIEW_TYPE);

    try {
      const fs = new ObsidianVaultFs(adapter);
      this.store = new IrStore(fs, { conflict: "clock-order" });
      this.storeInit = this.runMigrationIfOwed(fs);
      await this.storeInit;
    } catch (e) {
      console.error("Incremental Reading: post-wipe store re-init failed", e);
    }

    void this.refreshStatusBar();
    return stateRemoved;
  }
}
