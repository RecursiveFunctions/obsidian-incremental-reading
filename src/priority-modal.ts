/**
 * A minimal prompt for setting an IR element's priority outside the review
 * loop (Command palette / hotkey). Obsidian has no built-in prompt, so this
 * is the smallest faithful one: a number input prefilled with the current
 * value, Enter or Save to commit.
 */

import { App, Modal, Setting } from "obsidian";

export class PriorityModal extends Modal {
  private value: number;

  constructor(
    app: App,
    private current: number,
    private onSubmit: (priority: number) => void,
  ) {
    super(app);
    this.value = current;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Set IR priority" });
    contentEl.createEl("p", {
      text: "0-100, lower = more important (SuperMemo percentile).",
    });

    let inputEl: HTMLInputElement;
    new Setting(contentEl).setName("Priority").addText((text) => {
      inputEl = text.inputEl;
      inputEl.type = "number";
      inputEl.min = "0";
      inputEl.max = "100";
      text.setValue(String(this.current)).onChange((v) => {
        this.value = Number(v);
      });
      inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.commit();
        }
      });
    });

    new Setting(contentEl).addButton((b) =>
      b
        .setButtonText("Save")
        .setCta()
        .onClick(() => this.commit()),
    );

    setTimeout(() => inputEl?.focus(), 0);
  }

  private commit() {
    if (Number.isFinite(this.value)) this.onSubmit(this.value);
    this.close();
  }

  onClose() {
    this.contentEl.empty();
  }
}
