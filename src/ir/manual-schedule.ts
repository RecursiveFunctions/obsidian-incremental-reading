import type { IrElement, ReadSchedule, StoredCard } from "./model";
import { clampPriority } from "./model";
import {
  adjustTopicAFactor,
  disperseScheduledInterval,
  roundHalfToEven,
  SM20_MAX_INTERVAL_DAYS,
} from "../sm18-ir-mechanics";

const MS_PER_DAY = 86_400_000;

export interface ManualSchedulePlan {
  previousDue: number;
  newDue: number;
  previousInterval: number;
  newInterval: number;
  priorityBefore: number;
  priorityAfter: number;
  card?: StoredCard;
  schedule?: ReadSchedule;
}

export interface ManualScheduleOptions {
  coupling?: number;
  disperseRng?: () => number;
  nowMs?: number;
  adjustAFactor?: boolean;
}

/**
 * Parse a JumpInterval input string: either a positive integer day count (e.g. "14")
 * or an ISO local date ("YYYY-MM-DD"). Returns null if invalid or < 1 day.
 */
export function parseJumpIntervalInput(
  raw: string,
  nowMs: number,
): { intervalDays: number; dueMs: number } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (/^\d+$/.test(trimmed)) {
    const days = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(days) || days < 1) return null;
    const clamped = Math.min(SM20_MAX_INTERVAL_DAYS, days);
    return { intervalDays: clamped, dueMs: nowMs + clamped * MS_PER_DAY };
  }

  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateMatch) {
    const year = Number(dateMatch[1]);
    const month = Number(dateMatch[2]) - 1;
    const day = Number(dateMatch[3]);
    const target = new Date(year, month, day);
    if (
      target.getFullYear() !== year ||
      target.getMonth() !== month ||
      target.getDate() !== day
    ) {
      return null;
    }
    const nowDate = new Date(nowMs);
    const startToday = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).getTime();
    const diffDays = Math.round((target.getTime() - startToday) / MS_PER_DAY);
    if (diffDays < 1) return null;
    const clamped = Math.min(SM20_MAX_INTERVAL_DAYS, diffDays);
    const due = new Date(year, month, day, nowDate.getHours(), nowDate.getMinutes(), nowDate.getSeconds(), nowDate.getMilliseconds()).getTime();
    return { intervalDays: clamped, dueMs: due };
  }

  return null;
}

/** `TElWind.JumpIntervalExt` (`0x00cff250`) + `disperseScheduledInterval` (`0x00cfcb80`). */
export function planManualSchedule(
  element: IrElement,
  newDue: number,
  newInterval: number,
  couplingOrOpts: number | ManualScheduleOptions = 0,
): ManualSchedulePlan | null {
  const current = element.card ?? element.schedule;
  if (!current || !Number.isFinite(newDue) || !Number.isFinite(newInterval) || newInterval < 0) return null;

  const opts: ManualScheduleOptions =
    typeof couplingOrOpts === "number" ? { coupling: couplingOrOpts } : couplingOrOpts;
  const coupling = opts.coupling ?? 0;

  const previousInterval = element.card?.scheduledDays ?? element.schedule?.interval ?? 0;
  let finalInterval = Math.round(newInterval);
  let finalDue = newDue;

  if (opts.disperseRng && finalInterval >= 1) {
    const dispersed = Math.min(
      SM20_MAX_INTERVAL_DAYS,
      Math.max(1, roundHalfToEven(disperseScheduledInterval(finalInterval, Math.abs(finalInterval - previousInterval), opts.disperseRng))),
    );
    const baseNow = opts.nowMs ?? (newDue - finalInterval * MS_PER_DAY);
    finalInterval = dispersed;
    finalDue = baseNow + finalInterval * MS_PER_DAY;
  }

  const ratio = previousInterval > 0 && finalInterval > 0
    ? Math.log(finalInterval / previousInterval) / Math.log(2) : 0;
  const priorityAfter = clampPriority(element.priority + ratio * 10 * Math.min(1, Math.max(0, coupling)));
  const base = {
    previousDue: current.due,
    newDue: finalDue,
    previousInterval,
    newInterval: finalInterval,
    priorityBefore: element.priority,
    priorityAfter,
  };
  if (element.card) {
    return {
      ...base,
      card: { ...element.card, due: finalDue, scheduledDays: finalInterval },
    };
  }
  const oldAf = element.schedule!.aFactor;
  const nextAf = opts.adjustAFactor && finalInterval >= 1
    ? adjustTopicAFactor(oldAf, Math.max(1, previousInterval), finalInterval)
    : oldAf;
  return {
    ...base,
    schedule: { ...element.schedule!, due: finalDue, interval: finalInterval, aFactor: nextAf },
  };
}
