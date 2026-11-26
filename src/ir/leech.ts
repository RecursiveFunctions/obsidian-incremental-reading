import type { ElementId } from "./ids";
import { undoneEventIds, type LogState } from "./log";
import { computeElementHistoryCounts } from "./mercy";
import type { IrElement, IrEvent, StoredCard } from "./model";
import { difficulty01ToStored } from "./sm20-scheduler";
import { postponeCeilingForPriority } from "../sm18-ir-mechanics";

export type LeechHandlingPolicy =
  | "manual"
  | "semi-leeches"
  | "auto-postpone"
  | "auto-forget";

export function normalizeLeechPolicy(value: unknown): LeechHandlingPolicy {
  if (
    value === "semi-leeches" ||
    value === "auto-postpone" ||
    value === "auto-forget"
  ) {
    return value;
  }
  return "manual";
}

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

export type SemiLeechReason = "near-lapses" | "elevated-fail-rate";

export interface SemiLeechDiagnosis {
  elementId: ElementId;
  reasons: SemiLeechReason[];
  lapses: number;
  scheduledDays: number;
  reps: number;
  failRate?: number;
}

/**
 * SM-20 semi-leech early-warning detector (`0x00c928f0` / `0x00fa0fa0`):
 * flags items 1 lapse below `minLapses` (within `maxLapseIntervalDays`) or
 * carrying an elevated post-reset fail rate (`>= 80%` of `minFailRate`) that
 * have NOT yet crossed the full leech threshold (#67).
 */
export function diagnoseSemiLeech(
  element: IrElement,
  criteria: LeechCriteria = {},
  postponeCount = 0,
  gradeStats?: LeechGradeStats,
): SemiLeechDiagnosis | null {
  const cfg = { ...DEFAULT_LEECH_CRITERIA, ...criteria };
  if (element.dismissed && !cfg.includeDismissed) return null;
  if (element.type !== "item" || !element.card) return null;
  if (diagnoseLeech(element, criteria, postponeCount, gradeStats) !== null) {
    return null;
  }

  const card = element.card;
  const lapses = card.lapses ?? 0;
  const scheduledDays = card.scheduledDays ?? 0;
  const reps = card.reps ?? 0;
  const gradedReps = gradeStats?.gradedReps ?? 0;
  const failRate = gradedReps > 0 ? gradeStats!.againCount / gradedReps : undefined;

  const reasons: SemiLeechReason[] = [];
  if (
    cfg.minLapses > 1 &&
    lapses === cfg.minLapses - 1 &&
    scheduledDays <= cfg.maxLapseIntervalDays
  ) {
    reasons.push("near-lapses");
  }
  if (
    cfg.minFailRate > 0 &&
    failRate !== undefined &&
    gradedReps >= Math.max(1, cfg.minRepsForStuck - 1) &&
    failRate >= cfg.minFailRate * 0.8 &&
    failRate < cfg.minFailRate
  ) {
    reasons.push("elevated-fail-rate");
  }
  if (reasons.length === 0) return null;
  return {
    elementId: element.id,
    reasons,
    lapses,
    scheduledDays,
    reps,
    ...(failRate !== undefined ? { failRate } : {}),
  };
}

export function isSemiLeech(
  element: IrElement,
  criteria: LeechCriteria = {},
  postponeCount = 0,
  gradeStats?: LeechGradeStats,
): boolean {
  return diagnoseSemiLeech(element, criteria, postponeCount, gradeStats) !== null;
}

export function findSemiLeeches(
  state: Pick<LogState, "elements">,
  events: readonly IrEvent[] = [],
  criteria: LeechCriteria = {},
): SemiLeechDiagnosis[] {
  const history =
    events.length > 0 ? computeElementHistoryCounts(events) : new Map();
  const gradeStatsMap =
    events.length > 0
      ? computePostResetGradeStats(events)
      : new Map<ElementId, LeechGradeStats>();
  const results: SemiLeechDiagnosis[] = [];
  for (const element of state.elements.values()) {
    const postponeCount = history.get(element.id)?.recentPostponeCount ?? 0;
    const diag = diagnoseSemiLeech(
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
      a.elementId.localeCompare(b.elementId),
  );
  return results;
}

export type LeechReviewIntervention =
  | { kind: "none" }
  | { kind: "warn-semi-leech"; message: string }
  | {
      kind: "auto-postpone";
      postponeDays: number;
      postponedCard: StoredCard;
      message: string;
    }
  | {
      kind: "auto-forget";
      resetCard: StoredCard;
      message: string;
    };

/**
 * Plan post-lapse (`grade === 1`) leech handling according to the mutually
 * exclusive SM-20 leech policy (`TLeechManagerDlg` `0x00c928f0`..`0x00c92b00`, #67).
 */
export function planLeechReviewIntervention(opts: {
  elementAfterGrade: IrElement;
  grade: number;
  policy: LeechHandlingPolicy;
  criteria?: LeechCriteria;
  nowMs: number;
}): LeechReviewIntervention {
  const { elementAfterGrade, grade, policy, criteria, nowMs } = opts;
  if (grade !== 1 || elementAfterGrade.type !== "item" || !elementAfterGrade.card) {
    return { kind: "none" };
  }
  const normalized = normalizeLeechPolicy(policy);
  if (normalized === "manual") return { kind: "none" };

  const cfg = { ...DEFAULT_LEECH_CRITERIA, ...criteria };
  const leechDiag = diagnoseLeech(elementAfterGrade, cfg);

  if (normalized === "semi-leeches") {
    if (leechDiag) {
      return {
        kind: "warn-semi-leech",
        message: `Leech detected (${leechDiag.lapses} lapses) — consider splitting or rephrasing`,
      };
    }
    const semi = diagnoseSemiLeech(elementAfterGrade, cfg);
    if (semi) {
      return {
        kind: "warn-semi-leech",
        message: `Semi-leech warning (${semi.lapses} lapses, 1 away from leech threshold)`,
      };
    }
    return { kind: "none" };
  }

  if (!leechDiag) return { kind: "none" };

  if (normalized === "auto-forget") {
    return {
      kind: "auto-forget",
      resetCard: buildCardResetCard(nowMs),
      message: `Leech auto-reset (${leechDiag.lapses} lapses)`,
    };
  }

  const postponeDays = Math.max(
    2,
    postponeCeilingForPriority(
      elementAfterGrade.priority,
      2,
      Math.max(2, cfg.maxLapseIntervalDays),
    ),
  );
  const DAY_MS = 86_400_000;
  return {
    kind: "auto-postpone",
    postponeDays,
    postponedCard: {
      ...elementAfterGrade.card,
      scheduledDays: postponeDays,
      due: nowMs + postponeDays * DAY_MS,
    },
    message: `Leech auto-postponed ${postponeDays}d (${leechDiag.lapses} lapses)`,
  };
}
