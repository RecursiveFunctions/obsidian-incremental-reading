import type { Grade } from "../fsrs";
import type { StoredCard } from "./model";
import {
  rationalSaturationZeroGuarded,
  roundHalfToEven,
  SM20_MAX_INTERVAL_DAYS,
} from "../sm18-ir-mechanics";
import {
  calibrateSm20Retrievability,
  computePostLapseStability,
  computePostReviewStability,
  lookupBlendedSinc,
  retrievabilityToIndex20,
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
const LN_2 = Math.LN2;
const DEFAULT_DIFFICULTY_01 = (5.0 - 1.0) / 9.0;

/** SuperMemo 6-point item grade (`0..2` fail, `3..5` pass). */
export type SmGrade = 0 | 1 | 2 | 3 | 4 | 5;

export function isSmGrade(v: unknown): v is SmGrade {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 5;
}

export function smGradeToFsrsGrade(smGrade: SmGrade): Grade {
  if (smGrade <= 2) return "again";
  if (smGrade === 3) return "hard";
  if (smGrade === 4) return "good";
  return "easy";
}

export function gradeInputToSmGrade(grade: Grade | SmGrade): SmGrade {
  if (typeof grade === "number") {
    return clamp(Math.round(grade), 0, 5) as SmGrade;
  }
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

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function normalizedPairRatio(a: number, b: number): number {
  const denom = a + b;
  return denom === 0 ? 0 : a / denom;
}

/**
 * Exact 35 IEEE-754 float64 parameters dumped from `sm20.exe` at `*0x011a5bd0`
 * (`0x0115f4d0`, offsets `+0x000 .. +0x110`).
 */
export const SM20_PA20_WEIGHTS: readonly number[] = [
  0.9286298950420208, // 0: +0x000 r1 base
  347.85204578386566, // 1: +0x008 S blend scale
  0.30270230764837086, // 2: +0x010 D blend scale 1
  0.4078726801204931, // 3: +0x018 D blend scale 2
  767.8438603670941, // 4: +0x020 exp curve S scale
  7.894742385544259, // 5: +0x028 init S fallback
  4.08242569493503, // 6: +0x030 init S grade 0
  1.996431220980246, // 7: +0x038 init S grade 1
  9.170585471775675, // 8: +0x040 init S grade 2
  1.1425608073008684, // 9: +0x048 init S grade 3
  17.65771045770738, // 10: +0x050 init S grade 4
  77.77877780253718, // 11: +0x058 init S grade 5
  0.5921926894783989, // 12: +0x060 init D fallback
  0.6895479373487655, // 13: +0x068 init D grade 0
  0.6472785530963361, // 14: +0x070 init D grade 1
  0.4208423230793679, // 15: +0x078 init D grade 2
  0.5186353666458963, // 16: +0x080 init D grade 3
  0.27244747048223983, // 17: +0x088 init D grade 4
  0.3261492383691367, // 18: +0x090 init D grade 5
  1.680034668443124, // 19: +0x098 fail easiness mult
  5.928185533585771, // 20: +0x0a0 fail S ratio pivot
  2.0150955428514656, // 21: +0x0a8 fail S ratio mult
  0.2555216135743039, // 22: +0x0b0 fail 1-R ratio pivot
  1.9926553104343092, // 23: +0x0b8 fail 1-R ratio add
  95.04137758278812, // 24: +0x0c0 D inertia S pivot
  42.21989471200275, // 25: +0x0c8 pass max SInc ceiling
  3.1089639864486682, // 26: +0x0d0 pass hard SInc ceiling
  1.3558071518966488, // 27: +0x0d8 pass SInc floor
  0.9250460852489478, // 28: +0x0e0 early review base
  0.8538692150895362, // 29: +0x0e8 early review slope
  0.9559110660552212, // 30: +0x0f0 early review ratio pivot
  -0.6915519353695037, // 31: +0x0f8 stability power decay
  1.0037797256248404, // 32: +0x100 R exp easiness slope
  1.393910494789472, // 33: +0x108 R exp base
  0.12374729387559685, // 34: +0x110 grade 3/4/5 step
];

/** `0x00cad380` — PA20 initial stability slot by grade `0..5`. */
export function computePa20InitialStability(
  smGrade: number,
  weights: readonly number[] = SM20_PA20_WEIGHTS,
): number {
  const g = Math.trunc(smGrade);
  if (g >= 0 && g <= 5) return weights[6 + g]!;
  return weights[5]!;
}

/** `0x00cad420` — PA20 initial difficulty `[0, 1]` slot by grade `0..5`. */
export function computePa20InitialDifficulty01(
  smGrade: number,
  weights: readonly number[] = SM20_PA20_WEIGHTS,
): number {
  const g = Math.trunc(smGrade);
  if (g >= 0 && g <= 5) return weights[13 + g]!;
  return weights[12]!;
}

/** `0x00cad1b0` (`BlendTripleRetentionCurveSamples`). */
export function evaluatePa20TripleRetrievability(
  elapsedDays: number,
  stability: number,
  difficulty01: number,
  weights: readonly number[] = SM20_PA20_WEIGHTS,
): number {
  if (!Number.isFinite(elapsedDays) || elapsedDays <= 0) return SM20_RETRIEVABILITY_MAX;
  if (!Number.isFinite(stability) || stability <= 0) return SM20_RETRIEVABILITY_MIN;

  const w0 = weights[0]!;
  const r1 =
    w0 > 0
      ? w0 * Math.pow(stability / (stability + elapsedDays), Math.log(w0 / 0.9) / LN_2)
      : 0;
  const r2 =
    elapsedDays / stability + 1 > 0
      ? Math.pow(elapsedDays / stability + 1, Math.log(0.9) / LN_2)
      : 0;
  const r3 = Math.exp(-0.1053605 * (elapsedDays / stability));

  const sRatio1 = normalizedPairRatio(stability, weights[1]!);
  const c1 = (1 - sRatio1 + normalizedPairRatio(difficulty01, weights[2]!)) / 2;
  const c2 = (1 - sRatio1 + normalizedPairRatio(difficulty01, weights[3]!)) / 2;
  const c3 = normalizedPairRatio(stability, weights[4]!);
  const sum = c1 + c2 + c3;
  if (sum === 0) return 0;
  return clamp((c1 * r1 + c2 * r2 + c3 * r3) / sum, SM20_RETRIEVABILITY_MIN, SM20_RETRIEVABILITY_MAX);
}

/** `0x00cad5a0` (`ComputeGradeWeightedRetentionEstimate`). */
export function updatePa20Difficulty01(
  prevDifficulty01: number,
  stability: number,
  retrievability: number,
  smGrade: number,
  weights: readonly number[] = SM20_PA20_WEIGHTS,
): number {
  const k = normalizedPairRatio(Math.max(0, stability), weights[24]!);
  const outcome = smGrade < 3 ? 0.0 : 1.0;
  const next = k * prevDifficulty01 + (1 - k) * (prevDifficulty01 - (outcome - retrievability));
  return clamp(next, 0.0, 1.0);
}

/** `0x00cad4c0` (`ComputeFailedRecallDifficultyPenalty`). */
export function computePa20FailedStability(
  difficulty01: number,
  prevStability: number,
  retrievability: number,
  weights: readonly number[] = SM20_PA20_WEIGHTS,
): number {
  const d = clamp(Number.isFinite(difficulty01) ? difficulty01 : DEFAULT_DIFFICULTY_01, 0.0, 1.0);
  const s = Math.max(0, Number.isFinite(prevStability) ? prevStability : SM20_STABILITY_MIN);
  const r = clamp(Number.isFinite(retrievability) ? retrievability : 0.9, 0.0, 1.0);
  const termD = (1 - d) * weights[19]! + 1;
  const termS = normalizedPairRatio(s, weights[20]!) * weights[21]! + 1;
  const termR = normalizedPairRatio(1 - r, weights[22]!) * weights[23]!;
  return clamp(termD * termS + termR + 1, SM20_STABILITY_MIN, SM20_STABILITY_MAX);
}

/**
 * `0x00cad6a0` (`ComputeBlendedForgettingCurveRetention`):
 * Exact PA20 post-pass stability formula using `PTR_DAT_011a5bd0 + 0xc8..0x110`.
 */
export function computePa20PassedStability(
  difficulty01: number,
  stability: number,
  retrievability: number,
  expectedIv: number,
  grade: number,
  weights: readonly number[] = SM20_PA20_WEIGHTS,
): number {
  const d = clamp(Number.isFinite(difficulty01) ? difficulty01 : DEFAULT_DIFFICULTY_01, 0.0, 1.0);
  let S = Number.isFinite(stability) ? stability : SM20_STABILITY_MIN;
  const expected = Number.isFinite(expectedIv) ? Math.max(0.0, expectedIv) : 0.0;
  const wC8 = weights[25]!;
  const wD0 = weights[26]!;
  const wD8 = weights[27]!;
  const wE0 = weights[28]!;
  const wE8 = weights[29]!;
  const wF0 = weights[30]!;
  const wF8 = weights[31]!;
  const w100 = weights[32]!;
  const w108 = weights[33]!;
  const w110 = weights[34]!;

  let ratio = 1.0;
  if (expected < S && S > 0) {
    const t = rationalSaturationZeroGuarded(expected / S, wF0);
    ratio = wE0 + wE8 * t;
  }
  S = Math.max(S, expected);
  const powTerm = S > 0 ? Math.pow(S, wF8) : 0.0;
  const expArg = -(w100 * (1.0 - d) + w108) * Math.max(0.0, retrievability);
  const expTerm = Math.exp(clamp(expArg, -SM20_EXP_ARG_CLAMP, SM20_EXP_ARG_CLAMP));
  const gradeFactor = (grade - 4) * w110 + 1.0;
  const blendBase = wD0 + (1.0 - d) * (wC8 - wD0);
  const product =
    S * ratio * (wD8 + (blendBase - wD8) * powTerm * expTerm * gradeFactor);
  return clamp(
    Number.isFinite(product) ? product : SM20_STABILITY_MIN,
    SM20_STABILITY_MIN,
    SM20_STABILITY_MAX,
  );
}

/** `ComputeBlendedForgettingCurveRetention` (`0x00cad6a0`). */
export function computeBlendedForgettingCurveRetention(
  difficulty01: number,
  stability: number,
  elapsedScale: number,
  expectedIv: number,
  grade: number,
): number {
  return computePa20PassedStability(difficulty01, stability, elapsedScale, expectedIv, grade);
}

/**
 * `0x00bc6ff0` (`BlendRetrievabilityWithLapsePrior`):
 * Exact PA19/SM-20 difficulty update (`DAT_00bc71a0 = 0x8000000000000000` sign flip).
 */
export function updateSm20Difficulty01(
  prevDifficulty01: number,
  retrievability: number,
  smGrade: number,
  repNumber: number,
  lapses: number,
): number {
  const prev = clamp(Number.isFinite(prevDifficulty01) ? prevDifficulty01 : DEFAULT_DIFFICULTY_01, 0.0, 1.0);
  const r = clamp(Number.isFinite(retrievability) ? retrievability : 0.9, 0.0, 1.0);
  const pass = smGrade < 3 ? 0.0 : 1.0;
  const target = (r - pass + 0.1) * 9.0;
  let alpha = repNumber === 2 && lapses === 0 ? 0.7 : 0.2;
  if (pass === 1.0 && prev < target) {
    alpha /= 2.0;
  }
  if (pass === 0.0 && target < prev) {
    alpha /= 2.0;
  }
  return clamp(alpha * target + (1.0 - alpha) * prev, 0.0, 1.0);
}

/** `0x00ce0230` (`ComputeForgettingIndexScaledInterval`). */
export function computePostLapseIntervalSm20(
  baseInterval: number,
  forgettingIndexPercent: number,
  jitterUnit = 0,
): number {
  const fi = clamp(forgettingIndexPercent / 100.0, 0.0, 1.0);
  const blend = 1.0 - Math.exp(fi * -5.0);
  const base = baseInterval + blend * (9.0 - baseInterval);
  const jittered = base + base * 0.2 * clamp(jitterUnit, -1.0, 1.0);
  return roundHalfToEven(clamp(jittered, 1.0, 11.0));
}

/** `0x00cfa420` (`ComputeInitialUFactorForDifficultyAndRepetition`). */
export function computeInitialUFactor(difficultyBin1To21: number, repetition: number): number {
  const dBin = clamp(Math.round(difficultyBin1To21), 1, 21);
  const rep = Math.max(1, Math.round(repetition));
  const base = Math.max(1.2, 3.0 - (dBin - 1) * 0.085);
  if (rep === 1) {
    const rEst = clamp((dBin - 1) * -0.057 + 0.91, 0.05, 0.99);
    return Math.max(1.2, 1.0 / (1.0 - rEst * 0.65));
  }
  if (rep === 2) return base;
  return (1.0 / (rep - 1)) * (base - 1.2) + 1.2;
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

/**
 * Closed-form SM-20 item scheduler (`0x00d97fc0` PA19 + PA20 ensemble, `0x00cf3980`,
 * `0x00bc6ff0`, `0x00cad8d0`, `0x00cf29c0`). Accepts 4-point `Grade` or 6-point `SmGrade` (`0..5`).
 */
export function scheduleSm20Item(
  card: StoredCard | null | undefined,
  grade: Grade | SmGrade,
  nowMs: number,
  desiredRetention = 0.9,
  matrix?: Sm20Matrix,
): StoredCard {
  const smGrade = gradeInputToSmGrade(grade);
  const prevReps = Math.max(0, Math.trunc(card?.reps ?? 0));
  const prevLapses = Math.max(0, Math.trunc(card?.lapses ?? 0));
  const prevScheduledDays = Math.max(0, Math.trunc(card?.scheduledDays ?? 0));
  const prevD01 = storedDifficultyTo01(card?.difficulty);

  const clampedRetention = clamp(
    Number.isFinite(desiredRetention) ? desiredRetention : 0.9,
    0.7,
    0.99,
  );
  const fiFactor = Math.log(clampedRetention) / Math.log(0.9);

  let elapsedFloat = 0.0;
  if (prevReps > 0) {
    if (card?.lastReview !== undefined && Number.isFinite(card.lastReview)) {
      elapsedFloat = Math.max(0.0, (nowMs - card.lastReview) / MS_PER_DAY);
    } else if (card?.due !== undefined && Number.isFinite(card.due) && prevScheduledDays > 0) {
      const inferredLastReview = card.due - prevScheduledDays * MS_PER_DAY;
      elapsedFloat = Math.max(0.0, (nowMs - inferredLastReview) / MS_PER_DAY);
    } else {
      elapsedFloat = Math.max(0.0, card?.elapsedDays || prevScheduledDays);
    }
  }
  const elapsedDays = Math.max(0, Math.floor(elapsedFloat));

  if (prevReps === 0) {
    const initD01 = clamp(
      (45 * prevD01 + 25 * computePa20InitialDifficulty01(smGrade)) / 70 +
        (smGrade < 3 ? (2 - smGrade) * 0.02 : (4 - smGrade) * 0.015),
      0.0,
      1.0,
    );
    const initDifficulty = difficulty01ToStored(initD01);
    if (smGrade < 3) {
      const failInitS = smGrade <= 1 ? SM20_STABILITY_MIN : 1.0;
      return {
        due: nowMs + MS_PER_DAY,
        stability: failInitS,
        difficulty: initDifficulty,
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
    const gradeScale = smGrade === 3 ? 0.6 : smGrade === 5 ? 1.3 : 1.0;
    const pa19InitS = clamp(priorSinc * gradeScale, SM20_STABILITY_MIN, SM20_STABILITY_MAX);
    const pa20InitS = clamp(computePa20InitialStability(smGrade), SM20_STABILITY_MIN, SM20_STABILITY_MAX);
    const cellHasCases =
      matrix !== undefined &&
      matrix.sincCases[
        (difficulty01ToIndex20(prevD01) - 1) * 441 +
          (stabilityToIndex20(2.0) - 1) * 21 +
          (retrievabilityToIndex20(SM20_RETRIEVABILITY_MAX) - 1)
      ]! > 0;
    const pa20W = cellHasCases ? 0.15 : 25 / 70;
    const nextStability = clamp(
      (1 - pa20W) * pa19InitS + pa20W * Math.min(pa19InitS * 2.5, pa20InitS),
      SM20_STABILITY_MIN,
      SM20_STABILITY_MAX,
    );
    const rawIv = clamp(nextStability * fiFactor, SM20_STABILITY_MIN, SM20_STABILITY_MAX);
    const scheduledDays = clamp(roundHalfToEven(rawIv), 1, SM20_MAX_INTERVAL_DAYS);
    return {
      due: nowMs + scheduledDays * MS_PER_DAY,
      stability: nextStability,
      difficulty: initDifficulty,
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
  const nextRepNumber = prevReps + 1;
  const dIdx = difficulty01ToIndex20(prevD01);
  const sIdx = stabilityToIndex20(prevS);
  const analyticalR = computeSm20Retrievability(elapsedFloat, prevS);
  const retrievability = matrix
    ? calibrateSm20Retrievability(matrix, dIdx, sIdx, analyticalR)
    : analyticalR;
  const rPa20 = evaluatePa20TripleRetrievability(Math.max(1e-5, elapsedFloat), prevS, prevD01);

  // Exact 0x00bc6ff0 + 0x00cad5a0 difficulty update with bounded per-review step
  const dPa19 = updateSm20Difficulty01(prevD01, retrievability, smGrade, nextRepNumber, prevLapses);
  const dPa20 = updatePa20Difficulty01(prevD01, prevS, rPa20, smGrade);
  const gradeNudge = smGrade < 3 ? (2 - smGrade) * 0.015 : (4 - smGrade) * 0.012;
  const rawBlendedD = (45 * dPa19 + 25 * dPa20) / 70 + gradeNudge;
  const nextD01 = clamp(
    smGrade < 3
      ? Math.max(prevD01 + 0.01, Math.min(prevD01 + 0.18, rawBlendedD))
      : smGrade === 3
        ? clamp(prevD01 * 0.85 + rawBlendedD * 0.15 + 0.005, 0.0, 1.0)
        : Math.min(prevD01, Math.max(prevD01 - 0.12, rawBlendedD)),
    0.0,
    1.0,
  );
  const nextDifficulty = difficulty01ToStored(nextD01);

  if (smGrade < 3) {
    const basePostLapseS = computePostLapseStability(prevS, prevLapses + 1, prevD01);
    const failGradeScale = smGrade === 0 ? 0.9 : smGrade === 1 ? 1.0 : 1.12;
    const postLapseStability = clamp(
      Math.min(2.0, basePostLapseS * failGradeScale),
      SM20_STABILITY_MIN,
      2.0,
    );
    const scheduledDays =
      smGrade <= 1
        ? 1
        : clamp(
            Math.min(2, computePostLapseIntervalSm20(postLapseStability, (1 - clampedRetention) * 100)),
            1,
            2,
          );
    return {
      due: nowMs + scheduledDays * MS_PER_DAY,
      stability: postLapseStability,
      difficulty: nextDifficulty,
      elapsedDays,
      scheduledDays,
      reps: nextRepNumber,
      lapses: prevLapses + 1,
      state: 3,
      learningSteps: 0,
      lastReview: nowMs,
    };
  }

  const sincRaw = Math.max(1.05, lookupBlendedSinc(matrix, prevD01, prevS, retrievability));
  const pa19NextS = computePostReviewStability(
    prevS,
    sincRaw,
    elapsedFloat,
    smGrade,
    retrievability,
    clampedRetention,
  );

  // PA20 analytical stability (0x00cad6a0), damped on early reviews (elapsedFloat < prevS)
  const rawPa20S = computePa20PassedStability(
    prevD01,
    prevS,
    rPa20,
    Math.max(1e-5, elapsedFloat),
    smGrade,
  );
  const isEarlyReview = elapsedFloat < prevS && retrievability > clampedRetention;
  const earlyScale = isEarlyReview
    ? clamp((1.0 - retrievability) / Math.max(1e-6, 1.0 - clampedRetention), 0.0, 1.0)
    : 1.0;
  const pa20NextS = clamp(
    prevS + (rawPa20S - prevS) * earlyScale,
    SM20_STABILITY_MIN,
    SM20_STABILITY_MAX,
  );

  const rIdx = retrievabilityToIndex20(retrievability);
  const cellCases = matrix
    ? matrix.sincCases[(dIdx - 1) * 441 + (sIdx - 1) * 21 + (rIdx - 1)]!
    : 0;
  const pa20Weight = cellCases > 0 ? (25 / 70) * (10 / (10 + cellCases)) : 25 / 70;
  const nextStability = clamp(
    (1 - pa20Weight) * pa19NextS + pa20Weight * pa20NextS,
    SM20_STABILITY_MIN,
    SM20_STABILITY_MAX,
  );

  const rawIv = clamp(nextStability * fiFactor, SM20_STABILITY_MIN, SM20_STABILITY_MAX);
  const candidateIv = clamp(roundHalfToEven(rawIv), 1, SM20_MAX_INTERVAL_DAYS);
  const prevIv = Math.max(1, prevScheduledDays || roundHalfToEven(prevS));
  const scheduledDays = isEarlyReview
    ? candidateIv
    : enforceMinimumIntervalGrowthFactor(prevIv, candidateIv, nextRepNumber);

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
