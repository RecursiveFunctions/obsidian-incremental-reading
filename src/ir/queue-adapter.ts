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
