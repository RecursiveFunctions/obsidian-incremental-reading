/**
 * Confirmation modals for the Settings tab Danger zone.
 *
 * - `promptNukeConfirm` is the destructive "trash notes + wipe state" flow.
 *   The user must type "nuke" before the confirm button enables AND sees the
 *   full list of paths that will be trashed, because any markdown note with
 *   `ir-type:` frontmatter is in scope — including knowledge-base notes the
 *   user marked as topics by hand.
 * - `promptStateResetConfirm` is the gentler "wipe .ir/ state only" flow.
 *   Notes are untouched; only the schedule, event log, bookmarks, and
 *   tombstones go away. Single-button confirm — the blast radius is small
 *   enough that typing friction isn't warranted.
 */

import { App, Modal, Setting } from "obsidian";

export interface NukeSummary {
  topics: number;
  extracts: number;
  items: number;
  paths: string[];
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
        "This trashes every markdown note in your vault that has " +
        "ir-type: frontmatter — including any knowledge-base note you " +
        "marked as an IR topic by hand, not just plugin-generated notes. " +
        "It also deletes the hidden .ir/ folder (event log, schedule, " +
        "bookmarks, tombstones). The per-note auto-promote handler is " +
        "suppressed during the sweep so it does not spawn replacement " +
        '"orphan-…" notes. Notes go to your vault trash and are ' +
        "recoverable; .ir/ state is not.",
      cls: "setting-item-description",
    });

    const counts = contentEl.createEl("ul");
    counts.createEl("li", {
      text: `${this.summary.topics} topic note${this.summary.topics === 1 ? "" : "s"}`,
    });
    counts.createEl("li", {
      text: `${this.summary.extracts} extract note${this.summary.extracts === 1 ? "" : "s"}`,
    });
    counts.createEl("li", {
      text: `${this.summary.items} cloze item note${this.summary.items === 1 ? "" : "s"}`,
    });
    counts.createEl("li", { text: ".ir/ state folder" });

    if (this.summary.paths.length > 0) {
      contentEl.createEl("p", {
        text: "These notes will be trashed:",
        cls: "setting-item-description",
      });
      const list = contentEl.createEl("div", { cls: "ir-nuke-path-list" });
      for (const path of this.summary.paths) {
        list.createEl("div", { text: path });
      }
    }

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

export function promptStateResetConfirm(app: App): Promise<boolean> {
  return new Promise((resolve) => {
    new StateResetConfirmModal(app, resolve).open();
  });
}

class StateResetConfirmModal extends Modal {
  private resolved = false;

  constructor(
    app: App,
    private readonly finish: (ok: boolean) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    this.titleEl.setText("Reset Incremental Reading state?");

    contentEl.createEl("p", {
      text:
        "This deletes the hidden .ir/ folder — event log, schedule, " +
        "bookmarks, tombstones. Your notes are not touched: they keep " +
        "their ir-type: frontmatter but become inert (no schedule, no " +
        "queue entries) until you re-import or strip the keys.",
      cls: "setting-item-description",
    });

    contentEl.createEl("p", {
      text:
        "The .ir/ folder is removed directly and is not sent to your " +
        "vault trash, so the schedule and review history cannot be " +
        "recovered from here.",
      cls: "setting-item-description",
    });

    new Setting(contentEl)
      .addButton((b) =>
        b.setButtonText("Cancel").onClick(() => this.resolve(false)),
      )
      .addButton((b) =>
        b
          .setButtonText("Reset state")
          .setWarning()
          .onClick(() => this.resolve(true)),
      );
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
