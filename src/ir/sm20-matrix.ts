import type { Grade } from "../fsrs";
import { rationalSaturationZeroGuarded, roundHalfToEven } from "../sm18-ir-mechanics";
import type { IrEvent, StoredCard } from "./model";
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
} from "./sm20-scheduler";

export const SM20_MATRIX_SCHEMA_VERSION = 2;
export const SM20_MATRIX_DIM = 21;
export const SM20_MATRIX_STRIDE_D = 441; // 0x1b9
export const SM20_MATRIX_STRIDE_S = 21; // 0x15
export const SM20_MATRIX_CELLS = 9261; // 21 * 21 * 21
export const SM20_SINC_DAT_BYTES = SM20_MATRIX_CELLS * 8; // 0x12168 = 74,088 B
export const SM20_CASES_DAT_BYTES = SM20_MATRIX_CELLS * 4; // 0x90b4 = 37,044 B

export interface Sm20Matrix {
  sinc: Float64Array;
  sincCases: Uint32Array;
  recall: Uint32Array;
  recallCases: Uint32Array;
}

export interface Sm20MatrixSnapshot {
  sinc: number[];
  sincCases: number[];
  recall: number[];
  recallCases: number[];
}

export interface Sm20MatrixStats {
  totalSincCases: number;
  totalRecallCases: number;
  populatedSincCells: number;
  populatedRecallCells: number;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * 1-based `(dIdx, sIdx, rIdx)` in `[1..20]^3` -> 0-based flat `[0..9260]` index.
 * Matches `FUN_00cde2d0` (`0x00cde2d0`) & `0x00cc58d0`:
 * `(dIdx - 1) * 441 + (sIdx - 1) * 21 + (rIdx - 1)` (slot 20 on each axis is trailing sentinel).
 */
export function matrixIndex(dIdx: number, sIdx: number, rIdx: number): number {
  const d = clamp(Math.trunc(dIdx), 1, 20) - 1;
  const s = clamp(Math.trunc(sIdx), 1, 20) - 1;
  const r = clamp(Math.trunc(rIdx), 1, 20) - 1;
  return d * SM20_MATRIX_STRIDE_D + s * SM20_MATRIX_STRIDE_S + r;
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

/** Seed an empty 21x21x21 SM-20 matrix with analytical priors (`0x00cde2d0`). */
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

  return { sinc, sincCases, recall, recallCases };
}

export function cloneSm20Matrix(matrix: Sm20Matrix): Sm20Matrix {
  return {
    sinc: new Float64Array(matrix.sinc),
    sincCases: new Uint32Array(matrix.sincCases),
    recall: new Uint32Array(matrix.recall),
    recallCases: new Uint32Array(matrix.recallCases),
  };
}

export function snapshotSm20Matrix(matrix: Sm20Matrix): Sm20MatrixSnapshot {
  return {
    sinc: Array.from(matrix.sinc),
    sincCases: Array.from(matrix.sincCases),
    recall: Array.from(matrix.recall),
    recallCases: Array.from(matrix.recallCases),
  };
}

export function restoreSm20Matrix(snapshot: Sm20MatrixSnapshot): Sm20Matrix {
  if (
    !Array.isArray(snapshot.sinc) || snapshot.sinc.length !== SM20_MATRIX_CELLS ||
    !Array.isArray(snapshot.sincCases) || snapshot.sincCases.length !== SM20_MATRIX_CELLS ||
    !Array.isArray(snapshot.recall) || snapshot.recall.length !== SM20_MATRIX_CELLS ||
    !Array.isArray(snapshot.recallCases) || snapshot.recallCases.length !== SM20_MATRIX_CELLS
  ) {
    throw new Error("Invalid SM-20 matrix snapshot dimensions");
  }
  return {
    sinc: Float64Array.from(snapshot.sinc),
    sincCases: Uint32Array.from(snapshot.sincCases),
    recall: Uint32Array.from(snapshot.recall),
    recallCases: Uint32Array.from(snapshot.recallCases),
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
  return { totalSincCases, totalRecallCases, populatedSincCells, populatedRecallCells };
}

/**
 * Parse raw SM-18/SM-20 `alg17/*.dat` binary matrices (`0x00bc7660`).
 */
export function parseSm20Alg17DatFiles(files: {
  sinc: Uint8Array;
  sincCases: Uint8Array;
  recall: Uint8Array;
  recallCases: Uint8Array;
}): Sm20Matrix {
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

  const sinc = new Float64Array(SM20_MATRIX_CELLS);
  const sincCases = new Uint32Array(SM20_MATRIX_CELLS);
  const recall = new Uint32Array(SM20_MATRIX_CELLS);
  const recallCases = new Uint32Array(SM20_MATRIX_CELLS);

  const sincView = new DataView(files.sinc.buffer, files.sinc.byteOffset, files.sinc.byteLength);
  const scView = new DataView(files.sincCases.buffer, files.sincCases.byteOffset, files.sincCases.byteLength);
  const rView = new DataView(files.recall.buffer, files.recall.byteOffset, files.recall.byteLength);
  const rcView = new DataView(files.recallCases.buffer, files.recallCases.byteOffset, files.recallCases.byteLength);

  for (let i = 0; i < SM20_MATRIX_CELLS; i += 1) {
    const sVal = sincView.getFloat64(i * 8, true);
    sinc[i] = Number.isFinite(sVal) && sVal > 0 ? sVal : 1.0;
    sincCases[i] = scView.getUint32(i * 4, true);
    recall[i] = rView.getUint32(i * 4, true);
    recallCases[i] = rcView.getUint32(i * 4, true);
  }

  return { sinc, sincCases, recall, recallCases };
}

/**
 * Empirical forgetting-curve calibration (`FUN_00ce5140` + `0x00a8d320` + `FUN_00ce6c80`).
 * Fits weighted linear regression `Recall = A * R + B` across `rIdx = 1..20`
 * with weights `round(cases) + 1e-5` (`0x00a8d320`) and empty-bin fallback
 * `0.64 * x + 0.3` (`0x00ce5140`), blended with `analyticalR` by
 * `totalCases / (totalCases + 3.5)` (`0x00ce6c80`).
 */
export function calibrateSm20Retrievability(
  matrix: Sm20Matrix,
  dIdx: number,
  sIdx: number,
  analyticalR: number,
): number {
  const cleanR = clamp(analyticalR, SM20_RETRIEVABILITY_MIN, SM20_RETRIEVABILITY_MAX);
  let totalCases = 0;
  for (let rIdx = 1; rIdx <= 20; rIdx += 1) {
    totalCases += matrix.recallCases[matrixIndex(dIdx, sIdx, rIdx)]!;
  }
  if (totalCases === 0) return cleanR;

  // ComputeWeightedLinearRegression (0x00a8d320): weight = round(cases) + 1e-5
  let sumW = 0;
  let sumWX = 0;
  let sumWY = 0;
  for (let rIdx = 1; rIdx <= 20; rIdx += 1) {
    const idx = matrixIndex(dIdx, sIdx, rIdx);
    const cases = matrix.recallCases[idx]!;
    const w = Math.round(cases) + 1e-5;
    const x = index20ToRetrievabilityAxis(rIdx);
    const y = cases > 0
      ? clamp(matrix.recall[idx]! / cases, 0.0, 1.0)
      : 0.64 * x + 0.3;
    sumW += w;
    sumWX += w * x;
    sumWY += w * y;
  }
  if (sumW <= 0) return cleanR;
  const meanX = sumWX / sumW;
  const meanY = sumWY / sumW;

  let num = 0;
  let den = 0;
  for (let rIdx = 1; rIdx <= 20; rIdx += 1) {
    const idx = matrixIndex(dIdx, sIdx, rIdx);
    const cases = matrix.recallCases[idx]!;
    const w = Math.round(cases) + 1e-5;
    const x = index20ToRetrievabilityAxis(rIdx);
    const y = cases > 0
      ? clamp(matrix.recall[idx]! / cases, 0.0, 1.0)
      : 0.64 * x + 0.3;
    const dx = x - meanX;
    num += w * dx * (y - meanY);
    den += w * dx * dx;
  }
  const slope = den > 1e-12 ? num / den : 0.64;
  const intercept = meanY - slope * meanX;
  const empR = clamp(slope * cleanR + intercept, SM20_RETRIEVABILITY_MIN, SM20_RETRIEVABILITY_MAX);
  const alpha = totalCases / (totalCases + 3.5);
  return clamp(alpha * empR + (1.0 - alpha) * cleanR, SM20_RETRIEVABILITY_MIN, SM20_RETRIEVABILITY_MAX);
}

/**
 * 3x3x3 SInc lookup (`FUN_00cde4a0`).
 * Blends `prior` (weight 1), exact cell `sinc` (weight `10 * sat(cellCases, 500)`),
 * and 3x3x3 neighborhood case-weighted average (weight `3 * sat(neighborCases, 1000)`).
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
  if (smGrade <= 2) return clamp(s, 0.8, 1.0);
  if (smGrade === 3) return clamp(s, 1.02, 12.0);
  if (smGrade === 4) return clamp(s, 1.05, 20.0);
  return clamp(s, 1.1, 20.0);
}

/** `0x00bc6ff0`: update difficulty [0, 1] from SM-20 grade (0..5). */
export function updateSm20Difficulty(d01: number, smGrade: number): number {
  const prev = clamp(Number.isFinite(d01) ? d01 : (5 - 1) / 9, 0.0, 1.0);
  if (smGrade <= 2) return clamp(prev + 0.04, 0.0, 1.0);
  if (smGrade === 3) return clamp(prev + 0.015, 0.0, 1.0);
  if (smGrade === 4) return clamp(prev - 0.01, 0.0, 1.0);
  return clamp(prev - 0.025, 0.0, 1.0);
}

/** `0x00ce66e0`: post-review stability for passing grade (with early-review R damping). */
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

/** `0x00ce6470`: blended next stability. */
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

/** `0x00ce0460` / `0x00ce0600`: post-lapse stability. */
export function computePostLapseStability(prevS: number, lapses: number): number {
  const safeS = clamp(prevS, SM20_STABILITY_MIN, SM20_STABILITY_MAX);
  const factor = lapses > 1 ? 0.25 : 0.3;
  return clamp(Math.min(safeS * factor, 2.0), SM20_STABILITY_MIN, SM20_STABILITY_MAX);
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
 * Incrementally record one review outcome into the 4 cubes (`0x00ce94a0` / `0x00bc7b40`).
 */
export function recordSm20Outcome(
  matrix: Sm20Matrix,
  outcome: {
    prevDifficulty01: number;
    prevStability: number;
    retrievability: number;
    nextStability: number;
    smGrade: number;
  },
): void {
  const dIdx = difficulty01ToIndex20(outcome.prevDifficulty01);
  const sIdx = stabilityToIndex20(outcome.prevStability);
  const rIdx = retrievabilityToIndex20(outcome.retrievability);
  const idx = matrixIndex(dIdx, sIdx, rIdx);

  const prevRCases = matrix.recallCases[idx]!;
  matrix.recallCases[idx] = prevRCases + 1;
  if (outcome.smGrade >= 3) {
    matrix.recall[idx] = matrix.recall[idx]! + 1;
  }

  if (outcome.smGrade >= 3 && outcome.prevStability > 0 && outcome.nextStability > 0) {
    const observedSinc = clampSincBySmGrade(outcome.nextStability / outcome.prevStability, outcome.smGrade);
    const prevSCases = matrix.sincCases[idx]!;
    const nextSCases = prevSCases + 1;
    const prevSinc = matrix.sinc[idx]!;
    // Running mean update
    matrix.sinc[idx] = prevSCases === 0
      ? observedSinc
      : prevSinc + (observedSinc - prevSinc) / nextSCases;
    matrix.sincCases[idx] = nextSCases;
  }
}

/**
 * Replay non-undone `graded` events (respecting `forget-reset` / `card-reset`) to
 * construct or update an SM-20 matrix (`0x00ce94a0`).
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
          });
        }
        cardState.set(ev.target, nextCard);
      }
    }

    if (!seenAfter && ev.id === opts?.afterEventId) {
      seenAfter = true;
    }
  }

  return matrix;
}
