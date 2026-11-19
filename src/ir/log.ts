/**
 * The ledger log module.
 *
 * This module implements the append-only event log and its fold. It is pure
 * data plus a few helpers; no Obsidian API, no I/O, so it is trivially unit
 * tested.
 */

import {
  clampPriority,
  isReviewEvent,
  type IrElement,
  type IrEvent,
  type SourceTombstone,
  type StoredCard,
  type ReadSchedule,
  type Anchor,
} from "./model";
import type { ElementId, EventId } from "./ids";
import {
  applyPriorityPlacement,
  collectionSortOrder,
  projectRelativePriorities,
  type PriorityPlacement,
} from "./relative-priority";

export interface LogState {
  elements: Map<ElementId, IrElement>;
  tombstones: Map<string, SourceTombstone>;
}

export interface FoldOptions {
  conflict?: "conservative" | "clock-order";
}

function cloneElement(element: IrElement): IrElement {
  return JSON.parse(JSON.stringify(element)) as IrElement;
}

/**
 * Ids of grade events the user retracted via `grade-undone`. We keep both
 * event kinds in the log (see `isReviewEvent`) but skip them in the fold so
 * the element's `card` returns to its pre-grade state. Scoping by event id
 * (not by element) means an undo on device A doesn't accidentally roll back
 * an unrelated grade made on device B with a higher lamport — only the
 * targeted event is removed from consideration. Exported because the
 * optimizer's revlog extraction must void the same reviews the fold voids.
 */
export function undoneEventIds(events: IrEvent[]): Set<EventId> {
  const undone = new Set<EventId>();
  for (const ev of events) {
    if (ev.kind === "grade-undone") {
      const targetId = ev.payload.eventId as EventId | undefined;
      if (targetId) undone.add(targetId);
    }
  }
  return undone;
}

/** Last event that moved an element's due, kept for the status bar. */
export interface DueChangeRecord {
  kind: IrEvent["kind"];
  lamport: number;
  ts: number;
}

/**
 * The fold's pre-projection state. `finalizeFold` turns it into a `LogState`
 * by replaying the priority placements and projecting relative priorities.
 *
 * This is the shape a fold checkpoint persists: it is the *input* to the
 * projection, not its output, so appending events later reproduces exactly
 * what a from-scratch fold would produce. Persisting the projected state
 * instead would sort future events by rank positions rather than the raw
 * priority values the events carry.
 */
export interface FoldIntermediate {
  elements: Map<ElementId, IrElement>;
  tombstones: Map<string, SourceTombstone>;
  /** Priority placements in event order; replayed by `finalizeFold`. */
  placements: Array<{ target: ElementId; placement: PriorityPlacement }>;
  /** Ids targeted by `grade-undone` events. */
  undone: Set<EventId>;
  /** Last due-changing event per element (status bar's `postponed` count). */
  dueChange: Map<ElementId, DueChangeRecord>;
}

const DUE_CHANGE_KINDS = new Set<IrEvent["kind"]>([
  "mercy-postponed",
  "mercy-undone",
  "graded",
  "card-reset",
  "topic-advanced",
]);

export function emptyFoldIntermediate(): FoldIntermediate {
  return {
    elements: new Map(),
    tombstones: new Map(),
    placements: [],
    undone: new Set(),
    dueChange: new Map(),
  };
}

/**
 * Fold `events` on top of `base` and return `base`.
 *
 * The event loop is a pure left fold over `(lamport, id)` order, so folding a
 * prefix and then a suffix equals folding the whole stream — which is what
 * makes a persisted intermediate checkpoint exact.
 *
 * One case cannot be replayed incrementally: a `grade-undone` that targets an
 * event already folded into `base` (the base element has the grade applied).
 * `IrLedger` detects that and rebuilds from archives rather than calling this.
 */
export function foldFrom(
  base: FoldIntermediate,
  events: Iterable<IrEvent>,
  opts?: FoldOptions,
): FoldIntermediate {
  const conflictPolicy = opts?.conflict ?? "conservative";
  const batch = [...events];

  for (const ev of batch) {
    if (ev.kind !== "grade-undone") continue;
    const targetId = ev.payload.eventId as EventId | undefined;
    if (targetId) base.undone.add(targetId);
  }

  // Sort events by lamport, then by event id for deterministic ordering
  const sortedEvents = batch.sort((a, b) => {
    if (a.lamport !== b.lamport) return a.lamport - b.lamport;
    return a.id.localeCompare(b.id);
  });

  for (const event of sortedEvents) {
    if (
      DUE_CHANGE_KINDS.has(event.kind) &&
      !(event.kind === "topic-advanced" && event.payload.operation === "extract-parent-decay") &&
      !(event.kind === "mercy-postponed" && (event.payload.operation === "manual-reschedule" || event.payload.operation === "forget-reset"))
    ) {
      const prev = base.dueChange.get(event.target);
      if (!prev ||
          event.lamport > prev.lamport ||
          (event.lamport === prev.lamport && event.ts >= prev.ts)) {
        base.dueChange.set(event.target, {
          kind: event.kind,
          lamport: event.lamport,
          ts: event.ts,
        });
      }
    }
    if (event.kind === "grade-undone") continue;
    if (base.undone.has(event.id)) continue;
    const target = event.target;
    const element = base.elements.get(target);

    switch (event.kind) {
      case "element-created": {
        const payloadElement = event.payload.element as IrElement;
        base.elements.set(target, cloneElement(payloadElement));
        const placement = event.payload.placement as PriorityPlacement | undefined;
        if (placement) base.placements.push({ target, placement });
        break;
      }

      case "priority-set": {
        if (element) {
          const placement = event.payload.placement as PriorityPlacement | undefined;
          if (placement) {
            base.placements.push({ target, placement });
          } else {
            element.priority = clampPriority(event.payload.priority as number);
          }
        }
        break;
      }

      case "dismiss-set": {
        if (element) {
          element.dismissed = event.payload.dismissed as boolean;
        }
        break;
      }

      case "graded": {
        if (element) {
          const card = event.payload.card as StoredCard;
          if (conflictPolicy === "conservative") {
            if (!element.card || element.card.reps === 0 || card.due < element.card.due) {
              element.card = card;
            }
          } else {
            element.card = card;
          }
          const placement = event.payload.placement as PriorityPlacement | undefined;
          const newPriority = event.payload.newPriority as number | undefined;
          if (typeof newPriority === "number" && Number.isFinite(newPriority)) {
            element.priority = clampPriority(newPriority);
          }
          if (placement) {
            base.placements.push({ target, placement });
          }
        }
        break;
      }

      case "card-reset": {
        if (element) {
          if (event.payload.card !== undefined) {
            element.card = event.payload.card as StoredCard;
          } else {
            delete element.card;
          }
          if (event.payload.schedule !== undefined) {
            element.schedule = event.payload.schedule as ReadSchedule;
          } else if (element.type !== "item") {
            delete element.schedule;
          }
        }
        break;
      }

      case "topic-advanced": {
        if (element) {
          element.schedule = event.payload.schedule as ReadSchedule;
          const placement = event.payload.placement as PriorityPlacement | undefined;
          const newPriority = event.payload.newPriority as number | undefined;
          if (typeof newPriority === "number" && Number.isFinite(newPriority)) {
            element.priority = clampPriority(newPriority);
          }
          if (placement) {
            base.placements.push({ target, placement });
          }
        }
        break;
      }

      case "mercy-postponed": {
        // Queue-redistribution only (DESIGN.md section 6): bump due so the
        // element falls out of today's queue without telling the scheduler
        // it was reviewed. A later grade or topic-advance at higher lamport
        // overwrites this, so a postponed item that gets reviewed anyway
        // doesn't keep its mercy due.
        if (element) {
          const newDue = event.payload.newDue as number;
          if (event.payload.operation === "manual-reschedule" && event.payload.card) {
            element.card = event.payload.card as StoredCard;
          } else if (element.card) {
            element.card = { ...element.card, due: newDue };
          }
          if (event.payload.operation === "manual-reschedule" && event.payload.schedule) {
            element.schedule = event.payload.schedule as ReadSchedule;
          } else if (element.schedule) {
            element.schedule = { ...element.schedule, due: newDue };
          }
        }
        break;
      }

      case "mercy-undone": {
        if (element && event.payload.operation !== "complete") {
          const newDue = event.payload.newDue as number;
          if (element.card) element.card = { ...element.card, due: newDue };
          if (element.schedule) element.schedule = { ...element.schedule, due: newDue };
        }
        break;
      }

      case "reparented": {
        if (element) {
          element.parentId = event.payload.parentId as ElementId | null;
        }
        break;
      }

      case "anchor-repaired": {
        if (element) {
          element.anchor = event.payload.anchor as Anchor;
          element.anchorState = "ok";
        }
        break;
      }

      case "anchor-detached": {
        if (element) {
          element.anchorState = "detached";
        }
        break;
      }

      case "promoted": {
        if (element) {
          element.notePath = event.payload.notePath as string;
        }
        break;
      }

      case "demoted": {
        if (element) {
          delete element.notePath;
        }
        break;
      }

      case "source-tombstoned": {
        const tombstone = event.payload.tombstone as SourceTombstone;
        base.tombstones.set(tombstone.path, tombstone);
        break;
      }

      case "source-restored": {
        const path = event.payload.path as string;
        base.tombstones.delete(path);
        break;
      }

      case "source-renamed": {
        if (element) {
          const oldPath = event.payload.oldPath as string;
          const newPath = event.payload.newPath as string;
          if (element.notePath === oldPath) {
            element.notePath = newPath;
          }
          if (element.anchor?.sourcePath === oldPath) {
            element.anchor = { ...element.anchor, sourcePath: newPath };
          }
        }
        break;
      }

      case "element-deleted": {
        base.elements.delete(target);
        for (let index = base.placements.length - 1; index >= 0; index -= 1) {
          if (base.placements[index].target === target) base.placements.splice(index, 1);
        }
        break;
      }

      case "text-edited": {
        if (element) {
          element.text = event.payload.text as string;
        }
        break;
      }
    }
  }

  return base;
}

/**
 * Turn an intermediate fold state into the public `LogState`: replay the
 * priority placements over the collection order and project relative
 * priorities. The input is left untouched, so a persisted checkpoint keeps
 * its raw priorities.
 */
export function finalizeFold(base: FoldIntermediate): LogState {
  // The intermediate is a parsed checkpoint (or a freshly built one) and is
  // not reused after this call, so the projection can run in place.
  const elements = base.elements;

  let order = collectionSortOrder(elements.values());
  for (const { target, placement } of base.placements) {
    if (!elements.has(target)) continue;
    order = applyPriorityPlacement(order, target, placement);
  }
  const priorities = projectRelativePriorities(order);
  for (const [id, priority] of priorities) {
    const element = elements.get(id);
    if (element) element.priority = priority;
  }

  return { elements, tombstones: new Map(base.tombstones) };
}

export function foldIntermediate(events: IrEvent[], opts?: FoldOptions): FoldIntermediate {
  return foldFrom(emptyFoldIntermediate(), events, opts);
}

export function fold(events: IrEvent[], opts?: FoldOptions): LogState {
  return finalizeFold(foldIntermediate(events, opts));
}

/** JSON-safe form of a checkpoint's intermediate state. */
export interface SerializedFoldIntermediate {
  elements: IrElement[];
  tombstones: SourceTombstone[];
  placements: Array<{ target: ElementId; placement: PriorityPlacement }>;
  undone: EventId[];
  dueChange: Array<{ id: ElementId } & DueChangeRecord>;
}

export function serializeFoldIntermediate(base: FoldIntermediate): SerializedFoldIntermediate {
  return {
    elements: [...base.elements.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((element) => ({ ...element })),
    tombstones: [...base.tombstones.values()]
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((tombstone) => ({ ...tombstone })),
    placements: base.placements.map(({ target, placement }) => ({ target, placement })),
    undone: [...base.undone].sort(),
    dueChange: [...base.dueChange.entries()]
      .map(([id, record]) => ({ id, ...record }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}

export function deserializeFoldIntermediate(raw: unknown): FoldIntermediate {
  const value = raw as Partial<SerializedFoldIntermediate> | null;
  if (!value || typeof value !== "object" ||
      !Array.isArray(value.elements) || !Array.isArray(value.tombstones) ||
      !Array.isArray(value.placements) || !Array.isArray(value.undone) ||
      !Array.isArray(value.dueChange)) {
    throw new Error("IrLedger: invalid checkpoint state");
  }
  const base = emptyFoldIntermediate();
  for (const element of value.elements) {
    if (!element || typeof element.id !== "string") {
      throw new Error("IrLedger: invalid checkpoint element");
    }
    base.elements.set(element.id, { ...element });
  }
  for (const tombstone of value.tombstones) {
    if (!tombstone || typeof tombstone.path !== "string") {
      throw new Error("IrLedger: invalid checkpoint tombstone");
    }
    base.tombstones.set(tombstone.path, tombstone);
  }
  for (const entry of value.placements) {
    if (!entry || typeof entry.target !== "string" || !entry.placement) {
      throw new Error("IrLedger: invalid checkpoint placement");
    }
    base.placements.push({ target: entry.target, placement: entry.placement });
  }
  for (const id of value.undone) {
    if (typeof id !== "string") throw new Error("IrLedger: invalid checkpoint undo id");
    base.undone.add(id);
  }
  for (const record of value.dueChange) {
    if (!record || typeof record.id !== "string" || typeof record.kind !== "string") {
      throw new Error("IrLedger: invalid checkpoint due-change record");
    }
    base.dueChange.set(record.id, {
      kind: record.kind,
      lamport: record.lamport,
      ts: record.ts,
    });
  }
  return base;
}

export interface CompactionPolicy {
  maxEvents?: number;
  maxAgeDays?: number;
  /**
   * Events compaction must never archive, whatever their age: the latest
   * undoable grade, so the review pane's Undo keeps working after a prune.
   */
  mustKeep?: readonly IrEvent[];
}

export interface CompactionResult {
  keep: IrEvent[];
  archived: IrEvent[];
  dropped: IrEvent[];
  snapshot: LogState;
}

export function compact(
  shard: IrEvent[],
  now: number,
  policy?: CompactionPolicy,
): CompactionResult {
  const maxEvents = policy?.maxEvents ?? 250;
  const maxAgeDays = policy?.maxAgeDays ?? 7;
  const dayMs = 86400000;

  // Sort by lamport descending to get newest events first
  const sortedShard = [...shard].sort((a, b) => b.lamport - a.lamport);

  // Keep newest maxEvents events that are not older than maxAgeDays
  const keep: IrEvent[] = [];
  for (const event of sortedShard) {
    if (keep.length >= maxEvents) break;
    if (event.ts >= now - maxAgeDays * dayMs) {
      keep.push(event);
    }
  }

  // Events that must survive whatever their age (the undoable grade).
  const keepIds = new Set(keep.map((event) => event.id));
  for (const event of policy?.mustKeep ?? []) {
    if (!keepIds.has(event.id)) {
      keep.push(event);
      keepIds.add(event.id);
    }
  }

  // Compacted away events
  const compactedAway = shard.filter((e) => !keepIds.has(e.id));

  // Snapshot from compacted away events
  const snapshot = fold(compactedAway);

  // Archive review events
  const archived = compactedAway.filter((e) => isReviewEvent(e.kind));

  // Dropped events (non-review events from compacted away)
  const dropped = compactedAway.filter((e) => !isReviewEvent(e.kind));

  return { keep, archived, dropped, snapshot };
}

export function nextLamport(events: IrEvent[]): number {
  if (events.length === 0) return 1;
  return Math.max(...events.map((e) => e.lamport)) + 1;
}

/**
 * Find the most recent `graded` event in `events` that has not already been
 * retracted by a `grade-undone` event referencing it. Used by the review-
 * pane Undo button to decide whether to render and what to undo.
 *
 * "Most recent" is by lamport (so cross-device ordering matches the fold),
 * with event id as the tiebreaker. Returns `null` when there is nothing
 * left to undo — every grade in the log has already been undone, or none
 * has been recorded yet.
 *
 * Pure: no I/O, no Obsidian. Callers pass the full event stream from
 * `IrLedger.loadEvents()`.
 */
export function findLastUndoableGrade(events: IrEvent[]): IrEvent | null {
  const undone = undoneEventIds(events);
  let best: IrEvent | null = null;
  for (const ev of events) {
    if (ev.kind !== "graded") continue;
    if (undone.has(ev.id)) continue;
    if (best === null) {
      best = ev;
      continue;
    }
    if (ev.lamport > best.lamport) {
      best = ev;
    } else if (ev.lamport === best.lamport && ev.id > best.id) {
      best = ev;
    }
  }
  return best;
}
