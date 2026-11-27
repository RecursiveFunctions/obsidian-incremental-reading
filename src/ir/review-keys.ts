/**
 * Review-pane Spacebar policy. Reading cards keep Space = Next.
 * Cloze cards: first Space reveals; after reveal, Space grades the
 * configured rating (default Good, SuperMemo/Anki muscle memory).
 */

import type { Grade } from "../fsrs";
import type { SmGrade } from "./sm20-scheduler";

export type SpaceAfterReveal = Grade | "off";
export type GradingScale = "4-point" | "sm20-6-point";

export const SM20_SIX_POINT_GRADES: ReadonlyArray<{
  smGrade: SmGrade;
  label: string;
  compactLabel: string;
  key: string;
}> = [
  { smGrade: 0, label: "Null", compactLabel: "0", key: "0" },
  { smGrade: 1, label: "Bad", compactLabel: "1", key: "1" },
  { smGrade: 2, label: "Fail", compactLabel: "2", key: "2" },
  { smGrade: 3, label: "Pass", compactLabel: "3", key: "3" },
  { smGrade: 4, label: "Good", compactLabel: "4", key: "4" },
  { smGrade: 5, label: "Bright", compactLabel: "5", key: "5" },
];

export function resolveSm20SixPointDigit(key: string): SmGrade | null {
  if (key.length !== 1) return null;
  const code = key.charCodeAt(0) - 48;
  if (code >= 0 && code <= 5) return code as SmGrade;
  return null;
}

export const SPACE_AFTER_REVEAL_OPTIONS: ReadonlyArray<{
  value: SpaceAfterReveal;
  label: string;
}> = [
  { value: "good", label: "Good (3)" },
  { value: "easy", label: "Easy (4)" },
  { value: "hard", label: "Hard (2)" },
  { value: "again", label: "Again (1)" },
  { value: "off", label: "Do nothing (reveal only)" },
];

export function isSpaceAfterReveal(v: unknown): v is SpaceAfterReveal {
  return (
    v === "again" ||
    v === "hard" ||
    v === "good" ||
    v === "easy" ||
    v === "off"
  );
}

/**
 * Grade digits (1-4) are allowed while editing the source body textarea, but
 * must not fire while typing into a dedicated numeric input such as Jump
 * interval or Advance — otherwise the digit is swallowed and a grade is
 * committed instead of editing the number.
 */
export function digitGradeAllowed(
  typing: boolean,
  activeTag: string | null,
): boolean {
  return !typing || activeTag !== "INPUT";
}

export type SpacebarReviewAction =
  | { kind: "next" }
  | { kind: "reveal" }
  | { kind: "grade"; grade: Grade }
  | { kind: "none" };

export function spacebarReviewAction(opts: {
  isReading: boolean;
  revealed: boolean;
  typing: boolean;
  spaceAfterReveal: SpaceAfterReveal;
}): SpacebarReviewAction {
  if (opts.typing) return { kind: "none" };
  if (opts.isReading) return { kind: "next" };
  if (!opts.revealed) return { kind: "reveal" };
  if (opts.spaceAfterReveal === "off") return { kind: "none" };
  return { kind: "grade", grade: opts.spaceAfterReveal };
}

/**
 * True when `slotId` has not yet been graded in the active review session
 * (or its grade was retracted via Undo). Prevents `Grade -> Previous -> Grade`
 * from double-grading the same item in one session (`#33`).
 */
export function canGradeInSession(
  slotId: string,
  gradedSlotIds: ReadonlySet<string>,
): boolean {
  return !gradedSlotIds.has(slotId);
}

/**
 * True when a reading element (`topic` or `extract`) has not yet had its
 * interval stretched via `Next` / `Space` in the active review session.
 * Prevents `Next -> Previous ([) -> Space` from repeatedly multiplying the
 * element's interval in the same session.
 */
export function canAdvanceReadingInSession(
  slotId: string,
  advancedSlotIds: ReadonlySet<string>,
): boolean {
  return !advancedSlotIds.has(slotId);
}

/**
 * Remove a dismissed slot at `index` from the in-session queue so `Previous`
 * cannot step back onto a dismissed card (`#33`). `nextIndex` points at the
 * slot that shifted into `index` (or `queue.length` if the last card was
 * dismissed).
 */
export function spliceDismissedSlot<T>(
  queue: readonly T[],
  index: number,
): { queue: T[]; nextIndex: number; removed: T | undefined } {
  const next = [...queue];
  if (index < 0 || index >= next.length) {
    return { queue: next, nextIndex: Math.max(0, Math.min(index, next.length)), removed: undefined };
  }
  const [removed] = next.splice(index, 1);
  return { queue: next, nextIndex: index, removed };
}

/**
 * Re-insert a previously dismissed slot at its original `index` when the user
 * triggers session Undo.
 */
export function restoreDismissedSlot<T>(
  queue: readonly T[],
  index: number,
  slot: T,
): { queue: T[]; restoredIndex: number } {
  const next = [...queue];
  const restoredIndex = Math.min(Math.max(0, index), next.length);
  next.splice(restoredIndex, 0, slot);
  return { queue: next, restoredIndex };
}
