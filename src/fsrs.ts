/**
 * The scheduling core: a thin, well-typed boundary around `ts-fsrs`.
 *
 * The rest of the plugin never imports `ts-fsrs` directly — it goes through
 * here. That keeps the FSRS dependency swappable and keeps card<->frontmatter
 * serialization in exactly one place.
 */

import {
  Card,
  Grade as FsrsGrade,
  Rating,
  State,
  createEmptyCard,
  fsrs,
} from "ts-fsrs";
import { IR_KEYS } from "./types";

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

// One engine with default (unoptimized) parameters. Parameter optimization
// from real review history is a later roadmap item.
const engine = fsrs();

/** Apply a grade to a card and return its rescheduled next state. */
export function schedule(
  card: Card,
  grade: Grade,
  now: Date = new Date(),
): Card {
  return engine.next(card, now, RATING[grade]).card;
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
  if (card.last_review) {
    fm[IR_KEYS.lastReview] = card.last_review.toISOString();
  } else {
    delete fm[IR_KEYS.lastReview];
  }
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
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) return d;
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
  };

  const lr = fm[IR_KEYS.lastReview];
  if (typeof lr === "string" || lr instanceof Date) {
    const d = new Date(lr);
    if (!Number.isNaN(d.getTime())) card.last_review = d;
  }

  return card;
}
