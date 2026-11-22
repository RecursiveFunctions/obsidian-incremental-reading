export const MIN_INTERVAL_U16_DAYS = 1;

/** `Str_NonPositiveFutureIntervalInRepetition` (`0x00d1e8a0`). */
export function repairNonPositiveIntervalDays(intervalDays: number): {
  intervalDays: number;
  repaired: boolean;
} {
  if (Number.isFinite(intervalDays) && intervalDays > 0) {
    return { intervalDays, repaired: false };
  }
  return { intervalDays: MIN_INTERVAL_U16_DAYS, repaired: true };
}

/** `Str_WrongRepetitionGradeAndLapsesMatch` (`0x00d1bde0`). */
export function hasWrongRepetitionGradeAndLapsesMatch(
  prev: { reps: number; lapses: number } | null,
  curr: { reps: number; lapses: number; grade: number },
): boolean {
  if (!prev) return false;
  const isFail = Number.isFinite(curr.grade) && curr.grade >= 0 && curr.grade <= 2;
  if (!isFail) {
    return !(curr.reps === prev.reps + 1 && curr.lapses === prev.lapses);
  }
  return curr.reps <= prev.reps && curr.lapses !== prev.lapses + 1;
}
