import type { Card } from "ts-fsrs";
import { cardToStored, schedule, storedToCard, type Grade } from "../fsrs";
import type { StoredCard } from "./model";
import {
  gradeInputToSmGrade,
  scheduleSm20Item,
  smGradeToFsrsGrade,
  type SmGrade,
} from "./sm20-scheduler";
import type { Sm20Matrix } from "./sm20-matrix";

export type PrimaryItemScheduler = "sm20" | "fsrs";

export interface ScheduleItemOptions {
  primaryScheduler?: PrimaryItemScheduler;
  requestRetention?: number;
  sm20Matrix?: Sm20Matrix;
}

export interface ScheduleItemResult {
  scheduler: PrimaryItemScheduler;
  card: Card;
  stored: StoredCard;
}

function isFsrsCard(value: StoredCard | Card | null | undefined): value is Card {
  return value != null && typeof value === "object" && "due" in value && value.due instanceof Date;
}

export function scheduleItem(
  card: StoredCard | Card | null | undefined,
  grade: Grade | SmGrade,
  nowMs: number,
  options: ScheduleItemOptions = {},
): ScheduleItemResult {
  const primaryScheduler = options.primaryScheduler ?? "fsrs";
  if (primaryScheduler === "sm20") {
    const storedInput = isFsrsCard(card) ? cardToStored(card) : card;
    const stored = scheduleSm20Item(
      storedInput,
      grade,
      nowMs,
      options.requestRetention ?? 0.9,
      options.sm20Matrix,
    );
    return {
      scheduler: "sm20",
      card: storedToCard(stored),
      stored,
    };
  }
  const fsrsGrade = typeof grade === "number" ? smGradeToFsrsGrade(gradeInputToSmGrade(grade)) : grade;
  const fsrsInput = isFsrsCard(card) ? card : storedToCard(card);
  const nextCard = schedule(fsrsInput, fsrsGrade, new Date(nowMs), options.requestRetention);
  return {
    scheduler: "fsrs",
    card: nextCard,
    stored: cardToStored(nextCard),
  };
}
