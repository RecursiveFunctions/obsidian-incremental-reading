import { newElement, clampPriority } from "./model";
import type { IrElement, IrEvent, ReadSchedule } from "./model";
import type { ElementId, EventId, DeviceId } from "./ids";
import { stripExtractMarks } from "./frontmatter-body";

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
  // `rawSlice` keeps any `<mark class="ir-extract-source">` chrome from prior
  // sibling extracts because the anchor uses it to re-locate the span in the
  // source. The element's stored `text`, by contrast, is what the user sees
  // in the review pane and breadcrumb, so the chrome is stripped from there.
  const rawSlice = input.sourceText.slice(input.selStart, input.selEnd);
  const text = stripExtractMarks(rawSlice);
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
      exact: rawSlice,
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

/**
 * Edit the stored text of an existing element. The anchor's `quote.exact`
 * and `position` are intentionally left untouched: those exist so the
 * source span can be re-located if the parent note moves, and rewriting
 * them would amount to silently re-pointing the anchor.
 */
export function buildTextEditedEvent(args: {
  elementId: ElementId;
  text: string;
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
    kind: "text-edited",
    target: args.elementId,
    payload: { text: args.text },
  };
}
