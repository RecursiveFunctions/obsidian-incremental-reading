/**
 * The ledger data model.
 *
 * Under Option 1 (see docs/DESIGN.md) IR element state does NOT live in note
 * frontmatter. It lives in a plugin-owned structured ledger. This module is the
 * single source of truth for the shapes that ledger holds: elements, anchors,
 * source tombstones, and the append-only event log. Pure data plus a few
 * total helpers; no Obsidian API, no I/O, so it is trivially unit tested.
 *
 * src/types.ts re-exports IrType, PRIORITY_MIN, and PRIORITY_MAX from here
 * so legacy callers that import from `./types` keep working.
 */

import type { ElementId, EventId, DeviceId } from "./ids";
import type { PriorityPlacement } from "./relative-priority";

export type { PriorityPlacement } from "./relative-priority";

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

export interface PdfSelector {
  /** 1-based page number, same as Obsidian `[[file.pdf#page=N]]`. */
  page: number;
  /**
   * Obsidian text-layer range: beginIndex, beginOffset, endIndex, endOffset.
   * Copied from the core "Copy link to selection" fragment. `[0,0,0,0]` is
   * the page-only placeholder (image-region extracts use it).
   */
  selection: [number, number, number, number];
  /**
   * Every span of a Ctrl multi-selection, in the order the user made
   * them. The top-level page/selection duplicate the first span so older
   * readers keep working; the painter highlights all of them.
   */
  segments?: PdfSegment[];
  /** Region cropped out of the page for an image extract, normalized 0..1. */
  rect?: NormalizedRect;
}

export interface PdfSegment {
  page: number;
  selection: [number, number, number, number];
}

export interface NormalizedRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One span of a markdown multi-selection, relocatable on its own. */
export interface AnchorSpan {
  quote: TextQuoteSelector;
  position?: PositionSelector;
}

export interface Anchor {
  /** Vault path of the note or PDF whose body the source text lives in. */
  sourcePath: string;
  quote: TextQuoteSelector;
  position?: PositionSelector;
  blockId?: string;
  /**
   * Every span of a Ctrl multi-selection over markdown, in the order the
   * user made them. The top-level `quote` / `position` duplicate the first
   * span so older readers keep working; decorations paint all of them.
   * The PDF equivalent is {@link PdfSelector.segments}.
   */
  spans?: AnchorSpan[];
  /** Present when the source is a PDF. Markdown anchors leave this unset. */
  pdf?: PdfSelector;
}

/**
 * `ok`: anchor resolves. `needs-reanchor`: relocation failed or was
 * ambiguous, surfaced to the user, never silently re-pointed.
 * `detached`: the source was deleted; the element survives on its stored text.
 */
export type AnchorState = "ok" | "needs-reanchor" | "detached";

// --- Scheduler state ------------------------------------------------------

/**
 * FSRS card state, ledger-native. Dates are epoch ms (compact, directly
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
  /** FSRS-6 learning-step index. Absent in pre-0.7.14 data; treat as 0. */
  learningSteps?: number;
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
  | "mercy-undone"
  | "anchor-repaired"
  | "anchor-detached"
  | "promoted"
  | "demoted"
  | "reparented"
  | "source-tombstoned"
  | "source-restored"
  | "source-renamed"
  | "element-deleted"
  | "text-edited";

export interface IrEvent {
  id: EventId;
  /** Wall-clock epoch ms. Advisory; ordering uses `lamport` first. */
  ts: number;
  /** Monotonic per ledger, for deterministic cross-device ordering. */
  lamport: number;
  device: DeviceId;
  kind: IrEventKind;
  /** Element the event applies to (source path travels in `payload`). */
  target: ElementId;
  /** Interpreted only by the fold. */
  payload: Record<string, unknown>;
}

const IR_EVENT_KINDS = new Set<IrEventKind>([
  "element-created", "priority-set", "dismiss-set", "graded", "grade-undone",
  "topic-advanced", "mercy-postponed", "mercy-undone", "anchor-repaired", "anchor-detached",
  "promoted", "demoted", "reparented", "source-tombstoned", "source-restored",
  "source-renamed", "element-deleted", "text-edited",
]);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function validQuote(value: unknown): boolean {
  const quote = record(value);
  return !!quote && typeof quote.exact === "string" &&
    typeof quote.prefix === "string" && typeof quote.suffix === "string";
}

function validPosition(value: unknown): boolean {
  const position = record(value);
  return !!position && nonNegativeInteger(position.start) &&
    nonNegativeInteger(position.end) && position.end >= position.start;
}

function validSelection(value: unknown): boolean {
  return Array.isArray(value) && value.length === 4 && value.every(nonNegativeInteger);
}

function validRect(value: unknown): boolean {
  const rect = record(value);
  return !!rect && ["x", "y", "w", "h"].every((key) => finite(rect[key])) &&
    (rect.x as number) >= 0 && (rect.y as number) >= 0 &&
    (rect.w as number) > 0 && (rect.h as number) > 0 &&
    (rect.x as number) + (rect.w as number) <= 1 &&
    (rect.y as number) + (rect.h as number) <= 1;
}

function validPdfSegment(value: unknown): boolean {
  const segment = record(value);
  return !!segment && Number.isInteger(segment.page) && (segment.page as number) >= 1 &&
    validSelection(segment.selection);
}

function validPdf(value: unknown): boolean {
  const pdf = record(value);
  return !!pdf && Number.isInteger(pdf.page) && (pdf.page as number) >= 1 &&
    validSelection(pdf.selection) &&
    (pdf.segments === undefined || (Array.isArray(pdf.segments) && pdf.segments.every(validPdfSegment))) &&
    (pdf.rect === undefined || validRect(pdf.rect));
}

function validAnchorSpan(value: unknown): boolean {
  const span = record(value);
  return !!span && validQuote(span.quote) &&
    (span.position === undefined || validPosition(span.position));
}

function validAnchor(value: unknown): boolean {
  const anchor = record(value);
  return !!anchor && nonEmptyString(anchor.sourcePath) && validQuote(anchor.quote) &&
    (anchor.position === undefined || validPosition(anchor.position)) &&
    (anchor.blockId === undefined || nonEmptyString(anchor.blockId)) &&
    (anchor.spans === undefined || (Array.isArray(anchor.spans) && anchor.spans.every(validAnchorSpan))) &&
    (anchor.pdf === undefined || validPdf(anchor.pdf));
}

function validCard(value: unknown): boolean {
  const card = record(value);
  return !!card && ["due", "stability", "difficulty", "elapsedDays", "scheduledDays", "reps", "lapses", "state"]
    .every((key) => finite(card[key])) &&
    ["elapsedDays", "scheduledDays", "reps", "lapses", "state"].every((key) => nonNegativeInteger(card[key])) &&
    (card.learningSteps === undefined || nonNegativeInteger(card.learningSteps)) &&
    (card.lastReview === undefined || finite(card.lastReview));
}

function validSchedule(value: unknown): boolean {
  const schedule = record(value);
  return !!schedule && finite(schedule.due) && finite(schedule.interval) && finite(schedule.aFactor);
}

function validElement(value: unknown): value is IrElement {
  const element = record(value);
  return !!element && nonEmptyString(element.id) &&
    (element.type === "topic" || element.type === "extract" || element.type === "item") &&
    finite(element.priority) && (element.priority as number) >= PRIORITY_MIN &&
    (element.priority as number) <= PRIORITY_MAX &&
    (element.parentId === null || nonEmptyString(element.parentId)) &&
    typeof element.dismissed === "boolean" && finite(element.created) &&
    typeof element.text === "string" &&
    (element.anchorState === "ok" || element.anchorState === "needs-reanchor" || element.anchorState === "detached") &&
    (element.anchor === undefined || validAnchor(element.anchor)) &&
    (element.notePath === undefined || nonEmptyString(element.notePath)) &&
    (element.card === undefined || validCard(element.card)) &&
    (element.schedule === undefined || validSchedule(element.schedule)) &&
    (element.schedulerOverride === undefined || nonEmptyString(element.schedulerOverride));
}

function validPriorityPlacement(value: unknown): value is PriorityPlacement {
  const placement = record(value);
  return !!placement && finite(placement.requestedPriority) &&
    placement.requestedPriority >= PRIORITY_MIN && placement.requestedPriority <= PRIORITY_MAX &&
    (placement.beforeId === undefined || nonEmptyString(placement.beforeId)) &&
    (placement.afterId === undefined || nonEmptyString(placement.afterId));
}

export function validateIrEvent(value: unknown): string | null {
  const event = record(value);
  if (!event) return "event must be an object";
  if (typeof event.id !== "string" || !event.id) return "id must be a non-empty string";
  if (!finite(event.ts)) return "ts must be finite";
  if (!Number.isInteger(event.lamport) || (event.lamport as number) < 0) return "lamport must be a non-negative integer";
  if (typeof event.device !== "string" || !event.device) return "device must be a non-empty string";
  if (!IR_EVENT_KINDS.has(event.kind as IrEventKind)) return "kind is unsupported";
  if (typeof event.target !== "string" || !event.target) return "target must be a non-empty string";
  const payload = record(event.payload);
  if (!payload) return "payload must be an object";

  switch (event.kind as IrEventKind) {
    case "element-created":
      return validElement(payload.element) && payload.element.id === event.target &&
        (payload.placement === undefined || validPriorityPlacement(payload.placement))
        ? null : "element-created payload is invalid";
    case "priority-set":
      return finite(payload.priority) &&
        (payload.placement === undefined || validPriorityPlacement(payload.placement))
        ? null : "priority payload is invalid";
    case "dismiss-set": return typeof payload.dismissed === "boolean" ? null : "dismissed must be boolean";
    case "graded": return validCard(payload.card) ? null : "card is invalid";
    case "grade-undone": return typeof payload.eventId === "string" && payload.eventId ? null : "eventId is required";
    case "topic-advanced": return validSchedule(payload.schedule) ? null : "schedule is invalid";
    case "mercy-postponed": return finite(payload.newDue) &&
      (payload.card === undefined || validCard(payload.card)) &&
      (payload.schedule === undefined || validSchedule(payload.schedule))
      ? null : "newDue or schedule replacement is invalid";
    case "mercy-undone":
      return nonEmptyString(payload.batchId) &&
        (payload.operation === "complete" || finite(payload.newDue))
        ? null
        : "batchId and newDue are required";
    case "reparented": return payload.parentId === null || nonEmptyString(payload.parentId) ? null : "parentId is invalid";
    case "promoted": return nonEmptyString(payload.notePath) ? null : "notePath is required";
    case "source-tombstoned": {
      const tombstone = record(payload.tombstone);
      return tombstone && nonEmptyString(tombstone.path) && typeof tombstone.title === "string" && finite(tombstone.deletedAt)
        ? null : "tombstone is invalid";
    }
    case "source-restored": return nonEmptyString(payload.path) ? null : "path is required";
    case "source-renamed": return nonEmptyString(payload.oldPath) && nonEmptyString(payload.newPath) ? null : "rename paths are required";
    case "text-edited": return typeof payload.text === "string" ? null : "text is required";
    case "anchor-repaired": return validAnchor(payload.anchor) ? null : "anchor is required";
    default: return null;
  }
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
