import {
  type Command,
  Editor,
  type EditorSelectionOrCaret,
  FuzzySuggestModal,
  MarkdownView,
  Menu,
  Modal,
  Notice,
  Platform,
  Plugin,
  type TAbstractFile,
  TFile,
  TFolder,
  WorkspaceLeaf,
} from "obsidian";
import { DEFAULT_SETTINGS, IrSettingTab, IrSettings } from "./src/settings";
import { Sm20SchedulerOfferModal } from "./src/sm20-offer-modal";
import { resolveSettings, resolveShowDivergencePicker } from "./src/ir/settings-resolve";
import { isSpaceAfterReveal } from "./src/ir/review-keys";
import { buildTextQuoteAnchor } from "./src/ir/cloze-marks";
import { IR_TREE_VIEW_TYPE, IrTreeView } from "./src/tree-view";
import { IR_SESSION_VIEW_TYPE, IrSessionView } from "./src/session-view";
import { IR_STATS_VIEW_TYPE, IrStatsView } from "./src/stats-view";
import { IR_HELP_VIEW_TYPE, IrHelpView } from "./src/help-view";
import {
  IR_PLACEMENT_PRIORITY_VIEW_TYPE,
  IrPlacementPriorityView,
} from "./src/placement-priority-view";
import {
  IR_BULK_MARK_VIEW_TYPE,
  IrBulkMarkView,
} from "./src/bulk-mark-view";
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
import {
  drillReviewQueue,
  dueQueue,
  neuralQueue,
  neuralSlotsFromQueueState,
  obsidianLinkIndex,
  policyReviewQueue,
  slotFromElement,
  subsetReviewQueue,
  EMPTY_COLLECTION_COPY,
  EMPTY_NEURAL_COPY,
  type ReviewSlot,
  type SessionBarPhase,
} from "./src/review";
import type { QueuePolicy } from "./src/queue";
import {
  elementIdForNotePath,
  exciteNeuralElement,
  expandNeuralQueueIfNeeded,
  makeLcg,
  NEURAL_MAX_QUEUE,
  popNextNeuralElement,
  seedNeuralQueueState,
} from "./src/ir/neural";
import { buildNeuralAdjacency, neighborsForWalk } from "./src/ir/neural-graph";
import { IR_REVIEW_VIEW_TYPE, IrReviewView } from "./src/review-view";
import { openPriorityPrompt } from "./src/priority-prompt";
import { IrLedger, META, type Sm20MatrixFileV1 } from "./src/ir/ledger";
import {
  createEmptySm20Matrix,
  foldSm20MatrixFromEvents,
  getSm20MatrixStats,
  gradeToSmGrade,
  recordSm20Outcome,
  restoreSm20Matrix,
  snapshotSm20Matrix,
  type Sm20Matrix,
  type Sm20MatrixStats,
} from "./src/ir/sm20-matrix";
import {
  computeSm20Retrievability,
  SM20_RETRIEVABILITY_MAX,
  SM20_STABILITY_MIN,
  storedDifficultyTo01,
} from "./src/ir/sm20-scheduler";
import type { Grade } from "./src/fsrs";
import type { StoredCard } from "./src/ir/model";
import {
  computeLoad,
  computeUpcoming,
  disposeStatusBar,
  endOfDayMs,
  renderStatusBar,
  renderStatusBarError,
  type UpcomingLoad,
} from "./src/status-bar";
import {
  ObsidianVaultFs,
  type ObsidianDataAdapter,
} from "./src/ir/obsidian-vault-fs";
import { migrateNotes, elementIdForPath, type FrontmatterNote } from "./src/ir/migrate";
import {
  planOrphanRecoveries,
  uniquePromotedNotePath,
} from "./src/ir/orphan-notes";
import { isOcclusionItem, toAnkiTsv } from "./src/ir/anki-export";
import { planClearTombstone, planSourceDeletion, planSourceRelink, planSourceTombstoneOnly, planUndoSourceDeletion, missingSourcePaths, relinkCandidates, titleFromSourcePath, tombstonesOwnedBy, liveParentForDelete } from "./src/ir/deletion";
import {
  assertVaultRelativePath,
  basenameOf,
  inferPrefixRewrite,
  pathIsUnder,
  relocatedBySuffix,
  rewriteStoredPath,
  sourcePathRewrites,
  uniqueMovedPath,
} from "./src/ir/source-paths";
import { findLastUndoableGrade, nextLamport } from "./src/ir/log";
import {
  extractRevlog,
  formatDataReport,
} from "./src/ir/optimizer/revlog";
import { mostRecentBookmark, type BookmarkMap } from "./src/ir/bookmark";
import {
  cardToStored,
  configureEngine,
  newCard,
  storedToCard,
  writeCardToFrontmatter,
} from "./src/fsrs";
import { labelFor } from "./src/ir/labels";
import { newElementId, newEventId } from "./src/ir/ids";
import {
  clampPriority,
  newElement,
  type IrElement,
  type IrEvent,
} from "./src/ir/model";
import { buildPriorityPlacement, collectionSortOrder, formatPriority, planAdjacentBlockMove, planAdjust, planBlockInsertion, planSpread, type PriorityPlacementPreview } from "./src/ir/relative-priority";
import type { DeviceId, ElementId } from "./src/ir/ids";
import { IR_KEYS } from "./src/types";
import { newTopicState, readTopicFromFrontmatter, writeTopicToFrontmatter } from "./src/topic";
import {
  computeExtractAFactorPair,
  SM20_IMAGE_EXTRACT_AFACTOR,
  spreadExtractPriority,
} from "./src/sm18-ir-mechanics";
import {
  dueMsOf,
  scheduleToTopicState,
  topicStateToSchedule,
} from "./src/ir/queue-adapter";
import { buildCardResetCard } from "./src/ir/leech";
import {
  buildAdvanceEvents,
  parseAdvanceInput,
  parseJumpIntervalInput,
  planAdvanceElements,
  planManualSchedule,
} from "./src/ir/manual-schedule";
import { readCoreSearchMatchedPaths } from "./src/ir/search-view";
import { collectBranchIds } from "./src/ir/tree";
import {
  addLocalDays,
  computeElementHistoryCounts,
  planAdvancedPostpone,
  planAutoPostpone,
  planManualPostpone,
  planMercy,
  type MercyEntry,
} from "./src/ir/mercy";
import { repetitionDayKey, restoreSessionSnapshot, type SessionMode, type SessionSnapshot } from "./src/ir/session-snapshot";
import type { DailyPriorityAnalytics } from "./src/ir/priority-analytics";
import { mergeAnalyticsSessions, priorityProtection } from "./src/ir/priority-analytics";
import { effectiveItemRetention } from "./src/ir/priority-scheduling";
import { previewMercy } from "./src/ir/mercy-modal";
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
import {
  buildDuplicateIndex,
  findDuplicateTopicOrExtract,
  planBulkImport,
  type BulkImportPlan,
  type DuplicateIndex,
  type DuplicateMatch,
  type DuplicateSourceNote,
} from "./src/ir/bulk-import";
import {
  formatSmReadWarning,
  planSmCollectionImport,
  SmReadDiagnostics,
  type SmSourceFs,
} from "./src/ir/sm-collection-import";
import { readZipEntries } from "./src/ir/zip-read";
import { planEpubImport, planHtmlImport } from "./src/ir/epub-import";
import { folderTopicCandidates } from "./src/ir/folder-topics";
import { buildExtractEvent, buildPdfExtractEvent, buildPromoteEvent } from "./src/ir/extract";
import {
  IR_OCCLUSION_EDITOR_VIEW_TYPE,
  IrOcclusionEditorView,
} from "./src/occlusion-editor-view";
import { cropPdfPage, joinSelectionTexts, pageLabel, pdfCropStem, pdfPageNumber } from "./src/ir/pdf-canvas";
import {
  startPdfRectSelect,
  startRectSelectOnElement,
} from "./src/ir/pdf-rect-select";
import { MultiSelectController } from "./src/ir/multi-select-dom";
import {
  formatHeldSelectionConflictNotice,
  isMultiSelectModifier,
  mergeWithLive,
  type BodyHeldSelection,
  type PdfHeldSelection,
} from "./src/ir/multi-select";
import {
  OCCLUSION_LANG,
  occlusionBodies,
  occlusionNoteStem,
  parseOcclusionJson,
  type OcclusionMode,
  type OcclusionRect,
} from "./src/ir/occlusion";
import { renderOcclusion } from "./src/ir/occlusion-render";
import { findImageEmbedRange } from "./src/ir/image-embed";
import { fuzzyLocateInBody } from "./src/ir/fuzzy-text";
import { cropImageBytes } from "./src/ir/image-crop";
import type { NormalizedRect, PdfSelector } from "./src/ir/model";
import type { LogState } from "./src/ir/log";
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
  pdfContainerEl,
  pdfFileFromView,
  type PdfTextSelection,
  activeIrFile,
} from "./src/ir/pdf-view";
import {
  bodyOffsetsFromFullOffsets,
  fullOffsetsFromBodyOffsets,
  mapBodySpans,
  saveBody,
  serializeInitialNoteWithFrontmatter,
  stripFrontmatter,
} from "./src/ir/frontmatter-body";
import {
  expandSelectionAroundHeadingPrefix,
  expandSelectionAroundLinks,
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
  bodyOffsetOfFullCursor,
  discoverStructuralExtractSpans,
  findAllBlockquotes,
  findAllListItems,
  findAllParagraphs,
  findHeadingSectionAtOffset,
  findParagraphAtOffset,
  type Span,
  type StructuralExtractKind,
} from "./src/ir/extract-spans";
import {
  openIrRadialQuickMenu,
  type IrHubEntry,
} from "./src/ir-actions-radial";
import {
  getWorkspaceIrFabDue,
  notifyWorkspaceFabSync,
  registerWorkspaceIrFab,
  setWorkspaceIrFabDue,
} from "./src/ir-mobile-fab";
import { mobileAuxiliaryChromeShouldShow, sessionHubKinds } from "./src/ir/mobile-hub";
import { radialAnchorCenterBottom } from "./src/ir/mobile-viewport";
import { openMobileCaptureSheet } from "./src/ir/mobile-capture";
import { openMobileHubSheet } from "./src/ui/mobile-hub-sheet";
import { resolveUnifiedMobileHubEnabled } from "./src/ir/viewport-tiers";

/**
 * The bulk-extract commands ask for confirmation above this many candidate
 * spans. Picked to be permissive for typical fact-list notes (40 bullets is
 * fine without a prompt) while still catching the "I accidentally selected
 * a 300-paragraph book chapter" mistake before it explodes the queue.
 */
const BULK_EXTRACT_CONFIRM_THRESHOLD = 50;

/** Folder "mark all as topics" asks before writing this many new frontmatters. */
const FOLDER_TOPIC_CONFIRM_THRESHOLD = 10;

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "svg",
  "avif",
]);

function isImageFile(file: TFile): boolean {
  return IMAGE_EXTENSIONS.has(file.extension.toLowerCase());
}

/** Slash-only folder normalization for generated-note placement. */
function normalizePathForFolder(p: string): string {
  return p
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .trim();
}

/**
 * Machine-identifying string passed to `IrLedger.init` so each physical
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
  /**
   * Every command this plugin registers, in registration order.
   *
   * The help view renders its shortcut list from this array rather than a
   * hand-maintained copy, so a command added without a matching doc entry
   * cannot go missing from the cheat sheet.
   */
  private readonly irCommands: Command[] = [];

  private irReviewSession: {
    queue: ReviewSlot[];
    elementsById: Map<ElementId, IrElement>;
    isNeural?: boolean;
    phase?: SessionBarPhase;
    mode?: SessionMode;
    cursor?: number;
    emptyVault?: boolean;
    nothingDue?: UpcomingLoad;
  } | null = null;

  /**
   * The ledger, constructed once the layout exists (after a migration, or
   * immediately when `.ir/` is already present). It is the source of truth
   * for the queue and review loop; frontmatter is dual-written on every
   * action only as the migration fallback.
   */
  private ledger?: IrLedger;
  private sm20Matrix?: Sm20Matrix;
  private sm20MatrixMeta?: Pick<Sm20MatrixFileV1, "baseline" | "baselineCursorEventId" | "headEventId" | "eventCount">;

  /**
   * Ledger init / first-run migration. Started from onload but not awaited
   * there: a hung `.ir/` exists() on mobile must not block command and FAB
   * registration. Callers that need a ready ledger await this.
   */
  private ledgerInit: Promise<void> = Promise.resolve();

  /** Status bar queue-load indicator (UI commitment #4). */
  private statusBarEl?: HTMLElement;

  /**
   * Markdown selection captured on FAB pointerdown before mobile blur clears
   * it; used to build the radial and restore cursors when a petal runs.
   */
  private hubSelectionSnapshot: EditorSelectionSnapshot | null = null;

  /**
   * Wall-clock when the current review pass started (Alt+R / Alt+N). The
   * session audit (UI commitment #7) filters the ledger event log to events
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
   * {@link refreshExtractDecorations} after every ledger reconcile so new
   * extracts paint instantly without re-resolving anchors on each keystroke.
   */
  private decorationCache = new IrDecorationCache();

  /** Ledger-only PDF topics (`notePath` ends in .pdf). Sync after each reconcile. */
  private irPdfPaths = new Set<string>();

  private pdfHighlights?: PdfHighlightPainter;
  private lastPdfMarks = new Map<string, PdfExtractMark[]>();
  /** Survives the click that focuses review and collapses the PDF selection. */
  private lastPdfSelection: PdfTextSelection | null = null;

  /**
   * SuperMemo-style multi-selection: spans held with Ctrl+select (PDF text
   * layer, reading view, review card) until the next Extract joins them.
   */
  private multiSelect = new MultiSelectController((n) =>
    this.onHeldSelectionsChange(n),
  );
  /** Cancels an in-progress PDF rectangle-select mode. */
  private pdfRectCancel: (() => void) | null = null;
  /** Editor selections captured on Ctrl+mousedown so Ctrl+drag can add to them. */
  private editorCtrlSnapshot: EditorSelectionOrCaret[] | null = null;

  async onload() {
    await this.loadSettings();
    if (!this.settings.notices.collectionRedesign) {
      new Notice("Collection now separates global Priority from source structure.", 8_000);
      this.settings.notices.collectionRedesign = true;
      await this.saveSettings();
    }
    if (!this.settings.notices.prioritySuite) {
      new Notice(
        "Incremental Reading now includes priority queue controls, optional auto-postpone, priority-aware scheduling, and protection analytics. All automation remains off until enabled in settings.",
        12_000,
      );
      this.settings.notices.prioritySuite = true;
      await this.saveSettings();
    }
    this.applyEngineConfig();
    const fs = new ObsidianVaultFs(
      this.app.vault.adapter as unknown as ObsidianDataAdapter,
    );
    const ledger = new IrLedger(fs, { conflict: "clock-order" });
    this.ledger = ledger;
    const ledgerInit = this.runMigrationIfOwed(fs);
    this.ledgerInit = ledgerInit;
    ledger.setReadyBarrier(async () => {
      await ledgerInit;
      if (this.ledger !== ledger) {
        throw new Error("Incremental Reading: ledger initialization failed");
      }
    });
    this.addSettingTab(new IrSettingTab(this.app, this));
    this.pdfHighlights = new PdfHighlightPainter(this.app);
    this.registerDomEvent(document, "selectionchange", () => {
      const sel = findPdfTextSelection(this.app);
      if (sel) this.lastPdfSelection = sel;
    });

    // PDF regions + images + occlusion: editor leaf, card renderer, and the
    // document-level listeners behind Ctrl-multi-select and the image menu.
    this.registerView(
      IR_OCCLUSION_EDITOR_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new IrOcclusionEditorView(leaf),
    );
    this.registerMarkdownCodeBlockProcessor(OCCLUSION_LANG, (src, el, ctx) =>
      this.renderOcclusionBlock(src, el, ctx.sourcePath),
    );
    this.registerDomEvent(
      document,
      "mousedown",
      (evt) => this.onDocumentMouseDown(evt),
      true,
    );
    this.registerDomEvent(
      document,
      "mouseup",
      (evt) => this.onDocumentMouseUp(evt),
      true,
    );
    this.registerDomEvent(
      document,
      "contextmenu",
      (evt) => this.onDocumentContextMenu(evt),
      true,
    );
    this.registerDomEvent(document, "keydown", (evt) => {
      // Esc drops held spans. Never preventDefault: Vim and Obsidian keep
      // their own Esc semantics (UI commitment #1).
      if (evt.key === "Escape" && this.multiSelect.size > 0) {
        this.multiSelect.clear();
        new Notice("Incremental Reading: held selections cleared.");
      }
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
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.paintPdfHighlights();
      }),
    );
    // Initial decoration paint runs once the ledger is ready, below.
    void this.refreshExtractDecorations();

    // Glanceable queue-load indicator. Built before any other UI so it shows
    // up immediately, and refreshed once the ledger is ready below.
    this.statusBarEl = this.addStatusBarItem();
    renderStatusBar(
      this.statusBarEl,
      { due: 0, later: 0, postponed: 0, inflow7d: 0, dueByType: { topic: 0, extract: 0, item: 0 } },
      () => void this.startReview(),
      (evt) => this.showStatusBarMenu(evt),
    );
    void this.ledgerInit.then(async () => {
      await this.ensureSm20Matrix();
      await this.runStartupAutoPostpone();
      void this.refreshStatusBar();
      // Maintenance runs after the first paint: the first load still reads the
      // pre-checkpoint stream (unchanged behaviour), and this pass builds the
      // checkpoint so every later load skips the archives. Fire-and-forget.
      if (this.ledger) {
        void this.ledger
          .ensureCheckpoint(Date.now())
          .then(() => this.ledger?.compactLocalShard(Date.now()))
          .catch((e) => {
            console.warn("Incremental Reading: ledger checkpoint/compaction on load failed", e);
          });
      }
      // Wait for the vault index: before layout-ready, present files can
      // still read as missing and prompt for notes that exist.
      this.app.workspace.onLayoutReady(() => {
        if (!this.settings.notices.sm20SchedulerOffer) {
          new Sm20SchedulerOfferModal(this.app, async (choice) => {
            this.settings.primaryScheduler = choice;
            this.settings.notices.sm20SchedulerOffer = true;
            await this.saveSettings();
            this.refreshSchedulerViews();
          }).open();
        }
        void this.reconcileMissingSources().then(() => this.offerPendingRelinks());
      });
    });

    // Background tick: refreshes the "+N/7d" rolling window so it does not
    // drift when nothing in the plugin is triggering a redraw. Cheap (reads
    // a folded in-memory state). Cleaned up automatically on unload via
    // registerInterval.
    this.registerInterval(
      window.setInterval(() => void this.refreshStatusBar(false), 60_000),
    );

    if (Platform.isMobile) {
      this.register(
        registerWorkspaceIrFab(this, {
          prepareOpenHub: () => this.captureHubEditorSelection(),
          openHub: () => void this.openIrActionsHub(),
          onLongPress: () => this.mobileOpenCaptureSheet(),
          isEnabled: () => resolveUnifiedMobileHubEnabled(this.settings),
        }),
      );
      void this.refreshStatusBar();
    }

    this.addRibbonIcon("brain-circuit", "Start IR review", () => {
      void this.startReview();
    });

    this.irCommand({
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

    this.irCommand({
      id: "resume-neural-queue",
      name: "Resume Neural Queue",
      icon: "network",
      callback: () => void this.resumeNeuralReview(),
    });

    this.irCommand({
      id: "start-review",
      name: "Start IR review",
      icon: "play-circle",
      hotkeys: [{ modifiers: ["Alt"], key: "r" }],
      callback: () => void this.startReview(),
    });
    this.irCommand({
      id: "start-random-review",
      name: "Start random review (reschedules items)",
      icon: "shuffle",
      callback: () => void this.startRandomReview(),
    });
    this.irCommand({
      id: "sort-review-now",
      name: "Sort current review queue now",
      icon: "arrow-down-up",
      checkCallback: (checking) => {
        const view = this.getActiveReviewView();
        if (!view) return false;
        if (!checking) void this.sortCurrentReviewNow(view);
        return true;
      },
    });

    this.irCommand({
      id: "jump-interval",
      name: "Jump interval…",
      icon: "calendar-plus",
      checkCallback: (checking) => {
        const view = this.getActiveReviewView();
        if (!view || !view.getCurrentElementId()) return false;
        if (!checking) view.openJumpIntervalBar();
        return true;
      },
    });

    this.irCommand({
      id: "advance-elements",
      name: "Advance element / selection…",
      icon: "fast-forward",
      checkCallback: (checking) => {
        const rv = this.getActiveReviewView();
        if (rv && rv.getCurrentElementId()) {
          if (!checking) rv.openAdvanceBar();
          return true;
        }
        const tv = this.getTreeView();
        if (tv) {
          if (!checking) {
            if (!tv.openAdvanceForSelection()) {
              new Notice("Incremental Reading: select an element in Collection or Review first.");
            }
          }
          return true;
        }
        return false;
      },
    });

    this.irCommand({
      id: "review-search-due",
      name: "Review Obsidian search results (due)",
      icon: "search",
      callback: () => void this.reviewObsidianSearchResults(false),
    });

    this.irCommand({
      id: "review-search-all",
      name: "Review Obsidian search results (all)",
      icon: "search-check",
      callback: () => void this.reviewObsidianSearchResults(true),
    });

    this.irCommand({
      id: "duplicate-sibling-element",
      name: "Duplicate element as sibling",
      icon: "copy-plus",
      checkCallback: (checking) => {
        const id = this.getActiveReviewView()?.getCurrentElementId();
        if (!id) return false;
        if (!checking) void this.duplicateSiblingElement(id);
        return true;
      },
    });

    this.registerView(
      IR_TREE_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => {
        if (!this.ledger) {
          throw new Error(
            "Incremental Reading: ledger not ready for tree view.",
          );
        }
        return new IrTreeView(leaf, {
          ledger: this.ledger,
          commitPriority: (elementId, file, priority) =>
            this.applyIrPriorityChange(elementId, file, priority),
          commitDismiss: (elementId, file, dismissed) =>
            this.applyIrDismissChange(elementId, file, dismissed),
          commitPostpone: (elementId, file, days) =>
            this.applyIrPostponeChange(elementId, file, days),
          commitPostponeBatch: (ids, days) =>
            this.applyIrPostponeBatch(ids, days),
          commitReparent: (elementId, newParentId) =>
            this.applyIrReparent(elementId, newParentId),
          commitDelete: (elementId, parentId) =>
            this.applyIrDelete(elementId, parentId),
          commitPromote: (elementId, element) =>
            this.applyIrPromote(elementId, element),
          commitReanchor: (elementId, element) =>
            this.applyIrReanchor(elementId, element),
          commitReset: (elementId, file) =>
            this.applyIrReset(elementId, file),
          commitJumpInterval: (elementId, file, raw) =>
            this.applyManualReschedule(elementId, file, raw),
          commitAdvance: (ids, rawHorizon) =>
            this.applyAdvanceElements(ids, rawHorizon),
          forkExtract: (elementId) => void this.forkStoreExtract(elementId),
          duplicateSibling: (elementId) => void this.duplicateSiblingElement(elementId),
          startBranchReview: (rootId, includeFuture) =>
            void this.startBranchReview(rootId, includeFuture),
          startSubsetReview: (ids, includeFuture, phase) =>
            void this.startSubsetReview(ids, includeFuture, phase ?? "subset"),
          addToSession: (ids) => void this.addElementsToSession(ids),
          resumeReading: (elementId) => this.resumeReadingBookmark(elementId),
          startNeuralReview: (elementId) =>
            void this.startNeuralReview(elementId, null),
          revealInReview: (elementId) =>
            this.getActiveReviewView()?.jumpToElement(elementId) ?? false,
          displayMode: this.settings.treeDisplayMode,
          saveDisplayMode: (mode) => {
            this.settings.treeDisplayMode = mode;
            void this.saveSettings();
          },
          commitPriorityPlan: (plan) => this.applyPriorityPlan(plan),
          commitPriorityPreview: (preview, file) =>
            this.applyIrPriorityPreview(preview, file),
          initialCurrentElementId:
            this.getActiveReviewView()?.getCurrentElementId() ?? null,
        });
      },
    );

    this.registerView(
      IR_SESSION_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => {
        if (!this.ledger) {
          throw new Error(
            "Incremental Reading: ledger not ready for session view.",
          );
        }
        return new IrSessionView(
          leaf,
          this.ledger,
          this.sessionStartMs,
          (id, notePath) => this.revealSessionEntry(id, notePath),
        );
      },
    );

    this.registerView(
      IR_STATS_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => {
        if (!this.ledger) {
          throw new Error(
            "Incremental Reading: ledger not ready for stats view.",
          );
        }
        return new IrStatsView(leaf, this.ledger, {
          settings: this.settings,
          saveSettings: () => this.saveSettings(),
          applyEngineConfig: () => this.applyEngineConfig(),
          openElement: (elementId, notePath) =>
            this.revealSessionEntry(elementId, notePath),
          postponeElement: async (elementId, days) => {
            const state = await this.ledger!.load();
            const el = state.elements.get(elementId);
            const af = el?.notePath
              ? this.app.vault.getAbstractFileByPath(el.notePath)
              : null;
            const file = af instanceof TFile ? af : null;
            await this.applyIrPostponeChange(elementId, file, days);
          },
          duplicateOrSplitElement: (elementId) =>
            this.duplicateSiblingElement(elementId),
          dismissElement: async (elementId, dismissed) => {
            const state = await this.ledger!.load();
            const el = state.elements.get(elementId);
            const af = el?.notePath
              ? this.app.vault.getAbstractFileByPath(el.notePath)
              : null;
            const file = af instanceof TFile ? af : null;
            await this.applyIrDismissChange(elementId, file, dismissed);
          },
          resetElement: async (elementId) => {
            const state = await this.ledger!.load();
            const el = state.elements.get(elementId);
            const af = el?.notePath
              ? this.app.vault.getAbstractFileByPath(el.notePath)
              : null;
            const file = af instanceof TFile ? af : null;
            await this.applyIrReset(elementId, file);
          },
          startSubsetReview: (ids, includeFuture) =>
            this.startSubsetReview(ids as ElementId[], includeFuture ?? false, "subset"),
          getSm20Matrix: () => this.getSm20Matrix(),
          rebuildSm20Matrix: () => this.rebuildSm20MatrixFromHistory(true),
          refreshSchedulerViews: () => this.refreshSchedulerViews(),
        });
      },
    );

    this.registerView(
      IR_HELP_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new IrHelpView(leaf, this.irCommands),
    );

    this.registerView(
      IR_PLACEMENT_PRIORITY_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new IrPlacementPriorityView(leaf),
    );

    this.registerView(
      IR_BULK_MARK_VIEW_TYPE,
      (leaf: WorkspaceLeaf) =>
        new IrBulkMarkView(leaf, {
          app: this.app,
          defaultPriority: this.settings.defaultPriority,
          loadSkipPaths: () => this.loadIrSkipPaths(),
          onCommit: async (request) => {
            await this.commitBulkMarkTopics(request.attempted, request.priorities);
            this.app.workspace.detachLeavesOfType(IR_BULK_MARK_VIEW_TYPE);
          },
        }),
    );

    this.registerView(IR_REVIEW_VIEW_TYPE, (leaf: WorkspaceLeaf) => {
        if (!this.ledger) {
          throw new Error(
            "Incremental Reading: ledger not ready for review view.",
          );
        }
        const session = this.irReviewSession;
        const isNeural = session?.isNeural ?? false;
        const phase = session?.phase;
        const emptyVault = session?.emptyVault ?? false;
        const nothingDue = session?.nothingDue ?? null;
        this.irReviewSession = null;
        const queue = session?.queue ?? [];
        const elementsById = session?.elementsById ?? new Map<ElementId, IrElement>();
        const view = new IrReviewView(leaf, {
          plugin: this,
          settings: this.settings,
          ledger: this.ledger,
          queue,
          elementsById,
          isNeural,
          phase,
          onChange: () => void this.refreshStatusBar(),
          openIrHub: () => void this.openIrActionsHub(),
          onSlotChange: (id) => {
            this.notifyTreeOfReviewSlot(id);
            this.paintPdfHighlights();
          },
          onMobileChromeChange: notifyWorkspaceFabSync,
          commitUndoLastGrade: () => this.undoLastGrade(),
          getSourceExtractRanges: (path) => this.decorationCache.rangesFor(path),
          refreshDecorations: () => this.refreshExtractDecorations(),
          commitPromoteExtract: (id, el) => this.applyIrPromote(id, el),
          restoreEmptySession: () => this.restoreEmptyReviewSession(),
          commitReanchor: (id, el) => this.applyIrReanchor(id, el),
          commitDetachAnchor: (id, el) => this.applyIrDetachAnchor(id, el),
          startOutstandingDue: () => void this.startReview(),
          emptyVault,
          commitPdfExtract: (opts) => this.extractFromPdfInReview(opts),
          nothingDue,
          getUpcoming: () => this.computeReviewUpcoming(),
          openTreeFromIdlePane: () => void this.openTreeView(),
          openHelpFromIdlePane: () => void this.openHelpView(),
          commitPriority: (id, file, priority) =>
            this.applyIrPriorityChange(id, file, priority),
          commitPriorityPreview: (preview, file) =>
            this.applyIrPriorityPreview(preview, file),
          commitJumpInterval: (id, file, raw) =>
            this.applyManualReschedule(id, file, raw),
          commitAdvance: (ids, rawHorizon) =>
            this.applyAdvanceElements(ids, rawHorizon),
          duplicateSibling: (id) => this.duplicateSiblingElement(id),
          onSessionState: (orderedIds, cursor, progress) =>
            void this.persistSessionCursor(orderedIds, cursor, progress),
          onNeuralExcite: (elementId, visitedPrefixIds) =>
            this.exciteActiveNeuralSession(elementId, visitedPrefixIds),
          onNeuralRefreshSlots: (visitedPrefixIds) =>
            this.refreshActiveNeuralSlots(visitedPrefixIds),
          saveSettings: () => this.saveSettings(),
          getSm20Matrix: () => this.sm20Matrix,
          onSm20Grade: (eventId, prevCard, nextCard, grade, overridden) =>
            this.recordSm20Grade(eventId, prevCard, nextCard, grade, overridden),
        });
        view.multiSelect = this.multiSelect;
        return view;
      },
    );

    this.irCommand({
      id: "open-tree-view",
      name: "Open IR collection",
      icon: "list-tree",
      hotkeys: [{ modifiers: ["Alt"], key: "i" }],
      callback: () => void this.openTreeView(),
    });

    this.irCommand({
      id: "open-session-log",
      name: "Open IR session log",
      icon: "history",
      hotkeys: [{ modifiers: ["Alt"], key: "l" }],
      callback: () => void this.openSessionView(),
    });

    this.irCommand({
      id: "start-final-drill",
      name: "Start Final Drill",
      icon: "repeat",
      callback: () => void this.startFinalDrill(),
    });

    this.irCommand({
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
    for (const [id, name, direction] of [
      ["increase-ir-priority", "Increase priority one position", -1],
      ["decrease-ir-priority", "Decrease priority one position", 1],
    ] as const) {
      this.irCommand({
        id,
        name,
        icon: direction < 0 ? "arrow-up" : "arrow-down",
        checkCallback: (checking) => {
          const tree = this.getTreeView();
          const ids = tree?.prioritySelection() ?? [];
          if (ids.length === 0) return false;
          if (!checking) void this.movePrioritySelection(ids, direction);
          return true;
        },
      });
    }

    this.irCommand({
      id: "open-help",
      name: "IR help and keyboard shortcuts",
      icon: "keyboard",
      hotkeys: [{ modifiers: ["Alt"], key: "h" }],
      callback: () => void this.openHelpView(),
    });

    this.irCommand({
      id: "export-anki-tsv",
      name: "Export IR items to Anki TSV",
      icon: "download",
      hotkeys: [{ modifiers: ["Alt"], key: "e" }],
      callback: () => void this.exportAnkiTsv(),
    });

    this.irCommand({
      id: "show-stats",
      name: "Show IR stats",
      icon: "bar-chart-3",
      hotkeys: [{ modifiers: ["Alt"], key: "s" }],
      callback: () => void this.openStatsView(),
    });

    this.irCommand({
      id: "mercy-postpone",
      name: "Postpone overdue elements (mercy)",
      icon: "clock",
      hotkeys: [{ modifiers: ["Alt"], key: "m" }],
      callback: () => void this.runMercy(),
    });

    this.irCommand({
      id: "undo-last-mercy",
      name: "Undo last mercy",
      icon: "undo-2",
      callback: () => void this.undoLastMercy(),
    });

    this.irCommand({
      id: "resume-last-read",
      name: "Resume last read topic",
      icon: "bookmark",
      callback: () => void this.resumeReadingBookmark(),
    });

    this.irCommand({
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

    this.irCommand({
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

    this.irCommand({
      id: "mark-as-ir-topic",
      name: "Mark current note as IR topic",
      icon: "book-open",
      hotkeys: [{ modifiers: ["Alt"], key: "t" }],
      // Markdown notes and PDFs (ledger-only; PDFs have no YAML).
      checkCallback: (checking: boolean) => {
        const file = activeIrFile(this.app);
        if (!file || (file.extension !== "md" && file.extension !== "pdf")) {
          return false;
        }
        if (!checking) void this.markActiveFileAsTopic(file);
        return true;
      },
    });

    this.irCommand({
      id: "mark-as-ir-topic-with-priority",
      name: "Mark current note as IR topic with priority",
      icon: "book-plus",
      checkCallback: (checking: boolean) => {
        const file = activeIrFile(this.app);
        if (!file || (file.extension !== "md" && file.extension !== "pdf")) {
          return false;
        }
        if (!checking) void this.openMarkWithPriority(file);
        return true;
      },
    });

    this.irCommand({
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

    this.irCommand({
      id: "bulk-mark-ir-topics",
      name: "Bulk mark folders and files as IR topics",
      icon: "library",
      callback: () => void this.openBulkMarkView(),
    });

    // SuperMemo parity: Alt+X extract, Alt+Z cloze. Defaults only; users
    // can rebind or clear them in Settings -> Hotkeys.
    // Uses checkCallback (not editorCheckCallback) so the hotkey also works
    // inside the IR review ItemView, which is not a MarkdownView.
    this.irCommand({
      id: "extract-selection",
      name: "Extract selection",
      icon: "scissors",
      hotkeys: [{ modifiers: ["Alt"], key: "x" }],
      checkCallback: (checking) => {
        const pdfSel = this.activePdfSelection();
        const heldPdf = this.heldPdfFile();
        if (pdfSel || heldPdf) {
          if (!checking) {
            void this.extractFromPdfSelection(pdfSel);
          }
          return true;
        }
        const rv = this.getFocusedReviewView();
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
    this.irCommand({
      id: "extract-selection-to-note",
      name: "Extract selection to standalone note",
      icon: "file-plus",
      hotkeys: [{ modifiers: ["Alt", "Shift"], key: "x" }],
      checkCallback: (checking) => {
        const pdfSel = this.activePdfSelection();
        if (pdfSel) {
          if (!checking) {
            void this.extractFromPdfSelection(pdfSel, { promote: true });
          }
          return true;
        }
        const rv = this.getFocusedReviewView();
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

    this.irCommand({
      id: "extract-selection-with-priority",
      name: "Extract selection with priority",
      icon: "scissors",
      checkCallback: (checking) => {
        if (!this.canExtractSelection()) return false;
        if (!checking) void this.openExtractWithPriority();
        return true;
      },
    });

    this.irCommand({
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

    this.irCommand({
      id: "extract-pdf-region",
      name: "Extract image region from PDF (drag a rectangle)",
      icon: "crop",
      hotkeys: [{ modifiers: ["Alt", "Shift"], key: "i" }],
      checkCallback: (checking) => {
        if (!this.activePdfLeafContainer()) return false;
        if (!checking) void this.startPdfRegionCapture("extract");
        return true;
      },
    });

    this.irCommand({
      id: "occlusion-from-pdf-region",
      name: "Image occlusion items from PDF region (drag a rectangle)",
      icon: "scan",
      hotkeys: [{ modifiers: ["Alt", "Shift"], key: "o" }],
      checkCallback: (checking) => {
        if (!this.activePdfLeafContainer()) return false;
        if (!checking) void this.startPdfRegionCapture("occlusion");
        return true;
      },
    });

    this.irCommand({
      id: "occlusion-from-image",
      name: "Image occlusion items from image",
      icon: "scan",
      hotkeys: [{ modifiers: ["Alt"], key: "o" }],
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || !isImageFile(file)) return false;
        if (!checking) void this.occlusionFromImageFile(file);
        return true;
      },
    });

    this.irCommand({
      id: "clear-held-selections",
      name: "Clear held (Ctrl) selections",
      icon: "eraser",
      hotkeys: [{ modifiers: ["Alt", "Shift"], key: "c" }],
      checkCallback: (checking) => {
        if (this.multiSelect.size === 0) return false;
        if (!checking) {
          this.multiSelect.clear();
          new Notice("Incremental Reading: held selections cleared.");
        }
        return true;
      },
    });

    this.irCommand({
      id: "cloze-selection",
      name: "Cloze selection into an IR item",
      icon: "brackets",
      hotkeys: [{ modifiers: ["Alt"], key: "z" }],
      checkCallback: (checking) => {
        const rv = this.getFocusedReviewView();
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

    this.irCommand({
      id: "ir-actions-hub",
      name: "IR quick actions (radial wheel)",
      icon: "layout-list",
      /** Alt+Shift+U: avoids single-modifier Alt+letter core bindings. */
      hotkeys: [{ modifiers: ["Alt", "Shift"], key: "u" }],
      callback: () => void this.openIrActionsHub(),
    });

    this.irCommand({
      id: "ir-new-cloze-card-separate",
      name: "New cloze item (separate note from selection)",
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

    this.irCommand({
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
    this.irCommand({
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

    this.irCommand({
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

    this.irCommand({
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

    this.irCommand({
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

    this.irCommand({
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

    this.irCommand({
      id: "bulk-import",
      name: "Import clipboard as IR topic",
      icon: "clipboard-paste",
      hotkeys: [{ modifiers: ["Alt"], key: "b" }],
      callback: () => void this.bulkImport(),
    });

    this.irCommand({
      id: "import-sm-collection",
      name: "Import SuperMemo collection (SM18 / SM20)",
      icon: "folder-input",
      callback: () => void this.importSmCollection(),
    });

    this.irCommand({
      id: "import-epub-or-html",
      name: "Import EPUB or HTML document",
      icon: "book-plus",
      callback: () => void this.importEpubOrHtmlDocument(),
    });

    this.irCommand({
      id: "optimizer-data-report",
      name: "Copy optimizer data report",
      icon: "clipboard-list",
      callback: () => void this.copyOptimizerDataReport(),
    });

    this.irCommand({
      id: "rebuild-sm20-matrix",
      name: "Rebuild SM-20 optimization matrix",
      icon: "refresh-cw",
      callback: () => void this.rebuildSm20MatrixFromHistory(true),
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
                .setTitle("Open IR collection")
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
              .setTitle("New cloze item (separate note)")
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
        // Vault load fires create for every existing file; those are not
        // restores. Load-time re-links go through offerPendingRelinks.
        if (!this.app.workspace.layoutReady) return;
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
          menu.addItem((item) =>
            item
              .setTitle("Bulk mark as IR topics…")
              .setIcon("library")
              .onClick(() => void this.openBulkMarkView([file])),
          );
          return;
        }
        if (!(file instanceof TFile)) return;
        if (file.extension === "pdf") {
          if (!this.irPdfPaths.has(file.path)) {
            this.addMarkTopicMenuItems(menu, file);
          }
          this.addMobileIrFileMenuNav(menu);
          return;
        }
        if (file.extension === "epub" || file.extension === "html" || file.extension === "htm") {
          menu.addItem((item) =>
            item
              .setTitle("Import into Incremental Reading")
              .setIcon("book-plus")
              .onClick(() => void this.importEpubOrHtmlDocument(file)),
          );
          return;
        }
        if (file.extension !== "md") return;
        const irType = getIrType(this.app, file);
        if (!irType) {
          this.addMarkTopicMenuItems(menu, file);
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
              void this.openTreeAndFocusPriorityEditor(file);
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

    // Obsidian can fire `files-menu` twice per right-click; guard per Menu.
    const seenBulkMenus = new WeakSet<Menu>();
    this.registerEvent(
      (this.app.workspace as unknown as {
        on(
          name: "files-menu",
          cb: (menu: Menu, files: TAbstractFile[]) => void,
        ): { e: unknown };
      }).on("files-menu", (menu, files) => {
        if (!Array.isArray(files) || files.length === 0) return;
        if (seenBulkMenus.has(menu)) return;
        seenBulkMenus.add(menu);
        menu.addItem((item) =>
          item
            .setTitle("Bulk mark as IR topics…")
            .setIcon("library")
            .onClick(() => void this.openBulkMarkView(files)),
        );
      }) as Parameters<Plugin["registerEvent"]>[0],
    );

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu: Menu, file) => {
        if (!(file instanceof TFile) || !isImageFile(file)) return;
        menu.addItem((item) =>
          item
            .setTitle("Image occlusion items from image")
            .setIcon("scan")
            .onClick(() => void this.occlusionFromImageFile(file)),
        );
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

  private addMarkTopicMenuItems(menu: Menu, file: TFile): void {
    menu.addItem((item) =>
      item
        .setTitle("Mark as IR topic")
        .setIcon("book-open")
        .onClick(() => void this.markActiveFileAsTopic(file)),
    );
    menu.addItem((item) =>
      item
        .setTitle("Mark as IR topic with priority…")
        .setIcon("book-plus")
        .onClick(() => void this.openMarkWithPriority(file)),
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
        .setTitle("Open IR collection")
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

  /**
   * Return an `IrReviewView` ONLY when the Review pane itself (or its embedded
   * `ReviewLiveEditor`) currently owns workspace/DOM focus or the active
   * selection — never when the user is editing a separate `MarkdownView` tab
   * while a Review tab sits in the background.
   */
  private getFocusedReviewView(): IrReviewView | null {
    const active = this.app.workspace.getActiveViewOfType(IrReviewView);
    if (active) return active;
    const doc = typeof document !== "undefined" ? document : null;
    const activeEl = doc?.activeElement ?? null;
    const selAnchor = doc?.getSelection?.()?.anchorNode ?? null;
    for (const leaf of this.app.workspace.getLeavesOfType(IR_REVIEW_VIEW_TYPE)) {
      const view = leaf.view;
      if (!(view instanceof IrReviewView)) continue;
      if (activeEl && view.containerEl.contains(activeEl)) return view;
      if (selAnchor && view.containerEl.contains(selAnchor)) return view;
    }
    return null;
  }

  private async allocLamport(now = Date.now()): Promise<number> {
    if (!this.ledger) return now;
    return Math.max(now, await this.ledger.nextLamport());
  }

  private async flushEditorToVault(editor: Editor, file: TFile): Promise<string> {
    const full = editor.getValue();
    try {
      if ((await this.app.vault.cachedRead(file)) !== full) {
        await this.app.vault.modify(file, full);
      }
    } catch {
      /* best-effort pre-extract/cloze buffer flush */
    }
    return full;
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
    this.pdfRectCancel?.();
    this.pdfRectCancel = null;
    this.multiSelect.dispose();
    this.app.workspace.detachLeavesOfType(IR_OCCLUSION_EDITOR_VIEW_TYPE);
    this.irReviewSession = null;
    this.app.workspace.detachLeavesOfType(IR_TREE_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(IR_SESSION_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(IR_STATS_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(IR_HELP_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(IR_PLACEMENT_PRIORITY_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(IR_BULK_MARK_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(IR_REVIEW_VIEW_TYPE);
    if (this.statusBarEl) {
      disposeStatusBar(this.statusBarEl);
      this.statusBarEl = undefined;
    }
  }

  /**
   * Re-render the status bar from the current ledger state and repaint the
   * editor extract decorations from the same load. Safe to call before the
   * ledger is ready (it leaves a zero-state placeholder); safe to call
   * repeatedly (both renders are idempotent).
   *
   * Decorations piggyback here because they react to the same trigger the
   * status bar does (ledger changed) and pushing them on every reconcile from
   * its caller would require touching ~20 sites instead of one.
   */
  private async refreshStatusBar(refreshDecorations = true): Promise<void> {
    if (!this.statusBarEl) return;
    if (!this.ledger) return;
    try {
      const { state, recentEvents, lastDueChange, createdTimestamps } = await this.ledger.loadView();
      const load = computeLoad(
        state.elements.values(),
        recentEvents,
        Date.now(),
        lastDueChange,
        createdTimestamps,
      );
      const device = await this.ledger.getDeviceId();
      const analytics = await this.ledger.loadDailyAnalytics(device, repetitionDayKey());
      if (analytics) {
        const protection = priorityProtection(analytics);
        load.protection = { item: protection.item, reading: protection.reading, exact: true };
      }
      // Mobile has no status bar; the FAB badge is the same number.
      setWorkspaceIrFabDue(load.due);
      renderStatusBar(
        this.statusBarEl,
        load,
        () => void this.startReview(),
        (evt) => this.showStatusBarMenu(evt),
      );
      this.refreshAuxiliaryViews();
      if (refreshDecorations) void this.refreshExtractDecorations(state);
    } catch (e) {
      console.error("Incremental Reading: status bar refresh failed", e);
      setWorkspaceIrFabDue(0);
      renderStatusBarError(
        this.statusBarEl,
        () => void this.startReview(),
        (evt) => this.showStatusBarMenu(evt),
      );
    }
  }

  public refreshSchedulerViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(IR_REVIEW_VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof IrReviewView) view.refreshView();
    }
    for (const leaf of this.app.workspace.getLeavesOfType(IR_STATS_VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof IrStatsView) void view.refresh();
    }
  }

  public getSm20Matrix(): Sm20Matrix | undefined {
    return this.sm20Matrix;
  }

  private async ensureSm20Matrix(): Promise<Sm20Matrix> {
    if (!this.ledger) {
      this.sm20Matrix = this.sm20Matrix ?? createEmptySm20Matrix();
      return this.sm20Matrix;
    }
    const events = await this.ledger.loadEvents();
    const sorted = [...events].sort((a, b) => a.lamport - b.lamport || a.id.localeCompare(b.id));
    const headEventId = sorted.length > 0 ? sorted[sorted.length - 1]!.id : null;
    const eventCount = sorted.length;

    const cached = await this.ledger.readSm20Matrix();
    if (cached && cached.headEventId === headEventId && cached.eventCount === eventCount) {
      try {
        this.sm20Matrix = restoreSm20Matrix(cached.matrix);
        this.sm20MatrixMeta = {
          baseline: cached.baseline,
          baselineCursorEventId: cached.baselineCursorEventId ?? null,
          headEventId,
          eventCount,
        };
        return this.sm20Matrix;
      } catch {
        // Fall through to rebuild
      }
    }

    const baseline = cached?.baseline;
    const baselineCursorEventId = cached?.baselineCursorEventId ?? null;
    const matrix = foldSm20MatrixFromEvents(sorted, {
      ...(baseline ? { baseline } : {}),
      ...(baselineCursorEventId ? { afterEventId: baselineCursorEventId } : {}),
    });
    this.sm20Matrix = matrix;
    this.sm20MatrixMeta = { baseline, baselineCursorEventId, headEventId, eventCount };
    await this.ledger.writeSm20Matrix({
      schemaVersion: 2,
      matrix: snapshotSm20Matrix(matrix),
      ...(baseline ? { baseline } : {}),
      ...(baselineCursorEventId !== null ? { baselineCursorEventId } : {}),
      headEventId,
      eventCount,
    }).catch((e) => {
      console.warn("Incremental Reading: could not persist SM-20 matrix cache", e);
    });
    return matrix;
  }

  private async recordSm20Grade(
    eventId: string,
    prevCard: StoredCard | undefined,
    nextCard: StoredCard,
    grade: Grade,
    overridden = false,
  ): Promise<void> {
    const matrix = this.sm20Matrix ?? (await this.ensureSm20Matrix());
    if (!overridden && prevCard && prevCard.reps > 0 && prevCard.stability > 0) {
      const prevS = prevCard.stability;
      const prevD01 = storedDifficultyTo01(prevCard.difficulty);
      const elapsedDays =
        prevCard.lastReview !== undefined && nextCard.lastReview !== undefined
          ? Math.max(0, (nextCard.lastReview - prevCard.lastReview) / 86_400_000)
          : Math.max(0, nextCard.elapsedDays ?? 0);
      const r = computeSm20Retrievability(elapsedDays, prevS);
      recordSm20Outcome(matrix, {
        prevDifficulty01: prevD01,
        prevStability: prevS,
        retrievability: r,
        nextStability: nextCard.stability,
        smGrade: gradeToSmGrade(grade),
      });
    }
    if (!this.ledger) return;
    const prevCount = this.sm20MatrixMeta?.eventCount ?? 0;
    const meta: Sm20MatrixFileV1 = {
      schemaVersion: 2,
      matrix: snapshotSm20Matrix(matrix),
      ...(this.sm20MatrixMeta?.baseline ? { baseline: this.sm20MatrixMeta.baseline } : {}),
      ...(this.sm20MatrixMeta?.baselineCursorEventId !== undefined
        ? { baselineCursorEventId: this.sm20MatrixMeta.baselineCursorEventId }
        : {}),
      headEventId: eventId,
      eventCount: prevCount + 1,
    };
    this.sm20MatrixMeta = {
      baseline: meta.baseline,
      baselineCursorEventId: meta.baselineCursorEventId ?? null,
      headEventId: meta.headEventId,
      eventCount: meta.eventCount,
    };
    await this.ledger.writeSm20Matrix(meta);
  }

  public async rebuildSm20MatrixFromHistory(notify = false): Promise<void> {
    if (!this.ledger) return;
    const events = await this.ledger.loadEvents();
    const sorted = [...events].sort((a, b) => a.lamport - b.lamport || a.id.localeCompare(b.id));
    const headEventId = sorted.length > 0 ? sorted[sorted.length - 1]!.id : null;
    const eventCount = sorted.length;
    const matrix = foldSm20MatrixFromEvents(sorted);
    this.sm20Matrix = matrix;
    this.sm20MatrixMeta = {
      baseline: undefined,
      baselineCursorEventId: null,
      headEventId,
      eventCount,
    };
    await this.ledger.writeSm20Matrix({
      schemaVersion: 2,
      matrix: snapshotSm20Matrix(matrix),
      headEventId,
      eventCount,
    });
    this.refreshSchedulerViews();
    if (notify) {
      const stats = getSm20MatrixStats(matrix);
      new Notice(
        `Incremental Reading: rebuilt SM-20 matrix (${stats.totalSincCases} SInc, ${stats.totalRecallCases} Recall observations).`,
      );
    }
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
        .setTitle("Open IR collection")
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
    cursor?: number;
  } | null> {
    if (!this.ledger) return null;
    await this.ledgerInit;
    const state = await this.ledger.load();
    const saved = await this.ledger.loadSessionSnapshot();
    if (saved) {
      const available = new Set(state.elements.keys());
      const restored = restoreSessionSnapshot(saved, available, repetitionDayKey(), 1);
      if (restored) {
        const slots = restored.orderedIds
          .map((id) => {
            const element = state.elements.get(id);
            return element ? slotFromElement(this.app, element) : null;
          })
          .filter((slot): slot is ReviewSlot => slot !== null);
        if (slots.length > 0) {
          this.beginReviewSession();
          return { queue: slots, elementsById: state.elements,
            isNeural: restored.mode === "neural", cursor: restored.cursor };
        }
      }
    }
    const now = Date.now();
    const seed = new Date(now).setHours(0, 0, 0, 0);
    const queue = policyReviewQueue(this.app, state, this.queuePolicy("due", seed), new Date(now));
    if (queue.length === 0) return null;
    this.beginReviewSession();
    await this.saveNewSessionSnapshot("due", queue, seed);
    return { queue, elementsById: state.elements, isNeural: false };
  }

  private queuePolicy(scope: QueuePolicy["scope"], seed: number): QueuePolicy {
    const policy = this.settings.sortingPolicy;
    return { version: 1, scope, traversal: policy.traversal,
      readingProportion: policy.readingProportion, itemJitter: policy.itemJitter,
      readingJitter: policy.readingJitter, seed, autoSort: policy.autoSort };
  }

  private async saveNewSessionSnapshot(
    mode: SessionMode,
    queue: readonly ReviewSlot[],
    seed: number,
  ): Promise<void> {
    if (!this.ledger || queue.length === 0) return;
    const snapshot: SessionSnapshot = {
      schemaVersion: 1,
      mode,
      orderedIds: queue.map((slot) => slot.id),
      cursor: 0,
      seed,
      policyVersion: 1,
      repetitionDayKey: repetitionDayKey(),
      createdAt: Date.now(),
    };
    await this.ledger.saveSessionSnapshot(snapshot).catch((error) =>
      console.warn("Incremental Reading: could not save review session snapshot", error));
  }

  private async persistSessionCursor(
    orderedIds: ElementId[],
    cursor: number,
    progress?: {
      processedIds: ElementId[];
      skippedIds: ElementId[];
      remainingIds: ElementId[];
    },
  ): Promise<void> {
    if (!this.ledger) return;
    const snapshot = await this.ledger.loadSessionSnapshot();
    if (!snapshot) return;
    if (progress) {
      await this.recordAnalyticsSessionProgress(snapshot, progress);
    }
    if (cursor >= orderedIds.length) {
      await this.ledger.clearSessionSnapshot().catch(() => undefined);
      return;
    }
    await this.ledger.saveSessionSnapshot({ ...snapshot, orderedIds, cursor })
      .catch((error) => console.warn("Incremental Reading: could not update session snapshot", error));
  }

  private async recordAnalyticsSessionProgress(
    snapshot: SessionSnapshot,
    progress: {
      processedIds: ElementId[];
      skippedIds: ElementId[];
      remainingIds: ElementId[];
    },
  ): Promise<void> {
    if (!this.ledger) return;
    try {
      const now = Date.now();
      const deviceId = await this.ledger.getDeviceId();
      const dayKey = repetitionDayKey(new Date(now));
      let day = await this.ledger.loadDailyAnalytics(deviceId, dayKey);
      if (!day) {
        const state = await this.ledger.load();
        await this.ensureDailyAnalytics(state, now);
        day = await this.ledger.loadDailyAnalytics(deviceId, dayKey);
      }
      if (!day) return;
      const sessions = mergeAnalyticsSessions([
        ...day.sessions,
        {
          id: String(snapshot.createdAt),
          mode: snapshot.mode,
          processedIds: progress.processedIds,
          skippedIds: progress.skippedIds,
          remainingIds: progress.remainingIds,
        },
      ]);
      await this.ledger.saveDailyAnalytics({ ...day, sessions });
      void this.refreshStatusBar(false);
    } catch (error) {
      console.warn("Incremental Reading: could not update daily priority analytics", error);
    }
  }

  private async ensureDailyAnalytics(state: Awaited<ReturnType<IrLedger["load"]>>, now: number): Promise<void> {
    if (!this.ledger) return;
    try {
      const deviceId = await this.ledger.getDeviceId();
      const dayKey = repetitionDayKey(new Date(now));
      if (await this.ledger.loadDailyAnalytics(deviceId, dayKey)) return;
      const due: DailyPriorityAnalytics["due"] = [];
      for (const element of state.elements.values()) {
        const dueMs = element.card?.due ?? element.schedule?.due;
        if (!element.dismissed && dueMs !== undefined && dueMs <= now) {
          due.push({ id: element.id, priority: element.priority,
            type: element.type === "item" ? "item" : "reading" });
        }
      }
      await this.ledger.saveDailyAnalytics({
        schemaVersion: 1,
        deviceId,
        dayKey,
        createdAt: now,
        utcOffsetMinutes: new Date(now).getTimezoneOffset(),
        policyVersion: 1,
        due,
        sessions: [],
        sortingPolicy: { ...this.settings.sortingPolicy },
        autoPostpone: { ...this.settings.autoPostponePolicy },
        capacity: this.settings.autoPostponePolicy.keepOverdue,
        readingProportion: this.settings.sortingPolicy.readingProportion,
      });
    } catch (error) {
      console.warn("Incremental Reading: could not persist daily priority analytics", error);
    }
  }

  private async startRandomReview(): Promise<void> {
    if (!this.ledger) return;
    if (!this.settings.notices.randomReviewRisk) {
      new Notice("Random review performs real mid-interval scheduling and may increase workload.");
      this.settings.notices.randomReviewRisk = true;
      await this.saveSettings();
    }
    await this.ledgerInit;
    const state = await this.ledger.load();
    const seed = Date.now() | 0;
    const queue = policyReviewQueue(this.app, state, this.queuePolicy("random", seed));
    if (queue.length === 0) {
      new Notice("Incremental Reading: no reviewable elements for random review.");
      return;
    }
    await this.saveNewSessionSnapshot("random", queue, seed);
    this.beginReviewSession();
    await this.openReviewWithSession({
      queue,
      elementsById: state.elements,
      mode: "random",
    });
  }

  private async sortCurrentReviewNow(view: IrReviewView): Promise<void> {
    if (!this.ledger) return;
    const snapshot = await this.ledger.loadSessionSnapshot();
    if (!snapshot) return;
    const state = await this.ledger.load();
    let queue: ReviewSlot[];
    if (snapshot.mode === "neural") {
      queue = snapshot.orderedIds
        .map((id) => {
          const element = state.elements.get(id);
          return element ? slotFromElement(this.app, element) : null;
        })
        .filter((slot): slot is ReviewSlot => slot !== null);
    } else {
      queue = policyReviewQueue(this.app, state,
        this.queuePolicy(snapshot.mode, snapshot.seed));
    }
    await view.sortNow(queue);
    new Notice("Incremental Reading: unprocessed review queue sorted.");
  }

  /**
   * Forward-looking counts for the review pane's nothing-due panel, used
   * when a restored leaf finds an empty queue. `null` means the collection
   * itself is empty, which is the first-run pane instead.
   */
  private async computeReviewUpcoming(): Promise<UpcomingLoad | null> {
    if (!this.ledger) return null;
    await this.ledgerInit;
    const state = await this.ledger.load();
    if (state.elements.size === 0) return null;
    return computeUpcoming(state.elements.values(), Date.now());
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
    opts?: { promote?: boolean; priorityOverride?: number },
  ): Promise<void> {
    const file = mv.file;
    if (!file) return;
    const conflict = this.multiSelect.pending.conflictSourcePath(file.path);
    if (conflict) {
      new Notice(formatHeldSelectionConflictNotice(conflict));
      return;
    }
    if (mv.editor.getSelection().trim()) {
      await this.extractSelection(mv.editor, file, opts);
      return;
    }
    const held = this.multiSelect.pending.body(file.path);
    const range = this.previewSelectionRange(mv);
    const root = this.previewRoot(mv);
    let live: BodyHeldSelection | null = null;
    if (range && root) {
      const body = stripFrontmatter(await this.app.vault.cachedRead(file));
      const mapped =
        mapRenderedSelectionToRaw(body, root, range, { includeHeadingPrefix: true }) ??
        (() => {
          const hit = fuzzyLocateInBody(body, range.toString());
          if (!hit) return null;
          const expanded = expandSelectionAroundHeadingPrefix(
            body,
            hit.start,
            hit.end,
          );
          return expanded.start === hit.start && expanded.end === hit.end
            ? hit
            : {
                start: expanded.start,
                end: expanded.end,
                text: body.slice(expanded.start, expanded.end),
              };
        })();
      if (!mapped && held.length === 0) {
        new Notice(
          "Incremental Reading: could not map that selection to the note text. Select a little more or less and try again.",
        );
        return;
      }
      if (mapped) {
        live = {
          kind: "body",
          sourcePath: file.path,
          text: mapped.text,
          start: mapped.start,
          end: mapped.end,
        };
      }
    } else if (held.length === 0) {
      new Notice("Incremental Reading: nothing selected.");
      return;
    }
    const spans = mergeWithLive(held, live);
    if (spans.length === 0) {
      new Notice("Incremental Reading: nothing selected.");
      return;
    }
    const first = spans[0]!;
    await this.extractMappedBodyRange(
      file,
      {
        start: first.start,
        end: first.end,
        text: first.text,
        textOverride:
          spans.length > 1
            ? joinSelectionTexts(spans.map((s) => s.text))
            : undefined,
        spans: spans.map((s) => ({ start: s.start, end: s.end })),
      },
      opts,
    );
    this.multiSelect.clear();
  }

  private async extractMappedBodyRange(
    source: TFile,
    mapped: {
      start: number;
      end: number;
      text: string;
      textOverride?: string;
      spans?: ReadonlyArray<{ start: number; end: number }>;
    },
    opts?: { promote?: boolean; priorityOverride?: number; spanCount?: number },
  ): Promise<void> {
    if (!(await this.ensureIrSource(source))) return;
    if (!this.ledger) {
      new Notice("Incremental Reading: ledger is not ready.");
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
    const state = await this.ledger.load();
    const parentEl = state.elements.get(parentId);
    const extractText =
      mapped.textOverride ?? bodyBeforeExtract.slice(mapped.start, mapped.end);
    const now = Date.now();
    const device = await this.ledger.getDeviceId();
    const { childSchedule, childPriority, parentAFactorAfter } =
      this.prepareSourceExtractScheduleAndPriority(
        parentEl,
        source,
        extractText.length,
        now,
        opts?.priorityOverride,
      );
    try {
      const ev = buildExtractEvent({
        sourcePath: source.path,
        sourceText: bodyBeforeExtract,
        selStart: mapped.start,
        selEnd: mapped.end,
        textOverride: mapped.textOverride,
        ...(mapped.spans ? { spans: mapped.spans } : {}),
        parentId,
        priority: childPriority,
        elementId: newElementId(),
        eventId: newEventId(),
        device,
        lamport: await this.allocLamport(now),
        now,
        schedule: childSchedule,
      });
      await this.appendCreatedWithPlacement(ev);
      await this.decayParentAFactorAfterExtract(
        parentId,
        parentEl,
        source,
        parentAFactorAfter,
        device,
      );
      await this.ledger.reconcile();
      void this.refreshStatusBar();
      const created = ev.payload.element as IrElement;
      const promote =
        opts?.promote ?? this.settings.extractCreatesStandaloneNote;
      if (promote) {
        await this.applyIrPromote(created.id, created);
        return;
      }
      const spanCount = opts?.spanCount ?? 1;
      new Notice(
        spanCount > 1
          ? `Extracted ${spanCount} spans as one extract (anchored in "${source.basename}").`
          : `Extracted (anchored in "${source.basename}", not a separate note).`,
      );
    } catch (e) {
      console.error("Incremental Reading: anchored extract failed", e);
      new Notice(
        "Incremental Reading: could not record the extract in the ledger. See the developer console.",
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
    if (result.file) {
      const snapped = expandSelectionAroundLinks(body, mapped.start, mapped.end);
      await this.attachClozeSourceAnchor(
        result.file,
        file.path,
        body,
        snapped.start,
        snapped.end,
      );
    }
  }

  private async extractSelection(
    editor: Editor,
    source: TFile,
    opts?: { promote?: boolean; priorityOverride?: number },
  ) {
    if (!(await this.ensureIrSource(source))) return;
    if (!this.ledger) {
      new Notice("Incremental Reading: ledger is not ready.");
      return;
    }
    // Multi-cursor / Ctrl+select: every non-empty range joins the extract;
    // the first (document order) carries the anchor.
    const ranges = editor
      .listSelections()
      .map((r) => {
        const a = editor.posToOffset(r.anchor);
        const h = editor.posToOffset(r.head);
        return { from: Math.min(a, h), to: Math.max(a, h) };
      })
      .filter((r) => r.to > r.from)
      .sort((a, b) => a.from - b.from);
    const first = ranges[0];
    const fromPos = first ? editor.offsetToPos(first.from) : editor.getCursor("from");
    const toPos = first ? editor.offsetToPos(first.to) : editor.getCursor("to");
    const fromOffset = editor.posToOffset(fromPos);
    const toOffset = editor.posToOffset(toPos);
    const rawSelection = editor.getRange(fromPos, toPos);
    const trimmedRanges = ranges.map((r) => {
      const raw = editor.getRange(editor.offsetToPos(r.from), editor.offsetToPos(r.to));
      const lead = raw.length - raw.trimStart().length;
      const trail = raw.length - raw.trimEnd().length;
      return { from: r.from + lead, to: r.to - trail, text: raw };
    });
    const joinedOverride =
      ranges.length > 1
        ? joinSelectionTexts(trimmedRanges.map((r) => r.text))
        : undefined;
    // Shrink the range past surrounding whitespace so the wrap and the
    // ancestor-propagation text stay aligned and don't include stray spaces.
    const leadingWs = rawSelection.length - rawSelection.trimStart().length;
    const trailingWs = rawSelection.length - rawSelection.trimEnd().length;
    const selection = rawSelection.trim();
    if (!selection) {
      new Notice("Incremental Reading: nothing selected.");
      return;
    }
    const fullBefore = await this.flushEditorToVault(editor, source);
    const offsets = bodyOffsetsFromFullOffsets(
      fullBefore,
      fromOffset + leadingWs,
      toOffset - trailingWs,
    );
    if (!offsets) {
      new Notice(
        "Incremental Reading: selection is outside the note body.",
      );
      return;
    }
    const bodyBeforeExtract = stripFrontmatter(fullBefore);
    // Snap the selection out to whole markdown/wiki-link tokens so an
    // anchored extract's quote never ends up as `data.tf](#dat`. Also
    // preserve heading markers (`## `) when a Live Preview drag starts right
    // after hidden heading syntax across the rest of the heading line.
    const snappedLinks = expandSelectionAroundLinks(
      bodyBeforeExtract,
      offsets.start,
      offsets.end,
    );
    const { start: extractStart, end: extractEnd } =
      expandSelectionAroundHeadingPrefix(
        bodyBeforeExtract,
        snappedLinks.start,
        snappedLinks.end,
      );
    const spans = mapBodySpans(
      fullBefore,
      trimmedRanges.map((r) => ({ from: r.from, to: r.to })),
    );
    if (spans.length > 0) spans[0] = { start: extractStart, end: extractEnd };
    await this.extractMappedBodyRange(
      source,
      {
        start: extractStart,
        end: extractEnd,
        text: bodyBeforeExtract.slice(extractStart, extractEnd),
        textOverride: joinedOverride,
        spans,
      },
      { ...opts, spanCount: ranges.length },
    );
  }

  private prepareSourceExtractScheduleAndPriority(
    parentEl: IrElement | undefined,
    source: TFile,
    extractTextLen: number,
    now: number,
    priorityOverride?: number,
  ) {
    const parentPriority =
      parentEl?.priority ??
      getPriority(this.app, source, this.settings.defaultPriority);
    const parentAf =
      parentEl?.schedule?.aFactor ??
      readTopicFromFrontmatter(
        this.app.metadataCache.getFileCache(source)?.frontmatter,
        this.settings,
      ).aFactor;
    const { childAFactor, parentAFactorAfter } = computeExtractAFactorPair(
      parentAf,
      extractTextLen,
    );
    const childPriority = clampPriority(
      priorityOverride ??
        spreadExtractPriority(parentPriority, extractTextLen),
    );
    const childState = newTopicState(this.settings, new Date(now));
    childState.aFactor = childAFactor;
    return {
      childSchedule: topicStateToSchedule(childState),
      childPriority,
      parentAFactorAfter,
    };
  }

  private async decayParentAFactorAfterExtract(
    parentId: ElementId,
    parentEl: IrElement | undefined,
    sourceFile: TFile | null,
    parentAFactorAfter: number,
    device: DeviceId,
  ): Promise<void> {
    if (!this.ledger) return;
    const now = Date.now();
    const lamport = Math.max(now, await this.ledger.nextLamport());
    const baseSchedule =
      parentEl?.schedule ??
      topicStateToSchedule(newTopicState(this.settings, new Date(now)));
    const updatedSchedule = {
      ...baseSchedule,
      aFactor: parentAFactorAfter,
    };
    await this.ledger.appendEvent({
      id: newEventId(),
      ts: now,
      lamport,
      device,
      kind: "topic-advanced",
      target: parentId,
      payload: {
        schedule: updatedSchedule,
        operation: "extract-parent-decay",
      },
    });
    if (sourceFile && sourceFile.extension === "md") {
      await quietFrontmatterWrite(async () => {
        await this.app.fileManager.processFrontMatter(sourceFile, (fm) => {
          fm[IR_KEYS.aFactor] = parentAFactorAfter;
        });
      }, "extract-parent-decay");
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
    priorityOverride?: number;
  }): Promise<IrElement | undefined> {
    const sel = findPdfTextSelection(this.app) ?? this.lastPdfSelection;
    if (!sel && !this.heldPdfFile()) return undefined;
    return this.extractFromPdfSelection(sel, opts);
  }

  /** PDF that has spans held with Ctrl (only one PDF is held at a time). */
  private heldPdfFile(): TFile | null {
    const first = this.multiSelect.pending
      .list()
      .find((s): s is PdfHeldSelection => s.kind === "pdf");
    if (!first) return null;
    const af = this.app.vault.getAbstractFileByPath(first.pdfPath);
    return af instanceof TFile ? af : null;
  }

  /**
   * Alt+X on a PDF: the live (or last) selection plus every span held with
   * Ctrl, joined into one extract anchored on the first span. `sel` may be
   * null when only held spans exist.
   */
  private async extractFromPdfSelection(
    sel: PdfTextSelection | null,
    opts?: { promote?: boolean; priorityOverride?: number },
  ): Promise<IrElement | undefined> {
    const file = sel?.file ?? this.heldPdfFile();
    if (!file) return undefined;
    const conflict = this.multiSelect.pending.conflictSourcePath(file.path);
    if (conflict) {
      new Notice(formatHeldSelectionConflictNotice(conflict));
      return undefined;
    }
    const live: PdfHeldSelection | null =
      sel && sel.file.path === file.path
        ? {
            kind: "pdf",
            pdfPath: file.path,
            text: sel.text,
            segments: [{ page: sel.page, selection: sel.selection }],
          }
        : null;
    const spans = mergeWithLive(this.multiSelect.pending.pdf(file.path), live);
    if (spans.length === 0) return undefined;
    const segments = spans.map((s) => s.segments[0]!);
    const first = segments[0]!;
    const pdf: PdfSelector = {
      page: first.page,
      selection: first.selection,
      ...(segments.length > 1 ? { segments } : {}),
    };
    const created = await this.commitPdfExtract(
      file,
      joinSelectionTexts(spans.map((s) => s.text)),
      pdf,
      opts,
    );
    if (created) {
      this.multiSelect.clear();
      document.getSelection()?.removeAllRanges();
    }
    return created;
  }

  /** Record a PDF-anchored extract (text selection or image crop). */
  private async commitPdfExtract(
    file: TFile,
    text: string,
    pdf: PdfSelector,
    opts?: {
      promote?: boolean;
      noticeLabel?: string;
      priorityOverride?: number;
    },
  ): Promise<IrElement | undefined> {
    const sel = { file, page: pdf.page };
    if (!(await this.ensureIrSource(sel.file))) return;
    if (!this.ledger) {
      new Notice("Incremental Reading: ledger is not ready.");
      return;
    }
    const reviewParent = this.getActiveReviewView()?.pdfExtractParentId(
      sel.file.path,
    );
    const parentId =
      reviewParent ??
      (await this.resolveElementIdForFile(sel.file)) ??
      elementIdForPath(sel.file.path);
    const state = await this.ledger.load();
    const parent = state.elements.get(parentId);
    const parentPriority = parent?.priority ?? this.settings.defaultPriority;
    const parentAf =
      parent?.schedule?.aFactor ?? this.settings.topicAFactor;
    const isImageCrop = Boolean(pdf.rect);
    const { childAFactor, parentAFactorAfter } = computeExtractAFactorPair(
      parentAf,
      isImageCrop ? 0 : text.length,
    );
    const childPriority = clampPriority(
      opts?.priorityOverride ??
        spreadExtractPriority(parentPriority, isImageCrop ? 100 : text.length),
    );
    const now = Date.now();
    const device = await this.ledger.getDeviceId();
    const childState = newTopicState(this.settings, new Date(now));
    childState.aFactor = isImageCrop ? SM20_IMAGE_EXTRACT_AFACTOR : childAFactor;
    try {
      const ev = buildPdfExtractEvent({
        sourcePath: sel.file.path,
        text,
        pdf,
        parentId,
        priority: childPriority,
        elementId: newElementId(),
        eventId: newEventId(),
        device,
        lamport: await this.allocLamport(now),
        now,
        schedule: topicStateToSchedule(childState),
      });
      await this.appendCreatedWithPlacement(ev);
      await this.decayParentAFactorAfterExtract(
        parentId,
        parent,
        null,
        parentAFactorAfter,
        device,
      );
      await this.ledger.reconcile();
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
      const pages = (pdf.segments ?? [pdf]).map((g) => g.page);
      new Notice(
        opts?.noticeLabel ??
          `Extracted (anchored in "${sel.file.basename}", ${pageLabel(pages)}${
            pdf.segments && pdf.segments.length > 1
              ? `, ${pdf.segments.length} spans`
              : ""
          }).`,
      );
      return created;
    } catch (e) {
      console.error("Incremental Reading: PDF extract failed", e);
      new Notice(
        "Incremental Reading: could not record the extract in the ledger. See the developer console.",
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
    const cursorInBody = bodyOffsetOfFullCursor(fullText, body, cursor);
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
    const cursorInBody = bodyOffsetOfFullCursor(fullText, body, cursor);
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
    if (!this.ledger) {
      new Notice("Incremental Reading: ledger is not ready.");
      return;
    }

    const initialBody = stripFrontmatter(await this.app.vault.read(source));
    // Decoration-only highlights (DESIGN §Q3) mean the source body holds no
    // `<mark>` chrome for new extracts, so the old "is this span inside a
    // mark?" test would always say no. Idempotency now comes from the ledger:
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
    const state = await this.ledger.load();
    const parentEl = state.elements.get(parentId);
    const parentPriority =
      parentEl?.priority ??
      getPriority(this.app, source, this.settings.defaultPriority);
    let currentParentAf =
      parentEl?.schedule?.aFactor ??
      readTopicFromFrontmatter(
        this.app.metadataCache.getFileCache(source)?.frontmatter,
        this.settings,
      ).aFactor;
    const device = await this.ledger.getDeviceId();

    let created = 0;
    const createdEls: IrElement[] = [];
    for (const span of candidates) {
      const now = Date.now();
      const spanLen = Math.max(0, span.end - span.start);
      const { childAFactor, parentAFactorAfter } = computeExtractAFactorPair(
        currentParentAf,
        spanLen,
      );
      const childPriority = clampPriority(
        spreadExtractPriority(parentPriority, spanLen),
      );
      const childState = newTopicState(this.settings, new Date(now));
      childState.aFactor = childAFactor;
      try {
        const ev = buildExtractEvent({
          sourcePath: source.path,
          sourceText: initialBody,
          selStart: span.start,
          selEnd: span.end,
          parentId,
          priority: childPriority,
          elementId: newElementId(),
          eventId: newEventId(),
          device,
          lamport: await this.allocLamport(now),
          now,
          schedule: topicStateToSchedule(childState),
        });
        await this.appendCreatedWithPlacement(ev);
        currentParentAf = parentAFactorAfter;
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

    await this.decayParentAFactorAfterExtract(
      parentId,
      parentEl,
      source,
      currentParentAf,
      device,
    );
    await this.ledger.reconcile();
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
   * Rebuild the editor decoration cache from the ledger, then push the result
   * to every open MarkdownView. Called after every reconcile path that can
   * change the set of resolved extract anchors (new extract, deletion,
   * re-anchor, ledger load on startup).
   */
  async refreshExtractDecorations(loadedState?: LogState): Promise<void> {
    if (!this.ledger) return;
    try {
      const state = loadedState ?? await this.ledger.load();
      await refreshIrDecorationCache(this.app, this.ledger, this.decorationCache, state);
      pushIrDecorations(this.app, this.decorationCache);
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
   * Resolve every extract anchor in the ledger whose `sourcePath` matches this
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
    if (!this.ledger) return [];
    const state = await this.ledger.load();
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
    const fullBefore = await this.flushEditorToVault(editor, source);
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
      const snapped = expandSelectionAroundLinks(body, off.start, off.end);
      await this.attachClozeSourceAnchor(
        result.file,
        source.path,
        body,
        snapped.start,
        snapped.end,
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
    const initialAnswer = editor.getSelection().trim();
    if (!initialAnswer) {
      new Notice("Incremental Reading: nothing selected.");
      return;
    }
    // Snap the raw offsets out to whole markdown/wiki-link tokens so wrapping
    // `data.tf` inside `[data.tf](#datatf)` grabs the whole link, not just the
    // label — otherwise `replaceSelection` produces `[{{c1::data.tf}}](#datatf)`.
    const rawFullText = editor.getValue();
    const rawFromOff = editor.posToOffset(editor.getCursor("from"));
    const rawToOff = editor.posToOffset(editor.getCursor("to"));
    const { start: fromOff, end: toOff } = expandSelectionAroundLinks(
      rawFullText,
      rawFromOff,
      rawToOff,
    );
    const fromPos = editor.offsetToPos(fromOff);
    const toPos = editor.offsetToPos(toOff);
    const answer = rawFullText.slice(fromOff, toOff).trim();
    if (!answer) {
      new Notice("Incremental Reading: nothing selected.");
      return;
    }
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
   * ledger) and returns true. Returns false (with a Notice) only when the
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
        "Incremental Reading: that note is marked IR but is not in the ledger yet. Try again in a moment.",
      );
      return;
    }
    await this.startNeuralReview(seedId, null);
  }

  public async startNeuralReview(seedElementId: ElementId | null, seedNotePath: string | null) {
    if (!this.ledger) {
      new Notice("Incremental Reading: ledger is not ready.");
      return;
    }
    await this.ledgerInit;
    const state = await this.ledger.load();
    const sessionSeed = Date.now() ^ 0x9e3779b9;
    const resolvedSeed =
      seedElementId ?? (seedNotePath ? elementIdForNotePath(state, seedNotePath) : null);
    const useLexical = this.settings.neuralUseLexicalLinks;
    const queue = neuralQueue(
      this.app,
      state,
      seedElementId,
      seedNotePath,
      makeLcg(sessionSeed),
      useLexical,
      this.settings.neuralDueOnly,
    );
    
    if (queue.length < 2) {
      new Notice(`Incremental Reading: ${EMPTY_NEURAL_COPY}`);
      return;
    }

    if (resolvedSeed) {
      try {
        const baseNeural = await this.ledger.readNeural(state.elements);
        const adj = buildNeuralAdjacency(state, obsidianLinkIndex(this.app), {
          useTags: true,
          tagDegreeCap: 40,
          useLexical,
        });
        const seeded = seedNeuralQueueState({
          seedId: resolvedSeed,
          baseState: baseNeural,
          priorityOf: (id) => state.elements.get(id)?.priority ?? 50,
          neighbors: (id) => neighborsForWalk(adj, id),
          dismissed: (id) => state.elements.get(id)?.dismissed === true,
          nowMs: Date.now(),
          capacity: NEURAL_MAX_QUEUE,
          random: makeLcg(sessionSeed),
        });
        await this.ledger.writeNeural(seeded);
      } catch (e) {
        console.warn("Incremental Reading: could not persist seeded neural queue", e);
      }
    }

    this.beginReviewSession();
    await this.saveNewSessionSnapshot("neural", queue, sessionSeed);
    await this.openReviewWithSession({
      queue,
      elementsById: state.elements,
      isNeural: true,
      phase: "neural",
    });
  }

  public async resumeNeuralReview(): Promise<void> {
    if (!this.ledger) {
      new Notice("Incremental Reading: ledger is not ready.");
      return;
    }
    await this.ledgerInit;
    const state = await this.ledger.load();
    const neural = await this.ledger.readNeural(state.elements);
    const queue = neuralSlotsFromQueueState(this.app, state, neural, {
      dueOnly: this.settings.neuralDueOnly,
    });
    if (queue.length === 0) {
      new Notice("Incremental Reading: no saved Neural Queue frontier yet. Run Go neural on a note first.");
      return;
    }
    const sessionSeed = Date.now() | 0;
    this.beginReviewSession();
    await this.saveNewSessionSnapshot("neural", queue, sessionSeed);
    await this.openReviewWithSession({
      queue,
      elementsById: state.elements,
      isNeural: true,
      phase: "neural",
    });
  }

  private async exciteActiveNeuralSession(
    elementId: ElementId,
    visitedPrefixIds: ReadonlySet<ElementId>,
  ): Promise<ReviewSlot[]> {
    if (!this.ledger) return [];
    const state = await this.ledger.load();
    const nowMs = Date.now();
    const curNeural = await this.ledger.readNeural(state.elements);
    const adj = buildNeuralAdjacency(state, obsidianLinkIndex(this.app), {
      useTags: true,
      tagDegreeCap: 40,
      useLexical: this.settings.neuralUseLexicalLinks,
    });
    const priorityOf = (id: ElementId) => state.elements.get(id)?.priority ?? 50;
    const neighbors = (id: ElementId) => neighborsForWalk(adj, id);
    const dismissed = (id: ElementId) => state.elements.get(id)?.dismissed === true;

    const excited = exciteNeuralElement(curNeural, {
      elementId,
      priorityOf,
      neighbors,
      dismissed,
      nowMs,
      capacity: NEURAL_MAX_QUEUE,
    });
    const expanded = expandNeuralQueueIfNeeded(excited, {
      priorityOf,
      neighbors,
      dismissed,
      nowMs,
      capacity: NEURAL_MAX_QUEUE,
      random: Math.random,
    });
    const endOfToday = endOfDayMs(nowMs);
    const isDueTodayOrSeed = (id: ElementId) => {
      if (!this.settings.neuralDueOnly || id === expanded.seedId) return true;
      const el = state.elements.get(id);
      if (!el) return false;
      const due = dueMsOf(el);
      return Number.isFinite(due) && due <= endOfToday;
    };
    const popped = popNextNeuralElement(expanded, {
      excludeIds: visitedPrefixIds,
      isEligible: this.settings.neuralDueOnly ? isDueTodayOrSeed : undefined,
      elements: state.elements,
      rng: Math.random,
      nowMs,
    });
    await this.ledger.writeNeural(popped.state);

    const slots = neuralSlotsFromQueueState(this.app, state, expanded, {
      dueOnly: this.settings.neuralDueOnly,
      endOfTodayMs: endOfToday,
    }).filter((slot) => !visitedPrefixIds.has(slot.id));
    if (!popped.next) return slots;
    const nextIdx = slots.findIndex((s) => s.id === popped.next!.id);
    if (nextIdx <= 0) return slots;
    const pickedSlot = slots[nextIdx]!;
    return [pickedSlot, ...slots.slice(0, nextIdx), ...slots.slice(nextIdx + 1)];
  }

  private async refreshActiveNeuralSlots(
    visitedPrefixIds: ReadonlySet<ElementId>,
  ): Promise<ReviewSlot[]> {
    if (!this.ledger) return [];
    const state = await this.ledger.load();
    const curNeural = await this.ledger.readNeural(state.elements);
    return neuralSlotsFromQueueState(this.app, state, curNeural, {
      dueOnly: this.settings.neuralDueOnly,
      endOfTodayMs: endOfDayMs(Date.now()),
    }).filter((slot) => !visitedPrefixIds.has(slot.id));
  }

  public async startBranchReview(rootId: ElementId, includeFuture = false): Promise<void> {
    if (!this.ledger) {
      new Notice("Incremental Reading: ledger is not ready.");
      return;
    }
    await this.ledgerInit;
    const state = await this.ledger.load();
    const branchIds = collectBranchIds([...state.elements.values()], rootId);
    if (branchIds.length === 0) {
      new Notice("Incremental Reading: branch not found.");
      return;
    }
    await this.startSubsetReview(branchIds, includeFuture, "branch");
  }

  public async startSubsetReview(
    ids: readonly ElementId[],
    includeFuture = false,
    phase: SessionBarPhase = "subset",
  ): Promise<void> {
    if (!this.ledger) {
      new Notice("Incremental Reading: ledger is not ready.");
      return;
    }
    await this.ledgerInit;
    const state = await this.ledger.load();
    const now = Date.now();
    const queue = subsetReviewQueue(
      this.app,
      state,
      ids,
      this.queuePolicy("due", new Date(now).setHours(0, 0, 0, 0)),
      includeFuture,
      new Date(now),
    );
    if (queue.length === 0) {
      new Notice(
        includeFuture
          ? "Incremental Reading: no reviewable elements in selection."
          : "Incremental Reading: nothing due in that selection.",
      );
      return;
    }
    this.beginReviewSession();
    await this.openReviewWithSession({
      queue,
      elementsById: state.elements,
      isNeural: false,
      phase,
    });
  }

  public async addElementsToSession(ids: readonly ElementId[]): Promise<void> {
    if (!this.ledger) return;
    const view = this.getActiveReviewView();
    if (!view) {
      await this.startSubsetReview(ids, true, "subset");
      return;
    }
    const state = await this.ledger.load();
    const slots: ReviewSlot[] = [];
    for (const id of ids) {
      const el = state.elements.get(id);
      if (!el || el.dismissed) continue;
      const slot = slotFromElement(this.app, el);
      if (slot) slots.push(slot);
    }
    const added = view.appendSlots(slots);
    new Notice(
      added > 0
        ? `Incremental Reading: added ${added} element${added === 1 ? "" : "s"} to today's session.`
        : "Incremental Reading: selected elements are already in the session.",
    );
  }

  private async applyManualReschedule(
    elementId: ElementId,
    file: TFile | null,
    rawInput: string,
  ): Promise<boolean> {
    if (!this.ledger) return false;
    const now = Date.now();
    const parsed = parseJumpIntervalInput(rawInput, now);
    if (!parsed) {
      new Notice("Incremental Reading: enter a positive day count (e.g. 14) or future date (YYYY-MM-DD).");
      return false;
    }
    const state = await this.ledger.load();
    const el = state.elements.get(elementId);
    if (!el) return false;
    const plan = planManualSchedule(el, parsed.dueMs, parsed.intervalDays, {
      nowMs: now,
      adjustAFactor: true,
    });
    if (!plan) {
      new Notice("Incremental Reading: element has no schedule to jump.");
      return false;
    }
    await this.commitLedgerEvents(
      "jump-interval",
      [
        {
          kind: "mercy-postponed",
          target: elementId,
          payload: {
            newDue: plan.newDue,
            previousDue: plan.previousDue,
            operation: "manual-reschedule",
            ...(plan.card ? { card: plan.card } : {}),
            ...(plan.schedule ? { schedule: plan.schedule } : {}),
          },
        },
      ],
      {
        now,
        beforeReconcile: async () => {
          const targetFile =
            file ??
            (el.notePath
              ? (() => {
                  const abs = this.app.vault.getAbstractFileByPath(el.notePath);
                  return abs instanceof TFile ? abs : null;
                })()
              : null);
          if (targetFile && targetFile.extension === "md") {
            await quietFrontmatterWrite(async () => {
              await this.app.fileManager.processFrontMatter(targetFile, (fm) => {
                if (plan.card) writeCardToFrontmatter(fm, storedToCard(plan.card));
                else if (plan.schedule) {
                  const topicState = scheduleToTopicState(plan.schedule);
                  if (topicState) writeTopicToFrontmatter(fm, topicState);
                }
              });
            }, "jump-interval");
          }
        },
        refreshReviewElements: true,
        refreshTree: true,
      },
    );
    this.getActiveReviewView()?.removePostponed(new Set([elementId]));
    new Notice(`Incremental Reading: jumped interval to +${plan.newInterval}d.`);
    return true;
  }

  private async applyAdvanceElements(
    ids: readonly ElementId[],
    rawHorizon: string,
  ): Promise<boolean> {
    if (!this.ledger) return false;
    const horizonDays = parseAdvanceInput(rawHorizon);
    if (horizonDays === null) {
      new Notice("Incremental Reading: enter 0, today, or a positive day count.");
      return false;
    }
    const now = Date.now();
    const state = await this.ledger.load();
    const targets: IrElement[] = [];
    const seen = new Set<ElementId>();
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      const el = state.elements.get(id);
      if (el) targets.push(el);
    }
    const entries = planAdvanceElements(targets, horizonDays, now);
    if (entries.length === 0) {
      new Notice("Incremental Reading: no schedulable elements selected to advance.");
      return false;
    }
    const deviceId = await this.ledger.getDeviceId();
    const lamportStart = Math.max(now, await this.ledger.nextLamport());
    const batchId = `advance:${deviceId}:${now}`;
    const events = buildAdvanceEvents(entries, {
      nowMs: now,
      lamportStart,
      deviceId,
      batchId,
      newEventId: () => newEventId(),
    });

    await this.ledger.appendEvents(events);
    for (const entry of entries) {
      const el = state.elements.get(entry.elementId);
      if (!el?.notePath) continue;
      const abs = this.app.vault.getAbstractFileByPath(el.notePath);
      if (!(abs instanceof TFile) || abs.extension !== "md") continue;
      await quietFrontmatterWrite(async () => {
        await this.app.fileManager.processFrontMatter(abs, (fm) => {
          if (entry.card) writeCardToFrontmatter(fm, storedToCard(entry.card));
          else if (entry.schedule) {
            const topicState = scheduleToTopicState(entry.schedule);
            if (topicState) writeTopicToFrontmatter(fm, topicState);
          }
        });
      }, "advance");
    }

    await this.ledger.reconcile();
    const movedFuture = new Set<ElementId>(
      entries.filter((e) => e.dayOffset > 0).map((e) => e.elementId),
    );
    if (movedFuture.size > 0) {
      this.getActiveReviewView()?.removePostponed(movedFuture);
    }
    await this.getTreeView()?.refresh();
    void this.refreshStatusBar();
    new Notice(
      `Incremental Reading: advanced ${entries.length} element${entries.length === 1 ? "" : "s"} (${
        horizonDays === 0 ? "due today" : `spread over ${horizonDays}d`
      }).`,
    );
    return true;
  }

  private async reviewObsidianSearchResults(includeFuture: boolean): Promise<void> {
    if (!this.ledger) {
      new Notice("Incremental Reading: ledger is not ready.");
      return;
    }
    await this.ledgerInit;
    const matchedPaths = readCoreSearchMatchedPaths(this.app);
    if (matchedPaths.length === 0) {
      new Notice("Incremental Reading: open Obsidian Search with matching notes first.");
      return;
    }

    const state = await this.ledger.load();
    const elementsByPath = new Map<string, ElementId[]>();
    for (const el of state.elements.values()) {
      if (el.dismissed) continue;
      const keys = new Set<string>();
      if (el.notePath) keys.add(el.notePath);
      if (el.anchor?.sourcePath) keys.add(el.anchor.sourcePath);
      for (const path of keys) {
        const list = elementsByPath.get(path) ?? [];
        list.push(el.id);
        elementsByPath.set(path, list);
      }
    }

    const ids: ElementId[] = [];
    const seen = new Set<ElementId>();
    for (const path of matchedPaths) {
      for (const id of elementsByPath.get(path) ?? []) {
        if (!seen.has(id)) {
          seen.add(id);
          ids.push(id);
        }
      }
    }

    if (ids.length === 0) {
      new Notice("Incremental Reading: none of the Obsidian search matches are IR elements.");
      return;
    }
    await this.startSubsetReview(ids, includeFuture, "search");
  }

  public async startFinalDrill(): Promise<void> {
    if (!this.ledger) {
      new Notice("Incremental Reading: ledger is not ready.");
      return;
    }
    await this.ledgerInit;
    const state = await this.ledger.load();
    const dayKey = repetitionDayKey();
    const drill = await this.ledger.readDrill(dayKey, state.elements);
    const queue = drillReviewQueue(
      this.app,
      state,
      drill,
      this.settings.randomizeDrill,
    );
    if (queue.length === 0) {
      new Notice("Incremental Reading: Final Drill queue is empty for today.");
      return;
    }
    this.beginReviewSession();
    await this.openReviewWithSession({
      queue,
      elementsById: state.elements,
      isNeural: false,
      phase: "drill",
    });
  }

  private async openReviewWithSession(
    session: {
      queue: ReviewSlot[];
      elementsById: Map<ElementId, IrElement>;
      isNeural?: boolean;
      phase?: SessionBarPhase;
      mode?: SessionMode;
      cursor?: number;
      emptyVault?: boolean;
      nothingDue?: UpcomingLoad;
    },
    fallbackNotice?: string,
  ): Promise<boolean> {
    const existing = this.app.workspace.getLeavesOfType(IR_REVIEW_VIEW_TYPE);
    for (const extra of existing.slice(1)) {
      extra.detach();
    }
    const primary = existing[0];
    if (primary && primary.view instanceof IrReviewView) {
      try {
        await primary.view.adoptSession(session);
        this.app.workspace.revealLeaf(primary);
        return true;
      } catch (e) {
        console.error("Incremental Reading: adopting review session failed", e);
        new Notice(
          fallbackNotice ??
            "Incremental Reading: could not open the review view. See the developer console.",
        );
        return false;
      }
    }

    this.irReviewSession = session;
    try {
      // Main workspace tab (not the right sidebar) so review uses the full
      // editor width and mobile does not keep the previous note visible in a
      // split beside a 90vw-wide pane that overflows the narrow leaf.
      const leaf = primary ?? this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: IR_REVIEW_VIEW_TYPE, active: true });
      this.app.workspace.revealLeaf(leaf);
      return true;
    } catch (e) {
      this.irReviewSession = null;
      console.error("Incremental Reading: opening review view failed", e);
      new Notice(
        fallbackNotice ??
          "Incremental Reading: could not open the review view. See the developer console.",
      );
      return false;
    }
  }

  private async startReview() {
    if (!this.ledger) {
      new Notice("Incremental Reading: ledger is not ready.");
      return;
    }
    try {
      await withTimeout(this.ledgerInit, 8000, "ledger init");
    } catch (e) {
      console.error("Incremental Reading: ledger init still running", e);
      new Notice(
        "Incremental Reading: still starting up. Try Start IR review again in a moment.",
      );
      return;
    }
    try {
      const state = await this.ledger.load();
      if (state.elements.size === 0) {
        await this.openReviewWithSession(
          {
            queue: [],
            elementsById: state.elements,
            emptyVault: true,
          },
          EMPTY_COLLECTION_COPY,
        );
        return;
      }
      const now = Date.now();
      await this.ensureDailyAnalytics(state, now);
      const queue = policyReviewQueue(this.app, state,
        this.queuePolicy("due", new Date(now).setHours(0, 0, 0, 0)), new Date(now));
      if (queue.length === 0) {
        // Nothing due, but the collection is not empty: open the review pane
        // on its nothing-due panel so the user gets the next due time and the
        // week's load instead of a toast that answers nothing.
        await this.openReviewWithSession(
          {
            queue: [],
            elementsById: state.elements,
            nothingDue: computeUpcoming(state.elements.values(), Date.now()),
          },
          "Incremental Reading: nothing due for review.",
        );
        return;
      }

      this.beginReviewSession();
      await this.saveNewSessionSnapshot("due", queue, new Date(now).setHours(0, 0, 0, 0));
      await this.openReviewWithSession({ queue, elementsById: state.elements });
    } catch (e) {
      console.error("Incremental Reading: start review failed", e);
      new Notice(
        `Incremental Reading: could not start review — ${e instanceof Error ? e.message : String(e)}`,
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
   * bookmarked element has been deleted from the ledger, or when the
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
    if (!this.ledger) {
      new Notice("Incremental Reading: ledger is not ready.");
      return false;
    }
    let targetId = elementId ?? null;
    if (!targetId) {
      const bookmarks = await this.ledger.loadBookmarks();
      const most = mostRecentBookmark(bookmarks);
      if (!most) {
        new Notice("Incremental Reading: no reading bookmarks yet.");
        return false;
      }
      targetId = most.elementId as ElementId;
    }

    const state = await this.ledger.load();
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

    return this.openReviewWithSession({
      queue: [slot],
      elementsById: state.elements,
    });
  }

  private async openTreeView(): Promise<void> {
    if (!this.ledger) {
      new Notice("Incremental Reading: ledger is not ready.");
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
   * note when it maps to a ledger element; otherwise fall back to the
   * status-bar prompt (SCOPE-MODAL-REMOVAL.md).
   *
   * Mobile has no status bar, so the fallback prompt renders into an element
   * Obsidian never shows: the input took focus off-screen and cancelled on
   * blur, which read as "Alt+P does nothing". On mobile the tree editor is
   * the only working surface, so say what to do instead of pretending.
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
    if (Platform.isMobile) {
      new Notice(
        "Incremental Reading: this note is not in the collection yet. " +
          "Review or extract from it once, then set priority from its collection row.",
      );
      return;
    }
    this.promptPriority(file, current);
  }

  /**
   * Open (or reveal) the session-log view. Refreshes its contents when
   * revealed so the user sees what's there now, not what was there last
   * time the view rendered.
   */
  private async openSessionView(): Promise<void> {
    if (!this.ledger) {
      new Notice("Incremental Reading: ledger is not ready.");
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
   * Resolve the ledger element id for a vault note path (queue + tree use the
   * folded ledger, not frontmatter alone).
   */
  private async resolveElementIdForFile(
    file: TFile,
  ): Promise<ElementId | null> {
    if (!this.ledger) return null;
    const state = await this.ledger.load();
    for (const el of state.elements.values()) {
      if (el.notePath === file.path) return el.id;
    }
    return null;
  }

  /** Move one element in the collection-wide order and refresh derived state. */
  private async applyIrPriorityChange(
    elementId: ElementId,
    file: TFile | null,
    priority: number,
  ): Promise<void> {
    if (!this.ledger) return;
    const p = clampPriority(priority);
    const before = await this.ledger.load();
    const placement = buildPriorityPlacement(before.elements.values(), elementId, p);
    await this.applyIrPriorityBatch([
      { targetId: elementId, requestedPriority: p, placement, file },
    ]);
  }

  private async applyIrPriorityPreview(
    preview: PriorityPlacementPreview,
    file: TFile | null,
  ): Promise<void> {
    await this.applyIrPriorityBatch([{
      targetId: preview.intent.targetId,
      requestedPriority: preview.intent.requestedPriority,
      placement: preview.intent,
      file,
    }]);
  }

  private async applyIrPriorityBatch(changes: readonly {
    targetId: ElementId;
    requestedPriority: number;
    placement: ReturnType<typeof buildPriorityPlacement>;
    file?: TFile | null;
  }[]): Promise<void> {
    const preState = this.ledger ? await this.ledger.load() : null;
    await this.commitLedgerEvents(
      "priority",
      changes.map((change) => ({
        kind: "priority-set" as const,
        target: change.targetId,
        payload: {
          priority: clampPriority(change.requestedPriority),
          placement: change.placement,
        },
      })),
      {
        useLedgerLamport: true,
        beforeReconcile: async () => {
          for (const change of changes) {
            let file = change.file ?? null;
            if (!file && preState) {
              const notePath = preState.elements.get(change.targetId)?.notePath;
              const abs = notePath
                ? this.app.vault.getAbstractFileByPath(notePath)
                : null;
              if (abs instanceof TFile) file = abs;
            }
            if (file?.extension === "md") {
              await quietFrontmatterWrite(
                () =>
                  setPriority(
                    this.app,
                    file!,
                    clampPriority(change.requestedPriority),
                  ).then(() => undefined),
                "priority",
              );
            }
          }
        },
        refreshReviewElements: true,
        refreshTree: true,
      },
    );
  }

  private async commitLedgerEvents(
    label: string,
    specs: ReadonlyArray<{
      kind: IrEvent["kind"];
      target: ElementId;
      payload: Record<string, unknown>;
    }>,
    opts?: {
      now?: number;
      useLedgerLamport?: boolean;
      beforeReconcile?: () => Promise<void>;
      refreshTree?: boolean;
      refreshReviewElements?: boolean;
      refreshStatusBar?: boolean;
    },
  ): Promise<LogState | null> {
    if (!this.ledger || specs.length === 0) return null;
    const now = opts?.now ?? Date.now();
    let lamport = Math.max(now, await this.ledger.nextLamport());
    const device = await this.ledger.getDeviceId();
    const events: IrEvent[] = specs.map((spec) => ({
      id: newEventId(),
      ts: now,
      lamport: lamport++,
      device,
      kind: spec.kind,
      target: spec.target,
      payload: spec.payload,
    }));
    await this.ledger.appendEvents(events);
    if (opts?.beforeReconcile) await opts.beforeReconcile();
    const state = await this.ledger.reconcile().catch((e) => {
      console.error(`Incremental Reading: reconcile after ${label} failed`, e);
      return null;
    });
    if (opts?.refreshReviewElements && state) {
      this.getActiveReviewView()?.refreshElementsInPlace(state.elements);
    }
    if (opts?.refreshTree) {
      await this.getTreeView()?.refresh();
    }
    if (opts?.refreshStatusBar !== false) {
      void this.refreshStatusBar();
    }
    return state;
  }

  private async movePrioritySelection(ids: ElementId[], direction: -1 | 1): Promise<void> {
    if (!this.ledger) return;
    const state = await this.ledger.load();
    await this.applyPriorityPlan(
      planAdjacentBlockMove(collectionSortOrder(state.elements.values()), ids, direction),
    );
  }

  private async movePrioritySelectionTo(ids: ElementId[], position: number): Promise<void> {
    if (!this.ledger) return;
    const state = await this.ledger.load();
    await this.applyPriorityPlan(
      planBlockInsertion(collectionSortOrder(state.elements.values()), ids, position),
    );
  }

  private async applyPriorityPlan(plan: ReturnType<typeof planBlockInsertion>): Promise<void> {
    await this.applyIrPriorityBatch(plan.intents.map((intent) => ({
      targetId: intent.targetId,
      requestedPriority: intent.requestedPriority,
      placement: intent,
      file: null,
    })));
  }

  private async distributePrioritySelection(
    ids: ElementId[],
    operation: "spread" | "adjust",
    start: number,
    end: number,
  ): Promise<void> {
    if (!this.ledger) return;
    const state = await this.ledger.load();
    const order = collectionSortOrder(state.elements.values());
    const plan = operation === "spread"
      ? planSpread(order, ids, start, end)
      : planAdjust(order, ids, start, end);
    await this.applyPriorityPlan(plan);
  }

  private async appendCreatedWithPlacement(event: IrEvent): Promise<void> {
    if (!this.ledger || event.kind !== "element-created") return;
    const element = event.payload.element as IrElement;
    const state = await this.ledger.load();
    event.payload = {
      ...event.payload,
      placement: buildPriorityPlacement(
        state.elements.values(),
        element.id,
        element.priority,
      ),
    };
    await this.ledger.appendEvent(event);
  }

  /** Append `dismiss-set`, dual-write frontmatter, reconcile `.ir/state`. */
  private async applyIrDismissChange(
    elementId: ElementId,
    file: TFile | null,
    dismissed: boolean,
  ): Promise<void> {
    await this.commitLedgerEvents(
      "dismiss",
      [{ kind: "dismiss-set", target: elementId, payload: { dismissed } }],
      {
        beforeReconcile: async () => {
          if (file && file.extension === "md") {
            await quietFrontmatterWrite(
              () => setDismissed(this.app, file, dismissed).then(() => undefined),
              "dismiss",
            );
          }
        },
      },
    );
  }

  /** Reset an element's review/read schedule without deleting or reparenting it. */
  private async applyIrReset(
    elementId: ElementId,
    file: TFile | null,
  ): Promise<void> {
    if (!this.ledger) return;
    const now = Date.now();
    const state = await this.ledger.load();
    const el = state.elements.get(elementId);
    if (!el) return;

    const payload: Record<string, unknown> = {};
    let resetCard: ReturnType<typeof buildCardResetCard> | null = null;
    let resetTopic: ReturnType<typeof newTopicState> | null = null;

    if (el.type === "item") {
      resetCard = buildCardResetCard(now);
      payload.card = resetCard;
    } else {
      resetTopic = newTopicState(this.settings, new Date(now));
      payload.schedule = topicStateToSchedule(resetTopic);
    }

    await this.commitLedgerEvents(
      "reset",
      [{ kind: "card-reset", target: elementId, payload }],
      {
        now,
        beforeReconcile: async () => {
          const targetFile =
            file ??
            (el.notePath
              ? (() => {
                  const abs = this.app.vault.getAbstractFileByPath(el.notePath);
                  return abs instanceof TFile ? abs : null;
                })()
              : null);
          if (targetFile && targetFile.extension === "md") {
            await quietFrontmatterWrite(async () => {
              await this.app.fileManager.processFrontMatter(targetFile, (fm) => {
                if (resetCard) {
                  writeCardToFrontmatter(fm, storedToCard(resetCard));
                } else if (resetTopic) {
                  writeTopicToFrontmatter(fm, resetTopic);
                }
              });
            }, "reset");
          }
        },
        refreshReviewElements: true,
        refreshTree: true,
      },
    );
    await this.ensureSm20Matrix().catch((e) => {
      console.warn("Incremental Reading: could not refresh SM-20 matrix after reset", e);
    });
  }

  /** Delete an element, reparenting its children to its parent. */
  private async applyIrDelete(
    elementId: ElementId,
    parentId: ElementId | null,
  ): Promise<void> {
    if (!this.ledger) return;
    const state = await this.ledger.load();
    const effectiveParentId = liveParentForDelete(state.elements, elementId, parentId);
    const specs: Array<{
      kind: IrEvent["kind"];
      target: ElementId;
      payload: Record<string, unknown>;
    }> = [];
    for (const el of state.elements.values()) {
      if (el.parentId === elementId) {
        specs.push({
          kind: "reparented",
          target: el.id,
          payload: { parentId: effectiveParentId },
        });
      }
    }
    specs.push({
      kind: "element-deleted",
      target: elementId,
      payload: {},
    });
    await this.commitLedgerEvents("delete", specs);
  }

  /**
   * Promote an extract to a standalone note. Creates the note on disk,
   * emits a `promoted` event pointing the element at the new note path.
   */
  private async applyIrPromote(
    elementId: ElementId,
    element: IrElement,
  ): Promise<void> {
    if (!this.ledger) return;
    if (element.notePath) {
      new Notice("Incremental Reading: that extract is already a note.");
      return;
    }
    const notePath = uniquePromotedNotePath(
      this.promoteOrphanPath(element),
      (p) => !!this.app.vault.getAbstractFileByPath(p),
    );
    await this.materializePromotedNote(notePath, element);

    const now = Date.now();
    const ev = buildPromoteEvent({
      elementId,
      notePath,
      eventId: newEventId(),
      device: await this.ledger.getDeviceId(),
      lamport: now,
      now,
    });
    element.notePath = notePath;
    await this.commitLedgerEvents(
      "promote",
      [{ kind: ev.kind, target: ev.target, payload: ev.payload }],
      { now },
    );
    new Notice(`Promoted extract to "${notePath}".`);
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
    if (!this.ledger || !element.anchor) return false;
    if (element.anchor.pdf || isPdfPath(element.anchor.sourcePath)) {
      return false;
    }

    const sourceFile = this.app.vault.getAbstractFileByPath(
      element.anchor.sourcePath,
    );
    if (!(sourceFile instanceof TFile)) return false;

    const body = stripFrontmatter(await this.app.vault.cachedRead(sourceFile));
    const result = resolveAnchor(element.anchor, body);
    if (result.status !== "ok") return false;

    const repairedAnchor = {
      ...element.anchor,
      position: { start: result.start, end: result.end },
    };

    await this.commitLedgerEvents(
      "re-anchor",
      [
        {
          kind: "anchor-repaired",
          target: elementId,
          payload: { anchor: repairedAnchor },
        },
      ],
      { refreshStatusBar: false },
    );
    return true;
  }

  /** Mark a drifted extract as detached; it keeps stored text for review. */
  private async applyIrDetachAnchor(
    elementId: ElementId,
    _element: IrElement,
  ): Promise<void> {
    await this.commitLedgerEvents("detach", [
      { kind: "anchor-detached", target: elementId, payload: {} },
    ]);
  }

  /** Move an element to a new parent via a reparented event. */
  private async applyIrReparent(
    elementId: ElementId,
    newParentId: ElementId | null,
  ): Promise<void> {
    await this.commitLedgerEvents("reparent", [
      {
        kind: "reparented",
        target: elementId,
        payload: { parentId: newParentId },
      },
    ]);
  }

  private async applyIrPostponeChange(
    elementId: ElementId,
    file: TFile | null,
    days: number,
  ): Promise<void> {
    await this.applyIrPostponeBatch([elementId], days, file);
  }

  private async applyIrPostponeBatch(
    ids: readonly ElementId[],
    days: number,
    explicitFile?: TFile | null,
  ): Promise<number> {
    if (!this.ledger || ids.length === 0) return 0;
    const now = Date.now();
    const state = await this.ledger.load();
    const device = await this.ledger.getDeviceId();
    const batchId = `manual-postpone:${device}:${now}`;
    const drafts: Array<{
      kind: "mercy-postponed";
      target: ElementId;
      payload: Record<string, unknown>;
    }> = [];
    const dueByFile = new Map<TFile, number>();
    const postponedSet = new Set<ElementId>();

    for (const elementId of ids) {
      if (postponedSet.has(elementId)) continue;
      const el = state.elements.get(elementId);
      if (!el || el.dismissed) continue;
      const currentDue = el.type === "item" ? el.card?.due : el.schedule?.due;
      const { previousDue, newDue } = planManualPostpone(currentDue, now, days);
      postponedSet.add(elementId);
      drafts.push({
        kind: "mercy-postponed",
        target: elementId,
        payload: {
          newDue,
          ...(previousDue !== undefined ? { previousDue } : {}),
          batchId,
          operation: "manual-postpone",
        },
      });
      const resolvedFile =
        ids.length === 1 && explicitFile
          ? explicitFile
          : el.notePath
            ? (() => {
                const abs = this.app.vault.getAbstractFileByPath(el.notePath);
                return abs instanceof TFile ? abs : null;
              })()
            : null;
      if (resolvedFile && resolvedFile.extension === "md") {
        dueByFile.set(resolvedFile, newDue);
      }
    }

    if (drafts.length === 0) return 0;

    await this.commitLedgerEvents("postpone", drafts, {
      now,
      beforeReconcile: async () => {
        for (const [targetFile, newDue] of dueByFile) {
          await quietFrontmatterWrite(async () => {
            await this.app.fileManager.processFrontMatter(targetFile, (fm) => {
              fm[IR_KEYS.due] = new Date(newDue).toISOString();
            });
          }, "postpone");
        }
      },
    });
    this.getActiveReviewView()?.removePostponed(postponedSet);
    const tree = this.getTreeView();
    if (tree) void tree.refresh();
    return drafts.length;
  }

  /**
   * Retract the most recently-recorded grade event. Appends a
   * `grade-undone` event referencing the target grade by id; the fold
   * skips both events on next load, so the affected element's `card`
   * reverts to its pre-grade value (or `undefined` if the undone grade
   * was the first ever for that card). The note's frontmatter is
   * rewritten in lockstep so YAML and the ledger agree.
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
    if (!this.ledger) return null;
    const events = await this.ledger.loadEvents();
    const target = findLastUndoableGrade(events);
    if (!target) return null;

    const now = Date.now();
    await this.ledger.appendEvent({
      id: newEventId(),
      ts: now,
      lamport: await this.allocLamport(now),
      device: await this.ledger.getDeviceId(),
      kind: "grade-undone",
      target: target.target,
      payload: { eventId: target.id },
    });

    // Re-fold the log so we can read the rolled-back card state and push
    // it into the note's frontmatter. If the undone grade was the only
    // grade for this card, `el.card` is now undefined — write a freshly
    // constructed card so the YAML reflects "ungraded" rather than
    // leaving the prior post-grade values in place.
    const state = await this.ledger.load();
    const el = state.elements.get(target.target);
    if (el?.notePath) {
      const file = this.app.vault.getAbstractFileByPath(el.notePath);
      if (file instanceof TFile) {
        try {
          await this.app.fileManager.processFrontMatter(file, (fm) => {
            const card = el.card ? storedToCard(el.card) : newCard();
            writeCardToFrontmatter(fm, card);
            fm[IR_KEYS.priority] = el.priority;
          });
        } catch (err) {
          console.error(
            "Incremental Reading: rewriting frontmatter after undo failed",
            err,
          );
        }
      }
    }

    await this.ledger.reconcile().catch((e) => {
      console.error("Incremental Reading: reconcile after undo failed", e);
    });
    await this.ensureSm20Matrix().catch((e) => {
      console.warn("Incremental Reading: could not refresh SM-20 matrix after undo", e);
    });
    void this.refreshStatusBar();

    const targetLabel = el ? labelFor(el) : "card";
    return { targetId: target.target, targetLabel };
  }

  /**
   * Status-bar priority prompt. Desktop only: `statusBarEl` exists on mobile
   * but is never rendered, so callers route through
   * `openTreeAndFocusPriorityEditor` and this stays the desktop fallback.
   */
  private promptPriority(file: TFile, current: number): void {
    if (!this.statusBarEl || Platform.isMobile) {
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

  /** `addCommand`, remembering the command for the help view. */
  private irCommand(command: Command): void {
    this.irCommands.push(command);
    this.addCommand(command);
  }

  private async openRightView<V>(
    viewType: string,
    guard: (view: unknown) => view is V,
    label: string,
  ): Promise<V | null> {
    let leaf = this.app.workspace.getLeavesOfType(viewType)[0];
    if (!leaf) {
      const created = this.app.workspace.getRightLeaf(false);
      if (!created) {
        new Notice(`Incremental Reading: could not open ${label}.`);
        return null;
      }
      leaf = created;
      await leaf.setViewState({ type: viewType, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
    return guard(leaf.view) ? leaf.view : null;
  }

  private async openHelpView(): Promise<void> {
    await this.openRightView(
      IR_HELP_VIEW_TYPE,
      (v): v is IrHelpView => v instanceof IrHelpView,
      "the help view",
    );
  }

  async openStatsView(tab?: "overview" | "triage" | "models"): Promise<void> {
    if (!this.ledger) {
      new Notice("Incremental Reading: ledger is not ready.");
      return;
    }
    const existing = this.app.workspace.getLeavesOfType(IR_STATS_VIEW_TYPE);
    if (existing.length > 0) {
      const leaf = existing[0];
      this.app.workspace.revealLeaf(leaf);
      const view = leaf.view;
      if (view instanceof IrStatsView) {
        if (tab) view.setTab(tab);
        void view.refresh();
      }
      return;
    }
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: IR_STATS_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
    if (tab && leaf.view instanceof IrStatsView) {
      leaf.view.setTab(tab);
    }
  }

  /**
   * Write a TSV of every active item to `<vault>/anki-ir.tsv`. The pure core
   * filters dismissed items, sorts by id, and writes the row guid as the
   * element id, so Anki imports merge in place across runs (deck definition
   * line in the header tells Anki where to put new items).
   */
  private async exportAnkiTsv(): Promise<void> {
    if (!this.ledger) {
      new Notice("Incremental Reading: ledger is not ready.");
      return;
    }
    const state = await this.ledger.load();
    const elements = Array.from(state.elements.values());
    const tsv = toAnkiTsv(elements, { deck: this.settings.ankiDeckName });
    const outPath = "anki-ir.tsv";
    await this.app.vault.adapter.write(outPath, tsv);
    const itemCount = elements.filter(
      (e) => e.type === "item" && !e.dismissed && !isOcclusionItem(e),
    ).length;
    const skippedOcclusions = elements.filter(
      (e) => e.type === "item" && !e.dismissed && isOcclusionItem(e),
    ).length;
    new Notice(
      `Incremental Reading: wrote ${itemCount} item` +
        `${itemCount === 1 ? "" : "s"} to ${outPath}.` +
        (skippedOcclusions > 0
          ? ` Skipped ${skippedOcclusions} image-occlusion item${skippedOcclusions === 1 ? "" : "s"}; Anki TSV cannot import them.`
          : ""),
    );
  }

  /**
   * Copy the optimizer data report to the clipboard: how many rated
   * reviews are usable for FSRS parameter fitting, what a fit could do
   * with them today, and what was excluded and why (PLAN-OPTIMIZER.md
   * stage 1). Read-only over the event log; nothing is scheduled or
   * written.
   */
  private async copyOptimizerDataReport(): Promise<void> {
    if (!this.ledger) return;
    await this.ledgerInit;
    const events = await this.ledger.loadEvents();
    const state = await this.ledger.load();
    const revlog = extractRevlog(events, state);
    const text = formatDataReport(revlog, Date.now());
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      new Notice("Incremental Reading: could not write to the clipboard.");
      return;
    }
    const r = revlog.report;
    new Notice(
      `Optimizer data report copied: ${r.includedReviews} usable review${r.includedReviews === 1 ? "" : "s"} across ${r.includedCards} item${r.includedCards === 1 ? "" : "s"}.`,
    );
  }

  /** Open the mobile capture sheet programmatically (#65). */
  private mobileOpenCaptureSheet(): void {
    openMobileCaptureSheet({
      createExtract: (text) => this.mobileCreateExtract(text),
      createCloze: (text, hint) => this.mobileCreateCloze(text, hint),
      createTopic: (text, title) => this.mobileCreateTopic(text, title),
    });
  }

  /** Create an extract from mobile capture text. */
  private async mobileCreateExtract(text: string): Promise<ElementId | null> {
    return this.mobileCreateScheduledElement({
      type: "extract",
      text,
      schedule: topicStateToSchedule(
        newTopicState(this.settings, new Date()),
      ),
    });
  }

  /** Create a cloze item from mobile capture text. */
  private async mobileCreateCloze(text: string, hint?: string): Promise<ElementId | null> {
    return this.mobileCreateScheduledElement({
      type: "item",
      text: wrapCloze(text, 1, hint),
      card: cardToStored(newCard(new Date())),
    });
  }

  /** Create a topic from mobile capture text. */
  private async mobileCreateTopic(text: string, title: string): Promise<ElementId | null> {
    const trimmed = text.trim();
    const index = await this.buildVaultDuplicateIndex();
    const dup = findDuplicateTopicOrExtract(index, { text: trimmed });
    if (dup) {
      this.showDuplicateImportNotice(dup, {
        title,
        body: trimmed,
        onCreate: async () => {
          const id = await this.createMobileTopicDirect(trimmed, title);
          if (id) new Notice(`Incremental Reading: topic "${title}" captured.`);
        },
      });
      return null;
    }
    return this.createMobileTopicDirect(trimmed, title);
  }

  private async createMobileTopicDirect(trimmedText: string, title: string): Promise<ElementId | null> {
    const folder = this.settings.extractFolder.trim().replace(/^\/+|\/+$/g, "");
    const stem =
      title
        .replace(/[\\/:*?"<>|#^[\]]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 60) || "IR capture";
    if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
      await this.app.vault.createFolder(folder);
    }
    const path = uniqueMarkdownNotePath(this.app, folder, stem);
    const file = await this.app.vault.create(path, trimmedText + "\n");
    await markAsTopic(this.app, file, this.settings);
    await this.recordElement(file);
    return elementIdForPath(file.path);
  }

  private async buildVaultDuplicateIndex(): Promise<DuplicateIndex> {
    const state = this.ledger ? await this.ledger.load() : null;
    const byPath = new Map<string, ElementId>();
    if (state) {
      for (const el of state.elements.values()) {
        if (el.notePath && !byPath.has(el.notePath)) {
          byPath.set(el.notePath, el.id);
        }
      }
    }
    const mdFiles = this.app.vault.getMarkdownFiles();
    const notes: DuplicateSourceNote[] = [];
    for (const file of mdFiles) {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as
        | Record<string, unknown>
        | undefined;
      const body = await this.app.vault.cachedRead(file);
      notes.push({
        path: file.path,
        title: file.basename,
        body,
        frontmatter: fm,
        elementId: byPath.get(file.path),
      });
    }
    return buildDuplicateIndex({
      elements: state ? state.elements.values() : [],
      notes,
    });
  }

  private showDuplicateImportNotice(
    dup: DuplicateMatch,
    opts: {
      title: string;
      body: string;
      onCreate: () => Promise<void>;
    },
  ): void {
    const targetPath = dup.notePath ?? dup.sourcePath;
    const label = dup.title || targetPath || "an existing element";
    const reasonText = dup.reason === "url" ? "matching URL" : "matching content";
    const notice = new Notice("", 15000);
    notice.noticeEl.empty();
    const wrap = notice.noticeEl.createDiv();
    wrap.createDiv({
      text: `Incremental Reading: duplicate ${reasonText} already exists (${label}).`,
    });
    const actions = wrap.createDiv();
    actions.style.display = "flex";
    actions.style.gap = "6px";
    actions.style.flexWrap = "wrap";
    actions.style.marginTop = "6px";

    let handled = false;
    const runOnce = (fn: () => Promise<void>) => {
      if (handled) return;
      handled = true;
      notice.hide();
      void fn().catch((err) => {
        console.error("Incremental Reading: duplicate action failed", err);
        new Notice("Incremental Reading: action failed.");
      });
    };

    const openBtn = actions.createEl("button", { text: "Open existing" });
    openBtn.addEventListener("click", () =>
      runOnce(async () => {
        if (dup.elementId) {
          this.revealSessionEntry(dup.elementId, targetPath);
          return;
        }
        if (targetPath) {
          const af = this.app.vault.getAbstractFileByPath(targetPath);
          if (af instanceof TFile) {
            await this.app.workspace.getLeaf(true).openFile(af);
            return;
          }
        }
        new Notice("Incremental Reading: existing target could not be opened.");
      }),
    );

    const appendBtn = actions.createEl("button", { text: "Append as extract" });
    appendBtn.addEventListener("click", () =>
      runOnce(async () => {
        await this.appendDuplicateAsExtract(dup, opts.body);
      }),
    );

    const importBtn = actions.createEl("button", { text: "Import anyway" });
    importBtn.addEventListener("click", () =>
      runOnce(async () => {
        await opts.onCreate();
      }),
    );
  }

  private async appendDuplicateAsExtract(
    dup: DuplicateMatch,
    rawBody: string,
  ): Promise<void> {
    const trimmed = rawBody.trim();
    if (!trimmed) {
      new Notice("Incremental Reading: nothing to append.");
      return;
    }
    const targetPath = dup.notePath ?? dup.sourcePath;
    const af = targetPath ? this.app.vault.getAbstractFileByPath(targetPath) : null;
    if (!(af instanceof TFile) || af.extension !== "md" || !this.ledger) {
      await this.mobileCreateExtract(trimmed);
      new Notice("Incremental Reading: added as a standalone extract.");
      return;
    }

    if (!getIrType(this.app, af)) {
      await markAsTopic(this.app, af, this.settings);
      await this.recordElement(af);
    }

    const oldBody = stripFrontmatter(await this.app.vault.read(af));
    const sep = oldBody.length > 0 ? "\n\n" : "";
    const newBody = oldBody + sep + trimmed;
    const selStart = oldBody.length + sep.length;
    const selEnd = newBody.length;
    await saveBody(this.app, af, newBody);

    const parentId =
      (await this.resolveElementIdForFile(af)) ?? elementIdForPath(af.path);
    const state = await this.ledger.load();
    const parentEl = state.elements.get(parentId);
    const parentPriority =
      parentEl?.priority ?? getPriority(this.app, af, this.settings.defaultPriority);
    const parentAf =
      parentEl?.schedule?.aFactor ??
      readTopicFromFrontmatter(
        this.app.metadataCache.getFileCache(af)?.frontmatter,
        this.settings,
      ).aFactor;

    const now = Date.now();
    const lamport = Math.max(now, await this.ledger.nextLamport());
    const device = await this.ledger.getDeviceId();
    const { childAFactor, parentAFactorAfter } = computeExtractAFactorPair(
      parentAf,
      trimmed.length,
    );
    const childPriority = clampPriority(
      spreadExtractPriority(parentPriority, trimmed.length),
    );
    const childState = newTopicState(this.settings, new Date(now));
    childState.aFactor = childAFactor;
    const ev = buildExtractEvent({
      sourcePath: af.path,
      sourceText: newBody,
      selStart,
      selEnd,
      parentId,
      priority: childPriority,
      elementId: newElementId(),
      eventId: newEventId(),
      device,
      lamport,
      now,
      schedule: topicStateToSchedule(childState),
    });
    await this.appendCreatedWithPlacement(ev);
    await this.decayParentAFactorAfterExtract(
      parentId,
      parentEl,
      af,
      parentAFactorAfter,
      device,
    );
    await this.ledger.reconcile();
    void this.refreshStatusBar();
    new Notice(`Appended extract to "${af.basename}".`);
    await this.app.workspace.getLeaf(true).openFile(af);
  }

  private async mobileCreateScheduledElement(opts: {
    type: "extract" | "item";
    text: string;
    schedule?: IrElement["schedule"];
    card?: IrElement["card"];
  }): Promise<ElementId | null> {
    if (!this.ledger) return null;
    const elementId = newElementId();
    const now = Date.now();
    const lamport = Math.max(now, await this.ledger.nextLamport());
    const device = await this.ledger.getDeviceId();
    const element: IrElement = {
      ...newElement({
        id: elementId,
        type: opts.type,
        priority: this.settings.defaultPriority,
        parentId: null,
        text: opts.text,
        now,
      }),
      ...(opts.schedule ? { schedule: opts.schedule } : {}),
      ...(opts.card ? { card: opts.card } : {}),
    };
    await this.appendCreatedWithPlacement({
      id: newEventId(),
      ts: now,
      lamport,
      device,
      kind: "element-created",
      target: elementId,
      payload: { element },
    });
    await this.ledger.reconcile().catch((e) =>
      console.error(`Incremental Reading: reconcile after mobile ${opts.type} failed`, e),
    );
    await this.refreshStatusBar();
    return elementId;
  }

  /**
   * Import the current clipboard text as a new IR topic. The pure
   * `planBulkImport` resolves title, body, and frontmatter; this method
   * creates the vault note, records it in the ledger, and opens it.
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

    const index = await this.buildVaultDuplicateIndex();
    const dup = findDuplicateTopicOrExtract(index, {
      texts: [text.trim(), plan.body],
    });
    if (dup) {
      this.showDuplicateImportNotice(dup, {
        title: plan.title,
        body: plan.body.trim() || text.trim(),
        onCreate: () => this.createBulkImportedTopic(plan),
      });
      return;
    }

    await this.createBulkImportedTopic(plan);
  }

  private async createBulkImportedTopic(plan: BulkImportPlan): Promise<void> {
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

    const trimmedBody = plan.body.trim();
    const file = await this.app.vault.create(path, trimmedBody + "\n");
    await quietFrontmatterWrite(async () => {
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        for (const [k, v] of Object.entries(plan.frontmatter)) fm[k] = v;
        writeTopicToFrontmatter(
          fm,
          newTopicState(this.settings, new Date(), trimmedBody.length),
        );
      });
    }, "bulkImport");

    await this.recordElement(file);
    new Notice(`Imported "${plan.title}" as an IR topic.`);
    await this.app.workspace.getLeaf(true).openFile(file);
  }

  private async pickSmCollectionSource(): Promise<{ fs: SmSourceFs; diagnostics: SmReadDiagnostics } | null> {
    const diagnostics = new SmReadDiagnostics();
    if (Platform.isDesktopApp) {
      const req = (window as unknown as { require?: (id: string) => unknown }).require;
      if (typeof req === "function") {
        try {
          const electron = req("electron") as {
            remote?: { dialog?: { showOpenDialog?: (opts: unknown) => Promise<{ canceled: boolean; filePaths: string[] }> } };
            dialog?: { showOpenDialog?: (opts: unknown) => Promise<{ canceled: boolean; filePaths: string[] }> };
          };
          const dialog = electron?.remote?.dialog ?? electron?.dialog;
          if (dialog?.showOpenDialog) {
            const picked = await dialog.showOpenDialog({
              title: "Select SuperMemo (SM18 / SM20) collection folder",
              properties: ["openDirectory"],
            });
            if (picked.canceled || picked.filePaths.length === 0) return null;
            const rootDir = picked.filePaths[0]!;
            const fsPromises = req("fs/promises") as {
              readdir: (p: string) => Promise<string[]>;
              readFile: (p: string) => Promise<Uint8Array>;
              realpath: (p: string) => Promise<string>;
              lstat: (p: string) => Promise<{ isSymbolicLink(): boolean; isFile(): boolean }>;
            };
            const pathMod = req("path") as {
              resolve: (...parts: string[]) => string;
              sep: string;
            };
            const rootReal = await fsPromises.realpath(rootDir);
            const resolveConfinedPath = async (rel: string): Promise<string | null> => {
              if (rel.includes("\0") || rel.includes(":")) return null;
              const norm = rel.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
              if (norm && norm.split("/").some((seg) => !seg || seg === "." || seg === "..")) {
                return null;
              }
              const candidate = norm ? pathMod.resolve(rootReal, norm) : rootReal;
              if (candidate !== rootReal && !candidate.startsWith(rootReal + pathMod.sep)) {
                return null;
              }
              const st = await fsPromises.lstat(candidate);
              if (st.isSymbolicLink()) return null;
              const real = await fsPromises.realpath(candidate);
              if (real !== rootReal && !real.startsWith(rootReal + pathMod.sep)) {
                return null;
              }
              return real;
            };
            return { fs: {
              async listDir(relDir: string): Promise<string[]> {
                try {
                  const full = await resolveConfinedPath(relDir);
                  if (!full) return [];
                  const entries = await fsPromises.readdir(full);
                  const out: string[] = [];
                  for (const name of entries) {
                    if (name === "." || name === ".." || name.includes("\0")) continue;
                    const childRel = relDir ? `${relDir}/${name}` : name;
                    if (await resolveConfinedPath(childRel)) {
                      out.push(childRel);
                    }
                  }
                  return out;
                } catch {
                  diagnostics.noteFailure();
                  return [];
                }
              },
              async readBinary(relPath: string): Promise<Uint8Array | null> {
                try {
                  const full = await resolveConfinedPath(relPath);
                  if (!full) return null;
                  const st = await fsPromises.lstat(full);
                  if (!st.isFile()) return null;
                  const buf = await fsPromises.readFile(full);
                  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
                } catch {
                  diagnostics.noteFailure();
                  return null;
                }
              },
            }, diagnostics };
          }
        } catch {
          // Fall through to in-vault folder picker
        }
      }
    }

    const folders = this.app.vault
      .getAllLoadedFiles()
      .filter((f): f is TFolder => f instanceof TFolder)
      .map((f) => f.path)
      .sort();
    const pickedFolder = await new Promise<string | null>((resolve) => {
      class SmFolderSuggest extends FuzzySuggestModal<string> {
        private settled = false;
        getItems(): string[] { return folders; }
        getItemText(item: string): string { return item || "/"; }
        onChooseItem(item: string): void {
          this.settled = true;
          resolve(item);
        }
        onClose(): void {
          if (!this.settled) resolve(null);
          super.onClose();
        }
      }
      new SmFolderSuggest(this.app).open();
    });
    if (pickedFolder === null) return null;
    const base = pickedFolder.replace(/^\/+|\/+$/g, "");
    const adapter = this.app.vault.adapter;
    return { fs: {
      async listDir(relDir: string): Promise<string[]> {
        const target = [base, relDir].filter(Boolean).join("/");
        try {
          const listed = await adapter.list(target);
          const stripBase = (p: string) =>
            base && p.startsWith(`${base}/`) ? p.slice(base.length + 1) : p;
          return [...listed.folders.map(stripBase), ...listed.files.map(stripBase)];
        } catch {
          diagnostics.noteFailure();
          return [];
        }
      },
      async readBinary(relPath: string): Promise<Uint8Array | null> {
        const target = [base, relPath].filter(Boolean).join("/");
        try {
          if (!(await adapter.exists(target))) return null;
          const buf = await adapter.readBinary(target);
          return new Uint8Array(buf);
        } catch {
          diagnostics.noteFailure();
          return null;
        }
      },
    }, diagnostics };
  }

  private async importSmCollection(): Promise<void> {
    if (!this.ledger) {
      new Notice("Incremental Reading: ledger is not ready.");
      return;
    }
    await this.ledgerInit;
    const picked = await this.pickSmCollectionSource();
    if (!picked) return;
    const { fs, diagnostics } = picked;

    const nowMs = Date.now();
    const state = await this.ledger.load();
    const deviceId = await this.ledger.getDeviceId();
    const baseFolder = this.settings.extractFolder.trim().replace(/^\/+|\/+$/g, "") || "SM Import";
    const targetFolder = `${baseFolder}/SM Collection`;
    const attachmentFolder = `${targetFolder}/attachments`;

    let plan;
    try {
      plan = await planSmCollectionImport({
        fs,
        nowMs,
        deviceId,
        targetFolder,
        attachmentFolder,
        existingElements: state.elements,
        existingPaths: new Set(this.app.vault.getFiles().map((f) => f.path)),
        extractCreatesStandaloneNote: this.settings.extractCreatesStandaloneNote,
      });
    } catch (e) {
      console.error("Incremental Reading: SuperMemo collection import failed", e);
      const detail = e instanceof Error ? e.message : String(e);
      new Notice(`Incremental Reading: could not parse SuperMemo collection (${detail}).`);
      return;
    }

    const ensureFolder = async (dirPath: string) => {
      if (!dirPath) return;
      assertVaultRelativePath(dirPath);
      const parts = dirPath.split("/").filter(Boolean);
      let acc = "";
      for (const part of parts) {
        acc = acc ? `${acc}/${part}` : part;
        if (!this.app.vault.getAbstractFileByPath(acc)) {
          await this.app.vault.createFolder(acc).catch(() => undefined);
        }
      }
    };

    if (plan.attachments.length > 0) {
      await ensureFolder(attachmentFolder);
      for (const att of plan.attachments) {
        const attPath = assertVaultRelativePath(`${attachmentFolder}/${att.targetFileName}`);
        if (!this.app.vault.getAbstractFileByPath(attPath)) {
          await this.app.vault.createBinary(attPath, att.bytes.buffer.slice(att.bytes.byteOffset, att.bytes.byteOffset + att.bytes.byteLength) as ArrayBuffer);
        }
      }
    }

    if (plan.notes.length > 0) {
      const uniqueDirs = new Set<string>([targetFolder]);
      for (const note of plan.notes) {
        const safeRelPath = assertVaultRelativePath(note.relPath);
        const slash = safeRelPath.lastIndexOf("/");
        if (slash > 0) uniqueDirs.add(safeRelPath.slice(0, slash));
      }
      for (const dir of uniqueDirs) {
        await ensureFolder(dir);
      }
      for (const note of plan.notes) {
        const safeRelPath = assertVaultRelativePath(note.relPath);
        if (this.app.vault.getAbstractFileByPath(safeRelPath)) continue;
        await this.app.vault.create(
          safeRelPath,
          serializeInitialNoteWithFrontmatter(note.frontmatter, note.markdown),
        );
      }
    }

    if (plan.events.length > 0) {
      let lamport = Math.max(nowMs, await this.ledger.nextLamport());
      const stampedEvents = plan.events.map((ev) => ({ ...ev, lamport: lamport++ }));
      await this.ledger.appendEvents(stampedEvents);
      const newElementIds = new Set(plan.elements.map((el) => el.id));
      await this.ledger.reconcileNew(newElementIds);
    }

    if (plan.sm20Baseline) {
      const allEvents = await this.ledger.loadEvents();
      const sorted = [...allEvents].sort((a, b) => a.lamport - b.lamport || a.id.localeCompare(b.id));
      const headEventId = sorted.length > 0 ? sorted[sorted.length - 1]!.id : null;
      const baselineCursorEventId = plan.baselineCursorEventId ?? headEventId;
      const matrix = foldSm20MatrixFromEvents(sorted, {
        baseline: plan.sm20Baseline,
        afterEventId: baselineCursorEventId,
      });
      this.sm20Matrix = matrix;
      this.sm20MatrixMeta = {
        baseline: plan.sm20Baseline,
        baselineCursorEventId,
        headEventId,
        eventCount: sorted.length,
      };
      await this.ledger.writeSm20Matrix({
        schemaVersion: 2,
        matrix: snapshotSm20Matrix(matrix),
        baseline: plan.sm20Baseline,
        baselineCursorEventId,
        headEventId,
        eventCount: sorted.length,
      });
    }

    let savedBookmarkCount = plan.stats.bookmarks;
    let bookmarkWarnSuffix = "";
    if (plan.bookmarks.length > 0) {
      const bmLoad = await this.ledger.loadBookmarksResult();
      if (!bmLoad.ok) {
        savedBookmarkCount = 0;
        bookmarkWarnSuffix = " (bookmarks skipped: existing bookmarks.json could not be read)";
        console.warn(
          "Incremental Reading: could not read existing bookmarks.json; skipping imported bookmark write to avoid overwriting saved positions.",
        );
      } else {
        const mergedBm: BookmarkMap = { ...bmLoad.bookmarks };
        for (const b of plan.bookmarks) {
          mergedBm[b.elementId] = b;
        }
        await this.ledger.saveBookmarks(mergedBm);
      }
    }

    await this.getTreeView()?.refresh();
    void this.refreshStatusBar();
    const s = plan.stats;
    const summary = `Imported SM collection: ${s.topics} topics, ${s.ledgerExtracts + s.noteExtracts} extracts, ${s.items} items, ${s.attachments} attachments, ${savedBookmarkCount} bookmarks` +
      (s.skippedDuplicates > 0 ? ` (${s.skippedDuplicates} duplicates skipped)` : "") +
      bookmarkWarnSuffix +
      formatSmReadWarning(diagnostics.count);
    console.info(`Incremental Reading: ${summary}`);
    new Notice(`Incremental Reading: ${summary}`);
  }

  private async pickEpubOrHtmlDocument(): Promise<{ name: string; bytes: Uint8Array } | null> {
    if (Platform.isDesktopApp) {
      const req = (window as unknown as { require?: (id: string) => unknown }).require;
      if (typeof req === "function") {
        try {
          const electron = req("electron") as {
            remote?: { dialog?: { showOpenDialog?: (opts: unknown) => Promise<{ canceled: boolean; filePaths: string[] }> } };
            dialog?: { showOpenDialog?: (opts: unknown) => Promise<{ canceled: boolean; filePaths: string[] }> };
          };
          const dialog = electron?.remote?.dialog ?? electron?.dialog;
          if (dialog?.showOpenDialog) {
            const picked = await dialog.showOpenDialog({
              title: "Select EPUB or HTML document",
              properties: ["openFile"],
              filters: [{ name: "EPUB & HTML", extensions: ["epub", "html", "htm"] }],
            });
            if (picked.canceled || picked.filePaths.length === 0) return null;
            const filePath = picked.filePaths[0]!;
            const fsPromises = req("fs/promises") as {
              readFile: (p: string) => Promise<Uint8Array>;
            };
            const pathMod = req("path") as { basename: (p: string) => string };
            const buf = await fsPromises.readFile(filePath);
            return {
              name: pathMod.basename(filePath),
              bytes: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
            };
          }
        } catch {
          // Fall through to in-vault picker
        }
      }
    }

    const candidates = this.app.vault
      .getFiles()
      .filter((f) => /^(?:epub|html?)$/i.test(f.extension))
      .sort((a, b) => a.path.localeCompare(b.path));
    if (candidates.length === 0) {
      new Notice("Incremental Reading: no .epub or .html files found in the vault.");
      return null;
    }

    const pickedFile = await new Promise<TFile | null>((resolve) => {
      class DocumentSuggest extends FuzzySuggestModal<TFile> {
        private settled = false;
        getItems(): TFile[] {
          return candidates;
        }
        getItemText(item: TFile): string {
          return item.path;
        }
        onChooseItem(item: TFile): void {
          this.settled = true;
          resolve(item);
        }
        onClose(): void {
          if (!this.settled) resolve(null);
        }
      }
      const modal = new DocumentSuggest(this.app);
      modal.setPlaceholder("Choose an EPUB or HTML file from the vault…");
      modal.open();
    });
    if (!pickedFile) return null;
    const ab = await this.app.vault.readBinary(pickedFile);
    return { name: pickedFile.name, bytes: new Uint8Array(ab) };
  }

  private async ensureVaultFoldersForFile(filePath: string): Promise<void> {
    assertVaultRelativePath(filePath);
    const slash = filePath.lastIndexOf("/");
    if (slash <= 0) return;
    const dir = filePath.slice(0, slash);
    const parts = dir.split("/").filter(Boolean);
    let acc = "";
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(acc)) {
        await this.app.vault.createFolder(acc).catch(() => undefined);
      }
    }
  }

  private async importEpubOrHtmlDocument(vaultFile?: TFile): Promise<void> {
    if (!this.ledger) {
      new Notice("Incremental Reading: ledger is not ready.");
      return;
    }
    await this.ledgerInit;

    let docName: string;
    let bytes: Uint8Array;
    if (vaultFile) {
      docName = vaultFile.name;
      bytes = new Uint8Array(await this.app.vault.readBinary(vaultFile));
    } else {
      const picked = await this.pickEpubOrHtmlDocument();
      if (!picked) return;
      docName = picked.name;
      bytes = picked.bytes;
    }

    const now = Date.now();
    const deviceId = await this.ledger.getDeviceId();
    const extractFolder = this.settings.extractFolder.trim().replace(/^\/+|\/+$/g, "");
    const existingPaths = new Set(this.app.vault.getFiles().map((f) => f.path));
    const isZipMagic = bytes.byteLength >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
    const isEpub = /\.epub$/i.test(docName) || isZipMagic;

    if (isEpub) {
      let plan;
      try {
        const zipEntries = await readZipEntries(bytes);
        plan = planEpubImport({
          zipEntries,
          extractFolder,
          attachmentFolder: `${extractFolder || "IR"}/attachments`,
          defaultPriority: this.settings.defaultPriority,
          now,
          deviceId,
          fileNameHint: docName,
          existingPaths,
        });
      } catch (e) {
        console.error("Incremental Reading: EPUB import failed", e);
        new Notice(
          `Incremental Reading: EPUB import failed (${e instanceof Error ? e.message : String(e)}).`,
        );
        return;
      }

      const ensuredFolders = new Set<string>();
      const ensureParentOnce = async (filePath: string) => {
        assertVaultRelativePath(filePath);
        const slash = filePath.lastIndexOf("/");
        if (slash <= 0) return;
        const dir = filePath.slice(0, slash);
        if (ensuredFolders.has(dir)) return;
        await this.ensureVaultFoldersForFile(filePath);
        ensuredFolders.add(dir);
      };

      for (const att of plan.attachments) {
        assertVaultRelativePath(att.vaultPath);
        if (this.app.vault.getAbstractFileByPath(att.vaultPath)) continue;
        await ensureParentOnce(att.vaultPath);
        const ab = att.bytes.buffer.slice(
          att.bytes.byteOffset,
          att.bytes.byteOffset + att.bytes.byteLength,
        ) as ArrayBuffer;
        await this.app.vault.createBinary(att.vaultPath, ab);
      }

      for (const note of plan.notes) {
        assertVaultRelativePath(note.path);
        if (this.app.vault.getAbstractFileByPath(note.path)) continue;
        await ensureParentOnce(note.path);
        await this.app.vault.create(
          note.path,
          serializeInitialNoteWithFrontmatter(note.frontmatter, note.markdown),
        );
      }

      let lamport = Math.max(now, await this.ledger.nextLamport());
      const stamped = plan.events.map((ev) => ({ ...ev, lamport: lamport++ }));
      await this.ledger.appendEvents(stamped);
      await this.ledger.reconcileNew(new Set(plan.notes.map((n) => n.elementId)));
      await this.getTreeView()?.refresh();
      void this.refreshStatusBar();

      const chapterCount = plan.notes.filter((n) => n.role === "chapter").length;
      new Notice(`Imported "${plan.bookTitle}" (${chapterCount} chapter${chapterCount === 1 ? "" : "s"}).`);
      const bookFile = this.app.vault.getAbstractFileByPath(plan.bookPath);
      if (bookFile instanceof TFile) {
        await this.app.workspace.getLeaf(true).openFile(bookFile);
      }
      return;
    }

    const html = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    let plan;
    try {
      plan = planHtmlImport({
        html,
        fileName: docName,
        extractFolder,
        defaultPriority: this.settings.defaultPriority,
        now,
        deviceId,
        existingPaths,
      });
    } catch (e) {
      console.error("Incremental Reading: HTML import failed", e);
      new Notice(
        `Incremental Reading: HTML import failed (${e instanceof Error ? e.message : String(e)}).`,
      );
      return;
    }
    assertVaultRelativePath(plan.path);
    await this.ensureVaultFoldersForFile(plan.path);
    const created = await this.app.vault.create(
      plan.path,
      serializeInitialNoteWithFrontmatter(plan.frontmatter, plan.markdown || ""),
    );

    const lamport = Math.max(now, await this.ledger.nextLamport());
    await this.ledger.appendEvents([{ ...plan.event, lamport }]);
    await this.ledger.reconcileNew(new Set([plan.elementId]));
    await this.getTreeView()?.refresh();
    void this.refreshStatusBar();
    new Notice(`Imported "${plan.title}" as an IR topic.`);
    await this.app.workspace.getLeaf(true).openFile(created);
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
    try {
      await this.runMercyNow();
    } catch (error) {
      console.error("Incremental Reading: mercy failed", error);
      new Notice(
        "Incremental Reading: mercy could not be applied. See console for details.",
      );
    }
  }

  private buildMercyEntries(
    elements: Iterable<IrElement>,
    events: readonly IrEvent[],
  ): { entries: MercyEntry[]; labelsById: Map<string, string> } {
    const history = computeElementHistoryCounts(events);
    const entries: MercyEntry[] = [];
    const labelsById = new Map<string, string>();
    for (const el of elements) {
      const due = el.card?.due ?? el.schedule?.due;
      if (due === undefined) continue;
      const hist = history.get(el.id);
      const isItem = el.type === "item";
      labelsById.set(el.id, labelFor(el));
      entries.push({
        id: el.id,
        priority: el.priority,
        dueMs: due,
        dismissed: el.dismissed,
        type: isItem ? "item" : "reading",
        interval: el.card?.scheduledDays ?? el.schedule?.interval,
        reps: isItem ? (el.card?.reps ?? 0) : (hist?.readingReps ?? 0),
        lapses: el.card?.lapses ?? 0,
        difficulty: el.card?.difficulty,
        requestedRetention: effectiveItemRetention(
          el.priority,
          this.settings.prioritySchedulingPolicy.enabled,
          this.settings.desiredRetention,
          this.settings.prioritySchedulingPolicy.itemHighRetention,
          this.settings.prioritySchedulingPolicy.itemLowRetention,
        ),
        aFactor: el.schedule?.aFactor,
        postponeCount: hist?.recentPostponeCount ?? 0,
        totalPostponeCount: hist?.totalPostponeCount ?? 0,
      });
    }
    return { entries, labelsById };
  }

  private async runMercyNow(): Promise<void> {
    if (!this.ledger) {
      new Notice("Incremental Reading: ledger is not ready.");
      return;
    }
    const now = Date.now();
    const state = await this.ledger.load();
    const events = await this.ledger.loadEvents();
    const { entries, labelsById } = this.buildMercyEntries(
      state.elements.values(),
      events,
    );

    const initialPlan = planMercy(entries, now, {
      ceiling: this.settings.mercyCeiling,
      priorityCutoff: this.settings.mercyPriorityCutoff,
      weights: this.settings.mercyWeights,
    });

    if (initialPlan.postponedCount === 0) {
      const due = initialPlan.dueToday.length;
      new Notice(
        `Incremental Reading: ${due} due, within ceiling ` +
          `(${this.settings.mercyCeiling}). Nothing to postpone.`,
      );
      return;
    }

    const modalResult = await previewMercy(
      this.app,
      initialPlan,
      this.settings.mercyCeiling,
      {
        entries,
        actionMs: now,
        priorityCutoff: this.settings.mercyPriorityCutoff,
        weights: this.settings.mercyWeights,
        labelsById,
      },
    );
    if (!modalResult.apply) return;
    const result = modalResult.plan;
    if (
      modalResult.ceiling !== this.settings.mercyCeiling ||
      modalResult.priorityCutoff !== this.settings.mercyPriorityCutoff ||
      modalResult.weights.mode !== this.settings.mercyWeights.mode
    ) {
      this.settings.mercyCeiling = modalResult.ceiling;
      this.settings.mercyPriorityCutoff = modalResult.priorityCutoff;
      this.settings.mercyWeights = { ...modalResult.weights };
      await this.saveSettings();
    }
    let lamport = nextLamport(events);
    const device = await this.ledger.getDeviceId();
    const batchId = newEventId();

    for (const assignment of result.assignments) {
      const ev: IrEvent = {
        id: newEventId(),
        ts: now,
        lamport,
        device,
        kind: "mercy-postponed",
        target: assignment.id as ElementId,
        payload: {
          batchId,
          previousDue: assignment.previousDue,
          newDue: assignment.newDue,
          operation: "mercy",
        },
      };
      await this.ledger.appendEvent(ev);
      lamport += 1;
    }
    await this.ledger.reconcile();

    new Notice(
      `Incremental Reading: postponed ${result.postponedCount} element` +
        `${result.postponedCount === 1 ? "" : "s"} across future days ` +
        `(${result.dueToday.length} kept due today).`,
    );
    this.getActiveReviewView()?.removePostponed(
      new Set(result.postponed as ElementId[]),
    );
    const tree = this.getTreeView();
    if (tree) void tree.refresh();
    void this.refreshStatusBar();
  }

  private async runStartupAutoPostpone(): Promise<void> {
    if (!this.ledger || !this.settings.autoPostponePolicy.enabled) return;
    try {
      const now = Date.now();
      const dayKey = repetitionDayKey(new Date(now));
      if ((await this.ledger.loadAutoPostponeMarker())?.dayKey === dayKey) return;
      const state = await this.ledger.load();
      const existing = await this.ledger.loadEvents();
      const { entries } = this.buildMercyEntries(state.elements.values(), existing);
      const policy = this.settings.autoPostponePolicy;
      const assignments = policy.advanced
        ? (() => {
            const todayStart = new Date(now);
            todayStart.setHours(0, 0, 0, 0);
            const todayCutoff = todayStart.getTime();
            const entryById = new Map(entries.map((e) => [e.id, e]));
            const advPlan = planAdvancedPostpone(entries, now, {
              operation: "postpone",
              includeItems: true,
              includeReading: true,
              itemDelayFactor: 1.5,
              readingDelayFactor: 1.5,
              minDelayDays: 1,
              maxDelayDays: 30,
              skipPriorityAtOrBelow: policy.priorityCutoff,
              skipPostponeCountAbove: 5,
              scaleByPriority: true,
              scaleByRetention: true,
              scaleByAFactor: true,
              overdueOnly: true,
              weights: this.settings.mercyWeights,
            });
            const overdueProtectedCount = advPlan.protectedIds.filter((id) => {
              const e = entryById.get(id);
              return e !== undefined && !e.dismissed && Number.isFinite(e.dueMs) && e.dueMs < todayCutoff;
            }).length;
            const remainingToKeep = Math.max(
              0,
              Math.floor(policy.keepOverdue) - overdueProtectedCount,
            );
            return advPlan.assignments.slice(remainingToKeep);
          })()
        : planAutoPostpone(entries, now, {
            keepOverdue: policy.keepOverdue,
            priorityCutoff: policy.priorityCutoff,
            weights: this.settings.mercyWeights,
          }).assignments;
      const batchId = `auto-postpone:${await this.ledger.getDeviceId()}:${dayKey}`;
      if (assignments.length > 0) {
        let lamport = nextLamport(existing);
        const device = await this.ledger.getDeviceId();
        const events: IrEvent[] = assignments.map((assignment, index) => ({
          id: `${batchId}:${index}` as IrEvent["id"],
          ts: now,
          lamport: lamport++,
          device,
          kind: "mercy-postponed",
          target: assignment.id as ElementId,
          payload: {
            batchId,
            previousDue: assignment.previousDue,
            newDue: assignment.newDue,
            operation: "auto-postpone",
            policy: { ...policy },
            repetitionDayKey: dayKey,
          },
        }));
        await this.ledger.appendEvents(events);
        await this.ledger.reconcile();
      }
      await this.ledger.saveAutoPostponeMarker({ dayKey, batchId });
      if (assignments.length > 0) {
        new Notice(`Incremental Reading: auto-postponed ${assignments.length} overdue element` +
          `${assignments.length === 1 ? "" : "s"}. Use Undo last mercy to restore them.`);
      }
    } catch (error) {
      console.error("Incremental Reading: startup auto-postpone failed", error);
      new Notice("Incremental Reading: auto-postpone failed; startup continued. See console for details.");
    }
  }

  private async undoLastMercy(): Promise<void> {
    if (!this.ledger) return;
    try {
      const events = await this.ledger.loadEvents();
      const undone = new Set(
        events
          .filter((e) => e.kind === "mercy-undone")
          .map((e) => e.payload.batchId),
      );
      const batches = events.filter(
        (e) =>
          e.kind === "mercy-postponed" &&
          typeof e.payload.batchId === "string" &&
          !undone.has(e.payload.batchId),
      );
      const latest = batches.sort(
        (a, b) => b.lamport - a.lamport || b.id.localeCompare(a.id),
      )[0];
      if (!latest) {
        new Notice("Incremental Reading: no mercy batch to undo.");
        return;
      }
      const batchId = latest.payload.batchId as string;
      const targets = batches.filter(
        (e) =>
          e.payload.batchId === batchId &&
          Number.isFinite(e.payload.previousDue),
      );
      let lamport = nextLamport(events);
      const device = await this.ledger.getDeviceId();
      let restored = 0;
      let skipped = 0;
      const restoredDueById = new Map<ElementId, number>();
      for (const target of targets) {
        const laterDueChange = events.some(
          (e) =>
            e.target === target.target &&
            e.lamport > target.lamport &&
            ["graded", "topic-advanced", "mercy-postponed", "mercy-undone", "card-reset"].includes(
              e.kind,
            ),
        );
        if (laterDueChange) {
          skipped += 1;
          continue;
        }
        const restoredDue = target.payload.previousDue as number;
        await this.ledger.appendEvent({
          id: newEventId(),
          ts: Date.now(),
          lamport: lamport++,
          device,
          kind: "mercy-undone",
          target: target.target,
          payload: { batchId, newDue: restoredDue },
        });
        restoredDueById.set(target.target, restoredDue);
        restored += 1;
      }
      await this.ledger.appendEvent({
        id: newEventId(),
        ts: Date.now(),
        lamport: lamport++,
        device,
        kind: "mercy-undone",
        target: latest.target,
        payload: { batchId, operation: "complete" },
      });
      await this.ledger.reconcile();
      const reloaded = await this.ledger.load();
      for (const [elId, restoredDue] of restoredDueById) {
        const el = reloaded.elements.get(elId);
        if (!el?.notePath) continue;
        const abs = this.app.vault.getAbstractFileByPath(el.notePath);
        if (!(abs instanceof TFile) || abs.extension !== "md") continue;
        await quietFrontmatterWrite(async () => {
          await this.app.fileManager.processFrontMatter(abs, (fm) => {
            fm[IR_KEYS.due] = new Date(restoredDue).toISOString();
          });
        }, "undo-mercy");
      }
      this.getActiveReviewView()?.refreshElementsInPlace(reloaded.elements);
      const tree = this.getTreeView();
      if (tree) void tree.refresh();
      this.refreshAuxiliaryViews();
      void this.refreshStatusBar();
      new Notice(
        `Incremental Reading: restored ${restored}; skipped ${skipped} changed element${skipped === 1 ? "" : "s"}.`,
      );
    } catch (error) {
      console.error("Incremental Reading: undo mercy failed", error);
      new Notice(
        "Incremental Reading: could not undo mercy. See console for details.",
      );
    }
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
   * The new note carries the extract's verbatim text as body (the ledger
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
    if (this.nuking || !this.ledger || this.pendingGone.size === 0) return;
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
   * vault.on("delete"). After ledger init, any path the collection still
   * names whose file is gone and which has no tombstone gets the same
   * prompt as a live delete — unless we can see it moved.
   */
  private async reconcileMissingSources(): Promise<void> {
    if (this.nuking || !this.ledger) return;
    try {
      const state = await this.ledger.load();
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
      const after = await this.ledger.load();
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
    if (this.nuking || !this.ledger) return;
    try {
      const state = await this.ledger.load();
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
   * Notes still marked `ir-type` whose path is not in the ledger — typical
   * after a folder move was treated as a mass delete. Resurrect with the
   * original element id when the log names the old path.
   */
  private async restoreOrphanIrNotes(): Promise<void> {
    if (!this.ledger) return;
    try {
      const notes = this.enumerateIrNotes();
      const state = await this.ledger.load();
      const events = await this.ledger.loadEvents();
      const plan = planOrphanRecoveries(
        notes,
        state.elements.values(),
        events,
        state.tombstones.keys(),
        this.vaultFilePaths(),
        Date.now(),
        nextLamport(events),
        await this.ledger.getDeviceId(),
        () => newEventId(),
      );
      if (plan.events.length === 0) return;
      await this.appendRelinkEvents(plan.events);
      void this.refreshStatusBar();
      void this.refreshExtractDecorations();
      const n = plan.restored;
      new Notice(
        `Incremental Reading: restored ${n} note${n === 1 ? "" : "s"} that were still marked IR into the ledger.`,
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
    if (!this.ledger) return;
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
    const events = await this.ledger.loadEvents();
    const device = await this.ledger.getDeviceId();
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

    const promotedNotePaths = new Set<string>();
    const newEvents = planSourceDeletion(
      elements,
      path,
      title,
      now,
      lamport,
      device,
      () => newEventId(),
      (el) => {
        const base = this.promoteOrphanPath(el);
        const path = uniquePromotedNotePath(base, (p) =>
          promotedNotePaths.has(p) || !!this.app.vault.getAbstractFileByPath(p),
        );
        promotedNotePaths.add(path);
        return path;
      },
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

    for (const ev of newEvents) await this.ledger.appendEvent(ev);
    await this.ledger.reconcile();

    const undoEntry = {
      before,
      deletionEvents: newEvents,
      promotedPaths,
    };
    this.lastSourceDeletionUndo = undoEntry;
    if (!quiet) this.showSourceGoneNotice(choice, promotedPaths.length, title, undoEntry);
  }

  private showSourceGoneNotice(
    choice: SourceGoneChoice,
    promoted: number,
    title: string,
    undoEntry?: {
      before: IrElement[];
      deletionEvents: IrEvent[];
      promotedPaths: string[];
    },
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
    let clicked = false;
    btn.addEventListener("click", () => {
      if (clicked) return;
      clicked = true;
      notice.hide();
      void this.undoLastSourceDeletion(undoEntry);
    });
  }

  private async undoLastSourceDeletion(
    entry?: {
      before: IrElement[];
      deletionEvents: IrEvent[];
      promotedPaths: string[];
    },
  ): Promise<void> {
    const pending = entry ?? this.lastSourceDeletionUndo;
    if (!this.ledger || !pending) {
      new Notice("Incremental Reading: nothing to undo.");
      return;
    }
    if (this.lastSourceDeletionUndo === pending) {
      this.lastSourceDeletionUndo = null;
    }
    try {
      const events = await this.ledger.loadEvents();
      const undo = planUndoSourceDeletion(
        pending.before,
        pending.deletionEvents,
        Date.now(),
        nextLamport(events),
        await this.ledger.getDeviceId(),
        () => newEventId(),
      );
      await this.appendRelinkEvents(undo);

      this.nuking = true;
      try {
        for (const notePath of pending.promotedPaths) {
          const af = this.app.vault.getAbstractFileByPath(notePath);
          if (af instanceof TFile) await this.trashFileSafe(af);
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
    if (!this.ledger) return;
    if (file instanceof TFile) {
      if (file.extension !== "md" && file.extension !== "pdf") return;
    }
    if (oldPath === file.path) return;
    await this.rewriteSourcePaths(oldPath, file.path);
  }

  private async rewriteSourcePaths(from: string, to: string): Promise<void> {
    if (!this.ledger || from === to) return;
    for (const p of [...this.irPdfPaths]) {
      const next = rewriteStoredPath(p, from, to);
      if (next) {
        this.irPdfPaths.delete(p);
        this.irPdfPaths.add(next);
      }
    }
    try {
      const state = await this.ledger.load();
      const rewrites = sourcePathRewrites(state.elements.values(), from, to);
      if (rewrites.length === 0) return;

      const device = await this.ledger.getDeviceId();
      let lamport = await this.ledger.nextLamport();
      const now = Date.now();
      for (const rw of rewrites) {
        await this.ledger.appendEvent({
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
      await this.ledger.reconcile();
    } catch (e) {
      console.error("Incremental Reading: rename handling failed", e);
    }
  }

  /**
   * Q1 comes-back: if a note exists at a tombstoned path (plugin load after
   * trash restore, or a create we missed), offer re-link once per path.
   * Only for tombstones this device wrote; see tombstonesOwnedBy.
   */
  private async offerPendingRelinks(): Promise<void> {
    if (this.nuking || !this.ledger) return;
    try {
      const state = await this.ledger.load();
      const owned = tombstonesOwnedBy(
        await this.ledger.loadEvents(),
        await this.ledger.getDeviceId(),
      );
      for (const path of state.tombstones.keys()) {
        if (!owned.has(path)) continue;
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
    if (this.nuking || !this.ledger) return;
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
    if (this.nuking || !this.ledger) return;
    try {
      const state = await this.ledger.load();
      const tomb = state.tombstones.get(file.path);
      if (!tomb) return;

      const elements = Array.from(state.elements.values());
      const candidates = relinkCandidates(elements, tomb.path);
      const device = await this.ledger.getDeviceId();
      const now = Date.now();
      const lamport = await this.ledger.nextLamport();

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
    if (!this.ledger) return;
    for (const ev of events) await this.ledger.appendEvent(ev);
    await this.ledger.reconcile();
  }

  private async toggleDismiss(file: TFile) {
    const dismiss = !isDismissed(this.app, file);
    const elementId =
      (await this.resolveElementIdForFile(file)) ?? elementIdForPath(file.path);
    await this.applyIrDismissChange(elementId, file, dismiss);
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

  /** Command palette / ribbon / review / mobile FAB: contextual IR actions. */
  private async openIrActionsHub(): Promise<void> {
    if (!this.hubSelectionSnapshot) this.captureHubEditorSelection();
    const mv = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (mv?.file && mv.editor) {
      this.restoreHubSelection(mv.file, mv.editor);
    }
    const entries = await this.buildIrHubEntries();
    const coarse =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches;
    if (Platform.isMobile || coarse || window.innerWidth < 640) {
      openMobileHubSheet(entries, {
        dueCount: getWorkspaceIrFabDue(),
        onQuickCapture: () => this.mobileOpenCaptureSheet(),
      });
      return;
    }
    openIrRadialQuickMenu(this.app, entries, this.irRadialAnchor());
  }

  private async buildIrHubEntries(): Promise<IrHubEntry[]> {
    const out: IrHubEntry[] = [];

    const review = this.getFocusedReviewView();
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
          title: "Open IR collection",
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
      if (reviewFile?.extension === "md" && this.ledger) {
        const state = await this.ledger.load();
        for (const el of state.elements.values()) {
          if (el.type === "extract" && el.notePath === reviewFile.path) {
            out.push({
              title: "Fork this extract",
              description:
                "Duplicate this reading element (promoted extract: copy note; anchored: second ledger element).",
              icon: "git-branch",
              run: () => this.forkStoreExtract(el.id),
            });
            break;
          }
        }
      }
    out.push(
      {
        title: "Show IR stats",
        description: "Workload forecast, leech triage, and SM-20 / FSRS models.",
        icon: "bar-chart-3",
        run: () => this.openStatsView(),
      },
      {
        title: "Postpone overdue (Mercy)",
        description: "Spread excess overdue cards across upcoming days.",
        icon: "clock",
        run: () => this.runMercy(),
      },
    );

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
        title: "New cloze item (separate note)",
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
            "One new note per {{cN::…}} group; each becomes its own item. The original note is left unchanged.",
          icon: "split",
          run: () => this.splitClozeInActiveEditor(),
        });
      }
    }

    if (file?.extension === "md" && this.ledger) {
      const state = await this.ledger.load();
      for (const el of state.elements.values()) {
        if (el.type === "extract" && el.notePath === file.path) {
          out.push({
            title: "Fork this extract",
            description:
              "Duplicate this reading element (promoted extract: copy note; anchored: second ledger element).",
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
    this.restoreHubSelection(file, editor);
    const fullText = editor.getValue();
    const body = stripFrontmatter(fullText);
    const cursor = editor.posToOffset(editor.getCursor());
    const cursorInBody = bodyOffsetOfFullCursor(fullText, body, cursor);
    const range = selection
      ? this.editorSelectionAsBodyRange(editor, fullText, body)
      : null;

    return discoverStructuralExtractSpans(body, cursorInBody, range).map(
      (candidate) => ({
        title: candidate.title,
        description: candidate.description,
        icon: candidate.icon,
        run: () => this.runStructuralExtract(file, candidate.kind),
      }),
    );
  }

  private runStructuralExtract(file: TFile, kind: StructuralExtractKind): void {
    this.runMarkdownHubAction(file, (ed, f) => {
      switch (kind) {
        case "paragraph":
          return this.extractParagraphAtCursor(ed, f);
        case "heading":
          return this.extractHeadingSectionAtCursor(ed, f);
        case "blockquotes":
          return this.extractEveryBlockquote(ed, f);
        case "list-items":
          return this.extractEveryListItemInSelection(ed, f);
        case "paragraphs":
          return this.extractEveryParagraphInSelection(ed, f);
      }
    });
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
          "Incremental Reading: this item has no ir-parent; cannot place a sibling item.",
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
    await this.duplicateSiblingElement(elementId);
  }

  /** Duplicate an extract or cloze item as a sibling under the same parent with fresh schedule. */
  private async duplicateSiblingElement(elementId: ElementId): Promise<void> {
    if (!this.ledger) {
      new Notice("Incremental Reading: ledger is not ready.");
      return;
    }
    const state = await this.ledger.load();
    const el = state.elements.get(elementId);
    if (!el || (el.type !== "extract" && el.type !== "item")) {
      new Notice("Incremental Reading: sibling duplication applies to extracts and cloze items.");
      return;
    }
    const device = await this.ledger.getDeviceId();
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
      const sibPriority = spreadExtractPriority(el.priority, el.text?.length ?? 100);
      await this.app.fileManager.processFrontMatter(nf, (fm) => {
        fm["ir-priority"] = Math.round(sibPriority * 100) / 100;
        if (el.type === "item") {
          writeCardToFrontmatter(fm, newCard(new Date(now)));
        } else {
          writeTopicToFrontmatter(fm, newTopicState(this.settings, new Date(now)));
        }
      });
      await this.recordElement(nf);
      new Notice(`Incremental Reading: duplicated ${el.type} to "${nf.basename}".`);
      void this.refreshStatusBar();
      if (this.ledger) {
        const state = await this.ledger.load();
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

    const event: IrEvent = {
      id: newEventId(),
      ts: now,
      lamport: await this.allocLamport(now),
      device,
      kind: "element-created",
      target: newEl.id,
      payload: { element: newEl },
    };
    await this.appendCreatedWithPlacement(event);
    await this.ledger.reconcile().catch((e) => {
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
    if (!this.ledger || selEnd <= selStart) return;
    const id = await this.resolveElementIdForFile(itemFile);
    if (!id) return;
    const anchor = buildTextQuoteAnchor(
      sourcePath,
      sourceBody,
      selStart,
      selEnd,
    );
    try {
      const now = Date.now();
      await this.ledger.appendEvent({
        id: newEventId(),
        ts: now,
        lamport: await this.allocLamport(now),
        device: await this.ledger.getDeviceId(),
        kind: "anchor-repaired",
        target: id,
        payload: { anchor },
      });
      await this.ledger.reconcile();
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
    const skip = await this.loadIrSkipPaths();
    const refs = this.app.vault.getFiles().map((f) => ({
      path: f.path,
      extension: f.extension,
    }));
    const folderLabel = folder.name || "/";
    const planned = folderTopicCandidates(refs, folder.path, skip);
    if (planned.length === 0) {
      new Notice(`Incremental Reading: no unmarked notes in "${folderLabel}".`);
      return;
    }
    if (
      folder.path === "" ||
      folder.path === "/" ||
      planned.length > FOLDER_TOPIC_CONFIRM_THRESHOLD
    ) {
      if (!(await this.confirmMarkFolderTopics(folderLabel, planned.length))) {
        return;
      }
    }
    await this.commitBulkMarkTopics(planned, [], ` in "${folderLabel}"`);
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

  private async markActiveFileAsTopic(file?: TFile, priority?: number) {
    const target = file ?? activeIrFile(this.app);
    if (!target) {
      new Notice("Incremental Reading: no active Markdown note or PDF.");
      return;
    }
    if (target.extension === "pdf") {
      await this.markPdfAsTopic(target, { priority });
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

    const marked = await markAsTopic(this.app, target, this.settings, priority);
    if (marked) {
      await this.recordElement(target);
      new Notice(`Marked "${target.basename}" as an IR topic.`);
    }
  }

  private async openMarkWithPriority(file: TFile): Promise<void> {
    const alreadyIr =
      (file.extension === "md" && Boolean(getIrType(this.app, file))) ||
      (file.extension === "pdf" &&
        Boolean(await this.resolveElementIdForFile(file)));
    if (alreadyIr) {
      await this.openTreeAndFocusPriorityEditor(file);
      return;
    }
    const view = await this.openRightView(
      IR_PLACEMENT_PRIORITY_VIEW_TYPE,
      (v): v is IrPlacementPriorityView => v instanceof IrPlacementPriorityView,
      "the priority panel",
    );
    view?.setPrompt({
      displayText: "Mark IR topic",
      icon: "book-plus",
      initial: this.settings.defaultPriority,
      title: `Mark “${file.basename}” as IR topic`,
      commitLabel: "Mark",
      useDefaultLabel: "Use default",
      onCommit: (priority) => void this.markActiveFileAsTopic(file, priority),
    });
  }

  private async loadIrSkipPaths(): Promise<Set<string>> {
    const skip = new Set<string>(this.irPdfPaths);
    if (this.ledger) {
      const state = await this.ledger.load();
      for (const el of state.elements.values()) {
        if (el.notePath) skip.add(el.notePath);
      }
    }
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (getIrType(this.app, f)) skip.add(f.path);
    }
    return skip;
  }

  private async openBulkMarkView(seed?: readonly TAbstractFile[]): Promise<void> {
    const view = await this.openRightView(
      IR_BULK_MARK_VIEW_TYPE,
      (v): v is IrBulkMarkView => v instanceof IrBulkMarkView,
      "the bulk-mark panel",
    );
    if (view && seed && seed.length > 0) view.setSources(seed);
  }

  private async commitBulkMarkTopics(
    attempted: readonly { path: string; extension: string }[],
    priorities: readonly number[],
    scopeSuffix = "",
  ): Promise<void> {
    let marked = 0;
    const failures: string[] = [];
    for (let i = 0; i < attempted.length; i += 1) {
      const ref = attempted[i]!;
      const priority = priorities[i];
      const abs = this.app.vault.getAbstractFileByPath(ref.path);
      if (!(abs instanceof TFile)) {
        failures.push(`${ref.path}: missing`);
        continue;
      }
      try {
        if (abs.extension === "pdf") {
          if (await this.markPdfAsTopic(abs, { silent: true, priority })) {
            marked += 1;
          } else {
            failures.push(`${ref.path}: already IR or ledger unavailable`);
          }
        } else if (abs.extension === "md") {
          if (await markAsTopic(this.app, abs, this.settings, priority)) {
            await this.recordElement(abs, { skipReconcile: true });
            marked += 1;
          } else {
            failures.push(`${ref.path}: already IR`);
          }
        } else {
          failures.push(`${ref.path}: unsupported type`);
        }
      } catch (e) {
        console.error("Incremental Reading: bulk mark failed", ref.path, e);
        failures.push(`${ref.path}: error`);
      }
    }
    if (this.ledger) {
      await this.ledger.reconcile().catch((e) => {
        console.error("Incremental Reading: reconcile after bulk mark failed", e);
      });
      void this.refreshStatusBar();
    }
    const skipped = attempted.length - marked;
    const skipBit = skipped > 0 ? ` · ${skipped} skipped` : "";
    new Notice(
      `Marked ${marked} note${marked === 1 ? "" : "s"}${scopeSuffix} as IR topics${skipBit}.`,
    );
    if (failures.length > 0) {
      console.warn(
        "Incremental Reading: bulk mark runtime failures",
        failures.slice(0, 20),
      );
    }
    this.getTreeView()?.refresh();
  }

  private activePdfSelection(): PdfTextSelection | null {
    const pdfSel = findPdfTextSelection(this.app);
    if (pdfSel) {
      this.lastPdfSelection = pdfSel;
      return pdfSel;
    }
    const active = this.app.workspace.getActiveFile();
    if (active?.extension === "pdf") {
      return this.lastPdfSelection;
    }
    return null;
  }

  private canExtractSelection(): boolean {
    if (this.activePdfSelection() || this.heldPdfFile()) return true;
    if (this.getFocusedReviewView()?.getCurrentElementId()) return true;
    const mv = this.app.workspace.getActiveViewOfType(MarkdownView);
    return !!(mv?.file && this.markdownViewHasSelection(mv));
  }

  private async openExtractWithPriority(): Promise<void> {
    const computed = await this.previewExtractChildPriority();
    if (!computed) {
      new Notice("Incremental Reading: nothing selected to extract.");
      return;
    }
    const view = await this.openRightView(
      IR_PLACEMENT_PRIORITY_VIEW_TYPE,
      (v): v is IrPlacementPriorityView => v instanceof IrPlacementPriorityView,
      "the priority panel",
    );
    view?.setPrompt({
      displayText: "Extract with priority",
      icon: "scissors",
      initial: this.settings.defaultPriority,
      title: `Extract “${computed.label}” with priority`,
      commitLabel: "Extract",
      useDefaultLabel: "Use default",
      useComputed: {
        label: `Use computed (${formatPriority(computed.priority)})`,
        value: computed.priority,
      },
      onCommit: (priority) => void this.runExtractWithPriority(priority),
    });
  }

  private async previewSourceExtractPriority(
    file: TFile,
    text: string,
    fallbackPriority: number,
  ): Promise<{ priority: number; label: string }> {
    const parentId =
      (await this.resolveElementIdForFile(file)) ?? elementIdForPath(file.path);
    const parent = this.ledger
      ? (await this.ledger.load()).elements.get(parentId)
      : undefined;
    const trimmed = text.trim();
    return {
      priority: clampPriority(
        spreadExtractPriority(
          parent?.priority ?? fallbackPriority,
          trimmed.length || 100,
        ),
      ),
      label: trimmed.slice(0, 40) || file.basename,
    };
  }

  private async previewExtractChildPriority(): Promise<{
    priority: number;
    label: string;
  } | null> {
    const pdfSel = this.activePdfSelection();
    const pdfFile = pdfSel?.file ?? this.heldPdfFile();
    if (pdfFile) {
      return this.previewSourceExtractPriority(
        pdfFile,
        pdfSel?.text ?? "",
        this.settings.defaultPriority,
      );
    }
    const rv = this.getFocusedReviewView();
    if (rv) {
      const preview = rv.previewExtractChildPriority();
      if (preview) return preview;
    }
    const mv = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!mv?.file || !this.markdownViewHasSelection(mv)) return null;
    const sel =
      mv.editor.getSelection().trim() ||
      (this.previewSelectionRange(mv)?.toString().trim() ?? "");
    return this.previewSourceExtractPriority(
      mv.file,
      sel,
      getPriority(this.app, mv.file, this.settings.defaultPriority),
    );
  }

  private async runExtractWithPriority(priority: number): Promise<void> {
    const opts = { priorityOverride: priority } as const;
    const pdfSel = this.activePdfSelection();
    if (pdfSel || this.heldPdfFile()) {
      await this.extractFromPdfSelection(pdfSel, opts);
      return;
    }
    const rv = this.getFocusedReviewView();
    if (rv) {
      await rv.handleExtract(opts);
      return;
    }
    const mv = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (mv?.file && this.markdownViewHasSelection(mv)) {
      await this.extractFromMarkdownView(mv, opts);
    }
  }

  /* ----------------------------------------------------------------- */
  /* Ctrl multi-select, PDF regions, image extracts, image occlusion    */
  /* ----------------------------------------------------------------- */

  private onHeldSelectionsChange(n: number): void {
    for (const leaf of this.app.workspace.getLeavesOfType(IR_REVIEW_VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof IrReviewView) view.updateHeldSpanBadge();
    }
    if (n <= 0) return;
    new Notice(
      `Incremental Reading: ${n} selection${n === 1 ? "" : "s"} held. Alt+X extracts them together; Esc clears.`,
      3000,
    );
  }

  /** Ctrl+mousedown in the editor: remember existing selections so the drag adds to them. */
  private onDocumentMouseDown(evt: MouseEvent): void {
    this.editorCtrlSnapshot = null;
    if (!isMultiSelectModifier(evt)) return;
    const target = evt.target as HTMLElement | null;
    if (!target?.closest(".cm-editor")) return;
    const mv = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!mv || mv.getMode() !== "source") return;
    const sels = mv.editor.listSelections().filter(
      (r) => mv.editor.posToOffset(r.anchor) !== mv.editor.posToOffset(r.head),
    );
    if (sels.length > 0) this.editorCtrlSnapshot = sels;
  }

  /**
   * Ctrl+mouseup: hold the span the user just selected. Four surfaces:
   * the editor (native multi-selection via `setSelections`), a PDF text
   * layer, the review card body, and a note in reading view.
   */
  private onDocumentMouseUp(evt: MouseEvent): void {
    if (!isMultiSelectModifier(evt) || evt.button !== 0) return;
    const target = evt.target as HTMLElement | null;
    const snapshot = this.editorCtrlSnapshot;
    this.editorCtrlSnapshot = null;
    // Let the browser / CodeMirror finish updating the selection first.
    window.setTimeout(() => {
      if (target?.closest(".cm-editor")) {
        const mv = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!mv || !snapshot) return;
        const ed = mv.editor;
        const cur = ed
          .listSelections()
          .filter((r) => ed.posToOffset(r.anchor) !== ed.posToOffset(r.head));
        if (cur.length === 0) return;
        const key = (r: EditorSelectionOrCaret) =>
          [ed.posToOffset(r.anchor), ed.posToOffset(r.head ?? r.anchor)]
            .sort((a, b) => a - b)
            .join("-");
        const merged: EditorSelectionOrCaret[] = [...snapshot];
        for (const c of cur) {
          if (!merged.some((m) => key(m) === key(c))) merged.push(c);
        }
        ed.setSelections(merged, merged.length - 1);
        new Notice(
          `Incremental Reading: ${merged.length} spans selected. Alt+X extracts them together.`,
          3000,
        );
        return;
      }
      const pdf = findPdfTextSelection(this.app);
      if (pdf) {
        const held: PdfHeldSelection = {
          kind: "pdf",
          pdfPath: pdf.file.path,
          text: pdf.text,
          segments: [{ page: pdf.page, selection: pdf.selection }],
        };
        const sel = document.getSelection();
        const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
        const res = this.multiSelect.holdWithResult(held, range);
        if (!res.ok && res.reason === "source-mismatch" && res.heldSourcePath) {
          new Notice(formatHeldSelectionConflictNotice(res.heldSourcePath));
        }
        return;
      }
      const rv = this.getActiveReviewView();
      if (rv && target && rv.containerEl.contains(target)) {
        rv.holdCurrentSelection();
        return;
      }
      const mv = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (mv?.file && mv.getMode() === "preview") {
        const file = mv.file;
        const range = this.previewSelectionRange(mv);
        const root = this.previewRoot(mv);
        if (!range || !root) return;
        void (async () => {
          const raw = stripFrontmatter(await this.app.vault.cachedRead(file));
          const mapped =
            mapRenderedSelectionToRaw(raw, root, range, { includeHeadingPrefix: true }) ??
            fuzzyLocateInBody(raw, range.toString());
          if (!mapped) {
            new Notice(
              "Incremental Reading: could not map that selection to the note body.",
            );
            return;
          }
          const held: BodyHeldSelection = {
            kind: "body",
            sourcePath: file.path,
            text: mapped.text,
            start: mapped.start,
            end: mapped.end,
          };
          const res = this.multiSelect.holdWithResult(held, range);
          if (!res.ok && res.reason === "source-mismatch" && res.heldSourcePath) {
            new Notice(formatHeldSelectionConflictNotice(res.heldSourcePath));
          }
        })();
      }
    }, 0);
  }

  /** Container of the active PDF leaf (for rectangle-select). */
  private activePdfLeafContainer(): { container: HTMLElement; file: TFile } | null {
    const leaf = this.app.workspace.activeLeaf;
    if (!leaf) return null;
    const file = pdfFileFromView(leaf.view);
    const container = pdfContainerEl(leaf.view);
    if (!file || !container) return null;
    return { container, file };
  }

  /** Alt+Shift+I / Alt+Shift+O: drag a rectangle on a PDF page. */
  private async startPdfRegionCapture(mode: "extract" | "occlusion"): Promise<void> {
    const ctx = this.activePdfLeafContainer();
    if (!ctx) {
      new Notice("Incremental Reading: open a PDF first.");
      return;
    }
    this.pdfRectCancel?.();
    new Notice(
      mode === "extract"
        ? "Drag a rectangle on the page to extract it as an image. Esc cancels."
        : "Drag a rectangle around the figure to occlude. Esc cancels.",
      4000,
    );
    this.pdfRectCancel = startPdfRectSelect(ctx.container, {
      onCancel: () => {
        this.pdfRectCancel = null;
      },
      onDone: (page, rect) => {
        this.pdfRectCancel = null;
        void this.finishPdfRegionCapture(ctx.file, page, rect, mode);
      },
    });
  }

  private async finishPdfRegionCapture(
    file: TFile,
    page: HTMLElement,
    rect: NormalizedRect,
    mode: "extract" | "occlusion",
  ): Promise<void> {
    const png = await cropPdfPage(page, rect);
    if (!png) {
      new Notice(
        "Incremental Reading: that page is not rendered yet. Scroll it into view and try again.",
      );
      return;
    }
    const pageN = pdfPageNumber(page);
    const attachmentPath = await this.getAvailableAttachmentPathSafe(
      `${pdfCropStem(file.path, pageN)}.png`,
      file.path,
    );
    const image = await this.app.vault.createBinary(attachmentPath, png);
    const pdf: PdfSelector = { page: pageN, selection: [0, 0, 0, 0], rect };
    if (mode === "extract") {
      await this.commitPdfExtract(file, `![[${image.path}]]`, pdf, {
        noticeLabel: `Extracted image from "${file.basename}" (p. ${pageN}) → ${image.path}`,
      });
      return;
    }
    // Occlusion cards are item notes, and items need a markdown parent
    // (same rule as cloze: extract first, then cloze the extract). Promote
    // the crop extract to a note and file the cards under it.
    const created = await this.commitPdfExtract(file, `![[${image.path}]]`, pdf, {
      promote: true,
    });
    const parentPath = created?.notePath;
    const parent = parentPath
      ? this.app.vault.getAbstractFileByPath(parentPath)
      : null;
    if (!(parent instanceof TFile)) {
      new Notice(
        "Incremental Reading: could not create a note for the crop; the image was saved.",
      );
      return;
    }
    await this.openOcclusionEditor(image, parent);
  }

  /** Command / file-menu entry: occlusion items from a standalone image file. */
  private async occlusionFromImageFile(image: TFile): Promise<void> {
    // Prefer an IR note that embeds this image (the user's own context);
    // otherwise make a topic note that embeds it and file the cards there.
    let parent = this.findIrNoteEmbedding(image);
    if (!parent) {
      const folder = this.settings.extractFolder.trim()
        ? normalizePathForFolder(this.settings.extractFolder)
        : (image.parent?.path ?? "");
      if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
        await this.app.vault.createFolder(folder);
      }
      const path = uniqueMarkdownNotePath(this.app, folder, image.basename);
      parent = await this.app.vault.create(path, `![[${image.path}]]\n`);
      await markAsTopic(this.app, parent, this.settings);
      await this.recordElement(parent);
    }
    await this.openOcclusionEditor(image, parent);
  }

  /** First topic/extract note whose body embeds `image`, if any. */
  private findIrNoteEmbedding(image: TFile): TFile | null {
    const resolved = this.app.metadataCache.resolvedLinks;
    for (const srcPath of Object.keys(resolved)) {
      if (!resolved[srcPath]?.[image.path]) continue;
      const af = this.app.vault.getAbstractFileByPath(srcPath);
      if (!(af instanceof TFile)) continue;
      const t = getIrType(this.app, af);
      if (t === "topic" || t === "extract") return af;
    }
    return null;
  }

  private async openOcclusionEditor(image: TFile, parent: TFile): Promise<void> {
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: IR_OCCLUSION_EDITOR_VIEW_TYPE, active: true });
    const view = leaf.view;
    if (!(view instanceof IrOcclusionEditorView)) {
      new Notice("Incremental Reading: could not open the occlusion editor.");
      return;
    }
    view.startSession({
      imagePath: image.path,
      imageUrl: this.app.vault.getResourcePath(image),
      parentLabel: parent.basename,
      mode: this.settings.occlusionDefaultMode,
      onCreate: (rects, mode) => this.createOcclusionCards(image, parent, rects, mode),
    });
    this.app.workspace.revealLeaf(leaf);
  }

  private async createOcclusionCards(
    image: TFile,
    parent: TFile,
    rects: OcclusionRect[],
    mode: OcclusionMode,
  ): Promise<void> {
    const bodies = occlusionBodies({ image: image.path, mode, rects });
    let made = 0;
    for (const b of bodies) {
      const result = await createIrItemChildNote(
        this.app,
        parent,
        b.body,
        occlusionNoteStem(image.path, b.n),
        this.settings,
      );
      if (!result.file) {
        new Notice(`Incremental Reading: ${result.error}`);
        break;
      }
      await this.recordElement(result.file);
      made += 1;
    }
    if (made > 0) {
      new Notice(
        `Created ${made} image occlusion item${made === 1 ? "" : "s"} under "${parent.basename}".`,
      );
      const tree = this.getTreeView();
      if (tree) void tree.refresh();
    }
  }

  /** `ir-occlusion` code block → masked image (reading view, review card). */
  private renderOcclusionBlock(src: string, el: HTMLElement, sourcePath: string): void {
    const spec = parseOcclusionJson(src.trim());
    if (!spec) {
      el.createEl("pre", { text: "Invalid ir-occlusion block." });
      return;
    }
    const imageFile = this.app.metadataCache.getFirstLinkpathDest(
      spec.image,
      sourcePath,
    );
    if (!imageFile) {
      el.createEl("p", {
        cls: "ir-occlusion-editor-empty",
        text: `Image not found: ${spec.image}`,
      });
      return;
    }
    const url = this.app.vault.getResourcePath(imageFile);
    // Inside the review card the pane owns reveal state (Space / swipe);
    // in a plain note the mask itself is the toggle.
    const reviewBody = el.closest<HTMLElement>(".ir-review-main-body");
    if (reviewBody) {
      renderOcclusion(el, spec, url, {
        revealed: reviewBody.classList.contains("ir-review-revealed"),
        interactive: false,
      });
      return;
    }
    let revealed = false;
    const paint = () =>
      renderOcclusion(el, spec, url, {
        revealed,
        interactive: true,
        onToggle: () => {
          revealed = !revealed;
          paint();
        },
      });
    paint();
  }

  /** Right-click on an image inside an IR note / the review card → IR menu. */
  private onDocumentContextMenu(evt: MouseEvent): void {
    const target = evt.target as HTMLElement | null;
    if (!(target instanceof HTMLImageElement)) return;
    const embed = target.closest<HTMLElement>(".internal-embed[src]");
    const link = embed?.getAttribute("src")?.split("#")[0]?.split("|")[0];
    if (!link) return;

    const rv = this.getActiveReviewView();
    let source: TFile | null = null;
    let fromPath = "";
    if (rv && rv.containerEl.contains(target)) {
      source = rv.getPlacementFileForChildren();
      fromPath = rv.getProvenancePathForChildren() ?? source?.path ?? "";
    } else {
      const mv = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!mv?.file || !mv.containerEl.contains(target)) return;
      const t = getIrType(this.app, mv.file);
      if (t !== "topic" && t !== "extract") return;
      source = mv.file;
      fromPath = mv.file.path;
    }
    if (!source) return;
    const image = this.app.metadataCache.getFirstLinkpathDest(link, fromPath);
    if (!image || !isImageFile(image)) return;

    evt.preventDefault();
    evt.stopPropagation();
    const parent = source;
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle("Extract image (IR)")
        .setIcon("image")
        .onClick(() => void this.extractImageFromNote(parent, image)),
    );
    menu.addItem((item) =>
      item
        .setTitle("Extract image region (IR, drag a rectangle)")
        .setIcon("crop")
        .onClick(() => this.extractImageRegionFromNote(parent, image, target)),
    );
    menu.addItem((item) =>
      item
        .setTitle("Image occlusion items from this image")
        .setIcon("scan")
        .onClick(() => void this.openOcclusionEditor(image, parent)),
    );
    menu.showAtMouseEvent(evt);
  }

  /**
   * Drag a rectangle on an embedded image; the crop becomes a PNG
   * attachment and an extract anchored on the image's embed markup (so the
   * source shows where it came from) whose text embeds the crop.
   */
  private extractImageRegionFromNote(
    source: TFile,
    image: TFile,
    imgEl: HTMLElement,
  ): void {
    new Notice("Drag a rectangle on the image. Esc cancels.", 4000);
    startRectSelectOnElement(imgEl, {
      onDone: (rect) => {
        void (async () => {
          const bytes = await this.app.vault.readBinary(image);
          const png = await cropImageBytes(bytes, image.extension, rect);
          if (!png) {
            new Notice("Incremental Reading: could not crop that image.");
            return;
          }
          const path = await this.getAvailableAttachmentPathSafe(
            `${image.basename} crop.png`,
            source.path,
          );
          const crop = await this.app.vault.createBinary(path, png);
          const body = stripFrontmatter(await this.app.vault.cachedRead(source));
          const range =
            findImageEmbedRange(body, image.path) ??
            findImageEmbedRange(body, image.name);
          if (!range) {
            new Notice(
              `Incremental Reading: saved ${crop.path}, but could not find the embed for "${image.name}" in "${source.basename}" to anchor on.`,
            );
            return;
          }
          await this.extractMappedBodyRange(source, {
            start: range.start,
            end: range.end,
            text: range.markup,
            textOverride: `![[${crop.path}]]`,
          });
          await this.refreshExtractDecorations();
        })();
      },
    });
  }

  /**
   * Extract an embedded image as its own element, anchored byte-exactly on
   * the `![[...]]` / `![](...)` markup in the note body so decorations and
   * relocation work like any text extract.
   */
  private async extractImageFromNote(source: TFile, image: TFile): Promise<void> {
    const body = stripFrontmatter(await this.app.vault.cachedRead(source));
    const range =
      findImageEmbedRange(body, image.path) ?? findImageEmbedRange(body, image.name);
    if (!range) {
      new Notice(
        `Incremental Reading: could not find the embed for "${image.name}" in "${source.basename}".`,
      );
      return;
    }
    await this.extractMappedBodyRange(source, {
      start: range.start,
      end: range.end,
      text: range.markup,
    });
    await this.refreshExtractDecorations();
  }

  /**
   * PDFs have no frontmatter. Record a ledger-only topic whose `notePath` is
   * the PDF. Idempotent: the id is path-derived, same as migration.
   */
  private async markPdfAsTopic(
    file: TFile,
    opts?: { silentIfExists?: boolean; silent?: boolean; priority?: number },
  ): Promise<boolean> {
    if (!this.ledger) {
      if (!opts?.silent) {
        new Notice("Incremental Reading: ledger is not ready.");
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
        device: await this.ledger.getDeviceId(),
        lamport: await this.allocLamport(now),
        now,
        priority: opts?.priority ?? this.settings.defaultPriority,
        schedule: topicStateToSchedule(
          newTopicState(this.settings, new Date(now)),
        ),
      });
      await this.appendCreatedWithPlacement(ev);
      await this.ledger.reconcile();
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
   * Mirror a just-created/marked note into the ledger as an `element-created`
   * event so it reaches the ledger-backed queue. Reuses the *pure*
   * `migrateNotes` transform on a single note: the element is built exactly
   * as a migration would build it, with the same path-derived id, so this is
   * idempotent and consistent with the rest of the ledger. Frontmatter (just
   * written by the ir-note helpers) is the dual-write fallback and is read
   * back atomically via `processFrontMatter`, which is reliable immediately
   * after creation where `metadataCache` may still be stale.
   */
  private async recordElement(
    file: TFile,
    opts?: { skipReconcile?: boolean },
  ): Promise<void> {
    if (!this.ledger) return;
    try {
      let fm: Record<string, unknown> = {};
      await this.app.fileManager.processFrontMatter(file, (f) => {
        fm = { ...f };
      });
      const now = Date.now();
      const events = migrateNotes(
        [{ path: file.path, frontmatter: fm }],
        now,
      );
      let lamport = Math.max(now, await this.ledger.nextLamport());
      const device = await this.ledger.getDeviceId();
      for (const ev of events) {
        ev.lamport = lamport++;
        ev.device = device;
        await this.appendCreatedWithPlacement(ev);
      }
      if (opts?.skipReconcile) return;
      await this.ledger.reconcile();
      void this.refreshStatusBar();
    } catch (e) {
      console.error("Incremental Reading: recording element failed", e);
      new Notice(
        "Incremental Reading: could not record the new element in the " +
          "ledger; it is still in the note. See the developer console.",
      );
    }
  }

  /**
   * Migration controller (maintainer-owned; see docs/DESIGN.md "Integration").
   *
   * This is the one place that touches both worlds: it constructs the ledger
   * over the Obsidian data adapter, decides whether a migration is owed,
   * drives the *pure* `migrateNotes` transform with frontmatter read out of
   * `metadataCache`, and lands the result through the ledger's append +
   * reconcile path.
   *
   * Three invariants make this safe enough to run unattended on load, since
   * no mechanical oracle can gate a one-way data move:
   *
   * - Guarded / runs once. The presence of `.ir/meta.json` is the marker.
   *   `ledger.init()` writes it (with `device.json`) before any append, so a
   *   second load short-circuits here.
   * - Reversible. The controller itself never touches note frontmatter; the
   *   migrated log is written alongside under `.ir/`, never in place of
   *   anything. Post-cutover the ledger drives the queue, but every review
   *   action still dual-writes the old `ir-` keys, so frontmatter remains a
   *   complete, hand-readable fallback.
   * - Idempotent. `migrateNotes` derives element and event ids from the note
   *   path, so even if the marker were lost and this re-ran, the fold
   *   collapses the re-created elements to the identical state.
   *
    * A failure is reported and disables ledger-backed actions for this load.
    * Notes remain untouched, but continuing against a partial ledger could
    * compound storage damage.
   */
  private async runMigrationIfOwed(fs: ObsidianVaultFs): Promise<void> {
    const ledger = this.ledger;
    if (!ledger) return;
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
      const status = await withTimeout(
        ledger.status(),
        4000,
        "IrLedger.status",
      );
      if (status !== "absent") {
        // Still call init() so the per-host device.json resolution runs and
        // this machine's device id is stable for the session. init() is a
        // no-op for META in the already-initialized branch; it only touches
        // .ir/device.json.
        await withTimeout(
          ledger.initDevice({ hostname }),
          8000,
          "IrLedger.init",
        );
        return;
      }

      await withTimeout(
        ledger.initDevice({ hostname }),
        8000,
        "IrLedger.initDevice",
      );

      await this.awaitMetadataCacheReady();
      const notes = this.enumerateIrNotes();
      const mdFiles = this.app.vault.getMarkdownFiles();
      if (
        notes.length === 0 &&
        mdFiles.length > 0 &&
        mdFiles.some((f) => this.app.metadataCache.getFileCache(f) == null)
      ) {
        throw new Error(
          "Incremental Reading: metadataCache is not ready for first-run migration",
        );
      }
      const events = migrateNotes(notes, Date.now());
      await ledger.commitMigration(events);
      await ledger.reconcile();

      if (events.length > 0) {
        new Notice(
          `Incremental Reading: migrated ${events.length} element` +
            `${events.length === 1 ? "" : "s"} into the new ledger. ` +
            `Frontmatter is kept as a fallback.`,
        );
      }
    } catch (e) {
      console.error("Incremental Reading: migration failed", e);
      this.ledger = undefined;
      new Notice(
        "Incremental Reading: ledger initialization failed; IR actions are " +
          "disabled for this load. Your notes are untouched. See the developer console.",
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
  /**
   * Wait for workspace layout and `metadataCache` resolution before reading
   * cached frontmatter during first-run migration (#44).
   */
  async awaitMetadataCacheReady(timeoutMs = 15_000): Promise<void> {
    if (typeof this.app.workspace?.onLayoutReady === "function") {
      await new Promise<void>((resolve) => {
        this.app.workspace.onLayoutReady(() => resolve());
      });
    }
    const allCached = () => {
      const files = this.app.vault?.getMarkdownFiles?.() ?? [];
      if (files.length === 0) return true;
      return files.every((f) => this.app.metadataCache?.getFileCache?.(f) != null);
    };
    if (allCached()) return;
    const mc = this.app.metadataCache as unknown as {
      on?: (name: string, cb: () => void) => unknown;
      offref?: (ref: unknown) => void;
      off?: (name: string, cb: () => void) => void;
    };
    if (typeof mc?.on !== "function") return;
    await new Promise<void>((resolve) => {
      let settled = false;
      let ref: unknown;
      const finish = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        if (ref !== undefined && typeof mc.offref === "function") {
          mc.offref(ref);
        } else if (typeof mc.off === "function") {
          mc.off("resolved", onResolved);
        }
        resolve();
      };
      const onResolved = () => {
        finish();
      };
      const timer = window.setTimeout(finish, timeoutMs);
      ref = mc.on!("resolved", onResolved);
      if (allCached()) finish();
    });
  }

  /**
   * Guard `fileManager.trashFile` (1.6.6+) with a fallback to `vault.trash` (#46).
   */
  async trashFileSafe(file: TAbstractFile): Promise<void> {
    const fm = this.app.fileManager as unknown as {
      trashFile?: (f: TAbstractFile) => Promise<void>;
    } | undefined;
    if (typeof fm?.trashFile === "function") {
      await fm.trashFile(file);
      return;
    }
    await this.app.vault.trash(file, true);
  }

  /**
   * Guard `fileManager.getAvailablePathForAttachment` (1.5.7+) with a fallback
   * that picks a non-colliding sibling/root path (#46).
   */
  async getAvailableAttachmentPathSafe(
    filename: string,
    sourcePath?: string,
  ): Promise<string> {
    const fm = this.app.fileManager as unknown as {
      getAvailablePathForAttachment?: (
        name: string,
        src?: string,
      ) => Promise<string>;
    } | undefined;
    if (typeof fm?.getAvailablePathForAttachment === "function") {
      return fm.getAvailablePathForAttachment(filename, sourcePath);
    }
    const slash = sourcePath ? sourcePath.lastIndexOf("/") : -1;
    const dir = slash > 0 ? `${sourcePath!.slice(0, slash)}/` : "";
    const dot = filename.lastIndexOf(".");
    const stem = dot > 0 ? filename.slice(0, dot) : filename;
    const ext = dot > 0 ? filename.slice(dot) : "";
    const isTaken = async (candidate: string): Promise<boolean> => {
      if (this.app.vault?.getAbstractFileByPath?.(candidate)) return true;
      if (typeof this.app.vault?.adapter?.exists === "function") {
        return await this.app.vault.adapter.exists(candidate);
      }
      return false;
    };
    let candidate = `${dir}${filename}`;
    let n = 1;
    while (await isTaken(candidate)) {
      candidate = `${dir}${stem} ${n}${ext}`;
      n += 1;
    }
    return candidate;
  }

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
    this.settings = resolveSettings(saved);
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

  /** Apply unified Workspace FAB + legacy mobile chrome visibility immediately. */
  refreshMobileVisibility(): void {
    if (!Platform.isMobile) return;
    notifyWorkspaceFabSync();
    const inReview =
      this.app.workspace.activeLeaf?.view.getViewType() === IR_REVIEW_VIEW_TYPE;
    document
      .querySelector<HTMLElement>(".ir-mobile-shell")
      ?.toggleClass(
        "is-hidden",
        !mobileAuxiliaryChromeShouldShow(this.settings.mobileShell, inReview),
      );
    document
      .querySelector<HTMLElement>(".ir-mobile-capture-fab")
      ?.toggleClass(
        "is-hidden",
        !mobileAuxiliaryChromeShouldShow(this.settings.mobileCaptureFab, inReview),
      );
    document
      .querySelector<HTMLElement>(".ir-mobile-review-fab")
      ?.toggleClass(
        "is-hidden",
        !mobileAuxiliaryChromeShouldShow(this.settings.mobileReviewFab, inReview),
      );
  }

  /**
   * Rebuild the FSRS engine from settings (fitted parameters + desired
   * retention). Invalid stored parameters fall back to the defaults so
   * hand-edited plugin data can never brick grading.
   */
  applyEngineConfig(): void {
    const ok = configureEngine({
      w: this.settings.fsrsParams?.w,
      requestRetention: this.settings.desiredRetention,
    });
    if (!ok) {
      new Notice(
        "Incremental Reading: stored scheduler parameters are invalid; using FSRS-6 defaults.",
      );
    }
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
      const removed = await this.wipeIrState("reset");
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
          await this.trashFileSafe(file);
          trashed++;
        } catch (e) {
          console.error(
            "Incremental Reading: nuke could not trash",
            file.path,
            e,
          );
        }
      }

      const stateRemoved = await this.wipeIrState("empty");
      return { notesTrashed: trashed, stateRemoved };
    } finally {
      this.nuking = false;
    }
  }

  /**
   * Remove the `.ir/` state folder, drop the in-memory ledger, detach IR
   * leaves so they do not render against the now-empty ledger, then
   * re-initialise so subsequent commands work without a plugin reload.
   * Shared by the full nuke flow and the state-only reset flow.
   */
  private async wipeIrState(after: "reset" | "empty"): Promise<boolean> {
    const adapter = this.app.vault.adapter as unknown as ObsidianDataAdapter;
    try {
      if (await adapter.exists(".ir")) {
        await adapter.rmdir(".ir", true);
      }
    } catch (e) {
      console.error("Incremental Reading: could not remove .ir/", e);
      return false;
    }

    this.ledger = undefined;
    this.app.workspace.detachLeavesOfType(IR_TREE_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(IR_SESSION_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(IR_STATS_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(IR_HELP_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(IR_REVIEW_VIEW_TYPE);

    try {
      const fs = new ObsidianVaultFs(adapter);
      const ledger = new IrLedger(fs, { conflict: "clock-order" });
      this.ledger = ledger;
      const ledgerInit = (async () => {
        await ledger.initDevice({ hostname: getMachineHostname() });
        if (after === "reset") {
          await ledger.markReset();
        } else {
          await ledger.commitMigration([]);
        }
      })();
      this.ledgerInit = ledgerInit;
      ledger.setReadyBarrier(async () => {
        await ledgerInit;
        if (this.ledger !== ledger) {
          throw new Error("Incremental Reading: ledger initialization failed");
        }
      });
      await this.ledgerInit;
    } catch (e) {
      console.error("Incremental Reading: post-wipe ledger re-init failed", e);
      return false;
    }

    void this.refreshStatusBar();
    return true;
  }
}
