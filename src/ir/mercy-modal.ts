import { type ButtonComponent, Modal, Setting } from "obsidian";
import {
  buildMercyLoadChart,
  MERCY_CHART_DAYS,
  type MercyChartDay,
  type MercyChartModel,
} from "./mercy-chart";
import {
  planMercy,
  type MercyEntry,
  type MercyPlan,
  type MercyWeights,
} from "./mercy";

export { buildMercyLoadChart, MERCY_CHART_DAYS, type MercyChartDay, type MercyChartModel };

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
  private resultsContainerEl?: HTMLElement;
  private applyButton?: ButtonComponent;

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
    this.titleEl.setText("Mercy");
    this.mountLayout();
    this.renderResults();
  }

  private recompute(): void {
    this.currentPlan = planMercy(this.entries, this.actionMs, {
      ceiling: this.currentCeiling,
      priorityCutoff: this.currentCutoff,
      weights: this.currentWeights,
    });
    this.renderResults();
  }

  /**
   * Mount the static control rows once so dragging a slider never destroys
   * the active `<input type="range">` element or drops pointer/keyboard focus.
   */
  private mountLayout(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ir-mercy-modal");

    const controlsEl = contentEl.createDiv({ cls: "ir-mercy-controls" });

    new Setting(controlsEl)
      .setName("Daily ceiling")
      .setDesc("Max due today")
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

    new Setting(controlsEl)
      .setName("Protect priority \u2264")
      .setDesc("Never postpone at or below this priority")
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

    new Setting(controlsEl)
      .setName("Multi-factor ranking")
      .setDesc("Weight by priority, lateness, lapses, and reps")
      .addToggle((toggle) =>
        toggle
          .setValue(((this.currentWeights.mode ?? 3) & 1) === 1)
          .onChange((val) => {
            this.currentWeights.mode = val ? 3 : 0;
            this.recompute();
          }),
      );

    this.resultsContainerEl = contentEl.createDiv({ cls: "ir-mercy-results" });

    new Setting(contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.finish(false)))
      .addButton((button) => {
        this.applyButton = button
          .setButtonText("Apply")
          .setCta()
          .setDisabled(this.currentPlan.postponedCount === 0)
          .onClick(() => this.finish(true));
      });
  }

  private renderResults(): void {
    const plan = this.currentPlan;
    if (this.applyButton) {
      this.applyButton.setDisabled(plan.postponedCount === 0);
      this.applyButton.setButtonText(
        plan.postponedCount > 0 ? `Postpone ${plan.postponedCount}` : "Postpone",
      );
    }

    const host = this.resultsContainerEl;
    if (!host) return;
    host.empty();

    const summary = host.createDiv({ cls: "ir-mercy-summary" });
    summary.createSpan({
      cls: "ir-mercy-chip",
      text: `${plan.totalDue} due`,
    });
    summary.createSpan({
      cls: "ir-mercy-chip",
      text: `${plan.effectiveToday} today`,
    });
    summary.createSpan({
      cls: "ir-mercy-chip",
      text: `${plan.protectedToday.length} protected`,
    });
    summary.createSpan({
      cls: "ir-mercy-chip",
      text: `${plan.postponedCount} postponed`,
    });
    if (plan.effectiveToday > this.currentCeiling) {
      summary.createDiv({
        cls: "ir-mercy-warning",
        text: `${plan.protectedToday.length} protected over ceiling`,
      });
    }

    const chartModel = buildMercyLoadChart(plan, this.actionMs, this.currentCeiling, MERCY_CHART_DAYS);
    const hasAnyFutureLoad = chartModel.days.some((d) => d.totalCount > 0);
    if (hasAnyFutureLoad) {
      const chartSection = host.createDiv({ cls: "ir-mercy-chart-section" });
      const headerRow = chartSection.createDiv({ cls: "ir-mercy-chart-header" });
      headerRow.createEl("h4", { text: `${MERCY_CHART_DAYS}-day schedule` });
      const legend = headerRow.createDiv({ cls: "ir-mercy-chart-legend" });
      legend.createSpan({ cls: "ir-mercy-legend-item ir-mercy-legend-item--existing", text: "Scheduled" });
      legend.createSpan({ cls: "ir-mercy-legend-item ir-mercy-legend-item--postponed", text: "Postponed" });

      const chart = chartSection.createDiv({ cls: "ir-mercy-chart" });
      for (const day of chartModel.days) {
        const row = chart.createDiv({ cls: "ir-mercy-chart-row" });
        row.setAttr(
          "aria-label",
          `${day.date}: ${day.totalCount} total (${day.existingCount} existing + ${day.postponedCount} postponed)`,
        );
        row.createDiv({
          cls: "ir-mercy-chart-date",
          text: day.shortLabel,
          attr: { title: day.date },
        });
        const track = row.createDiv({ cls: "ir-mercy-chart-track" });
        if (day.existingCount > 0) {
          const existingBar = track.createDiv({ cls: "ir-mercy-chart-bar ir-mercy-chart-bar--existing" });
          existingBar.style.setProperty("width", `${day.existingPct.toFixed(2)}%`);
        }
        if (day.postponedCount > 0) {
          const addedBar = track.createDiv({ cls: "ir-mercy-chart-bar ir-mercy-chart-bar--postponed" });
          addedBar.style.setProperty("width", `${day.postponedPct.toFixed(2)}%`);
        }
        const marker = track.createDiv({ cls: "ir-mercy-chart-ceiling" });
        marker.style.setProperty("left", `${chartModel.ceilingPct.toFixed(2)}%`);

        const countLabel = day.postponedCount > 0
          ? `${day.totalCount} (+${day.postponedCount})`
          : String(day.totalCount);
        row.createDiv({
          cls: `ir-mercy-chart-count${day.overCeiling ? " is-over-ceiling" : ""}`,
          text: countLabel,
        });
      }
    }

    if (plan.assignments.length > 0) {
      host.createEl("h4", { cls: "ir-mercy-subheading", text: `Postponing (${plan.assignments.length})` });
      const previewList = host.createEl("ul", { cls: "ir-mercy-preview-list" });
      for (const assignment of plan.assignments.slice(0, 10)) {
        const label = this.labelsById.get(assignment.id) ?? assignment.id;
        previewList.createEl("li", {
          text: `${label} → ${assignment.targetLocalDate}`,
        });
      }
      if (plan.assignments.length > 10) {
        previewList.createEl("li", {
          cls: "ir-mercy-preview-more",
          text: `…and ${plan.assignments.length - 10} more`,
        });
      }
    }
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
