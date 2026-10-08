import { Modal, Setting } from "obsidian";
import type { MercyPlan } from "./mercy";

export class MercyModal extends Modal {
  private settled = false;

  constructor(
    app: ConstructorParameters<typeof Modal>[0],
    private readonly plan: MercyPlan,
    private readonly ceiling: number,
    private readonly resolve: (apply: boolean) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("Mercy preview");
    const { contentEl, plan } = this;
    contentEl.createEl("p", {
      text: `${plan.totalDue} due now. Keep ${plan.effectiveToday} today and postpone ${plan.postponedCount}.`,
    });
    const summary = contentEl.createEl("ul");
    summary.createEl("li", { text: `Daily ceiling: ${this.ceiling}` });
    summary.createEl("li", { text: `Protected by priority: ${plan.protectedToday.length}` });
    if (plan.effectiveToday > this.ceiling) {
      summary.createEl("li", { text: "Protected work keeps today above the ceiling." });
    }
    if (plan.perDay.length > 0) {
      contentEl.createEl("h3", { text: "Future load" });
      const list = contentEl.createEl("ul");
      for (const day of plan.perDay) list.createEl("li", { text: `${day.date}: ${day.count}` });
    }
    new Setting(contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.finish(false)))
      .addButton((button) => button.setButtonText("Apply").setCta().setDisabled(plan.postponedCount === 0).onClick(() => this.finish(true)));
  }

  onClose(): void {
    this.contentEl.empty();
    this.finish(false, false);
  }

  private finish(apply: boolean, close = true): void {
    if (this.settled) return;
    this.settled = true;
    this.resolve(apply);
    if (close) this.close();
  }
}

export function previewMercy(app: ConstructorParameters<typeof Modal>[0], plan: MercyPlan, ceiling: number): Promise<boolean> {
  return new Promise((resolve) => new MercyModal(app, plan, ceiling, resolve).open());
}
