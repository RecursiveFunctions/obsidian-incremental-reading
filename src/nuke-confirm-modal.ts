/**
 * Two-step confirmation modal for the Danger zone "Nuke everything" button.
 * The user has to type "nuke" before the destructive button enables — enough
 * friction to catch a slip, not so much that it gates a deliberate reset.
 */

import { App, Modal, Setting } from "obsidian";

export interface NukeSummary {
  topics: number;
  extracts: number;
  items: number;
}

const CONFIRM_PHRASE = "nuke";

export function promptNukeConfirm(
  app: App,
  summary: NukeSummary,
): Promise<boolean> {
  return new Promise((resolve) => {
    new NukeConfirmModal(app, summary, resolve).open();
  });
}

class NukeConfirmModal extends Modal {
  private resolved = false;
  private input?: HTMLInputElement;
  private confirmBtnEl?: HTMLButtonElement;

  constructor(
    app: App,
    private readonly summary: NukeSummary,
    private readonly finish: (ok: boolean) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    this.titleEl.setText("Nuke all Incremental Reading data?");

    contentEl.createEl("p", {
      text:
        "This sends every note marked as an IR topic, extract, or cloze " +
        "item to your vault trash and deletes the hidden .ir/ folder " +
        "(event log, schedule, bookmarks, tombstones). The per-note " +
        "auto-promote handler is suppressed, so deleting will not spawn " +
        'replacement "orphan-…" notes.',
      cls: "setting-item-description",
    });

    const list = contentEl.createEl("ul");
    list.createEl("li", {
      text: `${this.summary.topics} topic note${this.summary.topics === 1 ? "" : "s"}`,
    });
    list.createEl("li", {
      text: `${this.summary.extracts} extract note${this.summary.extracts === 1 ? "" : "s"}`,
    });
    list.createEl("li", {
      text: `${this.summary.items} cloze item note${this.summary.items === 1 ? "" : "s"}`,
    });
    list.createEl("li", { text: ".ir/ state folder" });

    contentEl.createEl("p", {
      text: `Type "${CONFIRM_PHRASE}" below to enable the button.`,
      cls: "setting-item-description",
    });

    new Setting(contentEl).setName("Confirm").addText((tc) => {
      this.input = tc.inputEl;
      tc.inputEl.addEventListener("input", () => this.syncEnabled());
      tc.inputEl.addEventListener("keydown", (evt: KeyboardEvent) => {
        if (evt.key === "Enter" && this.isPhraseTyped()) {
          evt.preventDefault();
          this.resolve(true);
        }
      });
    });

    new Setting(contentEl)
      .addButton((b) =>
        b.setButtonText("Cancel").onClick(() => this.resolve(false)),
      )
      .addButton((b) => {
        b.setButtonText("Nuke everything").setWarning();
        this.confirmBtnEl = b.buttonEl;
        b.buttonEl.disabled = true;
        b.onClick(() => {
          if (this.isPhraseTyped()) this.resolve(true);
        });
        return b;
      });

    this.input?.focus();
  }

  private isPhraseTyped(): boolean {
    return (this.input?.value ?? "").trim().toLowerCase() === CONFIRM_PHRASE;
  }

  private syncEnabled(): void {
    if (this.confirmBtnEl) {
      this.confirmBtnEl.disabled = !this.isPhraseTyped();
    }
  }

  private resolve(ok: boolean): void {
    if (this.resolved) return;
    this.resolved = true;
    this.finish(ok);
    this.close();
  }

  onClose(): void {
    if (!this.resolved) {
      this.resolved = true;
      this.finish(false);
    }
    super.onClose();
  }
}
