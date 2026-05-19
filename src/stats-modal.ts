/**
 * Stats modal: read-only window onto `computeStats`. Pulls every event
 * and the folded state from the store, projects `graded` events down to
 * the `GradeEvent` shape the pure core wants, and renders the five
 * numbers as a small table. Window defaults to the last 30 days so
 * "retention" is the recent figure, not lifetime.
 */

import { App, Modal } from "obsidian";
import type { IrStore } from "./ir/store";
import { computeStats, type GradeEvent } from "./ir/stats";

const WINDOW_DAYS = 30;
const DAY_MS = 86400000;

export class StatsModal extends Modal {
  constructor(
    app: App,
    private store: IrStore,
  ) {
    super(app);
  }

  async onOpen(): Promise<void> {
    const { contentEl, titleEl } = this;
    titleEl.setText("IR stats");
    contentEl.empty();
    contentEl.createEl("p", { text: "Loading..." });

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

    contentEl.empty();
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
    const table = contentEl.createEl("table", { cls: "ir-stats-table" });
    for (const [label, value] of rows) {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: label, cls: "ir-stats-label" });
      tr.createEl("td", { text: value, cls: "ir-stats-value" });
    }
  }
}
