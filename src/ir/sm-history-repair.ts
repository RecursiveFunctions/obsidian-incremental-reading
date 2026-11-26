export const MIN_INTERVAL_U16_DAYS = 1;
export const MAX_LAST_REPETITION_DAY = 0x7ffe;
const MS_PER_DAY = 86_400_000;
const DELPHI_EPOCH_MS = Date.UTC(1899, 11, 30);

function epochMsToDelphiDate(ms: number): number {
  return (ms - DELPHI_EPOCH_MS) / MS_PER_DAY;
}

/** `Str_ReviewDateVsIntervalDiscrepancyIn` (`0x00d1efe0`). */
export function repairReviewDateVsIntervalDiscrepancy(
  rows: { repetitionNumber: number; intervalDays: number; date: number }[],
  firstIndex: number,
  lastReviewMs: number | null,
): {
  rows: { repetitionNumber: number; intervalDays: number; date: number }[];
  repairedCount: number;
} {
  const out = rows.map((row) => ({ ...row }));
  let repairedCount = 0;
  if (out.length === 0) return { rows: out, repairedCount };

  const start = Math.max(0, Math.min(firstIndex, out.length - 1));
  const lastIdx = out.length - 1;

  if (lastReviewMs !== null) {
    const expected = epochMsToDelphiDate(lastReviewMs);
    if (Number.isFinite(expected) && expected > 1) {
      let anchor = expected;
      const prev = start > 0 ? out[start - 1]!.date : null;
      if (prev !== null && Number.isFinite(prev) && prev > 1 && anchor <= prev) {
        anchor = prev + 0.01;
      }
      if (
        !Number.isFinite(out[lastIdx]!.date) ||
        out[lastIdx]!.date <= 1 ||
        Math.abs(out[lastIdx]!.date - anchor) > 1
      ) {
        out[lastIdx]!.date = anchor;
        repairedCount += 1;
      }
    }
  }

  const first = out[start]!;
  if (!Number.isFinite(first.date) || first.date <= 1) {
    if (first.intervalDays !== 0) {
      first.intervalDays = 0;
      repairedCount += 1;
    }
  }

  for (let i = lastIdx - 1; i >= start; i -= 1) {
    const next = out[i + 1]!;
    if (!Number.isFinite(next.date) || next.date <= 1) continue;
    const curr = out[i]!;
    const missingOrNonMonotonic =
      !Number.isFinite(curr.date) || curr.date <= 1 || curr.date >= next.date;
    if (!missingOrNonMonotonic) continue;

    const iv =
      Number.isFinite(next.intervalDays) && next.intervalDays > 0
        ? next.intervalDays
        : MIN_INTERVAL_U16_DAYS;
    let expected = next.date - iv;
    if (!Number.isFinite(expected) || expected <= 1) continue;

    const prev = i > start ? out[i - 1]!.date : null;
    if (prev !== null && Number.isFinite(prev) && prev > 1 && expected <= prev) {
      expected = prev + 0.01;
    }

    if (curr.date !== expected) {
      curr.date = expected;
      repairedCount += 1;
    }
  }

  for (let i = start + 1; i <= lastIdx; i += 1) {
    const prev = out[i - 1]!;
    const curr = out[i]!;
    if (
      Number.isFinite(prev.date) &&
      prev.date > 1 &&
      Number.isFinite(curr.date) &&
      curr.date > 1 &&
      curr.date <= prev.date
    ) {
      curr.date = prev.date + 0.01;
      repairedCount += 1;
    }
  }

  return { rows: out, repairedCount };
}

/** `Str_LastRepetitionDateInElementInfoDat` (`0x00d19de0`). */
export function repairLastRepetitionDateInElementInfo(
  lastRepetitionDate: number,
  history: { date: number; intervalDays: number }[],
  lastRepetitionDay: number | null = null,
): {
  lastRepetitionDate: number;
  lastRepetitionDay: number | null;
  repairedCount: number;
} {
  let latest: { date: number; intervalDays: number } | null = null;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (Number.isFinite(history[i]!.date) && history[i]!.date > 1) {
      latest = history[i]!;
      break;
    }
  }
  let repairedCount = 0;
  let outDate = lastRepetitionDate;
  let outDay = lastRepetitionDay;

  if (outDay !== null && Number.isFinite(outDay) && outDay > MAX_LAST_REPETITION_DAY) {
    outDay = MAX_LAST_REPETITION_DAY;
    repairedCount += 1;
  }

  if (!latest) {
    return { lastRepetitionDate: outDate, lastRepetitionDay: outDay, repairedCount };
  }

  if (!Number.isFinite(outDate) || outDate <= 1) {
    outDate = latest.date;
    repairedCount += 1;
    return { lastRepetitionDate: outDate, lastRepetitionDay: outDay, repairedCount };
  }

  if (Math.abs(latest.date - outDate) > 1 && latest.date > outDate) {
    outDate = latest.date;
    repairedCount += 1;
  }

  return { lastRepetitionDate: outDate, lastRepetitionDay: outDay, repairedCount };
}

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
