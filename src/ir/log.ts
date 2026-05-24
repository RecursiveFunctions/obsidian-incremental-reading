/**
 * The store log module.
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

export interface LogState {
  elements: Map<ElementId, IrElement>;
  tombstones: Map<string, SourceTombstone>;
}

export interface FoldOptions {
  conflict?: "conservative" | "clock-order";
}

export function fold(events: IrEvent[], opts?: FoldOptions): LogState {
  const elements = new Map<ElementId, IrElement>();
  const tombstones = new Map<string, SourceTombstone>();
  const conflictPolicy = opts?.conflict ?? "conservative";

  // First pass: collect ids of grade events the user retracted via
  // `grade-undone`. We keep both event kinds in the log (see
  // `isReviewEvent`) but skip them in the fold so the element's `card`
  // returns to its pre-grade state. Scoping by event id (not by element)
  // means an undo on device A doesn't accidentally roll back an unrelated
  // grade made on device B with a higher lamport — only the targeted
  // event is removed from consideration.
  const undoneEventIds = new Set<EventId>();
  for (const ev of events) {
    if (ev.kind === "grade-undone") {
      const targetId = ev.payload.eventId as EventId | undefined;
      if (targetId) undoneEventIds.add(targetId);
    }
  }

  // Sort events by lamport, then by event id for deterministic ordering
  const sortedEvents = [...events].sort((a, b) => {
    if (a.lamport !== b.lamport) return a.lamport - b.lamport;
    return a.id.localeCompare(b.id);
  });

  for (const event of sortedEvents) {
    if (event.kind === "grade-undone") continue;
    if (undoneEventIds.has(event.id)) continue;
    const target = event.target;
    const element = elements.get(target);

    switch (event.kind) {
      case "element-created": {
        const payloadElement = event.payload.element as IrElement;
        elements.set(target, payloadElement);
        break;
      }

      case "priority-set": {
        if (element) {
          element.priority = clampPriority(event.payload.priority as number);
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
            if (!element.card || card.due < element.card.due) {
              element.card = card;
            }
          } else {
            element.card = card;
          }
        }
        break;
      }

      case "topic-advanced": {
        if (element) {
          element.schedule = event.payload.schedule as ReadSchedule;
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
          if (element.card) {
            element.card = { ...element.card, due: newDue };
          }
          if (element.schedule) {
            element.schedule = { ...element.schedule, due: newDue };
          }
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

      case "source-tombstoned": {
        const tombstone = event.payload.tombstone as SourceTombstone;
        tombstones.set(tombstone.path, tombstone);
        break;
      }

      case "element-deleted": {
        elements.delete(target);
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

  return { elements, tombstones };
}

export interface CompactionPolicy {
  maxEvents?: number;
  maxAgeDays?: number;
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

  // Compacted away events
  const compactedAway = shard.filter((e) => !keep.includes(e));

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
 * `IrStore.loadEvents()`.
 */
export function findLastUndoableGrade(events: IrEvent[]): IrEvent | null {
  const undoneEventIds = new Set<EventId>();
  for (const ev of events) {
    if (ev.kind === "grade-undone") {
      const targetId = ev.payload.eventId as EventId | undefined;
      if (targetId) undoneEventIds.add(targetId);
    }
  }
  let best: IrEvent | null = null;
  for (const ev of events) {
    if (ev.kind !== "graded") continue;
    if (undoneEventIds.has(ev.id)) continue;
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
