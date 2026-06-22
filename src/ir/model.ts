/**
 * The store data model.
 *
 * Under Option 1 (see docs/DESIGN.md) IR element state does NOT live in note
 * frontmatter. It lives in a plugin-owned structured store. This module is the
 * single source of truth for the shapes that store holds: elements, anchors,
 * source tombstones, and the append-only event log. Pure data plus a few
 * total helpers; no Obsidian API, no I/O, so it is trivially unit tested.
 *
 * src/types.ts re-exports IrType, PRIORITY_MIN, and PRIORITY_MAX from here
 * so legacy callers that import from `./types` keep working.
 */

import type { ElementId, EventId, DeviceId } from "./ids";

export type IrType = "topic" | "extract" | "item";

/** Priority is a 0-100 SuperMemo percentile; lower means more important. */
export const PRIORITY_MIN = 0;
export const PRIORITY_MAX = 100;

export function clampPriority(p: number): number {
  if (!Number.isFinite(p)) return (PRIORITY_MIN + PRIORITY_MAX) / 2;
  return Math.min(PRIORITY_MAX, Math.max(PRIORITY_MIN, p));
}

/** Topics and extracts are read (never graded); items are recall-tested. */
export function isReadType(t: IrType): boolean {
  return t === "topic" || t === "extract";
}

// --- Anchors (Q1: layered selector chain C) -------------------------------
//
// The match key is normalized at compare time by the anchor engine; the model
// stores raw text verbatim. `quote` is the robust path and is always present.
// `position` is a fast hint that may drift and be repaired. `blockId` is an
// optional, opt-in native Obsidian anchor, never the primary.

export interface TextQuoteSelector {
  /** The exact extracted text, verbatim. */
  exact: string;
  /** Up to a few hundred chars immediately before `exact`, for disambiguation. */
  prefix: string;
  /** Up to a few hundred chars immediately after `exact`. */
  suffix: string;
}

export interface PositionSelector {
  /** Char offset into the source note body. Advisory; may be repaired. */
  start: number;
  end: number;
}

export interface Anchor {
  /** Vault path of the note whose body the source text lives in. */
  sourcePath: string;
  quote: TextQuoteSelector;
  position?: PositionSelector;
  blockId?: string;
}

/**
 * `ok`: anchor resolves. `needs-reanchor`: relocation failed or was
 * ambiguous, surfaced to the user, never silently re-pointed.
 * `detached`: the source was deleted; the element survives on its stored text.
 */
export type AnchorState = "ok" | "needs-reanchor" | "detached";

// --- Scheduler state ------------------------------------------------------

/**
 * FSRS card state, store-native. Dates are epoch ms (compact, directly
 * comparable) rather than the ISO strings the old frontmatter path used.
 * src/fsrs.ts owns conversion to and from the ts-fsrs `Card`.
 */
export interface StoredCard {
  due: number;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  state: number;
  lastReview?: number;
}

/** Read elements (topic/extract) use an A-Factor interval, not FSRS. */
export interface ReadSchedule {
  /** Next-due epoch ms. */
  due: number;
  /** Current interval in days. */
  interval: number;
  /** Multiplier applied to the interval on each "Next". */
  aFactor: number;
}

export interface IrElement {
  id: ElementId;
  type: IrType;
  priority: number;
  /** Parent in the element tree; null for a root. */
  parentId: ElementId | null;
  dismissed: boolean;
  /** Creation epoch ms. */
  created: number;
  /**
   * Verbatim captured text (Q1 principle 2: always stored). It is the
   * fingerprint, the offline review payload, and the survive-source-deletion
   * safety net. Empty for a topic whose content is the note itself.
   */
  text: string;
  /** Where the text came from. Absent for a root topic (the note is itself). */
  anchor?: Anchor;
  anchorState: AnchorState;
  /** For a topic or promoted concept: the vault note path it represents. */
  notePath?: string;
  /** Read elements use this. */
  schedule?: ReadSchedule;
  /** Items use this. */
  card?: StoredCard;
  /** Multi-scheduler override (Section 5). Absent means the primary scheduler. */
  schedulerOverride?: string;
}

/** Recorded when a source note is deleted, so provenance and re-link survive. */
export interface SourceTombstone {
  path: string;
  title: string;
  deletedAt: number;
}

// --- Append-only event log (Q2 D) -----------------------------------------
//
// Each device only ever appends to its own shard, so Obsidian Sync
// last-write-wins has nothing to destroy. The fold (src/ir/log.ts) is the sole
// interpreter of `payload`; it owns conflict resolution and compaction.

export type IrEventKind =
  | "element-created"
  | "priority-set"
  | "dismiss-set"
  | "graded"
  | "grade-undone"
  | "topic-advanced"
  | "mercy-postponed"
  | "anchor-repaired"
  | "anchor-detached"
  | "promoted"
  | "reparented"
  | "source-tombstoned"
  | "source-renamed"
  | "element-deleted"
  | "text-edited";

export interface IrEvent {
  id: EventId;
  /** Wall-clock epoch ms. Advisory; ordering uses `lamport` first. */
  ts: number;
  /** Monotonic per store, for deterministic cross-device ordering. */
  lamport: number;
  device: DeviceId;
  kind: IrEventKind;
  /** Element the event applies to (source path travels in `payload`). */
  target: ElementId;
  /** Interpreted only by the fold. */
  payload: Record<string, unknown>;
}

/** True for the events the fold must never discard on compaction. */
export function isReviewEvent(kind: IrEventKind): boolean {
  // grade-undone references a graded event by id. If we drop the graded
  // event during compaction, the undone reference is harmless (the fold
  // just doesn't find it). If we keep the graded but drop the undone, we'd
  // resurrect a graded the user explicitly retracted — so keep both.
  return (
    kind === "graded" || kind === "grade-undone" || kind === "topic-advanced"
  );
}

// --- Construction ---------------------------------------------------------

export interface NewElementInput {
  id: ElementId;
  type: IrType;
  priority: number;
  parentId?: ElementId | null;
  text?: string;
  anchor?: Anchor;
  notePath?: string;
  now?: number;
}

/** A new element with safe defaults. Schedule/card are attached by callers. */
export function newElement(input: NewElementInput): IrElement {
  return {
    id: input.id,
    type: input.type,
    priority: clampPriority(input.priority),
    parentId: input.parentId ?? null,
    dismissed: false,
    created: input.now ?? Date.now(),
    text: input.text ?? "",
    anchor: input.anchor,
    anchorState: input.anchor ? "ok" : "ok",
    notePath: input.notePath,
  };
}
