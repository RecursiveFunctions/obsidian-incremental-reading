/** Human-readable relative due-date label. Pure, no I/O. */

const MS_PER_DAY = 86_400_000;

export function formatDueLabel(dueMs: number, now: number): string {
  const diff = dueMs - now;
  if (diff <= 0) return "due";
  const days = Math.ceil(diff / MS_PER_DAY);
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${Math.round(days / 365)}y`;
}
