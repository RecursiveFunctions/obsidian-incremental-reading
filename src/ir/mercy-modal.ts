import { Modal, Setting } from "obsidian";
import { planMercy, type MercyEntry, type MercyPlan, type MercyWeights } from "./mercy";

export interface MercyModalResult {
  apply: boolean;
  plan: MercyPlan;
  ceiling: number;
  priorityCutoff: number;
  weights: MercyWeights;
}

export class MercyModal extends Modal {
  private settled = false;
  private currentPlan: MercyPlan;
  private currentCeiling: number;
  private currentCutoff: number;
  private currentWeights: MercyWeights;

  constructor(
    app: ConstructorParameters<typeof Modal>[0],
    private readonly entries: readonly MercyEntry[],
    private readonly actionMs: number,
    initialPlan: MercyPlan,
    ceiling: number,
    priorityCutoff: number,
    weights: MercyWeights,
    private readonly labelsById: ReadonlyMap<string, string>,
    private readonly resolve: (result: MercyModalResult) => void,
  ) {
    super(app);
    this.currentPlan = initialPlan;
    this.currentCeiling = ceiling;
    this.currentCutoff = priorityCutoff;
    this.currentWeights = { ...weights };
  }

  onOpen(): void {
    this.titleEl.setText("Mercy preview");
    this.renderBody();
  }

  private recompute(): void {
    this.currentPlan = planMercy(this.entries, this.actionMs, {
      ceiling: this.currentCeiling,
      priorityCutoff: this.currentCutoff,
      weights: this.currentWeights,
    });
    this.renderBody();
  }

  private renderBody(): void {
    const { contentEl } = this;
    contentEl.empty();
    const plan = this.currentPlan;

    contentEl.createEl("p", {
      text: `${plan.totalDue} due now. Keep ${plan.effectiveToday} today and postpone ${plan.postponedCount}.`,
    });

    new Setting(contentEl)
      .setName("Daily ceiling")
      .setDesc("Maximum due elements kept today before overflow is postponed.")
      .addSlider((slider) =>
        slider
          .setLimits(5, 200, 5)
          .setValue(this.currentCeiling)
          .setDynamicTooltip()
          .onChange((val) => {
            this.currentCeiling = val;
            this.recompute();
          }),
      );

    new Setting(contentEl)
      .setName("Priority cutoff")
      .setDesc("Elements at or below this priority are protected from postponement.")
      .addSlider((slider) =>
        slider
          .setLimits(0, 100, 1)
          .setValue(this.currentCutoff)
          .setDynamicTooltip()
          .onChange((val) => {
            this.currentCutoff = val;
            this.recompute();
          }),
      );

    new Setting(contentEl)
      .setName("Multi-factor Mercy scoring")
      .setDesc("Rank overflow by 5-dimension ordinal (Importance, Lateness, Easiness, Investment, Recency).")
      .addToggle((toggle) =>
        toggle
          .setValue(((this.currentWeights.mode ?? 3) & 1) === 1)
          .onChange((val) => {
            this.currentWeights.mode = val ? 3 : 0;
            this.recompute();
          }),
      );

    const summary = contentEl.createEl("ul");
    summary.createEl("li", { text: `Protected by priority: ${plan.protectedToday.length}` });
    if (plan.effectiveToday > this.currentCeiling) {
      summary.createEl("li", { text: "Protected work keeps today above the ceiling." });
    }

    if (plan.perDay.length > 0) {
      contentEl.createEl("h3", { text: "Future load" });
      const list = contentEl.createEl("ul");
      for (const day of plan.perDay.slice(0, 14)) {
        list.createEl("li", { text: `${day.date}: ${day.count}` });
      }
    }

    if (plan.assignments.length > 0) {
      contentEl.createEl("h3", { text: `Postponing (${plan.assignments.length})` });
      const previewList = contentEl.createEl("ul");
      for (const assignment of plan.assignments.slice(0, 10)) {
        const label = this.labelsById.get(assignment.id) ?? assignment.id;
        previewList.createEl("li", {
          text: `${label} -> ${assignment.targetLocalDate}`,
        });
      }
      if (plan.assignments.length > 10) {
        previewList.createEl("li", {
          text: `...and ${plan.assignments.length - 10} more`,
        });
      }
    }

    new Setting(contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.finish(false)))
      .addButton((button) =>
        button
          .setButtonText("Apply")
          .setCta()
          .setDisabled(plan.postponedCount === 0)
          .onClick(() => this.finish(true)),
      );
  }

  onClose(): void {
    this.contentEl.empty();
    this.finish(false, false);
  }

  private finish(apply: boolean, close = true): void {
    if (this.settled) return;
    this.settled = true;
    this.resolve({
      apply,
      plan: this.currentPlan,
      ceiling: this.currentCeiling,
      priorityCutoff: this.currentCutoff,
      weights: this.currentWeights,
    });
    if (close) this.close();
  }
}

export function previewMercy(
  app: ConstructorParameters<typeof Modal>[0],
  plan: MercyPlan,
  ceiling: number,
  context?: {
    entries: readonly MercyEntry[];
    actionMs: number;
    priorityCutoff: number;
    weights: MercyWeights;
    labelsById?: ReadonlyMap<string, string>;
  },
): Promise<MercyModalResult> {
  const entries = context?.entries ?? [];
  const actionMs = context?.actionMs ?? Date.now();
  const cutoff = context?.priorityCutoff ?? 0;
  const weights = context?.weights ?? { importance: 5, lateness: 1, easiness: 6, investment: 10, recency: 8, mode: 3 };
  const labels = context?.labelsById ?? new Map<string, string>();
  return new Promise((resolve) =>
    new MercyModal(app, entries, actionMs, plan, ceiling, cutoff, weights, labels, resolve).open(),
  );
}
