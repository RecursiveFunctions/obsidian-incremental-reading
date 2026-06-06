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
import type { ReviewSlot } from "./review";
import { setBookmark, getBookmark, type BookmarkMap } from "./ir/bookmark";
import { findExtractRange } from "./ir/extract-range";
import {
  stripFrontmatter,
  saveBody,
  stripExtractMarks,
} from "./ir/frontmatter-body";
import { mapRenderedSelectionToRaw } from "./ir/selection-map";
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

  /** True when the body is shown as an editable textarea, not rendered. */
  private editing = false;
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
     * Resolved body-relative ranges of every extract anchored to the given
     * source path. Used by the review side panel (§Q3) to highlight every
     * sibling extract in the source context, not just the focused one. The
     * host plugin reads this from the decoration cache, which is rebuilt
     * after every reconcile, so the callback is cheap.
     */
    private readonly getSourceExtractRanges?: (
      path: string,
    ) => ReadonlyArray<{ start: number; end: number }>,
    /**
     * Rebuild the host's decoration cache so a just-created extract is in
     * `getSourceExtractRanges` before the next `renderCard`. Without this
     * the cache refresh races the re-render and the new extract appears
     * unhighlighted in the main body until the next reconcile.
     */
    private readonly refreshDecorations?: () => Promise<void>,
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
    this.bookmarks = await this.store.loadBookmarks();
    this.contentEl.addClass("ir-review-modal");
    this.contentEl.addClass("ir-review-layout");
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
            !this.current || this.editing || this.isTypingInInput(),
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
    const scope = new Scope(this.app.scope);
    this.scope = scope;
    scope.register([], "Escape", (evt) => {
      if (!this.editing) return; // pass through to Obsidian's default
      evt.preventDefault();
      this.editing = false;
      void this.renderCard();
      return false;
    });

    this.registerDomEvent(this.contentEl, "keydown", (evt: KeyboardEvent) => {
      if (evt.key === "Escape" && this.editing) {
        evt.preventDefault();
        evt.stopPropagation();
        this.editing = false;
        void this.renderCard();
        return;
      }

      // Use `code` so Alt+X / Alt+Z work across layouts (Alt often changes `key`).
      if (
        evt.altKey &&
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

      // Space: reveal cloze or advance reading (only when not typing).
      if (evt.key === " ") {
        if (!slot || typing) return;
        if (this.isReading(slot)) {
          evt.preventDefault();
          void this.next();
        } else if (!this.revealed) {
          evt.preventDefault();
          this.revealed = true;
          void this.renderCard();
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
    this.captureBookmark();
    this.swipeGestureCleanup?.();
    this.swipeGestureCleanup = undefined;
    this.mobileKeyboardCleanup?.();
    this.mobileKeyboardCleanup = undefined;
    this.mobileOrientationCleanup?.();
    this.mobileOrientationCleanup = undefined;
    this.swipeHintEl = undefined;
    this.cardHostEl = undefined;
    this.contentEl.empty();
    this.onSlotChange?.(null);
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
    if (!Platform.isMobile) return;
    if (this.editing) {
      this.contentEl.addClass("ir-review--editing");
      this.layoutMobileEditPane();
    } else {
      this.contentEl.removeClass("ir-review--editing");
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

  /** Whether typing characters should go to a textarea, not to hotkeys. */
  private isTypingInInput(): boolean {
    const active = this.contentEl.ownerDocument.activeElement;
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

  private renderMobileSourceToggle(
    parent: HTMLElement,
    title: string,
    masked: boolean,
  ): void {
    const label = masked
      ? "Show source (hidden until reveal)"
      : `Show source · ${title}`;
    parent
      .createEl("button", {
        cls: "ir-review-source-toggle",
        text: label,
        type: "button",
      })
      .addEventListener("click", () => {
        this.mobileSourceExpanded = true;
        void this.renderCard();
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
      items.push({
        label: this.editing ? "Preview" : "Edit",
        run: () => {
          this.editing = !this.editing;
          void this.renderCard();
        },
      });
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
      items.push({
        label: this.editing ? "Done editing" : "Edit",
        run: () => {
          this.editing = !this.editing;
          void this.renderCard();
        },
      });
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
      if (slot.file) await setPriority(this.app, slot.file, n);
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
    if (slot.file) {
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
    // Preview). **Edit** or a click on the card body (outside links) opens the
    // raw textarea. Extract/cloze from the preview use DOM selection → source
    // offsets (works for typical text; switch to Edit if the tool reports
    // ambiguity across heavy formatting).
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
     * siblings of the focused card. Each renders as `mark.ir-extract-source`
     * so the user sees every passage they've extracted from this note while
     * reviewing one of them.
     */
    siblingRanges: ReadonlyArray<{ start: number; end: number }>;
  } | null> {
    const pid = slot.element.parentId;
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
    // Decoration cache stores body-relative resolved ranges; remove the
    // focused card's own range so it isn't double-marked when we splice.
    const allRanges = path
      ? (this.getSourceExtractRanges?.(path) ?? [])
      : [];
    const siblingRanges = highlightRange
      ? allRanges.filter(
          (r) =>
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
   * Snapshot the current scroll position and cursor for the active reading
   * slot. No-op for non-reading elements (items have no meaningful position
   * to resume). Returns silently when nothing is visible yet.
   */
  private captureBookmark(): void {
    const slot = this.current;
    if (!slot || !this.isReading(slot)) return;

    const scroll = this.contentEl.querySelector<HTMLElement>(
      ".ir-review-main-col .ir-review-scroll",
    );
    const scrollTop = scroll?.scrollTop ?? 0;

    let charOffset = 0;
    if (this.editing) {
      const ta = this.contentEl.querySelector<HTMLTextAreaElement>(
        ".ir-review-textarea",
      );
      if (ta) charOffset = ta.selectionStart ?? 0;
    }

    this.bookmarks = setBookmark(this.bookmarks, {
      elementId: slot.id,
      line: charOffset,
      ch: 0,
      scrollTop,
      updatedAt: Date.now(),
    });
  }

  /**
   * After the DOM for a reading slot has been painted, restore the
   * previously-saved scroll position (and cursor when editing).
   */
  private restoreBookmark(slot: ReviewSlot): void {
    if (!this.isReading(slot)) return;
    const bm = getBookmark(this.bookmarks, slot.id);
    if (!bm) return;

    requestAnimationFrame(() => {
      const scroll = this.contentEl.querySelector<HTMLElement>(
        ".ir-review-main-col .ir-review-scroll",
      );
      if (scroll) scroll.scrollTop = bm.scrollTop;

      if (this.editing) {
        const ta = this.contentEl.querySelector<HTMLTextAreaElement>(
          ".ir-review-textarea",
        );
        if (ta) {
          const pos = Math.min(bm.line, ta.value.length);
          ta.setSelectionRange(pos, pos);
          ta.scrollTop = bm.scrollTop;
        }
      }
    });
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

    const update = () => {
      const scrollable = scroll.scrollHeight - scroll.clientHeight;
      if (scrollable <= 1) {
        wrap.addClass("ir-reading-doc-progress--fits");
        this.contentEl.addClass("ir-review--reading-fits");
        fill.style.width = "100%";
        label.setText("Fits in view");
        return;
      }
      wrap.removeClass("ir-reading-doc-progress--fits");
      this.contentEl.removeClass("ir-review--reading-fits");
      const pct = Math.max(
        0,
        Math.min(100, (scroll.scrollTop / scrollable) * 100),
      );
      fill.style.width = `${pct}%`;
      label.setText(`${Math.round(pct)}% read`);
    };

    // Initial paint needs to wait for layout so scrollHeight is meaningful.
    // restoreBookmark also fires after a frame, so a single rAF tick lines
    // up the first measurement with the restored scrollTop.
    requestAnimationFrame(update);

    let raf = 0;
    scroll.addEventListener("scroll", () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        update();
      });
    });
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
    if (this.currentRaw === this.rawOnDisk) return;
    try {
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
    const host = this.cardHostEl ?? this.contentEl;
    host.empty();
    this.syncMobileEditChrome();

    const slot = this.current;
    this.onSlotChange?.(slot ? slot.id : null);
    if (!slot) {
      this.contentEl.removeClass("ir-review-has-context");
      const scroll = host.createDiv({ cls: "ir-review-scroll" });
      scroll.createEl("h3", { text: "No active review session" });
      scroll.createEl("p", {
        text:
          "This pane has no queue loaded. That usually means it was restored " +
          "from a saved workspace (for example after a plugin update) while " +
          "the review session data had already been cleared. Close this tab, " +
          "then start review from the IR queue in the status bar or with Alt+R.",
      });
      scroll
        .createEl("button", { text: "Close", cls: "mod-cta" })
        .addEventListener("click", () => this.leaf.detach());
      return;
    }

    await this.ensureLoaded(slot);

    const sourceCtx = await this.loadSourceContext(slot);
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
      } else {
        const ctxBody = ctxScroll.createDiv({
          cls: "ir-review-context-markdown ir-review-body",
        });
        // §Q3 review-pane decorations: splice a `<mark>` for every extract
        // anchored to this source. The focused card carries the legacy
        // `ir-extract-highlight` class (preserves scroll-into-view CSS);
        // siblings carry `ir-extract-source` (matches the editor decoration
        // and the legacy persisted-mark CSS). Marks are spliced in descending
        // start order so each splice never shifts a later one; siblings that
        // overlap the focused range are skipped to avoid nested HTML.
        const focused = sourceCtx.highlightRange;
        const marks: Array<{
          start: number;
          end: number;
          cls: "ir-extract-highlight" | "ir-extract-source";
        }> = [];
        if (focused) {
          marks.push({ ...focused, cls: "ir-extract-highlight" });
        }
        // Sort siblings by start ascending so the overlap walk below visits
        // them in document order. The focused range goes in last and wins
        // any conflict with a sibling at the same position.
        const sortedSiblings = [...sourceCtx.siblingRanges].sort(
          (a, b) => a.start - b.start,
        );
        let lastEnd = -1;
        for (const r of sortedSiblings) {
          if (
            focused &&
            r.start < focused.end &&
            focused.start < r.end
          ) {
            continue;
          }
          if (r.start < lastEnd) continue; // overlaps a prior accepted sibling
          marks.push({ start: r.start, end: r.end, cls: "ir-extract-source" });
          lastEnd = r.end;
        }
        marks.sort((a, b) => b.start - a.start);
        let ctxRaw = sourceCtx.raw;
        for (const m of marks) {
          ctxRaw =
            ctxRaw.slice(0, m.start) +
            `<mark class="${m.cls}">` +
            ctxRaw.slice(m.start, m.end) +
            "</mark>" +
            ctxRaw.slice(m.end);
        }
        await MarkdownRenderer.render(
          this.app,
          ctxRaw,
          ctxBody,
          sourceCtx.path,
          this,
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

    if (
      sourceCtx &&
      Platform.isMobile &&
      !this.mobileSourceExpanded &&
      !mobileCompactEdit
    ) {
      this.renderMobileSourceToggle(scroll, sourceCtx.title, maskClozeChrome);
    }

    if (mobileCompactEdit) {
      this.renderEditor(scroll);
    } else {
      const pct = this.queue.length > 0
        ? Math.round(((this.index) / this.queue.length) * 100)
        : 0;
      const progressWrap = mainCol.createDiv({ cls: "ir-review-progress-bar" });
      const fill = progressWrap.createDiv({ cls: "ir-review-progress-fill" });
      fill.style.width = `${pct}%`;

      const remaining = this.queue.length - this.index;
      const remainingByType = { topics: 0, extracts: 0, items: 0 };
      for (let i = this.index; i < this.queue.length; i++) {
        const t = this.queue[i]!.element.type;
        if (t === "topic") remainingByType.topics++;
        else if (t === "extract") remainingByType.extracts++;
        else remainingByType.items++;
      }
      const parts: string[] = [];
      if (remainingByType.topics > 0) {
        parts.push(
          `${remainingByType.topics} topic${remainingByType.topics !== 1 ? "s" : ""}`,
        );
      }
      if (remainingByType.extracts > 0) {
        parts.push(
          `${remainingByType.extracts} extract${remainingByType.extracts !== 1 ? "s" : ""}`,
        );
      }
      if (remainingByType.items > 0) {
        parts.push(
          `${remainingByType.items} item${remainingByType.items !== 1 ? "s" : ""}`,
        );
      }

      const label = reviewHeadlineLabel(slot.element, maskClozeChrome);
      scroll.createEl("div", {
        cls: "ir-review-progress",
        text:
          `${this.index + 1} of ${this.queue.length}  ·  ` +
          `${reading ? "Reading" : "Review"}  ·  ${label}` +
          (parts.length > 0 ? `  ·  ${parts.join(", ")} left` : ""),
      });

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
        this.renderEditor(scroll);
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
      if (reading) this.restoreBookmark(slot);
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
      this.ensureFocus();
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
        const text = Platform.isMobile ? gLabel : `${gLabel} (${key})`;
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
    this.ensureFocus();
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
    new Notice(
      `Incremental Reading: undid grade for "${result.targetLabel}".`,
    );
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
    // §Q3 main-column decoration: paint extract anchors on the body the
    // user is reviewing, so a topic-as-source shows where past extracts
    // sit (the side column was already covered; the main column was
    // missed in the §Q3 follow-up). Skip for cloze cards — the cloze
    // transform produces HTML and offset math would corrupt it; cloze
    // item bodies are not extract sources in practice either.
    const decoratedRaw =
      !isCloze && slot?.file
        ? this.spliceMainColumnMarks(raw, slot.file.path)
        : raw;
    const shown =
      isCloze && !this.revealed
        ? transformClozes(decoratedRaw, ({ hint }, inCodeSpan) => {
            const hintPart = hint
              ? ` <span class="ir-cloze-hint">(${escapeClozeHtmlFragment(hint)})</span>`
              : "";
            const html = `<mark class="ir-cloze-elision"><span class="ir-cloze-gap">[ ... ]</span>${hintPart}</mark>`;
            return inCodeSpan ? `<code>${html}</code>` : html;
          })
        : isCloze
          ? transformClozes(decoratedRaw, ({ answer }, inCodeSpan) => {
              const html = `<mark class="ir-cloze-answer">${escapeClozeHtmlFragment(answer)}</mark>`;
              return inCodeSpan ? `<code>${html}</code>` : html;
            })
          : decoratedRaw;
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
    this.wireMarkdownLinks(body, renderSourcePath);

    // Click (not mousedown) so drag-to-select in preview still works for
    // extract/cloze; skip embedded controls so links and task checkboxes behave.
    if (slot && this.canEdit() && !this.editing) {
      body.addClass("ir-review-main-body--click-to-edit");
      body.addEventListener("click", (evt: MouseEvent) => {
        const el = evt.target as HTMLElement | null;
        if (!el) return;
        if (
          el.closest(
            "a, button, input, select, textarea, iframe, video, audio",
          )
        ) {
          return;
        }
        this.editing = true;
        void this.renderCard();
      });
    }
  }

  /**
   * Splice `<mark class="ir-extract-source">` around every extract anchored
   * to `path`. Mirrors the side-column logic but without a "focused" range —
   * in the main column the body itself IS the source, so every anchor is a
   * sibling. Overlapping anchors are kept in left-to-right precedence so the
   * splice never produces nested HTML; the splice walks descending so each
   * insertion leaves earlier offsets untouched.
   */
  private spliceMainColumnMarks(raw: string, path: string): string {
    const ranges = this.getSourceExtractRanges?.(path) ?? [];
    if (ranges.length === 0) return raw;
    const sorted = [...ranges].sort((a, b) => a.start - b.start);
    const accepted: { start: number; end: number }[] = [];
    let lastEnd = -1;
    for (const r of sorted) {
      if (r.start < lastEnd) continue;
      accepted.push(r);
      lastEnd = r.end;
    }
    accepted.sort((a, b) => b.start - a.start);
    let out = raw;
    for (const r of accepted) {
      out =
        out.slice(0, r.start) +
        `<mark class="ir-extract-source">` +
        out.slice(r.start, r.end) +
        "</mark>" +
        out.slice(r.end);
    }
    return out;
  }

  private renderEditor(parent: HTMLElement) {
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
        this.editing = false;
        void this.renderCard();
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
        ta.setSelectionRange(ta.value.length, ta.value.length);
      });
    }
  }

  private renderEditToggle(parent: HTMLElement) {
    if (!this.canEdit()) return;
    const slot = this.current;
    const reading = !!(slot && this.isReading(slot));
    const label = this.editing
      ? reading
        ? "Preview"
        : "Done editing"
      : "Edit";
    parent
      .createEl("button", {
        text: label,
        cls: "ir-review-edit-toggle",
      })
      .addEventListener("click", () => {
        this.editing = !this.editing;
        void this.renderCard();
      });
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
    | { ok: false; reason: string } {
    if (this.editing) {
      const active = this.contentEl.ownerDocument.activeElement;
      if (!(active instanceof HTMLTextAreaElement)) {
        return { ok: false, reason: "Click into the editor first." };
      }
      const start = active.selectionStart ?? 0;
      const end = active.selectionEnd ?? 0;
      if (end <= start) return { ok: false, reason: "Nothing selected." };
      this.currentRaw = active.value;
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
        reason:
          "Selection spans formatting; switch to Edit mode for an exact cloze.",
      };
    }
    return {
      ok: true,
      text: mapped.text,
      start: mapped.start,
      end: mapped.end,
    };
  }

  public async handleExtract() {
    const slot = this.current;
    if (!slot || !this.canMakeChild()) return;
    const sel = this.resolveSelection();
    if (!sel.ok) {
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
      const created = ev.payload.element as IrElement;
      this.elementsById.set(created.id, created);
      const label = sourcePath.split("/").pop() ?? sourcePath;
      new Notice(
        `Extracted (anchored in "${label}", not a separate note).`,
      );
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
  }

  public async handleCloze() {
    const slot = this.current;
    if (!slot || !this.canMakeClozeChild()) return;
    const sel = this.resolveSelection();
    if (!sel.ok) {
      new Notice(`Incremental Reading: ${sel.reason}`);
      return;
    }
    this.showInlineHintPrompt(slot, sel);
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
      new Notice(`Extracted (anchored in "${labelFor(created)}").`);
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

  /**
   * Inline hint bar: replaces the modal so cloze creation stays in-pane
   * (UI commitment #6). Enter submits (empty = no hint), Esc cancels.
   */
  private showInlineHintPrompt(
    slot: ReviewSlot,
    sel: { text: string; start: number; end: number },
  ): void {
    const existing = this.contentEl.querySelector(".ir-hint-bar");
    if (existing) existing.remove();

    const dock = this.contentEl.querySelector(".ir-review-dock");
    if (!dock) return;

    const bar = createDiv({ cls: "ir-hint-bar" });
    dock.prepend(bar);

    bar.createSpan({
      cls: "ir-hint-bar-label",
      text: "Cloze hint (optional):",
    });
    const input = bar.createEl("input", {
      cls: "ir-hint-bar-input",
      type: "text",
      placeholder: "e.g. capital of France — Enter to confirm, Esc to cancel",
    });
    const submit = bar.createEl("button", {
      cls: "mod-cta ir-hint-bar-btn",
      text: "OK",
    });
    const cancel = bar.createEl("button", {
      cls: "ir-hint-bar-btn",
      text: "Cancel",
    });

    let finished = false;
    const finish = (hint: string | null) => {
      if (finished) return;
      finished = true;
      bar.remove();
      if (hint === null) return;
      if (hint.includes("::")) {
        new Notice(
          'Incremental Reading: hints cannot contain "::" (reserved for cloze syntax).',
        );
        return;
      }
      void this.commitCloze(slot, sel, hint);
    };

    // stopPropagation: finish() removes this input before bubble completes; the
    // contentEl handler would then see no focused input and treat Enter as Next.
    input.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        finish(input.value.trim());
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        finish(null);
      }
    });
    submit.addEventListener("click", () => finish(input.value.trim()));
    cancel.addEventListener("click", () => finish(null));

    requestAnimationFrame(() => input.focus());
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
    await this.afterChildCreated(result, "Cloze item created:");
    if (!slot.file && result.file) {
      const id = elementIdForPath(result.file.path);
      await this.emit("reparented", id, { parentId: slot.id });
      const el = this.elementsById.get(id);
      if (el) {
        this.elementsById.set(id, { ...el, parentId: slot.id });
      }
    }
    // Source remains pristine under DESIGN §Q3: the cloze item carries the
    // `{{cN::...}}` syntax in its own note and the queue records the new
    // element, so there is no source-mutation step here any more.
    await this.reloadCurrentRaw();
    await this.renderCard();
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
    new Notice(`Cloze c${groupN} added: "${answer}".`);
    this.onChange?.();
    await this.renderCard();
  }

  /** Re-read the current slot's note body after a child was created from it. */
  private async reloadCurrentRaw(): Promise<void> {
    const slot = this.current;
    if (!slot) return;
    if (slot.file) {
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

  private async afterChildCreated(result: IrNoteResult, verb: string) {
    if (!result.file) {
      new Notice(`Incremental Reading: ${result.error}`);
      return;
    }
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
          const el = ev.payload.element as IrElement;
          this.elementsById.set(el.id, el);
        }
      }
    } catch (e) {
      console.error("Incremental Reading: recording child element failed", e);
    }
    new Notice(`${verb} "${result.file.basename}".`);
  }

  private advance(doneVerb: string) {
    void this.persistBookmarks();
    this.index += 1;
    this.revealed = false;
    this.editing = false;
    this.loadedSlotId = null;
    if (!this.current) {
      new Notice(`${doneVerb}: ${this.queue.length} element(s).`);
      this.leaf.detach();
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
    void this.renderCard();
  }

  private async grade(g: Grade) {
    const slot = this.current;
    if (!slot) return;
    await this.flushEdits();

    const next = schedule(storedToCard(slot.element.card), g);
    const stored = cardToStored(next);

    const div = slot.element.card
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
      await this.app.fileManager.processFrontMatter(slot.file, (f) => {
        writeCardToFrontmatter(f, next);
      });
    }
    this.advance("Review complete");
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
      await this.app.fileManager.processFrontMatter(slot.file, (f) => {
        writeTopicToFrontmatter(f, advanced);
      });
    }
    this.advance("Reading session complete");
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
      await this.app.fileManager.processFrontMatter(slot.file, (f) => {
        writeTopicToFrontmatter(f, postponed);
      });
    }
    this.advance("Session complete");
  }

  private async dismiss() {
    const slot = this.current;
    if (!slot) return;
    await this.flushEdits();
    await this.emit("dismiss-set", slot.id, { dismissed: true });
    slot.element = { ...slot.element, dismissed: true };
    if (slot.file) await setDismissed(this.app, slot.file, true);
    new Notice(`Dismissed "${slot.file?.basename ?? slot.id}".`);
    this.advance("Session complete");
  }
}
