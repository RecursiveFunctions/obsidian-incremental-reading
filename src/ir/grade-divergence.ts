import type { StoredCard } from "./model";
import { cardToStored, schedule, storedToCard, type Grade } from "../fsrs";
import { sm2, type Sm2State } from "../scheduler";
import { predict as predictDsr, type SchedulerStatePrimitive } from "../sm18-scheduler";
import { buildDivergenceModal, type DivergenceModalConfig } from "./divergence-modal";
import { scheduleSm20Item } from "./sm20-scheduler";
import type { PrimaryItemScheduler } from "./item-scheduler";

const MS_PER_DAY = 86_400_000;
const DEFAULT_THRESHOLD = 1.5;
const DEFAULT_FLOOR_DAYS = 7;

export interface DivergenceCheck {
  config: DivergenceModalConfig;
  primaryScheduler: PrimaryItemScheduler;
  sm20Card: StoredCard;
  sm20IntervalDays: number;
  sm20Due: number;
  fsrsCard: StoredCard;
  fsrsIntervalDays: number;
  fsrsDue: number;
  sm2IntervalDays: number;
  sm2Due: number;
  dsrIntervalDays: number;
  dsrDue: number;
  dsrStability: number;
  dsrDifficulty: number;
}

export interface DivergenceOptions {
  primaryScheduler?: PrimaryItemScheduler;
  effectiveRetention?: number;
}

function approximateSm2State(card: StoredCard): Sm2State {
  const easeFactor = Math.max(1.3, 2.5 - (card.difficulty - 5) * 0.15);
  return {
    repetitions: card.reps,
    easeFactor,
    intervalDays: card.scheduledDays || 1,
  };
}

function gradeToSmGrade(grade: Grade): number {
  switch (grade) {
    case "again":
      return 1;
    case "hard":
      return 3;
    case "good":
      return 4;
    case "easy":
      return 5;
  }
}

export function predictPowerLawDsr(
  card: StoredCard,
  grade: Grade,
  now: number,
  priority = 33,
): { intervalDays: number; due: number; stability: number; difficulty: number } {
  const elapsedDays =
    card.lastReview !== undefined && card.lastReview > 0
      ? Math.max(1, (now - card.lastReview) / MS_PER_DAY)
      : Math.max(1, card.elapsedDays || card.scheduledDays || 1);
  const state: SchedulerStatePrimitive = {
    stability: Math.max(0.7, card.stability || card.scheduledDays || 1),
    difficulty: Math.min(1, Math.max(0, ((card.difficulty || 5) - 1) / 9)),
    retrievability: 0.9,
    interval: card.scheduledDays || 0,
    next_interval: card.scheduledDays || 0,
    elapsed: elapsedDays,
    lapses: card.lapses || 0,
    repetition: card.reps || 0,
    a_factor: Math.max(1.2, 5.0 - ((card.difficulty || 5) - 1) * 0.35),
    graded: card.reps > 0,
    has_history: card.reps > 0,
    priority_position: Math.max(1, Math.round((priority / 100) * 1000)),
    kind: 1,
    postpones: 0,
  };
  const smGrade = gradeToSmGrade(grade);
  const next = predictDsr(state, smGrade);
  const gradeBonus = smGrade >= 3 ? 1 + 0.08 * (smGrade - 3) : 1;
  const intervalDays = Math.max(1, Math.round(next.next_interval * gradeBonus));
  return {
    intervalDays,
    due: now + intervalDays * MS_PER_DAY,
    stability: next.stability,
    difficulty: Math.min(10, Math.max(1, 1 + next.difficulty * 9)),
  };
}

export function checkGradeDivergence(
  card: StoredCard,
  primaryNextCard: StoredCard,
  grade: Grade,
  now: number,
  threshold = DEFAULT_THRESHOLD,
  floorDays = DEFAULT_FLOOR_DAYS,
  priority = 33,
  options: DivergenceOptions = {},
): DivergenceCheck | null {
  const primaryScheduler = options.primaryScheduler ?? "fsrs";
  const effectiveRetention = options.effectiveRetention ?? 0.9;
  const primaryId = primaryScheduler === "sm20" ? "SM-20" : "FSRS";

  const sm20Card =
    primaryScheduler === "sm20"
      ? primaryNextCard
      : scheduleSm20Item(card, grade, now, effectiveRetention);
  const sm20IntervalDays = sm20Card.scheduledDays;
  const sm20Due = sm20Card.due;

  const fsrsCard =
    primaryScheduler === "fsrs"
      ? primaryNextCard
      : cardToStored(schedule(storedToCard(card), grade, new Date(now), effectiveRetention));
  const fsrsIntervalDays = fsrsCard.scheduledDays;
  const fsrsDue = fsrsCard.due;

  const sm2State = approximateSm2State(card);
  const sm2Prediction = sm2.predict(sm2State, grade, now);
  const sm2IntervalDays = sm2Prediction.intervalDays;
  const sm2Due = sm2Prediction.due;

  const dsrPrediction = predictPowerLawDsr(card, grade, now, priority);
  const dsrIntervalDays = dsrPrediction.intervalDays;
  const dsrDue = dsrPrediction.due;

  const config = buildDivergenceModal({
    members: [
      { id: "SM-20", intervalDays: sm20IntervalDays, due: sm20Due },
      { id: "FSRS", intervalDays: fsrsIntervalDays, due: fsrsDue },
      { id: "DSR", intervalDays: dsrIntervalDays, due: dsrDue },
      { id: "SM-2", intervalDays: sm2IntervalDays, due: sm2Due },
    ],
    primaryId,
    threshold,
    floorDays,
  });

  if (!config) return null;
  return {
    config,
    primaryScheduler,
    sm20Card,
    sm20IntervalDays,
    sm20Due,
    fsrsCard,
    fsrsIntervalDays,
    fsrsDue,
    sm2IntervalDays,
    sm2Due,
    dsrIntervalDays,
    dsrDue,
    dsrStability: dsrPrediction.stability,
    dsrDifficulty: dsrPrediction.difficulty,
  };
}
