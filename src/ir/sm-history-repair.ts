/**
 * SuperMemo repetition-history repair helpers ported from sm20.exe
 * (Str_NonPositiveFutureIntervalInRepetition, Str_WrongRepetitionGradeAndLapsesMatch).
 */

/** Stored uint16 history slot clamp (1 day). */
export const MIN_INTERVAL_U16_DAYS = 1;

/** Float path clamp used by SM before outcome math (~1 second). */
export const MIN_INTERVAL_DAYS_F64 = 1.1574074074074073e-05;

export function repairNonPositiveIntervalDays(intervalDays: number): {
  intervalDays: number;
  repaired: boolean;
} {
  if (Number.isFinite(intervalDays) && intervalDays > 0) {
    return { intervalDays, repaired: false };
  }
  return { intervalDays: MIN_INTERVAL_U16_DAYS, repaired: true };
}

/** Fail grades are 0..2 (ClassifyRepetitionGradeFlags bit 0x1). */
export function isFailRepetitionGrade(grade: number): boolean {
  return Number.isFinite(grade) && grade >= 0 && grade <= 2;
}

/**
 * `Str_WrongRepetitionGradeAndLapsesMatch` (`0x00d1bde0`).
 * Returns true when prev→curr transitions are inconsistent (SM status 5).
 * First history row (no previous) is never inconsistent.
 */
export function hasWrongRepetitionGradeAndLapsesMatch(
  prev: { reps: number; lapses: number } | null,
  curr: { reps: number; lapses: number; grade: number },
): boolean {
  if (!prev) return false;
  const isFail = isFailRepetitionGrade(curr.grade);
  if (!isFail) {
    return !(curr.reps === prev.reps + 1 && curr.lapses === prev.lapses);
  }
  if (curr.reps <= prev.reps) {
    return !(curr.lapses === prev.lapses + 1);
  }
  return false;
}
