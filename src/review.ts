/**
 * The review loop: find what is due, show it one card at a time, grade it,
 * and write the rescheduled FSRS state back to the note.
 *
 * Scope here is the single-queue version (MVP item 5). Interleaving reading
 * topics with review items by ratio is item 6 and layers on top of this.
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
import { CLOZE_RE, hasCloze } from "./cloze";
import { Grade, readCardFromFrontmatter, schedule, writeCardToFrontmatter } from "./fsrs";

const GRADES: { grade: Grade; label: string; key: string }[] = [
  { grade: "again", label: "Again", key: "1" },
  { grade: "hard", label: "Hard", key: "2" },
  { grade: "good", label: "Good", key: "3" },
  { grade: "easy", label: "Easy", key: "4" },
];

/**
 * Every IR note whose card is due at or before `now`, ordered the way they
 * should be reviewed: most important first (lowest priority number), then
 * longest overdue.
 */
export function dueQueue(app: App, now: Date = new Date()): TFile[] {
  const due: { file: TFile; priority: number; due: number }[] = [];

  for (const file of app.vault.getMarkdownFiles()) {
    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    if (!fm || !fm[IR_KEYS.type]) continue;

    const rawDue = fm[IR_KEYS.due];
    const dueMs =
      typeof rawDue === "string" || rawDue instanceof Date
        ? new Date(rawDue).getTime()
        : 0;
    if (!Number.isFinite(dueMs) || dueMs > now.getTime()) continue;

    const p = fm[IR_KEYS.priority];
    due.push({
      file,
      priority: typeof p === "number" ? p : 100,
      due: dueMs,
    });
  }

  due.sort((a, b) => a.priority - b.priority || a.due - b.due);
  return due.map((d) => d.file);
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
  ) {
    super(app);
  }

  onOpen() {
    this.modalEl.addClass("ir-review-modal");
    this.queue = dueQueue(this.app);

    this.scope.register([], " ", (evt) => {
      if (!this.revealed) {
        evt.preventDefault();
        this.revealed = true;
        void this.renderCard();
      }
    });
    for (const { grade, key } of GRADES) {
      this.scope.register([], key, (evt) => {
        if (this.revealed) {
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

    contentEl.createEl("div", {
      cls: "ir-review-progress",
      text: `${this.index + 1} of ${this.queue.length}  ·  ${file.basename}`,
    });

    const raw = stripFrontmatter(await this.app.vault.cachedRead(file));
    const isCloze = hasCloze(raw);
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
    if (isCloze && !this.revealed) {
      const reveal = controls.createEl("button", {
        text: "Show answer (Space)",
        cls: "mod-cta",
      });
      reveal.addEventListener("click", () => {
        this.revealed = true;
        void this.renderCard();
      });
      return;
    }

    for (const { grade, label, key } of GRADES) {
      const btn = controls.createEl("button", { text: `${label} (${key})` });
      btn.addEventListener("click", () => void this.grade(grade));
    }
  }

  private async grade(grade: Grade) {
    const file = this.current;
    if (!file) return;

    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const next = schedule(readCardFromFrontmatter(fm), grade);
    await this.app.fileManager.processFrontMatter(file, (f) => {
      writeCardToFrontmatter(f, next);
    });

    this.index += 1;
    this.revealed = false;
    if (!this.current) {
      new Notice(`Review complete: ${this.queue.length} card(s).`);
      this.close();
      return;
    }
    void this.renderCard();
  }
}
