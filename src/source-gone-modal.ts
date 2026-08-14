/**
 * One prompt when a source note disappears (DESIGN.md Q1 bulk UX).
 * Three choices: make orphan extracts into notes, keep them as review
 * cards only, or undo (remember the path is gone, leave the tree as-is).
 */

import { App, Modal, Setting } from "obsidian";

export type SourceGoneChoice = "promote-all" | "leave-detached" | "undo";

export function promptSourceGone(
  app: App,
  opts: {
    title: string;
    path: string;
    labels: string[];
    defaultPromote: boolean;
  },
): Promise<SourceGoneChoice> {
  return new Promise((resolve) => {
    new SourceGoneModal(app, opts, resolve).open();
  });
}

class SourceGoneModal extends Modal {
  private resolved = false;

  constructor(
    app: App,
    private readonly opts: {
      title: string;
      path: string;
      labels: string[];
      defaultPromote: boolean;
    },
    private readonly finish: (choice: SourceGoneChoice) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    this.titleEl.setText("Source note is gone");

    const n = this.opts.labels.length;
    contentEl.createEl("p", {
      text:
        `“${this.opts.title}” was deleted. ` +
        (n === 0
          ? "Incremental Reading still has that source in its tree."
          : n === 1
            ? "1 highlight from it is still in Incremental Reading."
            : `${n} highlights from it are still in Incremental Reading.`),
      cls: "setting-item-description",
    });

    if (this.opts.labels.length > 0) {
      const list = contentEl.createEl("ul");
      for (const label of this.opts.labels) {
        list.createEl("li", { text: label });
      }
    }

    contentEl.createEl("p", {
      text:
        "Make them notes turns each orphaned highlight into its own file. " +
        "Keep without notes leaves them as review cards only. " +
        "Undo remembers the file is gone but does not change the tree — " +
        "restore the note from trash if you still want it.",
      cls: "setting-item-description",
    });

    const promoteIsDefault = this.opts.defaultPromote;
    new Setting(contentEl)
      .addButton((b) =>
        b.setButtonText("Undo").onClick(() => this.resolve("undo")),
      )
      .addButton((b) => {
        b.setButtonText("Keep without notes");
        if (!promoteIsDefault) b.setCta();
        b.onClick(() => this.resolve("leave-detached"));
      })
      .addButton((b) => {
        b.setButtonText("Make them notes");
        if (promoteIsDefault) b.setCta();
        b.onClick(() => this.resolve("promote-all"));
      });
  }

  private resolve(choice: SourceGoneChoice): void {
    if (this.resolved) return;
    this.resolved = true;
    this.finish(choice);
    this.close();
  }

  onClose(): void {
    if (!this.resolved) {
      this.resolved = true;
      this.finish(this.opts.defaultPromote ? "promote-all" : "leave-detached");
    }
    super.onClose();
  }
}
