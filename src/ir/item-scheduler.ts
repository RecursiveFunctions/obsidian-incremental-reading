import type { Card } from "ts-fsrs";
import { cardToStored, schedule, storedToCard, type Grade } from "../fsrs";
import type { StoredCard } from "./model";
import {
  gradeInputToSmGrade,
  hashSm20DispersionSeed,
  scheduleSm20Item,
  smGradeToFsrsGrade,
  type Sm20ArenaWeights,
  type SmGrade,
} from "./sm20-scheduler";
import type { Sm20Matrix } from "./sm20-matrix";

export type PrimaryItemScheduler = "sm20" | "fsrs";

export interface ScheduleItemOptions {
  primaryScheduler?: PrimaryItemScheduler;
  requestRetention?: number;
  sm20Matrix?: Sm20Matrix;
  elementId?: string;
  undoRollCount?: number;
  sm20ArenaWeights?: Sm20ArenaWeights;
  sm20AutoAdaptArena?: boolean;
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
    const smGrade = gradeInputToSmGrade(grade);
    const dispersionSeed =
      options.elementId !== undefined
        ? hashSm20DispersionSeed(
            options.elementId,
            storedInput?.reps ?? 0,
            storedInput?.lapses ?? 0,
            smGrade,
            options.undoRollCount ?? 0,
          )
        : null;
    const stored = scheduleSm20Item(storedInput, smGrade, nowMs, {
      requestRetention: options.requestRetention ?? 0.9,
      matrix: options.sm20Matrix,
      arenaWeights: options.sm20ArenaWeights,
      autoAdaptArena: options.sm20AutoAdaptArena,
      dispersionSeed,
    });
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
