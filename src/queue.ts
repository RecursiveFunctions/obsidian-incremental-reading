/**
 * Pure queue ordering, kept free of the Obsidian API so it can be unit
 * tested directly. `src/review.ts` adapts the live vault into `QueueEntry`
 * records and feeds them here.
 */

export interface QueueEntry {
  /** Stable identifier (the note path in production). */
  id: string;
  /** IR type: "topic" | "extract" | "item", or empty for non-IR. */
  type: string;
  /** Lower number means more important. */
  priority: number;
  /** Card due time in epoch ms. */
  dueMs: number;
  dismissed: boolean;
}

/**
 * Build the interleaved session: due review items (clozes) carry it, with
 * reading elements (topics, extracts) folded in by priority every
 * `reviewsPerReading` items. Dismissed, non-IR, and not-yet-due entries are
 * excluded. `reviewsPerReading <= 0` disables reading interleave entirely.
 */
export function interleavedQueue(
  entries: QueueEntry[],
  reviewsPerReading: number,
  nowMs: number,
): string[] {
  const review: QueueEntry[] = [];
  const reading: QueueEntry[] = [];

  for (const e of entries) {
    if (!e.type || e.dismissed) continue;
    if (!Number.isFinite(e.dueMs) || e.dueMs > nowMs) continue;
    (e.type === "item" ? review : reading).push(e);
  }

  const byImportance = (a: QueueEntry, b: QueueEntry) =>
    a.priority - b.priority || a.dueMs - b.dueMs;
  review.sort(byImportance);
  reading.sort(byImportance);

  if (reviewsPerReading <= 0) return review.map((e) => e.id);

  const out: string[] = [];
  let r = 0;
  for (let i = 0; i < review.length; i += 1) {
    out.push(review[i].id);
    if ((i + 1) % reviewsPerReading === 0 && r < reading.length) {
      out.push(reading[r].id);
      r += 1;
    }
  }
  for (; r < reading.length; r += 1) out.push(reading[r].id);
  return out;
}
