/**
 * Pure on-demand Element Info (`I`) telemetry computation (#62).
 * Zero Obsidian imports; computes item retrievability, stability, difficulty,
 * SInc, primary vs. shadow intervals, rank, and reading element diagnostics.
 */

import type { ElementId } from "./ids";
import type { IrElement, IrEvent, ReferenceMetadata } from "./model";
import type { PrimaryItemScheduler } from "./item-scheduler";
import { previewGradeDelays } from "./grade-preview";
import { lookupBlendedSinc, type Sm20Matrix } from "./sm20-matrix";
import { computeItemMemoryCurve, type ItemMemoryCurve } from "./sm20-analytics";
import {
  computeSm20Retrievability,
  storedDifficultyTo01,
} from "./sm20-scheduler";

const MS_PER_DAY = 86_400_000;

export interface ItemElementTelemetry {
  kind: "item";
  activeScheduler: PrimaryItemScheduler;
  retrievabilityPct: number | null;
  stabilityDays: number | null;
  difficulty10: number | null;
  difficulty01: number | null;
  sincFactor: number | null;
  predictedGoodDays: {
    sm20: number;
    fsrs: number;
  };
  reps: number;
  lapses: number;
  priority: number;
  priorityRank: number;
  totalActive: number;
  lastPriorityDelta: number | null;
  memoryCurve: ItemMemoryCurve | null;
  conceptName: string | null;
  reference: ReferenceMetadata | null;
}

export type AnchorHealthStatus =
  | "none"
  | "attached"
  | "drifted"
  | "detached"
  | "pdf"
  | "media";

export interface ReadingElementTelemetry {
  kind: "reading";
  elementType: "topic" | "extract";
  currentIntervalDays: number;
  nextIntervalDays: number;
  aFactor: number;
  effectiveAFactor: number;
  charCount: number;
  wordCount: number;
  childExtractCount: number;
  childItemCount: number;
  anchorStatus: AnchorHealthStatus;
  sourcePath: string | null;
  priority: number;
  priorityRank: number;
  totalActive: number;
  lastPriorityDelta: number | null;
  conceptName: string | null;
  reference: ReferenceMetadata | null;
}

export type ElementTelemetry = ItemElementTelemetry | ReadingElementTelemetry;

export interface ComputeElementTelemetryInput {
  element: IrElement;
  allElements: Iterable<IrElement>;
  nowMs: number;
  rawBodyText: string;
  activeScheduler: PrimaryItemScheduler;
  requestRetention: number;
  sm20Matrix?: Sm20Matrix;
  nextReadingIntervalDays?: number;
  effectiveAFactor?: number;
  defaultAFactor?: number;
  anchorStatusOverride?: AnchorHealthStatus;
  recentEvents?: readonly IrEvent[];
  conceptName?: string | null;
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function computePriorityRank(
  targetId: ElementId,
  allElements: Iterable<IrElement>,
): { rank: number; totalActive: number; childExtracts: number; childItems: number } {
  const active: IrElement[] = [];
  let childExtracts = 0;
  let childItems = 0;
  for (const el of allElements) {
    if (!el.dismissed) {
      active.push(el);
    }
    if (el.parentId === targetId && !el.dismissed) {
      if (el.type === "extract") childExtracts += 1;
      else if (el.type === "item") childItems += 1;
    }
  }
  active.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  const idx = active.findIndex((e) => e.id === targetId);
  return {
    rank: idx >= 0 ? idx + 1 : Math.max(1, active.length),
    totalActive: Math.max(1, active.length),
    childExtracts,
    childItems,
  };
}

function findLastPriorityDelta(
  targetId: ElementId,
  currentPriority: number,
  recentEvents?: readonly IrEvent[],
): number | null {
  if (!recentEvents || recentEvents.length === 0) return null;
  const prioHistory: number[] = [];
  for (const ev of recentEvents) {
    if (ev.target !== targetId) continue;
    if (ev.kind === "element-created") {
      const el = ev.payload.element as IrElement | undefined;
      if (el && typeof el.priority === "number") prioHistory.push(el.priority);
    } else if (ev.kind === "priority-set" && typeof ev.payload.priority === "number") {
      prioHistory.push(ev.payload.priority);
    }
  }
  if (prioHistory.length < 2) return null;
  const prev = prioHistory[prioHistory.length - 2]!;
  const delta = Math.round((currentPriority - prev) * 100) / 100;
  return delta === 0 ? null : delta;
}

export function computeElementTelemetry(
  input: ComputeElementTelemetryInput,
): ElementTelemetry {
  const { element, nowMs, rawBodyText, activeScheduler, requestRetention, sm20Matrix } = input;
  const { rank, totalActive, childExtracts, childItems } = computePriorityRank(
    element.id,
    input.allElements,
  );
  const lastPriorityDelta = findLastPriorityDelta(
    element.id,
    element.priority,
    input.recentEvents,
  );

  if (element.type === "item") {
    const card = element.card;
    const reps = card?.reps ?? 0;
    const lapses = card?.lapses ?? 0;
    let retrievabilityPct: number | null = null;
    let stabilityDays: number | null = null;
    let difficulty10: number | null = null;
    let difficulty01: number | null = null;
    let sincFactor: number | null = null;

    if (card && reps > 0 && card.stability > 0) {
      stabilityDays = Math.round(card.stability * 100) / 100;
      const d01 = storedDifficultyTo01(card.difficulty);
      difficulty01 = Math.round(d01 * 1000) / 1000;
      difficulty10 = Math.round(Math.min(10, Math.max(1, card.difficulty)) * 100) / 100;
      const lastReviewMs = card.lastReview ?? nowMs - Math.max(0, card.scheduledDays) * MS_PER_DAY;
      const elapsedDays = Math.max(0, (nowMs - lastReviewMs) / MS_PER_DAY);
      const r = computeSm20Retrievability(elapsedDays, card.stability);
      retrievabilityPct = Math.round(r * 1000) / 10;
      sincFactor =
        Math.round(Math.max(1.05, lookupBlendedSinc(sm20Matrix, d01, card.stability, r)) * 100) /
        100;
    }

    const sm20Delays = previewGradeDelays(card, nowMs, requestRetention, "sm20", sm20Matrix);
    const fsrsDelays = previewGradeDelays(card, nowMs, requestRetention, "fsrs", sm20Matrix);

    return {
      kind: "item",
      activeScheduler,
      retrievabilityPct,
      stabilityDays,
      difficulty10,
      difficulty01,
      sincFactor,
      predictedGoodDays: {
        sm20: Math.max(0.01, Math.round((sm20Delays.good / MS_PER_DAY) * 10) / 10),
        fsrs: Math.max(0.01, Math.round((fsrsDelays.good / MS_PER_DAY) * 10) / 10),
      },
      reps,
      lapses,
      priority: element.priority,
      priorityRank: rank,
      totalActive,
      lastPriorityDelta,
      memoryCurve: computeItemMemoryCurve(element, nowMs, input.recentEvents, requestRetention),
      conceptName: input.conceptName ?? element.conceptId ?? null,
      reference: element.reference ?? null,
    };
  }

  const defaultA = input.defaultAFactor ?? 2;
  const aFactor = Math.round((element.schedule?.aFactor ?? defaultA) * 100) / 100;
  const effectiveAFactor = Math.round((input.effectiveAFactor ?? aFactor) * 100) / 100;
  const currentIntervalDays = Math.round((element.schedule?.interval ?? 0) * 10) / 10;
  const nextIntervalDays =
    input.nextReadingIntervalDays !== undefined
      ? Math.round(input.nextReadingIntervalDays * 10) / 10
      : Math.max(1, Math.round(Math.max(1, currentIntervalDays) * effectiveAFactor * 10) / 10);

  let anchorStatus: AnchorHealthStatus = input.anchorStatusOverride ?? "none";
  const sourcePath = element.anchor?.sourcePath ?? element.notePath ?? null;
  if (!input.anchorStatusOverride && element.anchor) {
    if (element.anchor.media) anchorStatus = "media";
    else if (element.anchor.pdf) anchorStatus = "pdf";
    else if (element.anchorState === "detached") anchorStatus = "detached";
    else if (element.anchorState === "needs-reanchor") anchorStatus = "drifted";
    else anchorStatus = "attached";
  }

  return {
    kind: "reading",
    elementType: element.type === "extract" ? "extract" : "topic",
    currentIntervalDays,
    nextIntervalDays,
    aFactor,
    effectiveAFactor,
    charCount: rawBodyText.length,
    wordCount: countWords(rawBodyText),
    childExtractCount: childExtracts,
    childItemCount: childItems,
    anchorStatus,
    sourcePath,
    priority: element.priority,
    priorityRank: rank,
    totalActive,
    lastPriorityDelta,
    conceptName: input.conceptName ?? element.conceptId ?? null,
    reference: element.reference ?? null,
  };
}
