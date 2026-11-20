import type { Card } from "ts-fsrs";
import type { Grade } from "../fsrs";
import type { StoredCard } from "./model";
import { formatDueLabel } from "./due-label";
import { scheduleItem, type PrimaryItemScheduler } from "./item-scheduler";
import type { Sm20Matrix } from "./sm20-matrix";

export const PREVIEW_GRADES: readonly Grade[] = ["again", "hard", "good", "easy"];

export function previewGradeDelays(
  card: Card | StoredCard | null | undefined,
  now: number,
  requestRetention?: number,
  primaryScheduler: PrimaryItemScheduler = "fsrs",
  sm20Matrix?: Sm20Matrix,
): Record<Grade, number> {
  const out = {} as Record<Grade, number>;
  for (const grade of PREVIEW_GRADES) {
    out[grade] =
      scheduleItem(card, grade, now, { primaryScheduler, requestRetention, sm20Matrix }).stored.due - now;
  }
  return out;
}

export function formatIntervalShort(delayMs: number, now: number): string {
  if (!Number.isFinite(delayMs) || delayMs <= 0) return "";
  return `+${formatDueLabel(now + delayMs, now, { subDay: true })}`;
}
