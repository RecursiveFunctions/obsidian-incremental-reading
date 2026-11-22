/**
 * Pure presenter helpers for Segmented `IrStatsView` (#63) and
 * Progressive-Disclosure `IrSettingTab` (#64).
 */

import type { ElementId } from "./ids";
import type { IrElement } from "./model";
import { forgettingIndexByPriority, type PriorityGrade } from "./priority-analytics";

export type StatsTabId = "overview" | "triage" | "models";

export interface ActionablePriorityFiBucket {
  start: number;
  end: number;
  failures: number;
  samples: number;
  rate: number;
  targetRate: number;
  status: "ok" | "elevated" | "low-sample";
  activeItemIds: ElementId[];
}

export function buildActionablePriorityFiBuckets(
  grades: readonly PriorityGrade[],
  elements: Iterable<IrElement>,
  desiredRetention: number,
  bucketSize = 5,
): ActionablePriorityFiBucket[] {
  const size = Math.max(1, Math.min(100, Math.round(bucketSize)));
  const rawBuckets = forgettingIndexByPriority(grades, size);
  if (rawBuckets.length === 0) return [];

  const clampedRetention = Math.min(0.99, Math.max(0.5, desiredRetention));
  const targetRate = Math.round((1 - clampedRetention) * 1000) / 1000;

  const itemsByBucketStart = new Map<number, ElementId[]>();
  for (const el of elements) {
    if (el.dismissed || el.type !== "item") continue;
    const p = Math.min(100, Math.max(0, el.priority));
    const start = Math.min(100 - size, Math.floor(p / size) * size);
    const list = itemsByBucketStart.get(start);
    if (list) list.push(el.id);
    else itemsByBucketStart.set(start, [el.id]);
  }

  return rawBuckets.map((b) => {
    const status: ActionablePriorityFiBucket["status"] =
      b.samples < 5
        ? "low-sample"
        : b.rate > targetRate + 0.05
          ? "elevated"
          : "ok";
    return {
      ...b,
      targetRate,
      status,
      activeItemIds: itemsByBucketStart.get(b.start) ?? [],
    };
  });
}

export function formatReviewsPerReadingSummary(
  reviewsPerReading: number,
  sortingPolicy?: { preset?: string; readingProportion?: number },
): { description: string; hasCustomOverride: boolean } {
  const n = Math.max(0, Math.round(reviewsPerReading));
  const stdProp = n <= 0 ? 0 : 1 / (n + 1);
  const stdReadPct = Math.round(stdProp * 100);
  const stdItemPct = 100 - stdReadPct;

  const customProp =
    sortingPolicy?.preset === "custom" &&
    typeof sortingPolicy.readingProportion === "number" &&
    Number.isFinite(sortingPolicy.readingProportion)
      ? sortingPolicy.readingProportion
      : null;

  if (customProp !== null && Math.abs(customProp - stdProp) > 0.006) {
    const customPct = Math.round(customProp * 100);
    return {
      hasCustomOverride: true,
      description:
        `Custom reading proportion active (${customPct}% reading, ${100 - customPct}% items). ` +
        `Moving this slider switches to ${stdReadPct}% reading (${n} item${n === 1 ? "" : "s"} per reading).`,
    };
  }

  if (n === 0) {
    return {
      hasCustomOverride: false,
      description: "Items only (0% reading, 100% recall items).",
    };
  }

  return {
    hasCustomOverride: false,
    description: `Show ${n} recall item${n === 1 ? "" : "s"} per reading topic/extract (${stdReadPct}% reading, ${stdItemPct}% items).`,
  };
}
