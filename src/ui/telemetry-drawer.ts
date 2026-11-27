/**
 * Non-modal Element Info (`I`) inline drawer / bottom sheet (#62).
 * Surfaces item & reading telemetry with progressive disclosure:
 * - Headline summary (<= 4 core metrics) + quick Priority / A-Factor controls
 * - Collapsible scheduler & forgetting-curve diagnostics
 * - Collapsible Concept Group (with autocomplete) & propagating Reference fields
 */

import { formatPriority } from "../ir/relative-priority";
import type { ElementTelemetry } from "../ir/element-telemetry";
import type { ReferenceMetadata } from "../ir/model";
import type { IrWidthTier } from "../ir/viewport-tiers";

export interface TelemetryDrawerCallbacks {
  onClose: () => void;
  onChangePriority?: (newPriority: number) => void;
  onOpenRelativePriority?: (trigger: HTMLElement) => void;
  onChangeAFactor?: (newAFactor: number) => void;
  onChangeMetadata?: (conceptName: string | null, reference: ReferenceMetadata | null) => void;
  existingConcepts?: readonly string[];
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
  const titleWrap = header.createDiv({ cls: "ir-telemetry-title-wrap" });
  const heading =
    telemetry.kind === "item"
      ? `Item info · ${telemetry.activeScheduler === "sm20" ? "SM-20" : "FSRS-6"}`
      : `${telemetry.elementType === "extract" ? "Extract" : "Topic"} info`;
  titleWrap.createSpan({ cls: "ir-telemetry-title", text: heading });
  if (telemetry.conceptName) {
    titleWrap.createSpan({
      cls: "ir-telemetry-pill",
      text: telemetry.conceptName,
      attr: { title: `Concept group: ${telemetry.conceptName}` },
    });
  }

  const closeBtn = header.createEl("button", {
    cls: "ir-telemetry-close",
    type: "button",
    text: "Close (I)",
    attr: { "aria-label": "Close element info" },
  });
  closeBtn.addEventListener("click", callbacks.onClose);

  // 1. Headline summary (4 core cells max — Miller's Law)
  const summaryGrid = drawer.createDiv({ cls: "ir-telemetry-grid" });
  const deltaSuffix =
    telemetry.lastPriorityDelta !== null
      ? ` (${telemetry.lastPriorityDelta > 0 ? "+" : ""}${telemetry.lastPriorityDelta})`
      : "";
  addMetricCell(
    summaryGrid,
    "Priority & Rank",
    `${formatPriority(telemetry.priority)}%`,
    `#${telemetry.priorityRank} of ${telemetry.totalActive}${deltaSuffix}`,
  );

  if (telemetry.kind === "item") {
    addMetricCell(
      summaryGrid,
      "Retrievability (R)",
      telemetry.retrievabilityPct !== null ? `${telemetry.retrievabilityPct}%` : "New",
      telemetry.reps > 0 ? `${telemetry.reps} reps · ${telemetry.lapses} lapses` : "Unmemorized",
    );
    addMetricCell(
      summaryGrid,
      "Stability (S)",
      telemetry.stabilityDays !== null ? `${telemetry.stabilityDays}d` : "—",
      telemetry.sincFactor !== null ? `SInc ×${telemetry.sincFactor}` : "First review pending",
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
      summaryGrid,
      "Next Good interval",
      `+${primaryDays}d`,
      `Alt (${shadowName}): +${shadowDays}d`,
    );
  } else {
    addMetricCell(
      summaryGrid,
      "Reading interval",
      telemetry.currentIntervalDays > 0 ? `${telemetry.currentIntervalDays}d` : "First read",
      `Next: +${telemetry.nextIntervalDays}d`,
    );
    addMetricCell(
      summaryGrid,
      "A-Factor",
      `×${telemetry.aFactor}`,
      telemetry.effectiveAFactor !== telemetry.aFactor
        ? `Effective ×${telemetry.effectiveAFactor}`
        : "Interval multiplier",
    );
    addMetricCell(
      summaryGrid,
      "Length & children",
      `${telemetry.wordCount.toLocaleString()} words`,
      `${telemetry.childExtractCount} extracts · ${telemetry.childItemCount} items`,
    );
  }

  // 2. Quick inline Priority + Reading A-Factor controls
  if (callbacks.onChangePriority || (telemetry.kind === "reading" && callbacks.onChangeAFactor)) {
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
  }

  // 3. Collapsible diagnostics (Difficulty, Anchor health, Forgetting curve & history)
  if (telemetry.kind === "item") {
    const diagDetails = drawer.createEl("details", { cls: "ir-drawer-details" });
    const diffLabel =
      telemetry.difficulty10 !== null ? `D ${telemetry.difficulty10}/10` : "Unrated";
    diagDetails.createEl("summary", {
      cls: "ir-drawer-summary",
      text: `Memory curve & model diagnostics (${diffLabel})`,
    });
    const diagBody = diagDetails.createDiv({ cls: "ir-drawer-details-body" });
    const diagGrid = diagBody.createDiv({ cls: "ir-telemetry-grid" });
    addMetricCell(
      diagGrid,
      "Difficulty (D)",
      telemetry.difficulty10 !== null ? `${telemetry.difficulty10} / 10` : "—",
      telemetry.difficulty01 !== null ? `SM-20 D=${telemetry.difficulty01}` : undefined,
    );
    addMetricCell(
      diagGrid,
      "Stability gain (SInc)",
      telemetry.sincFactor !== null ? `×${telemetry.sincFactor}` : "—",
      "Matrix-blended factor",
    );

    if (telemetry.memoryCurve && telemetry.memoryCurve.points.length > 1) {
      const curveBox = diagBody.createDiv({ cls: "ir-telemetry-memory-curve" });
      curveBox.createDiv({
        cls: "ir-telemetry-cell-label",
        text: `Forgetting curve (${telemetry.memoryCurve.horizonDays}d horizon · target ${telemetry.memoryCurve.targetRetentionPct}%)`,
      });
      const svg = curveBox.createSvg("svg", {
        cls: "ir-telemetry-curve-svg",
        attr: { viewBox: "0 0 240 64" },
      });
      svg.style.width = "100%";
      svg.style.height = "64px";

      const targetY = 60 - (telemetry.memoryCurve.targetRetentionPct / 100) * 54;
      svg.createSvg("line", {
        attr: {
          x1: "0",
          x2: "240",
          y1: targetY.toFixed(1),
          y2: targetY.toFixed(1),
          stroke: "var(--text-faint)",
          "stroke-dasharray": "3,3",
          "stroke-width": "1",
        },
      });

      const maxD = Math.max(1, telemetry.memoryCurve.horizonDays);
      const pts = telemetry.memoryCurve.points
        .map((p) => {
          const x = (p.dayOffset / maxD) * 240;
          const y = 60 - (p.retrievabilityPct / 100) * 54;
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(" ");
      svg.createSvg("polyline", {
        attr: {
          fill: "none",
          stroke: "var(--interactive-accent)",
          "stroke-width": "2",
          points: pts,
        },
      });

      const nowX = Math.min(240, Math.max(0, (telemetry.memoryCurve.elapsedDaysNow / maxD) * 240));
      const nowY = 60 - (telemetry.memoryCurve.currentRetrievabilityPct / 100) * 54;
      svg.createSvg("circle", {
        attr: {
          cx: nowX.toFixed(1),
          cy: nowY.toFixed(1),
          r: "3.5",
          fill: "var(--interactive-accent)",
        },
      });
      if (telemetry.memoryCurve.history.length > 0) {
        const recent = telemetry.memoryCurve.history.slice(-5);
        const histText = recent
          .map((h) => `G${h.smGrade}→${h.scheduledDays}d (S=${h.stability}d)`)
          .join(" · ");
        curveBox.createDiv({ cls: "ir-telemetry-cell-sub", text: `History: ${histText}` });
      }
    }
  } else if (telemetry.elementType === "extract" || telemetry.anchorStatus !== "none") {
    const statusLabels: Record<typeof telemetry.anchorStatus, string> = {
      none: "Standalone note",
      attached: "Anchored in source",
      drifted: "Anchor drifted",
      detached: "Source detached",
      pdf: "PDF page anchor",
      media: "Media timestamp anchor",
    };
    const diagDetails = drawer.createEl("details", { cls: "ir-drawer-details" });
    diagDetails.createEl("summary", {
      cls: "ir-drawer-summary",
      text: `Source anchor (${statusLabels[telemetry.anchorStatus]})`,
    });
    const diagBody = diagDetails.createDiv({ cls: "ir-drawer-details-body" });
    const diagGrid = diagBody.createDiv({ cls: "ir-telemetry-grid" });
    addMetricCell(
      diagGrid,
      "Anchor status",
      statusLabels[telemetry.anchorStatus],
      telemetry.sourcePath ?? undefined,
    );
    addMetricCell(diagGrid, "Characters", `${telemetry.charCount.toLocaleString()} chars`);
  }

  // 4. Collapsible Concept Group & Propagating Reference section
  if (callbacks.onChangeMetadata) {
    const hasExistingMeta = Boolean(
      telemetry.conceptName ||
        telemetry.reference?.author ||
        telemetry.reference?.title ||
        telemetry.reference?.source ||
        telemetry.reference?.link,
    );
    const metaDetails = drawer.createEl("details", { cls: "ir-drawer-details" });
    if (hasExistingMeta) metaDetails.open = true;

    const summaryBadges: string[] = [];
    if (telemetry.conceptName) summaryBadges.push(telemetry.conceptName);
    const refSummary =
      telemetry.reference?.title ?? telemetry.reference?.source ?? telemetry.reference?.author;
    if (refSummary) {
      summaryBadges.push(refSummary.length > 28 ? `${refSummary.slice(0, 25)}…` : refSummary);
    }
    metaDetails.createEl("summary", {
      cls: "ir-drawer-summary",
      text:
        summaryBadges.length > 0
          ? `Concept & source reference (${summaryBadges.join(" · ")})`
          : "Concept group & source reference",
    });

    const metaBody = metaDetails.createDiv({ cls: "ir-drawer-details-body" });
    const metaRow = metaBody.createDiv({ cls: "ir-telemetry-controls" });
    const datalistId = `ir-concept-datalist-${Math.random().toString(36).slice(2, 8)}`;

    const conceptField = metaRow.createDiv({ cls: "ir-telemetry-field" });
    conceptField.createEl("label", { cls: "ir-telemetry-label", text: "Concept group" });
    const conceptIn = conceptField.createEl("input", {
      cls: "ir-priority-input",
      attr: {
        type: "text",
        placeholder: "e.g. Neurobiology",
        list: datalistId,
      },
    });
    conceptIn.value = telemetry.conceptName ?? "";
    if (callbacks.existingConcepts && callbacks.existingConcepts.length > 0) {
      const dl = conceptField.createEl("datalist", { attr: { id: datalistId } });
      for (const name of callbacks.existingConcepts) {
        dl.createEl("option", { attr: { value: name } });
      }
    }

    const authorField = metaRow.createDiv({ cls: "ir-telemetry-field" });
    authorField.createEl("label", { cls: "ir-telemetry-label", text: "Author" });
    const authorIn = authorField.createEl("input", {
      cls: "ir-priority-input",
      attr: { type: "text", placeholder: "Author" },
    });
    authorIn.value = telemetry.reference?.author ?? "";

    const sourceField = metaRow.createDiv({ cls: "ir-telemetry-field" });
    sourceField.createEl("label", { cls: "ir-telemetry-label", text: "Title / source" });
    const sourceIn = sourceField.createEl("input", {
      cls: "ir-priority-input",
      attr: { type: "text", placeholder: "Book, paper, or lecture" },
    });
    sourceIn.value = telemetry.reference?.title ?? telemetry.reference?.source ?? "";

    const linkField = metaRow.createDiv({ cls: "ir-telemetry-field" });
    linkField.createEl("label", { cls: "ir-telemetry-label", text: "URL / DOI" });
    const linkIn = linkField.createEl("input", {
      cls: "ir-priority-input",
      attr: { type: "text", placeholder: "Optional citation link" },
    });
    linkIn.value = telemetry.reference?.link ?? "";

    const emitMeta = () => {
      const nextConcept = conceptIn.value.trim() || null;
      const prevRef = telemetry.reference ?? {};
      const nextAuthor = authorIn.value.trim();
      const nextTitle = sourceIn.value.trim();
      const nextLink = linkIn.value.trim();
      const nextRef: ReferenceMetadata = {
        ...prevRef,
        ...(nextAuthor ? { author: nextAuthor } : { author: undefined }),
        ...(nextTitle ? { title: nextTitle } : { title: undefined }),
        ...(nextLink ? { link: nextLink } : { link: undefined }),
      };
      const hasAny = Object.values(nextRef).some((v) => typeof v === "string" && v.trim().length > 0);
      callbacks.onChangeMetadata?.(nextConcept, hasAny ? nextRef : null);
    };
    conceptIn.addEventListener("change", emitMeta);
    authorIn.addEventListener("change", emitMeta);
    sourceIn.addEventListener("change", emitMeta);
    linkIn.addEventListener("change", emitMeta);
  }

  return drawer;
}
