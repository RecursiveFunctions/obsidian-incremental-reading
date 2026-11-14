/** Human-readable relative due-date label. Pure, no I/O. */

const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_MINUTE = 60_000;

export interface DueLabelOptions {
  /**
   * Render sub-day intervals as minutes and hours instead of rounding them up
   * to `1d`. Off by default: the due label answers "when is this due", where a
   * card due later today reads better as `1d`; a grade preview answers "what
   * will this button do", where `10m` is the useful answer.
   */
  subDay?: boolean;
}

export function formatDueLabel(
  dueMs: number,
  now: number,
  opts?: DueLabelOptions,
): string {
  const diff = dueMs - now;
  if (diff <= 0) return "due";
  if (opts?.subDay) {
    if (diff < MS_PER_MINUTE) return "<1m";
    const minutes = Math.ceil(diff / MS_PER_MINUTE);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.ceil(diff / MS_PER_HOUR);
    if (hours < 24) return `${hours}h`;
  }
  const days = Math.ceil(diff / MS_PER_DAY);
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${Math.round(days / 365)}y`;
}
