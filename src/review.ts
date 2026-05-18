/**
 * The review loop: find what is due, show it one element at a time, and
 * reschedule it.
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
import { IR_KEYS } from "./types";
import { isDismissed, setDismissed, setPriority } from "./ir-note";
import { interleavedQueue } from "./queue";
import { CLOZE_RE, hasCloze } from "./cloze";
import {
  Grade,
  readCardFromFrontmatter,
  schedule,
  writeCardToFrontmatter,
} from "./fsrs";
import {
  advanceTopic,
  laterToday,
  readTopicFromFrontmatter,
  writeTopicToFrontmatter,
} from "./topic";
import type { IrSettings } from "./settings";

const GRADES: { grade: Grade; label: string; key: string }[] = [
  { grade: "again", label: "Again", key: "1" },
  { grade: "hard", label: "Hard", key: "2" },
  { grade: "good", label: "Good", key: "3" },
  { grade: "easy", label: "Easy", key: "4" },
];

/**
 * The interleaved daily session as files, due now. Adapts the live vault
 * into plain `QueueEntry` records and delegates ordering to the pure,
 * unit-tested `interleavedQueue`.
 */
export function dueQueue(
  app: App,
  reviewsPerReading: number,
  now: Date = new Date(),
): TFile[] {
  const byId = new Map<string, TFile>();
  const entries = app.vault.getMarkdownFiles().map((file) => {
    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    const rawDue = fm?.[IR_KEYS.due];
    const p = fm?.[IR_KEYS.priority];
    byId.set(file.path, file);
    return {
      id: file.path,
      type: typeof fm?.[IR_KEYS.type] === "string" ? fm[IR_KEYS.type] : "",
      priority: typeof p === "number" ? p : 100,
      dueMs:
        typeof rawDue === "string" || rawDue instanceof Date
          ? new Date(rawDue).getTime()
          : NaN,
      dismissed: isDismissed(app, file),
    };
  });

  return interleavedQueue(entries, reviewsPerReading, now.getTime())
    .map((id) => byId.get(id))
    .filter((f): f is TFile => f !== undefined);
}

/** Drop the YAML frontmatter block so only the note body is rendered. */
function stripFrontmatter(content: string): string {
  return content.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
}

export class ReviewModal extends Modal {
  private queue: TFile[] = [];
  private index = 0;
  private revealed = false;

  constructor(
    app: App,
    private component: Component,
    private settings: IrSettings,
  ) {
    super(app);
  }

  onOpen() {
    this.modalEl.addClass("ir-review-modal");
    this.queue = dueQueue(this.app, this.settings.reviewsPerReading);

    this.scope.register([], " ", (evt) => {
      const file = this.current;
      if (!file) return;
      if (this.isReading(file)) {
        evt.preventDefault();
        void this.next();
      } else if (!this.revealed) {
        evt.preventDefault();
        this.revealed = true;
        void this.renderCard();
      }
    });
    this.scope.register([], "Enter", (evt) => {
      const file = this.current;
      if (file && this.isReading(file)) {
        evt.preventDefault();
        void this.next();
      }
    });
    this.scope.register([], "l", (evt) => {
      const file = this.current;
      if (file && this.isReading(file)) {
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
        const file = this.current;
        if (file && !this.isReading(file) && this.revealed) {
          evt.preventDefault();
          void this.grade(grade);
        }
      });
    }

    void this.renderCard();
  }

  onClose() {
    this.contentEl.empty();
  }

  private get current(): TFile | undefined {
    return this.queue[this.index];
  }

  /** A reading element (topic/extract) is read and advanced, never graded. */
  private isReading(file: TFile): boolean {
    const t = this.app.metadataCache.getFileCache(file)?.frontmatter?.[
      IR_KEYS.type
    ];
    return t === "topic" || t === "extract";
  }

  /** Compact priority editor; reordering is a first-class IR action. */
  private renderPriorityRow(parent: HTMLElement, file: TFile) {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const cur =
      typeof fm?.[IR_KEYS.priority] === "number"
        ? (fm[IR_KEYS.priority] as number)
        : this.settings.defaultPriority;

    const row = parent.createEl("div", { cls: "ir-priority-row" });
    row.createEl("span", { text: "Priority" });
    const input = row.createEl("input", { cls: "ir-priority-input" });
    input.type = "number";
    input.min = "0";
    input.max = "100";
    input.step = "1";
    input.value = String(cur);
    const commit = async () => {
      const n = Number(input.value);
      if (Number.isFinite(n)) await setPriority(this.app, file, n);
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

    const file = this.current;
    if (!file) {
      contentEl.createEl("h3", { text: "Nothing due" });
      contentEl.createEl("p", {
        text: "No IR notes are due for review right now.",
      });
      contentEl
        .createEl("button", { text: "Close", cls: "mod-cta" })
        .addEventListener("click", () => this.close());
      return;
    }

    const reading = this.isReading(file);
    contentEl.createEl("div", {
      cls: "ir-review-progress",
      text:
        `${this.index + 1} of ${this.queue.length}  ·  ` +
        `${reading ? "Reading" : "Review"}  ·  ${file.basename}`,
    });

    const raw = stripFrontmatter(await this.app.vault.cachedRead(file));
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
      file.path,
      this.component,
    );

    const controls = contentEl.createEl("div", { cls: "ir-review-controls" });

    if (reading) {
      this.renderPriorityRow(controls, file);
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

    this.renderPriorityRow(controls, file);
    const bar = controls.createEl("div", { cls: "ir-review-buttons" });
    for (const { grade, label, key } of GRADES) {
      bar
        .createEl("button", { text: `${label} (${key})` })
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
    const file = this.current;
    if (!file) return;

    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const next = schedule(readCardFromFrontmatter(fm), grade);
    await this.app.fileManager.processFrontMatter(file, (f) => {
      writeCardToFrontmatter(f, next);
    });
    this.advance("Review complete");
  }

  /** "Next" on a reading element: stretch its interval by the A-Factor. */
  private async next() {
    const file = this.current;
    if (!file) return;

    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const state = advanceTopic(
      readTopicFromFrontmatter(fm, this.settings),
      this.settings,
    );
    await this.app.fileManager.processFrontMatter(file, (f) => {
      writeTopicToFrontmatter(f, state);
    });
    this.advance("Reading session complete");
  }

  /** Postpone a reading element to later today without advancing it. */
  private async later() {
    const file = this.current;
    if (!file) return;

    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const state = laterToday(readTopicFromFrontmatter(fm, this.settings));
    await this.app.fileManager.processFrontMatter(file, (f) => {
      writeTopicToFrontmatter(f, state);
    });
    this.advance("Session complete");
  }

  private async dismiss() {
    const file = this.current;
    if (!file) return;
    await setDismissed(this.app, file, true);
    new Notice(`Dismissed "${file.basename}".`);
    this.advance("Session complete");
  }
}
