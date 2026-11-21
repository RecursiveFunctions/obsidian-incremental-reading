import type { IrElement, IrEvent, ReadSchedule, StoredCard } from "./model";
import type { DeviceId, ElementId, EventId } from "./ids";
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
    const due = new Date(
      nowDate.getFullYear(),
      nowDate.getMonth(),
      nowDate.getDate() + clamped,
      nowDate.getHours(),
      nowDate.getMinutes(),
      nowDate.getSeconds(),
      nowDate.getMilliseconds(),
    ).getTime();
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

export interface AdvancePlanEntry {
  elementId: ElementId;
  previousDue: number;
  newDue: number;
  dayOffset: number;
  card?: StoredCard;
  schedule?: ReadSchedule;
}

/**
 * Parse an Advance horizon input:
 * - "", "0", or "today" (case-insensitive) -> 0 (bring due immediately today)
 * - Positive integer N -> clamped to [1, SM20_MAX_INTERVAL_DAYS]
 * - Invalid / negative -> null
 */
export function parseAdvanceInput(raw: string): number | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || trimmed === "0" || trimmed === "today") return 0;
  if (!/^\d+$/.test(trimmed)) return null;
  const days = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(days) || days < 0) return null;
  return Math.min(SM20_MAX_INTERVAL_DAYS, days);
}

/**
 * SM-20 `Advance` planner (`TBrowser.Advance`): priority-ordered reschedule
 * across `[0..horizonDays]` preserving `lastReview`, `stability`, `interval`,
 * and `aFactor`.
 */
export function planAdvanceElements(
  elements: Iterable<IrElement>,
  horizonDays: number,
  nowMs: number,
): AdvancePlanEntry[] {
  const cleanHorizon = Math.max(0, Math.min(SM20_MAX_INTERVAL_DAYS, Math.trunc(horizonDays)));
  const candidates: Array<{ el: IrElement; currentDue: number }> = [];
  for (const el of elements) {
    if (el.dismissed) continue;
    const due = el.card?.due ?? el.schedule?.due;
    if (due === undefined || !Number.isFinite(due)) continue;
    candidates.push({ el, currentDue: due });
  }
  if (candidates.length === 0) return [];

  candidates.sort((a, b) => {
    if (a.el.priority !== b.el.priority) return a.el.priority - b.el.priority;
    if (a.currentDue !== b.currentDue) return a.currentDue - b.currentDue;
    return a.el.id.localeCompare(b.el.id);
  });

  const n = candidates.length;
  const entries: AdvancePlanEntry[] = [];
  for (let i = 0; i < n; i += 1) {
    const { el, currentDue } = candidates[i]!;
    const dayOffset =
      cleanHorizon === 0 || n === 1
        ? 0
        : Math.floor((i * (cleanHorizon + 1)) / n);
    const newDue = nowMs + dayOffset * MS_PER_DAY;
    const card = el.card ? { ...el.card, due: newDue } : undefined;
    const schedule = el.schedule ? { ...el.schedule, due: newDue } : undefined;
    entries.push({
      elementId: el.id,
      previousDue: currentDue,
      newDue,
      dayOffset,
      ...(card ? { card } : {}),
      ...(schedule ? { schedule } : {}),
    });
  }
  return entries;
}

export function buildAdvanceEvents(
  entries: AdvancePlanEntry[],
  opts: {
    nowMs: number;
    lamportStart: number;
    deviceId: DeviceId;
    batchId: string;
    newEventId: () => EventId;
  },
): IrEvent[] {
  return entries.map((entry, idx) => ({
    id: opts.newEventId(),
    ts: opts.nowMs,
    lamport: opts.lamportStart + idx,
    device: opts.deviceId,
    kind: "mercy-postponed",
    target: entry.elementId,
    payload: {
      operation: "manual-reschedule",
      batchId: opts.batchId,
      previousDue: entry.previousDue,
      newDue: entry.newDue,
      ...(entry.card ? { card: entry.card } : {}),
      ...(entry.schedule ? { schedule: entry.schedule } : {}),
    },
  }));
}
