import type { Card } from "ts-fsrs";
import type { Grade } from "../fsrs";
import type { StoredCard } from "./model";
import { formatDueLabel } from "./due-label";
import { gradePassesDrill, type FinalDrillMode } from "./drill";
import { scheduleItem, type PrimaryItemScheduler } from "./item-scheduler";
import type { Sm20Matrix } from "./sm20-matrix";
import { smGradeToFsrsGrade, type Sm20ArenaWeights, type SmGrade } from "./sm20-scheduler";

export interface GradePreviewContext {
  elementId?: string;
  undoRollCount?: number;
  sm20ArenaWeights?: Sm20ArenaWeights;
  sm20AutoAdaptArena?: boolean;
}

export const PREVIEW_GRADES: readonly Grade[] = ["again", "hard", "good", "easy"];
export const PREVIEW_SM_GRADES: readonly SmGrade[] = [0, 1, 2, 3, 4, 5];

export function computeSixPointDrillPreview(
  mode: FinalDrillMode,
): Record<SmGrade, "stay" | "pass"> {
  const out = {} as Record<SmGrade, "stay" | "pass">;
  for (const smGrade of PREVIEW_SM_GRADES) {
    out[smGrade] = gradePassesDrill(smGradeToFsrsGrade(smGrade), mode) ? "pass" : "stay";
  }
  return out;
}

export function previewSmGradeDelays(
  card: Card | StoredCard | null | undefined,
  now: number,
  requestRetention?: number,
  primaryScheduler: PrimaryItemScheduler = "sm20",
  sm20Matrix?: Sm20Matrix,
  context?: GradePreviewContext,
): Record<SmGrade, number> {
  const out = {} as Record<SmGrade, number>;
  for (const smGrade of PREVIEW_SM_GRADES) {
    out[smGrade] =
      scheduleItem(card, smGrade, now, {
        primaryScheduler,
        requestRetention,
        sm20Matrix,
        ...context,
      }).stored.due - now;
  }
  return out;
}

export function previewGradeDelays(
  card: Card | StoredCard | null | undefined,
  now: number,
  requestRetention?: number,
  primaryScheduler: PrimaryItemScheduler = "fsrs",
  sm20Matrix?: Sm20Matrix,
  context?: GradePreviewContext,
): Record<Grade, number> {
  const out = {} as Record<Grade, number>;
  for (const grade of PREVIEW_GRADES) {
    out[grade] =
      scheduleItem(card, grade, now, {
        primaryScheduler,
        requestRetention,
        sm20Matrix,
        ...context,
      }).stored.due - now;
  }
  return out;
}

export function formatIntervalShort(delayMs: number, now: number): string {
  if (!Number.isFinite(delayMs) || delayMs <= 0) return "";
  return `+${formatDueLabel(now + delayMs, now, { subDay: true })}`;
}
