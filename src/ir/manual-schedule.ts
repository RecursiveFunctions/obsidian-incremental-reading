import type { IrElement, ReadSchedule, StoredCard } from "./model";
import { clampPriority } from "./model";

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

export function planManualSchedule(
  element: IrElement,
  newDue: number,
  newInterval: number,
  coupling = 0,
): ManualSchedulePlan | null {
  const current = element.card ?? element.schedule;
  if (!current || !Number.isFinite(newDue) || !Number.isFinite(newInterval) || newInterval < 0) return null;
  const previousInterval = element.card?.scheduledDays ?? element.schedule?.interval ?? 0;
  const ratio = previousInterval > 0 && newInterval > 0
    ? Math.log(newInterval / previousInterval) / Math.log(2) : 0;
  const priorityAfter = clampPriority(element.priority + ratio * 10 * Math.min(1, Math.max(0, coupling)));
  const base = {
    previousDue: current.due,
    newDue,
    previousInterval,
    newInterval,
    priorityBefore: element.priority,
    priorityAfter,
  };
  if (element.card) {
    return { ...base, card: { ...element.card, due: newDue, scheduledDays: Math.round(newInterval) } };
  }
  return { ...base, schedule: { ...element.schedule!, due: newDue, interval: Math.round(newInterval) } };
}
