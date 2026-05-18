/**
 * Core IR domain types and the canonical frontmatter schema.
 *
 * All IR state lives in note frontmatter as flat `ir-` prefixed keys so it
 * round-trips cleanly through Git, Obsidian Sync, and any Markdown tooling.
 * The key names here are the single source of truth. Every reader/writer in
 * the plugin must go through `IR_KEYS`, never string literals.
 */

/** What role a note plays in the IR element tree. */
export type IrType = "topic" | "extract" | "item";

/**
 * Frontmatter key names. Flat and human-editable on purpose: a user should be
 * able to open the file and understand/adjust the values without the plugin.
 */
export const IR_KEYS = {
  type: "ir-type",
  priority: "ir-priority",

  /** Vault-relative path of the parent element this note was extracted from. */
  parent: "ir-parent",

  /** When true, the element is held out of the queue (reversible). */
  dismissed: "ir-dismissed",

  // Topic schedule (reading elements; see src/topic.ts). Items use FSRS
  // instead. `due` is shared by both models.
  interval: "ir-interval",
  aFactor: "ir-a-factor",

  // FSRS card state (see src/fsrs.ts for (de)serialization).
  due: "ir-due",
  stability: "ir-stability",
  difficulty: "ir-difficulty",
  elapsedDays: "ir-elapsed-days",
  scheduledDays: "ir-scheduled-days",
  reps: "ir-reps",
  lapses: "ir-lapses",
  state: "ir-state",
  lastReview: "ir-last-review",
} as const;

/** Priority is a 0-100 SuperMemo-style percentile; lower = more important. */
export const PRIORITY_MIN = 0;
export const PRIORITY_MAX = 100;
