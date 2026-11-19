import type { ElementId } from "./ids";
import type { LogState } from "./log";
import { computeElementHistoryCounts } from "./mercy";
import type { IrElement, IrEvent, StoredCard } from "./model";
import { difficulty01ToStored } from "./sm20-scheduler";

export type LeechReason =
  | "lapses"
  | "high-difficulty-short-interval"
  | "chronic-postpones";

export interface LeechCriteria {
  minLapses?: number;
  minDifficulty01?: number;
  maxIntervalDays?: number;
  minRepsForStuck?: number;
  maxPostpones?: number;
  includeDismissed?: boolean;
}

export const DEFAULT_LEECH_CRITERIA: Required<LeechCriteria> = {
  minLapses: 5,
  minDifficulty01: 0.85,
  maxIntervalDays: 14,
  minRepsForStuck: 6,
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
}

/** Multi-criteria leech detector (`TLeechManager` `0x00fa0fa0`..`0x00fa49b0`). */
export function diagnoseLeech(
  element: IrElement,
  criteria: LeechCriteria = {},
  postponeCount = 0,
): LeechDiagnosis | null {
  const cfg = { ...DEFAULT_LEECH_CRITERIA, ...criteria };
  if (element.dismissed && !cfg.includeDismissed) return null;

  const reasons: LeechReason[] = [];
  const card = element.card;
  const lapses = card?.lapses ?? 0;
  const difficulty = card?.difficulty ?? 0;
  const scheduledDays = card?.scheduledDays ?? 0;
  const reps = card?.reps ?? 0;

  if (element.type === "item" && card) {
    if (cfg.minLapses > 0 && lapses >= cfg.minLapses) {
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
  };
}

export function isLeech(
  element: IrElement,
  criteria: LeechCriteria = {},
  postponeCount = 0,
): boolean {
  return diagnoseLeech(element, criteria, postponeCount) !== null;
}

export function findLeeches(
  state: Pick<LogState, "elements">,
  events: readonly IrEvent[] = [],
  criteria: LeechCriteria = {},
): LeechDiagnosis[] {
  const history =
    events.length > 0 ? computeElementHistoryCounts(events) : new Map();
  const results: LeechDiagnosis[] = [];
  for (const element of state.elements.values()) {
    const postponeCount = history.get(element.id)?.recentPostponeCount ?? 0;
    const diag = diagnoseLeech(element, criteria, postponeCount);
    if (diag) results.push(diag);
  }
  results.sort(
    (a, b) =>
      b.lapses - a.lapses ||
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
