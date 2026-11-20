import type { ElementId } from "./ids";
import { undoneEventIds, type LogState } from "./log";
import { computeElementHistoryCounts } from "./mercy";
import type { IrElement, IrEvent, StoredCard } from "./model";
import { difficulty01ToStored } from "./sm20-scheduler";

export type LeechReason =
  | "lapses"
  | "high-difficulty-short-interval"
  | "chronic-postpones"
  | "high-fail-rate";

export interface LeechCriteria {
  minLapses?: number;
  maxLapseIntervalDays?: number;
  minDifficulty01?: number;
  maxIntervalDays?: number;
  minRepsForStuck?: number;
  minFailRate?: number;
  maxPostpones?: number;
  includeDismissed?: boolean;
}

export const DEFAULT_LEECH_CRITERIA: Required<LeechCriteria> = {
  minLapses: 5,
  maxLapseIntervalDays: 30,
  minDifficulty01: 0.85,
  maxIntervalDays: 14,
  minRepsForStuck: 6,
  minFailRate: 0.45,
  maxPostpones: 8,
  includeDismissed: false,
};

export interface LeechDiagnosis {
  elementId: ElementId;
  reasons: LeechReason[];
  lapses: number;
  difficulty: number;
  scheduledDays: number;
  reps: number;
  postponeCount: number;
  failRate?: number;
  gradedReps?: number;
}

export interface LeechGradeStats {
  againCount: number;
  gradedReps: number;
}

/**
 * Compute post-`card-reset` graded repetition and lapse (`grade === 1`) counts
 * per element, skipping retracted (`grade-undone`) events.
 */
export function computePostResetGradeStats(
  events: readonly IrEvent[],
): Map<ElementId, LeechGradeStats> {
  const undone = undoneEventIds([...events]);
  const sorted = [...events].sort(
    (a, b) => a.lamport - b.lamport || a.id.localeCompare(b.id),
  );
  const stats = new Map<ElementId, LeechGradeStats>();
  for (const ev of sorted) {
    if (ev.kind === "card-reset") {
      stats.set(ev.target, { againCount: 0, gradedReps: 0 });
      continue;
    }
    if (ev.kind !== "graded" || undone.has(ev.id)) continue;
    const grade = ev.payload.grade;
    if (typeof grade !== "number") continue;
    const cur = stats.get(ev.target) ?? { againCount: 0, gradedReps: 0 };
    cur.gradedReps += 1;
    if (grade === 1) cur.againCount += 1;
    stats.set(ev.target, cur);
  }
  return stats;
}

/** Multi-criteria leech detector (`TLeechManager` `0x00fa0fa0`..`0x00fa49b0`). */
export function diagnoseLeech(
  element: IrElement,
  criteria: LeechCriteria = {},
  postponeCount = 0,
  gradeStats?: LeechGradeStats,
): LeechDiagnosis | null {
  const cfg = { ...DEFAULT_LEECH_CRITERIA, ...criteria };
  if (element.dismissed && !cfg.includeDismissed) return null;

  const reasons: LeechReason[] = [];
  const card = element.card;
  const lapses = card?.lapses ?? 0;
  const difficulty = card?.difficulty ?? 0;
  const scheduledDays = card?.scheduledDays ?? 0;
  const reps = card?.reps ?? 0;
  const gradedReps = gradeStats?.gradedReps ?? 0;
  const failRate = gradedReps > 0 ? gradeStats!.againCount / gradedReps : undefined;

  if (element.type === "item" && card) {
    if (
      cfg.minLapses > 0 &&
      lapses >= cfg.minLapses &&
      scheduledDays <= cfg.maxLapseIntervalDays
    ) {
      reasons.push("lapses");
    }
    const minStoredDifficulty = difficulty01ToStored(cfg.minDifficulty01);
    if (
      reps >= cfg.minRepsForStuck &&
      difficulty >= minStoredDifficulty &&
      scheduledDays <= cfg.maxIntervalDays
    ) {
      reasons.push("high-difficulty-short-interval");
    }
    if (
      cfg.minFailRate > 0 &&
      failRate !== undefined &&
      gradedReps >= cfg.minRepsForStuck &&
      failRate >= cfg.minFailRate
    ) {
      reasons.push("high-fail-rate");
    }
  }

  if (cfg.maxPostpones > 0 && postponeCount >= cfg.maxPostpones) {
    reasons.push("chronic-postpones");
  }

  if (reasons.length === 0) return null;
  return {
    elementId: element.id,
    reasons,
    lapses,
    difficulty,
    scheduledDays,
    reps,
    postponeCount,
    ...(failRate !== undefined ? { failRate, gradedReps } : {}),
  };
}

export function isLeech(
  element: IrElement,
  criteria: LeechCriteria = {},
  postponeCount = 0,
  gradeStats?: LeechGradeStats,
): boolean {
  return diagnoseLeech(element, criteria, postponeCount, gradeStats) !== null;
}

export function findLeeches(
  state: Pick<LogState, "elements">,
  events: readonly IrEvent[] = [],
  criteria: LeechCriteria = {},
): LeechDiagnosis[] {
  const history =
    events.length > 0 ? computeElementHistoryCounts(events) : new Map();
  const gradeStatsMap =
    events.length > 0 ? computePostResetGradeStats(events) : new Map<ElementId, LeechGradeStats>();
  const results: LeechDiagnosis[] = [];
  for (const element of state.elements.values()) {
    const postponeCount = history.get(element.id)?.recentPostponeCount ?? 0;
    const diag = diagnoseLeech(
      element,
      criteria,
      postponeCount,
      gradeStatsMap.get(element.id),
    );
    if (diag) results.push(diag);
  }
  results.sort(
    (a, b) =>
      b.lapses - a.lapses ||
      (b.failRate ?? 0) - (a.failRate ?? 0) ||
      b.difficulty - a.difficulty ||
      b.postponeCount - a.postponeCount ||
      a.elementId.localeCompare(b.elementId),
  );
  return results;
}

export function buildCardResetCard(nowMs: number): StoredCard {
  return {
    due: nowMs,
    stability: 0,
    difficulty: 0,
    elapsedDays: 0,
    scheduledDays: 0,
    reps: 0,
    lapses: 0,
    state: 0,
    learningSteps: 0,
  };
}
