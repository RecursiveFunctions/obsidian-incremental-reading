import type { Grade } from "../fsrs";
import { rationalSaturationZeroGuarded, roundHalfToEven } from "../sm18-ir-mechanics";
import type { IrElement, IrEvent, StoredCard } from "./model";
import {
  computeInitialSincPrior,
  computeSm20Retrievability,
  difficulty01ToIndex20,
  SM20_RETRIEVABILITY_MAX,
  SM20_RETRIEVABILITY_MIN,
  SM20_STABILITY_MAX,
  SM20_STABILITY_MIN,
  stabilityIndex20ToTransformed,
  stabilityToIndex20,
  storedDifficultyTo01,
  updateSm20Difficulty01,
} from "./sm20-scheduler";

export const SM20_MATRIX_SCHEMA_VERSION = 3;
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

/** `Retrievability.dat` (`0x00bc91c0` / `0x00cc69e0`): two 38×30 float64 records (`0x23a0` = 9,120 B each). */
export const SM20_RETRIEVABILITY_ROWS = 38;
export const SM20_RETRIEVABILITY_BINS = 30;
export const SM20_RETRIEVABILITY_CELLS = SM20_RETRIEVABILITY_ROWS * SM20_RETRIEVABILITY_BINS; // 1,140
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
  /** Calibration predicted-retrievability sum (`38 × 30`; row 0 = primary SM-20, row 37 = bin case counts). */
  retrievabilityPredSum: Float64Array;
  /** Calibration actual-pass sum (`38 × 30`; row 0 = primary SM-20, row 37 = bin case counts). */
  retrievabilityActualSum: Float64Array;
  /** Item count histogram across 20 difficulty bins (`0x00bc8380`). */
  difficultyDistribution: Uint32Array;
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
  retrievabilityPredSum?: number[];
  retrievabilityActualSum?: number[];
  difficultyDistribution?: number[];
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

export function elapsedDaysToBin36(elapsedDays: number): number {
  const e = Math.max(0, Number.isFinite(elapsedDays) ? elapsedDays : 0);
  if (e <= 1) return 1;
  return clamp(Math.floor(Math.log(e) / Math.log(1.28)) + 2, 1, 36);
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
  const clean = clamp(Math.trunc(Number.isFinite(rIdx) ? rIdx : 1), 1, 20);
  return Math.log(clean) / Math.log(20.0);
}

/** Seed an empty SM-20 matrix with analytical priors (`0x00cde2d0` + `0x00ce0150`). */
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
    retrievabilityPredSum: new Float64Array(SM20_RETRIEVABILITY_CELLS),
    retrievabilityActualSum: new Float64Array(SM20_RETRIEVABILITY_CELLS),
    difficultyDistribution: new Uint32Array(SM20_DIFFICULTY_BINS),
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
    retrievabilityPredSum: new Float64Array(matrix.retrievabilityPredSum),
    retrievabilityActualSum: new Float64Array(matrix.retrievabilityActualSum),
    difficultyDistribution: new Uint32Array(matrix.difficultyDistribution),
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
    retrievabilityPredSum: Array.from(matrix.retrievabilityPredSum),
    retrievabilityActualSum: Array.from(matrix.retrievabilityActualSum),
    difficultyDistribution: Array.from(matrix.difficultyDistribution),
  };
}

export function restoreSm20Matrix(snapshot: Sm20MatrixSnapshot): Sm20Matrix {
  const empty = createEmptySm20Matrix();
  // Support empty-string placeholder in legacy test fixtures as empty baseline
  const parseArr = (raw: number[] | string | undefined, expectedLen: number, fallback: ArrayLike<number>): number[] => {
    if (raw === "") return Array.from(fallback);
    if (!Array.isArray(raw) || raw.length !== expectedLen) {
      throw new Error("Invalid SM-20 matrix snapshot dimensions");
    }
    return raw;
  };

  const sinc = Float64Array.from(parseArr(snapshot.sinc, SM20_MATRIX_CELLS, empty.sinc));
  const sincCases = Uint32Array.from(parseArr(snapshot.sincCases, SM20_MATRIX_CELLS, empty.sincCases));
  const recall = Uint32Array.from(parseArr(snapshot.recall, SM20_MATRIX_CELLS, empty.recall));
  const recallCases = Uint32Array.from(parseArr(snapshot.recallCases, SM20_MATRIX_CELLS, empty.recallCases));

  const optUint32 = (arr: number[] | undefined, len: number): Uint32Array =>
    Array.isArray(arr) && arr.length === len ? Uint32Array.from(arr) : new Uint32Array(len);
  const optFloat64 = (arr: number[] | undefined, len: number): Float64Array =>
    Array.isArray(arr) && arr.length === len ? Float64Array.from(arr) : new Float64Array(len);

  return {
    sinc,
    sincCases,
    recall,
    recallCases,
    firstIntervalSuccess: optUint32(snapshot.firstIntervalSuccess, SM20_FIRST_INTERVAL_CELLS),
    firstIntervalCases: optUint32(snapshot.firstIntervalCases, SM20_FIRST_INTERVAL_CELLS),
    forgettingCurveSuccess: optUint32(snapshot.forgettingCurveSuccess, SM20_FORGETTING_CURVE_BINS),
    forgettingCurveCases: optUint32(snapshot.forgettingCurveCases, SM20_FORGETTING_CURVE_BINS),
    retrievabilityPredSum: optFloat64(snapshot.retrievabilityPredSum, SM20_RETRIEVABILITY_CELLS),
    retrievabilityActualSum: optFloat64(snapshot.retrievabilityActualSum, SM20_RETRIEVABILITY_CELLS),
    difficultyDistribution: optUint32(snapshot.difficultyDistribution, SM20_DIFFICULTY_BINS),
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
  const countRowOffset = 37 * SM20_RETRIEVABILITY_BINS;
  for (let b = 0; b < SM20_RETRIEVABILITY_BINS; b += 1) {
    totalCalibrationCases += Math.round(matrix.retrievabilityPredSum[countRowOffset + b]!);
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
 * `0x00bc7400`, `0x00bc9340`, `0x00bc8380`).
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
    matrix.sinc[i] = Number.isFinite(sVal) && sVal > 0 ? sVal : 1.0;
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
    for (let i = 0; i < SM20_RETRIEVABILITY_CELLS; i += 1) {
      const pVal = retView.getFloat64(i * 8, true);
      const aVal = retView.getFloat64(SM20_RETRIEVABILITY_RECORD_BYTES + i * 8, true);
      matrix.retrievabilityPredSum[i] = Number.isFinite(pVal) ? pVal : 0;
      matrix.retrievabilityActualSum[i] = Number.isFinite(aVal) ? aVal : 0;
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

/**
 * Encode all 8 non-sleep `alg17/*.dat` files matching exact `sm20.exe` record layouts
 * (`0x00bc7fb0`, `0x00bc7280`, `0x00bc91c0`, `0x00bc85b0`).
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
  for (let i = 0; i < SM20_RETRIEVABILITY_CELLS; i += 1) {
    retView.setFloat64(i * 8, matrix.retrievabilityPredSum[i]!, true);
    retView.setFloat64(SM20_RETRIEVABILITY_RECORD_BYTES + i * 8, matrix.retrievabilityActualSum[i]!, true);
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

  let neighborCases = 0;
  let neighborWeightedSum = 0;
  for (let dd = -1; dd <= 1; dd += 1) {
    const nd = clamp(dIdx + dd, 1, 20);
    for (let ds = -1; ds <= 1; ds += 1) {
      const ns = clamp(sIdx + ds, 1, 20);
      for (let dr = -1; dr <= 1; dr += 1) {
        const nr = clamp(rIdx + dr, 1, 20);
        const nIdx = matrixIndex(nd, ns, nr);
        const c = matrix.sincCases[nIdx]!;
        if (c > 0) {
          neighborCases += c;
          neighborWeightedSum += c * matrix.sinc[nIdx]!;
        }
      }
    }
  }

  if (cellCases === 0 && neighborCases === 0) return prior;

  const wPrior = 1.0;
  const wExact = 10.0 * rationalSaturationZeroGuarded(cellCases, 500);
  const wNeighbor = 3.0 * rationalSaturationZeroGuarded(neighborCases, 1000);
  const neighborAvg = neighborCases > 0 ? neighborWeightedSum / neighborCases : prior;

  const blended = (wPrior * prior + wExact * cellSinc + wNeighbor * neighborAvg) / (wPrior + wExact + wNeighbor);
  return clamp(blended, 0.8, 20.0);
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

/** `0x00ce66e0` / `0x00ce6470`: post-review stability for passing grade (with early-review R damping). */
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
  const overdueCredit = Math.max(0.0, elapsedDays - safeS) * 0.5;
  return clamp((safeS + overdueCredit) * dampedScale, SM20_STABILITY_MIN, SM20_STABILITY_MAX);
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

/**
 * Incrementally record one review outcome across all 8 `alg17` arrays
 * (`0x00ce94a0`, `0x00ce7570`, `0x00cc69e0`, `0x00bc8380`).
 */
export function recordSm20Outcome(
  matrix: Sm20Matrix,
  outcome: {
    prevDifficulty01: number;
    prevStability: number;
    retrievability: number;
    nextStability: number;
    smGrade: number;
    prevReps?: number;
    prevLapses?: number;
    elapsedDays?: number;
  },
): void {
  const dIdx = difficulty01ToIndex20(outcome.prevDifficulty01);
  const sIdx = stabilityToIndex20(outcome.prevStability);
  const rIdx = retrievabilityToIndex20(outcome.retrievability);
  const idx = matrixIndex(dIdx, sIdx, rIdx);
  const passed = outcome.smGrade >= 3;

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
    const fiIdx = firstIntervalIndex(rIdx, lapsesToIndex21(prevLapses), ivlBin);
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

  // 0x00cc69e0: Retrievability.dat calibration bins (row 0 = primary SM-20 sums, row 37 = bin counts)
  const calBin = retrievabilityToCalibrationBin30(outcome.retrievability);
  matrix.retrievabilityPredSum[calBin] =
    matrix.retrievabilityPredSum[calBin]! + clamp(outcome.retrievability, 0, 1);
  if (passed) {
    matrix.retrievabilityActualSum[calBin] = matrix.retrievabilityActualSum[calBin]! + 1;
  }
  const countIdx = 37 * SM20_RETRIEVABILITY_BINS + calBin;
  matrix.retrievabilityPredSum[countIdx] = matrix.retrievabilityPredSum[countIdx]! + 1;

  // 0x00bc8380: DifficultyDistribution.dat 20-bin histogram
  const dBin0 = clamp(dIdx - 1, 0, SM20_DIFFICULTY_BINS - 1);
  matrix.difficultyDistribution[dBin0] = matrix.difficultyDistribution[dBin0]! + 1;
}

/**
 * Replay non-undone `graded` events (respecting `forget-reset` / `card-reset`) to
 * construct or update an SM-20 v3 matrix (`0x00ce94a0`).
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
          const smGrade = typeof rawSmGrade === "number" && Number.isFinite(rawSmGrade)
            ? clamp(Math.round(rawSmGrade), 0, 5)
            : gradeToSmGrade(typeof ev.payload.grade === "number" ? ev.payload.grade : 3);
          const prevS = prevCard.stability;
          const prevD01 = storedDifficultyTo01(prevCard.difficulty);
          const elapsedDays =
            prevCard.lastReview !== undefined && nextCard.lastReview !== undefined
              ? Math.max(0, (nextCard.lastReview - prevCard.lastReview) / 86_400_000)
              : Math.max(0, nextCard.elapsedDays ?? 0);
          const r = computeSm20Retrievability(elapsedDays, prevS);
          recordSm20Outcome(matrix, {
            prevDifficulty01: prevD01,
            prevStability: prevS,
            retrievability: r,
            nextStability: nextCard.stability,
            smGrade,
            prevReps: prevCard.reps,
            prevLapses: prevCard.lapses,
            elapsedDays,
          });
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
