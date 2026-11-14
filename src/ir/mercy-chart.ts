import { addLocalDays, localDateKey, type MercyPlan } from "./mercy";

export const MERCY_CHART_DAYS = 14;
const SHORT_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface MercyChartDay {
  /** YYYY-MM-DD local date key. */
  date: string;
  /** Compact label such as 'Sat 15'. */
  shortLabel: string;
  /** Existing future scheduled load before Mercy redistribution. */
  existingCount: number;
  /** Newly postponed elements assigned to this date by Mercy. */
  postponedCount: number;
  /** Total scheduled count on this date after Mercy (`existingCount + postponedCount`). */
  totalCount: number;
  /** Percentage width (0..100) for existing scheduled load relative to chart max. */
  existingPct: number;
  /** Percentage width (0..100) for newly postponed load relative to chart max. */
  postponedPct: number;
  /** True when `totalCount > ceiling`. */
  overCeiling: boolean;
}

export interface MercyChartModel {
  days: MercyChartDay[];
  maxCount: number;
  ceilingPct: number;
}

function formatShortDateLabel(dateStr: string): string {
  const parts = dateStr.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return dateStr;
  const d = new Date(parts[0]!, parts[1]! - 1, parts[2]!, 12, 0, 0, 0);
  return `${SHORT_WEEKDAYS[d.getDay()] ?? ""} ${d.getDate()}`.trim();
}

/**
 * Build a deterministic 14-day load distribution model for the Mercy preview chart.
 * Separates already-scheduled future work from newly postponed overflow so the
 * stacked horizontal bars update smoothly as the user drags sliders.
 */
export function buildMercyLoadChart(
  plan: MercyPlan,
  actionMs: number,
  ceiling: number,
  windowDays = MERCY_CHART_DAYS,
): MercyChartModel {
  const safeCeiling = Math.max(1, Math.floor(ceiling));
  const postponedByDate = new Map<string, number>();
  for (const a of plan.assignments) {
    postponedByDate.set(a.targetLocalDate, (postponedByDate.get(a.targetLocalDate) ?? 0) + 1);
  }
  const totalByDate = new Map<string, number>();
  for (const d of plan.perDay) {
    totalByDate.set(d.date, d.count);
  }

  const rawDays: Array<{ date: string; existingCount: number; postponedCount: number; totalCount: number }> = [];
  for (let i = 1; i <= windowDays; i++) {
    const date = localDateKey(addLocalDays(actionMs, i));
    const postponedCount = postponedByDate.get(date) ?? 0;
    const totalCount = totalByDate.get(date) ?? postponedCount;
    const existingCount = Math.max(0, totalCount - postponedCount);
    rawDays.push({ date, existingCount, postponedCount, totalCount });
  }

  const peakDay = rawDays.reduce((m, d) => Math.max(m, d.totalCount), 0);
  const maxCount = Math.max(safeCeiling, peakDay, 1);
  const ceilingPct = Math.min(100, Math.max(0, (safeCeiling / maxCount) * 100));

  const days: MercyChartDay[] = rawDays.map((d) => ({
    date: d.date,
    shortLabel: formatShortDateLabel(d.date),
    existingCount: d.existingCount,
    postponedCount: d.postponedCount,
    totalCount: d.totalCount,
    existingPct: (d.existingCount / maxCount) * 100,
    postponedPct: (d.postponedCount / maxCount) * 100,
    overCeiling: d.totalCount > safeCeiling,
  }));

  return { days, maxCount, ceilingPct };
}
