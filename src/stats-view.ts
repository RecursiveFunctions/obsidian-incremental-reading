import { ItemView, WorkspaceLeaf } from "obsidian";

import { IrStore } from "./ir/store";
import { computeStats, type GradeEvent } from "./ir/stats";

export const IR_STATS_VIEW_TYPE = "ir-stats-view";

const WINDOW_DAYS = 30;
const DAY_MS = 86400000;

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

  private async render(): Promise<void> {
    const container = this.contentEl;
    container.empty();
    container.addClass("ir-stats-view");

    const header = container.createDiv({ cls: "ir-tree-header" });
    header.createEl("h4", { text: "IR stats" });
    const refresh = header.createEl("button", {
      text: "Refresh",
      cls: "ir-tree-refresh",
    });
    refresh.onclick = () => void this.render();

    const body = container.createDiv({ cls: "ir-stats-body" });
    body.createEl("p", { text: "Loading..." });

    const events = await this.store.loadEvents();
    const state = await this.store.load();
    const now = Date.now();
    const grades: GradeEvent[] = [];
    for (const ev of events) {
      if (ev.kind !== "graded") continue;
      const g = (ev.payload as { grade?: unknown }).grade;
      if (typeof g === "number") grades.push({ ts: ev.ts, grade: g });
    }

    const stats = computeStats(
      Array.from(state.elements.values()),
      grades,
      now,
      now - WINDOW_DAYS * DAY_MS,
    );

    body.empty();
    const rows: Array<[string, string]> = [
      ["Total elements", String(stats.total)],
      ["Queue size", String(stats.queueSize)],
      ["Due now", String(stats.dueCount)],
      [`Reviews (last ${WINDOW_DAYS} d)`, String(stats.reviewsInWindow)],
      [
        "Retention",
        stats.reviewsInWindow === 0
          ? "—"
          : `${(stats.retention * 100).toFixed(1)}%`,
      ],
    ];
    const table = body.createEl("table", { cls: "ir-stats-table" });
    for (const [label, value] of rows) {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: label, cls: "ir-stats-label" });
      tr.createEl("td", { text: value, cls: "ir-stats-value" });
    }
  }
}
