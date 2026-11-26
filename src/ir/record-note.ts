import { IR_KEYS } from "../types";
import { newElementId, newEventId, type ElementId, type EventId } from "./ids";
import { migrateNotes, type FrontmatterNote } from "./migrate";
import type { IrElement, IrEvent } from "./model";

export interface BuildRecordedNoteOptions {
  liveElements?: Iterable<IrElement>;
  historicalEvents?: readonly IrEvent[];
  allocElementId?: () => ElementId;
  allocEventId?: () => EventId;
}

export interface BuildRecordedNoteResult {
  events: IrEvent[];
  element?: IrElement;
}

/**
 * Runtime note-creation wrapper around `migrateNotes` (#111).
 *
 * - If a live element already owns `note.path`, returns it without emitting a
 *   duplicate `element-created` event.
 * - If `note.path` was previously owned by an element that was later renamed or
 *   deleted (`el_mig_<path>` / `ev_mig_<path>` already appears in `liveElements`
 *   or `historicalEvents`), mints a fresh `ElementId` and `EventId` so ledger
 *   append never collides with the historical event or hijacks the renamed note.
 * - Resolves `ir-parent` against live `notePath` ownership first before falling
 *   back to deterministic `elementIdForPath(parentPath)`.
 */
export function buildRecordedNoteEvents(
  note: FrontmatterNote,
  now: number,
  opts: BuildRecordedNoteOptions = {},
): BuildRecordedNoteResult {
  const liveList = opts.liveElements ? Array.from(opts.liveElements) : [];
  const existingLive = liveList.find((el) => el.notePath === note.path);
  if (existingLive) {
    return { events: [], element: existingLive };
  }

  const migrated = migrateNotes([note], now);
  if (migrated.length === 0) {
    return { events: [] };
  }

  const ev = migrated[0]!;
  let element = ev.payload.element as IrElement;

  const parentRaw = note.frontmatter[IR_KEYS.parent];
  if (typeof parentRaw === "string") {
    const liveParent = liveList.find((el) => el.notePath === parentRaw);
    if (liveParent && liveParent.id !== element.parentId) {
      element = { ...element, parentId: liveParent.id };
    }
  }

  const history = opts.historicalEvents ?? [];
  const idTakenInLive = liveList.some((el) => el.id === element.id);
  const idTakenInHistory = history.some(
    (h) => h.target === element.id || h.id === ev.id,
  );

  let targetId = element.id;
  let eventId = ev.id;
  if (idTakenInLive || idTakenInHistory) {
    const allocEl = opts.allocElementId ?? newElementId;
    const allocEv = opts.allocEventId ?? newEventId;
    targetId = allocEl();
    eventId = allocEv();
    element = { ...element, id: targetId };
  }

  const outEvent: IrEvent = {
    ...ev,
    id: eventId,
    target: targetId,
    payload: {
      ...ev.payload,
      element,
    },
  };
  return { events: [outEvent], element };
}
