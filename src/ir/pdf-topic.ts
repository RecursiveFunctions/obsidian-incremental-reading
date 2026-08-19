/**
 * Store-only PDF topic. PDFs have no frontmatter, so Alt+T cannot use
 * `markAsTopic` / `processFrontMatter`. The element id is the same
 * path-derived id migration uses, so this is idempotent with a later
 * re-mark of the same file.
 */

import { newElement, clampPriority } from "./model";
import type { IrEvent, ReadSchedule } from "./model";
import type { DeviceId, ElementId, EventId } from "./ids";

export function buildPdfTopicEvent(input: {
  path: string;
  elementId: ElementId;
  eventId: EventId;
  device: DeviceId;
  lamport: number;
  now: number;
  priority: number;
  schedule: ReadSchedule;
}): IrEvent {
  const element = {
    ...newElement({
      id: input.elementId,
      type: "topic",
      priority: clampPriority(input.priority),
      notePath: input.path,
      now: input.now,
    }),
    schedule: input.schedule,
  };
  return {
    id: input.eventId,
    ts: input.now,
    lamport: input.lamport,
    device: input.device,
    kind: "element-created",
    target: input.elementId,
    payload: { element },
  };
}
