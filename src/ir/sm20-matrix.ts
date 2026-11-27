import type { Grade } from "../fsrs";
import { rationalSaturationZeroGuarded, roundHalfToEven } from "../sm18-ir-mechanics";
import type { ElementId } from "./ids";
import type { IrElement, IrEvent, StoredCard } from "./model";
import {
  DEFAULT_SM20_ARENA_WEIGHTS,
  computeInitialSincPrior,
  computeSm20ArenaOutcomes,
  computeSm20Retrievability,
  difficulty01ToIndex20,
  scheduleSm20Item,
  SM20_RETRIEVABILITY_MAX,
  SM20_RETRIEVABILITY_MIN,
  SM20_STABILITY_MAX,
  SM20_STABILITY_MIN,
  stabilityIndex20ToTransformed,
  stabilityToIndex20,
  storedDifficultyTo01,
  updateSm20Difficulty01,
  type Sm20ArenaWeights,
  type SmGrade,
} from "./sm20-scheduler";

export const SM20_MATRIX_SCHEMA_VERSION = 4;
export const SM20_MATRIX_DIM = 21;
export const SM20_MATRIX_STRIDE_D = 441; // 0x1b9
export const SM20_MATRIX_STRIDE_S = 21; // 0x15
export const SM20_MATRIX_CELLS = 9261; // 21 * 21 * 21
export const SM20_SINC_DAT_BYTES = SM20_MATRIX_CELLS * 8; // 0x12168 = 74,088 B
export const SM20_CASES_DAT_BYTES = SM20_MATRIX_CELLS * 4; // 0x90b4 = 37,044 B

/** `FirstInterval.dat` (`0x00bc7fb0`): two 21×21×36 uint32 records (`0xf810` = 63,504 B each). */
export const SM20_FIRST_INTERVAL_CELLS = 21 * 21 * 36; // 15,876
export const SM20_FIRST_INTERVAL_RECORD_BYTES = SM20_FIRST_INTERVAL_CELLS * 4; // 0xf810 = 63,504 B

/** `ForgettingCurve.dat` (`0x00bc7280`): two 36-bin uint32 records (`0x90` = 144 B each). */
export const SM20_FORGETTING_CURVE_BINS = 36;
export const SM20_FORGETTING_CURVE_RECORD_BYTES = SM20_FORGETTING_CURVE_BINS * 4; // 0x90 = 144 B

/**
 * `Retrievability.dat` (`0x00bc91c0` / `0x00cc69e0`, `alg17.md:121-146`):
 * - Half A (`PTR_DAT_011a3fa0`): `76 × 30 = 2,280` `int32` case counts (`0x23a0` = 9,120 B)
 * - Half B (`PTR_DAT_011a4880`): `38 × 30 = 1,140` `float64` recall sums (`0x23a0` = 9,120 B)
 */
export const SM20_RETRIEVABILITY_CASES_ROWS = 76;
export const SM20_RETRIEVABILITY_SUMS_ROWS = 38;
export const SM20_RETRIEVABILITY_ROWS = 38;
export const SM20_RETRIEVABILITY_BINS = 30;
export const SM20_RETRIEVABILITY_CASES_CELLS =
  SM20_RETRIEVABILITY_CASES_ROWS * SM20_RETRIEVABILITY_BINS; // 2,280 int32
export const SM20_RETRIEVABILITY_CELLS =
  SM20_RETRIEVABILITY_SUMS_ROWS * SM20_RETRIEVABILITY_BINS; // 1,140 float64
export const SM20_RETRIEVABILITY_RECORD_BYTES = SM20_RETRIEVABILITY_CELLS * 8; // 0x23a0 = 9,120 B

/** `DifficultyDistribution.dat` (`0x00bc8380`): 20 uint32 difficulty bin counts (`0x50` = 80 B). */
export const SM20_DIFFICULTY_BINS = 20;
export const SM20_DIFFICULTY_DIST_DAT_BYTES = SM20_DIFFICULTY_BINS * 4; // 0x50 = 80 B

export interface Sm20Matrix {
  sinc: Float64Array;
  sincCases: Uint32Array;
  recall: Uint32Array;
  recallCases: Uint32Array;
  /** Post-lapse first-interval pass counts (`21 × 21 × 36`). */
  firstIntervalSuccess: Uint32Array;
  /** Post-lapse first-interval total counts (`21 × 21 × 36`). */
  firstIntervalCases: Uint32Array;
  /** Rep-1 lapse-0 forgetting-curve pass counts (`36`). */
  forgettingCurveSuccess: Uint32Array;
  /** Rep-1 lapse-0 forgetting-curve total counts (`36`). */
  forgettingCurveCases: Uint32Array;
  /** `Retrievability.dat` Half A: `76 × 30` `int32` case counts (`0x00cc69e0`). */
  retrievabilityCases: Int32Array;
  /** `Retrievability.dat` Half B: `38 × 30` `float64` recall sums (`0x00cc69e0`). */
  retrievabilitySums: Float64Array;
  /** Item count histogram across 20 difficulty bins (`0x00bc8380`). */
  difficultyDistribution: Uint32Array;
  /** Algorithm Arena (`0x00d8b990`) empirical observation count. */
  arenaCases: number;
  /** Algorithm Arena cumulative squared recall error `(predR - win)^2` per competing model. */
  arenaSumSq: Sm20ArenaWeights;
}

export interface Sm20MatrixSnapshot {
  version?: number;
  sinc: number[] | string;
  sincCases: number[] | string;
  recall: number[] | string;
  recallCases: number[] | string;
  firstIntervalSuccess?: number[];
  firstIntervalCases?: number[];
  forgettingCurveSuccess?: number[];
  forgettingCurveCases?: number[];
  retrievabilityCases?: number[];
  retrievabilitySums?: number[];
  /** Legacy v3 fields accepted on read and discarded on v4 snapshot. */
  retrievabilityPredSum?: number[];
  retrievabilityActualSum?: number[];
  difficultyDistribution?: number[];
  arenaCases?: number;
  arenaSumSq?: Partial<Sm20ArenaWeights>;
}

export interface Sm20MatrixStats {
  totalSincCases: number;
  totalRecallCases: number;
  populatedSincCells: number;
  populatedRecallCells: number;
  totalFirstIntervalCases: number;
  totalForgettingCurveCases: number;
  totalCalibrationCases: number;
  totalDifficultyItems: number;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export function matrixIndex(dIdx: number, sIdx: number, rIdx: number): number {
  const d = clamp(Math.trunc(dIdx), 1, 20) - 1;
  const s = clamp(Math.trunc(sIdx), 1, 20) - 1;
  const r = clamp(Math.trunc(rIdx), 1, 20) - 1;
  return d * SM20_MATRIX_STRIDE_D + s * SM20_MATRIX_STRIDE_S + r;
}

/** `0x00ce7570`: `(rIdx - 1) * 756 + (lapseIdx - 1) * 36 + (ivlBin - 1)`. */
export function firstIntervalIndex(rIdx: number, lapseIdx: number, ivlBin: number): number {
  const r = clamp(Math.trunc(rIdx), 1, 21) - 1;
  const l = clamp(Math.trunc(lapseIdx), 1, 21) - 1;
  const b = clamp(Math.trunc(ivlBin), 1, 36) - 1;
  return r * (21 * 36) + l * 36 + b;
}

/**
 * Exact `FUN_00cf5290` (`0x00cf5290`, `ghidra:793e2d1124ff7a10`, `smfmt/scheduler.py:551-557`):
 * Log-1.4 day-to-bin mapping over `1..35` (`b = roundHalfToEven(ln(d)/ln(1.4)) + 12`,
 * `if (d < b) b = d`, clamped `[1, 35]`).
 */
export function elapsedDaysToBin36(elapsedDays: number): number {
  const d = Math.max(1, roundHalfToEven(Math.max(0, Number.isFinite(elapsedDays) ? elapsedDays : 1)));
  let b = roundHalfToEven(Math.log(d) / Math.log(1.4)) + 12;
  if (d < b) b = d;
  return clamp(b, 1, 35);
}

/** Exact `FUN_00cf5320` (`0x00cf5320`, `ghidra:3162a39e38a5661a`): inverse of `elapsedDaysToBin36`. */
export function bin36ToDays(bin: number): number {
  const b = clamp(Math.trunc(Number.isFinite(bin) ? bin : 1), 1, 35);
  if (b <= 16) return b;
  return clamp(roundHalfToEven(Math.pow(1.4, b - 12)), 1, 65535);
}

export function lapsesToIndex21(lapses: number): number {
  const l = Math.max(1, Math.trunc(Number.isFinite(lapses) ? lapses : 1));
  return clamp(l, 1, 21);
}

export function retrievabilityToCalibrationBin30(r: number): number {
  const clean = clamp(Number.isFinite(r) ? r : 0.9, 0.0, 0.999999);
  return clamp(Math.floor(clean * SM20_RETRIEVABILITY_BINS), 0, SM20_RETRIEVABILITY_BINS - 1);
}

/** `FUN_00cf5080` (`0x00cf5080`). */
export function retrievabilityToIndex20(retrievability: number): number {
  const r = clamp(Number.isFinite(retrievability) ? retrievability : 0.9, 0.0, 1.0);
  return clamp(roundHalfToEven(Math.exp(r * Math.log(20.0))), 1, 20);
}

/** `FUN_00cf5200` (`0x00cf5200`) inverse for retrievability axis. */
export function index20ToRetrievabilityAxis(rIdx: number): number {
  const clean = clamp(Math.trunc(Number.isFinite(rIdx) ? rIdx : 1), 1, 21);
  return clamp(Math.log(clean) / Math.log(20.0), 0.0, 1.05);
}

/**
 * Seed an empty SM-20 matrix across all `21 × 21 × 21 = 9,261` cells
 * (`FUN_00cde2d0` `0x00cde2d0` `1..0x15` loop + `FUN_00cdeb50` `0x00cdeb50`).
 */
export function createEmptySm20Matrix(): Sm20Matrix {
  const sinc = new Float64Array(SM20_MATRIX_CELLS);
  const sincCases = new Uint32Array(SM20_MATRIX_CELLS);
  const recall = new Uint32Array(SM20_MATRIX_CELLS);
  const recallCases = new Uint32Array(SM20_MATRIX_CELLS);

  for (let dIdx = 1; dIdx <= 20; dIdx += 1) {
    const d01 = (dIdx - 1) / 19.0;
    for (let sIdx = 1; sIdx <= 20; sIdx += 1) {
      const s = stabilityIndex20ToTransformed(sIdx);
      for (let rIdx = 1; rIdx <= 20; rIdx += 1) {
        const r = index20ToRetrievabilityAxis(rIdx);
        sinc[matrixIndex(dIdx, sIdx, rIdx)] = computeInitialSincPrior(d01, s, r);
      }
    }
  }

  return {
    sinc,
    sincCases,
    recall,
    recallCases,
    firstIntervalSuccess: new Uint32Array(SM20_FIRST_INTERVAL_CELLS),
    firstIntervalCases: new Uint32Array(SM20_FIRST_INTERVAL_CELLS),
    forgettingCurveSuccess: new Uint32Array(SM20_FORGETTING_CURVE_BINS),
    forgettingCurveCases: new Uint32Array(SM20_FORGETTING_CURVE_BINS),
    retrievabilityCases: new Int32Array(SM20_RETRIEVABILITY_CASES_CELLS),
    retrievabilitySums: new Float64Array(SM20_RETRIEVABILITY_CELLS),
    difficultyDistribution: new Uint32Array(SM20_DIFFICULTY_BINS),
    arenaCases: 0,
    arenaSumSq: { sm2: 0, sm15: 0, sm19: 0, sm20: 0, fsrs: 0 },
  };
}

export function cloneSm20Matrix(matrix: Sm20Matrix): Sm20Matrix {
  return {
    sinc: new Float64Array(matrix.sinc),
    sincCases: new Uint32Array(matrix.sincCases),
    recall: new Uint32Array(matrix.recall),
    recallCases: new Uint32Array(matrix.recallCases),
    firstIntervalSuccess: new Uint32Array(matrix.firstIntervalSuccess),
    firstIntervalCases: new Uint32Array(matrix.firstIntervalCases),
    forgettingCurveSuccess: new Uint32Array(matrix.forgettingCurveSuccess),
    forgettingCurveCases: new Uint32Array(matrix.forgettingCurveCases),
    retrievabilityCases: new Int32Array(matrix.retrievabilityCases),
    retrievabilitySums: new Float64Array(matrix.retrievabilitySums),
    difficultyDistribution: new Uint32Array(matrix.difficultyDistribution),
    arenaCases: matrix.arenaCases,
    arenaSumSq: { ...matrix.arenaSumSq },
  };
}

export function snapshotSm20Matrix(matrix: Sm20Matrix): Sm20MatrixSnapshot {
  return {
    version: SM20_MATRIX_SCHEMA_VERSION,
    sinc: Array.from(matrix.sinc),
    sincCases: Array.from(matrix.sincCases),
    recall: Array.from(matrix.recall),
    recallCases: Array.from(matrix.recallCases),
    firstIntervalSuccess: Array.from(matrix.firstIntervalSuccess),
    firstIntervalCases: Array.from(matrix.firstIntervalCases),
    forgettingCurveSuccess: Array.from(matrix.forgettingCurveSuccess),
    forgettingCurveCases: Array.from(matrix.forgettingCurveCases),
    retrievabilityCases: Array.from(matrix.retrievabilityCases),
    retrievabilitySums: Array.from(matrix.retrievabilitySums),
    difficultyDistribution: Array.from(matrix.difficultyDistribution),
    arenaCases: matrix.arenaCases,
    arenaSumSq: { ...matrix.arenaSumSq },
  };
}

export function restoreSm20Matrix(snapshot: Sm20MatrixSnapshot): Sm20Matrix {
  const empty = createEmptySm20Matrix();
  const parseArr = (
    raw: number[] | string | undefined,
    expectedLen: number,
    fallback: ArrayLike<number>,
  ): number[] => {
    if (raw === "") return Array.from(fallback);
    if (!Array.isArray(raw) || raw.length !== expectedLen) {
      throw new Error("Invalid SM-20 matrix snapshot dimensions");
    }
    return raw;
  };

  const rawSinc = parseArr(snapshot.sinc, SM20_MATRIX_CELLS, empty.sinc);
  const sinc = new Float64Array(SM20_MATRIX_CELLS);
  for (let i = 0; i < SM20_MATRIX_CELLS; i += 1) {
    const v = rawSinc[i]!;
    sinc[i] =
      empty.sinc[i] === 0 && v === 0
        ? 0
        : Number.isFinite(v) && v >= 0.5 && v <= 20.0
          ? v
          : empty.sinc[i]!;
  }
  const sanitizeUint = (arr: readonly number[], len: number): Uint32Array => {
    const out = new Uint32Array(len);
    for (let i = 0; i < len; i += 1) {
      const v = arr[i]!;
      out[i] = Number.isFinite(v) && v > 0 ? Math.min(0x7fffffff, Math.floor(v)) : 0;
    }
    return out;
  };
  const sanitizeInt32 = (arr: number[] | undefined, len: number): Int32Array => {
    const out = new Int32Array(len);
    if (!Array.isArray(arr) || arr.length !== len) return out;
    for (let i = 0; i < len; i += 1) {
      const v = arr[i]!;
      out[i] = Number.isFinite(v) && v > 0 ? Math.min(0x7fffffff, Math.floor(v)) : 0;
    }
    return out;
  };
  const sincCases = sanitizeUint(
    parseArr(snapshot.sincCases, SM20_MATRIX_CELLS, empty.sincCases),
    SM20_MATRIX_CELLS,
  );
  const recall = sanitizeUint(
    parseArr(snapshot.recall, SM20_MATRIX_CELLS, empty.recall),
    SM20_MATRIX_CELLS,
  );
  const recallCases = sanitizeUint(
    parseArr(snapshot.recallCases, SM20_MATRIX_CELLS, empty.recallCases),
    SM20_MATRIX_CELLS,
  );

  const optUint32 = (arr: number[] | undefined, len: number): Uint32Array =>
    Array.isArray(arr) && arr.length === len ? sanitizeUint(arr, len) : new Uint32Array(len);
  const optFloat64 = (arr: number[] | undefined, len: number): Float64Array => {
    const out = new Float64Array(len);
    if (!Array.isArray(arr) || arr.length !== len) return out;
    for (let i = 0; i < len; i += 1) {
      const v = arr[i]!;
      out[i] = Number.isFinite(v) && v >= 0 ? Math.min(1e9, v) : 0;
    }
    return out;
  };

  const cleanSq = (v: unknown): number =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(1e9, v) : 0;

  return {
    sinc,
    sincCases,
    recall,
    recallCases,
    firstIntervalSuccess: optUint32(snapshot.firstIntervalSuccess, SM20_FIRST_INTERVAL_CELLS),
    firstIntervalCases: optUint32(snapshot.firstIntervalCases, SM20_FIRST_INTERVAL_CELLS),
    forgettingCurveSuccess: optUint32(snapshot.forgettingCurveSuccess, SM20_FORGETTING_CURVE_BINS),
    forgettingCurveCases: optUint32(snapshot.forgettingCurveCases, SM20_FORGETTING_CURVE_BINS),
    retrievabilityCases: sanitizeInt32(
      snapshot.retrievabilityCases,
      SM20_RETRIEVABILITY_CASES_CELLS,
    ),
    retrievabilitySums: optFloat64(
      snapshot.retrievabilitySums ?? snapshot.retrievabilityActualSum,
      SM20_RETRIEVABILITY_CELLS,
    ),
    difficultyDistribution: optUint32(snapshot.difficultyDistribution, SM20_DIFFICULTY_BINS),
    arenaCases:
      typeof snapshot.arenaCases === "number" &&
      Number.isFinite(snapshot.arenaCases) &&
      snapshot.arenaCases > 0
        ? Math.min(0x7fffffff, Math.floor(snapshot.arenaCases))
        : 0,
    arenaSumSq: {
      sm2: cleanSq(snapshot.arenaSumSq?.sm2),
      sm15: cleanSq(snapshot.arenaSumSq?.sm15),
      sm19: cleanSq(snapshot.arenaSumSq?.sm19),
      sm20: cleanSq(snapshot.arenaSumSq?.sm20),
      fsrs: cleanSq(snapshot.arenaSumSq?.fsrs),
    },
  };
}

export function getSm20MatrixStats(matrix: Sm20Matrix): Sm20MatrixStats {
  let totalSincCases = 0;
  let totalRecallCases = 0;
  let populatedSincCells = 0;
  let populatedRecallCells = 0;
  for (let i = 0; i < SM20_MATRIX_CELLS; i += 1) {
    const sc = matrix.sincCases[i]!;
    const rc = matrix.recallCases[i]!;
    if (sc > 0) {
      totalSincCases += sc;
      populatedSincCells += 1;
    }
    if (rc > 0) {
      totalRecallCases += rc;
      populatedRecallCells += 1;
    }
  }
  let totalFirstIntervalCases = 0;
  for (let i = 0; i < matrix.firstIntervalCases.length; i += 1) {
    totalFirstIntervalCases += matrix.firstIntervalCases[i]!;
  }
  let totalForgettingCurveCases = 0;
  for (let i = 0; i < matrix.forgettingCurveCases.length; i += 1) {
    totalForgettingCurveCases += matrix.forgettingCurveCases[i]!;
  }
  let totalCalibrationCases = 0;
  for (let b = 0; b < SM20_RETRIEVABILITY_BINS; b += 1) {
    totalCalibrationCases += Math.max(0, matrix.retrievabilityCases[b]!);
  }
  let totalDifficultyItems = 0;
  for (let b = 0; b < SM20_DIFFICULTY_BINS; b += 1) {
    totalDifficultyItems += matrix.difficultyDistribution[b]!;
  }
  return {
    totalSincCases,
    totalRecallCases,
    populatedSincCells,
    populatedRecallCells,
    totalFirstIntervalCases,
    totalForgettingCurveCases,
    totalCalibrationCases,
    totalDifficultyItems,
  };
}

export interface Sm20Alg17BinaryFiles {
  sinc: Uint8Array;
  sincCases: Uint8Array;
  recall: Uint8Array;
  recallCases: Uint8Array;
  firstInterval?: Uint8Array;
  forgettingCurve?: Uint8Array;
  retrievability?: Uint8Array;
  difficultyDistribution?: Uint8Array;
}

/**
 * Parse raw SM-18/SM-20 `alg17/*.dat` binary matrices (`0x00bc7660`, `0x00bc8130`,
 * `0x00bc7400`, `0x00bc9340` / `0x00cc69e0`, `0x00bc8380`).
 */
export function parseSm20Alg17DatFiles(files: Sm20Alg17BinaryFiles): Sm20Matrix {
  if (files.sinc.byteLength !== SM20_SINC_DAT_BYTES) {
    throw new Error(`StabilityIncrease.dat must be ${SM20_SINC_DAT_BYTES} bytes, got ${files.sinc.byteLength}`);
  }
  if (files.sincCases.byteLength !== SM20_CASES_DAT_BYTES) {
    throw new Error(`StabilityIncreaseCases.dat must be ${SM20_CASES_DAT_BYTES} bytes, got ${files.sincCases.byteLength}`);
  }
  if (files.recall.byteLength !== SM20_CASES_DAT_BYTES) {
    throw new Error(`Recall.dat must be ${SM20_CASES_DAT_BYTES} bytes, got ${files.recall.byteLength}`);
  }
  if (files.recallCases.byteLength !== SM20_CASES_DAT_BYTES) {
    throw new Error(`RecallCases.dat must be ${SM20_CASES_DAT_BYTES} bytes, got ${files.recallCases.byteLength}`);
  }

  const matrix = createEmptySm20Matrix();
  const sincView = new DataView(files.sinc.buffer, files.sinc.byteOffset, files.sinc.byteLength);
  const scView = new DataView(files.sincCases.buffer, files.sincCases.byteOffset, files.sincCases.byteLength);
  const rView = new DataView(files.recall.buffer, files.recall.byteOffset, files.recall.byteLength);
  const rcView = new DataView(files.recallCases.buffer, files.recallCases.byteOffset, files.recallCases.byteLength);

  for (let i = 0; i < SM20_MATRIX_CELLS; i += 1) {
    const sVal = sincView.getFloat64(i * 8, true);
    matrix.sinc[i] = Number.isFinite(sVal) && sVal >= 0.5 && sVal <= 20.0 ? sVal : matrix.sinc[i]!;
    matrix.sincCases[i] = scView.getUint32(i * 4, true);
    matrix.recall[i] = rView.getUint32(i * 4, true);
    matrix.recallCases[i] = rcView.getUint32(i * 4, true);
  }

  if (files.firstInterval && files.firstInterval.byteLength === SM20_FIRST_INTERVAL_RECORD_BYTES * 2) {
    const fiView = new DataView(
      files.firstInterval.buffer,
      files.firstInterval.byteOffset,
      files.firstInterval.byteLength,
    );
    for (let i = 0; i < SM20_FIRST_INTERVAL_CELLS; i += 1) {
      matrix.firstIntervalSuccess[i] = fiView.getUint32(i * 4, true);
      matrix.firstIntervalCases[i] = fiView.getUint32(SM20_FIRST_INTERVAL_RECORD_BYTES + i * 4, true);
    }
  }

  if (files.forgettingCurve && files.forgettingCurve.byteLength === SM20_FORGETTING_CURVE_RECORD_BYTES * 2) {
    const fcView = new DataView(
      files.forgettingCurve.buffer,
      files.forgettingCurve.byteOffset,
      files.forgettingCurve.byteLength,
    );
    for (let i = 0; i < SM20_FORGETTING_CURVE_BINS; i += 1) {
      matrix.forgettingCurveSuccess[i] = fcView.getUint32(i * 4, true);
      matrix.forgettingCurveCases[i] = fcView.getUint32(SM20_FORGETTING_CURVE_RECORD_BYTES + i * 4, true);
    }
  }

  if (files.retrievability && files.retrievability.byteLength === SM20_RETRIEVABILITY_RECORD_BYTES * 2) {
    const retView = new DataView(
      files.retrievability.buffer,
      files.retrievability.byteOffset,
      files.retrievability.byteLength,
    );
    // Half A (0x23a0 B): 76 x 30 int32 case counts (`PTR_DAT_011a3fa0`)
    for (let i = 0; i < SM20_RETRIEVABILITY_CASES_CELLS; i += 1) {
      matrix.retrievabilityCases[i] = Math.max(0, retView.getInt32(i * 4, true));
    }
    // Half B (0x23a0 B): 38 x 30 float64 recall sums (`PTR_DAT_011a4880`)
    for (let i = 0; i < SM20_RETRIEVABILITY_CELLS; i += 1) {
      const sVal = retView.getFloat64(SM20_RETRIEVABILITY_RECORD_BYTES + i * 8, true);
      matrix.retrievabilitySums[i] = Number.isFinite(sVal) && sVal >= 0 ? sVal : 0;
    }
  }

  if (files.difficultyDistribution && files.difficultyDistribution.byteLength === SM20_DIFFICULTY_DIST_DAT_BYTES) {
    const ddView = new DataView(
      files.difficultyDistribution.buffer,
      files.difficultyDistribution.byteOffset,
      files.difficultyDistribution.byteLength,
    );
    for (let i = 0; i < SM20_DIFFICULTY_BINS; i += 1) {
      matrix.difficultyDistribution[i] = ddView.getUint32(i * 4, true);
    }
  }

  return matrix;
}

export const decodeSm20Alg17DatFiles = parseSm20Alg17DatFiles;

/**
 * Encode all 8 non-sleep `alg17/*.dat` files matching exact `sm20.exe` record layouts
 * (`0x00bc7fb0`, `0x00bc7280`, `0x00bc91c0` / `0x00cc69e0`, `0x00bc85b0`).
 */
export function encodeSm20Alg17DatFiles(matrix: Sm20Matrix): Required<Sm20Alg17BinaryFiles> {
  const sinc = new Uint8Array(SM20_SINC_DAT_BYTES);
  const sincCases = new Uint8Array(SM20_CASES_DAT_BYTES);
  const recall = new Uint8Array(SM20_CASES_DAT_BYTES);
  const recallCases = new Uint8Array(SM20_CASES_DAT_BYTES);
  const firstInterval = new Uint8Array(SM20_FIRST_INTERVAL_RECORD_BYTES * 2);
  const forgettingCurve = new Uint8Array(SM20_FORGETTING_CURVE_RECORD_BYTES * 2);
  const retrievability = new Uint8Array(SM20_RETRIEVABILITY_RECORD_BYTES * 2);
  const difficultyDistribution = new Uint8Array(SM20_DIFFICULTY_DIST_DAT_BYTES);

  const sView = new DataView(sinc.buffer);
  const scView = new DataView(sincCases.buffer);
  const rView = new DataView(recall.buffer);
  const rcView = new DataView(recallCases.buffer);
  for (let i = 0; i < SM20_MATRIX_CELLS; i += 1) {
    sView.setFloat64(i * 8, matrix.sinc[i]!, true);
    scView.setUint32(i * 4, matrix.sincCases[i]!, true);
    rView.setUint32(i * 4, matrix.recall[i]!, true);
    rcView.setUint32(i * 4, matrix.recallCases[i]!, true);
  }

  const fiView = new DataView(firstInterval.buffer);
  for (let i = 0; i < SM20_FIRST_INTERVAL_CELLS; i += 1) {
    fiView.setUint32(i * 4, matrix.firstIntervalSuccess[i]!, true);
    fiView.setUint32(SM20_FIRST_INTERVAL_RECORD_BYTES + i * 4, matrix.firstIntervalCases[i]!, true);
  }

  const fcView = new DataView(forgettingCurve.buffer);
  for (let i = 0; i < SM20_FORGETTING_CURVE_BINS; i += 1) {
    fcView.setUint32(i * 4, matrix.forgettingCurveSuccess[i]!, true);
    fcView.setUint32(SM20_FORGETTING_CURVE_RECORD_BYTES + i * 4, matrix.forgettingCurveCases[i]!, true);
  }

  const retView = new DataView(retrievability.buffer);
  for (let i = 0; i < SM20_RETRIEVABILITY_CASES_CELLS; i += 1) {
    retView.setInt32(i * 4, Math.max(0, matrix.retrievabilityCases[i]!), true);
  }
  for (let i = 0; i < SM20_RETRIEVABILITY_CELLS; i += 1) {
    retView.setFloat64(SM20_RETRIEVABILITY_RECORD_BYTES + i * 8, matrix.retrievabilitySums[i]!, true);
  }

  const ddView = new DataView(difficultyDistribution.buffer);
  for (let i = 0; i < SM20_DIFFICULTY_BINS; i += 1) {
    ddView.setUint32(i * 4, matrix.difficultyDistribution[i]!, true);
  }

  return {
    sinc,
    sincCases,
    recall,
    recallCases,
    firstInterval,
    forgettingCurve,
    retrievability,
    difficultyDistribution,
  };
}

/**
 * `FUN_00cf5590` (`0x00cf5590`): Reads `ForgettingCurve.dat` (`36` bins) on rep-1 lapse-0
 * reviews, blending observed bin pass rate with log-time decay via `sat(cases, 40.0)`.
 */
export function lookupForgettingCurveRetention(
  matrix: Sm20Matrix | undefined,
  elapsedDays: number,
): number {
  const fallback = computeSm20Retrievability(elapsedDays, 4.0);
  if (!matrix) return fallback;
  const bin = elapsedDaysToBin36(elapsedDays);
  const idx = clamp(bin - 1, 0, SM20_FORGETTING_CURVE_BINS - 1);
  const cases = matrix.forgettingCurveCases[idx]!;
  if (cases === 0) return fallback;
  const observed = clamp(matrix.forgettingCurveSuccess[idx]! / cases, SM20_RETRIEVABILITY_MIN, SM20_RETRIEVABILITY_MAX);
  const w = rationalSaturationZeroGuarded(cases, 40.0); // 0x4044000000000000
  return clamp(w * observed + (1.0 - w) * fallback, SM20_RETRIEVABILITY_MIN, SM20_RETRIEVABILITY_MAX);
}

/**
 * `FUN_00cdfb60` (`0x00cdfb60`): Reads the 36-bin slice of `FirstInterval.dat` at `(dIdx, lapseIdx)`
 * to estimate optimal post-lapse recovery stability (`[0.1, 11.0]` days).
 */
export function lookupFirstIntervalFactor(
  matrix: Sm20Matrix | undefined,
  dIdx: number,
  lapses: number,
  targetRetention = 0.9,
): number {
  const d01 = clamp((clamp(dIdx, 1, 20) - 1) / 19.0, 0.0, 1.0);
  const prior = clamp(computeInitialRepetitionStabilityFactor(lapses, 1.0 - d01), 0.7, 11.0);
  if (!matrix) return prior;

  const lapseIdx = lapsesToIndex21(lapses);
  let totalCases = 0;
  let weightedDaysSum = 0;
  let weightSum = 0;

  for (let b = 1; b <= 35; b += 1) {
    const idx = firstIntervalIndex(dIdx, lapseIdx, b);
    const cases = matrix.firstIntervalCases[idx]!;
    if (cases > 0) {
      totalCases += cases;
      const recallRate = clamp(matrix.firstIntervalSuccess[idx]! / cases, 0.05, 0.995);
      const dayCenter = bin36ToDays(b);
      const impliedS = clamp(
        (-dayCenter * Math.log(targetRetention)) / Math.max(0.01, -Math.log(recallRate)),
        0.1,
        11.0,
      );
      weightedDaysSum += cases * impliedS;
      weightSum += cases;
    }
  }

  if (totalCases === 0 || weightSum <= 0) return prior;
  const empirical = clamp(weightedDaysSum / weightSum, 0.1, 11.0);
  const w = rationalSaturationZeroGuarded(totalCases, 20.0);
  return clamp(w * empirical + (1.0 - w) * prior, 0.1, 11.0);
}

/**
 * Resolves the 5 Algorithm Arena weights (`SM-2`, `SM-15`, `SM-19`, `SM-20`, `FSRS`),
 * blending user/default priors (`6:14:45:25:10`) with live inverse-LSRM recall accuracy
 * over `100–200` repetitions (`supermemo.guru/wiki/Algorithm_Arena`).
 */
export function resolveEffectiveArenaWeights(
  matrix: Sm20Matrix | undefined,
  baseWeights: Sm20ArenaWeights = DEFAULT_SM20_ARENA_WEIGHTS,
  autoAdapt = true,
): Sm20ArenaWeights {
  const clean = {
    sm2: Math.max(0, Number.isFinite(baseWeights.sm2) ? baseWeights.sm2 : 6),
    sm15: Math.max(0, Number.isFinite(baseWeights.sm15) ? baseWeights.sm15 : 14),
    sm19: Math.max(0, Number.isFinite(baseWeights.sm19) ? baseWeights.sm19 : 45),
    sm20: Math.max(0, Number.isFinite(baseWeights.sm20) ? baseWeights.sm20 : 25),
    fsrs: Math.max(0, Number.isFinite(baseWeights.fsrs) ? baseWeights.fsrs : 10),
  };
  const baseSum = clean.sm2 + clean.sm15 + clean.sm19 + clean.sm20 + clean.fsrs;
  if (baseSum <= 0) return { ...DEFAULT_SM20_ARENA_WEIGHTS };

  const normBase = {
    sm2: (clean.sm2 / baseSum) * 100,
    sm15: (clean.sm15 / baseSum) * 100,
    sm19: (clean.sm19 / baseSum) * 100,
    sm20: (clean.sm20 / baseSum) * 100,
    fsrs: (clean.fsrs / baseSum) * 100,
  };

  if (!autoAdapt || !matrix || matrix.arenaCases < 10) {
    return normBase;
  }

  const n = matrix.arenaCases;
  const skill = (key: keyof Sm20ArenaWeights): number => {
    if (normBase[key] <= 0) return 0;
    const mse = Math.max(0.0025, matrix.arenaSumSq[key] / n);
    return normBase[key] / mse;
  };
  const s2 = skill("sm2");
  const s15 = skill("sm15");
  const s19 = skill("sm19");
  const s20 = skill("sm20");
  const sFsrs = skill("fsrs");
  const sSum = s2 + s15 + s19 + s20 + sFsrs;
  if (sSum <= 0) return normBase;

  const alpha = rationalSaturationZeroGuarded(n, 150.0);
  const blend = (bVal: number, sVal: number) =>
    (1 - alpha) * bVal + alpha * ((sVal / sSum) * 100.0);

  return {
    sm2: blend(normBase.sm2, s2),
    sm15: blend(normBase.sm15, s15),
    sm19: blend(normBase.sm19, s19),
    sm20: blend(normBase.sm20, s20),
    fsrs: blend(normBase.fsrs, sFsrs),
  };
}

export interface Sm20RecallRegressionCell {
  slope: number;
  intercept: number;
  totalCases: number;
}

export function fitSm20RecallCellRegression(
  matrix: Sm20Matrix,
  dIdx: number,
  sIdx: number,
): Sm20RecallRegressionCell {
  let totalCases = 0;
  const xs: number[] = [];
  const ws: number[] = [];
  const rawY: number[] = [];
  for (let rIdx = 1; rIdx <= 20; rIdx += 1) {
    const idx = matrixIndex(dIdx, sIdx, rIdx);
    const cases = matrix.recallCases[idx]!;
    totalCases += cases;
    const x = index20ToRetrievabilityAxis(rIdx);
    xs.push(x);
    ws.push(Math.round(cases) + 1e-5);
    rawY.push(
      cases > 0 ? clamp(matrix.recall[idx]! / cases, 0.0, 1.0) : 0.64 * x + 0.3,
    );
  }
  if (totalCases === 0) {
    return { slope: 0.64, intercept: 0.3, totalCases: 0 };
  }

  const yVals = reconcileRetentionMatrixOutliers(rawY);
  let sumW = 0;
  let sumWX = 0;
  let sumWY = 0;
  for (let i = 0; i < 20; i += 1) {
    const w = ws[i]!;
    sumW += w;
    sumWX += w * xs[i]!;
    sumWY += w * yVals[i]!;
  }
  if (sumW <= 0) {
    return { slope: 0.64, intercept: 0.3, totalCases };
  }
  const meanX = sumWX / sumW;
  const meanY = sumWY / sumW;

  let num = 0;
  let den = 0;
  for (let i = 0; i < 20; i += 1) {
    const dx = xs[i]! - meanX;
    num += ws[i]! * dx * (yVals[i]! - meanY);
    den += ws[i]! * dx * dx;
  }
  const slope = den > 1e-12 ? num / den : 0.64;
  const intercept = meanY - slope * meanX;
  return { slope, intercept, totalCases };
}

export function calibrateSm20Retrievability(
  matrix: Sm20Matrix,
  dIdx: number,
  sIdx: number,
  analyticalR: number,
): number {
  const cleanR = clamp(analyticalR, SM20_RETRIEVABILITY_MIN, SM20_RETRIEVABILITY_MAX);
  const { slope, intercept, totalCases } = fitSm20RecallCellRegression(matrix, dIdx, sIdx);
  if (totalCases === 0) return cleanR;
  const empR = clamp(slope * cleanR + intercept, SM20_RETRIEVABILITY_MIN, SM20_RETRIEVABILITY_MAX);
  const alpha = totalCases / (totalCases + 3.5);
  return clamp(alpha * empR + (1.0 - alpha) * cleanR, SM20_RETRIEVABILITY_MIN, SM20_RETRIEVABILITY_MAX);
}

/**
 * `0x00ce6470` (`FUN_00ce6470`): Blends exact cell `SInc` with analytical prior using
 * `dVar1 = sat(cellCases, 300.0)` (`0x4072c00000000000` = `300.0`).
 */
export function lookupBlendedSinc(
  matrix: Sm20Matrix | undefined,
  d01: number,
  stability: number,
  retrievability: number,
): number {
  const prior = computeInitialSincPrior(d01, stability, retrievability);
  if (!matrix) return prior;

  const dIdx = difficulty01ToIndex20(d01);
  const sIdx = stabilityToIndex20(stability);
  const rIdx = retrievabilityToIndex20(retrievability);
  const exactIdx = matrixIndex(dIdx, sIdx, rIdx);
  const cellCases = matrix.sincCases[exactIdx]!;
  const cellSinc = matrix.sinc[exactIdx]!;

  // Perturbed 6-face neighbor average (`0x00cdfef0`)
  let neighborCases = 0;
  let neighborSum = 0;
  const offsets: ReadonlyArray<[number, number, number]> = [
    [-1, 0, 0],
    [1, 0, 0],
    [0, -1, 0],
    [0, 1, 0],
    [0, 0, -1],
    [0, 0, 1],
  ];
  for (const [dd, ds, dr] of offsets) {
    const nIdx = matrixIndex(clamp(dIdx + dd, 1, 20), clamp(sIdx + ds, 1, 20), clamp(rIdx + dr, 1, 20));
    const nc = matrix.sincCases[nIdx]!;
    if (nc > 0) {
      neighborCases += nc;
      neighborSum += nc * matrix.sinc[nIdx]!;
    }
  }

  const dVar1 = rationalSaturationZeroGuarded(cellCases, 300.0);
  const exactBlended = (prior + dVar1 * 10.0 * cellSinc) / (dVar1 * 10.0 + 1.0);
  if (neighborCases === 0) return clamp(exactBlended, 0.8, 20.0);

  const neighborMean = neighborSum / neighborCases;
  const nWeight = rationalSaturationZeroGuarded(neighborCases, 300.0);
  // `0x00ce66e0` (175, 0.01, 100, 0.1) component weighting
  const wExact = 175.0;
  const wNeigh = 100.0 * nWeight;
  return clamp((wExact * exactBlended + wNeigh * neighborMean) / (wExact + wNeigh), 0.8, 20.0);
}

/**
 * `0x00ce7880` -> `0x00ce6470` + `0x00ce66e0` (`ghidra:f10bbe9246785b37`):
 * Computes the SM-19 matrix stability slot (`+0x7b`) using `(175.0, 0.01, 100.0, 0.1)`
 * component weights and `0x00ce6470`'s overdue ceiling `Math.max(elapsed * sinc, prevS + min(1, elapsed))`.
 */
export function computeSm19MatrixOutcomeStability(input: {
  matrix: Sm20Matrix | undefined;
  prevD01: number;
  prevS: number;
  elapsedDays: number;
  retrievability: number;
  smGrade: SmGrade;
  prevLapses: number;
  desiredRetention: number;
}): number {
  const { matrix, prevD01, prevS, elapsedDays, retrievability, smGrade, prevLapses, desiredRetention } = input;
  const priorSinc = computeInitialSincPrior(prevD01, prevS, retrievability);
  const blendedSinc = lookupBlendedSinc(matrix, prevD01, prevS, retrievability);

  const dIdx = difficulty01ToIndex20(prevD01);
  const sIdx = stabilityToIndex20(prevS);
  const rIdx = retrievabilityToIndex20(retrievability);
  const cellCases = matrix ? matrix.sincCases[matrixIndex(dIdx, sIdx, rIdx)]! : 0;

  // `0x00ce6470`: ceiling `local_30` + `(param_4 + dVar1 * 10 * param_3) / (dVar1 * 10 + 1)`
  const stepCap = Math.min(1.0, Math.max(0.0, elapsedDays));
  let ceilS = Math.max(elapsedDays * blendedSinc, elapsedDays * priorSinc);
  if (ceilS < prevS) ceilS = prevS + stepCap;

  const dVar1 = rationalSaturationZeroGuarded(cellCases, 300.0);
  const rawCellS = Math.min(
    ceilS,
    prevS * ((priorSinc + dVar1 * 10.0 * blendedSinc) / (dVar1 * 10.0 + 1.0)),
  );

  // `0x00ce66e0`: 5-way prior blend `(175.0, 0.01, 100.0, 0.1)` with grade scaling (`3..5`)
  const modelV2Sinc = clamp(
    (1.0 - prevD01) * 6.5 * Math.pow(Math.max(1, prevS), -0.18) + 1.15,
    1.05,
    20.0,
  );
  const modelV2S = Math.min(ceilS, prevS * modelV2Sinc);
  const initBaseS = Math.max(prevS, computeInitialRepetitionStabilityFactor(prevLapses + 1, 1.0 - prevD01));

  const w1 = 175.0;
  const w2 = 100.0;
  const w3 = 0.1;
  const w4 = 0.01;
  let mergedS = (w1 * rawCellS + w2 * (prevS * blendedSinc) + w3 * modelV2S + w4 * initBaseS) / (w1 + w2 + w3 + w4);

  const gradeFactor = smGrade === 3 ? 0.72 : smGrade === 5 ? 1.18 : 1.0;
  mergedS = prevS + Math.max(0.05, (mergedS - prevS) * gradeFactor);

  const isEarly = elapsedDays < prevS && retrievability > desiredRetention;
  if (isEarly) {
    const earlyScale = clamp((1.0 - retrievability) / Math.max(1e-6, 1.0 - desiredRetention), 0.0, 1.0);
    mergedS = prevS + (mergedS - prevS) * earlyScale;
  }

  return clamp(mergedS, SM20_STABILITY_MIN, SM20_STABILITY_MAX);
}

/** `0x00ce60b0`: clamp SInc by SM-20 grade (0..5). */
export function clampSincBySmGrade(sinc: number, smGrade: number): number {
  const s = Number.isFinite(sinc) ? sinc : 1.0;
  if (smGrade <= 2) return clamp(s, 0.5, 2.0);
  if (smGrade === 3) return clamp(s, 0.8, 12.0);
  if (smGrade === 4) return clamp(s, 0.8, 20.0);
  return clamp(s, 1.0, 20.0);
}

/** `0x00bc6ff0`: update difficulty [0, 1] from SM-20 grade (0..5) and retrievability. */
export function updateSm20Difficulty(
  d01: number,
  smGrade: number,
  retrievability = 0.9,
  repNumber = 3,
  lapses = 0,
): number {
  return updateSm20Difficulty01(d01, retrievability, smGrade, repNumber, lapses);
}

/** `0x00ce66e0` / `0x00ce6470`: post-review stability wrapper. */
export function computePostReviewStability(
  prevS: number,
  sinc: number,
  elapsedDays: number,
  smGrade: number,
  retrievability?: number,
  desiredRetention?: number,
): number {
  const safeS = clamp(prevS, SM20_STABILITY_MIN, SM20_STABILITY_MAX);
  const gradeScale = smGrade === 3 ? 1.0 + (sinc - 1.0) * 0.5 : smGrade === 5 ? sinc * 1.15 : sinc;
  const baseScale = Math.max(1.02, gradeScale);
  const isEarly =
    elapsedDays < safeS &&
    retrievability !== undefined &&
    desiredRetention !== undefined &&
    Number.isFinite(retrievability) &&
    Number.isFinite(desiredRetention) &&
    retrievability > desiredRetention;
  const earlyScale = isEarly
    ? clamp((1.0 - retrievability!) / Math.max(1e-6, 1.0 - desiredRetention!), 0.0, 1.0)
    : 1.0;
  const dampedScale = 1.0 + (baseScale - 1.0) * earlyScale;
  return clamp(safeS * dampedScale, SM20_STABILITY_MIN, SM20_STABILITY_MAX);
}

export function computeBlendedNextStability(
  prevS: number,
  sinc: number,
  elapsedDays: number,
  smGrade: number,
  retrievability?: number,
  desiredRetention?: number,
): number {
  return computePostReviewStability(prevS, sinc, elapsedDays, smGrade, retrievability, desiredRetention);
}

/** `ComputeInitialRepetitionStabilityFactor` (`0x00ce0600`). */
export function computeInitialRepetitionStabilityFactor(
  lapseIndex: number,
  difficultyFrac: number,
): number {
  const L = Math.max(1, Math.trunc(Number.isFinite(lapseIndex) ? lapseIndex : 1));
  const d = clamp(Number.isFinite(difficultyFrac) ? difficultyFrac : (5 - 1) / 9, 0.0, 1.0);
  return 3.5 * Math.pow(d, 1.8) * Math.exp(-0.27 * L) + 0.6;
}

export function computePostLapseStability(
  _prevS: number,
  lapses: number,
  difficulty01?: number,
): number {
  const baseline = computeInitialRepetitionStabilityFactor(
    lapses,
    difficulty01 ?? (5 - 1) / 9,
  );
  return clamp(baseline, SM20_STABILITY_MIN, SM20_STABILITY_MAX);
}

/** `ReconcileRetentionMatrixColumnDiffs` (`0x00c243f0`). */
export function reconcileRetentionMatrixOutliers(values: readonly number[]): number[] {
  const out = values.map((v) => clamp(Number.isFinite(v) ? v : 0.5, 0.0, 1.0));
  const n = out.length;
  if (n < 2) return out;
  for (let c = 0; c < n; c += 1) {
    const prev = c === 0 ? out[n - 1]! : out[c - 1]!;
    const curr = out[c]!;
    const delta = c === 0 ? (1.0 - prev) + curr : curr - prev;
    if (!(delta > 0.5)) continue;
    if (curr < 0.5) {
      const next = c + 1 < n ? out[c + 1]! : prev;
      out[c] = clamp((prev + next) / 2.0, 0.0, 1.0);
    }
    if (c > 0 && out[c - 1]! < 0.5) {
      const before = c >= 2 ? out[c - 2]! : out[c]!;
      out[c - 1] = clamp((before + out[c]!) / 2.0, 0.0, 1.0);
    }
  }
  return out;
}

/** `Smooth3DMatrixCubeByMode` (`0x00a93480` / `0x00a93510`, mode 1). */
export function smoothSm20SincCube(matrix: Sm20Matrix): void {
  const next = new Float64Array(matrix.sinc);
  for (let d = 1; d <= 20; d += 1) {
    for (let s = 1; s <= 20; s += 1) {
      for (let r = 1; r <= 20; r += 1) {
        let sum = 0;
        let weight = 0;
        for (let dd = -1; dd <= 1; dd += 1) {
          const nd = d + dd;
          if (nd < 1 || nd > 20) continue;
          for (let ds = -1; ds <= 1; ds += 1) {
            const ns = s + ds;
            if (ns < 1 || ns > 20) continue;
            for (let dr = -1; dr <= 1; dr += 1) {
              const nr = r + dr;
              if (nr < 1 || nr > 20) continue;
              sum += matrix.sinc[matrixIndex(nd, ns, nr)]!;
              weight += 1;
            }
          }
        }
        const idx = matrixIndex(d, s, r);
        next[idx] = (matrix.sinc[idx]! + sum) / (weight + 1);
      }
    }
  }
  matrix.sinc.set(next);
}

export function gradeToSmGrade(grade: Grade | number): number {
  if (typeof grade === "number") {
    if (grade <= 1) return 1;
    if (grade === 2) return 3;
    if (grade === 3) return 4;
    return 5;
  }
  switch (grade) {
    case "again": return 1;
    case "hard": return 3;
    case "good": return 4;
    case "easy": return 5;
  }
}

export interface Sm20OutcomeSample {
  prevDifficulty01: number;
  prevStability: number;
  retrievability: number;
  nextStability: number;
  smGrade: number;
  prevReps?: number;
  prevLapses?: number;
  elapsedDays?: number;
  arenaPredictions?: {
    sm2: number;
    sm15: number;
    sm19: number;
    sm20: number;
    fsrs: number;
  };
}

function isStoredCardLike(v: unknown): v is StoredCard {
  return Boolean(v && typeof v === "object" && "stability" in v && "difficulty" in v && "reps" in v);
}

/**
 * Incrementally record one review outcome across all 8 `alg17` arrays + Algorithm Arena LSRM
 * (`0x00ce94a0`, `0x00ce7570`, `0x00cc69e0`, `0x00bc8380`, `0x00d8b990`).
 *
 * Accepts either a `Sm20OutcomeSample` object or `(matrix, prevCard, nextCard, grade, smGrade)`.
 */
export function recordSm20Outcome(
  matrix: Sm20Matrix,
  outcomeOrPrevCard: Sm20OutcomeSample | StoredCard,
  maybeNextCard?: StoredCard,
  maybeGrade?: Grade,
  maybeSmGrade?: number,
): void {
  let outcome: Sm20OutcomeSample;
  if (isStoredCardLike(outcomeOrPrevCard)) {
    const prevCard = outcomeOrPrevCard;
    const nextCard = maybeNextCard!;
    const prevS = Math.max(SM20_STABILITY_MIN, prevCard.stability || 1);
    const prevD01 = storedDifficultyTo01(prevCard.difficulty);
    const elapsedDays =
      prevCard.lastReview !== undefined && nextCard.lastReview !== undefined
        ? Math.max(0, (nextCard.lastReview - prevCard.lastReview) / 86_400_000)
        : Math.max(0, nextCard.elapsedDays || prevCard.scheduledDays || 1);
    const smG = (
      maybeSmGrade !== undefined
        ? clamp(Math.round(maybeSmGrade), 0, 5)
        : gradeToSmGrade(maybeGrade ?? "good")
    ) as SmGrade;
    const arena = computeSm20ArenaOutcomes({
      card: prevCard,
      smGrade: smG,
      nowMs: nextCard.lastReview ?? Date.now(),
      matrix,
    });
    outcome = {
      prevDifficulty01: prevD01,
      prevStability: prevS,
      retrievability: arena.predictions.sm19,
      nextStability: nextCard.stability,
      smGrade: smG,
      prevReps: prevCard.reps,
      prevLapses: prevCard.lapses,
      elapsedDays,
      arenaPredictions: arena.predictions,
    };
  } else {
    outcome = outcomeOrPrevCard;
  }

  const dIdx = difficulty01ToIndex20(outcome.prevDifficulty01);
  const sIdx = stabilityToIndex20(outcome.prevStability);
  const rIdx = retrievabilityToIndex20(outcome.retrievability);
  const idx = matrixIndex(dIdx, sIdx, rIdx);
  const passed = outcome.smGrade >= 3;
  const win = passed ? 1.0 : 0.0;

  matrix.recallCases[idx] = matrix.recallCases[idx]! + 1;
  if (passed) {
    matrix.recall[idx] = matrix.recall[idx]! + 1;
  }

  if (passed && outcome.prevStability > 0 && outcome.nextStability > 0) {
    const observedSinc = clampSincBySmGrade(outcome.nextStability / outcome.prevStability, outcome.smGrade);
    const prevSCases = matrix.sincCases[idx]!;
    const nextSCases = prevSCases + 1;
    const prevSinc = matrix.sinc[idx]!;
    matrix.sinc[idx] = prevSCases === 0
      ? observedSinc
      : prevSinc + (observedSinc - prevSinc) / nextSCases;
    matrix.sincCases[idx] = nextSCases;
  }

  const prevReps = outcome.prevReps ?? 2;
  const prevLapses = outcome.prevLapses ?? 0;
  const elapsed = outcome.elapsedDays ?? outcome.prevStability;
  const ivlBin = elapsedDaysToBin36(elapsed);

  // 0x00ce7570: post-lapse first-interval matrix (`prevReps === 1 && prevLapses > 0`)
  if (prevReps === 1 && prevLapses > 0) {
    const fiIdx = firstIntervalIndex(dIdx, lapsesToIndex21(prevLapses), ivlBin);
    matrix.firstIntervalCases[fiIdx] = matrix.firstIntervalCases[fiIdx]! + 1;
    if (passed) {
      matrix.firstIntervalSuccess[fiIdx] = matrix.firstIntervalSuccess[fiIdx]! + 1;
    }
  }

  // 0x00ce7570: initial forgetting curve (`prevReps === 1 && prevLapses === 0`)
  if (prevReps === 1 && prevLapses === 0) {
    const fcBin = clamp(ivlBin - 1, 0, SM20_FORGETTING_CURVE_BINS - 1);
    matrix.forgettingCurveCases[fcBin] = matrix.forgettingCurveCases[fcBin]! + 1;
    if (passed) {
      matrix.forgettingCurveSuccess[fcBin] = matrix.forgettingCurveSuccess[fcBin]! + 1;
    }
  }

  // 0x00cc69e0: Retrievability.dat Half A (int32 case counts) & Half B (float64 recall sums)
  const calBin = retrievabilityToCalibrationBin30(outcome.retrievability);
  matrix.retrievabilityCases[calBin] = matrix.retrievabilityCases[calBin]! + 1;
  matrix.retrievabilitySums[calBin] = matrix.retrievabilitySums[calBin]! + win;

  // Update Algorithm Arena LSRM squared errors (`0x00d8b990`)
  const preds = outcome.arenaPredictions ?? {
    sm2: computeSm20Retrievability(elapsed, Math.max(1, outcome.prevStability)),
    sm15: computeSm20Retrievability(elapsed, Math.max(0.7, outcome.prevStability * 0.95)),
    sm19: clamp(outcome.retrievability, 0.005, 0.995),
    sm20: clamp(outcome.retrievability, 0.005, 0.995),
    fsrs: Math.pow(1 + (19 / 81) * (elapsed / Math.max(0.7, outcome.prevStability)), -0.5),
  };
  matrix.arenaCases += 1;
  matrix.arenaSumSq.sm2 += (preds.sm2 - win) * (preds.sm2 - win);
  matrix.arenaSumSq.sm15 += (preds.sm15 - win) * (preds.sm15 - win);
  matrix.arenaSumSq.sm19 += (preds.sm19 - win) * (preds.sm19 - win);
  matrix.arenaSumSq.sm20 += (preds.sm20 - win) * (preds.sm20 - win);
  matrix.arenaSumSq.fsrs += (preds.fsrs - win) * (preds.fsrs - win);

  // 0x00bc8380: DifficultyDistribution.dat 20-bin histogram
  const dBin0 = clamp(dIdx - 1, 0, SM20_DIFFICULTY_BINS - 1);
  matrix.difficultyDistribution[dBin0] = matrix.difficultyDistribution[dBin0]! + 1;
}

/**
 * Replay non-undone `graded` events (respecting `forget-reset` / `card-reset`) to
 * construct or update an SM-20 v4 matrix (`0x00ce94a0`).
 */
export function foldSm20MatrixFromEvents(
  events: readonly IrEvent[],
  opts?: {
    baseline?: Sm20MatrixSnapshot;
    afterEventId?: string | null;
  },
): Sm20Matrix {
  const matrix = opts?.baseline ? restoreSm20Matrix(opts.baseline) : createEmptySm20Matrix();

  const undone = new Set<string>();
  for (const ev of events) {
    if (ev.kind === "grade-undone" && typeof ev.payload.eventId === "string") {
      undone.add(ev.payload.eventId);
    }
  }

  const sorted = [...events].sort((a, b) => a.lamport - b.lamport || a.id.localeCompare(b.id));
  const cardState = new Map<string, StoredCard>();
  const hasCursor = Boolean(
    opts?.afterEventId && sorted.some((e) => e.id === opts.afterEventId),
  );
  let seenAfter = !hasCursor;

  for (const ev of sorted) {
    if (ev.kind === "grade-undone" || undone.has(ev.id)) {
      if (!seenAfter && ev.id === opts?.afterEventId) seenAfter = true;
      continue;
    }

    if (ev.kind === "element-created") {
      const el = ev.payload.element as { card?: StoredCard } | undefined;
      if (el?.card) cardState.set(ev.target, el.card);
    } else if (ev.kind === "card-reset" || (ev.kind === "mercy-postponed" && ev.payload.operation === "forget-reset")) {
      const resetCard = ev.payload.card as StoredCard | undefined;
      if (resetCard) cardState.set(ev.target, resetCard);
      else cardState.delete(ev.target);
    } else if (ev.kind === "mercy-postponed" && ev.payload.operation === "manual-reschedule" && ev.payload.card) {
      cardState.set(ev.target, ev.payload.card as StoredCard);
    } else if (ev.kind === "graded") {
      const nextCard = ev.payload.card as StoredCard | undefined;
      if (nextCard) {
        const prevCard = cardState.get(ev.target);
        if (
          seenAfter &&
          !ev.payload.overridden &&
          prevCard &&
          prevCard.reps > 0 &&
          prevCard.stability > 0
        ) {
          const rawSmGrade = ev.payload.smGrade;
          const smGrade = (
            typeof rawSmGrade === "number" && Number.isFinite(rawSmGrade)
              ? clamp(Math.round(rawSmGrade), 0, 5)
              : gradeToSmGrade(typeof ev.payload.grade === "number" ? ev.payload.grade : 3)
          ) as SmGrade;
          recordSm20Outcome(matrix, prevCard, nextCard, undefined, smGrade);
        }
        cardState.set(ev.target, nextCard);
      }
    }

    if (!seenAfter && ev.id === opts?.afterEventId) {
      seenAfter = true;
    }
  }

  // Recompute active collection DifficultyDistribution.dat histogram from live card states
  matrix.difficultyDistribution.fill(0);
  for (const c of cardState.values()) {
    if (c.reps > 0) {
      const dIdx = difficulty01ToIndex20(storedDifficultyTo01(c.difficulty));
      const dBin0 = clamp(dIdx - 1, 0, SM20_DIFFICULTY_BINS - 1);
      matrix.difficultyDistribution[dBin0] = matrix.difficultyDistribution[dBin0]! + 1;
    }
  }

  return matrix;
}

/**
 * `0x00ce6f40` -> `0x00ce94a0` (`EvaluateItemRepetitionHistoryMetrics`):
 * Replays each item's chronological `element-created` + `graded` event history through
 * `scheduleSm20Item` (5-model Arena + `matrix`) to refresh stale `(stability, difficulty)`
 * while **preserving existing `due` timestamps, `reps`, `lapses`, `state`, and `scheduledDays`**.
 */
export function replaySm20CardsFromEvents(
  elements: Iterable<IrElement>,
  events: readonly IrEvent[],
  matrix: Sm20Matrix,
  opts?: {
    requestRetention?: number;
    arenaWeights?: Sm20ArenaWeights;
    autoAdaptArena?: boolean;
  },
): Map<ElementId, StoredCard> {
  const undone = new Set<string>();
  for (const ev of events) {
    if (ev.kind === "grade-undone" && typeof ev.payload.eventId === "string") {
      undone.add(ev.payload.eventId);
    }
  }

  const sorted = [...events].sort((a, b) => a.lamport - b.lamport || a.id.localeCompare(b.id));
  const simCards = new Map<string, StoredCard | undefined>();

  for (const ev of sorted) {
    if (ev.kind === "grade-undone" || undone.has(ev.id)) continue;
    if (ev.kind === "element-created") {
      const el = ev.payload.element as { card?: StoredCard } | undefined;
      simCards.set(ev.target, el?.card ? { ...el.card } : undefined);
    } else if (
      ev.kind === "card-reset" ||
      (ev.kind === "mercy-postponed" && ev.payload.operation === "forget-reset")
    ) {
      simCards.set(ev.target, undefined);
    } else if (ev.kind === "graded") {
      const prev = simCards.get(ev.target);
      const rawSm = ev.payload.smGrade;
      const smGrade = (
        typeof rawSm === "number" && Number.isFinite(rawSm)
          ? clamp(Math.round(rawSm), 0, 5)
          : typeof ev.payload.grade === "string"
            ? gradeToSmGrade(ev.payload.grade as Grade)
            : gradeToSmGrade(typeof ev.payload.grade === "number" ? ev.payload.grade : 3)
      ) as SmGrade;
      const replayed = scheduleSm20Item(prev, smGrade, ev.ts, {
        requestRetention: opts?.requestRetention ?? 0.9,
        matrix,
        arenaWeights: opts?.arenaWeights,
        autoAdaptArena: opts?.autoAdaptArena,
        dispersionSeed: null,
      });
      // Preserve actual historical scheduledDays/lastReview so subsequent elapsed_days stay exact
      const actualCard = ev.payload.card as StoredCard | undefined;
      simCards.set(ev.target, {
        ...replayed,
        ...(actualCard?.due !== undefined ? { due: actualCard.due } : {}),
        ...(actualCard?.scheduledDays !== undefined ? { scheduledDays: actualCard.scheduledDays } : {}),
        lastReview: actualCard?.lastReview ?? ev.ts,
      });
    }
  }

  const refreshed = new Map<ElementId, StoredCard>();
  for (const el of elements) {
    if (el.type !== "item" || !el.card) continue;
    const sim = simCards.get(el.id);
    if (!sim) continue;
    refreshed.set(el.id, {
      ...el.card,
      stability: sim.stability,
      difficulty: sim.difficulty,
    });
  }
  return refreshed;
}

function csvEscape(cell: string): string {
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

export function formatSm20RecallDataCsv(matrix: Sm20Matrix): string {
  const sHeaders = Array.from({ length: 20 }, (_, i) => {
    const sIdx = i + 1;
    return `S${sIdx}(${stabilityIndex20ToTransformed(sIdx).toFixed(1)}d)`;
  });
  const cells: Sm20RecallRegressionCell[][] = Array.from({ length: 20 }, (_, dZero) =>
    Array.from({ length: 20 }, (__, sZero) =>
      fitSm20RecallCellRegression(matrix, dZero + 1, sZero + 1),
    ),
  );

  const buildTable = (
    title: string,
    pick: (c: Sm20RecallRegressionCell) => string,
  ): string[] => {
    const lines = [title, ["Difficulty\\Stability", ...sHeaders].join(",")];
    for (let dZero = 0; dZero < 20; dZero += 1) {
      const dLabel = `D${dZero + 1}(${((dZero / 19) * 100).toFixed(0)}%)`;
      const row = [dLabel, ...cells[dZero]!.map(pick)];
      lines.push(row.join(","));
    }
    return lines;
  };

  return [
    ...buildTable("A in Recall=A*R+B", (c) => c.slope.toFixed(4)),
    "",
    ...buildTable("B in Recall=A*R+B", (c) => c.intercept.toFixed(4)),
    "",
    ...buildTable("Repetition cases in Recall=A*R+B", (c) => String(c.totalCases)),
  ].join("\n");
}

export function formatCategoryDifficultyDeviationCsv(
  elements: Iterable<IrElement>,
): string {
  const list = Array.from(elements);
  const byId = new Map(list.map((el) => [el.id, el]));

  const rootCategoryLabel = (start: IrElement): string => {
    let cur: IrElement | undefined = start;
    const visited = new Set<string>();
    while (cur && cur.parentId && !visited.has(cur.id)) {
      visited.add(cur.id);
      const parent = byId.get(cur.parentId);
      if (!parent) break;
      cur = parent;
    }
    if (!cur || cur.id === start.id) return "(Uncategorized)";
    const rawPath = cur.notePath ?? cur.anchor?.sourcePath;
    if (rawPath) {
      const base = rawPath.split("/").pop() ?? rawPath;
      return base.replace(/\.(md|pdf)$/i, "") || rawPath;
    }
    const firstLine = cur.text.split("\n")[0]?.trim();
    return firstLine ? firstLine.slice(0, 60) : cur.id;
  };

  const items = list.filter((el) => !el.dismissed && el.type === "item" && el.card);
  const lines = ["Category,Items,MeanDifficulty,DeviationFromMean,MeanLapses"];
  if (items.length === 0) return lines.join("\n");

  let totalDiff = 0;
  const groups = new Map<
    string,
    { count: number; sumDiff: number; sumLapses: number }
  >();
  for (const item of items) {
    const d01 = storedDifficultyTo01(item.card!.difficulty);
    totalDiff += d01;
    const cat = rootCategoryLabel(item);
    const bucket = groups.get(cat) ?? { count: 0, sumDiff: 0, sumLapses: 0 };
    bucket.count += 1;
    bucket.sumDiff += d01;
    bucket.sumLapses += item.card!.lapses ?? 0;
    groups.set(cat, bucket);
  }
  const collectionMean = totalDiff / items.length;
  const sorted = Array.from(groups.entries()).sort((a, b) => {
    const meanA = a[1].sumDiff / a[1].count;
    const meanB = b[1].sumDiff / b[1].count;
    return meanB - meanA || b[1].count - a[1].count || a[0].localeCompare(b[0]);
  });

  for (const [cat, g] of sorted) {
    const meanDiff = g.sumDiff / g.count;
    const dev = meanDiff - collectionMean;
    const meanLapses = g.sumLapses / g.count;
    lines.push(
      [
        csvEscape(cat),
        String(g.count),
        meanDiff.toFixed(4),
        (dev >= 0 ? "+" : "") + dev.toFixed(4),
        meanLapses.toFixed(2),
      ].join(","),
    );
  }
  return lines.join("\n");
}
