/**
 * The scheduling core: a thin, well-typed boundary around `ts-fsrs`.
 *
 * The rest of the plugin never imports `ts-fsrs` directly. It goes through
 * here. That keeps the FSRS dependency swappable and keeps card<->frontmatter
 * serialization in exactly one place.
 */

import {
  Card,
  Grade as FsrsGrade,
  Rating,
  S_MAX,
  S_MIN,
  State,
  createEmptyCard,
  fsrs,
} from "ts-fsrs";
import { IR_KEYS } from "./types";
import type { StoredCard } from "./ir/model";

/** A fresh FSRS card, due now, in the `New` state. */
export function newCard(now: Date = new Date()): Card {
  return createEmptyCard(now);
}

/** The four review grades, in Again/Hard/Good/Easy order (FSRS 1-4). */
export type Grade = "again" | "hard" | "good" | "easy";

const RATING: Record<Grade, FsrsGrade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

/**
 * Numeric FSRS rating (1 Again, 2 Hard, 3 Good, 4 Easy) for persistence in
 * `graded` event payloads. Stats and the future parameter optimizer read
 * this; the review log is the plugin's revlog.
 */
export function gradeNumber(grade: Grade): number {
  return RATING[grade];
}

// The one scheduling engine. Starts on FSRS-6 defaults; `configureEngine`
// rebuilds it from fitted parameters and the desired-retention setting.
let engine = fsrs();
let configuredWeights: number[] | undefined;
let configuredRetention: number | undefined;
const enginesByRetention = new Map<number, ReturnType<typeof fsrs>>();

export interface EngineConfig {
  /** 21 fitted FSRS-6 weights; omit for the defaults. */
  w?: readonly number[];
  /** Target recall probability; omit for the ts-fsrs default (0.9). */
  requestRetention?: number;
}

/**
 * Rebuild the scheduling engine. Returns false when `w` was present but
 * invalid (wrong length, non-finite entries) — the engine then runs on
 * defaults, because hand-edited plugin data must never brick grading.
 * Retention is clamped to [0.7, 0.99].
 */
export function configureEngine(cfg: EngineConfig): boolean {
  const params: { w?: number[]; request_retention?: number } = {};
  let ok = true;
  if (cfg.w !== undefined) {
    const valid =
      Array.isArray(cfg.w) &&
      cfg.w.length === 21 &&
      cfg.w.every((x) => typeof x === "number" && Number.isFinite(x));
    if (valid) params.w = [...cfg.w];
    else ok = false;
  }
  if (
    cfg.requestRetention !== undefined &&
    Number.isFinite(cfg.requestRetention)
  ) {
    params.request_retention = Math.min(
      0.99,
      Math.max(0.7, cfg.requestRetention),
    );
  }
  engine = fsrs(params);
  configuredWeights = params.w;
  configuredRetention = params.request_retention;
  enginesByRetention.clear();
  return ok;
}

/** Apply a grade to a card and return its rescheduled next state. */
export function schedule(
  card: Card,
  grade: Grade,
  now: Date = new Date(),
  requestRetention?: number,
): Card {
  let selected = engine;
  if (requestRetention !== undefined && Number.isFinite(requestRetention)) {
    const retention = Math.min(0.99, Math.max(0.7, requestRetention));
    if (retention !== configuredRetention) {
      selected = enginesByRetention.get(retention) ?? fsrs({
        ...(configuredWeights ? { w: [...configuredWeights] } : {}),
        request_retention: retention,
      });
      enginesByRetention.set(retention, selected);
    }
  }
  return selected.next(card, now, RATING[grade]).card;
}

/**
 * Write a `Card` into a frontmatter object in-place using the canonical
 * `ir-` keys. Dates are stored as ISO-8601 strings so they stay readable and
 * comparable in plain text.
 */
export function writeCardToFrontmatter(
  fm: Record<string, unknown>,
  card: Card,
): void {
  fm[IR_KEYS.due] = card.due.toISOString();
  fm[IR_KEYS.stability] = card.stability;
  fm[IR_KEYS.difficulty] = card.difficulty;
  fm[IR_KEYS.elapsedDays] = card.elapsed_days;
  fm[IR_KEYS.scheduledDays] = card.scheduled_days;
  fm[IR_KEYS.reps] = card.reps;
  fm[IR_KEYS.lapses] = card.lapses;
  fm[IR_KEYS.state] = card.state;
  fm[IR_KEYS.learningSteps] = card.learning_steps;
  if (card.last_review) {
    fm[IR_KEYS.lastReview] = card.last_review.toISOString();
  } else {
    delete fm[IR_KEYS.lastReview];
  }
}

/**
 * Repair hand-edited or corrupted card fields (#129) so grading can never
 * crash on them: unknown `state` values, negative/non-finite counters, and
 * memory states below ts-fsrs's validation floor all fall back to fresh-card
 * defaults. A non-New card whose difficulty/stability is unrepairable
 * degrades to a fresh New card — losing the numbers beats bricking grading.
 * Valid cards pass through unchanged.
 */
export function sanitizeCard(card: Card): Card {
  const base = newCard();
  const fin = (v: number, fb: number): number => (Number.isFinite(v) ? v : fb);
  const int0 = (v: number, fb: number): number =>
    Number.isInteger(v) && v >= 0 ? v : fb;
  const validDate = (d: Date | undefined): boolean =>
    d instanceof Date && !Number.isNaN(d.getTime());
  if (!validDate(card.due)) card.due = base.due;
  if (card.last_review !== undefined && !validDate(card.last_review)) {
    card.last_review = undefined;
  }
  card.stability = fin(card.stability, base.stability);
  card.difficulty = fin(card.difficulty, base.difficulty);
  card.elapsed_days = int0(card.elapsed_days, base.elapsed_days);
  card.scheduled_days = fin(card.scheduled_days, base.scheduled_days);
  card.reps = int0(card.reps, base.reps);
  card.lapses = int0(card.lapses, base.lapses);
  card.learning_steps = int0(card.learning_steps ?? 0, base.learning_steps);
  if (![State.New, State.Learning, State.Review, State.Relearning].includes(card.state)) {
    card.state = base.state;
  }
  if (
    card.state !== State.New &&
    (card.difficulty < 1 ||
      card.difficulty > 10 ||
      card.stability < S_MIN ||
      card.stability > S_MAX)
  ) {
    return base;
  }
  return card;
}

/**
 * Decode a frontmatter date value. A bare `YYYY-MM-DD` string means a
 * calendar day in the author's timezone, so read it as local midnight —
 * `new Date(string)` would pick UTC midnight and shift the day for every
 * non-UTC user (evenings west of Greenwich). Full timestamps parse as
 * before. Returns null for garbage.
 */
export function parseFrontmatterDateValue(v: string | Date): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Reconstruct a `Card` from frontmatter. Missing/garbage fields fall back to
 * an empty card's defaults so a hand-edited or partially-written note can't
 * crash the scheduler.
 */
export function readCardFromFrontmatter(
  fm: Record<string, unknown> | null | undefined,
): Card {
  const base = newCard();
  if (!fm) return base;

  const num = (key: string, fallback: number): number => {
    const v = fm[key];
    return typeof v === "number" && Number.isFinite(v) ? v : fallback;
  };
  const date = (key: string, fallback: Date): Date => {
    const v = fm[key];
    if (typeof v === "string" || v instanceof Date) {
      const d = parseFrontmatterDateValue(v);
      if (d) return d;
    }
    return fallback;
  };

  const card: Card = {
    due: date(IR_KEYS.due, base.due),
    stability: num(IR_KEYS.stability, base.stability),
    difficulty: num(IR_KEYS.difficulty, base.difficulty),
    elapsed_days: num(IR_KEYS.elapsedDays, base.elapsed_days),
    scheduled_days: num(IR_KEYS.scheduledDays, base.scheduled_days),
    reps: num(IR_KEYS.reps, base.reps),
    lapses: num(IR_KEYS.lapses, base.lapses),
    state: num(IR_KEYS.state, base.state) as State,
    learning_steps: num(IR_KEYS.learningSteps, base.learning_steps),
  };

  const lr = fm[IR_KEYS.lastReview];
  if (typeof lr === "string" || lr instanceof Date) {
    const d = new Date(lr);
    if (!Number.isNaN(d.getTime())) card.last_review = d;
  }

  return sanitizeCard(card);
}

export function cardToStored(card: Card): StoredCard {
  const result: StoredCard = {
    due: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    learningSteps: card.learning_steps,
  };
  if (card.last_review !== undefined) {
    result.lastReview = card.last_review.getTime();
  }
  return result;
}

export function storedToCard(s: StoredCard | null | undefined): Card {
  // Derive from a fresh ts-fsrs card and overwrite fields. This guarantees
  // the result's exact shape matches whatever ts-fsrs produces (a fresh card
  // carries last_review as an own key set to undefined), so a round-trip is
  // lossless under deepStrictEqual and stays correct if ts-fsrs adds fields.
  const card = newCard();
  if (s === null || s === undefined) return card;
  card.due = new Date(s.due);
  card.stability = s.stability;
  card.difficulty = s.difficulty;
  card.elapsed_days = s.elapsedDays;
  card.scheduled_days = s.scheduledDays;
  card.reps = s.reps;
  card.lapses = s.lapses;
  card.state = s.state as State;
  card.learning_steps = s.learningSteps ?? 0;
  card.last_review =
    s.lastReview !== undefined ? new Date(s.lastReview) : undefined;
  return sanitizeCard(card);
}
