/**
 * What each grade would do, shown on the grade buttons before a grade is given.
 *
 * The number on a button is the scheduler's own output, not an estimate: the
 * preview calls the same `schedule()` the grade path calls, with the same
 * request retention, so pressing a button does exactly what its label says.
 * Pure, no I/O.
 */

import type { Card } from "ts-fsrs";
import { schedule, type Grade } from "../fsrs";
import { formatDueLabel } from "./due-label";

/** The four grades, in button order. */
export const PREVIEW_GRADES: readonly Grade[] = ["again", "hard", "good", "easy"];

/**
 * Milliseconds until due, per grade, if the card were graded at `now`.
 *
 * `requestRetention` must be the value the grade path will use (the priority
 * policy's effective retention), or the preview would describe a different
 * scheduler than the one that runs.
 */
export function previewGradeDelays(
  card: Card,
  now: number,
  requestRetention?: number,
): Record<Grade, number> {
  const at = new Date(now);
  const out = {} as Record<Grade, number>;
  for (const grade of PREVIEW_GRADES) {
    out[grade] = schedule(card, grade, at, requestRetention).due.getTime() - now;
  }
  return out;
}

/**
 * A short interval label for a grade button: `+10m`, `+2h`, `+4d`, `+1mo`.
 *
 * Empty when the delay is not a positive number, so a button never shows a
 * meaningless label.
 */
export function formatIntervalShort(delayMs: number, now: number): string {
  if (!Number.isFinite(delayMs) || delayMs <= 0) return "";
  return `+${formatDueLabel(now + delayMs, now, { subDay: true })}`;
}
