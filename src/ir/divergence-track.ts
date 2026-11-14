/**
 * Proportional widths for the divergence bar.
 *
 * Each model proposes an interval; the bar shows their relative sizes. A linear
 * share is honest but useless when one proposal is 47 years and another is 5 —
 * the smaller one collapses to nothing. A log share keeps every proposal
 * visible and still orders them correctly. Which one to ship is a design
 * choice, so this module computes both and the caller decides.
 *
 * Pure, no I/O.
 */

export type DivergenceScale = "linear" | "log";

export interface DivergenceMember {
  id: string;
  intervalDays: number;
}

export interface TrackSegment {
  id: string;
  intervalDays: number;
  /** Fraction of the whole track, 0..1; the segments sum to 1. */
  share: number;
}

/**
 * Shares for the bar's segments.
 *
 * Non-finite and negative intervals are treated as zero. If every model
 * proposes zero (or nothing is finite), the segments are equal, because a bar
 * with no width at all communicates less than an even one.
 */
export function trackSegments(
  members: readonly DivergenceMember[],
  scale: DivergenceScale,
): TrackSegment[] {
  const days = members.map((m) =>
    Number.isFinite(m.intervalDays) && m.intervalDays > 0 ? m.intervalDays : 0,
  );
  const weights = scale === "log" ? days.map((d) => Math.log1p(d)) : days;
  const total = weights.reduce((sum, w) => sum + w, 0);
  const share = (w: number): number =>
    total > 0 ? w / total : 1 / Math.max(1, members.length);
  return members.map((m, i) => ({
    id: m.id,
    intervalDays: days[i],
    share: share(weights[i]),
  }));
}

/** An interval label for the bar: `10d`, `3mo`, `47y`. */
export function trackLabel(intervalDays: number): string {
  if (!Number.isFinite(intervalDays) || intervalDays <= 0) return "—";
  if (intervalDays < 30) return `${Math.round(intervalDays)}d`;
  if (intervalDays < 365) return `${Math.round(intervalDays / 30)}mo`;
  return `${Math.round(intervalDays / 365)}y`;
}
