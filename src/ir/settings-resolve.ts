import {
  cloneDefaultSettings,
  type IrSettings,
  type ReprioritizationAction,
} from "./settings-data";

/**
 * Settings keys that need a one-time grandfather when introduced.
 * Kept pure so tests don't import Obsidian.
 */

/**
 * Divergence picker (DESIGN §5): new installs default off. Existing
 * vaults already saw the picker on every divergent grade, so a missing
 * key in saved data means "keep expert mode on."
 */
export function resolveShowDivergencePicker(
  saved: { showDivergencePicker?: boolean } | null | undefined,
): boolean {
  if (saved == null) return false;
  if (Object.prototype.hasOwnProperty.call(saved, "showDivergencePicker")) {
    return saved.showDivergencePicker === true;
  }
  return true;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function finite(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value)) : fallback;
}

function action(value: unknown, fallback: ReprioritizationAction): ReprioritizationAction {
  return value === "off" || value === "suggest" || value === "pause" ? value : fallback;
}

export function resolveSettings(saved: Partial<IrSettings> | null | undefined): IrSettings {
  const defaults = cloneDefaultSettings();
  if (saved == null) return defaults;
  const result = { ...defaults, ...saved } as IrSettings;
  const sorting = record(saved.sortingPolicy);
  const legacyProportion = typeof saved.reviewsPerReading === "number"
    ? saved.reviewsPerReading <= 0 ? 0 : 1 / (saved.reviewsPerReading + 1)
    : defaults.sortingPolicy.readingProportion;
  const legacyJitter = saved.interleaveSimilarPriority === false ? 0 : undefined;
  result.schemaVersion = 2;
  result.sortingPolicy = {
    version: 1,
    preset: sorting.preset === "strict" || sorting.preset === "discovery" ||
      sorting.preset === "custom" ? sorting.preset : defaults.sortingPolicy.preset,
    traversal: sorting.traversal === "priority" ? "priority" : "mixed",
    readingProportion: finite(sorting.readingProportion, legacyProportion, 0, 1),
    itemJitter: finite(sorting.itemJitter,
      legacyJitter ?? defaults.sortingPolicy.itemJitter, 0, 1),
    readingJitter: finite(sorting.readingJitter,
      legacyJitter ?? defaults.sortingPolicy.readingJitter, 0, 1),
    autoSort: sorting.autoSort === undefined ? defaults.sortingPolicy.autoSort : sorting.autoSort === true,
  };
  const postpone = record(saved.autoPostponePolicy);
  result.autoPostponePolicy = {
    version: 1,
    enabled: postpone.enabled === true,
    keepOverdue: Math.round(finite(postpone.keepOverdue,
      saved.mercyCeiling ?? defaults.autoPostponePolicy.keepOverdue, 0, 100_000)),
    priorityCutoff: finite(postpone.priorityCutoff,
      saved.mercyPriorityCutoff ?? defaults.autoPostponePolicy.priorityCutoff, 0, 100),
    advanced: postpone.advanced === true,
  };
  const scheduling = record(saved.prioritySchedulingPolicy);
  result.prioritySchedulingPolicy = {
    version: 1,
    enabled: scheduling.enabled === true,
    itemHighRetention: finite(scheduling.itemHighRetention, defaults.prioritySchedulingPolicy.itemHighRetention, 0.7, 0.99),
    itemLowRetention: finite(scheduling.itemLowRetention, defaults.prioritySchedulingPolicy.itemLowRetention, 0.7, 0.99),
    readingHighAFactor: finite(scheduling.readingHighAFactor, defaults.prioritySchedulingPolicy.readingHighAFactor, 1.05, 10),
    readingLowAFactor: finite(scheduling.readingLowAFactor, defaults.prioritySchedulingPolicy.readingLowAFactor, 1.05, 10),
  };
  const guidance = record(saved.reprioritizationPolicy);
  result.reprioritizationPolicy = {
    version: 1,
    repeatedFailure: action(guidance.repeatedFailure, defaults.reprioritizationPolicy.repeatedFailure),
    repeatedFailureThreshold: Math.round(finite(guidance.repeatedFailureThreshold, 3, 1, 100)),
    earlySuccess: action(guidance.earlySuccess, defaults.reprioritizationPolicy.earlySuccess),
    earlySuccessCount: Math.round(finite(guidance.earlySuccessCount, 1, 1, 100)),
    articleCompletion: action(guidance.articleCompletion, defaults.reprioritizationPolicy.articleCompletion),
    largeBatch: action(guidance.largeBatch, defaults.reprioritizationPolicy.largeBatch),
    largeBatchThreshold: Math.round(finite(guidance.largeBatchThreshold, 10, 1, 100_000)),
  };
  result.notices = { ...defaults.notices, ...record(saved.notices) } as IrSettings["notices"];
  result.treeDisplayMode = saved.treeDisplayMode === "priority" ? "priority" : "hierarchy";
  return result;
}
