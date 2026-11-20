import type { ElementId } from "./ids";
import { undoneEventIds } from "./log";
import type { IrElement, IrEvent } from "./model";

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

export interface HeatmapDay {
  dayStartMs: number;
  count: number;
  grades: number;
  reads: number;
}

export interface ActivityHeatmap {
  days: HeatmapDay[];
  maxCount: number;
  totalCount: number;
  activeDays: number;
}

/**
 * Daily review + reading activity heatmap over `weeks * 7` local days ending today.
 * Counts non-undone `graded` events and reading `topic-advanced` events
 * (excluding internal `extract-parent-decay` events).
 */
export function activityHeatmap(
  events: ReadonlyArray<IrEvent>,
  now: number,
  weeks = 26,
): ActivityHeatmap {
  const totalDays = Math.max(1, Math.trunc(weeks) * 7);
  const dayMs = 86_400_000;
  const today = startOfLocalDayMs(now);
  const start = today - (totalDays - 1) * dayMs;
  const days: HeatmapDay[] = Array.from({ length: totalDays }, (_, i) => ({
    dayStartMs: start + i * dayMs,
    count: 0,
    grades: 0,
    reads: 0,
  }));

  const undone = undoneEventIds([...events]);
  for (const ev of events) {
    if (ev.ts < start || ev.ts > now) continue;
    const isGrade = ev.kind === "graded" && !undone.has(ev.id);
    const isRead =
      ev.kind === "topic-advanced" &&
      ev.payload.operation !== "extract-parent-decay";
    if (!isGrade && !isRead) continue;

    const bucketIdx = Math.floor((startOfLocalDayMs(ev.ts) - start) / dayMs);
    if (bucketIdx < 0 || bucketIdx >= totalDays) continue;
    const bucket = days[bucketIdx]!;
    bucket.count += 1;
    if (isGrade) bucket.grades += 1;
    else bucket.reads += 1;
  }

  let maxCount = 0;
  let totalCount = 0;
  let activeDays = 0;
  for (const d of days) {
    totalCount += d.count;
    if (d.count > 0) activeDays += 1;
    if (d.count > maxCount) maxCount = d.count;
  }
  return { days, maxCount, totalCount, activeDays };
}

export interface TrueRetentionPoint {
  dayStartMs: number;
  total: number;
  passed: number;
  retention: number | null;
  rollingTotal: number;
  rollingPassed: number;
}

export interface RollingTrueRetention {
  points: TrueRetentionPoint[];
  overallRetention: number | null;
  totalReviewReps: number;
  totalPassedReps: number;
}

/**
 * Rolling true-retention curve over `days` local days (default 30d with 7d window).
 * Evaluates review-state recall (`grade >= 2`) excluding undone grades and each
 * card's initial unmemorized repetition (post-creation or post-`card-reset`).
 */
export function rollingTrueRetention(
  events: ReadonlyArray<IrEvent>,
  now: number,
  days = 30,
  windowDays = 7,
): RollingTrueRetention {
  const numDays = Math.max(1, Math.trunc(days));
  const win = Math.max(1, Math.trunc(windowDays));
  const dayMs = 86_400_000;
  const today = startOfLocalDayMs(now);
  const start = today - (numDays - 1) * dayMs;

  const dailyTotal = new Array<number>(numDays).fill(0);
  const dailyPassed = new Array<number>(numDays).fill(0);

  const undone = undoneEventIds([...events]);
  const sorted = [...events].sort(
    (a, b) => a.lamport - b.lamport || a.id.localeCompare(b.id),
  );
  const gradesSinceReset = new Map<ElementId, number>();

  for (const ev of sorted) {
    if (ev.kind === "element-created") {
      const el = ev.payload.element as IrElement | undefined;
      gradesSinceReset.set(ev.target, el?.card?.reps ?? 0);
      continue;
    }
    if (ev.kind === "card-reset") {
      gradesSinceReset.set(ev.target, 0);
      continue;
    }
    if (ev.kind !== "graded" || undone.has(ev.id)) continue;
    const grade = ev.payload.grade;
    if (typeof grade !== "number") continue;

    const prior = gradesSinceReset.get(ev.target) ?? 0;
    gradesSinceReset.set(ev.target, prior + 1);
    const payloadCard = ev.payload.card as { reps?: unknown } | undefined;
    const isInitialRep = prior === 0 && (payloadCard?.reps === undefined || payloadCard.reps === 1);
    if (isInitialRep) continue;

    if (ev.ts < start || ev.ts > now) continue;
    const idx = Math.floor((startOfLocalDayMs(ev.ts) - start) / dayMs);
    if (idx < 0 || idx >= numDays) continue;
    dailyTotal[idx] += 1;
    if (grade >= 2) dailyPassed[idx] += 1;
  }

  let totalReviewReps = 0;
  let totalPassedReps = 0;
  const points: TrueRetentionPoint[] = [];
  for (let i = 0; i < numDays; i += 1) {
    totalReviewReps += dailyTotal[i]!;
    totalPassedReps += dailyPassed[i]!;
    const winStart = Math.max(0, i - win + 1);
    let rollingTotal = 0;
    let rollingPassed = 0;
    for (let j = winStart; j <= i; j += 1) {
      rollingTotal += dailyTotal[j]!;
      rollingPassed += dailyPassed[j]!;
    }
    points.push({
      dayStartMs: start + i * dayMs,
      total: dailyTotal[i]!,
      passed: dailyPassed[i]!,
      retention: rollingTotal > 0 ? Math.round((rollingPassed / rollingTotal) * 1e4) / 1e4 : null,
      rollingTotal,
      rollingPassed,
    });
  }

  return {
    points,
    overallRetention:
      totalReviewReps > 0 ? Math.round((totalPassedReps / totalReviewReps) * 1e4) / 1e4 : null,
    totalReviewReps,
    totalPassedReps,
  };
}
