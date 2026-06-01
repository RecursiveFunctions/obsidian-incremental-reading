/**
 * Pure queue ordering, kept free of the Obsidian API so it can be unit
 * tested directly. `src/review.ts` adapts the live vault into `QueueEntry`
 * records and feeds them here.
 */

export interface QueueEntry {
  /** Stable element id from the store (no longer a note path; see Option 1). */
  id: string;
  /** IR type: "topic" | "extract" | "item", or empty for non-IR. */
  type: string;
  /** Lower number means more important. */
  priority: number;
  /** Card due time in epoch ms. */
  dueMs: number;
  dismissed: boolean;
}

export interface QueueOptions {
  /**
   * SuperMemo "interwoven learning": within an equal-priority band, shuffle
   * items so the user never sees the same sequence twice. The shuffle is
   * seeded by the calendar day so the order is stable across plugin
   * reloads within the same day — taking a break mid-session and resuming
   * keeps your "I just saw X" mental model intact — but next day's
   * session gets a fresh permutation.
   *
   * Defaults to true (SM-authentic). Set false to fall back to the
   * pre-feature deterministic order (priority, then due time).
   */
  interleaveSimilarPriority?: boolean;
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
  opts?: QueueOptions,
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

  const interleave = opts?.interleaveSimilarPriority ?? true;
  if (interleave) {
    const dayKey = Math.floor(nowMs / 86_400_000);
    shuffleWithinPriority(review, dayKey ^ 0x1234abcd);
    shuffleWithinPriority(reading, dayKey ^ 0x5678ef01);
  }

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

/**
 * Walk equal-priority runs in `arr` and shuffle each one in place. The seed
 * is mixed with the run's priority value so different priority bands get
 * independent permutations from the same day-key.
 *
 * Operates on an already-sorted array (by priority): a single linear pass
 * finds each run [i, j) by scanning until the priority changes, then
 * shuffles arr[i..j) deterministically.
 */
function shuffleWithinPriority(arr: QueueEntry[], seed: number): void {
  let i = 0;
  while (i < arr.length) {
    let j = i;
    while (j < arr.length && arr[j].priority === arr[i].priority) j += 1;
    if (j - i > 1) {
      seededShuffleSlice(arr, i, j, mix32(seed, arr[i].priority));
    }
    i = j;
  }
}

/**
 * Fisher-Yates shuffle on `arr[lo..hi)` driven by a 32-bit LCG. Same
 * (slice, seed) → same permutation, so the queue ordering is reproducible
 * for tests and for "I reopened my session" continuity within a day.
 */
function seededShuffleSlice(
  arr: QueueEntry[],
  lo: number,
  hi: number,
  seed: number,
): void {
  let s = seed >>> 0 || 1;
  const next = (): number => {
    // Numerical Recipes LCG constants. Good enough for shuffling tens to
    // hundreds of items; not cryptographic.
    s = ((s * 1664525) >>> 0) + 1013904223;
    s >>>= 0;
    return s / 0x1_0000_0000;
  };
  for (let i = hi - 1; i > lo; i -= 1) {
    const j = lo + Math.floor(next() * (i - lo + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
}

/** Mix two 32-bit values into a new 32-bit seed (xorshift-ish). */
function mix32(a: number, b: number): number {
  let x = (a ^ Math.imul(b | 0, 0x85ebca6b)) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x;
}
