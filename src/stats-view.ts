import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";

import { IrStore } from "./ir/store";
import type { IrElement } from "./ir/model";
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

export class IrStatsView extends ItemView {
  private store: IrStore;

  constructor(leaf: WorkspaceLeaf, store: IrStore) {
    super(leaf);
    this.store = store;
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

  /** Re-render from the store. Safe to call from the host plugin onChange. */
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

    const events = await this.store.loadEvents();
    const state = await this.store.load();
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
