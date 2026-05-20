/**
 * The review loop: find what is due, show it one element at a time, and
 * reschedule it.
 *
 * Source of truth is the plugin-owned store (Option 1, docs/DESIGN.md): the
 * queue is built from the folded event log, and every review action appends
 * an event. Frontmatter is *also* written on each action so the migration
 * fallback stays intact and a user can still read state in the note until
 * cutover is confirmed; nothing here ever reads frontmatter to decide the
 * queue.
 *
 * Two element classes, two models, matching SuperMemo:
 *
 *  - Items (cloze) are *recall tested*. Reveal the answer, then grade
 *    Again/Hard/Good/Easy; FSRS reschedules from the grade.
 *  - Topics and extracts are *read*, never graded. You press Next and the
 *    topic schedule stretches the interval by its A-Factor. "Later today"
 *    postpones without advancing; Dismiss holds it out of the queue.
 *
 * Priority (the SuperMemo 0-100 percentile that orders the queue) is editable
 * inline on every element, since reordering is a constant part of the flow.
 *
 * In-place editing and child-note creation are also first-class: while a
 * topic or extract is on screen the body can be edited (a textarea takes
 * over the rendered view), text can be selected and turned into a child
 * extract or cloze item, and edits auto-save when the card advances. For
 * cloze items, edit/extract/cloze are gated until the answer is revealed,
 * because the raw body is the answer.
 */

import {
  App,
  Component,
  MarkdownRenderer,
  Modal,
  Notice,
  TFile,
} from "obsidian";
import {
  createClozeFromText,
  createExtract,
  setDismissed,
  setPriority,
  type IrNoteResult,
} from "./ir-note";
import { interleavedQueue, type QueueEntry } from "./queue";
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
import type { LogState } from "./ir/log";
import { migrateNotes } from "./ir/migrate";
import {
  clampPriority,
  isReadType,
  type IrElement,
  type IrEventKind,
  type ReadSchedule,
} from "./ir/model";
import { ancestorChain, labelFor } from "./ir/labels";
import { newEventId, type ElementId } from "./ir/ids";

const GRADES: { grade: Grade; label: string; key: string }[] = [
  { grade: "again", label: "Again", key: "1" },
  { grade: "hard", label: "Hard", key: "2" },
  { grade: "good", label: "Good", key: "3" },
  { grade: "easy", label: "Easy", key: "4" },
];

/**
 * One element scheduled into the session: its current store state plus the
 * vault note that renders it (absent if the source note was removed; the
 * element survives on its stored text).
 */
export interface ReviewSlot {
  id: ElementId;
  element: IrElement;
  file: TFile | null;
}

function dueMsOf(el: IrElement): number {
  if (el.type === "item") return el.card?.due ?? NaN;
  return el.schedule?.due ?? NaN;
}

function scheduleToTopicState(s: ReadSchedule | undefined): TopicState | null {
  if (!s) return null;
  return { dueMs: s.due, interval: s.interval, aFactor: s.aFactor };
}

function topicStateToSchedule(t: TopicState): ReadSchedule {
  return { due: t.dueMs, interval: t.interval, aFactor: t.aFactor };
}

/**
 * The interleaved daily session, due now. Adapts the folded store state into
 * plain `QueueEntry` records and delegates ordering to the pure, unit-tested
 * `interleavedQueue`. The store is the only source consulted.
 */
export function dueQueue(
  app: App,
  reviewsPerReading: number,
  state: LogState,
  now: Date = new Date(),
): ReviewSlot[] {
  const slots = new Map<string, ReviewSlot>();
  const entries: QueueEntry[] = [];

  for (const el of state.elements.values()) {
    let file: TFile | null = null;
    if (el.notePath) {
      const af = app.vault.getAbstractFileByPath(el.notePath);
      file = af instanceof TFile ? af : null;
    }
    slots.set(el.id, { id: el.id, element: el, file });
    entries.push({
      id: el.id,
      type: el.type,
      priority: el.priority,
      dueMs: dueMsOf(el),
      dismissed: el.dismissed,
    });
  }

  return interleavedQueue(entries, reviewsPerReading, now.getTime())
    .map((id) => slots.get(id))
    .filter((s): s is ReviewSlot => s !== undefined);
}

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

export class ReviewModal extends Modal {
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
    app: App,
    private component: Component,
    private settings: IrSettings,
    private store: IrStore,
    private queue: ReviewSlot[],
    /**
     * All elements indexed by id, used to render the parent-chain
     * breadcrumb (UI commitment #5). Passed in rather than re-derived so
     * the modal does not need to touch the store mid-session.
     */
    private elementsById: Map<string, IrElement>,
    /**
     * Fired after any state change (grade, advance, postpone, dismiss,
     * child created) and on close. Lets the host plugin refresh the queue
     * load indicator without this module knowing about it.
     */
    private onChange?: () => void,
  ) {
    super(app);
  }

  onOpen() {
    this.modalEl.addClass("ir-review-modal");

    this.scope.register([], " ", (evt) => {
      const slot = this.current;
      if (!slot) return;
      // Space inside the textarea is a real space, not a hotkey.
      if (this.isTypingInTextarea()) return;
      if (this.isReading(slot)) {
        evt.preventDefault();
        void this.next();
      } else if (!this.revealed) {
        evt.preventDefault();
        this.revealed = true;
        void this.renderCard();
      }
    });
    this.scope.register([], "Enter", (evt) => {
      const slot = this.current;
      if (slot && this.isReading(slot) && !this.isTypingInTextarea()) {
        evt.preventDefault();
        void this.next();
      }
    });
    this.scope.register([], "l", (evt) => {
      const slot = this.current;
      if (
        slot &&
        this.isReading(slot) &&
        !this.isTypingInTextarea()
      ) {
        evt.preventDefault();
        void this.later();
      }
    });
    this.scope.register([], "d", (evt) => {
      if (this.current && !this.isTypingInTextarea()) {
        evt.preventDefault();
        void this.dismiss();
      }
    });
    for (const { grade, key } of GRADES) {
      this.scope.register([], key, (evt) => {
        const slot = this.current;
        if (
          slot &&
          !this.isReading(slot) &&
          this.revealed &&
          !this.isTypingInTextarea()
        ) {
          evt.preventDefault();
          void this.grade(grade);
        }
      });
    }
    // Alt+X / Alt+Z parity with the editor commands. Works in both render
    // and edit modes; gated by the same rules as the buttons.
    this.scope.register(["Alt"], "x", (evt) => {
      if (this.canMakeChild()) {
        evt.preventDefault();
        void this.handleExtract();
      }
    });
    this.scope.register(["Alt"], "z", (evt) => {
      if (this.canMakeChild()) {
        evt.preventDefault();
        void this.handleCloze();
      }
    });

    void this.renderCard();
  }

  onClose() {
    this.contentEl.empty();
    // Materialize per-element state files once the session is done; an append
    // is enough for correctness (the queue folds the log), this just keeps
    // .ir/state/ in sync for the rest of the plugin.
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
      contentEl.createEl("h3", { text: "Nothing due" });
      contentEl.createEl("p", {
        text: "No IR notes are due for review right now.",
      });
      contentEl
        .createEl("button", { text: "Close", cls: "mod-cta" })
        .addEventListener("click", () => this.close());
      return;
    }

    await this.ensureLoaded(slot);

    const reading = this.isReading(slot);
    const label = slot.file?.basename ?? labelFor(slot.element);
    contentEl.createEl("div", {
      cls: "ir-review-progress",
      text:
        `${this.index + 1} of ${this.queue.length}  ·  ` +
        `${reading ? "Reading" : "Review"}  ·  ${label}`,
    });

    // Breadcrumb of ancestor titles (root-first). UI commitment #5: gives
    // the user "where am I in the element tree" without leaving the review
    // pane. Suppressed when the element is a root.
    const ancestors = ancestorChain(slot.element, this.elementsById);
    if (ancestors.length > 0) {
      contentEl.createEl("div", {
        cls: "ir-review-breadcrumb",
        text: ancestors.map((a) => labelFor(a)).join("  /  "),
      });
    }

    const isCloze = !reading && hasCloze(this.currentRaw);

    if (this.editing && this.canEdit()) {
      this.renderEditor(contentEl);
    } else {
      await this.renderBody(contentEl, this.currentRaw, isCloze);
    }

    const controls = contentEl.createEl("div", { cls: "ir-review-controls" });

    if (reading) {
      this.renderPriorityRow(controls, slot);
      const bar = controls.createEl("div", { cls: "ir-review-buttons" });
      this.renderChildButtons(bar);
      this.renderEditToggle(bar);
      bar
        .createEl("button", { text: "Next (Space)", cls: "mod-cta" })
        .addEventListener("click", () => void this.next());
      bar
        .createEl("button", { text: "Later today (L)" })
        .addEventListener("click", () => void this.later());
      bar
        .createEl("button", { text: "Dismiss (D)" })
        .addEventListener("click", () => void this.dismiss());
      return;
    }

    if (isCloze && !this.revealed) {
      controls
        .createEl("button", { text: "Show answer (Space)", cls: "mod-cta" })
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
      bar
        .createEl("button", { text: `${gLabel} (${key})` })
        .addEventListener("click", () => void this.grade(grade));
    }
    bar
      .createEl("button", { text: "Dismiss (D)" })
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
    const body = parent.createEl("div", { cls: "ir-review-body" });
    const slot = this.current;
    await MarkdownRenderer.render(
      this.app,
      shown,
      body,
      slot?.file?.path ?? "",
      this.component,
    );
  }

  private renderEditor(parent: HTMLElement) {
    const ta = parent.createEl("textarea", { cls: "ir-review-textarea" });
    ta.value = this.currentRaw;
    ta.spellcheck = true;
    ta.addEventListener("input", () => {
      this.currentRaw = ta.value;
    });
    // Place caret at the end so the user can resume typing without a click.
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    });
  }

  /**
   * Edit toggles only the view, not the buffer: any unsaved edits in
   * `currentRaw` survive a round trip to render mode so the user can verify
   * a change as Markdown before advancing.
   */
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
      .createEl("button", { text: "Extract (Alt+X)" })
      .addEventListener("click", () => void this.handleExtract());
    parent
      .createEl("button", { text: "Cloze (Alt+Z)" })
      .addEventListener("click", () => void this.handleCloze());
  }

  /**
   * Resolve a selection from either the textarea (exact offsets) or the
   * rendered body (best-effort: locate the selected text inside the current
   * raw by `indexOf`, refusing if it isn't a unique match).
   */
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
      // Source of truth in edit mode is the textarea, not currentRaw - they
      // should match via the input handler but defend against a missed event.
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
    const bodyEl = this.contentEl.querySelector(".ir-review-body");
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

  /**
   * Replay the newly created child note into the store as an
   * `element-created` event so it lands in the queue and the tree view,
   * mirroring how main.ts handles user-initiated creates. We don't add it to
   * the *current* session's queue; it will surface on the next session.
   */
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

  /** Move past the current element, finishing the session if it was last. */
  private advance(doneVerb: string) {
    this.index += 1;
    this.revealed = false;
    this.editing = false;
    this.loadedSlotId = null;
    if (!this.current) {
      new Notice(`${doneVerb}: ${this.queue.length} element(s).`);
      this.close();
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

  /** "Next" on a reading element: stretch its interval by the A-Factor. */
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

  /** Postpone a reading element to later today without advancing it. */
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
