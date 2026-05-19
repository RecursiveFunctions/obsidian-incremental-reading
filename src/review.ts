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
 */

import {
  App,
  Component,
  MarkdownRenderer,
  Modal,
  Notice,
  TFile,
} from "obsidian";
import { setDismissed, setPriority } from "./ir-note";
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
import {
  clampPriority,
  isReadType,
  type IrElement,
  type IrEventKind,
  type ReadSchedule,
} from "./ir/model";
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

/** Drop the YAML frontmatter block so only the note body is rendered. */
function stripFrontmatter(content: string): string {
  return content.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
}

export class ReviewModal extends Modal {
  private index = 0;
  private revealed = false;

  constructor(
    app: App,
    private component: Component,
    private settings: IrSettings,
    private store: IrStore,
    private queue: ReviewSlot[],
  ) {
    super(app);
  }

  onOpen() {
    this.modalEl.addClass("ir-review-modal");

    this.scope.register([], " ", (evt) => {
      const slot = this.current;
      if (!slot) return;
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
      if (slot && this.isReading(slot)) {
        evt.preventDefault();
        void this.next();
      }
    });
    this.scope.register([], "l", (evt) => {
      const slot = this.current;
      if (slot && this.isReading(slot)) {
        evt.preventDefault();
        void this.later();
      }
    });
    this.scope.register([], "d", (evt) => {
      if (this.current) {
        evt.preventDefault();
        void this.dismiss();
      }
    });
    for (const { grade, key } of GRADES) {
      this.scope.register([], key, (evt) => {
        const slot = this.current;
        if (slot && !this.isReading(slot) && this.revealed) {
          evt.preventDefault();
          void this.grade(grade);
        }
      });
    }

    void this.renderCard();
  }

  onClose() {
    this.contentEl.empty();
    // Materialize per-element state files once the session is done; an append
    // is enough for correctness (the queue folds the log), this just keeps
    // .ir/state/ in sync for the rest of the plugin.
    void this.store.reconcile().catch((e) => {
      console.error("Incremental Reading: reconcile after review failed", e);
    });
  }

  private get current(): ReviewSlot | undefined {
    return this.queue[this.index];
  }

  /** A reading element (topic/extract) is read and advanced, never graded. */
  private isReading(slot: ReviewSlot): boolean {
    return isReadType(slot.element.type);
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

    const reading = this.isReading(slot);
    const label = slot.file?.basename ?? slot.id;
    contentEl.createEl("div", {
      cls: "ir-review-progress",
      text:
        `${this.index + 1} of ${this.queue.length}  ·  ` +
        `${reading ? "Reading" : "Review"}  ·  ${label}`,
    });

    const raw = slot.file
      ? stripFrontmatter(await this.app.vault.cachedRead(slot.file))
      : slot.element.text ||
        "_The source note for this element is no longer in the vault._";
    const isCloze = !reading && hasCloze(raw);
    const shown =
      isCloze && !this.revealed
        ? raw.replace(CLOZE_RE, "**[ ... ]**")
        : raw.replace(CLOZE_RE, "**$2**");

    const body = contentEl.createEl("div", { cls: "ir-review-body" });
    await MarkdownRenderer.render(
      this.app,
      shown,
      body,
      slot.file?.path ?? "",
      this.component,
    );

    const controls = contentEl.createEl("div", { cls: "ir-review-controls" });

    if (reading) {
      this.renderPriorityRow(controls, slot);
      const bar = controls.createEl("div", { cls: "ir-review-buttons" });
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
    for (const { grade, label: gLabel, key } of GRADES) {
      bar
        .createEl("button", { text: `${gLabel} (${key})` })
        .addEventListener("click", () => void this.grade(grade));
    }
    bar
      .createEl("button", { text: "Dismiss (D)" })
      .addEventListener("click", () => void this.dismiss());
  }

  /** Move past the current element, finishing the session if it was last. */
  private advance(doneVerb: string) {
    this.index += 1;
    this.revealed = false;
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
    await this.emit("dismiss-set", slot.id, { dismissed: true });
    slot.element = { ...slot.element, dismissed: true };
    if (slot.file) await setDismissed(this.app, slot.file, true);
    new Notice(`Dismissed "${slot.file?.basename ?? slot.id}".`);
    this.advance("Session complete");
  }
}
