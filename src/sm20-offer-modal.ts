import { App, Modal, Setting } from "obsidian";
import type { PrimaryItemScheduler } from "./ir/item-scheduler";

export class Sm20SchedulerOfferModal extends Modal {
  private settled = false;

  constructor(
    app: App,
    private readonly onChoose: (choice: PrimaryItemScheduler) => Promise<void> | void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    this.titleEl.setText("SuperMemo 20 scheduler available");

    contentEl.createEl("p", {
      text:
        "Incremental Reading now includes SuperMemo 20's analytical SInc item scheduler alongside FSRS-6. " +
        "Your existing review cards work natively under both schedulers with zero migration, and you can switch anytime in Settings.",
      cls: "setting-item-description",
    });

    let switchBtnEl: HTMLButtonElement | null = null;
    new Setting(contentEl)
      .addButton((b) =>
        b
          .setButtonText("Keep current (FSRS)")
          .onClick(() => this.choose("fsrs")),
      )
      .addButton((b) => {
        b.setButtonText("Switch to SM-20")
          .setCta()
          .onClick(() => this.choose("sm20"));
        switchBtnEl = b.buttonEl;
      });

    queueMicrotask(() => switchBtnEl?.focus());
  }

  private choose(choice: PrimaryItemScheduler): void {
    if (this.settled) return;
    this.settled = true;
    void Promise.resolve(this.onChoose(choice)).finally(() => this.close());
  }

  onClose(): void {
    if (!this.settled) {
      this.settled = true;
      void this.onChoose("fsrs");
    }
    super.onClose();
  }
}
