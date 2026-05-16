/**
 * Operations on a note as an IR element.
 *
 * Every frontmatter mutation goes through Obsidian's
 * `fileManager.processFrontMatter`, which is atomic, preserves unrelated keys,
 * and round-trips YAML formatting correctly — never hand-edit the file text.
 */

import { App, TFile } from "obsidian";
import { IR_KEYS, IrType, PRIORITY_MAX, PRIORITY_MIN } from "./types";
import { newCard, writeCardToFrontmatter } from "./fsrs";

/** Clamp an arbitrary number into the valid 0–100 priority range. */
export function clampPriority(value: number): number {
  if (!Number.isFinite(value)) return PRIORITY_MAX;
  return Math.min(PRIORITY_MAX, Math.max(PRIORITY_MIN, Math.round(value)));
}

/** The current IR type of a file, or null if it isn't an IR element yet. */
export function getIrType(app: App, file: TFile): IrType | null {
  const t = app.metadataCache.getFileCache(file)?.frontmatter?.[IR_KEYS.type];
  return t === "topic" || t === "extract" || t === "item" ? t : null;
}

/**
 * Mark a note as an IR *topic* (a reading source): set `ir-type`/`ir-priority`
 * and seed a fresh FSRS card. Idempotent on identity — if the note is already
 * a topic this is a no-op and returns false so the caller can inform the user.
 */
export async function markAsTopic(
  app: App,
  file: TFile,
  defaultPriority: number,
): Promise<boolean> {
  if (getIrType(app, file) === "topic") return false;

  await app.fileManager.processFrontMatter(file, (fm) => {
    fm[IR_KEYS.type] = "topic" satisfies IrType;
    if (typeof fm[IR_KEYS.priority] !== "number") {
      fm[IR_KEYS.priority] = clampPriority(defaultPriority);
    }
    writeCardToFrontmatter(fm, newCard());
  });

  return true;
}
