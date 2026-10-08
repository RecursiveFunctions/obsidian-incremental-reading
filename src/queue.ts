/**
 * Pure queue ordering, kept free of the Obsidian API so it can be unit
 * tested directly. `src/review.ts` adapts the live vault into `QueueEntry`
 * records and feeds them here.
 */

export interface QueueEntry {
  /** Stable element id from the ledger (no longer a note path; see Option 1). */
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
   * For malformed/external tied inputs, shuffle items so the user never sees
   * the same sequence twice. Ledger-derived priorities are normally unique. The shuffle is
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

export type QueueScope = "due" | "random" | "neural";
export type QueueTraversal = "mixed" | "priority";

export interface QueuePolicy {
  version: 1;
  scope: QueueScope;
  traversal: QueueTraversal;
  readingProportion: number;
  itemJitter: number;
  readingJitter: number;
  seed: number;
  autoSort: boolean;
}

export type QueuePreset = "strict" | "balanced" | "discovery";

export function queuePreset(preset: QueuePreset, seed = 0): QueuePolicy {
  if (preset === "strict") {
    return { version: 1, scope: "due", traversal: "priority", readingProportion: 0.25,
      itemJitter: 0, readingJitter: 0, seed, autoSort: true };
  }
  if (preset === "discovery") {
    return { version: 1, scope: "due", traversal: "mixed", readingProportion: 0.4,
      itemJitter: 0.75, readingJitter: 1, seed, autoSort: true };
  }
  return { version: 1, scope: "due", traversal: "mixed", readingProportion: 0.25,
    itemJitter: 0.2, readingJitter: 0.3, seed, autoSort: true };
}

export function normalizeQueuePolicy(policy: Partial<QueuePolicy>): QueuePolicy {
  const base = queuePreset("strict", Number.isFinite(policy.seed) ? policy.seed! : 0);
  const clamp01 = (value: unknown, fallback: number) =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.min(1, Math.max(0, value)) : fallback;
  return {
    version: 1,
    scope: policy.scope === "random" || policy.scope === "neural" ? policy.scope : "due",
    traversal: policy.traversal === "mixed" ? "mixed" : "priority",
    readingProportion: clamp01(policy.readingProportion, base.readingProportion),
    itemJitter: clamp01(policy.itemJitter, base.itemJitter),
    readingJitter: clamp01(policy.readingJitter, base.readingJitter),
    seed: Number.isFinite(policy.seed) ? Math.trunc(policy.seed!) : 0,
    autoSort: policy.autoSort !== false,
  };
}

/** Queue entries according to a complete, serializable session policy. */
export function policyQueue(
  entries: readonly QueueEntry[],
  nowMs: number,
  inputPolicy: QueuePolicy,
): string[] {
  const policy = normalizeQueuePolicy(inputPolicy);
  const eligible = entries.filter((entry) =>
    !!entry.type && !entry.dismissed &&
    (policy.scope !== "due" || (Number.isFinite(entry.dueMs) && entry.dueMs <= nowMs)));
  const items = ranked(eligible.filter((entry) => entry.type === "item"), policy.itemJitter,
    policy.seed ^ 0x1234abcd);
  const reading = ranked(eligible.filter((entry) => entry.type !== "item"), policy.readingJitter,
    policy.seed ^ 0x5678ef01);

  if (policy.traversal === "priority") {
    return ranked(eligible, 0, policy.seed).map((entry) => entry.id);
  }
  if (policy.readingProportion <= 0) return items.map((entry) => entry.id);
  if (policy.readingProportion >= 1) return reading.map((entry) => entry.id);

  const out: string[] = [];
  let itemIndex = 0;
  let readingIndex = 0;
  let emittedReading = 0;
  while (itemIndex < items.length || readingIndex < reading.length) {
    const nextTarget = (out.length + 1) * policy.readingProportion;
    if (readingIndex < reading.length &&
      (itemIndex >= items.length || emittedReading < nextTarget)) {
      out.push(reading[readingIndex++].id);
      emittedReading += 1;
    } else if (itemIndex < items.length) {
      out.push(items[itemIndex++].id);
    }
  }
  return out;
}

/** Keep the processed prefix and current slot fixed while replacing the tail. */
export function rebuildQueueTail(
  currentIds: readonly string[],
  cursor: number,
  freshIds: readonly string[],
): string[] {
  if (currentIds.length === 0) return [...new Set(freshIds)];
  const fixedEnd = Math.min(currentIds.length, Math.max(0, cursor + 1));
  const prefix = currentIds.slice(0, fixedEnd);
  const seen = new Set(prefix);
  const tail: string[] = [];
  for (const id of freshIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    tail.push(id);
  }
  return [...prefix, ...tail];
}

function ranked(entries: readonly QueueEntry[], strength: number, seed: number): QueueEntry[] {
  const ordered = [...entries].sort((a, b) =>
    a.priority - b.priority || a.dueMs - b.dueMs || a.id.localeCompare(b.id));
  if (strength <= 0 || ordered.length <= 1) return ordered;
  const maxDisplacement = Math.max(1, Math.ceil(strength * Math.sqrt(ordered.length)));
  return ordered
    .map((entry, index) => ({
      entry,
      key: index + (unitHash(seed, entry.id) * 2 - 1) * maxDisplacement,
    }))
    .sort((a, b) => a.key - b.key || a.entry.id.localeCompare(b.entry.id))
    .map(({ entry }) => entry);
}

function unitHash(seed: number, text: string): number {
  let value = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    value = Math.imul(value ^ text.charCodeAt(index), 0x45d9f3b) >>> 0;
    value ^= value >>> 16;
  }
  return value / 0x1_0000_0000;
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
 * Walk exceptional equal-priority runs in `arr` and shuffle each one in place. The seed
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
