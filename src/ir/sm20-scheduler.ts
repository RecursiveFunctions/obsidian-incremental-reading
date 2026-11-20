import type { Grade } from "../fsrs";
import type { StoredCard } from "./model";
import { roundHalfToEven, SM20_MAX_INTERVAL_DAYS } from "../sm18-ir-mechanics";
import {
  calibrateSm20Retrievability,
  computePostLapseStability,
  computePostReviewStability,
  lookupBlendedSinc,
  type Sm20Matrix,
} from "./sm20-matrix";

export const SM20_STABILITY_MIN = 0.7;
export const SM20_STABILITY_MAX = 44_530.0;
export const SM20_RETRIEVABILITY_MIN = 0.005;
export const SM20_RETRIEVABILITY_MAX = 0.995;
export const SM20_DECAY = -Math.log(0.9);
export const SM20_EXP_ARG_CLAMP = 38.0;
export const SM20_STABILITY_POWER_EXPONENT = 2.90396936502257;

const MS_PER_DAY = 86_400_000;
const DEFAULT_DIFFICULTY_01 = (5.0 - 1.0) / 9.0;

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** `TDatabase.GetDSR` (`0x00d912e0`), `FUN_00fc7b70` (`0x00fc7b70`), `FUN_00cf5470` (`0x00cf5470`). */
export function computeSm20Retrievability(elapsedDays: number, stability: number): number {
  if (!Number.isFinite(elapsedDays) || !Number.isFinite(stability)) {
    return SM20_RETRIEVABILITY_MAX;
  }
  const safeStability = Math.max(stability, SM20_STABILITY_MIN);
  const safeElapsed = Math.max(0.0, elapsedDays);
  const expArg = clamp((-SM20_DECAY * safeElapsed) / safeStability, -SM20_EXP_ARG_CLAMP, SM20_EXP_ARG_CLAMP);
  const raw = Math.exp(expArg);
  if (!Number.isFinite(raw)) return SM20_RETRIEVABILITY_MAX;
  return clamp(raw, SM20_RETRIEVABILITY_MIN, SM20_RETRIEVABILITY_MAX);
}

/** `FUN_00cf4e00` (`0x00cf4e00`). */
export function difficulty01ToIndex20(d01: number): number {
  if (!Number.isFinite(d01) || d01 < 0.0 || d01 > 1.0) return 10;
  return clamp(roundHalfToEven(d01 * 19.0) + 1, 1, 20);
}

/** `FUN_00cf5200` (`0x00cf5200`). */
export function difficultyIndex20ToLogFraction(dIdx: number): number {
  const cleanIdx = clamp(Math.trunc(Number.isFinite(dIdx) ? dIdx : 10), 1, 20);
  return Math.log(cleanIdx) / Math.log(20.0);
}

/** `FUN_00cf4ff0` (`0x00cf4ff0`). */
export function repetitionIndexToFraction19(rIdx: number): number {
  const cleanIdx = clamp(Math.trunc(Number.isFinite(rIdx) ? rIdx : 1), 1, 20);
  return (cleanIdx - 1) / 19.0;
}

/** `FUN_00cf5160` (`0x00cf5160`). */
export function stabilityToIndex20(
  stability: number,
  powerExp = SM20_STABILITY_POWER_EXPONENT,
): number {
  const safeStability = clamp(
    Number.isFinite(stability) ? stability : SM20_STABILITY_MIN,
    SM20_STABILITY_MIN,
    SM20_STABILITY_MAX,
  );
  const adj = Math.max(0.0, safeStability - 2.0);
  const idx = roundHalfToEven(Math.pow(adj, 1.0 / powerExp)) + 1;
  return clamp(idx, 1, 20);
}

/** `FUN_00cf5250` (`0x00cf5250`). */
export function stabilityIndex20ToTransformed(
  sIdx: number,
  powerExp = SM20_STABILITY_POWER_EXPONENT,
): number {
  const cleanIdx = clamp(Math.trunc(Number.isFinite(sIdx) ? sIdx : 1), 1, 20);
  return Math.pow(cleanIdx - 1, powerExp) + 2.0;
}

/** `ComputeIntervalModelV2Sm19` (`0x00a960f0`). */
export function evaluateSincModelV2(
  repFrac: number,
  sTransformed: number,
  diffFrac: number,
): number {
  const d1 = Math.pow(Math.max(0.7, sTransformed), repFrac * -0.22999999999999998 - 0.08);
  const d2 = Math.min(600.0, repFrac * -1.88 + 1.58);
  const expTerm = Math.exp(clamp(-d2 * diffFrac, -SM20_EXP_ARG_CLAMP, SM20_EXP_ARG_CLAMP));
  return ((((1.0 - repFrac) * 7.989999999999999 + 1.3) - 1.04) * d1 + 0.07) * expTerm;
}

/** `ComputeInitialStabilityIncreaseEstimate` (`0x00cdeb50`) clamped via `0x00ce60b0`. */
export function computeInitialSincPrior(
  difficulty01: number,
  stability: number,
  retrievability: number,
): number {
  const d01 = clamp(Number.isFinite(difficulty01) ? difficulty01 : DEFAULT_DIFFICULTY_01, 0.0, 1.0);
  const safeS = Math.max(SM20_STABILITY_MIN, Number.isFinite(stability) ? stability : SM20_STABILITY_MIN);
  const safeR = clamp(Number.isFinite(retrievability) ? retrievability : SM20_RETRIEVABILITY_MAX, 0.0, 1.0);
  const dVar1 = Math.pow(safeS, d01 * -0.27 - 0.08);
  const dVar2 = Math.min(600.0, d01 * -2.0 + 2.25);
  const expTerm = Math.exp(clamp(-dVar2 * safeR, -SM20_EXP_ARG_CLAMP, SM20_EXP_ARG_CLAMP));
  const raw = (((1.0 - d01) * 12.0 + 2.0) * dVar1 + 1.0) * expTerm;
  return clamp(raw, 0.8, 20.0);
}

/** `EnforceMinimumIntervalGrowthFactor` (`0x00cf29c0`). */
export function enforceMinimumIntervalGrowthFactor(
  prevIv: number,
  candidateIv: number,
  reps: number,
): number {
  const cleanCandidate = clamp(Math.max(1, Math.trunc(candidateIv)), 1, SM20_MAX_INTERVAL_DAYS);
  if (reps <= 1) return cleanCandidate;
  const cleanPrev = Math.max(1, Math.trunc(prevIv));
  if (cleanPrev >= 1461) return cleanCandidate;
  const rawMinFactor = cleanPrev < 70 ? 1.7 * Math.pow(cleanPrev, -0.1) : 1.1;
  const minFactor = Math.max(1.1, rawMinFactor);
  if (cleanCandidate / cleanPrev < minFactor) {
    return clamp(roundHalfToEven(cleanPrev * minFactor + 0.5), 1, SM20_MAX_INTERVAL_DAYS);
  }
  return cleanCandidate;
}

export function storedDifficultyTo01(difficulty: number | undefined): number {
  if (difficulty === undefined || !Number.isFinite(difficulty) || difficulty < 1.0) {
    return DEFAULT_DIFFICULTY_01;
  }
  return clamp((difficulty - 1.0) / 9.0, 0.0, 1.0);
}

export function difficulty01ToStored(d01: number): number {
  if (!Number.isFinite(d01)) return 5.0;
  return clamp(1.0 + clamp(d01, 0.0, 1.0) * 9.0, 1.0, 10.0);
}

function nextDifficulty01ForGrade(prevD01: number, grade: Grade): number {
  switch (grade) {
    case "again":
      return clamp(prevD01 + 0.04, 0.0, 1.0);
    case "hard":
      return clamp(prevD01 + 0.015, 0.0, 1.0);
    case "good":
      return clamp(prevD01 - 0.01, 0.0, 1.0);
    case "easy":
      return clamp(prevD01 - 0.025, 0.0, 1.0);
  }
}

/** Closed-form SM-20 item scheduler (`0x00cf3980`, `0x00cde4a0`, `0x00cdeb50`, `0x00cf29c0`). */
export function scheduleSm20Item(
  card: StoredCard | null | undefined,
  grade: Grade,
  nowMs: number,
  desiredRetention = 0.9,
  matrix?: Sm20Matrix,
): StoredCard {
  const prevReps = Math.max(0, Math.trunc(card?.reps ?? 0));
  const prevLapses = Math.max(0, Math.trunc(card?.lapses ?? 0));
  const prevScheduledDays = Math.max(0, Math.trunc(card?.scheduledDays ?? 0));
  const prevD01 = storedDifficultyTo01(card?.difficulty);
  const nextD01 = nextDifficulty01ForGrade(prevD01, grade);
  const nextDifficulty = difficulty01ToStored(nextD01);

  const clampedRetention = clamp(
    Number.isFinite(desiredRetention) ? desiredRetention : 0.9,
    0.7,
    0.99,
  );
  const fiFactor = Math.log(clampedRetention) / Math.log(0.9);

  const elapsedFloat =
    prevReps > 0 && card?.lastReview !== undefined && Number.isFinite(card.lastReview)
      ? Math.max(0.0, (nowMs - card.lastReview) / MS_PER_DAY)
      : 0.0;
  const elapsedDays = Math.max(0, Math.floor(elapsedFloat));

  if (prevReps === 0) {
    if (grade === "again") {
      return {
        due: nowMs + MS_PER_DAY,
        stability: SM20_STABILITY_MIN,
        difficulty: nextDifficulty,
        elapsedDays: 0,
        scheduledDays: 1,
        reps: 1,
        lapses: prevLapses + 1,
        state: 1,
        learningSteps: 0,
        lastReview: nowMs,
      };
    }
    const priorSinc = lookupBlendedSinc(matrix, prevD01, 2.0, SM20_RETRIEVABILITY_MAX);
    const gradeScale = grade === "hard" ? 0.6 : grade === "easy" ? 1.3 : 1.0;
    const nextStability = clamp(priorSinc * gradeScale, SM20_STABILITY_MIN, SM20_STABILITY_MAX);
    const rawIv = clamp(nextStability * fiFactor, SM20_STABILITY_MIN, SM20_STABILITY_MAX);
    const scheduledDays = clamp(roundHalfToEven(rawIv), 1, SM20_MAX_INTERVAL_DAYS);
    return {
      due: nowMs + scheduledDays * MS_PER_DAY,
      stability: nextStability,
      difficulty: nextDifficulty,
      elapsedDays: 0,
      scheduledDays,
      reps: 1,
      lapses: prevLapses,
      state: 2,
      learningSteps: 0,
      lastReview: nowMs,
    };
  }

  const prevS = clamp(
    card && Number.isFinite(card.stability) && card.stability > 0
      ? card.stability
      : Math.max(1.0, prevScheduledDays),
    SM20_STABILITY_MIN,
    SM20_STABILITY_MAX,
  );

  if (grade === "again") {
    const postLapseStability = computePostLapseStability(prevS, prevLapses + 1);
    return {
      due: nowMs + MS_PER_DAY,
      stability: postLapseStability,
      difficulty: nextDifficulty,
      elapsedDays,
      scheduledDays: 1,
      reps: prevReps + 1,
      lapses: prevLapses + 1,
      state: 3,
      learningSteps: 0,
      lastReview: nowMs,
    };
  }

  const nextRepNumber = prevReps + 1;
  const dIdx = difficulty01ToIndex20(prevD01);
  const sIdx = stabilityToIndex20(prevS);
  const analyticalR = computeSm20Retrievability(elapsedFloat, prevS);
  const retrievability = matrix
    ? calibrateSm20Retrievability(matrix, dIdx, sIdx, analyticalR)
    : analyticalR;
  const sincRaw = Math.max(1.05, lookupBlendedSinc(matrix, prevD01, prevS, retrievability));
  const smGrade = grade === "hard" ? 3 : grade === "easy" ? 5 : 4;
  const nextStability = computePostReviewStability(prevS, sincRaw, elapsedFloat, smGrade);
  const rawIv = clamp(nextStability * fiFactor, SM20_STABILITY_MIN, SM20_STABILITY_MAX);
  const candidateIv = clamp(roundHalfToEven(rawIv), 1, SM20_MAX_INTERVAL_DAYS);
  const prevIv = Math.max(1, prevScheduledDays || roundHalfToEven(prevS));
  const scheduledDays = enforceMinimumIntervalGrowthFactor(prevIv, candidateIv, nextRepNumber);

  return {
    due: nowMs + scheduledDays * MS_PER_DAY,
    stability: nextStability,
    difficulty: nextDifficulty,
    elapsedDays,
    scheduledDays,
    reps: nextRepNumber,
    lapses: prevLapses,
    state: 2,
    learningSteps: 0,
    lastReview: nowMs,
  };
}
