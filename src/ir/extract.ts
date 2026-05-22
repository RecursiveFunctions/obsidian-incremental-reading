import { newElement, clampPriority } from "./model";
import type { IrElement, IrEvent, ReadSchedule } from "./model";
import type { ElementId, EventId, DeviceId } from "./ids";

export interface ExtractInput {
  sourcePath: string;
  sourceText: string;
  selStart: number;
  selEnd: number;
  parentId: ElementId;
  priority: number;
  elementId: ElementId;
  eventId: EventId;
  device: DeviceId;
  lamport: number;
  now: number;
  contextLen?: number;
  /** When set, the extract enters the reading queue (same as a migrated extract note). */
  schedule?: ReadSchedule;
}

export function buildExtractEvent(input: ExtractInput): IrEvent {
  const contextLen = input.contextLen ?? 64;
  const text = input.sourceText.slice(input.selStart, input.selEnd);
  const prefix = input.sourceText.slice(
    Math.max(0, input.selStart - contextLen),
    input.selStart,
  );
  const suffix = input.sourceText.slice(
    input.selEnd,
    input.selEnd + contextLen,
  );

  const anchor = {
    sourcePath: input.sourcePath,
    quote: {
      exact: text,
      prefix,
      suffix,
    },
    position: { start: input.selStart, end: input.selEnd },
  };

  const element: IrElement = {
    ...newElement({
      id: input.elementId,
      type: "extract",
      priority: clampPriority(input.priority),
      parentId: input.parentId,
      now: input.now,
    }),
    text,
    anchor,
    ...(input.schedule ? { schedule: input.schedule } : {}),
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

export function buildPromoteEvent(args: {
  elementId: ElementId;
  notePath: string;
  eventId: EventId;
  device: DeviceId;
  lamport: number;
  now: number;
}): IrEvent {
  return {
    id: args.eventId,
    ts: args.now,
    lamport: args.lamport,
    device: args.device,
    kind: "promoted",
    target: args.elementId,
    payload: { notePath: args.notePath },
  };
}
