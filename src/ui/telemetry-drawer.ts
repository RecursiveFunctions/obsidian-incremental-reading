/**
 * Non-modal Element Info (`I`) inline drawer / bottom sheet (#62).
 * Surfaces item & reading telemetry on demand while keeping the default
 * reading dock clean for novices.
 */

import { formatPriority } from "../ir/relative-priority";
import type { ElementTelemetry } from "../ir/element-telemetry";
import type { IrWidthTier } from "../ir/viewport-tiers";

export interface TelemetryDrawerCallbacks {
  onClose: () => void;
  onChangePriority?: (newPriority: number) => void;
  onOpenRelativePriority?: (trigger: HTMLElement) => void;
  onChangeAFactor?: (newAFactor: number) => void;
}

function addMetricCell(
  grid: HTMLElement,
  label: string,
  value: string,
  subtext?: string,
): void {
  const cell = grid.createDiv({ cls: "ir-telemetry-cell" });
  cell.createDiv({ cls: "ir-telemetry-cell-label", text: label });
  cell.createDiv({ cls: "ir-telemetry-cell-value", text: value });
  if (subtext) {
    cell.createDiv({ cls: "ir-telemetry-cell-sub", text: subtext });
  }
}

export function renderElementTelemetryDrawer(
  parent: HTMLElement,
  telemetry: ElementTelemetry,
  tier: IrWidthTier,
  callbacks: TelemetryDrawerCallbacks,
): HTMLElement {
  const isSheet = tier === "compact";
  const drawer = parent.createDiv({
    cls: `ir-telemetry-drawer${isSheet ? " ir-telemetry-drawer--sheet" : " ir-telemetry-drawer--inline"}`,
    attr: {
      role: "region",
      "aria-label": "Element scheduling info",
    },
  });

  const header = drawer.createDiv({ cls: "ir-telemetry-header" });
  const heading =
    telemetry.kind === "item"
      ? `Item telemetry · ${telemetry.activeScheduler === "sm20" ? "SM-20" : "FSRS-6"}`
      : `${telemetry.elementType === "extract" ? "Extract" : "Topic"} telemetry`;
  header.createSpan({ cls: "ir-telemetry-title", text: heading });

  const closeBtn = header.createEl("button", {
    cls: "ir-telemetry-close",
    type: "button",
    text: "Close (I)",
    attr: { "aria-label": "Close element info" },
  });
  closeBtn.addEventListener("click", callbacks.onClose);

  const grid = drawer.createDiv({ cls: "ir-telemetry-grid" });

  const deltaSuffix =
    telemetry.lastPriorityDelta !== null
      ? ` (${telemetry.lastPriorityDelta > 0 ? "+" : ""}${telemetry.lastPriorityDelta})`
      : "";
  addMetricCell(
    grid,
    "Priority & Rank",
    `${formatPriority(telemetry.priority)}%`,
    `#${telemetry.priorityRank} of ${telemetry.totalActive}${deltaSuffix}`,
  );

  if (telemetry.kind === "item") {
    addMetricCell(
      grid,
      "Retrievability (R)",
      telemetry.retrievabilityPct !== null ? `${telemetry.retrievabilityPct}%` : "New",
      telemetry.reps > 0 ? `${telemetry.reps} reps · ${telemetry.lapses} lapses` : "Unmemorized",
    );
    addMetricCell(
      grid,
      "Stability (S)",
      telemetry.stabilityDays !== null ? `${telemetry.stabilityDays}d` : "—",
      telemetry.sincFactor !== null ? `SInc ×${telemetry.sincFactor}` : "First review pending",
    );
    addMetricCell(
      grid,
      "Difficulty (D)",
      telemetry.difficulty10 !== null ? `${telemetry.difficulty10} / 10` : "—",
      telemetry.difficulty01 !== null ? `SM-20 D=${telemetry.difficulty01}` : undefined,
    );
    const primaryDays =
      telemetry.activeScheduler === "sm20"
        ? telemetry.predictedGoodDays.sm20
        : telemetry.predictedGoodDays.fsrs;
    const shadowDays =
      telemetry.activeScheduler === "sm20"
        ? telemetry.predictedGoodDays.fsrs
        : telemetry.predictedGoodDays.sm20;
    const shadowName = telemetry.activeScheduler === "sm20" ? "FSRS-6" : "SM-20";
    addMetricCell(
      grid,
      "Next Good interval",
      `+${primaryDays}d`,
      `Shadow (${shadowName}): +${shadowDays}d`,
    );
  } else {
    addMetricCell(
      grid,
      "Reading interval",
      telemetry.currentIntervalDays > 0 ? `${telemetry.currentIntervalDays}d` : "First read",
      `Next: +${telemetry.nextIntervalDays}d`,
    );
    addMetricCell(
      grid,
      "A-Factor",
      `×${telemetry.aFactor}`,
      telemetry.effectiveAFactor !== telemetry.aFactor
        ? `Effective ×${telemetry.effectiveAFactor}`
        : "Interval multiplier",
    );
    addMetricCell(
      grid,
      "Length & Children",
      `${telemetry.wordCount.toLocaleString()} words`,
      `${telemetry.childExtractCount} extracts · ${telemetry.childItemCount} items`,
    );
    if (telemetry.elementType === "extract" || telemetry.anchorStatus !== "none") {
      const statusLabels: Record<typeof telemetry.anchorStatus, string> = {
        none: "Standalone note",
        attached: "Anchored in source",
        drifted: "Anchor drifted",
        detached: "Source detached",
        pdf: "PDF page anchor",
        media: "Media timestamp anchor",
      };
      addMetricCell(
        grid,
        "Source anchor",
        statusLabels[telemetry.anchorStatus],
        telemetry.sourcePath ?? undefined,
      );
    }
  }

  // Inline editable controls (Priority + Reading A-Factor) — zero modal popups
  const editRow = drawer.createDiv({ cls: "ir-telemetry-controls" });
  if (callbacks.onChangePriority) {
    const prioGroup = editRow.createDiv({ cls: "ir-telemetry-field" });
    prioGroup.createEl("label", { cls: "ir-telemetry-label", text: "Priority (0–100)" });
    const prioInput = prioGroup.createEl("input", { cls: "ir-priority-input" });
    prioInput.type = "number";
    prioInput.min = "0";
    prioInput.max = "100";
    prioInput.step = "0.1";
    prioInput.value = formatPriority(telemetry.priority);
    prioInput.addEventListener("change", () => {
      const n = Number(prioInput.value);
      if (Number.isFinite(n)) callbacks.onChangePriority?.(n);
    });
    if (callbacks.onOpenRelativePriority) {
      const relBtn = prioGroup.createEl("button", {
        cls: "ir-review-util-btn",
        type: "button",
        text: "Reorder in queue…",
      });
      relBtn.addEventListener("click", () => callbacks.onOpenRelativePriority?.(relBtn));
    }
  }

  if (telemetry.kind === "reading" && callbacks.onChangeAFactor) {
    const afGroup = editRow.createDiv({ cls: "ir-telemetry-field" });
    afGroup.createEl("label", { cls: "ir-telemetry-label", text: "A-Factor (1.1–10)" });
    const afInput = afGroup.createEl("input", { cls: "ir-priority-input" });
    afInput.type = "number";
    afInput.min = "1.1";
    afInput.max = "10";
    afInput.step = "0.1";
    afInput.value = String(telemetry.aFactor);
    afInput.addEventListener("change", () => {
      const n = Number(afInput.value);
      if (Number.isFinite(n) && n > 1) {
        callbacks.onChangeAFactor?.(Math.min(10, Math.max(1.1, n)));
      }
    });
  }

  return drawer;
}
