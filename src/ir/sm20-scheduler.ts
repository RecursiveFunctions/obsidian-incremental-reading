import { schedule, storedToCard, type Grade } from "../fsrs";
import type { StoredCard } from "./model";
import {
  rationalSaturationZeroGuarded,
  roundHalfToEven,
  SM20_MAX_INTERVAL_DAYS,
} from "../sm18-ir-mechanics";
import {
  calibrateSm20Retrievability,
  computePostLapseStability,
  computeSm19MatrixOutcomeStability,
  lookupBlendedSinc,
  lookupFirstIntervalFactor,
  lookupForgettingCurveRetention,
  resolveEffectiveArenaWeights,
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

/**
 * 5-algorithm "Algorithm Arena" weights (`0x00cf2b80` / `TDatabase.ReadDatabaseConfiguration` `0x00d8b990`):
 * - `sm2`: `PTR_DAT_011a44f8` (`0x4018000000000000` = `6.0`)
 * - `sm15`: `PTR_DAT_011a2e00` (`0x402c000000000000` = `14.0`)
 * - `sm19`: `PTR_DAT_011a2a40` (`0x4046800000000000` = `45.0`)
 * - `sm20`: `PTR_DAT_011a4998` (`0x4039000000000000` = `25.0`)
 * - `fsrs`: `PTR_DAT_011a5230` (`0x4024000000000000` = `10.0`)
 */
export interface Sm20ArenaWeights {
  sm2: number;
  sm15: number;
  sm19: number;
  sm20: number;
  fsrs: number;
}

export const DEFAULT_SM20_ARENA_WEIGHTS: Readonly<Sm20ArenaWeights> = Object.freeze({
  sm2: 6,
  sm15: 14,
  sm19: 45,
  sm20: 25,
  fsrs: 10,
});

export interface Sm20ScheduleOptions {
  requestRetention?: number;
  matrix?: Sm20Matrix;
  arenaWeights?: Sm20ArenaWeights;
  autoAdaptArena?: boolean;
  /**
   * 32-bit unsigned seed for `0x00cf2f30` (`DisperseIntervalWithRandomJitter`),
   * e.g. from `hashSm20DispersionSeed(elementId, reps, lapses, smGrade, undoRollCount)`.
   * Pass `null` or omit when evaluating pure un-jittered curves.
   */
  dispersionSeed?: number | null;
}

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
 * (`0x0115f4d0`, offsets `+0x000 .. +0x110`) consumed by `0x00ce4810` (`Algorithm SM-20`).
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

/** `0x00cad380` / `0x00ce4520` — SM-20 initial stability slot by grade `0..5`. */
export function computePa20InitialStability(
  smGrade: number,
  weights: readonly number[] = SM20_PA20_WEIGHTS,
): number {
  const g = Math.trunc(smGrade);
  if (g >= 0 && g <= 5) return weights[6 + g]!;
  return weights[5]!;
}

/** `0x00cad420` — SM-20 initial difficulty `[0, 1]` slot by grade `0..5`. */
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

/** `0x00cad6a0` (`ComputeBlendedForgettingCurveRetention`). */
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

/** `0x00bc6ff0` (`BlendRetrievabilityWithLapsePrior`). */
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

/** `0x00ce0230` (`ComputeForgettingIndexScaledInterval`) — post-lapse rep-1 recovery (`1..11` days). */
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

/** `TDatabase.GetDSR` (`0x00d912e0`), `FUN_00fc7b70` (`0x00fc7b70`). */
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
  const cleanIdx = clamp(Math.trunc(Number.isFinite(dIdx) ? dIdx : 10), 1, 21);
  return Math.log(cleanIdx) / Math.log(20.0);
}

/** `FUN_00cf4ff0` (`0x00cf4ff0`). */
export function repetitionIndexToFraction19(rIdx: number): number {
  const cleanIdx = clamp(Math.trunc(Number.isFinite(rIdx) ? rIdx : 1), 1, 21);
  return clamp((cleanIdx - 1) / 19.0, 0.0, 1.0);
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
  const cleanIdx = clamp(Math.trunc(Number.isFinite(sIdx) ? sIdx : 1), 1, 21);
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

/**
 * Exact `0x00cdeb50` (`ComputeInitialStabilityIncreaseEstimate`, `ghidra:8e7f11cfa51902ac`)
 * verified to `1e-12` against `ABC of SuperMemo 20/alg17/StabilityIncrease.dat` (`alg17.md:75-78`).
 */
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

/**
 * Avalanche hash (Murmur3 / SplitMix32) producing a deterministic 32-bit seed for
 * `0x00cf2f30` interval dispersion from `(elementId, reps, lapses, smGrade, undoRollCount)`.
 */
export function hashSm20DispersionSeed(
  elementId: string,
  reps: number,
  lapses: number,
  smGrade: number,
  undoRollCount = 0,
): number {
  let h = 0x811c9dc5;
  const key = `${elementId}|${Math.trunc(reps)}|${Math.trunc(lapses)}|${Math.trunc(smGrade)}|${Math.trunc(undoRollCount)}`;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

function splitMix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    z = (z ^ (z >>> 16)) >>> 0;
    return z / 4294967296;
  };
}

/**
 * `0x00cf2f30` (`DisperseIntervalWithRandomJitter`, `ghidra:5bb05c29861270b8`):
 * Asymmetric interval dispersion (`+3.0 * dVar2 * u3^1.6` vs `-0.76 * dVar1 * u3^1.6`
 * around `0.5`) driven by deterministic SplitMix32 draws so sibling clozes disperse
 * across neighboring days while button previews match committed due dates.
 */
export function disperseIntervalSm20(rawInterval: number, seed: number): number {
  if (!Number.isFinite(rawInterval) || rawInterval <= 0) return SM20_STABILITY_MIN;
  const rng = splitMix32(seed >>> 0);
  const u1 = rng();
  const u2 = rng();
  const u3 = rng();
  const u4 = rng();
  const ivlScale = Math.pow(Math.max(1.0, rawInterval), -0.22);
  const dVar1 = ivlScale * (0.35 + 0.65 * u1);
  const dVar2 = ivlScale * (0.35 + 0.65 * u2);
  const dVar4 = Math.pow(u3, 1.6); // 0x3ff999999999999a
  const signed = u4 <= 0.5 ? dVar2 * 3.0 : -(dVar1 * 0.76);
  return Math.max(SM20_STABILITY_MIN, rawInterval + signed * dVar4 * rawInterval);
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

export interface Sm20ArenaOutcomeResult {
  sm2Interval: number;
  sm15Interval: number;
  sm19Stability: number;
  sm20Stability: number;
  fsrsStability: number;
  weightedStability: number;
  predictions: {
    sm2: number;
    sm15: number;
    sm19: number;
    sm20: number;
    fsrs: number;
  };
  nextDifficulty01: number;
}

/**
 * `TDatabase.AlgorithmOutcomes` (`0x00d97fc0`) -> `ComputeWeightedAlgorithmStability` (`0x00cf2b80`):
 * Evaluates all 5 Algorithm Arena competitors concurrently (`SM-2` `0x00d4f550`, `SM-15` `0x00d01fc0`,
 * `SM-19` `0x00ce7880`, `SM-20` `0x00ce4810`, `FSRS` `0x00ce3ec0`) and computes their weighted stability.
 */
export function computeSm20ArenaOutcomes(input: {
  card: StoredCard | null | undefined;
  smGrade: SmGrade;
  nowMs: number;
  requestRetention?: number;
  matrix?: Sm20Matrix;
  arenaWeights?: Sm20ArenaWeights;
  autoAdaptArena?: boolean;
}): Sm20ArenaOutcomeResult {
  const { card, smGrade, nowMs, matrix } = input;
  const clampedRetention = clamp(
    Number.isFinite(input.requestRetention) ? input.requestRetention! : 0.9,
    0.7,
    0.99,
  );
  const prevReps = Math.max(0, Math.trunc(card?.reps ?? 0));
  const prevLapses = Math.max(0, Math.trunc(card?.lapses ?? 0));
  const prevScheduledDays = Math.max(0, Math.trunc(card?.scheduledDays ?? 0));
  const isPostLapseRelearn = card?.state === 3;
  const prevD01 = storedDifficultyTo01(card?.difficulty);

  let elapsedFloat = 0.0;
  if (prevReps > 0 || isPostLapseRelearn) {
    if (card?.lastReview !== undefined && Number.isFinite(card.lastReview)) {
      elapsedFloat = Math.max(1.1574074074074073e-5, (nowMs - card.lastReview) / MS_PER_DAY);
    } else if (card?.due !== undefined && Number.isFinite(card.due) && prevScheduledDays > 0) {
      const inferredLastReview = card.due - prevScheduledDays * MS_PER_DAY;
      elapsedFloat = Math.max(1.1574074074074073e-5, (nowMs - inferredLastReview) / MS_PER_DAY);
    } else {
      elapsedFloat = Math.max(1.1574074074074073e-5, card?.elapsedDays || prevScheduledDays || 1);
    }
  }

  const prevS = clamp(
    card && Number.isFinite(card.stability) && card.stability > 0
      ? card.stability
      : Math.max(1.0, prevScheduledDays || 1),
    SM20_STABILITY_MIN,
    SM20_STABILITY_MAX,
  );

  const weights = resolveEffectiveArenaWeights(
    matrix,
    input.arenaWeights ?? DEFAULT_SM20_ARENA_WEIGHTS,
    input.autoAdaptArena ?? true,
  );
  const weightSum = weights.sm2 + weights.sm15 + weights.sm19 + weights.sm20 + weights.fsrs;

  // --- 1. SM-2 (`0x00d4f550`, slot +0x73) ---
  const initEf =
    prevReps < 3
      ? clamp(2.5 - prevD01 * 1.2, 1.3, 2.5)
      : clamp(
          Math.pow(Math.max(1, prevScheduledDays) / 6.0, 1.0 / Math.max(1, prevReps - 2)),
          1.3,
          2.5,
        );
  const qDiff = 5 - smGrade;
  const nextEf = clamp(initEf + (0.1 - qDiff * (0.08 + qDiff * 0.02)), 1.3, 2.5);
  const sm2PredR = prevReps === 0 ? 0.9 : computeSm20Retrievability(elapsedFloat, Math.max(1, prevScheduledDays));
  const sm2Interval =
    smGrade < 3
      ? 1
      : prevReps === 0 || isPostLapseRelearn
        ? 1
        : prevReps === 1
          ? 6
          : clamp(roundHalfToEven(Math.max(1, prevScheduledDays) * nextEf), 1, SM20_MAX_INTERVAL_DAYS);

  // --- 2. SM-15 (`0x00d01fc0`, slot +0x77) ---
  const sm15AFactor = clamp(6.9 - 5.7 * prevD01, 1.2, 6.9);
  const sm15PredR =
    prevReps === 0
      ? 0.9
      : computeSm20Retrievability(elapsedFloat, Math.max(SM20_STABILITY_MIN, prevS * 0.95));
  const sm15GradeMult = smGrade === 3 ? 0.72 : smGrade === 5 ? 1.22 : 1.0;
  const sm15Interval =
    smGrade < 3
      ? 1
      : prevReps === 0 || isPostLapseRelearn
        ? clamp(roundHalfToEven(computeInitialUFactor(difficulty01ToIndex20(prevD01), 1)), 1, 15)
        : clamp(
            roundHalfToEven(
              Math.max(1, prevScheduledDays || prevS) *
                sm15AFactor *
                sm15GradeMult *
                Math.pow(Math.max(0.25, elapsedFloat / Math.max(1, prevScheduledDays || prevS)), 0.25),
            ),
            1,
            SM20_MAX_INTERVAL_DAYS,
          );

  // --- 3. SM-19 (`0x00ce7880` -> `0x00ce6470` / `0x00ce66e0`, slot +0x7b) ---
  const dIdx = difficulty01ToIndex20(prevD01);
  const sIdx = stabilityToIndex20(prevS);
  const analyticalR = prevReps === 0 ? SM20_RETRIEVABILITY_MAX : computeSm20Retrievability(elapsedFloat, prevS);
  const fcRet =
    prevReps === 1 && prevLapses === 0 && matrix
      ? lookupForgettingCurveRetention(matrix, elapsedFloat)
      : analyticalR;
  const calibratedR = matrix
    ? calibrateSm20Retrievability(matrix, dIdx, sIdx, (analyticalR + fcRet) * 0.5)
    : analyticalR;

  let sm19Stability: number;
  if (smGrade < 3) {
    const baseFailS = computePostLapseStability(prevS, prevLapses + 1, prevD01);
    sm19Stability = clamp(baseFailS * (smGrade === 0 ? 0.85 : smGrade === 1 ? 1.0 : 1.15), SM20_STABILITY_MIN, 4.0);
  } else if (isPostLapseRelearn) {
    const fiFactor = lookupFirstIntervalFactor(matrix, dIdx, Math.max(1, prevLapses), clampedRetention);
    const gScale = smGrade === 3 ? 0.8 : smGrade === 5 ? 1.25 : 1.0;
    sm19Stability = clamp(fiFactor * gScale, SM20_STABILITY_MIN, 15.0);
  } else if (prevReps === 0) {
    const priorSinc = lookupBlendedSinc(matrix, prevD01, 2.0, SM20_RETRIEVABILITY_MAX);
    const gScale = smGrade === 3 ? 0.65 : smGrade === 5 ? 1.35 : 1.0;
    sm19Stability = clamp(priorSinc * gScale, SM20_STABILITY_MIN, 365.0);
  } else {
    sm19Stability = computeSm19MatrixOutcomeStability({
      matrix,
      prevD01,
      prevS,
      elapsedDays: elapsedFloat,
      retrievability: calibratedR,
      smGrade,
      prevLapses,
      desiredRetention: clampedRetention,
    });
  }

  // --- 4. SM-20 (`0x00ce45d0` -> `0x00ce4810`, 35-weight ML model, slot +0x83) ---
  const sm20PredR =
    prevReps === 0
      ? SM20_RETRIEVABILITY_MAX
      : evaluatePa20TripleRetrievability(elapsedFloat, prevS, prevD01);
  let sm20Stability: number;
  if (smGrade < 3) {
    sm20Stability =
      prevReps === 0
        ? clamp(computePa20InitialStability(smGrade), SM20_STABILITY_MIN, 4.0)
        : clamp(computePa20FailedStability(prevD01, prevS, sm20PredR), SM20_STABILITY_MIN, 6.0);
  } else if (prevReps === 0) {
    sm20Stability = clamp(computePa20InitialStability(smGrade), SM20_STABILITY_MIN, 365.0);
  } else {
    const rawSm20S = computePa20PassedStability(prevD01, prevS, sm20PredR, elapsedFloat, smGrade);
    const isEarly = elapsedFloat < prevS && calibratedR > clampedRetention;
    const earlyScale = isEarly
      ? clamp((1.0 - calibratedR) / Math.max(1e-6, 1.0 - clampedRetention), 0.0, 1.0)
      : 1.0;
    sm20Stability = clamp(prevS + (rawSm20S - prevS) * earlyScale, SM20_STABILITY_MIN, SM20_STABILITY_MAX);
  }

  // --- 5. FSRS (`0x00ce3cf0` -> `0x00ce3ec0`, slot +0x8b) ---
  const fsrsGrade = smGradeToFsrsGrade(smGrade);
  const normalizedCardForFsrs =
    card && card.lastReview === undefined && (prevReps > 0 || isPostLapseRelearn)
      ? { ...card, lastReview: nowMs - elapsedFloat * MS_PER_DAY }
      : (card ?? undefined);
  const fsrsCard = schedule(storedToCard(normalizedCardForFsrs), fsrsGrade, new Date(nowMs), 0.9);
  const rawFsrsS = clamp(
    Number.isFinite(fsrsCard.stability) && fsrsCard.stability > 0 ? fsrsCard.stability : sm19Stability,
    SM20_STABILITY_MIN,
    SM20_STABILITY_MAX,
  );
  const fsrsPredR =
    prevReps === 0
      ? SM20_RETRIEVABILITY_MAX
      : Math.pow(1 + (19 / 81) * (elapsedFloat / Math.max(SM20_STABILITY_MIN, prevS)), -0.5);

  // Damp all 5 Arena candidates uniformly on early reviews (`elapsedFloat < prevS`) to prevent cram inflation
  const isEarlyAll = smGrade >= 3 && prevReps > 0 && !isPostLapseRelearn && elapsedFloat < prevS && calibratedR > clampedRetention;
  const earlyDamp = isEarlyAll
    ? clamp((1.0 - calibratedR) / Math.max(1e-6, 1.0 - clampedRetention), 0.0, 1.0)
    : 1.0;
  const dampCandidate = (cand: number): number =>
    isEarlyAll && cand > prevS ? prevS + (cand - prevS) * earlyDamp : cand;

  const effSm2 = prevReps === 0 && smGrade >= 3 ? Math.min(sm2Interval, sm19Stability * 2.5) : dampCandidate(sm2Interval);
  const effSm15 = prevReps === 0 && smGrade >= 3 ? Math.min(sm15Interval, sm19Stability * 2.5) : dampCandidate(sm15Interval);
  const effSm20 = prevReps === 0 && smGrade >= 3 ? Math.min(sm20Stability, sm19Stability * 2.5) : sm20Stability;
  const effFsrs = prevReps === 0 && smGrade >= 3 ? Math.min(rawFsrsS, sm19Stability * 2.5) : dampCandidate(rawFsrsS);

  // --- Exact `0x00cf2b80` 5-algorithm weighted stability ---
  const weightedStability =
    weightSum > 0
      ? clamp(
          (weights.sm2 * effSm2 +
            weights.sm15 * effSm15 +
            weights.sm19 * sm19Stability +
            weights.sm20 * effSm20 +
            weights.fsrs * effFsrs) /
            weightSum,
          SM20_STABILITY_MIN,
          SM20_STABILITY_MAX,
        )
      : sm19Stability;

  // --- Difficulty update (`0x00bc6ff0` SM-19 + `0x00cad5a0` SM-20 weighted by Arena share) ---
  let nextDifficulty01: number;
  if (prevReps === 0 && !isPostLapseRelearn) {
    const d20Init = computePa20InitialDifficulty01(smGrade);
    const d19Init = smGrade < 3 ? 0.68 : smGrade === 3 ? 0.52 : smGrade === 4 ? 0.35 : 0.22;
    const w19 = weights.sm19 + weights.sm15 + weights.sm2;
    const w20 = weights.sm20 + weights.fsrs;
    nextDifficulty01 = clamp(
      w19 + w20 > 0 ? (w19 * d19Init + w20 * d20Init) / (w19 + w20) : d19Init,
      0.0,
      1.0,
    );
  } else {
    const d19 = updateSm20Difficulty01(prevD01, calibratedR, smGrade, prevReps + 1, prevLapses);
    const d20 = updatePa20Difficulty01(prevD01, prevS, sm20PredR, smGrade);
    const w19 = weights.sm19 + weights.sm15 + weights.sm2;
    const w20 = weights.sm20 + weights.fsrs;
    nextDifficulty01 = clamp(
      w19 + w20 > 0 ? (w19 * d19 + w20 * d20) / (w19 + w20) : d19,
      0.0,
      1.0,
    );
  }

  return {
    sm2Interval,
    sm15Interval,
    sm19Stability,
    sm20Stability,
    fsrsStability: rawFsrsS,
    weightedStability,
    predictions: {
      sm2: clamp(sm2PredR, SM20_RETRIEVABILITY_MIN, SM20_RETRIEVABILITY_MAX),
      sm15: clamp(sm15PredR, SM20_RETRIEVABILITY_MIN, SM20_RETRIEVABILITY_MAX),
      sm19: clamp(calibratedR, SM20_RETRIEVABILITY_MIN, SM20_RETRIEVABILITY_MAX),
      sm20: clamp(sm20PredR, SM20_RETRIEVABILITY_MIN, SM20_RETRIEVABILITY_MAX),
      fsrs: clamp(fsrsPredR, SM20_RETRIEVABILITY_MIN, SM20_RETRIEVABILITY_MAX),
    },
    nextDifficulty01,
  };
}

/**
 * Full SM-20 item scheduler (`TDatabase.AlgorithmOutcomes` `0x00d97fc0` ->
 * `ComputeWeightedAlgorithmStability` `0x00cf2b80` -> `ComputeAlgorithmOutcomeIntervalAndUFactor` `0x00cf3980`).
 *
 * Accepts 4-point `Grade` or 6-point `SmGrade` (`0..5`), and either a numeric
 * `desiredRetention` or a full `Sm20ScheduleOptions` bag.
 */
export function scheduleSm20Item(
  card: StoredCard | null | undefined,
  grade: Grade | SmGrade,
  nowMs: number,
  desiredRetentionOrOpts: number | Sm20ScheduleOptions = 0.9,
  maybeMatrix?: Sm20Matrix,
): StoredCard {
  const opts: Sm20ScheduleOptions =
    typeof desiredRetentionOrOpts === "number"
      ? { requestRetention: desiredRetentionOrOpts, matrix: maybeMatrix }
      : desiredRetentionOrOpts;

  const smGrade = gradeInputToSmGrade(grade);
  const prevReps = Math.max(0, Math.trunc(card?.reps ?? 0));
  const prevLapses = Math.max(0, Math.trunc(card?.lapses ?? 0));
  const prevScheduledDays = Math.max(0, Math.trunc(card?.scheduledDays ?? 0));
  const isPostLapseRelearn = card?.state === 3;

  const clampedRetention = clamp(
    Number.isFinite(opts.requestRetention) ? opts.requestRetention! : 0.9,
    0.7,
    0.99,
  );
  // 0x00cf3980: ln(1 - FI/100) / ln(0.9)
  const fiFactor = Math.log(clampedRetention) / Math.log(0.9);
  const fiPercent = (1.0 - clampedRetention) * 100.0;

  let elapsedFloat = 0.0;
  if (prevReps > 0 || isPostLapseRelearn) {
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

  const arena = computeSm20ArenaOutcomes({
    card,
    smGrade,
    nowMs,
    requestRetention: clampedRetention,
    matrix: opts.matrix,
    arenaWeights: opts.arenaWeights,
    autoAdaptArena: opts.autoAdaptArena,
  });
  const nextDifficulty = difficulty01ToStored(arena.nextDifficulty01);

  // Failing grade (`0..2`): increment lapses, enter post-lapse relearning (`state = 3`), schedule 1 day
  if (smGrade < 3) {
    const prevS = clamp(
      card && Number.isFinite(card.stability) && card.stability > 0
        ? card.stability
        : SM20_STABILITY_MIN,
      SM20_STABILITY_MIN,
      SM20_STABILITY_MAX,
    );
    const basePostLapseS = computePostLapseStability(prevS, prevLapses + 1, storedDifficultyTo01(card?.difficulty));
    const failGradeScale = smGrade === 0 ? 0.85 : smGrade === 1 ? 1.0 : 1.15;
    const postLapseStability = clamp(
      prevReps === 0 && !isPostLapseRelearn
        ? smGrade <= 1
          ? SM20_STABILITY_MIN
          : 0.9
        : Math.min(2.0, basePostLapseS * failGradeScale),
      SM20_STABILITY_MIN,
      2.0,
    );
    return {
      due: nowMs + MS_PER_DAY,
      stability: postLapseStability,
      difficulty: nextDifficulty,
      elapsedDays,
      scheduledDays: 1,
      reps: prevReps === 0 ? 1 : prevReps + 1,
      lapses: prevLapses + 1,
      state: prevReps === 0 && !isPostLapseRelearn ? 1 : 3,
      learningSteps: 0,
      lastReview: nowMs,
    };
  }

  // Passing grade (`3..5`) -> `0x00cf3980` (`ComputeAlgorithmOutcomeIntervalAndUFactor`)
  const nextStability = clamp(arena.weightedStability, SM20_STABILITY_MIN, SM20_STABILITY_MAX);
  const scaledIv = nextStability * fiFactor; // param_1 + 0xa3

  let usedIvFloat: number; // param_1 + 0xab
  const isPostLapseRep1 = isPostLapseRelearn || (prevLapses > 0 && prevReps === 0);
  if (isPostLapseRep1) {
    // Exact `0x00cf3980` branch: `*(short *)(param_1 + 0xb9) != 0 && *(short *)(param_1 + 0xb7) == 1` -> `FUN_00ce0230`
    const jitterUnit =
      typeof opts.dispersionSeed === "number"
        ? splitMix32(opts.dispersionSeed)() * 2.0 - 1.0
        : 0.0;
    const ce0230Iv = computePostLapseIntervalSm20(scaledIv, fiPercent, jitterUnit);
    const fiLearned = opts.matrix
      ? lookupFirstIntervalFactor(
          opts.matrix,
          difficulty01ToIndex20(storedDifficultyTo01(card?.difficulty)),
          prevLapses,
          clampedRetention,
        )
      : ce0230Iv;
    usedIvFloat = (ce0230Iv + fiLearned) * 0.5;
  } else if (typeof opts.dispersionSeed === "number") {
    usedIvFloat = disperseIntervalSm20(scaledIv, opts.dispersionSeed);
  } else {
    usedIvFloat = scaledIv;
  }

  const clampedIvFloat = clamp(usedIvFloat, SM20_STABILITY_MIN, SM20_STABILITY_MAX);
  const roundedCandidate = clamp(roundHalfToEven(clampedIvFloat), 1, SM20_MAX_INTERVAL_DAYS);

  const prevS = card?.stability ?? 0;
  const isEarlyReview = prevReps > 0 && elapsedFloat < prevS && arena.predictions.sm19 > clampedRetention;
  const streakRepCount = isPostLapseRep1 ? 1 : prevReps + 1;
  const prevIv = Math.max(1, prevScheduledDays || roundHalfToEven(Math.max(1, prevS)));
  const scheduledDays =
    streakRepCount > 1 && !isEarlyReview
      ? enforceMinimumIntervalGrowthFactor(prevIv, roundedCandidate, streakRepCount)
      : roundedCandidate;

  return {
    due: nowMs + scheduledDays * MS_PER_DAY,
    stability: nextStability,
    difficulty: nextDifficulty,
    elapsedDays,
    scheduledDays,
    reps: prevReps + 1,
    lapses: prevLapses,
    state: 2,
    learningSteps: 0,
    lastReview: nowMs,
  };
}
