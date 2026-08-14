/**
 * One-shot recovery prompt when a deleted source note comes back
 * (DESIGN.md Q1 comes-back). Never re-link silently — the user confirms.
 */

import { App, Modal, Setting } from "obsidian";

export function promptSourceRelink(
  app: App,
  opts: { title: string; path: string; labels: string[] },
): Promise<boolean> {
  return new Promise((resolve) => {
    new RelinkConfirmModal(app, opts, resolve).open();
  });
}

class RelinkConfirmModal extends Modal {
  private resolved = false;

  constructor(
    app: App,
    private readonly opts: { title: string; path: string; labels: string[] },
    private readonly finish: (ok: boolean) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    this.titleEl.setText("Re-link Incremental Reading source?");

    contentEl.createEl("p", {
      text:
        `A note matching the deleted source “${this.opts.title}” is back ` +
        `at ${this.opts.path}. Re-link these extracts so highlights and ` +
        "provenance point at it again? Standalone notes stay; this only " +
        "restores the source pointer.",
      cls: "setting-item-description",
    });

    const list = contentEl.createEl("ul");
    for (const label of this.opts.labels) {
      list.createEl("li", { text: label });
    }

    contentEl.createEl("p", {
      text: "Leave detached keeps extracts as they are and forgets this offer.",
      cls: "setting-item-description",
    });

    new Setting(contentEl)
      .addButton((b) =>
        b.setButtonText("Leave detached").onClick(() => this.resolve(false)),
      )
      .addButton((b) =>
        b
          .setButtonText("Re-link")
          .setCta()
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
