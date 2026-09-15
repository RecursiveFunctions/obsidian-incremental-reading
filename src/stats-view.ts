import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";

import { IrLedger } from "./ir/ledger";
import type { IrElement, IrEvent } from "./ir/model";
import type { LogState } from "./ir/log";
import type { IrSettings } from "./ir/settings-data";
import {
  extractRevlog,
  fitTier,
  type Revlog,
} from "./ir/optimizer/revlog";
import { evalCardsFor, fit, type FitResult } from "./ir/optimizer/fit";
import { intervalDelta, meanLogLoss } from "./ir/optimizer/metrics";
import {
  computeStats,
  dueByType,
  forecast,
  gradeBreakdown,
  gradeSpark,
  startOfLocalDayMs,
  type GradeEvent,
} from "./ir/stats";

export const IR_STATS_VIEW_TYPE = "ir-stats-view";

const WINDOW_DAYS = 30;
const SPARK_DAYS = 14;
const FORECAST_DAYS = 7;
const DAY_MS = 86400000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** What the scheduler section needs from the host plugin. */
export interface SchedulerHost {
  settings: IrSettings;
  saveSettings(): Promise<void>;
  /** Rebuild the FSRS engine from the current settings. */
  applyEngineConfig(): void;
}

/** Fixed fit seed: same log in, same parameters out, every run. */
const FIT_SEED = 42;

export class IrStatsView extends ItemView {
  private ledger: IrLedger;
  private host: SchedulerHost;
  private fitCancelled = false;

  constructor(leaf: WorkspaceLeaf, ledger: IrLedger, host: SchedulerHost) {
    super(leaf);
    this.ledger = ledger;
    this.host = host;
  }

  getViewType(): string {
    return IR_STATS_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "IR stats";
  }

  getIcon(): string {
    return "bar-chart-3";
  }

  async onOpen(): Promise<void> {
    await this.render();
  }

  async onClose(): Promise<void> {}

  /** Re-render from the ledger. Safe to call from the host plugin onChange. */
  refresh(): Promise<void> {
    return this.render();
  }

  private async render(): Promise<void> {
    const container = this.contentEl;
    container.empty();
    container.addClass("ir-stats-view");

    const header = container.createDiv({ cls: "ir-stats-header" });
    header.createEl("h4", { text: "IR stats" });
    const refresh = header.createEl("button", {
      cls: "ir-stats-refresh",
      attr: { "aria-label": "Refresh stats", title: "Refresh stats" },
    });
    setIcon(refresh, "refresh-cw");
    refresh.addEventListener("click", () => void this.render());

    const body = container.createDiv({ cls: "ir-stats-body" });
    body.createEl("p", { cls: "ir-stats-empty", text: "Loading..." });

    const events = await this.ledger.loadEvents();
    const state = await this.ledger.load();
    const now = Date.now();
    const undoneEventIds = new Set<string>();
    for (const ev of events) {
      if (ev.kind === "grade-undone") {
        const id = (ev.payload as { eventId?: unknown }).eventId;
        if (typeof id === "string") undoneEventIds.add(id);
      }
    }
    const grades: GradeEvent[] = [];
    for (const ev of events) {
      if (ev.kind !== "graded") continue;
      if (undoneEventIds.has(ev.id)) continue;
      const g = (ev.payload as { grade?: unknown }).grade;
      if (typeof g === "number") grades.push({ ts: ev.ts, grade: g });
    }

    const elements = Array.from(state.elements.values());
    const windowStart = now - WINDOW_DAYS * DAY_MS;
    const stats = computeStats(elements, grades, now, windowStart);

    body.empty();
    if (stats.total === 0) {
      body.createEl("p", {
        cls: "ir-stats-empty",
        text: "Nothing to measure yet. Mark a note as a topic (Alt+T) to start.",
      });
      return;
    }

    this.renderCounts(body, elements, stats, now);
    this.renderForecast(body, elements, now);
    this.renderReviewHistory(body, grades, stats, windowStart, now);
    this.renderScheduler(body, events, state);
  }

  // --- Scheduler parameters (PLAN-OPTIMIZER.md stage 3) -------------------

  private renderScheduler(
    body: HTMLElement,
    events: IrEvent[],
    state: LogState,
  ): void {
    const s = this.host.settings;
    const section = body.createDiv({ cls: "ir-stats-section" });
    section.createDiv({ cls: "ir-stats-section-title", text: "Scheduler" });

    const rows: Array<[string, string]> = [
      [
        "Parameters",
        s.fsrsParams
          ? `optimized ${new Date(s.fsrsParams.fittedAt).toISOString().slice(0, 10)}`
          : "FSRS-6 defaults",
      ],
    ];
    if (s.fsrsParams) {
      rows.push([
        "Fitted on",
        `${s.fsrsParams.reviewCount} reviews${s.fsrsParams.lowData ? " · low data" : ""}`,
      ]);
      rows.push([
        "Held-out log-loss",
        s.fsrsParams.heldOutLogLoss.toFixed(4),
      ]);
    }
    this.table(section, rows);

    // Desired retention: the one FSRS knob the user owns.
    const ret = section.createDiv({ cls: "ir-opt-retention" });
    const retLabel = ret.createSpan({
      text: `Desired retention: ${s.desiredRetention.toFixed(2)}`,
    });
    const slider = ret.createEl("input", {
      attr: {
        type: "range",
        min: "0.70",
        max: "0.97",
        step: "0.01",
        value: String(s.desiredRetention),
        "aria-label": "Desired retention",
      },
    });
    slider.addEventListener("input", () => {
      retLabel.setText(`Desired retention: ${Number(slider.value).toFixed(2)}`);
    });
    slider.addEventListener("change", () => {
      this.host.settings.desiredRetention = Number(slider.value);
      void this.host.saveSettings().then(() => this.host.applyEngineConfig());
    });

    const actions = section.createDiv({ cls: "ir-opt-actions" });
    const optimize = actions.createEl("button", {
      cls: "mod-cta",
      text: "Optimize from review log",
    });
    if (s.fsrsPreviousParams !== undefined) {
      const revert = actions.createEl("button", { text: "Revert" });
      revert.setAttr(
        "title",
        s.fsrsPreviousParams === null
          ? "Back to the FSRS-6 defaults"
          : "Back to the previous fitted parameters",
      );
      revert.addEventListener("click", () => void this.swapParams());
    }
    const out = section.createDiv({ cls: "ir-opt-out" });
    optimize.addEventListener("click", () => {
      optimize.disabled = true;
      void this.runOptimize(out, events, state).finally(() => {
        optimize.disabled = false;
      });
    });
  }

  /** Revert = swap active and previous, so it also un-reverts. */
  private async swapParams(): Promise<void> {
    const s = this.host.settings;
    const prev = s.fsrsPreviousParams;
    s.fsrsPreviousParams = s.fsrsParams ?? null;
    s.fsrsParams = prev ?? undefined;
    await this.host.saveSettings();
    this.host.applyEngineConfig();
    void this.render();
  }

  private async runOptimize(
    out: HTMLElement,
    events: IrEvent[],
    state: LogState,
  ): Promise<void> {
    out.empty();
    this.fitCancelled = false;

    const revlog = extractRevlog(events, state);
    const { tier } = fitTier(revlog.report);
    if (tier === "none") {
      const n = revlog.report.includedCards;
      out.createEl("p", {
        text: `Not enough data: ${n} usable item${n === 1 ? "" : "s"} of the 8 needed.`,
      });
      this.renderExclusions(out, revlog);
      return;
    }

    const progressWrap = out.createDiv({ cls: "ir-opt-progress" });
    const progressText = progressWrap.createSpan({ text: "step 0" });
    const track = progressWrap.createDiv({ cls: "ir-opt-progress-track" });
    const bar = track.createDiv({ cls: "ir-opt-progress-bar" });
    const cancel = progressWrap.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => {
      this.fitCancelled = true;
    });

    let result: FitResult | null = null;
    const gen = fit(revlog.cards, { seed: FIT_SEED });
    for (;;) {
      const next = await gen.next();
      if (next.done) {
        result = next.value;
        break;
      }
      if (this.fitCancelled) break;
      const p = next.value;
      progressText.setText(`step ${p.step}/${p.totalSteps}`);
      bar.style.setProperty("width", `${(p.step / p.totalSteps) * 100}%`);
      await new Promise(requestAnimationFrame);
    }
    progressWrap.remove();

    if (!result) {
      out.createDiv({ cls: "ir-stats-note", text: "Cancelled." });
      return;
    }
    this.renderFitResult(out, revlog, result);
  }

  private renderFitResult(
    out: HTMLElement,
    revlog: Revlog,
    result: FitResult,
  ): void {
    const s = this.host.settings;
    const evalCards = evalCardsFor(revlog.cards, FIT_SEED);
    // Score whatever is ACTIVE now on the same held-out cards the fit
    // scored its candidate on; that is the bar Apply must clear.
    const activeLoss = s.fsrsParams
      ? meanLogLoss(evalCards, s.fsrsParams.w)
      : result.defaultsHeldOutLoss;
    const better = result.candidateHeldOutLoss < activeLoss;

    const delta = better
      ? intervalDelta(
          revlog.cards,
          s.fsrsParams?.w,
          result.w,
          s.desiredRetention,
        )
      : null;

    const rows: Array<[string, string]> = [
      [
        "Usable",
        `${revlog.report.includedReviews} reviews / ${revlog.report.includedCards} items`,
      ],
      ["Candidate log-loss", result.candidateHeldOutLoss.toFixed(4)],
      [
        s.fsrsParams ? "Current log-loss" : "Current log-loss (defaults)",
        activeLoss.toFixed(4),
      ],
    ];
    if (delta) {
      const sign = (d: number) => (d > 0 ? `+${d}` : String(d));
      rows.push([
        "Next interval",
        `median ${sign(delta.medianDays)}d · ${delta.longer} longer / ${delta.shorter} shorter / ${delta.same} same`,
      ]);
    }
    if (result.lowData) rows.push(["Confidence", "low (under 400 reviews)"]);
    this.table(out, rows);
    this.renderExclusions(out, revlog);

    const actions = out.createDiv({ cls: "ir-opt-actions" });
    if (better) {
      const apply = actions.createEl("button", {
        cls: "mod-cta",
        text: "Apply",
      });
      apply.addEventListener("click", () => {
        void this.applyParams(revlog, result);
      });
      const discard = actions.createEl("button", { text: "Discard" });
      discard.addEventListener("click", () => out.empty());
      out.createDiv({
        cls: "ir-stats-note",
        text: "Apply changes future scheduling only; no due date moves.",
      });
    } else {
      out.createDiv({
        cls: "ir-stats-note",
        text: "No improvement over the current parameters. Nothing to apply.",
      });
      const dismiss = actions.createEl("button", { text: "Dismiss" });
      dismiss.addEventListener("click", () => out.empty());
    }
  }

  private async applyParams(revlog: Revlog, result: FitResult): Promise<void> {
    const s = this.host.settings;
    s.fsrsPreviousParams = s.fsrsParams ?? null;
    s.fsrsParams = {
      w: result.w,
      fsrsVersion: 6,
      fittedAt: Date.now(),
      reviewCount: revlog.report.includedReviews,
      heldOutLogLoss: result.candidateHeldOutLoss,
      lowData: result.lowData,
    };
    await this.host.saveSettings();
    this.host.applyEngineConfig();
    void this.render();
  }

  /**
   * One compact line, matching the stats idiom ("3 topic · 2 extract"),
   * not a floating table: "Excluded: 65 no rating · 3 under 2 reviews".
   */
  private renderExclusions(out: HTMLElement, revlog: Revlog): void {
    const SHORT: Record<string, string> = {
      noRating: "no rating",
      undone: "undone",
      missingElement: "element deleted",
      duplicate: "duplicate",
      shortCard: "under 2 reviews",
    };
    const nonZero = revlog.report.rows.filter((r) => r.count > 0);
    if (nonZero.length === 0) return;
    out.createDiv({
      cls: "ir-stats-note",
      text: `Excluded: ${nonZero.map((r) => `${r.count} ${SHORT[r.reason]}`).join(" · ")}`,
    });
  }

  private renderCounts(
    body: HTMLElement,
    elements: IrElement[],
    stats: ReturnType<typeof computeStats>,
    now: number,
  ): void {
    const byType = dueByType(elements, now);
    const rows: Array<[string, string]> = [
      ["Total elements", String(stats.total)],
      ["Scheduled", String(stats.queueSize)],
      ["Due now", String(stats.dueCount)],
    ];
    if (stats.dueCount > 0) {
      rows.push([
        "Due by type",
        `${byType.topic} topic · ${byType.extract} extract · ${byType.item} item`,
      ]);
    }
    this.table(body, rows);
  }

  /**
   * What lands over the next week.
   *
   * The most-asked-for SRS panel and the natural partner to the overload
   * ceiling: a user deciding whether to extract more today needs to see
   * tomorrow's bill first.
   */
  private renderForecast(
    body: HTMLElement,
    elements: IrElement[],
    now: number,
  ): void {
    const fc = forecast(elements, now, FORECAST_DAYS);
    const section = body.createDiv({ cls: "ir-stats-section" });
    section.createDiv({
      cls: "ir-stats-section-title",
      text: `Coming up · next ${FORECAST_DAYS} days`,
    });

    if (fc.windowTotal === 0) {
      section.createEl("p", {
        cls: "ir-stats-empty",
        text:
          fc.overdue > 0
            ? "Nothing new lands this week; the queue is all overdue."
            : "Nothing scheduled in the next week.",
      });
      return;
    }

    const max = Math.max(...fc.byDay);
    const chart = section.createDiv({ cls: "ir-stats-forecast" });
    const today = startOfLocalDayMs(now);
    for (let i = 0; i < fc.byDay.length; i++) {
      const n = fc.byDay[i];
      const day = new Date(today + i * DAY_MS);
      const label = i === 0 ? "Today" : WEEKDAYS[day.getDay()];
      const col = chart.createDiv({ cls: "ir-stats-forecast-col" });
      // Count above the bar: the number is the answer, the bar is the shape.
      col.createDiv({ cls: "ir-stats-forecast-count", text: String(n) });
      const track = col.createDiv({ cls: "ir-stats-forecast-track" });
      const bar = track.createDiv({ cls: "ir-stats-forecast-bar" });
      bar.style.setProperty("height", `${max === 0 ? 0 : (n / max) * 100}%`);
      if (n === 0) bar.addClass("is-empty");
      col.createDiv({ cls: "ir-stats-forecast-day", text: label });
      col.setAttr(
        "aria-label",
        `${label}: ${n} element${n === 1 ? "" : "s"} due`,
      );
    }

    section.createDiv({
      cls: "ir-stats-note",
      text: `${fc.windowTotal} due in the next ${FORECAST_DAYS} days${
        fc.overdue > 0 ? ` · ${fc.overdue} already overdue` : ""
      }`,
    });
  }

  private renderReviewHistory(
    body: HTMLElement,
    grades: GradeEvent[],
    stats: ReturnType<typeof computeStats>,
    windowStart: number,
    now: number,
  ): void {
    const section = body.createDiv({ cls: "ir-stats-section" });
    section.createDiv({
      cls: "ir-stats-section-title",
      text: `Reviews · last ${WINDOW_DAYS} days`,
    });

    const breakdown = gradeBreakdown(grades, windowStart, now);
    const rows: Array<[string, string]> = [
      ["Reviews", String(stats.reviewsInWindow)],
      [
        "Retention",
        stats.reviewsInWindow === 0
          ? "—"
          : `${(stats.retention * 100).toFixed(1)}%`,
      ],
    ];
    if (stats.reviewsInWindow > 0) {
      rows.push([
        "Grades",
        `${breakdown.again} again · ${breakdown.hard} hard · ${breakdown.good} good · ${breakdown.easy} easy`,
      ]);
    }
    this.table(section, rows);

    // The definition matters: Hard counts as a recall here, so this number
    // is not comparable to Anki's "again rate" without saying so.
    if (stats.reviewsInWindow > 0) {
      section.createDiv({
        cls: "ir-stats-note",
        text: "Retention counts Hard or better as a recall.",
      });
    }

    const spark = gradeSpark(grades, now, SPARK_DAYS);
    const max = Math.max(0, ...spark);
    if (max === 0) return;

    const sparkWrap = section.createDiv({ cls: "ir-stats-spark-wrap" });
    sparkWrap.createDiv({
      cls: "ir-stats-spark-caption",
      text: `Reviews per day · peak ${max}`,
    });
    const row = sparkWrap.createDiv({ cls: "ir-stats-spark" });
    const firstDay = startOfLocalDayMs(now) - (SPARK_DAYS - 1) * DAY_MS;
    for (let i = 0; i < spark.length; i++) {
      const n = spark[i];
      const bar = row.createDiv({ cls: "ir-stats-spark-bar" });
      // True proportion, no artificial floor: a 1-review day used to render
      // nearly as tall as the peak, which made the shape a lie.
      bar.style.setProperty("height", `${(n / max) * 100}%`);
      if (n === 0) bar.addClass("is-empty");
      const day = new Date(firstDay + i * DAY_MS);
      const label = `${WEEKDAYS[day.getDay()]} ${day.getDate()}`;
      bar.setAttr("title", `${label}: ${n}`);
      bar.setAttr("aria-label", `${label}: ${n} reviews`);
    }
    const axis = sparkWrap.createDiv({ cls: "ir-stats-spark-axis" });
    const oldest = new Date(firstDay);
    axis.createSpan({ text: `${WEEKDAYS[oldest.getDay()]} ${oldest.getDate()}` });
    axis.createSpan({ text: "today" });
  }

  private table(parent: HTMLElement, rows: Array<[string, string]>): void {
    const table = parent.createEl("table", { cls: "ir-stats-table" });
    for (const [label, value] of rows) {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: label, cls: "ir-stats-label" });
      tr.createEl("td", { text: value, cls: "ir-stats-value" });
    }
  }
}
