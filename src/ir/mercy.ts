export interface MercyEntry {
  id: string;
  priority: number;
  dueMs: number;
  dismissed?: boolean;
  type?: "item" | "reading";
  interval?: number;
  requestedRetention?: number;
  aFactor?: number;
  postponeCount?: number;
}

export interface MercyOptions {
  ceiling: number;
  /** Priorities at or below this value are protected. */
  priorityCutoff: number;
}

export interface MercyAssignment {
  id: string;
  previousDue: number;
  newDue: number;
  targetLocalDate: string;
}

export interface MercyPlan {
  totalDue: number;
  dueToday: string[];
  protectedToday: string[];
  assignments: MercyAssignment[];
  postponed: string[];
  postponedCount: number;
  effectiveToday: number;
  perDay: Array<{ date: string; count: number }>;
}

export interface AutoPostponeOptions {
  keepOverdue: number;
  priorityCutoff: number;
}

export interface AdvancedPostponePolicy {
  operation: "postpone" | "dilute" | "advance";
  includeItems: boolean;
  includeReading: boolean;
  itemDelayFactor: number;
  readingDelayFactor: number;
  minDelayDays: number;
  maxDelayDays: number;
  skipIntervalAbove?: number;
  skipPriorityAtOrBelow?: number;
  skipPostponeCountAbove?: number;
  skipRetentionAtOrAbove?: number;
  skipAFactorAtOrBelow?: number;
  scaleByPriority?: boolean;
  scaleByRetention?: boolean;
  scaleByAFactor?: boolean;
}

export interface AdvancedPostponePlan {
  assignments: MercyAssignment[];
  protectedIds: string[];
  skippedIds: string[];
}

/** Legacy result shape retained for callers and integrations. */
export interface MercyResult {
  dueToday: string[];
  postponed: string[];
  postponedCount: number;
}

function compareImportance(a: MercyEntry, b: MercyEntry): number {
  return a.priority - b.priority || a.dueMs - b.dueMs || a.id.localeCompare(b.id);
}

function localDateKey(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function addLocalDays(ms: number, days: number): number {
  const d = new Date(ms);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

function combineLocalDate(dateMs: number, sourceMs: number, fallbackMs: number): number {
  const date = new Date(dateMs);
  const source = new Date(Number.isFinite(sourceMs) ? sourceMs : fallbackMs);
  date.setHours(source.getHours(), source.getMinutes(), source.getSeconds(), source.getMilliseconds());
  return date.getTime();
}

/**
 * Plan capacity-aware Mercy redistribution without mutating entries. Due work
 * is sorted by importance; protected overflow remains today, while other
 * overflow is assigned to the earliest future local date with capacity.
 */
export function planMercy(
  entries: readonly MercyEntry[],
  actionMs: number,
  opts: MercyOptions,
): MercyPlan {
  const ceiling = Math.max(0, Math.floor(opts.ceiling));
  if (ceiling === 0) {
    return {
      totalDue: 0,
      dueToday: [],
      protectedToday: [],
      assignments: [],
      postponed: [],
      postponedCount: 0,
      effectiveToday: 0,
      perDay: [],
    };
  }
  const due = entries.filter((e) => !e.dismissed && Number.isFinite(e.dueMs) && e.dueMs <= actionMs).sort(compareImportance);
  const future = entries.filter((e) => !e.dismissed && Number.isFinite(e.dueMs) && e.dueMs > actionMs);
  const dueToday = due.slice(0, ceiling);
  const protectedToday: MercyEntry[] = [];
  const overflow: MercyEntry[] = [];
  for (const entry of due.slice(ceiling)) {
    (entry.priority <= opts.priorityCutoff ? protectedToday : overflow).push(entry);
  }
  const counts = new Map<string, number>();
  for (const entry of future) {
    const day = localDateKey(entry.dueMs);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  const assignments: MercyAssignment[] = [];
  for (const entry of overflow) {
    let dayMs = addLocalDays(actionMs, 1);
    while ((counts.get(localDateKey(dayMs)) ?? 0) >= ceiling && ceiling > 0) dayMs = addLocalDays(dayMs, 1);
    const date = localDateKey(dayMs);
    const newDue = combineLocalDate(dayMs, entry.dueMs, actionMs);
    counts.set(date, (counts.get(date) ?? 0) + 1);
    assignments.push({ id: entry.id, previousDue: entry.dueMs, newDue, targetLocalDate: date });
  }
  const perDay = [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count }));
  return {
    totalDue: due.length,
    dueToday: [...dueToday, ...protectedToday].map((e) => e.id),
    protectedToday: protectedToday.map((e) => e.id),
    assignments,
    postponed: assignments.map((a) => a.id),
    postponedCount: assignments.length,
    effectiveToday: dueToday.length + protectedToday.length,
    perDay,
  };
}

export function planAutoPostpone(
  entries: readonly MercyEntry[],
  actionMs: number,
  opts: AutoPostponeOptions,
): MercyPlan {
  const todayStart = new Date(actionMs);
  todayStart.setHours(0, 0, 0, 0);
  const cutoff = todayStart.getTime();
  const overdue = entries
    .filter((entry) => !entry.dismissed && Number.isFinite(entry.dueMs) && entry.dueMs < cutoff)
    .sort(compareImportance);
  const dueToday = entries
    .filter((entry) => !entry.dismissed && Number.isFinite(entry.dueMs) &&
      entry.dueMs >= cutoff && entry.dueMs <= actionMs)
    .sort(compareImportance);
  const keep = Math.max(0, Math.floor(opts.keepOverdue));
  const keptOverdue = overdue.slice(0, keep);
  const protectedOverdue: MercyEntry[] = [];
  const overflow: MercyEntry[] = [];
  for (const entry of overdue.slice(keep)) {
    (entry.priority <= opts.priorityCutoff ? protectedOverdue : overflow).push(entry);
  }
  const assignments = overflow.map((entry, index) => {
    const dayMs = addLocalDays(cutoff, index + 1);
    return {
      id: entry.id,
      previousDue: entry.dueMs,
      newDue: combineLocalDate(dayMs, entry.dueMs, actionMs),
      targetLocalDate: localDateKey(dayMs),
    };
  });
  const perDay = assignments.map((assignment) => ({ date: assignment.targetLocalDate, count: 1 }));
  return {
    totalDue: overdue.length + dueToday.length,
    dueToday: [...keptOverdue, ...protectedOverdue, ...dueToday].map((entry) => entry.id),
    protectedToday: protectedOverdue.map((entry) => entry.id),
    assignments,
    postponed: assignments.map((assignment) => assignment.id),
    postponedCount: assignments.length,
    effectiveToday: keptOverdue.length + protectedOverdue.length + dueToday.length,
    perDay,
  };
}

export function planAdvancedPostpone(
  entries: readonly MercyEntry[],
  actionMs: number,
  policy: AdvancedPostponePolicy,
): AdvancedPostponePlan {
  const assignments: MercyAssignment[] = [];
  const protectedIds: string[] = [];
  const skippedIds: string[] = [];
  const minDelay = Math.max(0, Math.round(policy.minDelayDays));
  const maxDelay = Math.max(minDelay, Math.round(policy.maxDelayDays));
  for (const entry of [...entries].sort(compareImportance)) {
    const isItem = entry.type === "item";
    if ((isItem && !policy.includeItems) || (!isItem && !policy.includeReading)) {
      skippedIds.push(entry.id);
      continue;
    }
    if (entry.dismissed || !Number.isFinite(entry.dueMs) ||
      (policy.operation === "postpone" && entry.dueMs > actionMs) ||
      (policy.skipIntervalAbove !== undefined && (entry.interval ?? 0) > policy.skipIntervalAbove) ||
      (policy.skipPriorityAtOrBelow !== undefined && entry.priority <= policy.skipPriorityAtOrBelow) ||
      (policy.skipPostponeCountAbove !== undefined && (entry.postponeCount ?? 0) > policy.skipPostponeCountAbove) ||
      (policy.skipRetentionAtOrAbove !== undefined && (entry.requestedRetention ?? 0) >= policy.skipRetentionAtOrAbove) ||
      (policy.skipAFactorAtOrBelow !== undefined && (entry.aFactor ?? Infinity) <= policy.skipAFactorAtOrBelow)) {
      protectedIds.push(entry.id);
      continue;
    }
    let factor = isItem ? policy.itemDelayFactor : policy.readingDelayFactor;
    if (policy.scaleByPriority) factor *= 0.5 + entry.priority / 100;
    if (policy.scaleByRetention && entry.requestedRetention !== undefined) factor *= 1.5 - entry.requestedRetention;
    if (policy.scaleByAFactor && entry.aFactor !== undefined) factor *= entry.aFactor / 2;
    const base = Math.max(1, entry.interval ?? 1);
    const delay = Math.min(maxDelay, Math.max(minDelay, Math.round(base * factor)));
    const signedDelay = policy.operation === "advance" ? -delay : delay;
    const newDue = combineLocalDate(addLocalDays(actionMs, signedDelay), entry.dueMs, actionMs);
    assignments.push({ id: entry.id, previousDue: entry.dueMs, newDue,
      targetLocalDate: localDateKey(newDue) });
  }
  return { assignments, protectedIds, skippedIds };
}

export type BranchPolicyMode = "respect" | "ignore" | "conservative" | "liberal";

export function resolveBranchDelay(
  inherited: number,
  branch: number | undefined,
  mode: BranchPolicyMode,
): number {
  if (branch === undefined || mode === "ignore") return inherited;
  if (mode === "respect") return branch;
  return mode === "conservative" ? Math.min(inherited, branch) : Math.max(inherited, branch);
}

/** Compatibility wrapper for the original pure split contract. */
export function redistribute(entries: MercyEntry[], nowMs: number, opts: MercyOptions): MercyResult {
  const plan = planMercy(entries, nowMs, opts);
  return { dueToday: plan.dueToday, postponed: plan.postponed, postponedCount: plan.postponedCount };
}

export { localDateKey, addLocalDays, combineLocalDate };
