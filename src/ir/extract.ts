import { newElement, clampPriority } from "./model";
import type { IrElement, IrEvent, ReadSchedule } from "./model";
import type { ElementId, EventId, DeviceId } from "./ids";
import {
  stripExtractMarks,
  EXTRACT_MARK_OPEN,
  EXTRACT_MARK_CLOSE,
} from "./frontmatter-body";

export interface ExtractInput {
  sourcePath: string;
  /**
   * Note body used for `slice(selStart, selEnd)` and prefix/suffix windows.
   * When {@link persistedExtractMark} is true, this must be the body **before**
   * `wrapExtractHighlight` runs — offsets are pre-wrap, while `quote.exact`
   * on disk includes the mark tags.
   */
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
  /**
   * Set when the caller has just applied (or is about to apply)
   * `wrapExtractHighlight` at `[selStart, selEnd)` on `sourceText`. The
   * anchor must store the wrapped span so it matches the file; using post-wrap
   * `sourceText` with pre-wrap offsets would truncate `quote.exact`.
   */
  persistedExtractMark?: boolean;
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

  const wrapped =
    input.persistedExtractMark === true
      ? EXTRACT_MARK_OPEN + rawSlice + EXTRACT_MARK_CLOSE
      : rawSlice;
  const positionEnd =
    input.persistedExtractMark === true
      ? input.selEnd + EXTRACT_MARK_OPEN.length + EXTRACT_MARK_CLOSE.length
      : input.selEnd;

  const anchor = {
    sourcePath: input.sourcePath,
    quote: {
      exact: wrapped,
      prefix,
      suffix,
    },
    position: { start: input.selStart, end: positionEnd },
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
