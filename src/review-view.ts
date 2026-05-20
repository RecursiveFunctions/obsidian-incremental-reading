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
  Notice,
  Platform,
  TFile,
  WorkspaceLeaf,
} from "obsidian";
import {
  createClozeFromText,
  createExtract,
  setDismissed,
  setPriority,
  type IrNoteResult,
} from "./ir-note";
import { CLOZE_RE, hasCloze } from "./cloze";
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
  writeTopicToFrontmatter,
  type TopicState,
} from "./topic";
import type { IrSettings } from "./settings";
import type { IrStore } from "./ir/store";
import { migrateNotes } from "./ir/migrate";
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
import { newEventId, type ElementId } from "./ir/ids";
import type { ReviewSlot } from "./review";

export const IR_REVIEW_VIEW_TYPE = "ir-review-view";

const GRADES: { grade: Grade; label: string; key: string }[] = [
  { grade: "again", label: "Again", key: "1" },
  { grade: "hard", label: "Hard", key: "2" },
  { grade: "good", label: "Good", key: "3" },
  { grade: "easy", label: "Easy", key: "4" },
];

const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n?/;

/** Drop the YAML frontmatter block so only the note body is rendered. */
function stripFrontmatter(content: string): string {
  return content.replace(FRONTMATTER_RE, "").trim();
}

/**
 * Write a new body back to a note while preserving its existing frontmatter
 * block byte-for-byte. The Obsidian `processFrontMatter` API only lets us
 * mutate frontmatter, not body, so we splice via `vault.modify` instead.
 */
async function saveBody(app: App, file: TFile, newBody: string): Promise<void> {
  const full = await app.vault.read(file);
  const fm = full.match(FRONTMATTER_RE);
  const prefix = fm ? fm[0] : "";
  await app.vault.modify(file, prefix + newBody.trimEnd() + "\n");
}

export class IrReviewView extends ItemView {
  private index = 0;
  private revealed = false;

  /** True when the body is shown as an editable textarea, not rendered. */
  private editing = false;
  /** Working text for the current slot; updated live by the textarea. */
  private currentRaw = "";
  /** Last known on-disk body for the current slot (for dirty-check). */
  private rawOnDisk = "";
  /** Which slot id `currentRaw`/`rawOnDisk` correspond to, if any. */
  private loadedSlotId: ElementId | null = null;
  /** True if the current slot's source note is missing from the vault. */
  private bodyMissing = false;

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
  ) {
    super(leaf);
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
    this.contentEl.addClass("ir-review-modal");
    this.contentEl.addClass("ir-review-layout");
    if (Platform.isMobile) {
      this.contentEl.addClass("ir-review--mobile");
    }

    this.registerDomEvent(this.contentEl, "keydown", (evt: KeyboardEvent) => {
      if (evt.altKey && (evt.key === "x" || evt.key === "X")) {
        if (this.canMakeChild()) {
          evt.preventDefault();
          void this.handleExtract();
        }
        return;
      }
      if (evt.altKey && (evt.key === "z" || evt.key === "Z")) {
        if (this.canMakeChild()) {
          evt.preventDefault();
          void this.handleCloze();
        }
        return;
      }
      if (evt.altKey) return;

      const slot = this.current;
      if (evt.key === " ") {
        if (!slot) return;
        if (this.isTypingInTextarea()) return;
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
      if (evt.key === "Enter") {
        if (slot && this.isReading(slot) && !this.isTypingInTextarea()) {
          evt.preventDefault();
          void this.next();
        }
        return;
      }
      if (evt.key === "l" || evt.key === "L") {
        if (
          slot &&
          this.isReading(slot) &&
          !this.isTypingInTextarea()
        ) {
          evt.preventDefault();
          void this.later();
        }
        return;
      }
      if (evt.key === "d" || evt.key === "D") {
        if (this.current && !this.isTypingInTextarea()) {
          evt.preventDefault();
          void this.dismiss();
        }
        return;
      }
      for (const { grade, key } of GRADES) {
        if (evt.key === key) {
          if (
            slot &&
            !this.isReading(slot) &&
            this.revealed &&
            !this.isTypingInTextarea()
          ) {
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
    this.contentEl.empty();
    void this.store
      .reconcile()
      .catch((e) => {
        console.error("Incremental Reading: reconcile after review failed", e);
      })
      .finally(() => this.onChange?.());
  }

  private get current(): ReviewSlot | undefined {
    return this.queue[this.index];
  }

  /** A reading element (topic/extract) is read and advanced, never graded. */
  private isReading(slot: ReviewSlot): boolean {
    return isReadType(slot.element.type);
  }

  /** Whether typing characters should go to a textarea, not to hotkeys. */
  private isTypingInTextarea(): boolean {
    const active = this.contentEl.ownerDocument.activeElement;
    return active instanceof HTMLTextAreaElement;
  }

  /**
   * Cloze items reveal the answer in raw form, so editing or making children
   * from them before reveal would leak it. Topics and extracts have no such
   * gate.
   */
  private canEdit(): boolean {
    const slot = this.current;
    if (!slot || !slot.file || this.bodyMissing) return false;
    if (this.isReading(slot)) return true;
    return this.revealed;
  }

  /**
   * Extract and cloze creation share an extra constraint with edit: the
   * source must be a topic or extract (items cannot have children), and for
   * items we'd be back to leaking the answer.
   */
  private canMakeChild(): boolean {
    const slot = this.current;
    if (!slot || !slot.file || this.bodyMissing) return false;
    return this.isReading(slot);
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

  /** Compact priority editor; reordering is a first-class IR action. */
  private renderPriorityRow(parent: HTMLElement, slot: ReviewSlot) {
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
  }

  /**
   * Load the current slot's body from disk on first sight, and reset edit
   * state. Re-renders of the same slot (e.g., after pressing Show answer or
   * toggling edit) reuse `currentRaw` so unsaved edits survive.
   */
  private async ensureLoaded(slot: ReviewSlot): Promise<void> {
    if (this.loadedSlotId === slot.id) return;
    if (slot.file) {
      this.rawOnDisk = stripFrontmatter(
        await this.app.vault.cachedRead(slot.file),
      );
      this.bodyMissing = false;
    } else {
      this.rawOnDisk =
        slot.element.text ||
        "_The source note for this element is no longer in the vault._";
      this.bodyMissing = true;
    }
    this.currentRaw = this.rawOnDisk;
    this.loadedSlotId = slot.id;
    this.editing = false;
  }

  /**
   * Parent note body or stored parent text for the side column (UI
   * commitment #2 — source context in the same review surface).
   */
  private async loadSourceContext(
    slot: ReviewSlot,
  ): Promise<{ title: string; raw: string; path: string } | null> {
    const pid = slot.element.parentId;
    if (!pid) return null;
    const parent = this.elementsById.get(pid);
    if (!parent) return null;
    if (parent.notePath) {
      const af = this.app.vault.getAbstractFileByPath(parent.notePath);
      if (af instanceof TFile) {
        const raw = stripFrontmatter(await this.app.vault.cachedRead(af));
        return {
          title: labelFor(parent),
          raw,
          path: parent.notePath,
        };
      }
    }
    const t = parent.text.trim();
    if (t.length > 0) {
      return {
        title: labelFor(parent),
        raw: t,
        path: slot.file?.path ?? parent.notePath ?? "",
      };
    }
    return null;
  }

  /**
   * Persist any pending edit to disk before advancing or creating a child.
   * Idempotent: re-flushing is a no-op when the buffer matches disk.
   */
  private async flushEdits(): Promise<void> {
    const slot = this.current;
    if (!slot || !slot.file || this.bodyMissing) return;
    if (this.currentRaw === this.rawOnDisk) return;
    try {
      await saveBody(this.app, slot.file, this.currentRaw);
      this.rawOnDisk = this.currentRaw;
    } catch (e) {
      console.error("Incremental Reading: saving edits failed", e);
      new Notice(
        "Incremental Reading: could not save your edits. See the developer console.",
      );
    }
  }

  private async renderCard() {
    const { contentEl } = this;
    contentEl.empty();

    const slot = this.current;
    if (!slot) {
      contentEl.removeClass("ir-review-has-context");
      const scroll = contentEl.createDiv({ cls: "ir-review-scroll" });
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
    if (sourceCtx) contentEl.addClass("ir-review-has-context");
    else contentEl.removeClass("ir-review-has-context");

    const columns = contentEl.createDiv({ cls: "ir-review-columns" });
    const reading = this.isReading(slot);
    const isCloze = !reading && hasCloze(this.currentRaw);
    const maskClozeChrome = !reading && isCloze && !this.revealed;

    if (sourceCtx) {
      const ctxCol = columns.createDiv({ cls: "ir-review-context-col" });
      const sourceHeaderText = maskClozeChrome
        ? "Source (hidden until reveal)"
        : `Source · ${sourceCtx.title}`;
      ctxCol.createEl("div", {
        cls: "ir-review-context-header",
        text: sourceHeaderText,
      });
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
        await MarkdownRenderer.render(
          this.app,
          sourceCtx.raw,
          ctxBody,
          sourceCtx.path,
          this,
        );
      }
    }

    const mainCol = columns.createDiv({ cls: "ir-review-main-col" });
    const scroll = mainCol.createDiv({ cls: "ir-review-scroll" });

    const label = reviewHeadlineLabel(slot.element, maskClozeChrome);
    scroll.createEl("div", {
      cls: "ir-review-progress",
      text:
        `${this.index + 1} of ${this.queue.length}  ·  ` +
        `${reading ? "Reading" : "Review"}  ·  ${label}`,
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

    const dock = contentEl.createDiv({ cls: "ir-review-dock" });
    const controls = dock.createEl("div", { cls: "ir-review-controls" });

    if (reading) {
      this.renderPriorityRow(controls, slot);
      const bar = controls.createEl("div", { cls: "ir-review-buttons" });
      this.renderChildButtons(bar);
      this.renderEditToggle(bar);
      bar
        .createEl("button", {
          text: this.labelWithHotkey("Next", "Space"),
          cls: "mod-cta",
        })
        .addEventListener("click", () => void this.next());
      bar
        .createEl("button", {
          text: this.labelWithHotkey("Later today", "L"),
        })
        .addEventListener("click", () => void this.later());
      bar
        .createEl("button", {
          text: this.labelWithHotkey("Dismiss", "D"),
        })
        .addEventListener("click", () => void this.dismiss());
      return;
    }

    if (isCloze && !this.revealed) {
      controls
        .createEl("button", {
          text: this.labelWithHotkey("Show answer", "Space"),
          cls: "mod-cta",
        })
        .addEventListener("click", () => {
          this.revealed = true;
          void this.renderCard();
        });
      return;
    }

    this.renderPriorityRow(controls, slot);
    const bar = controls.createEl("div", { cls: "ir-review-buttons" });
    this.renderEditToggle(bar);
    for (const { grade, label: gLabel, key } of GRADES) {
      const text = Platform.isMobile ? gLabel : `${gLabel} (${key})`;
      bar
        .createEl("button", { text })
        .addEventListener("click", () => void this.grade(grade));
    }
    bar
      .createEl("button", {
        text: this.labelWithHotkey("Dismiss", "D"),
      })
      .addEventListener("click", () => void this.dismiss());
  }

  private async renderBody(
    parent: HTMLElement,
    raw: string,
    isCloze: boolean,
  ): Promise<void> {
    const shown =
      isCloze && !this.revealed
        ? raw.replace(CLOZE_RE, "**[ ... ]**")
        : isCloze
          ? raw.replace(
              CLOZE_RE,
              (_m, _n, ans) =>
                `<mark class="ir-cloze-answer">${ans}</mark>`,
            )
          : raw;
    const body = parent.createEl("div", {
      cls: "ir-review-body ir-review-main-body",
    });
    const slot = this.current;
    await MarkdownRenderer.render(
      this.app,
      shown,
      body,
      slot?.file?.path ?? "",
      this,
    );
  }

  private renderEditor(parent: HTMLElement) {
    const ta = parent.createEl("textarea", { cls: "ir-review-textarea" });
    ta.value = this.currentRaw;
    ta.spellcheck = true;
    ta.addEventListener("input", () => {
      this.currentRaw = ta.value;
    });
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    });
  }

  private renderEditToggle(parent: HTMLElement) {
    if (!this.canEdit()) return;
    const label = this.editing ? "Done editing" : "Edit";
    parent
      .createEl("button", { text: label })
      .addEventListener("click", () => {
        this.editing = !this.editing;
        void this.renderCard();
      });
  }

  private renderChildButtons(parent: HTMLElement) {
    if (!this.canMakeChild()) return;
    parent
      .createEl("button", {
        text: this.labelWithHotkey("Extract", "Alt+X"),
      })
      .addEventListener("click", () => void this.handleExtract());
    parent
      .createEl("button", {
        text: this.labelWithHotkey("Cloze", "Alt+Z"),
      })
      .addEventListener("click", () => void this.handleCloze());
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
    if (!sel || sel.isCollapsed) {
      return { ok: false, reason: "Nothing selected." };
    }
    const bodyEl = this.contentEl.querySelector(".ir-review-main-body");
    if (!bodyEl || !sel.anchorNode || !bodyEl.contains(sel.anchorNode)) {
      return { ok: false, reason: "Selection must be inside the card body." };
    }
    const text = sel.toString();
    if (!text.trim()) return { ok: false, reason: "Nothing selected." };
    const first = this.currentRaw.indexOf(text);
    if (first === -1) {
      return {
        ok: false,
        reason:
          "Selection spans formatting; switch to Edit mode for an exact cloze.",
      };
    }
    if (this.currentRaw.indexOf(text, first + 1) !== -1) {
      return {
        ok: false,
        reason:
          "Selection is ambiguous (matches multiple spots); switch to Edit mode.",
      };
    }
    return { ok: true, text, start: first, end: first + text.length };
  }

  private async handleExtract() {
    const slot = this.current;
    if (!slot || !slot.file || !this.canMakeChild()) return;
    const sel = this.resolveSelection();
    if (!sel.ok) {
      new Notice(`Incremental Reading: ${sel.reason}`);
      return;
    }
    await this.flushEdits();
    const result = await createExtract(
      this.app,
      slot.file,
      sel.text,
      this.settings,
    );
    await this.afterChildCreated(result, "Extracted to");
  }

  private async handleCloze() {
    const slot = this.current;
    if (!slot || !slot.file || !this.canMakeChild()) return;
    const sel = this.resolveSelection();
    if (!sel.ok) {
      new Notice(`Incremental Reading: ${sel.reason}`);
      return;
    }
    await this.flushEdits();
    const result = await createClozeFromText(
      this.app,
      slot.file,
      this.currentRaw,
      sel.start,
      sel.end,
      this.settings,
    );
    await this.afterChildCreated(result, "Cloze item created:");
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
      for (const ev of events) await this.store.appendEvent(ev);
    } catch (e) {
      console.error("Incremental Reading: recording child element failed", e);
    }
    new Notice(`${verb} "${result.file.basename}".`);
  }

  private advance(doneVerb: string) {
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

  private async grade(grade: Grade) {
    const slot = this.current;
    if (!slot) return;
    await this.flushEdits();

    const next = schedule(storedToCard(slot.element.card), grade);
    const stored = cardToStored(next);
    await this.emit("graded", slot.id, { card: stored });
    slot.element = { ...slot.element, card: stored };
    if (slot.file) {
      await this.app.fileManager.processFrontMatter(slot.file, (f) => {
        writeCardToFrontmatter(f, next);
      });
    }
    this.advance("Review complete");
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
