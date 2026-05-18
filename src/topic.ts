/**
 * Topic scheduling: the SuperMemo reading model, kept pure and free of the
 * Obsidian API so it can be unit tested directly.
 *
 * Reading elements (topics and extracts) are never graded. You read them and
 * press "Next". On Next the element is rescheduled by *multiplying* its
 * interval by its A-Factor, exactly like SuperMemo's topic queue: intervals
 * keep stretching, recall performance never enters the math. The two real
 * knobs are priority (queue order, in src/types.ts) and the per-element
 * A-Factor tuned here.
 *
 * State lives in flat `ir-` frontmatter keys (ir-due / ir-interval /
 * ir-a-factor) so a user can open the file and adjust the schedule by hand.
 */

import { IR_KEYS } from "./types";

const MS_PER_DAY = 86_400_000;

/** Tunables a topic schedule needs; supplied from plugin settings. */
export interface TopicScheduleSettings {
  /** Days until a freshly advanced topic with no interval yet is due again. */
  topicFirstInterval: number;
  /** Default interval multiplier seeded onto new topics. */
  topicAFactor: number;
  /** Hard cap on the topic interval in days, so it can't run away. */
  topicMaxInterval: number;
}

/** A topic's schedule, decoded from frontmatter. */
export interface TopicState {
  /** When the topic is next due (epoch ms). */
  dueMs: number;
  /** Current spacing interval in days (0 = never advanced). */
  interval: number;
  /** Interval multiplier applied on each Next. */
  aFactor: number;
}

/** Lowest sane A-Factor: anything <= 1 would never grow the interval. */
const MIN_A_FACTOR = 1.1;

function clampAFactor(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value < MIN_A_FACTOR) {
    return Number.isFinite(fallback) && fallback >= MIN_A_FACTOR
      ? fallback
      : 2;
  }
  return value;
}

/**
 * A fresh topic schedule: due now (so it enters the queue immediately, like a
 * new FSRS card), no interval yet, A-Factor from settings.
 */
export function newTopicState(
  settings: TopicScheduleSettings,
  now: Date = new Date(),
): TopicState {
  return {
    dueMs: now.getTime(),
    interval: 0,
    aFactor: clampAFactor(settings.topicAFactor, 2),
  };
}

/**
 * Advance a topic after a reading pass ("Next" in the review UI). First pass
 * uses `topicFirstInterval`; every later pass multiplies the interval by the
 * A-Factor. The interval is clamped to `topicMaxInterval` and the next due
 * time is `now + interval days`.
 */
export function advanceTopic(
  state: TopicState,
  settings: TopicScheduleSettings,
  now: Date = new Date(),
): TopicState {
  const aFactor = clampAFactor(state.aFactor, settings.topicAFactor);
  const first = Math.max(1, Math.round(settings.topicFirstInterval || 1));
  const max = Math.max(first, Math.round(settings.topicMaxInterval || first));

  const next =
    state.interval >= 1
      ? Math.round(state.interval * aFactor)
      : first;
  const interval = Math.min(max, Math.max(1, next));

  return {
    interval,
    aFactor,
    dueMs: now.getTime() + interval * MS_PER_DAY,
  };
}

/**
 * Postpone a topic to later in the same day without touching its interval or
 * A-Factor (SuperMemo's "later"/postpone). It drops to the back of today's
 * reading by being pushed a few minutes out.
 */
export function laterToday(
  state: TopicState,
  now: Date = new Date(),
): TopicState {
  return { ...state, dueMs: now.getTime() + 10 * 60_000 };
}

/**
 * Decode a topic schedule from frontmatter. Missing or garbage fields fall
 * back to a sane new-topic schedule, so a hand-edited note, or an older topic
 * that still carries stale FSRS keys, can't crash the scheduler. An old topic
 * with only `ir-due` set reads as interval 0, so its first Next seeds the
 * interval cleanly.
 */
export function readTopicFromFrontmatter(
  fm: Record<string, unknown> | null | undefined,
  settings: TopicScheduleSettings,
  now: Date = new Date(),
): TopicState {
  const base = newTopicState(settings, now);
  if (!fm) return base;

  const due = fm[IR_KEYS.due];
  if (typeof due === "string" || due instanceof Date) {
    const d = new Date(due);
    if (!Number.isNaN(d.getTime())) base.dueMs = d.getTime();
  }

  const iv = fm[IR_KEYS.interval];
  if (typeof iv === "number" && Number.isFinite(iv) && iv >= 1) {
    base.interval = Math.round(iv);
  }

  const af = fm[IR_KEYS.aFactor];
  if (typeof af === "number") base.aFactor = clampAFactor(af, base.aFactor);

  return base;
}

/**
 * Write a topic schedule into a frontmatter object in-place using the
 * canonical `ir-` keys. Dates are ISO-8601 strings so they stay readable and
 * comparable in plain text, matching the FSRS writer.
 */
export function writeTopicToFrontmatter(
  fm: Record<string, unknown>,
  state: TopicState,
): void {
  fm[IR_KEYS.due] = new Date(state.dueMs).toISOString();
  fm[IR_KEYS.interval] = state.interval;
  fm[IR_KEYS.aFactor] = state.aFactor;
}
