import type { IrElement, ReadSchedule } from "./model";
import type { TopicState } from "../topic";

export function dueMsOf(el: IrElement): number {
  if (el.type === "item") return el.card?.due ?? NaN;
  return el.schedule?.due ?? NaN;
}

export function scheduleToTopicState(
  s: ReadSchedule | undefined,
): TopicState | null {
  if (!s) return null;
  return { dueMs: s.due, interval: s.interval, aFactor: s.aFactor };
}

export function topicStateToSchedule(t: TopicState): ReadSchedule {
  return { due: t.dueMs, interval: t.interval, aFactor: t.aFactor };
}

/** Payload for the undo of a Later today action; tagged so it is not counted as a read. */
export function laterTodayUndoPayload(schedule: ReadSchedule): {
  schedule: ReadSchedule;
  operation: "later-today";
} {
  return { schedule, operation: "later-today" };
}
