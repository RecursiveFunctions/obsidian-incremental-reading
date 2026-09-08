import type { IrElement } from "./model";

/** grade: 1 Again, 2 Hard, 3 Good, 4 Easy. */
export interface GradeEvent {
  ts: number;
  grade: number;
}

export interface Stats {
  total: number;
  reviewsInWindow: number;
  retention: number;
  queueSize: number;
  dueCount: number;
}

export function startOfLocalDayMs(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Grade counts per local day, oldest → newest, covering `days` days ending
 * at the local day of `now`. Pure CSS sparkline input.
 */
export function gradeSpark(
  grades: ReadonlyArray<GradeEvent>,
  now: number,
  days = 14,
): number[] {
  const counts = Array.from({ length: days }, () => 0);
  const dayMs = 86400000;
  const end = startOfLocalDayMs(now);
  const start = end - (days - 1) * dayMs;
  for (const g of grades) {
    if (g.ts < start || g.ts > now) continue;
    const i = Math.floor((startOfLocalDayMs(g.ts) - start) / dayMs);
    if (i >= 0 && i < days) counts[i] += 1;
  }
  return counts;
}

/** Due time of an element, whichever schedule kind it carries. */
function dueOf(el: IrElement): number | undefined {
  const d = el.card?.due ?? el.schedule?.due;
  return d !== undefined && Number.isFinite(d) ? d : undefined;
}

export interface Forecast {
  /** Per-local-day counts, day 0 = today, future dues only. */
  byDay: number[];
  /** Everything already due at `now`. Never counted in `byDay`. */
  overdue: number;
  /** Sum of `byDay` — future dues inside the window. */
  windowTotal: number;
}

/**
 * How much lands per day over the next `days` days.
 *
 * Overdue is reported separately rather than folded into day 0: those two
 * numbers answer different questions ("what do I owe" vs "what is coming"),
 * and merging them makes today's bar tower over the rest of the chart for
 * anyone carrying a backlog — exactly the user this panel is for.
 */
export function forecast(
  elements: ReadonlyArray<IrElement>,
  now: number,
  days = 7,
): Forecast {
  const dayMs = 86400000;
  const today = startOfLocalDayMs(now);
  const byDay = Array.from({ length: days }, () => 0);
  let overdue = 0;
  for (const el of elements) {
    if (el.dismissed) continue;
    const d = dueOf(el);
    if (d === undefined) continue;
    if (d <= now) {
      overdue += 1;
      continue;
    }
    const i = Math.floor((startOfLocalDayMs(d) - today) / dayMs);
    if (i >= 0 && i < days) byDay[i] += 1;
  }
  return {
    byDay,
    overdue,
    windowTotal: byDay.reduce((a, b) => a + b, 0),
  };
}

export interface TypeCounts {
  topic: number;
  extract: number;
  item: number;
}

/** Non-dismissed, scheduled elements due at or before `now`, split by type. */
export function dueByType(
  elements: ReadonlyArray<IrElement>,
  now: number,
): TypeCounts {
  const out: TypeCounts = { topic: 0, extract: 0, item: 0 };
  for (const el of elements) {
    if (el.dismissed) continue;
    const d = dueOf(el);
    if (d === undefined || d > now) continue;
    out[el.type] += 1;
  }
  return out;
}

/** Grade counts in the window, index 0 unused so `[g]` reads naturally. */
export function gradeBreakdown(
  grades: ReadonlyArray<GradeEvent>,
  windowStartMs: number,
  now: number,
): { again: number; hard: number; good: number; easy: number } {
  const out = { again: 0, hard: 0, good: 0, easy: 0 };
  for (const g of grades) {
    if (g.ts < windowStartMs || g.ts > now) continue;
    if (g.grade === 1) out.again += 1;
    else if (g.grade === 2) out.hard += 1;
    else if (g.grade === 3) out.good += 1;
    else if (g.grade === 4) out.easy += 1;
  }
  return out;
}

export function computeStats(
  elements: IrElement[],
  grades: GradeEvent[],
  now: number,
  windowStartMs: number,
): Stats {
  const total = elements.length;

  let queueSize = 0;
  let dueCount = 0;

  for (const el of elements) {
    if (el.dismissed) continue;

    if (el.card || el.schedule) {
      queueSize += 1;
    }

    if (
      (el.card && el.card.due <= now) ||
      (el.schedule && el.schedule.due <= now)
    ) {
      dueCount += 1;
    }
  }

  let reviewsInWindow = 0;
  let recalled = 0;
  for (const g of grades) {
    if (g.ts >= windowStartMs && g.ts <= now) {
      reviewsInWindow += 1;
      if (g.grade >= 2) {
        recalled += 1;
      }
    }
  }

  const retention =
    reviewsInWindow === 0
      ? 0
      : Math.round((recalled / reviewsInWindow) * 1e4) / 1e4;

  return {
    total,
    reviewsInWindow,
    retention,
    queueSize,
    dueCount,
  };
}
