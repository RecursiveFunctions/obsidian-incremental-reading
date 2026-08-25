/**
 * Non-modal review surface: same card loop as ReviewModal, hosted in a
 * workspace leaf (Phase C2 of docs/SCOPE-MODAL-REMOVAL.md). Registration
 * lives in main.ts (C3).
 */

import {
  App,
  Component,
  ItemView,
  MarkdownRenderer,
  Menu,
  Notice,
  Platform,
  Scope,
  setIcon,
  TFile,
  WorkspaceLeaf,
} from "obsidian";
import {
  createClozeFromText,
  getIrType,
  quietFrontmatterWrite,
  setDismissed,
  setPriority,
  type IrNoteResult,
} from "./ir-note";
import {
  escapeClozeHtmlFragment,
  hasCloze,
  nextClozeNumber,
  spliceClozeIntoText,
  transformClozes,
} from "./cloze";
import {
  Grade,
  cardToStored,
  schedule,
  storedToCard,
  writeCardToFrontmatter,
} from "./fsrs";
import {
  advanceTopic,
  laterToday,
  newTopicState,
  writeTopicToFrontmatter,
  type TopicState,
} from "./topic";
import type { IrSettings } from "./settings";
import type { IrStore } from "./ir/store";
import { elementIdForPath, migrateNotes } from "./ir/migrate";
import {
  clampPriority,
  isReadType,
  type Anchor,
  type IrElement,
  type IrEventKind,
} from "./ir/model";
import { scheduleToTopicState, topicStateToSchedule } from "./ir/queue-adapter";
import {
  ancestorBreadcrumbLabel,
  ancestorChain,
  labelFor,
  reviewHeadlineLabel,
} from "./ir/labels";
import { buildExtractEvent, buildTextEditedEvent } from "./ir/extract";
import { newElementId, newEventId, type ElementId } from "./ir/ids";
import { neuralViaLabel } from "./ir/neural";
import { shouldShowReanchorBanner } from "./ir/tree-nav";
import type { ReviewSlot } from "./review";
import {
  contextSourceParentId,
  EMPTY_COLLECTION_COPY,
  sessionBarLabel,
  slotFromElement,
  upsertAfterCurrent,
} from "./review";
import { setBookmark, getBookmark, type BookmarkMap } from "./ir/bookmark";
import {
  applyScrollProgress,
  formatReadLabel,
  readScrollProgress,
  scrollFits,
} from "./ir/reading-progress";
import { findExtractRange } from "./ir/extract-range";
import { resolveAnchor } from "./ir/anchor";
import { spacebarReviewAction, isSpaceAfterReveal } from "./ir/review-keys";
import {
  buildTextQuoteAnchor,
  reviewSourceSplices,
  type SourceMarkKind,
  type SourceMarkRange,
} from "./ir/cloze-marks";
import { paintIrSourceMarksInElement } from "./ir/extract-reading-marks";
import {
  stripFrontmatter,
  saveBody,
  stripExtractMarks,
} from "./ir/frontmatter-body";
import { mapRenderedSelectionToRaw, locateTextInBody, SWITCH_TO_EDIT_COPY, mapRenderedCaretToRaw, caretOffsetInRendered, renderedPlainText, previewScrollNeedle, uniqueIndex, alignRawOffsetToRendered, textPointAtTextOffset, expandSelectionAroundLinks } from "./ir/selection-map";
import { shouldEnterEditFromPreviewGesture } from "./ir/preview-edit-gesture";
import {
  canUseReviewLivePreview,
  type ReviewEditorKind,
} from "./ir/review-live-preview";
import { escapeReviewAction } from "./ir/review-escape";
import {
  mountReviewLiveEditor,
  type ReviewLiveEditor,
} from "./ir/review-live-editor";
import { promptClozeHintInline } from "./cloze-hint-bar";
import { checkGradeDivergence, type DivergenceCheck } from "./ir/grade-divergence";
import {
  attachReviewSwipeGestures,
  reviewSwipeMode,
  type SwipeOutcome,
} from "./ir/review-touch-gestures";
import {
  findAllBlockquotes,
  findAllListItems,
  findAllParagraphs,
  findHeadingSectionAtOffset,
  findParagraphAtOffset,
  type Span,
} from "./ir/extract-spans";
import type { IrHubEntry } from "./ir-actions-radial";
import { resetMobileKeyboardBaseline } from "./ir/mobile-viewport";
import {
  applyMobileEditLayout,
  clearMobileEditLayout,
  isMobileEditViewportCompressed,
  resetMobileEditLayoutBaseline,
} from "./ir/mobile-edit-layout";
import { isPdfPath } from "./ir/pdf-fragment";
import { getPdfPageForPath, openPdfAt } from "./ir/pdf-view";

export const IR_REVIEW_VIEW_TYPE = "ir-review-view";

const IR_SWIPE_LEGEND_KEY = "incremental-reading:swipe-legend-seen";

const GRADES: { grade: Grade; label: string; key: string }[] = [
  { grade: "again", label: "Again", key: "1" },
  { grade: "hard", label: "Hard", key: "2" },
  { grade: "good", label: "Good", key: "3" },
  { grade: "easy", label: "Easy", key: "4" },
];

export class IrReviewView extends ItemView {
  private index = 0;
  private revealed = false;

  /** True when the body is shown as an editor (Live Preview, source, or textarea). */
  private editing = false;
  /** Live Preview vs raw markdown. Ignored when the textarea fallback is used. */
  private editKind: ReviewEditorKind = "live";
  /** Nested Live Preview for vault-backed markdown; parked across re-renders. */
  private liveEditor: ReviewLiveEditor | null = null;
  /** Per-card DOM host; `renderCard` empties this, not `contentEl`. */
  private cardHostEl?: HTMLElement;
  /** Mobile swipe hint overlay; sibling of `cardHostEl`, survives re-renders. */
  private swipeHintEl?: HTMLElement;
  private swipeGestureCleanup?: () => void;
  private mobileKeyboardCleanup?: () => void;
  private mobileOrientationCleanup?: () => void;
  /** Re-measures edit pane when the viewport or leaf size changes. */
  private mobileEditResizeObserver?: ResizeObserver;
  /** Working text for the current slot; updated live by the textarea. */
  private currentRaw = "";
  /** Last known on-disk body for the current slot (for dirty-check). */
  private rawOnDisk = "";
  /** Which slot id `currentRaw`/`rawOnDisk` correspond to, if any. */
  private loadedSlotId: ElementId | null = null;
  /** True if the current slot's source note is missing from the vault. */
  private bodyMissing = false;
  /** Open the PDF viewer once per slot so re-renders do not steal focus. */
  private pendingPdfOpen = false;

  /** Mobile-only: parent source panel is open (default collapsed = zero layout space). */
  private mobileSourceExpanded = false;

  /** Mobile-only: dismiss swipe coaching once the user has actually swiped.
   * Persisted in localStorage so the one-time Notice does not repeat. */
  private swipeLegendDismissed = false;

  /** Avoid showing the swipe coach Notice on every `renderCard` re-render. */
  private swipeCoachShownThisSession = false;

  /** Mobile: priority / A-Factor editors collapsed behind a chip until tapped. */
  private priorityMetaExpanded = false;

  /** Reading-position bookmarks loaded once on open, saved incrementally. */
  private bookmarks: BookmarkMap = {};
  /** False until loadBookmarks succeeds — onClose must not persist {}. */
  private bookmarksLoaded = false;
  /** In-dock success line; survives the next renderCard until it fades. */
  private pendingFlash: string | null = null;
  private flashClearTimer: number | null = null;

  /** Thin session chrome; sibling of cardHost so it survives card re-renders. */
  private sessionBarEl?: HTMLElement;
  /** True after the last card is graded/advanced; show complete state, don't detach. */
  private sessionComplete = false;
  /** Esc ended neural mid-pass (distinct copy from finishing the queue). */
  private neuralEndedEarly = false;
  /** Frozen label of the first card (neural seed / session identity). */
  private sessionSeedLabel = "";
  /** Latest source-context availability, for the mobile Source chip. */
  private hasSourceContext = false;
  /** User chose "From the top" on these reading cards; skip bookmark restore. */
  private resumeFromTop = new Set<ElementId>();
  /** After a failed preview-map, restore this range in the edit textarea. */
  private pendingEditSelection: { start: number; end: number } | null = null;
  /**
   * Body offset from click-to-edit. Survives `renderCard` so the nested
   * editor can land the caret there instead of the start of the note.
   */
  private clickToEditCaret: number | null = null;
  /** When true, resume-bookmark must not steal the click caret. */
  private skipBookmarkCursor = false;

  constructor(
    leaf: WorkspaceLeaf,
    /** Mirrors ReviewModal's Component; MarkdownRenderer uses `this` as Component. */
    private readonly plugin: Component,
    private settings: IrSettings,
    private store: IrStore,
    private queue: ReviewSlot[],
    /**
     * All elements indexed by id, used to render the parent-chain
     * breadcrumb (UI commitment #5). Passed in rather than re-derived so
     * the view does not need to touch the store mid-session.
     */
    private elementsById: Map<ElementId, IrElement>,
    private isNeural: boolean = false,
    /**
     * Fired after any state change (grade, advance, postpone, dismiss,
     * child created) and on close. Lets the host plugin refresh the queue
     * load indicator without this module knowing about it.
     */
    private onChange?: () => void,
    /** Opens the host plugin's IR quick-actions radial (Alt+Shift+U). */
    private readonly openIrHub?: () => void,
    /**
     * Fired whenever the visible slot changes. The host plugin forwards
     * the id to the IR tree view so it can highlight the user's current
     * position. `null` means the review pane closed.
     */
    private readonly onSlotChange?: (id: ElementId | null) => void,
    /** Refreshes workspace FAB visibility when edit mode toggles. */
    private readonly onMobileChromeChange?: () => void,
    /**
     * Retract the most recent grade event in the log. Returns the affected
     * element's id and a label for the toast, or `null` if there is
     * nothing to undo. Wired in by the host plugin so the review pane
     * doesn't need its own knowledge of `findLastUndoableGrade` /
     * `processFrontMatter`.
     */
    private readonly commitUndoLastGrade?: () => Promise<
      | {
          targetId: ElementId;
          targetLabel: string;
        }
      | null
    >,
    /**
     * Resolved body-relative ranges of every extract and cloze mark on the
     * given source path. Used by the review side panel (§Q3) to highlight
     * sibling extracts and already-clozed spans. The host plugin reads this
     * from the decoration cache, which is rebuilt after every reconcile.
     */
    private readonly getSourceExtractRanges?: (
      path: string,
    ) => ReadonlyArray<{
      start: number;
      end: number;
      text?: string;
      kind?: SourceMarkKind;
    }>,
    /**
     * Rebuild the host's decoration cache so a just-created extract is in
     * `getSourceExtractRanges` before the next `renderCard`. Without this
     * the cache refresh races the re-render and the new extract appears
     * unhighlighted in the main body until the next reconcile.
     */
    private readonly refreshDecorations?: () => Promise<void>,
    /**
     * Promote an anchored extract to a standalone note. Used when Settings
     * → Extract to standalone note is on, or when the caller passes
     * `{ promote: true }`.
     */
    private readonly commitPromoteExtract?: (
      id: ElementId,
      element: IrElement,
    ) => Promise<void>,
    /**
     * Workspace restore: this leaf exists with an empty queue. Return
     * today's due queue to adopt, or null so onOpen can detach the tab
     * instead of rendering a dead pane.
     */
    private readonly restoreEmptySession?: () => Promise<{
      queue: ReviewSlot[];
      elementsById: Map<ElementId, IrElement>;
      isNeural: boolean;
    } | null>,
    private readonly commitReanchor?: (
      id: ElementId,
      element: IrElement,
    ) => Promise<boolean>,
    private readonly commitDetachAnchor?: (
      id: ElementId,
      element: IrElement,
    ) => Promise<void>,
    /** End neural and start today's due queue (session-complete / Esc). */
    private readonly startOutstandingDue?: () => void,
    /** First-run: collection is empty — show onboarding, do not detach. */
    private readonly emptyVault: boolean = false,
    /**
     * PDF extract from the open viewer (Alt+X while reviewing a PDF topic
     * or extract). Returns undefined when nothing is selected in a PDF.
     */
    private readonly commitPdfExtract?: (opts?: {
      promote?: boolean;
    }) => Promise<IrElement | undefined>,
  ) {
    super(leaf);
  }

  /** Whether the review dock is on screen (FAB sits above it). */
  mobileFabAboveDock(): boolean {
    return !this.editing;
  }

  /** Layout root for FAB keyboard inset (review leaf bounds). */
  mobileFabLayoutRoot(): HTMLElement {
    return this.contentEl;
  }

  getViewType(): string {
    return IR_REVIEW_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "IR review";
  }

  getIcon(): string {
    return "graduation-cap";
  }

  async onOpen(): Promise<void> {
    if (this.queue.length === 0 && !this.emptyVault) {
      const restored = await this.restoreEmptySession?.();
      if (restored && restored.queue.length > 0) {
        this.queue = restored.queue;
        this.elementsById = restored.elementsById;
        this.isNeural = restored.isNeural;
      } else {
        window.setTimeout(() => this.leaf.detach(), 0);
        return;
      }
    }

    this.bookmarks = await this.store.loadBookmarks();
    this.bookmarksLoaded = true;
    this.sessionSeedLabel = this.queue[0]
      ? labelFor(this.queue[0].element)
      : "";
    this.contentEl.addClass("ir-review-modal");
    this.contentEl.addClass("ir-review-layout");
    this.sessionBarEl = this.contentEl.createDiv({
      cls: "ir-review-session-bar",
    });
    this.cardHostEl = this.contentEl.createDiv({ cls: "ir-review-card-host" });
    if (Platform.isMobile) {
      this.contentEl.addClass("ir-review--mobile");
      try {
        if (window.localStorage.getItem(IR_SWIPE_LEGEND_KEY) === "1") {
          this.swipeLegendDismissed = true;
        }
      } catch {
        // localStorage can be blocked or missing on niche WebViews; treat as
        // "show legend" and move on.
      }
      // CSS `@media (orientation: landscape)` is unreliable inside the
      // Obsidian webview on some devices (the height check at the heart of
      // the original landscape rule failed on roomier displays). Detect
      // landscape directly in JS and toggle a class instead.
      this.mobileOrientationCleanup = this.attachOrientationClass();
      this.swipeHintEl = this.contentEl.createDiv({
        cls: "ir-review-swipe-hint",
      });
      this.swipeGestureCleanup = attachReviewSwipeGestures(
        this.contentEl,
        this.swipeHintEl,
        {
          getMode: () => {
            const slot = this.current;
            if (!slot) return "reading";
            const reading = this.isReading(slot);
            const isCloze = !reading && hasCloze(this.currentRaw);
            return reviewSwipeMode(reading, isCloze, this.revealed);
          },
          isBlocked: () =>
            !this.current ||
            this.sessionComplete ||
            this.editing ||
            this.isTypingInInput(),
          onOutcome: (outcome) => this.handleSwipeOutcome(outcome),
        },
      );
      this.mobileKeyboardCleanup = this.attachMobileKeyboardGuard();
    }

    // Escape needs to go through Obsidian's keymap (Scope), not DOM keydown:
    // Obsidian's keymap dispatcher runs in document capture phase, so it
    // resolves Escape before our textarea/contentEl listeners get a chance,
    // and unbound Escape can close the active leaf. Registering on the view's
    // scope makes Escape ours whenever the review view is focused.
    // Live Preview also captures Escape on its host (see mountReviewLiveEditor)
    // because the nested MarkdownView can win the scope race.
    const scope = new Scope(this.app.scope);
    this.scope = scope;
    scope.register([], "Escape", (evt) => {
      evt.preventDefault();
      this.handleEscapeKey();
      return false;
    });

    this.registerDomEvent(this.contentEl, "keydown", (evt: KeyboardEvent) => {
      if (evt.key === "Escape") {
        evt.preventDefault();
        evt.stopPropagation();
        this.handleEscapeKey();
        return;
      }

      // Use `code` so Alt+X / Alt+Z work across layouts (Alt often changes `key`).
      if (
        evt.altKey &&
        !evt.shiftKey &&
        !evt.ctrlKey &&
        !evt.metaKey &&
        (evt.code === "KeyX" || evt.code === "KeyZ")
      ) {
        if (evt.code === "KeyX" && this.canMakeChild()) {
          evt.preventDefault();
          void this.handleExtract();
        } else if (evt.code === "KeyZ" && this.canMakeClozeChild()) {
          evt.preventDefault();
          void this.handleCloze();
        }
        return;
      }
      if (evt.altKey) return;

      const slot = this.current;
      const typing = this.isTypingInInput();

      // Ctrl+Enter / Cmd+Enter: advance reading elements even when editing.
      if (
        evt.code === "Enter" &&
        (evt.ctrlKey || evt.metaKey) &&
        slot &&
        this.isReading(slot)
      ) {
        evt.preventDefault();
        void this.next();
        return;
      }

      // Space: reading = Next; cloze = reveal, then configured grade.
      if (evt.key === " ") {
        if (!slot) return;
        const action = spacebarReviewAction({
          isReading: this.isReading(slot),
          revealed: this.revealed,
          typing,
          spaceAfterReveal: isSpaceAfterReveal(this.settings.spaceAfterReveal)
            ? this.settings.spaceAfterReveal
            : "good",
        });
        if (action.kind === "none") return;
        evt.preventDefault();
        if (action.kind === "next") void this.next();
        else if (action.kind === "reveal") {
          this.revealed = true;
          void this.renderCard();
        } else if (action.kind === "grade") {
          void this.grade(action.grade);
        }
        return;
      }
      // `[` / BracketLeft: go to prior queue item (session only; does not undo
      // schedules). Matches the Previous button; avoids Alt+P (global priority).
      if (
        evt.code === "BracketLeft" &&
        !evt.altKey &&
        !evt.ctrlKey &&
        !evt.metaKey
      ) {
        if (!typing) {
          evt.preventDefault();
          void this.previous();
        }
        return;
      }
      if (evt.key === "Enter") {
        if (slot && this.isReading(slot) && !typing) {
          evt.preventDefault();
          void this.next();
        }
        return;
      }

      // L / D: later today / dismiss. When editing, only fire with Ctrl held
      // so bare keystrokes still type into the textarea.
      if (evt.key === "l" || evt.key === "L") {
        if (slot && this.isReading(slot) && !typing) {
          evt.preventDefault();
          void this.later();
        }
        return;
      }
      if (evt.key === "d" || evt.key === "D") {
        if (this.current && !typing) {
          evt.preventDefault();
          void this.dismiss();
        }
        return;
      }

      // 1-4 grade keys: work on revealed cloze items even when editing, since
      // grading is the primary action and typing digits in the source during
      // review is not the expected flow.
      for (const { grade, key } of GRADES) {
        if (evt.key === key) {
          if (slot && !this.isReading(slot) && this.revealed) {
            evt.preventDefault();
            void this.grade(grade);
          }
          return;
        }
      }
    });

    this.contentEl.tabIndex = -1;
    this.contentEl.focus();

    await this.renderCard();
  }

  async onClose(): Promise<void> {
    if (this.flashClearTimer != null) {
      window.clearTimeout(this.flashClearTimer);
      this.flashClearTimer = null;
    }
    this.captureBookmark();
    await this.flushEdits();
    this.teardownLiveEditorSync();
    this.swipeGestureCleanup?.();
    this.swipeGestureCleanup = undefined;
    this.mobileKeyboardCleanup?.();
    this.mobileKeyboardCleanup = undefined;
    this.mobileOrientationCleanup?.();
    this.mobileOrientationCleanup = undefined;
    this.swipeHintEl = undefined;
    this.sessionBarEl = undefined;
    this.cardHostEl = undefined;
    this.contentEl.empty();
    this.onSlotChange?.(null);
    if (!this.bookmarksLoaded) {
      this.onChange?.();
      return;
    }
    void this.persistBookmarks()
      .then(() => this.store.reconcile())
      .catch((e) => {
        console.error("Incremental Reading: reconcile after review failed", e);
      })
      .finally(() => this.onChange?.());
  }

  private get current(): ReviewSlot | undefined {
    return this.queue[this.index];
  }

  /** Element id under review right now, or null if the queue is empty. */
  getCurrentElementId(): ElementId | null {
    return this.current?.id ?? null;
  }

  /**
   * Parent for a new PDF extract: the card under review when it belongs to
   * this PDF's tree, otherwise null so the host uses the PDF topic.
   */
  pdfExtractParentId(pdfPath: string): ElementId | null {
    const slot = this.current;
    if (!slot || !this.isReading(slot)) return null;
    if (this.pdfSourcePath(slot) === pdfPath) return slot.id;
    return null;
  }

  /**
   * Anchored extract currently under review, if it has not been promoted
   * to a standalone note yet. Used by the Promote command.
   */
  getCurrentExtractForPromote(): {
    id: ElementId;
    element: IrElement;
  } | null {
    const slot = this.current;
    if (!slot) return null;
    if (slot.element.type !== "extract" || slot.element.notePath) return null;
    return { id: slot.id, element: slot.element };
  }

  /** A reading element (topic/extract) is read and advanced, never graded. */
  private isReading(slot: ReviewSlot): boolean {
    return isReadType(slot.element.type);
  }

  /**
   * Mobile swipe on the card body (Option B). Pre-reveal: navigate / show
   * answer. Post-reveal: grade cardinals. Reading: prev / next only.
   */
  /**
   * Keep the edit textarea above the on-screen keyboard. Uses
   * `visualViewport` when available (iOS/Android WebView) and scrolls the
   * card column so the caret stays visible while selecting text.
   */
  /**
   * Toggle `.ir-review--landscape` based on the actual window aspect.
   * Drives the compact landscape dock without relying on CSS media queries,
   * which proved flaky in the Obsidian webview across devices (the original
   * `max-height: 500px` gate failed on phones with 510+ CSS px landscape
   * height, leaving the portrait stack in place).
   */
  private attachOrientationClass(): () => void {
    const update = () => {
      const landscape = window.innerWidth > window.innerHeight;
      this.contentEl.toggleClass("ir-review--landscape", landscape);
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      this.contentEl.removeClass("ir-review--landscape");
    };
  }

  private attachMobileKeyboardGuard(): () => void {
    const vv = window.visualViewport;
    const adjust = () => {
      if (!this.editing) return;
      this.syncMobileEditChrome();
    };
    if (vv) {
      vv.addEventListener("resize", adjust);
      vv.addEventListener("scroll", adjust);
    }
    window.addEventListener("resize", adjust);
    return () => {
      if (vv) {
        vv.removeEventListener("resize", adjust);
        vv.removeEventListener("scroll", adjust);
      }
      window.removeEventListener("resize", adjust);
      this.detachMobileEditResizeObserver();
      this.clearMobileEditPaneLayout();
    };
  }

  private attachMobileEditResizeObserver(): void {
    if (!Platform.isMobile || typeof ResizeObserver === "undefined") return;
    this.detachMobileEditResizeObserver();
    this.mobileEditResizeObserver = new ResizeObserver(() => {
      if (this.editing) this.syncMobileEditChrome();
    });
    if (this.cardHostEl) {
      this.mobileEditResizeObserver.observe(this.cardHostEl);
    }
    this.mobileEditResizeObserver.observe(this.contentEl);
  }

  private detachMobileEditResizeObserver(): void {
    this.mobileEditResizeObserver?.disconnect();
    this.mobileEditResizeObserver = undefined;
  }

  private syncMobileEditChrome(): void {
    this.contentEl.toggleClass("ir-review--editing", this.editing);
    if (!Platform.isMobile) return;
    if (this.editing) {
      this.layoutMobileEditPane();
    } else {
      this.detachMobileEditResizeObserver();
      this.clearMobileEditPaneLayout();
    }
    this.onMobileChromeChange?.();
  }

  /** Size edit UI from layout-root bounds every frame — vv alone lies on Android. */
  private layoutMobileEditPane(): void {
    if (!Platform.isMobile || !this.editing || !this.cardHostEl) return;

    applyMobileEditLayout(this.cardHostEl, this.contentEl);
    this.contentEl.toggleClass(
      "ir-review--keyboard-open",
      isMobileEditViewportCompressed(this.contentEl),
    );
  }

  private clearMobileEditPaneLayout(): void {
    if (this.cardHostEl) clearMobileEditLayout(this.cardHostEl);
    this.contentEl.removeClass("ir-review--keyboard-open");
    resetMobileEditLayoutBaseline();
  }

  private scrollTextareaCaretIntoView(ta: HTMLTextAreaElement): void {
    const pos = ta.selectionStart ?? 0;
    const lineHeight =
      parseFloat(getComputedStyle(ta).lineHeight) ||
      parseFloat(getComputedStyle(ta).fontSize) * 1.4 ||
      22;
    const lineIndex = ta.value.slice(0, pos).split("\n").length - 1;
    const caretY = lineIndex * lineHeight;
    const margin = lineHeight * 1.5;
    const viewTop = ta.scrollTop;
    const viewBottom = viewTop + ta.clientHeight;

    if (caretY < viewTop + margin) {
      ta.scrollTop = Math.max(0, caretY - margin);
    } else if (caretY + lineHeight > viewBottom - margin) {
      ta.scrollTop = caretY + lineHeight - ta.clientHeight + margin;
    }
  }

  private adjustReviewPaneForKeyboard(): void {
    if (!Platform.isMobile || !this.editing) return;
    this.layoutMobileEditPane();
    this.onMobileChromeChange?.();

    const ta = this.cardHostEl?.querySelector<HTMLTextAreaElement>(
      ".ir-review-textarea",
    );
    if (!ta || !isMobileEditViewportCompressed(this.contentEl)) return;
    this.scrollTextareaCaretIntoView(ta);
  }

  /**
   * Mobile edit mode: Preview lives in a top bar (native Done/check pattern),
   * not a bottom dock that fights the gesture nav and Obsidian's floating bar.
   */
  private renderMobileEditDock(host: HTMLElement): void {
    const topbar = host.createDiv({ cls: "ir-review-edit-topbar" });
    this.renderEditToggle(topbar);

    const dock = host.createDiv({
      cls: "ir-review-dock ir-review-dock--edit-mobile",
    });
    const bar = dock.createEl("div", {
      cls: "ir-review-buttons ir-review-buttons--edit-mobile",
    });
    this.renderChildButtons(bar);
  }

  private handleSwipeOutcome(outcome: SwipeOutcome): void {
    if (!this.swipeLegendDismissed) {
      this.swipeLegendDismissed = true;
      try {
        window.localStorage.setItem(IR_SWIPE_LEGEND_KEY, "1");
      } catch {
        // Best-effort: in-memory dismissal still applies for the session.
      }
    }
    if (outcome.kind === "nav") {
      if (outcome.action === "previous") {
        void this.previous();
        return;
      }
      if (outcome.action === "next") {
        void this.next();
        return;
      }
      this.revealed = true;
      void this.renderCard();
      return;
    }
    void this.grade(outcome.grade);
  }

  /** Whether typing characters should go to the editor, not to hotkeys. */
  private isTypingInInput(): boolean {
    const active = this.contentEl.ownerDocument.activeElement;
    if (this.liveEditor?.contains(active)) return true;
    return (
      active instanceof HTMLTextAreaElement ||
      active instanceof HTMLInputElement
    );
  }

  /**
   * Cloze items reveal the answer in raw form, so editing or making children
   * from them before reveal would leak it. Topics and extracts have no such
   * gate.
   */
  private canEdit(): boolean {
    const slot = this.current;
    if (!slot || this.bodyMissing) return false;
    if (slot.file && isPdfPath(slot.file.path)) return false;
    // Anchored elements (no backing file) edit through a "text-edited" store
    // event; file-backed elements edit through `saveBody`. Both paths are
    // wired through `flushEdits`.
    if (this.isReading(slot)) return true;
    return this.revealed;
  }

  /**
   * Extract and cloze creation share an extra constraint with edit: the
   * source must be a topic or extract (items cannot have children), and for
   * items we'd be back to leaking the answer.
   *
   * File-backed topics/extracts are the common case. Anchored extracts (store
   * body, no `notePath`) still need children: resolve a vault note for
   * provenance (`buildExtractEvent.sourcePath`) and for cloze placement +
   * migration (`createChildNote`).
   */
  private canMakeChild(): boolean {
    const slot = this.current;
    if (!slot || this.bodyMissing || !this.isReading(slot)) return false;
    if (this.pdfSourcePath(slot)) return true;
    if (slot.file) return true;
    const body = slot.element.text?.trim() ?? "";
    if (!body) return false;
    return (
      this.resolveProvenanceSourcePath(slot) !== null &&
      this.resolvePlacementFile(slot) !== null
    );
  }

  /**
   * Like {@link canMakeChild} but also allows creating a *sibling* cloze
   * from a revealed cloze item: the new note is placed under the item's
   * ir-parent reading source, mirroring the editor-mode "new cloze from
   * item" path. Gated on `revealed` so the answer is not still hidden when
   * the user picks a span.
   */
  private canMakeClozeChild(): boolean {
    if (this.current && this.pdfSourcePath(this.current)) return false;
    if (this.canMakeChild()) return true;
    const slot = this.current;
    if (!slot || this.bodyMissing) return false;
    if (slot.element.type !== "item" || !this.revealed) return false;
    return this.resolvePlacementFile(slot) !== null;
  }

  /** First vault path on the ancestor chain (for anchor provenance). */
  private resolveProvenanceSourcePath(slot: ReviewSlot): string | null {
    let cur: IrElement | undefined = slot.element;
    const seen = new Set<ElementId>();
    while (cur) {
      if (seen.has(cur.id)) break;
      seen.add(cur.id);
      if (cur.notePath) return cur.notePath;
      if (!cur.parentId) break;
      cur = this.elementsById.get(cur.parentId);
    }
    return slot.element.anchor?.sourcePath ?? null;
  }

  /** Vault path of the PDF this card was extracted from, if any. */
  private pdfSourcePath(slot: ReviewSlot): string | null {
    if (slot.file && isPdfPath(slot.file.path)) return slot.file.path;
    if (slot.element.anchor?.pdf) return slot.element.anchor.sourcePath;
    const p = this.resolveProvenanceSourcePath(slot);
    return p && isPdfPath(p) ? p : null;
  }

  /**
   * Nearest vault-backed topic/extract file for operations that still create
   * a real `.md` (cloze items) or validate IR frontmatter.
   */
  private resolvePlacementFile(slot: ReviewSlot): TFile | null {
    let cur: IrElement | undefined = slot.element;
    const seen = new Set<ElementId>();
    while (cur) {
      if (seen.has(cur.id)) break;
      seen.add(cur.id);
      if (cur.notePath) {
        const af = this.app.vault.getAbstractFileByPath(cur.notePath);
        if (af instanceof TFile) {
          const t = getIrType(this.app, af);
          if (t === "topic" || t === "extract") return af;
        }
      }
      if (!cur.parentId) break;
      cur = this.elementsById.get(cur.parentId);
    }
    return null;
  }

  /** Append a store event for the current element's state change. */
  private async emit(
    kind: IrEventKind,
    target: ElementId,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.store.appendEvent({
      id: newEventId(),
      ts: Date.now(),
      // Live single-device events sort after the small migration lamports and
      // among themselves by wall clock; ties break on the unique event id.
      lamport: Date.now(),
      device: await this.store.getDeviceId(),
      kind,
      target,
      payload,
    });
  }

  /**
   * Button copy: desktop keeps hotkey hints; mobile omits them (no hardware
   * keyboard by default, and labels stay readable on narrow screens).
   */
  private labelWithHotkey(base: string, hint: string): string {
    return Platform.isMobile ? base : `${base} (${hint})`;
  }

  /** Hide hub when Extract/Cloze already sit in the dock, or on mobile (FAB). */
  private shouldShowHubInDock(): boolean {
    if (!this.openIrHub || Platform.isMobile) return false;
    const slot = this.current;
    if (
      slot &&
      this.isReading(slot) &&
      (this.canMakeChild() || this.canMakeClozeChild())
    ) {
      return false;
    }
    return true;
  }

  private maybeShowSwipeCoachMark(slot: ReviewSlot): void {
    if (
      !Platform.isMobile ||
      this.swipeLegendDismissed ||
      this.swipeCoachShownThisSession
    ) {
      return;
    }
    this.swipeCoachShownThisSession = true;
    const reading = this.isReading(slot);
    const clozeHint =
      !reading && hasCloze(this.currentRaw) && !this.revealed;
    const text = reading
      ? "Swipe the card: ← previous · → or ↑ next"
      : clozeHint
        ? "Swipe the card: ← previous · → next · ↑ show answer"
        : "Swipe the card: ← Again · ↓ Hard · → Good · ↑ Easy";
    new Notice(`Incremental Reading: ${text}`, 8000);
  }

  private renderHubButton(parent: HTMLElement): void {
    if (!this.shouldShowHubInDock()) return;
    const hubRow = parent.createDiv({ cls: "ir-review-hub-row" });
    const hubBtn = hubRow.createEl("button", {
      text: "Quick actions",
      cls: "ir-review-hub-btn",
      type: "button",
      attr: {
        "aria-label":
          "IR quick actions radial (same as Alt+Shift+U). Shows cloze, split, or fork when your card matches.",
        title:
          "IR radial: new cloze / split / fork when this context supports it (Alt+Shift+U)",
      },
    });
    hubBtn.addEventListener("click", () => this.openIrHub?.());
  }

  private renderOverflowButton(
    parent: HTMLElement,
    items: { label: string; disabled?: boolean; run: () => void }[],
  ): void {
    if (items.length === 0) return;
    const btn = parent.createEl("button", {
      cls: "ir-review-overflow-btn",
      type: "button",
      attr: { "aria-label": "More review actions" },
    });
    setIcon(btn, "more-horizontal");
    btn.addEventListener("click", (ev) => {
      const menu = new Menu();
      for (const item of items) {
        menu.addItem((mi) =>
          mi
            .setTitle(item.label)
            .setDisabled(!!item.disabled)
            .onClick(() => item.run()),
        );
      }
      menu.showAtMouseEvent(ev);
    });
  }

  private readingOverflowItems(): {
    label: string;
    disabled?: boolean;
    run: () => void;
  }[] {
    const items: { label: string; disabled?: boolean; run: () => void }[] =
      [];
    if (this.canEdit()) {
      const liveOk = canUseReviewLivePreview(
        this.current?.file,
        Platform.isMobile,
      );
      if (this.editing) {
        items.push({
          label: "Preview",
          run: () => this.exitEdit(),
        });
        if (liveOk) {
          items.push(
            this.editKind === "source"
              ? {
                  label: "Live Preview",
                  run: () => this.enterEdit("live"),
                }
              : {
                  label: "Source",
                  run: () => this.enterEdit("source"),
                },
          );
        }
      } else {
        items.push({
          label: "Edit",
          run: () => this.enterEdit("live"),
        });
        if (liveOk) {
          items.push({
            label: "Source",
            run: () => this.enterEdit("source"),
          });
        }
      }
    }
    items.push({
      label: this.labelWithHotkey("Previous", "["),
      disabled: this.index === 0,
      run: () => void this.previous(),
    });
    items.push({
      label: this.labelWithHotkey("Later today", "L"),
      run: () => void this.later(),
    });
    items.push({
      label: this.labelWithHotkey("Dismiss", "D"),
      run: () => void this.dismiss(),
    });
    return items;
  }

  private gradeOverflowItems(): {
    label: string;
    disabled?: boolean;
    run: () => void;
  }[] {
    const items: { label: string; disabled?: boolean; run: () => void }[] =
      [];
    items.push({
      label: this.labelWithHotkey("Previous", "["),
      disabled: this.index === 0,
      run: () => void this.previous(),
    });
    if (this.canEdit()) {
      const liveOk = canUseReviewLivePreview(
        this.current?.file,
        Platform.isMobile,
      );
      if (this.editing) {
        items.push({
          label: "Done editing",
          run: () => this.exitEdit(),
        });
        if (liveOk) {
          items.push(
            this.editKind === "source"
              ? {
                  label: "Live Preview",
                  run: () => this.enterEdit("live"),
                }
              : {
                  label: "Source",
                  run: () => this.enterEdit("source"),
                },
          );
        }
      } else {
        items.push({
          label: "Edit",
          run: () => this.enterEdit("live"),
        });
        if (liveOk) {
          items.push({
            label: "Source",
            run: () => this.enterEdit("source"),
          });
        }
      }
    }
    items.push({
      label: this.labelWithHotkey("Dismiss", "D"),
      run: () => void this.dismiss(),
    });
    if (this.commitUndoLastGrade) {
      items.push({
        label: "Undo last grade",
        run: () => void this.tryUndoLastGrade(),
      });
    }
    return items;
  }

  /** Compact priority editor; reordering is a first-class IR action. */
  private renderPriorityRow(parent: HTMLElement, slot: ReviewSlot) {
    if (Platform.isMobile && !this.priorityMetaExpanded) {
      const chip = parent.createEl("button", {
        cls: "ir-priority-chip",
        type: "button",
      });
      const parts = [`P ${slot.element.priority}`];
      if (this.isReading(slot) && slot.element.schedule) {
        const a = Math.round(slot.element.schedule.aFactor * 100) / 100;
        parts.push(`A ${a}`);
      }
      chip.setText(parts.join(" · "));
      chip.setAttr("aria-label", "Priority and A-Factor — tap to edit");
      chip.addEventListener("click", () => {
        this.priorityMetaExpanded = true;
        void this.renderCard();
      });
      return;
    }

    const wrap = parent.createDiv({ cls: "ir-priority-meta" });
    if (Platform.isMobile) {
      wrap
        .createEl("button", {
          cls: "ir-priority-collapse",
          type: "button",
          text: "Done",
        })
        .addEventListener("click", () => {
          this.priorityMetaExpanded = false;
          void this.renderCard();
        });
    }
    this.renderPriorityInputs(wrap, slot);
  }

  private renderPriorityInputs(parent: HTMLElement, slot: ReviewSlot) {
    const row = parent.createEl("div", { cls: "ir-priority-row" });
    row.createEl("span", { text: "Priority" });
    const input = row.createEl("input", { cls: "ir-priority-input" });
    input.type = "number";
    input.min = "0";
    input.max = "100";
    input.step = "1";
    input.value = String(slot.element.priority);
    const commit = async () => {
      const n = Number(input.value);
      if (!Number.isFinite(n)) return;
      await this.emit("priority-set", slot.id, { priority: n });
      slot.element = { ...slot.element, priority: clampPriority(n) };
      if (slot.file) {
        await quietFrontmatterWrite(
          () => setPriority(this.app, slot.file!, n).then(() => undefined),
          "priority",
        );
      }
    };
    input.addEventListener("change", () => void commit());
    row.createEl("span", {
      cls: "ir-priority-hint",
      text: "0 = most important",
    });

    if (this.isReading(slot) && slot.element.schedule) {
      this.renderAFactorRow(parent, slot);
    }
  }

  private renderAFactorRow(parent: HTMLElement, slot: ReviewSlot) {
    const sched = slot.element.schedule;
    if (!sched) return;

    const row = parent.createEl("div", { cls: "ir-priority-row" });
    row.createEl("span", { text: "A-Factor" });
    const input = row.createEl("input", { cls: "ir-priority-input" });
    input.type = "number";
    input.min = "1.1";
    input.max = "10";
    input.step = "0.1";
    input.value = String(Math.round(sched.aFactor * 100) / 100);
    const commit = async () => {
      const n = Number(input.value);
      if (!Number.isFinite(n) || n <= 1) return;
      const clamped = Math.min(10, Math.max(1.1, n));
      const newSchedule = { ...sched, aFactor: clamped };
      await this.emit("topic-advanced", slot.id, { schedule: newSchedule });
      slot.element = {
        ...slot.element,
        schedule: newSchedule,
      };
    };
    input.addEventListener("change", () => void commit());
    row.createEl("span", {
      cls: "ir-priority-hint",
      text: "interval multiplier",
    });
  }

  /**
   * Load the current slot's body from disk on first sight, and reset edit
   * state. Re-renders of the same slot (e.g., after pressing Show answer or
   * toggling edit) reuse `currentRaw` so unsaved edits survive.
   */
  private async ensureLoaded(slot: ReviewSlot): Promise<void> {
    if (this.loadedSlotId === slot.id) return;
    this.priorityMetaExpanded = false;
    this.pendingPdfOpen = true;
    this.skipBookmarkCursor = false;
    if (slot.file && isPdfPath(slot.file.path)) {
      this.rawOnDisk = slot.element.text
        ? stripExtractMarks(slot.element.text)
        : "";
      this.bodyMissing = false;
    } else if (slot.file) {
      this.rawOnDisk = stripFrontmatter(
        await this.app.vault.cachedRead(slot.file),
      );
      this.bodyMissing = false;
    } else if (slot.element.text) {
      // Strip any `<mark class="ir-extract-source">` chrome that may have
      // leaked into the stored text for extracts created before the
      // creation-time strip landed. Without this, the chrome renders as
      // escaped HTML in the body and breadcrumb.
      this.rawOnDisk = stripExtractMarks(slot.element.text);
      this.bodyMissing = false;
    } else {
      this.rawOnDisk =
        "_The source note for this element is no longer in the vault._";
      this.bodyMissing = true;
    }
    this.currentRaw = this.rawOnDisk;
    this.loadedSlotId = slot.id;
    // Reading topics/extracts: start in rendered markdown (same pipeline as
    // Preview). **Edit** or a click on the card body (outside links) opens
    // Live Preview for vault notes. **Source** opens raw markdown. Store-only
    // extracts and phones use a textarea. Extract/cloze from the preview use
    // DOM selection → source offsets; if that map fails we switch to Source
    // and keep the selection.
    this.editing = false;
  }

  /**
   * Parent note body or stored parent text for the side column (UI
   * commitment #2 — source context in the same review surface).
   * When the current element has an anchor or verbatim text that can be
   * located in the source, `highlightRange` marks the span to highlight.
   */
  private async loadSourceContext(
    slot: ReviewSlot,
  ): Promise<{
    title: string;
    raw: string;
    path: string;
    highlightRange?: { start: number; end: number };
    /**
     * All OTHER extract anchor ranges in `raw` from the same source — i.e.
     * siblings of the focused card. Clozes use `ir-cloze-source`; extracts
     * use `ir-extract-source`.
     */
    siblingRanges: ReadonlyArray<SourceMarkRange>;
    pdf?: {
      path: string;
      page: number;
      selection?: [number, number, number, number];
    };
  } | null> {
    const pdfPath = this.pdfSourcePath(slot);
    if (pdfPath) {
      const pdfSel = slot.element.anchor?.pdf;
      const bm = getBookmark(this.bookmarks, slot.id);
      return {
        title: labelFor(
          this.elementsById.get(
            contextSourceParentId(slot.element, this.elementsById) ?? slot.id,
          ) ?? slot.element,
        ),
        raw: "",
        path: pdfPath,
        siblingRanges: [],
        pdf: {
          path: pdfPath,
          page: pdfSel?.page ?? bm?.page ?? 1,
          selection: pdfSel?.selection,
        },
      };
    }
    const pid = contextSourceParentId(slot.element, this.elementsById);
    if (!pid) return null;
    const parent = this.elementsById.get(pid);
    if (!parent) return null;
    let raw: string | null = null;
    let path = "";
    if (parent.notePath) {
      const af = this.app.vault.getAbstractFileByPath(parent.notePath);
      if (af instanceof TFile) {
        raw = stripFrontmatter(await this.app.vault.cachedRead(af));
        path = parent.notePath;
      }
    }
    if (raw === null) {
      const t = parent.text.trim();
      if (t.length === 0) return null;
      raw = t;
      path = slot.file?.path ?? parent.notePath ?? "";
    }

    const highlightRange = findExtractRange(slot.element, raw);
    // Decoration cache stores body-relative resolved ranges; drop the
    // focused extract so we can re-add it as the highlight class. Cloze
    // marks that share those offsets stay — they paint as ir-cloze-source.
    const allRanges = path
      ? this.sourceMarksForPath(path)
      : [];
    const siblingRanges = highlightRange
      ? allRanges.filter(
          (r) =>
            r.kind === "cloze" ||
            !(
              r.start === highlightRange.start && r.end === highlightRange.end
            ),
        )
      : allRanges;
    return {
      title: labelFor(parent),
      raw,
      path,
      highlightRange,
      siblingRanges,
    };
  }


  /**
   * The scrollport that actually moves: CodeMirror while Live Preview is
   * open, the textarea on phone/store-only, otherwise the reading pane.
   */
  private readingScroller(): HTMLElement | null {
    const live = this.liveEditor?.getScroller();
    if (live) return live;
    const ta = this.contentEl.querySelector<HTMLTextAreaElement>(
      ".ir-review-textarea",
    );
    if (ta) return ta;
    return this.contentEl.querySelector<HTMLElement>(
      ".ir-review-main-col .ir-review-scroll",
    );
  }

  /**
   * Snapshot the current scroll position and cursor for the active reading
   * slot. No-op for non-reading elements (items have no meaningful position
   * to resume). Returns silently when nothing is visible yet.
   *
   * Reader and editor use different scroll elements, so we store a 0–1
   * `progress` fraction and apply it to whichever view is showing.
   */
  private captureBookmark(): void {
    const slot = this.current;
    if (!slot || !this.isReading(slot)) return;

    const prev = getBookmark(this.bookmarks, slot.id);
    let charOffset = prev?.line ?? 0;
    const live = this.liveEditor;
    if (live) {
      charOffset = live.getCaretOffset();
    } else {
      const ta = this.contentEl.querySelector<HTMLTextAreaElement>(
        ".ir-review-textarea",
      );
      if (ta) charOffset = ta.selectionStart ?? 0;
    }

    const parked = !!(live && !live.hostEl.isConnected);
    const scroller = parked ? null : this.readingScroller();
    const progress = scroller
      ? readScrollProgress(scroller)
      : (prev?.progress ?? 0);
    const scrollTop = scroller?.scrollTop ?? prev?.scrollTop ?? 0;

    const pdfPath = this.pdfSourcePath(slot);
    const pdfPage = pdfPath ? getPdfPageForPath(this.app, pdfPath) : null;

    this.bookmarks = setBookmark(this.bookmarks, {
      elementId: slot.id,
      line: charOffset,
      ch: 0,
      scrollTop,
      progress,
      updatedAt: Date.now(),
      ...(pdfPage != null ? { page: pdfPage } : {}),
    });
  }

  /**
   * After the DOM for a reading slot has been painted, restore the
   * previously-saved scroll position (and cursor when editing). A click
   * into the preview wins over the bookmark so the caret stays where
   * the user clicked.
   */
  private restoreBookmark(slot: ReviewSlot): void {
    if (!this.isReading(slot)) return;
    if (this.resumeFromTop.has(slot.id)) return;
    if (this.skipBookmarkCursor) {
      this.skipBookmarkCursor = false;
      return;
    }
    const bm = getBookmark(this.bookmarks, slot.id);
    if (!bm) return;

    requestAnimationFrame(() => {
      if (this.skipBookmarkCursor) {
        this.skipBookmarkCursor = false;
        return;
      }
      const scroll = this.contentEl.querySelector<HTMLElement>(
        ".ir-review-main-col .ir-review-scroll",
      );
      const hasProgress = typeof bm.progress === "number";

      if (this.editing) {
        const apply = () => {
          if (this.liveEditor) {
            if (hasProgress) this.liveEditor.setScrollProgress(bm.progress!);
            if (bm.line > 0) {
              this.liveEditor.setSelection(bm.line, bm.line, { scroll: !hasProgress });
            }
            return;
          }
          const ta = this.contentEl.querySelector<HTMLTextAreaElement>(
            ".ir-review-textarea",
          );
          if (ta) {
            if (hasProgress) applyScrollProgress(ta, bm.progress!);
            else ta.scrollTop = bm.scrollTop;
            if (bm.line > 0) {
              const pos = Math.min(bm.line, ta.value.length);
              ta.setSelectionRange(pos, pos);
            }
          }
        };
        apply();
        requestAnimationFrame(() => {
          apply();
          requestAnimationFrame(apply);
        });
        return;
      }

      if (hasProgress && scroll) {
        applyScrollProgress(scroll, bm.progress!);
        return;
      }
      if (bm.line > 0 && this.scrollPreviewToBodyOffset(scroll, bm.line)) {
        return;
      }
      if (scroll) scroll.scrollTop = bm.scrollTop;
    });
  }

  /**
   * Scroll the reading preview so `rawOffset` in the markdown body is in view.
   * Editor `scrollTop` is not the same viewport as preview `scrollTop`.
   */
  private scrollPreviewToBodyOffset(
    scroll: HTMLElement | null,
    rawOffset: number,
  ): boolean {
    if (!scroll) return false;
    const body = scroll.querySelector<HTMLElement>(".ir-review-main-body");
    if (!body) return false;
    const plain = body.textContent ?? "";
    if (!plain) return false;

    let renderedOff: number | null = null;
    const needle = previewScrollNeedle(this.currentRaw, rawOffset);
    if (needle) renderedOff = uniqueIndex(plain, needle);
    if (renderedOff == null) {
      renderedOff = alignRawOffsetToRendered(plain, this.currentRaw, rawOffset);
    }
    const point = textPointAtTextOffset(body, renderedOff);
    if (!point) return false;
    const el =
      point.node.parentElement ??
      (point.node.parentNode instanceof HTMLElement
        ? point.node.parentNode
        : null);
    if (!el) return false;
    const sRect = scroll.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    scroll.scrollTop += eRect.top - sRect.top - Math.min(72, scroll.clientHeight * 0.2);
    return true;
  }

  private placeEditorCaret(clickPos: number): void {
    if (this.liveEditor) {
      this.liveEditor.setSelection(clickPos, clickPos);
      return;
    }
    const ta = this.contentEl.querySelector<HTMLTextAreaElement>(
      ".ir-review-textarea",
    );
    if (!ta) return;
    const pos = Math.min(clickPos, ta.value.length);
    ta.setSelectionRange(pos, pos);
    const line = ta.value.slice(0, pos).split("\n").length;
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20;
    ta.scrollTop = Math.max(0, (line - 4) * lh);
  }

  private async maybeOpenPdfSource(slot: ReviewSlot): Promise<void> {
    if (!this.pendingPdfOpen) return;
    this.pendingPdfOpen = false;
    const path = this.pdfSourcePath(slot);
    if (!path) return;
    const pdf = slot.element.anchor?.pdf;
    const bm = getBookmark(this.bookmarks, slot.id);
    const page = pdf?.page ?? bm?.page ?? 1;
    await openPdfAt(this.app, path, page, pdf?.selection);
  }

  private async persistBookmarks(): Promise<void> {
    try {
      await this.store.saveBookmarks(this.bookmarks);
    } catch (e) {
      console.error("Incremental Reading: saving bookmarks failed", e);
    }
  }

  /**
   * Attach the "X% read" widget that lives at the bottom of the reading
   * pane. Hooks a scroll listener (rAF-throttled) to keep the fill in
   * step with the body's `scrollTop`; on short documents that fit in the
   * viewport, the widget flips to a "Fits in view" mode so the user
   * doesn't see a stuck-at-0% bar.
   *
   * The listener lives for as long as `scroll` does. Because
   * `renderCard()` rebuilds the contentEl on every transition, the
   * element (and its listeners) gets garbage-collected automatically;
   * no manual teardown needed.
   */
  private attachDocProgress(mainCol: HTMLElement, scroll: HTMLElement): void {
    const wrap = mainCol.createDiv({ cls: "ir-reading-doc-progress" });
    // Track is the flex-grow column; the fill inside takes the actual %.
    // Without this split the fill itself was the flex-grow child, so the
    // inline `width: N%` was overridden by flex-grow and the bar always
    // visually filled the row regardless of progress.
    const track = wrap.createDiv({ cls: "ir-reading-doc-progress-track" });
    const fill = track.createDiv({ cls: "ir-reading-doc-progress-fill" });
    const label = wrap.createSpan({ cls: "ir-reading-doc-progress-label" });

    const scrollerOf = (): HTMLElement => this.readingScroller() ?? scroll;

    const update = () => {
      const el = scrollerOf();
      const fits = scrollFits(el.scrollHeight, el.clientHeight);
      if (fits) {
        wrap.addClass("ir-reading-doc-progress--fits");
        this.contentEl.addClass("ir-review--reading-fits");
        fill.style.width = "100%";
        label.setText(formatReadLabel(1, true));
        return;
      }
      wrap.removeClass("ir-reading-doc-progress--fits");
      this.contentEl.removeClass("ir-review--reading-fits");
      const progress = readScrollProgress(el);
      fill.style.width = `${progress * 100}%`;
      label.setText(formatReadLabel(progress, false));
    };

    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        update();
      });
    };

    // Initial paint needs to wait for layout so scrollHeight is meaningful.
    // restoreBookmark also fires after a frame, so a second rAF tick lines
    // up the first measurement with the restored scroll.
    requestAnimationFrame(() => {
      update();
      requestAnimationFrame(update);
    });

    let raf = 0;
    scroll.addEventListener("scroll", onScroll);
    const inner = this.readingScroller();
    if (inner && inner !== scroll) inner.addEventListener("scroll", onScroll);
  }

  /**
   * Persist any pending edit before advancing or creating a child.
   * Idempotent: re-flushing is a no-op when the buffer matches the last
   * saved state. File-backed elements save the whole body via `saveBody`;
   * anchored elements (no file) record a `text-edited` event in the store
   * so the change survives across folds without rewriting the parent note.
   */
  private async flushEdits(): Promise<void> {
    this.captureBookmark();
    const slot = this.current;
    if (!slot || this.bodyMissing) return;
    if (this.liveEditor) {
      this.currentRaw = this.liveEditor.getBody();
      try {
        await this.liveEditor.save();
        this.rawOnDisk = this.currentRaw;
      } catch (e) {
        console.error("Incremental Reading: saving edits failed", e);
        new Notice(
          "Incremental Reading: could not save your edits. See the developer console.",
        );
      }
      return;
    }
    if (this.currentRaw === this.rawOnDisk) return;
    try {
      if (slot.file && isPdfPath(slot.file.path)) {
        this.rawOnDisk = this.currentRaw;
        return;
      }
      if (slot.file) {
        await saveBody(this.app, slot.file, this.currentRaw);
      } else {
        const now = Date.now();
        const ev = buildTextEditedEvent({
          elementId: slot.id,
          text: this.currentRaw,
          eventId: newEventId(),
          device: await this.store.getDeviceId(),
          lamport: now,
          now,
        });
        await this.store.appendEvent(ev);
        const updated = { ...slot.element, text: this.currentRaw };
        slot.element = updated;
        this.elementsById.set(slot.id, updated);
        this.onChange?.();
      }
      this.rawOnDisk = this.currentRaw;
    } catch (e) {
      console.error("Incremental Reading: saving edits failed", e);
      new Notice(
        "Incremental Reading: could not save your edits. See the developer console.",
      );
    }
  }

  private async renderCard() {
    const slotNow = this.current;
    if (slotNow && this.loadedSlotId === slotNow.id) {
      this.captureBookmark();
    }
    this.parkLiveEditor();
    if (!this.editing && this.liveEditor) {
      await this.flushEdits();
      this.teardownLiveEditorSync();
    }
    const host = this.cardHostEl ?? this.contentEl;
    host.empty();
    this.syncMobileEditChrome();

    const slot = this.current;
    if (this.emptyVault) {
      this.hasSourceContext = false;
      this.contentEl.removeClass("ir-review-has-context");
      this.onSlotChange?.(null);
      this.paintSessionBar();
      this.renderEmptyCollection(host);
      return;
    }
    if (this.sessionComplete) {
      this.hasSourceContext = false;
      this.contentEl.removeClass("ir-review-has-context");
      this.onSlotChange?.(null);
      this.paintSessionBar();
      this.renderSessionComplete(host);
      return;
    }
    this.onSlotChange?.(slot ? slot.id : null);
    if (!slot) {
      this.hasSourceContext = false;
      this.contentEl.removeClass("ir-review-has-context");
      window.setTimeout(() => this.leaf.detach(), 0);
      return;
    }

    await this.ensureLoaded(slot);

    const sourceCtx = await this.loadSourceContext(slot);
    this.hasSourceContext = !!sourceCtx;
    this.paintSessionBar();
    if (sourceCtx) this.contentEl.addClass("ir-review-has-context");
    else this.contentEl.removeClass("ir-review-has-context");

    const columns = host.createDiv({ cls: "ir-review-columns" });
    const reading = this.isReading(slot);
    const isCloze = !reading && hasCloze(this.currentRaw);
    const maskClozeChrome = !reading && isCloze && !this.revealed;
    const mobileCompactEdit =
      Platform.isMobile && this.editing && this.canEdit();

    if (sourceCtx && (!Platform.isMobile || this.mobileSourceExpanded)) {
      const ctxCol = columns.createDiv({ cls: "ir-review-context-col" });
      const sourceHeaderText = maskClozeChrome
        ? "Source (hidden until reveal)"
        : `Source · ${sourceCtx.title}`;
      const header = ctxCol.createEl(Platform.isMobile ? "button" : "div", {
        cls: "ir-review-context-header",
      });
      header.createEl("span", {
        cls: "ir-review-context-header-label",
        text: sourceHeaderText,
      });
      if (Platform.isMobile) {
        header.setAttr("type", "button");
        header.setAttr("aria-label", "Hide source");
        header.setAttr("aria-expanded", "true");
        const chevron = header.createSpan({
          cls: "ir-review-context-header-chevron",
        });
        setIcon(chevron, "chevron-up");
        header.addEventListener("click", (ev) => {
          ev.preventDefault();
          this.mobileSourceExpanded = false;
          void this.renderCard();
        });
      }
      const ctxScroll = ctxCol.createDiv({ cls: "ir-review-context-scroll" });
      if (maskClozeChrome) {
        ctxScroll.createEl("p", {
          cls: "ir-review-context-placeholder",
          text:
            "Parent note text is hidden until you reveal this card so titles " +
            "and excerpts cannot spoil the answer.",
        });
      } else if (sourceCtx.pdf) {
        ctxScroll.createEl("p", {
          cls: "ir-review-context-placeholder",
          text:
            "PDF source — extracts highlight in the built-in viewer. " +
            "Select text there and press Alt+X. Cloze is markdown-only: " +
            "extract first, then cloze the extract.",
        });
        const openBtn = ctxScroll.createEl("button", {
          type: "button",
          cls: "mod-cta ir-review-open-pdf",
          text: `Focus PDF (page ${sourceCtx.pdf.page})`,
        });
        const pdf = sourceCtx.pdf;
        openBtn.addEventListener("click", () => {
          void openPdfAt(this.app, pdf.path, pdf.page, pdf.selection);
        });
      } else {
        const ctxBody = ctxScroll.createDiv({
          cls: "ir-review-context-markdown ir-review-body",
        });
        // §Q3 review-pane decorations: splice a `<mark>` for every extract
        // and cloze on this source. Clozes win overlapping bytes (no nested
        // HTML). The focused card keeps `ir-extract-highlight` for scroll.
        const focused = sourceCtx.highlightRange;
        const toPack: SourceMarkRange[] = [...sourceCtx.siblingRanges];
        if (focused) {
          toPack.push({
            start: focused.start,
            end: focused.end,
            text: sourceCtx.raw.slice(focused.start, focused.end),
            kind: "extract",
          });
        }
        const marks = reviewSourceSplices(toPack, focused).sort(
          (a, b) => a.start - b.start,
        );
        // Prefer clean markdown + DOM paint. HTML-in-source splicing is kept
        // as a best-effort for themes that preserve raw <mark>, but Obsidian
        // often strips those tags in ItemView renders — DOM paint is the
        // reliable path for "already extracted" feedback.
        await MarkdownRenderer.render(
          this.app,
          sourceCtx.raw,
          ctxBody,
          sourceCtx.path,
          this,
        );
        paintIrSourceMarksInElement(
          ctxBody,
          marks.map((m) => ({
            text: sourceCtx.raw.slice(m.start, m.end),
            cls: m.cls,
          })),
        );
        this.wireMarkdownLinks(ctxBody, sourceCtx.path);
        if (sourceCtx.highlightRange) {
          requestAnimationFrame(() => {
            const mark = ctxBody.querySelector(".ir-extract-highlight");
            if (mark) {
              mark.scrollIntoView({ block: "center", behavior: "smooth" });
            }
          });
        }
      }
    }

    const mainCol = columns.createDiv({ cls: "ir-review-main-col" });
    const scroll = mainCol.createDiv({
      cls: "ir-review-scroll ir-review-swipe-zone",
    });

    if (mobileCompactEdit) {
      await this.renderEditor(scroll);
    } else {
      const label = reviewHeadlineLabel(slot.element, maskClozeChrome);
      const kind = reading ? "Reading" : "Review";
      scroll.createEl("div", {
        cls: "ir-review-progress",
        text: `${kind}  ·  ${label}`,
      });
      this.renderResumeChrome(scroll, slot);
      this.renderReanchorBanner(scroll, slot);

      const ancestors = ancestorChain(slot.element, this.elementsById);
      if (ancestors.length > 0) {
        scroll.createEl("div", {
          cls: "ir-review-breadcrumb",
          text: ancestors
            .map((a) => ancestorBreadcrumbLabel(a, maskClozeChrome))
            .join("  /  "),
        });
      }

      if (this.editing && this.canEdit()) {
        await this.renderEditor(scroll);
      } else if (
        slot.file &&
        isPdfPath(slot.file.path) &&
        !this.currentRaw.trim()
      ) {
        scroll.createEl("p", {
          cls: "ir-review-context-placeholder",
          text:
            "This topic is a PDF. Select text in the viewer and press Alt+X " +
            "to extract. Scanned pages without a text layer cannot be extracted.",
        });
      } else {
        await this.renderBody(scroll, this.currentRaw, isCloze);
      }

      if (reading) {
        this.attachDocProgress(mainCol, scroll);
      }
    }

    if (mobileCompactEdit) {
      resetMobileKeyboardBaseline();
      resetMobileEditLayoutBaseline();
      this.renderMobileEditDock(host);
      this.attachMobileEditResizeObserver();
      if (reading) {
        this.restoreBookmark(slot);
        void this.maybeOpenPdfSource(slot);
      }
      requestAnimationFrame(() => {
        scroll
          .querySelector<HTMLTextAreaElement>(".ir-review-textarea")
          ?.focus();
        requestAnimationFrame(() => this.adjustReviewPaneForKeyboard());
      });
      return;
    }

    const dock = host.createDiv({ cls: "ir-review-dock" });
    const controls = dock.createEl("div", { cls: "ir-review-controls" });

    this.maybeShowSwipeCoachMark(slot);

    this.renderHubButton(controls);

    if (reading) {
      this.renderPriorityRow(controls, slot);
      const bar = controls.createEl("div", {
        cls: Platform.isMobile
          ? "ir-review-buttons ir-review-buttons--reading-primary"
          : "ir-review-buttons",
      });
      this.renderChildButtons(bar);
      if (Platform.isMobile) {
        bar
          .createEl("button", {
            text: "Next",
            cls: "mod-cta ir-review-grade-btn",
          })
          .addEventListener("click", () => void this.next());
        this.renderOverflowButton(bar, this.readingOverflowItems());
      } else {
        this.renderEditToggle(bar);
        const prevRead = bar.createEl("button", {
          text: this.labelWithHotkey("Previous", "["),
          cls: "ir-review-util-btn",
        });
        if (this.index === 0) prevRead.disabled = true;
        prevRead.addEventListener("click", () => void this.previous());
        bar
          .createEl("button", {
            text: this.labelWithHotkey("Next", "Space"),
            cls: "mod-cta ir-review-grade-btn",
          })
          .addEventListener("click", () => void this.next());
        bar
          .createEl("button", {
            text: this.labelWithHotkey("Later today", "L"),
            cls: "ir-review-util-btn",
          })
          .addEventListener("click", () => void this.later());
        bar
          .createEl("button", {
            text: this.labelWithHotkey("Dismiss", "D"),
            cls: "ir-review-util-btn",
          })
          .addEventListener("click", () => void this.dismiss());
      }
      this.restoreBookmark(slot);
      void this.maybeOpenPdfSource(slot).then(() => {
        if (!this.pdfSourcePath(slot)) this.ensureFocus();
      });
      if (!this.pdfSourcePath(slot)) this.ensureFocus();
      return;
    }

    if (isCloze && !this.revealed) {
      const preBar = controls.createEl("div", {
        cls: Platform.isMobile
          ? "ir-review-buttons ir-review-buttons--cloze-reveal"
          : "ir-review-buttons",
      });
      if (Platform.isMobile) {
        preBar
          .createEl("button", {
            text: "Show answer",
            cls: "mod-cta ir-review-grade-btn",
          })
          .addEventListener("click", () => {
            this.revealed = true;
            void this.renderCard();
          });
        this.renderOverflowButton(preBar, [
          {
            label: this.labelWithHotkey("Previous", "["),
            disabled: this.index === 0,
            run: () => void this.previous(),
          },
        ]);
      } else {
        const prevPre = preBar.createEl("button", {
          text: this.labelWithHotkey("Previous", "["),
          cls: "ir-review-util-btn",
        });
        if (this.index === 0) prevPre.disabled = true;
        prevPre.addEventListener("click", () => void this.previous());
        preBar
          .createEl("button", {
            text: this.labelWithHotkey("Show answer", "Space"),
            cls: "mod-cta ir-review-grade-btn",
          })
          .addEventListener("click", () => {
            this.revealed = true;
            void this.renderCard();
          });
      }
      this.ensureFocus();
      return;
    }

    this.renderPriorityRow(controls, slot);
    const bar = controls.createEl("div", {
      cls: Platform.isMobile
        ? "ir-review-buttons ir-review-buttons--grade"
        : "ir-review-buttons",
    });
    if (Platform.isMobile) {
      for (const { grade, label: gLabel } of GRADES) {
        bar
          .createEl("button", {
            text: gLabel,
            cls: `ir-review-grade-btn ir-review-grade-btn--${grade}`,
          })
          .addEventListener("click", () => void this.grade(grade));
      }
      this.renderOverflowButton(bar, this.gradeOverflowItems());
    } else {
      const prevGrade = bar.createEl("button", {
        text: this.labelWithHotkey("Previous", "["),
        cls: "ir-review-util-btn",
      });
      if (this.index === 0) prevGrade.disabled = true;
      prevGrade.addEventListener("click", () => void this.previous());
      this.renderEditToggle(bar);
      for (const { grade, label: gLabel, key } of GRADES) {
        const spaceGrade = isSpaceAfterReveal(this.settings.spaceAfterReveal)
          ? this.settings.spaceAfterReveal
          : "good";
        const spaceHint =
          !Platform.isMobile && spaceGrade === grade ? ", Space" : "";
        const text = Platform.isMobile
          ? gLabel
          : `${gLabel} (${key}${spaceHint})`;
        bar
          .createEl("button", {
            text,
            cls: `ir-review-grade-btn ir-review-grade-btn--${grade}`,
          })
          .addEventListener("click", () => void this.grade(grade));
      }
      bar
        .createEl("button", {
          text: this.labelWithHotkey("Dismiss", "D"),
          cls: "ir-review-util-btn",
        })
        .addEventListener("click", () => void this.dismiss());
      if (this.commitUndoLastGrade) {
        bar
          .createEl("button", {
            cls: "ir-review-undo ir-review-util-btn",
            text: "Undo last grade",
          })
          .addEventListener("click", () => void this.tryUndoLastGrade());
      }
    }
    this.paintFlash();
    this.ensureFocus();
  }

  /** Cards still in this session, including the current one. */
  private remainingInSession(): number {
    return this.sessionComplete
      ? 0
      : Math.max(0, this.queue.length - this.index);
  }

  /**
   * Mid-session extract/cloze/promote/fork: the new (or updated) element
   * joins this pass immediately after the current card. Does not rebuild
   * the due queue. Safe to call from the host plugin (hub/tree).
   */
  adoptElement(el: IrElement): void {
    const slot = slotFromElement(this.app, el);
    if (!slot) return;
    this.elementsById.set(el.id, el);
    const currentId = this.current?.id;
    this.queue = upsertAfterCurrent(this.queue, this.index, slot);
    if (currentId === el.id) {
      this.loadedSlotId = null;
      void this.renderCard();
    }     else {
      this.paintSessionBar();
    }
  }

  /** Re-paint after the host plugin mutates the session (bulk extract). */
  refreshView(): void {
    void this.renderCard();
  }

  /**
   * Jump the session cursor to `id` if that card is in this queue.
   * Used by the element tree's click policy.
   */
  jumpToElement(id: ElementId): boolean {
    const i = this.queue.findIndex((s) => s.id === id);
    if (i < 0) return false;
    if (i === this.index && !this.sessionComplete) return true;
    void (async () => {
      await this.flushEdits();
      void this.persistBookmarks();
      this.index = i;
      this.revealed = false;
      this.editing = false;
      this.loadedSlotId = null;
      this.sessionComplete = false;
      void this.renderCard();
    })();
    return true;
  }

  private paintSessionBar(): void {
    const bar = this.sessionBarEl;
    if (!bar) return;
    bar.empty();
    const remaining = this.remainingInSession();
    const donePct =
      this.queue.length === 0
        ? 100
        : Math.round((this.index / this.queue.length) * 100);
    const pct = this.sessionComplete ? 100 : donePct;

    const row = bar.createDiv({ cls: "ir-review-session-row" });
    const chip = row.createSpan({
      cls: this.isNeural
        ? "ir-review-mode-chip ir-review-mode-chip--neural"
        : "ir-review-mode-chip ir-review-mode-chip--due",
      text: this.emptyVault
        ? "IR"
        : this.sessionComplete
          ? "Done"
          : this.isNeural
            ? "Neural"
            : "Due",
    });
    chip.setAttr("aria-hidden", "true");
    row.createSpan({
      cls: "ir-review-session-label",
      text: this.emptyVault
        ? "No topics yet"
        : this.sessionComplete
          ? this.neuralEndedEarly
            ? "Neural session ended"
            : "Session complete"
          : this.isNeural
            ? this.sessionSeedLabel
              ? `${remaining} left · ${this.sessionSeedLabel}`
              : `${remaining} left`
            : `${remaining} left`,
    });
    bar.setAttr(
      "aria-label",
      this.emptyVault
        ? "No Incremental Reading topics yet"
        : sessionBarLabel({
            done: this.sessionComplete,
            isNeural: this.isNeural,
            remaining,
            seedLabel: this.isNeural ? this.sessionSeedLabel : undefined,
          }),
    );
    if (
      Platform.isMobile &&
      this.hasSourceContext &&
      !this.sessionComplete
    ) {
      const btn = row.createEl("button", {
        cls: "ir-review-session-source",
        type: "button",
        text: this.mobileSourceExpanded ? "Hide source" : "Source",
      });
      btn.setAttr(
        "aria-expanded",
        this.mobileSourceExpanded ? "true" : "false",
      );
      btn.addEventListener("click", () => {
        this.mobileSourceExpanded = !this.mobileSourceExpanded;
        void this.renderCard();
      });
    }

    if (this.isNeural && !this.sessionComplete) {
      const via = this.current?.neuralVia;
      if (via) {
        const fromEl = this.elementsById.get(via.fromId as ElementId);
        const fromLabel = fromEl ? labelFor(fromEl) : via.fromId;
        bar.createDiv({
          cls: "ir-review-neural-via",
          text: neuralViaLabel(via, fromLabel),
        });
      }
    }

    const track = bar.createDiv({ cls: "ir-review-session-track" });
    const fill = track.createDiv({ cls: "ir-review-session-fill" });
    fill.style.width = `${pct}%`;
  }

  private endNeuralMode(): void {
    this.neuralEndedEarly = true;
    this.sessionComplete = true;
    this.editing = false;
    void this.flushEdits();
    void this.persistBookmarks();
    void this.renderCard();
  }

  private renderEmptyCollection(host: HTMLElement): void {
    const scroll = host.createDiv({ cls: "ir-review-scroll" });
    scroll.createEl("h3", { text: "Incremental Reading" });
    scroll.createEl("p", { text: EMPTY_COLLECTION_COPY });
    scroll.createEl("p", {
      cls: "ir-review-complete-hint",
      text: "Escape or Close leaves this tab.",
    });
    scroll
      .createEl("button", { text: "Close", cls: "mod-cta" })
      .addEventListener("click", () => this.leaf.detach());
  }

  private renderSessionComplete(host: HTMLElement): void {
    const scroll = host.createDiv({ cls: "ir-review-scroll" });
    const neural = this.isNeural;
    scroll.createEl("h3", {
      text: this.neuralEndedEarly ? "Neural session ended" : "Session complete",
    });
    if (!this.neuralEndedEarly) {
      const n = this.queue.length;
      scroll.createEl("p", {
        text:
          n === 1
            ? "You finished 1 element in this pass."
            : `You finished ${n} elements in this pass.`,
      });
    }
    scroll.createEl("p", {
      cls: "ir-review-complete-hint",
      text: neural
        ? "Start outstanding (Alt+R) for today's due queue. Escape or Close leaves this tab."
        : "Alt+R starts remaining due. Escape or Close leaves this tab.",
    });
    if (neural && this.startOutstandingDue) {
      scroll
        .createEl("button", {
          text: "Start outstanding (Alt+R)",
          cls: "mod-cta",
        })
        .addEventListener("click", () => this.startOutstandingDue?.());
    }
    scroll
      .createEl("button", {
        text: "Close",
        cls: neural && this.startOutstandingDue ? "" : "mod-cta",
      })
      .addEventListener("click", () => this.leaf.detach());
  }

  private renderResumeChrome(parent: HTMLElement, slot: ReviewSlot): void {
    if (!this.isReading(slot)) return;
    if (this.resumeFromTop.has(slot.id)) return;
    const bm = getBookmark(this.bookmarks, slot.id);
    if (!bm || (bm.scrollTop <= 0 && bm.line <= 0 && !(bm.progress && bm.progress > 0.02))) return;
    const row = parent.createDiv({ cls: "ir-review-resume" });
    row.createSpan({
      cls: "ir-review-resume-msg",
      text: "Resumed from last time",
    });
    row
      .createEl("button", {
        cls: "ir-review-resume-btn",
        type: "button",
        text: "From the top",
      })
      .addEventListener("click", () => {
        this.resumeFromTop.add(slot.id);
        const scroll = this.contentEl.querySelector<HTMLElement>(
          ".ir-review-main-col .ir-review-scroll",
        );
        if (scroll) scroll.scrollTop = 0;
        this.liveEditor?.setScrollProgress(0);
        const ta = this.contentEl.querySelector<HTMLTextAreaElement>(
          ".ir-review-textarea",
        );
        if (ta) {
          ta.setSelectionRange(0, 0);
          ta.scrollTop = 0;
        }
        const prev = getBookmark(this.bookmarks, slot.id);
        this.bookmarks = setBookmark(this.bookmarks, {
          elementId: slot.id,
          line: 0,
          ch: 0,
          scrollTop: 0,
          progress: 0,
          updatedAt: Date.now(),
          ...(prev?.page != null ? { page: prev.page } : {}),
        });
        row.remove();
      });
  }

  private renderReanchorBanner(parent: HTMLElement, slot: ReviewSlot): void {
    if (!shouldShowReanchorBanner(slot.element.anchorState)) return;
    const detached = slot.element.anchorState === "detached";
    const banner = parent.createDiv({
      cls: detached
        ? "ir-review-reanchor-banner ir-review-reanchor-banner--detached"
        : "ir-review-reanchor-banner",
    });
    banner.createSpan({
      cls: "ir-review-reanchor-msg",
      text: detached
        ? "Source is gone. This extract survives on stored text."
        : "This extract’s place in the source has drifted.",
    });
    const actions = banner.createDiv({ cls: "ir-review-reanchor-actions" });
    if (!detached && this.commitReanchor) {
      actions
        .createEl("button", {
          cls: "mod-cta",
          type: "button",
          text: "Re-anchor",
        })
        .addEventListener("click", () => {
          void (async () => {
            const ok = await this.commitReanchor!(slot.id, slot.element);
            if (!ok) {
              new Notice("Could not re-anchor: text not found in source.");
              return;
            }
            const state = await this.store.load();
            const updated = state.elements.get(slot.id);
            if (updated) {
              slot.element = updated;
              this.elementsById.set(slot.id, updated);
            }
            this.flash("Anchor repaired");
            void this.renderCard();
          })();
        });
    }
    if (!detached && this.commitDetachAnchor) {
      actions
        .createEl("button", { type: "button", text: "Detach" })
        .addEventListener("click", () => {
          void (async () => {
            await this.commitDetachAnchor!(slot.id, slot.element);
            const state = await this.store.load();
            const updated = state.elements.get(slot.id);
            if (updated) {
              slot.element = updated;
              this.elementsById.set(slot.id, updated);
            }
            void this.renderCard();
          })();
        });
    }
    const sourcePath = slot.element.anchor?.sourcePath;
    if (sourcePath) {
      actions
        .createEl("button", { type: "button", text: "Open source" })
        .addEventListener("click", () => {
          const file = this.app.vault.getAbstractFileByPath(sourcePath);
          if (!(file instanceof TFile)) {
            new Notice(`Incremental Reading: source "${sourcePath}" not found.`);
            return;
          }
          if (isPdfPath(sourcePath)) {
            const pdf = slot.element.anchor?.pdf;
            void openPdfAt(
              this.app,
              sourcePath,
              pdf?.page ?? 1,
              pdf?.selection,
            );
            return;
          }
          void this.app.workspace.getLeaf(false).openFile(file);
        });
    }
  }

  /**
   * One-line success feedback in the review dock. Notices are reserved
   * for failures the user has to act on.
   */
  private flash(text: string): void {
    this.pendingFlash = text;
    this.paintFlash();
  }

  private paintFlash(): void {
    const dock = this.contentEl.querySelector(".ir-review-dock");
    if (!dock || !this.pendingFlash) return;
    let el = dock.querySelector<HTMLElement>(".ir-review-flash");
    if (!el) {
      el = dock.createDiv({ cls: "ir-review-flash" });
      dock.prepend(el);
    }
    el.setText(this.pendingFlash);
    el.removeClass("ir-review-flash--out");
    if (this.flashClearTimer != null) window.clearTimeout(this.flashClearTimer);
    const text = this.pendingFlash;
    this.flashClearTimer = window.setTimeout(() => {
      if (this.pendingFlash === text) {
        el?.addClass("ir-review-flash--out");
        this.pendingFlash = null;
      }
    }, 2500);
  }

  /**
   * Append a `grade-undone` event for the most recent grade in the log
   * and, when that grade was the card we just left in this session, step
   * the in-pane cursor back so the user can re-grade it immediately.
   *
   * Why we don't always step back: the user may have undone a grade made
   * earlier (different card, different session). Forcing the cursor to
   * leap to the rewound card mid-queue would lose their place in the
   * current run. The "previous slot id matches the undone target" guard
   * keeps the in-pane rewind tightly scoped to the obvious "I just got
   * that one wrong" gesture; everything else gets a notice and a
   * re-render in place.
   */
  private async tryUndoLastGrade(): Promise<void> {
    if (!this.commitUndoLastGrade) return;
    const result = await this.commitUndoLastGrade();
    if (!result) {
      new Notice("Incremental Reading: nothing to undo.");
      return;
    }
    this.flash(`Undid grade for "${result.targetLabel}"`);
    if (this.index > 0) {
      const prev = this.queue[this.index - 1];
      if (prev && prev.element.id === result.targetId) {
        try {
          const state = await this.store.load();
          const updated = state.elements.get(result.targetId);
          if (updated) {
            prev.element = updated;
            this.elementsById.set(result.targetId, updated);
          }
        } catch (err) {
          console.error(
            "Incremental Reading: refresh after undo failed",
            err,
          );
        }
        void this.previous();
        return;
      }
    }
    void this.renderCard();
  }

  /**
   * After rendering a card, make sure the view can receive keyboard events.
   * If editing, the textarea already got focus via renderEditor; otherwise
   * focus the contentEl so the keydown handler fires.
   */
  private ensureFocus(): void {
    if (this.editing) return;
    requestAnimationFrame(() => {
      if (!this.isTypingInInput()) {
        this.contentEl.focus();
      }
    });
  }

  /**
   * Make `[[wikilinks]]` clickable in a `MarkdownRenderer.render` output.
   * The review pane is a custom `ItemView`, not a `MarkdownView`, so it
   * doesn't get Obsidian's default link-click handler — left alone, the
   * `<a class="internal-link">` Obsidian emits is a dead link.
   *
   * Listens in the capture phase so it fires before the body's edit-toggle
   * click handler (which already returns early on `<a>` targets, but a
   * capture-phase preventDefault is cheaper to reason about than relying
   * on attach order). Internal links route through `openLinkText` with
   * the current source path so relative resolution works; ctrl/cmd-click
   * opens in a new pane to match Obsidian's editor convention. External
   * links fall through to the browser's default.
   */
  private wireMarkdownLinks(root: HTMLElement, sourcePath: string): void {
    root.addEventListener(
      "click",
      (evt: MouseEvent) => {
        const target = evt.target as HTMLElement | null;
        const a = target?.closest("a") as HTMLAnchorElement | null;
        if (!a) return;
        if (a.classList.contains("external-link")) return;
        const href = a.dataset.href ?? a.getAttribute("href") ?? "";
        if (!href) return;
        evt.preventDefault();
        evt.stopPropagation();
        const newLeaf = evt.ctrlKey || evt.metaKey;
        void this.app.workspace.openLinkText(href, sourcePath, newLeaf);
      },
      true,
    );
  }

  private async renderBody(
    parent: HTMLElement,
    raw: string,
    isCloze: boolean,
  ): Promise<void> {
    const slot = this.current;
    // Cloze cards still transform the body; extract highlights are painted
    // onto the rendered DOM after MarkdownRenderer (DESIGN §Q3). Splicing
    // <mark> into the markdown source is unreliable in ItemView renders.
    const shown =
      isCloze && !this.revealed
        ? transformClozes(raw, ({ hint }, inCodeSpan) => {
            const hintPart = hint
              ? ` <span class="ir-cloze-hint">(${escapeClozeHtmlFragment(hint)})</span>`
              : "";
            const html = `<mark class="ir-cloze-elision"><span class="ir-cloze-gap">[ ... ]</span>${hintPart}</mark>`;
            return inCodeSpan ? `<code>${html}</code>` : html;
          })
        : isCloze
          ? transformClozes(raw, ({ answer }, inCodeSpan) => {
              const html = `<mark class="ir-cloze-answer">${escapeClozeHtmlFragment(answer)}</mark>`;
              return inCodeSpan ? `<code>${html}</code>` : html;
            })
          : raw;
    const body = parent.createEl("div", {
      cls: "ir-review-body ir-review-main-body",
    });
    // For store-only anchored extracts, `slot.file` is null. Falling back
    // to the empty string strips the source path Obsidian uses to resolve
    // contextual wikilinks (`[[sample]]`), so they render as unresolved.
    // Use the extract's provenance — the parent source note's path — so
    // wikilinks resolve from the right folder.
    const renderSourcePath =
      slot?.file?.path ??
      (slot ? this.resolveProvenanceSourcePath(slot) : null) ??
      "";
    await MarkdownRenderer.render(
      this.app,
      shown,
      body,
      renderSourcePath,
      this,
    );
    // Topic (or file-backed extract) as source: show every anchored extract
    // / cloze on this note so reading → extract has immediate visual feedback.
    if (!isCloze && slot?.file) {
      const ranges = this.sourceMarksForPath(slot.file.path);
      paintIrSourceMarksInElement(
        body,
        ranges.map((r) => ({
          text: r.text || raw.slice(r.start, r.end),
          cls:
            r.kind === "cloze" ? "ir-cloze-source" : "ir-extract-source",
        })),
      );
    }
    this.wireMarkdownLinks(body, renderSourcePath);

    // Reading mode is for highlight → extract/cloze. Plain single-click and
    // drag-select stay in preview. Enter the editor via double-click (when
    // the gesture did not create a selection), Ctrl/Cmd-click, or Edit.
    if (slot && this.canEdit() && !this.editing) {
      body.addClass("ir-review-main-body--click-to-edit");
      let downX = 0;
      let downY = 0;
      body.addEventListener("pointerdown", (evt: PointerEvent) => {
        if (evt.button !== 0) return;
        downX = evt.clientX;
        downY = evt.clientY;
      });
      const previewControlSelector =
        "a, button, input, select, textarea, iframe, video, audio";
      const gestureMovedPx = (evt: MouseEvent): number =>
        Math.hypot(evt.clientX - downX, evt.clientY - downY);
      const tryEnterEdit = (
        evt: MouseEvent,
        opts: { forceEdit?: boolean },
      ): void => {
        const el = evt.target as HTMLElement | null;
        if (!el || el.closest(previewControlSelector)) return;
        const movedPx = gestureMovedPx(evt);
        const decide = (forceEdit: boolean): void => {
          const sel = body.ownerDocument.getSelection();
          const selectionCollapsed = !sel || sel.isCollapsed;
          const selectionInBody = !!(
            sel?.anchorNode && body.contains(sel.anchorNode)
          );
          if (
            !shouldEnterEditFromPreviewGesture({
              movedPx,
              selectionCollapsed,
              selectionInBody,
              forceEdit,
            })
          ) {
            return;
          }
          this.beginEditFromPreviewClick(body, evt, slot);
        };
        if (opts.forceEdit) {
          decide(true);
          return;
        }
        // Let the browser finish word/paragraph selection from dblclick.
        requestAnimationFrame(() => decide(false));
      };
      body.addEventListener("click", (evt: MouseEvent) => {
        if (!(evt.metaKey || evt.ctrlKey)) return;
        tryEnterEdit(evt, { forceEdit: true });
      });
      body.addEventListener("dblclick", (evt: MouseEvent) => {
        if (evt.metaKey || evt.ctrlKey) return;
        // Double-click on the review body is an unambiguous "enter edit
        // here" gesture. Preserve the browser's default word-select by
        // translating it into raw-body offsets and carrying it through as
        // `pendingEditSelection`, so the textarea / live editor lands with
        // the same word selected. Alt+X and Alt+Z then extract or cloze
        // that word via `resolveSelection`'s editing branch — no need to
        // re-select in edit mode.
        const doc = body.ownerDocument;
        const domSel = doc.getSelection();
        const hasWord =
          !!domSel &&
          !domSel.isCollapsed &&
          domSel.rangeCount > 0 &&
          !!domSel.anchorNode &&
          body.contains(domSel.anchorNode);
        const mapped = hasWord
          ? mapRenderedSelectionToRaw(
              this.currentRaw,
              body,
              domSel!.getRangeAt(0),
            )
          : null;
        evt.preventDefault();
        domSel?.removeAllRanges();
        if (mapped) {
          // Carry the word-selection into the editor. `clickToEditCaret`
          // wins over `pendingEditSelection` in `renderEditor`, so clear
          // it explicitly to let the range apply.
          this.clickToEditCaret = null;
          this.skipBookmarkCursor = true;
          this.pendingEditSelection = { start: mapped.start, end: mapped.end };
          this.editing = true;
          this.editKind = "live";
          void this.renderCard();
          return;
        }
        // No mappable word-selection (link atom, whitespace, etc.):
        // fall back to caret-at-click.
        this.beginEditFromPreviewClick(body, evt, slot);
      });
    }
  }

  /**
   * Switch the reading card into the live editor, landing the caret near
   * the preview click when the offset map succeeds.
   */
  private beginEditFromPreviewClick(
    body: HTMLElement,
    evt: MouseEvent,
    slot: ReviewSlot,
  ): void {
    const caret = this.rawOffsetFromPreviewClick(body, evt);
    this.clickToEditCaret = caret;
    this.skipBookmarkCursor = caret != null;
    this.pendingEditSelection =
      caret != null ? { start: caret, end: caret } : null;
    if (caret != null) {
      const scroller = body.closest(".ir-review-scroll");
      const scrollEl = scroller instanceof HTMLElement ? scroller : null;
      const prev = getBookmark(this.bookmarks, slot.id);
      this.bookmarks = setBookmark(this.bookmarks, {
        elementId: slot.id,
        line: caret,
        ch: 0,
        scrollTop: scrollEl?.scrollTop ?? 0,
        progress: scrollEl ? readScrollProgress(scrollEl) : prev?.progress,
        updatedAt: Date.now(),
        ...(prev?.page != null ? { page: prev.page } : {}),
      });
    }
    this.editing = true;
    this.editKind = "live";
    void this.renderCard();
  }

  /**
   * Map a click in the rendered preview onto a markdown body offset.
   */
  private rawOffsetFromPreviewClick(
    root: HTMLElement,
    evt: MouseEvent,
  ): number | null {
    const doc = root.ownerDocument as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
      caretPositionFromPoint?: (
        x: number,
        y: number,
      ) => { offsetNode: Node; offset: number } | null;
    };
    let container: Node | null = null;
    let offset = 0;
    if (typeof doc.caretRangeFromPoint === "function") {
      const range = doc.caretRangeFromPoint(evt.clientX, evt.clientY);
      if (!range) return null;
      container = range.startContainer;
      offset = range.startOffset;
    } else if (typeof doc.caretPositionFromPoint === "function") {
      const pos = doc.caretPositionFromPoint(evt.clientX, evt.clientY);
      if (!pos) return null;
      container = pos.offsetNode;
      offset = pos.offset;
    } else {
      return null;
    }
    if (!container || !root.contains(container)) return null;
    const renderedOff = caretOffsetInRendered(root, container, offset);
    if (renderedOff === null) return null;
    return mapRenderedCaretToRaw(
      this.currentRaw,
      renderedPlainText(root),
      renderedOff,
    );
  }

  /**
   * Resolved extract/cloze ranges for a source path, for DOM painting and
   * bulk-extract idempotency helpers.
   */
  private sourceMarksForPath(path: string): SourceMarkRange[] {
    return (this.getSourceExtractRanges?.(path) ?? []).map((r) => ({
      start: r.start,
      end: r.end,
      text: r.text ?? "",
      kind: r.kind ?? "extract",
    }));
  }

  private parkLiveEditor(): void {
    this.liveEditor?.hostEl.detach();
  }

  private teardownLiveEditorSync(): void {
    if (!this.liveEditor) return;
    this.liveEditor.destroy();
    this.liveEditor = null;
  }

  private async attachLiveEditor(
    parent: HTMLElement,
    file: TFile,
  ): Promise<boolean> {
    if (this.liveEditor && this.liveEditor.filePath === file.path) {
      parent.appendChild(this.liveEditor.hostEl);
      await this.flushEdits();
      await this.liveEditor.setKind(this.editKind);
      return true;
    }
    this.teardownLiveEditorSync();
    const mounted = await mountReviewLiveEditor(
      this.app,
      file,
      this.leaf,
      parent,
      this.editKind,
      () => this.handleEscapeKey(),
    );
    if (!mounted) return false;
    this.liveEditor = mounted;
    return true;
  }

  private async renderEditor(parent: HTMLElement) {
    const slot = this.current;
    const file = slot?.file ?? null;
    if (canUseReviewLivePreview(file, Platform.isMobile) && file) {
      const ok = await this.attachLiveEditor(parent, file);
      if (ok) {
        const pending = this.pendingEditSelection;
        this.pendingEditSelection = null;
        const click = this.clickToEditCaret;
        this.clickToEditCaret = null;
        if (click != null) {
          const apply = () => this.placeEditorCaret(click);
          apply();
          requestAnimationFrame(() => {
            apply();
            requestAnimationFrame(apply);
          });
          return;
        }
        if (pending) this.liveEditor?.setSelection(pending.start, pending.end);
        return;
      }
    }
    const ta = parent.createEl("textarea", { cls: "ir-review-textarea" });
    ta.value = this.currentRaw;
    ta.spellcheck = true;
    ta.addEventListener("input", () => {
      this.currentRaw = ta.value;
    });
    // Plain `addEventListener`: textarea is recreated each `renderCard`; avoid
    // stacking `registerDomEvent` cleanups on the view for every card.
    ta.addEventListener("keydown", (evt: KeyboardEvent) => {
      if (evt.key === "Escape") {
        evt.preventDefault();
        evt.stopPropagation();
        this.handleEscapeKey();
        return;
      }
      const slot = this.current;
      if (!slot || !this.isReading(slot)) return;
      if (evt.code === "Enter" && (evt.ctrlKey || evt.metaKey)) {
        evt.preventDefault();
        void this.next();
        return;
      }
      if (
        evt.altKey &&
        !evt.shiftKey &&
        !evt.ctrlKey &&
        !evt.metaKey &&
        (evt.code === "KeyX" || evt.code === "KeyZ") &&
        this.canMakeChild()
      ) {
        evt.preventDefault();
        if (evt.code === "KeyX") void this.handleExtract();
        else void this.handleCloze();
      }
    });
    if (Platform.isMobile) {
      const onKeyboard = () => {
        requestAnimationFrame(() => this.adjustReviewPaneForKeyboard());
      };
      ta.addEventListener("focus", onKeyboard);
      ta.addEventListener("click", onKeyboard);
      ta.addEventListener("blur", () => {
        resetMobileEditLayoutBaseline();
        requestAnimationFrame(() => {
          if (this.editing) this.layoutMobileEditPane();
        });
      });
    } else {
      requestAnimationFrame(() => {
        ta.focus();
        const click = this.clickToEditCaret;
        this.clickToEditCaret = null;
        if (click != null) {
          this.placeEditorCaret(click);
          return;
        }
        const pending = this.pendingEditSelection;
        this.pendingEditSelection = null;
        if (pending) {
          const start = Math.max(0, Math.min(pending.start, ta.value.length));
          const end = Math.max(start, Math.min(pending.end, ta.value.length));
          ta.setSelectionRange(start, end);
        } else {
          ta.setSelectionRange(ta.value.length, ta.value.length);
        }
      });
    }
  }

  private enterEdit(kind: ReviewEditorKind): void {
    this.editing = true;
    this.editKind = kind;
    void this.renderCard();
  }

  private exitEdit(): void {
    this.editing = false;
    void this.renderCard();
  }

  /**
   * Escape: edit → reading; reading / done → leave IR; neural → end pass.
   * Guarded so Scope + DOM + live-editor capture cannot exit-edit then
   * immediately detach in the same keypress.
   */
  private escapeHandling = false;
  private handleEscapeKey(): void {
    if (this.escapeHandling) return;
    this.escapeHandling = true;
    try {
      const action = escapeReviewAction({
        sessionComplete: this.sessionComplete,
        emptyVault: this.emptyVault,
        editing: this.editing,
        isNeural: this.isNeural,
      });
      if (action.kind === "exit-edit") {
        this.exitEdit();
        return;
      }
      if (action.kind === "end-neural") {
        this.endNeuralMode();
        return;
      }
      this.leaf.detach();
    } finally {
      queueMicrotask(() => {
        this.escapeHandling = false;
      });
    }
  }

  private renderEditToggle(parent: HTMLElement) {
    if (!this.canEdit()) return;
    const slot = this.current;
    const reading = !!(slot && this.isReading(slot));
    const liveOk = canUseReviewLivePreview(slot?.file, Platform.isMobile);

    if (this.editing) {
      parent
        .createEl("button", {
          text: reading ? "Preview" : "Done editing",
          cls: "ir-review-edit-toggle",
        })
        .addEventListener("click", () => this.exitEdit());
      if (liveOk) {
        if (this.editKind === "source") {
          parent
            .createEl("button", {
              text: "Live Preview",
              cls: "ir-review-edit-toggle",
            })
            .addEventListener("click", () => this.enterEdit("live"));
        } else {
          parent
            .createEl("button", {
              text: "Source",
              cls: "ir-review-edit-toggle",
            })
            .addEventListener("click", () => this.enterEdit("source"));
        }
      }
      return;
    }

    parent
      .createEl("button", {
        text: "Edit",
        cls: "ir-review-edit-toggle",
      })
      .addEventListener("click", () => this.enterEdit("live"));
    if (liveOk) {
      parent
        .createEl("button", {
          text: "Source",
          cls: "ir-review-edit-toggle",
        })
        .addEventListener("click", () => this.enterEdit("source"));
    }
  }

  /**
   * Prevents the button from taking focus on pointer down so a textarea
   * selection survives until `click` runs (see `resolveSelection` when editing).
   * Plain `addEventListener` (not `registerDomEvent`): buttons are recreated on
   * every `renderCard`; listeners are dropped with the removed DOM nodes.
   */
  private preventClickStealingFocus(el: HTMLElement) {
    el.addEventListener("mousedown", (e: MouseEvent) => {
      if (e.button === 0) e.preventDefault();
    });
  }

  private renderChildButtons(parent: HTMLElement) {
    const slot = this.current;
    const reading = !!(slot && this.isReading(slot));
    const alwaysShow = Platform.isMobile && reading;
    const canExtract = this.canMakeChild();
    const canCloze = this.canMakeClozeChild();
    if (!alwaysShow && !canExtract && !canCloze) return;

    if (alwaysShow || canExtract) {
      const extractBtn = parent.createEl("button", {
        text: this.labelWithHotkey("Extract", "Alt+X"),
        cls: "ir-review-action-btn ir-review-action-btn--extract",
      });
      if (!canExtract) extractBtn.disabled = true;
      this.preventClickStealingFocus(extractBtn);
      extractBtn.addEventListener("click", () => void this.handleExtract());
    }
    if (alwaysShow || canCloze) {
      const clozeBtn = parent.createEl("button", {
        text: this.labelWithHotkey("Cloze", "Alt+Z"),
        cls: "ir-review-action-btn ir-review-action-btn--cloze",
      });
      if (!canCloze) clozeBtn.disabled = true;
      this.preventClickStealingFocus(clozeBtn);
      clozeBtn.addEventListener("click", () => void this.handleCloze());
    }
  }

  private resolveSelection():
    | { ok: true; text: string; start: number; end: number }
    | { ok: false; reason: string; renderedText?: string } {
    if (this.editing) {
      if (this.liveEditor) {
        this.currentRaw = this.liveEditor.getBody();
        const live = this.liveEditor.getSelection();
        if (!live) return { ok: false, reason: "Nothing selected." };
        // Same link-guard as the preview path: `[data.tf](#datatf)` must be
        // extracted or clozed as one token so the anchor round-trips.
        const snapped = expandSelectionAroundLinks(
          this.currentRaw,
          live.start,
          live.end,
        );
        return {
          ok: true,
          text: this.currentRaw.slice(snapped.start, snapped.end),
          start: snapped.start,
          end: snapped.end,
        };
      }
      const active = this.contentEl.ownerDocument.activeElement;
      if (!(active instanceof HTMLTextAreaElement)) {
        return { ok: false, reason: "Click into the editor first." };
      }
      const rawStart = active.selectionStart ?? 0;
      const rawEnd = active.selectionEnd ?? 0;
      if (rawEnd <= rawStart) return { ok: false, reason: "Nothing selected." };
      this.currentRaw = active.value;
      const { start, end } = expandSelectionAroundLinks(
        active.value,
        rawStart,
        rawEnd,
      );
      return {
        ok: true,
        text: active.value.slice(start, end),
        start,
        end,
      };
    }
    const sel = this.contentEl.ownerDocument.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      return { ok: false, reason: "Nothing selected." };
    }
    const bodyEl = this.contentEl.querySelector(".ir-review-main-body");
    if (!bodyEl || !sel.anchorNode || !bodyEl.contains(sel.anchorNode)) {
      return { ok: false, reason: "Selection must be inside the card body." };
    }
    const mapped = mapRenderedSelectionToRaw(
      this.currentRaw,
      bodyEl as HTMLElement,
      sel.getRangeAt(0),
    );
    if (!mapped) {
      return {
        ok: false,
        reason: SWITCH_TO_EDIT_COPY,
        renderedText: sel.toString(),
      };
    }
    return {
      ok: true,
      text: mapped.text,
      start: mapped.start,
      end: mapped.end,
    };
  }

  /** Preview map failed: open Edit and keep the selection when we can find it. */
  private async switchToEditForExactSelection(needle: string): Promise<void> {
    const located = locateTextInBody(this.currentRaw, needle);
    this.pendingEditSelection = located
      ? { start: located.start, end: located.end }
      : null;
    this.editing = true;
    this.editKind = "source";
    await this.renderCard();
    this.flash(SWITCH_TO_EDIT_COPY);
  }

  public async handleExtract(opts?: {
    silent?: boolean;
    promote?: boolean;
  }): Promise<IrElement | undefined> {
    const slot = this.current;
    if (!slot || !this.canMakeChild()) return;
    if (this.pdfSourcePath(slot)) {
      const created = await this.commitPdfExtract?.({
        promote: opts?.promote,
      });
      if (!created) {
        new Notice(
          "Incremental Reading: select text in the PDF, then Extract (Alt+X).",
        );
        return;
      }
      this.adoptElement(created);
      if (!opts?.silent) {
        this.flash(`Extracted · ${this.remainingInSession()} left`);
      }
      this.onChange?.();
      await this.refreshDecorations?.();
      await this.renderCard();
      return created;
    }
    const sel = this.resolveSelection();
    if (!sel.ok) {
      if (sel.renderedText?.trim()) {
        await this.switchToEditForExactSelection(sel.renderedText);
        return;
      }
      new Notice(`Incremental Reading: ${sel.reason}`);
      return;
    }
    const sourcePath =
      slot.file?.path ?? this.resolveProvenanceSourcePath(slot);
    if (!sourcePath) {
      new Notice(
        "Incremental Reading: could not resolve a vault path for this extract.",
      );
      return;
    }
    await this.flushEdits();
    const bodyBeforeExtract = this.currentRaw;
    let created: IrElement | undefined;
    try {
      const now = Date.now();
      const ev = buildExtractEvent({
        sourcePath,
        sourceText: bodyBeforeExtract,
        selStart: sel.start,
        selEnd: sel.end,
        parentId: slot.id,
        priority: slot.element.priority,
        elementId: newElementId(),
        eventId: newEventId(),
        device: await this.store.getDeviceId(),
        lamport: now,
        now,
        schedule: topicStateToSchedule(newTopicState(this.settings, new Date(now))),
      });
      await this.store.appendEvent(ev);
      created = ev.payload.element as IrElement;
      this.elementsById.set(created.id, created);
      const promote =
        opts?.promote ?? this.settings.extractCreatesStandaloneNote;
      if (created && promote && this.commitPromoteExtract) {
        await this.commitPromoteExtract(created.id, created);
      }
      this.adoptElement(created);
      if (!opts?.silent) {
        this.flash(`Extracted · ${this.remainingInSession()} left`);
      }
      this.onChange?.();
    } catch (e) {
      console.error("Incremental Reading: anchored extract failed", e);
      new Notice(
        "Incremental Reading: could not record the extract in the store. See the developer console.",
      );
    }
    await this.reloadCurrentRaw();
    // Await the cache rebuild so the just-created extract's range is in
    // `getSourceExtractRanges` before the re-render reads from it; without
    // this the new highlight only appears after the next unrelated reconcile.
    await this.refreshDecorations?.();
    await this.renderCard();
    return created;
  }

  public async handleCloze() {
    const slot = this.current;
    if (!slot || !this.canMakeClozeChild()) return;
    const sel = this.resolveSelection();
    if (!sel.ok) {
      if (sel.renderedText?.trim()) {
        await this.switchToEditForExactSelection(sel.renderedText);
        return;
      }
      new Notice(`Incremental Reading: ${sel.reason}`);
      return;
    }
    const dock = this.contentEl.querySelector(".ir-review-dock");
    if (!(dock instanceof HTMLElement)) {
      new Notice("Incremental Reading: review dock is not ready.");
      return;
    }
    const hintR = await promptClozeHintInline(dock);
    if (!hintR.ok) return;
    await this.commitCloze(slot, sel, hintR.hint);
  }

  /** Vault file for the card under review, when the slot is file-backed. */
  getCurrentReviewFile(): TFile | null {
    return this.current?.file ?? null;
  }

  /**
   * Radial-menu entries while the IR review leaf is active (no MarkdownView).
   * Selection-based extract/cloze plus cursor/bulk helpers on the card body.
   */
  buildHubExtractEntries(
    onBulkExtract: (
      source: TFile,
      spans: Span[],
      headline: string,
    ) => Promise<void>,
    onExtractToNote?: () => Promise<void>,
  ): IrHubEntry[] {
    const out: IrHubEntry[] = [];
    const slot = this.current;
    if (!slot) return out;

    const selRes = this.resolveSelection();
    const hasSel = selRes.ok;

    if (this.canMakeChild()) {
      if (hasSel) {
        out.push({
          title: "Extract selection",
          description: "Anchored extract from the selected span in this card.",
          icon: "scissors",
          run: () => void this.handleExtract(),
        });
        if (onExtractToNote && !this.settings.extractCreatesStandaloneNote) {
          out.push({
            title: "Extract to standalone note",
            description:
              "One-shot: create a standalone note without changing Settings (Alt+Shift+X).",
            icon: "file-plus",
            run: () => void onExtractToNote(),
          });
        }
      }
      if (this.canMakeClozeChild() && hasSel) {
        out.push({
          title: "Cloze selection",
          description: "New cloze item from the selected span.",
          icon: "brackets",
          run: () => void this.handleCloze(),
        });
      }
    }

    const reading = this.isReading(slot);
    if (reading || !slot.file) return out;

    const body = this.currentRaw;
    const cursor = this.reviewBodyCursor(hasSel ? selRes : null);
    const range: Span | null =
      hasSel && selRes.ok
        ? { start: selRes.start, end: selRes.end }
        : null;

    if (findParagraphAtOffset(body, cursor)) {
      out.push({
        title: "Extract paragraph at cursor",
        icon: "pilcrow",
        run: () => void this.extractSpanInReview(
          findParagraphAtOffset(body, cursor)!,
        ),
      });
    }
    if (findHeadingSectionAtOffset(body, cursor)) {
      out.push({
        title: "Extract heading section",
        icon: "heading",
        run: () => void this.extractSpanInReview(
          findHeadingSectionAtOffset(body, cursor)!,
        ),
      });
    }

    const bqs = findAllBlockquotes(body, range ?? undefined);
    if (bqs.length >= 2 || (bqs.length === 1 && range)) {
      out.push({
        title: `Extract every blockquote (${bqs.length})`,
        icon: "quote",
        run: () =>
          void onBulkExtract(slot.file!, bqs, "Blockquotes extracted"),
      });
    }
    if (range) {
      const items = findAllListItems(body, range);
      if (items.length >= 2) {
        out.push({
          title: `Extract every list item (${items.length})`,
          icon: "list",
          run: () =>
            void onBulkExtract(slot.file!, items, "List items extracted"),
        });
      }
      const paras = findAllParagraphs(body, range);
      if (paras.length >= 2) {
        out.push({
          title: `Extract every paragraph (${paras.length})`,
          icon: "align-left",
          run: () =>
            void onBulkExtract(slot.file!, paras, "Paragraphs extracted"),
        });
      }
    }

    return out;
  }

  private reviewBodyCursor(
    sel: { start: number; end: number } | null,
  ): number {
    if (this.editing) {
      const ta = this.cardHostEl?.querySelector<HTMLTextAreaElement>(
        ".ir-review-textarea",
      );
      if (ta) return ta.selectionStart ?? 0;
    }
    if (sel) return sel.start;
    const slot = this.current;
    if (slot && this.isReading(slot)) {
      const bm = getBookmark(this.bookmarks, slot.id);
      if (bm) return this.bodyOffsetFromLineCh(this.currentRaw, bm.line, bm.ch);
    }
    return 0;
  }

  private bodyOffsetFromLineCh(body: string, line: number, ch: number): number {
    const lines = body.split("\n");
    let off = 0;
    const cap = Math.min(line, lines.length - 1);
    for (let i = 0; i < cap; i += 1) off += lines[i]!.length + 1;
    if (line < lines.length) off += Math.min(ch, lines[line]!.length);
    return Math.min(body.length, Math.max(0, off));
  }

  private async extractSpanInReview(span: Span): Promise<void> {
    const slot = this.current;
    if (!slot || !this.canMakeChild()) return;
    const text = this.currentRaw.slice(span.start, span.end).trim();
    if (!text) {
      new Notice("Incremental Reading: nothing to extract.");
      return;
    }
    await this.flushEdits();
    const bodyBeforeExtract = this.currentRaw;
    const sourcePath =
      slot.file?.path ?? this.resolveProvenanceSourcePath(slot);
    if (!sourcePath) {
      new Notice(
        "Incremental Reading: could not resolve a vault path for this extract.",
      );
      return;
    }
    try {
      const now = Date.now();
      const ev = buildExtractEvent({
        sourcePath,
        sourceText: bodyBeforeExtract,
        selStart: span.start,
        selEnd: span.end,
        parentId: slot.id,
        priority: slot.element.priority,
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
      const created = ev.payload.element as IrElement;
      this.elementsById.set(created.id, created);
      this.adoptElement(created);
      this.flash(`Extracted · ${this.remainingInSession()} left`);
      this.onChange?.();
    } catch (e) {
      console.error("Incremental Reading: anchored extract failed", e);
      new Notice(
        "Incremental Reading: could not record the extract. See the developer console.",
      );
    }
    await this.reloadCurrentRaw();
    await this.refreshDecorations?.();
    await this.renderCard();
  }

  private async commitCloze(
    slot: ReviewSlot,
    sel: { text: string; start: number; end: number },
    hint: string,
  ): Promise<void> {
    // On a cloze item, growing the same note with the next cN group is what
    // the user expects (Anki-style multi-cloze): the edit appears on the
    // element being reviewed, and existing groups stay distinct cards.
    if (slot.element.type === "item" && slot.file) {
      await this.addClozeToCurrentItem(slot, slot.file, sel, hint);
      return;
    }
    const placement = slot.file ?? this.resolvePlacementFile(slot);
    if (!placement) {
      new Notice(
        "Incremental Reading: could not find a vault-backed topic to place this cloze item.",
      );
      return;
    }
    await this.flushEdits();
    const result = await createClozeFromText(
      this.app,
      placement,
      this.currentRaw,
      sel.start,
      sel.end,
      this.settings,
      hint,
    );
    const created = await this.afterChildCreated(result);
    if (!slot.file && result.file) {
      const id = elementIdForPath(result.file.path);
      await this.emit("reparented", id, { parentId: slot.id });
      const el = this.elementsById.get(id);
      if (el) {
        this.elementsById.set(id, { ...el, parentId: slot.id });
      }
    }
    if (created) {
      const latest = this.elementsById.get(created.id) ?? created;
      await this.attachClozeSourceAnchor(latest, slot, sel);
      const withAnchor = this.elementsById.get(latest.id) ?? latest;
      this.adoptElement(withAnchor);
    }
    // Source remains pristine under DESIGN §Q3: the cloze item carries the
    // `{{cN::...}}` syntax in its own note and the queue records the new
    // element, so there is no source-mutation step here any more.
    await this.reloadCurrentRaw();
    await this.refreshDecorations?.();
    await this.renderCard();
    if (result.file) {
      this.flash(`Cloze item created · ${this.remainingInSession()} left`);
    }
  }

  /**
   * Record a text-quote anchor on a new cloze item so source decorations
   * can paint the already-clozed span (SuperMemo coverage). Store-only
   * extracts map the selection through the extract's own anchor.
   */
  private async attachClozeSourceAnchor(
    item: IrElement,
    slot: ReviewSlot,
    sel: { start: number; end: number; text: string },
  ): Promise<void> {
    const anchor = await this.clozeAnchorForSelection(slot, sel);
    if (!anchor) return;
    await this.emit("anchor-repaired", item.id, { anchor });
    this.elementsById.set(item.id, { ...item, anchor });
  }

  private async clozeAnchorForSelection(
    slot: ReviewSlot,
    sel: { start: number; end: number; text: string },
  ): Promise<Anchor | null> {
    if (sel.end <= sel.start) return null;
    if (slot.file && !isPdfPath(slot.file.path)) {
      return buildTextQuoteAnchor(
        slot.file.path,
        this.currentRaw,
        sel.start,
        sel.end,
      );
    }
    const a = slot.element.anchor;
    if (!a || a.pdf || isPdfPath(a.sourcePath)) return null;
    const file = this.app.vault.getAbstractFileByPath(a.sourcePath);
    if (!(file instanceof TFile)) return null;
    const body = stripFrontmatter(await this.app.vault.cachedRead(file));
    const r = resolveAnchor(a, body);
    if (r.status !== "ok") return null;
    const start = r.start + sel.start;
    const end = r.start + sel.end;
    if (end > r.end || start < r.start) return null;
    return buildTextQuoteAnchor(a.sourcePath, body, start, end);
  }

  /**
   * Splice a new cloze deletion into the current item's body using the next
   * free `cN` group (preserves existing clozes as distinct cards), persist
   * the edit, and re-render the same slot so the new blank appears in place.
   */
  private async addClozeToCurrentItem(
    _slot: ReviewSlot,
    file: TFile,
    sel: { text: string; start: number; end: number },
    hint: string,
  ): Promise<void> {
    await this.flushEdits();
    const groupN = nextClozeNumber(this.currentRaw);
    const { body, answer } = spliceClozeIntoText(
      this.currentRaw,
      sel.start,
      sel.end,
      hint,
      groupN,
    );
    if (!answer.trim()) {
      new Notice("Incremental Reading: nothing selected.");
      return;
    }
    await saveBody(this.app, file, body);
    this.currentRaw = body;
    this.rawOnDisk = body;
    this.flash(`Cloze c${groupN} added`);
    this.onChange?.();
    await this.renderCard();
  }

  /** Re-read the current slot's note body after a child was created from it. */
  private async reloadCurrentRaw(): Promise<void> {
    const slot = this.current;
    if (!slot) return;
    if (slot.file) {
      if (isPdfPath(slot.file.path)) return;
      try {
        const body = stripFrontmatter(await this.app.vault.read(slot.file));
        this.currentRaw = body;
        this.rawOnDisk = body;
      } catch {
        /* file may have been deleted */
      }
      return;
    }
    if (slot.element.text) {
      this.currentRaw = stripExtractMarks(slot.element.text);
      this.rawOnDisk = this.currentRaw;
    }
  }

  private async afterChildCreated(
    result: IrNoteResult,
  ): Promise<IrElement | undefined> {
    if (!result.file) {
      new Notice(`Incremental Reading: ${result.error}`);
      return;
    }
    let created: IrElement | undefined;
    try {
      let fm: Record<string, unknown> = {};
      await this.app.fileManager.processFrontMatter(result.file, (f) => {
        fm = { ...f };
      });
      const events = migrateNotes(
        [{ path: result.file.path, frontmatter: fm }],
        Date.now(),
      );
      for (const ev of events) {
        await this.store.appendEvent(ev);
        if (ev.kind === "element-created") {
          created = ev.payload.element as IrElement;
          this.elementsById.set(created.id, created);
        }
      }
    } catch (e) {
      console.error("Incremental Reading: recording child element failed", e);
    }
    return created;
  }

  private advance() {
    void this.persistBookmarks();
    this.index += 1;
    this.revealed = false;
    this.editing = false;
    this.loadedSlotId = null;
    if (!this.current) {
      this.sessionComplete = true;
      void this.renderCard();
      return;
    }
    void this.renderCard();
  }

  /**
   * Move to the prior element in this session's queue. Does not undo FSRS or
   * topic schedules already written for cards you moved past — it only
   * rewinds the in-session cursor (e.g. to add another cloze on a reading card).
   */
  private async previous() {
    if (this.index === 0) return;
    await this.flushEdits();
    void this.persistBookmarks();
    this.index -= 1;
    this.revealed = false;
    this.editing = false;
    this.loadedSlotId = null;
    this.sessionComplete = false;
    void this.renderCard();
  }

  private async grade(g: Grade) {
    const slot = this.current;
    if (!slot) return;
    await this.flushEdits();

    const next = schedule(storedToCard(slot.element.card), g);
    const stored = cardToStored(next);

    const div =
      this.settings.showDivergencePicker && slot.element.card
        ? checkGradeDivergence(slot.element.card, stored, g, Date.now())
        : null;

    if (div) {
      this.showDivergencePicker(slot, g, next, stored, div);
      return;
    }

    await this.applyGrade(slot, next, stored);
  }

  private async applyGrade(
    slot: ReviewSlot,
    next: import("ts-fsrs").Card,
    stored: import("./ir/model").StoredCard,
  ) {
    await this.emit("graded", slot.id, { card: stored });
    slot.element = { ...slot.element, card: stored };
    if (slot.file) {
      await quietFrontmatterWrite(async () => {
        await this.app.fileManager.processFrontMatter(slot.file!, (f) => {
          writeCardToFrontmatter(f, next);
        });
      }, "grade");
    }
    this.advance();
  }

  /**
   * Inline divergence picker (DESIGN.md Section 5, UI commitment #6).
   * Shown when FSRS and SM-2 predict significantly different intervals.
   */
  private showDivergencePicker(
    slot: ReviewSlot,
    g: Grade,
    fsrsCard: import("ts-fsrs").Card,
    fsrsStored: import("./ir/model").StoredCard,
    div: DivergenceCheck,
  ) {
    const existing = this.contentEl.querySelector(".ir-divergence-bar");
    if (existing) existing.remove();

    const dock = this.contentEl.querySelector(".ir-review-dock");
    if (!dock) {
      void this.applyGrade(slot, fsrsCard, fsrsStored);
      return;
    }

    const bar = createDiv({ cls: "ir-divergence-bar" });
    dock.prepend(bar);

    bar.createSpan({
      cls: "ir-divergence-msg",
      text: div.config.message,
    });

    const btnRow = bar.createDiv({ cls: "ir-divergence-buttons" });

    for (const m of div.config.members) {
      const btn = btnRow.createEl("button", {
        cls: m.id === div.config.primaryId ? "mod-cta" : "",
        text: `${m.id}: ${m.intervalDays}d`,
      });
      btn.addEventListener("click", () => {
        bar.remove();
        if (m.id === "FSRS") {
          void this.applyGrade(slot, fsrsCard, fsrsStored);
        } else {
          const overridden = {
            ...fsrsStored,
            due: div.sm2Due,
            scheduledDays: div.sm2IntervalDays,
          };
          const overriddenCard = storedToCard(overridden);
          void this.applyGrade(slot, overriddenCard, overridden);
        }
      });
    }
  }

  private async next() {
    const slot = this.current;
    if (!slot) return;
    await this.flushEdits();

    const cur =
      scheduleToTopicState(slot.element.schedule) ??
      ({
        dueMs: Date.now(),
        interval: 0,
        aFactor: this.settings.topicAFactor,
      } as TopicState);
    const advanced = advanceTopic(cur, this.settings);
    await this.emit("topic-advanced", slot.id, {
      schedule: topicStateToSchedule(advanced),
    });
    slot.element = {
      ...slot.element,
      schedule: topicStateToSchedule(advanced),
    };
    if (slot.file) {
      await quietFrontmatterWrite(async () => {
        await this.app.fileManager.processFrontMatter(slot.file!, (f) => {
          writeTopicToFrontmatter(f, advanced);
        });
      }, "topic-advanced");
    }
    this.advance();
  }

  private async later() {
    const slot = this.current;
    if (!slot) return;
    await this.flushEdits();

    const cur =
      scheduleToTopicState(slot.element.schedule) ??
      ({
        dueMs: Date.now(),
        interval: 0,
        aFactor: this.settings.topicAFactor,
      } as TopicState);
    const postponed = laterToday(cur);
    await this.emit("topic-advanced", slot.id, {
      schedule: topicStateToSchedule(postponed),
    });
    slot.element = {
      ...slot.element,
      schedule: topicStateToSchedule(postponed),
    };
    if (slot.file) {
      await quietFrontmatterWrite(async () => {
        await this.app.fileManager.processFrontMatter(slot.file!, (f) => {
          writeTopicToFrontmatter(f, postponed);
        });
      }, "later");
    }
    this.advance();
  }

  private async dismiss() {
    const slot = this.current;
    if (!slot) return;
    await this.flushEdits();
    await this.emit("dismiss-set", slot.id, { dismissed: true });
    slot.element = { ...slot.element, dismissed: true };
    if (slot.file) {
      await quietFrontmatterWrite(
        () => setDismissed(this.app, slot.file!, true).then(() => undefined),
        "dismiss",
      );
    }
    if (this.index + 1 < this.queue.length) {
      this.flash(`Dismissed · ${this.queue.length - this.index - 1} left`);
    }
    this.advance();
  }
}
