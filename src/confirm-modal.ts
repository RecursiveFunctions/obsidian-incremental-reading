/**
 * Themed destructive-action confirmation.
 *
 * UI commitment #6 reserves modals for destructive confirmation, and #3
 * requires the plugin to honor the active theme. The tree view was using the
 * platform `confirm()` for both of its delete paths, which satisfies the
 * first and breaks the second: an unthemed Electron dialog with OS button
 * order, no Obsidian styling, and no keyboard behavior we control.
 *
 * The Danger-zone flows in `nuke-confirm-modal.ts` already had the right
 * shape; this is that shape without the typed-phrase gate, for deletes whose
 * blast radius is one element (or a selection) rather than the whole vault.
 */

import { App, Modal, Setting } from "obsidian";

export interface ConfirmOptions {
  title: string;
  /** One or more paragraphs of body copy. */
  body: string | string[];
  /** Label for the destructive button. Defaults to "Delete". */
  ctaText?: string;
}

export function promptConfirm(
  app: App,
  options: ConfirmOptions,
): Promise<boolean> {
  return new Promise((resolve) => {
    new ConfirmModal(app, options, resolve).open();
  });
}

class ConfirmModal extends Modal {
  private resolved = false;

  constructor(
    app: App,
    private readonly options: ConfirmOptions,
    private readonly finish: (ok: boolean) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    this.titleEl.setText(this.options.title);

    const paragraphs = Array.isArray(this.options.body)
      ? this.options.body
      : [this.options.body];
    for (const text of paragraphs) {
      contentEl.createEl("p", { text, cls: "setting-item-description" });
    }

    new Setting(contentEl)
      .addButton((b) =>
        b.setButtonText("Cancel").onClick(() => this.resolve(false)),
      )
      .addButton((b) =>
        b
          .setButtonText(this.options.ctaText ?? "Delete")
          .setWarning()
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

  /** Esc / click-out resolve false, so a dismissed dialog never deletes. */
  onClose(): void {
    if (!this.resolved) {
      this.resolved = true;
      this.finish(false);
    }
    super.onClose();
  }
}
