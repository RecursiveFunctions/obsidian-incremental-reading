import { App, Modal, setIcon } from "obsidian";

export type IrHubEntry = {
  title: string;
  description?: string;
  icon?: string;
  /** Invoked after the modal closes. */
  run: () => void | Promise<void>;
};

/**
 * Single entry point for contextual IR actions (new cloze, split, fork).
 * Avoids crowding the ribbon with one icon per action.
 */
export class IrActionsHubModal extends Modal {
  constructor(
    app: App,
    private readonly entries: IrHubEntry[],
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ir-actions-hub-modal");

    contentEl.createEl("h2", { text: "Incremental reading" });
    contentEl.createEl("p", {
      cls: "ir-hub-lede",
      text: "Contextual shortcuts. Rebind or clear any hotkey under Settings → Hotkeys.",
    });

    if (this.entries.length === 0) {
      contentEl.createEl("p", {
        text:
          "Nothing here applies to the current note. Try a selection in a Markdown note, open an IR item with multiple clozes, or use the IR tree row menu to fork an extract.",
      });
      return;
    }

    for (const e of this.entries) {
      const row = contentEl.createDiv({ cls: "ir-hub-row" });
      const btn = row.createEl("button", {
        cls: "mod-cta ir-hub-action",
        type: "button",
      });
      if (e.icon) {
        const ic = btn.createSpan({ cls: "ir-hub-action-icon" });
        setIcon(ic, e.icon);
      }
      btn.createSpan({ text: e.title });
      btn.addEventListener("click", () => {
        this.close();
        void Promise.resolve(e.run()).catch((err) => {
          console.error("Incremental Reading: hub action failed", err);
        });
      });
      if (e.description) {
        row.createDiv({ cls: "ir-hub-desc", text: e.description });
      }
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
