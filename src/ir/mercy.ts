export interface MercyEntry {
  id: string;
  priority: number;
  dueMs: number;
  dismissed?: boolean;
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

/** Compatibility wrapper for the original pure split contract. */
export function redistribute(entries: MercyEntry[], nowMs: number, opts: MercyOptions): MercyResult {
  const plan = planMercy(entries, nowMs, opts);
  return { dueToday: plan.dueToday, postponed: plan.postponed, postponedCount: plan.postponedCount };
}

export { localDateKey, addLocalDays, combineLocalDate };
