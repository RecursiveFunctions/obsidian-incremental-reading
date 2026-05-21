/**
 * Optional cloze hint (SuperMemo-style) when creating a deletion from the UI.
 */

import { App, Modal, Notice, Setting } from "obsidian";

export type ClozeHintPromptResult =
  | { ok: true; hint: string }
  | { ok: false };

/**
 * Ask for an optional hint string. Empty hint is allowed (`ok: true`, `hint:
 * ""`). User cancel / overlay close yields `ok: false`.
 */
export function promptClozeHint(app: App): Promise<ClozeHintPromptResult> {
  return new Promise((resolve) => {
    const modal = new ClozeHintModal(app, resolve);
    modal.open();
  });
}

class ClozeHintModal extends Modal {
  private resolved = false;
  private textInput?: HTMLInputElement;

  constructor(
    app: App,
    private readonly finish: (r: ClozeHintPromptResult) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    this.titleEl.setText("Cloze hint (optional)");
    contentEl.createEl("p", {
      text:
        "Optional text shown next to the hidden gap during review, " +
        "SuperMemo-style. Leave blank for no hint.",
      cls: "setting-item-description",
    });

    new Setting(contentEl).setName("Hint").addText((tc) => {
      tc.setPlaceholder("e.g. capital of France");
      this.textInput = tc.inputEl;
      tc.inputEl.addEventListener("keydown", (evt: KeyboardEvent) => {
        if (evt.key === "Enter") {
          evt.preventDefault();
          this.submit();
        }
      });
    });

    this.textInput?.focus();
    new Setting(contentEl)
      .addButton((b) =>
        b.setButtonText("Cancel").onClick(() => {
          this.resolve({ ok: false });
          this.close();
        }),
      )
      .addButton((b) =>
        b
          .setButtonText("Continue")
          .setCta()
          .onClick(() => this.submit()),
      );
  }

  private submit(): void {
    const raw = this.textInput?.value ?? "";
    const trimmed = raw.trim();
    if (trimmed.includes("::")) {
      new Notice(
        'Incremental Reading: hints cannot contain "::" (reserved for cloze syntax).',
      );
      return;
    }
    this.resolve({ ok: true, hint: trimmed });
    this.close();
  }

  private resolve(r: ClozeHintPromptResult): void {
    if (this.resolved) return;
    this.resolved = true;
    this.finish(r);
  }

  onClose(): void {
    if (!this.resolved) {
      this.resolved = true;
      this.finish({ ok: false });
    }
    super.onClose();
  }
}
