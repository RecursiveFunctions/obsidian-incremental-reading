import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calibrateSm20Retrievability,
  computePostLapseStability,
  computePostReviewStability,
  createEmptySm20Matrix,
  foldSm20MatrixFromEvents,
  formatCategoryDifficultyDeviationCsv,
  formatSm20RecallDataCsv,
  getSm20MatrixStats,
  lookupBlendedSinc,
  matrixIndex,
  parseSm20Alg17DatFiles,
  reconcileRetentionMatrixOutliers,
  recordSm20Outcome,
  restoreSm20Matrix,
  retrievabilityToIndex20,
  SM20_CASES_DAT_BYTES,
  SM20_MATRIX_CELLS,
  SM20_SINC_DAT_BYTES,
  smoothSm20SincCube,
  snapshotSm20Matrix,
} from "../src/ir/sm20-matrix";
import { getLog2IntervalDistributionBucket } from "../src/sm18-ir-mechanics";
import { computeIntervalDistribution } from "../src/ir/stats";
import { newElement } from "../src/ir/model";
import {
  difficulty01ToIndex20,
  scheduleSm20Item,
  SM20_STABILITY_MAX,
  SM20_STABILITY_MIN,
  stabilityToIndex20,
} from "../src/ir/sm20-scheduler";
import { newDeviceId, newElementId, newEventId } from "../src/ir/ids";
import type { IrEvent, StoredCard } from "../src/ir/model";

const NOW = 1_760_000_000_000;
const DAY_MS = 86_400_000;
const DEV = newDeviceId();

test("empty SM-20 matrix (cases = 0) matches analytical scheduleSm20Item identically", () => {
  const empty = createEmptySm20Matrix();
  const stats = getSm20MatrixStats(empty);
  assert.equal(stats.totalSincCases, 0);
  assert.equal(stats.totalRecallCases, 0);

  const existing: StoredCard = {
    due: NOW,
    stability: 12,
    difficulty: 4.5,
    elapsedDays: 12,
    scheduledDays: 12,
    reps: 3,
    lapses: 0,
    state: 2,
    lastReview: NOW - 12 * DAY_MS,
  };

  for (const grade of ["again", "hard", "good", "easy"] as const) {
    assert.deepEqual(
      scheduleSm20Item(undefined, grade, NOW, 0.9, empty),
      scheduleSm20Item(undefined, grade, NOW, 0.9),
    );
    assert.deepEqual(
      scheduleSm20Item(existing, grade, NOW, 0.9, empty),
      scheduleSm20Item(existing, grade, NOW, 0.9),
    );
  }
});

test("parseSm20Alg17DatFiles decodes exact 74,088 B and 37,044 B 21x21x21 cubes and snapshots round-trip", () => {
  const sincBuf = new Uint8Array(SM20_SINC_DAT_BYTES);
  const sincCasesBuf = new Uint8Array(SM20_CASES_DAT_BYTES);
  const recallBuf = new Uint8Array(SM20_CASES_DAT_BYTES);
  const recallCasesBuf = new Uint8Array(SM20_CASES_DAT_BYTES);

  const sView = new DataView(sincBuf.buffer);
  const scView = new DataView(sincCasesBuf.buffer);
  const rView = new DataView(recallBuf.buffer);
  const rcView = new DataView(recallCasesBuf.buffer);

  const idx = matrixIndex(8, 5, 16);
  sView.setFloat64(idx * 8, 3.75, true);
  scView.setUint32(idx * 4, 42, true);
  rView.setUint32(idx * 4, 38, true);
  rcView.setUint32(idx * 4, 40, true);

  const parsed = parseSm20Alg17DatFiles({
    sinc: sincBuf,
    sincCases: sincCasesBuf,
    recall: recallBuf,
    recallCases: recallCasesBuf,
  });
  assert.equal(parsed.sinc.length, SM20_MATRIX_CELLS);
  assert.equal(parsed.sinc[idx], 3.75);
  assert.equal(parsed.sincCases[idx], 42);
  assert.equal(parsed.recall[idx], 38);
  assert.equal(parsed.recallCases[idx], 40);

  const stats = getSm20MatrixStats(parsed);
  assert.equal(stats.totalSincCases, 42);
  assert.equal(stats.totalRecallCases, 40);

  const restored = restoreSm20Matrix(snapshotSm20Matrix(parsed));
  assert.equal(restored.sinc[idx], 3.75);
  assert.equal(restored.sincCases[idx], 42);
});

test("recordSm20Outcome adapts lookupBlendedSinc and calibrateSm20Retrievability", () => {
  const matrix = createEmptySm20Matrix();
  const d01 = 0.4;
  const prevS = 10;
  const r = 0.9;
  const priorSinc = lookupBlendedSinc(undefined, d01, prevS, r);

  for (let i = 0; i < 60; i += 1) {
    recordSm20Outcome(matrix, {
      prevDifficulty01: d01,
      prevStability: prevS,
      retrievability: r,
      nextStability: prevS * 4.5,
      smGrade: 4,
    });
  }

  const adaptedSinc = lookupBlendedSinc(matrix, d01, prevS, r);
  assert.ok(Math.abs(adaptedSinc - priorSinc) > 0.1);

  const dIdx = difficulty01ToIndex20(d01);
  const sIdx = stabilityToIndex20(prevS);
  const rIdx = retrievabilityToIndex20(r);
  assert.equal(matrix.recallCases[matrixIndex(dIdx, sIdx, rIdx)], 60);
  assert.equal(matrix.recall[matrixIndex(dIdx, sIdx, rIdx)], 60);

  const calibratedR = calibrateSm20Retrievability(matrix, dIdx, sIdx, 0.85);
  assert.ok(calibratedR > 0.85);
});

test("foldSm20MatrixFromEvents respects grade-undone, forget-reset, and baseline cursor", () => {
  const elId = newElementId();
  const card0: StoredCard = {
    due: NOW,
    stability: 4,
    difficulty: 5,
    elapsedDays: 4,
    scheduledDays: 4,
    reps: 1,
    lapses: 0,
    state: 2,
    lastReview: NOW - 4 * DAY_MS,
  };
  const card1 = scheduleSm20Item(card0, "good", NOW, 0.9);
  const card2 = scheduleSm20Item(card1, "easy", NOW + 10 * DAY_MS, 0.9);

  const evCreate: IrEvent = {
    id: newEventId(),
    ts: NOW - 10 * DAY_MS,
    lamport: 1,
    device: DEV,
    kind: "element-created",
    target: elId,
    payload: {
      element: {
        id: elId,
        type: "item",
        priority: 30,
        parentId: null,
        dismissed: false,
        created: NOW - 10 * DAY_MS,
        text: "Q {{c1::A}}",
        anchorState: "ok",
        card: card0,
      },
    },
  };
  const evGrade1: IrEvent = {
    id: newEventId(),
    ts: NOW,
    lamport: 2,
    device: DEV,
    kind: "graded",
    target: elId,
    payload: { card: card1, grade: 3, smGrade: 4 },
  };
  const evGrade2: IrEvent = {
    id: newEventId(),
    ts: NOW + 10 * DAY_MS,
    lamport: 3,
    device: DEV,
    kind: "graded",
    target: elId,
    payload: { card: card2, grade: 4, smGrade: 5 },
  };
  const evUndo2: IrEvent = {
    id: newEventId(),
    ts: NOW + 11 * DAY_MS,
    lamport: 4,
    device: DEV,
    kind: "grade-undone",
    target: elId,
    payload: { eventId: evGrade2.id },
  };
  const evForget: IrEvent = {
    id: newEventId(),
    ts: NOW + 12 * DAY_MS,
    lamport: 5,
    device: DEV,
    kind: "mercy-postponed",
    target: elId,
    payload: { operation: "forget-reset", newDue: NOW + 13 * DAY_MS, card: card0 },
  };
  const evGrade3: IrEvent = {
    id: newEventId(),
    ts: NOW + 14 * DAY_MS,
    lamport: 6,
    device: DEV,
    kind: "graded",
    target: elId,
    payload: { card: card1, grade: 3, smGrade: 4 },
  };

  const rebuilt = foldSm20MatrixFromEvents([evCreate, evGrade1, evGrade2, evUndo2, evForget, evGrade3]);
  const stats = getSm20MatrixStats(rebuilt);
  // evGrade1 and evGrade3 are active; evGrade2 was undone
  assert.equal(stats.totalSincCases, 2);
  assert.equal(stats.totalRecallCases, 2);

  // With baseline + afterEventId = evGrade1.id, only evGrade3 is folded on top
  const baseline = snapshotSm20Matrix(createEmptySm20Matrix());
  const incremental = foldSm20MatrixFromEvents(
    [evCreate, evGrade1, evGrade2, evUndo2, evForget, evGrade3],
    { baseline, afterEventId: evGrade1.id },
  );
  const incStats = getSm20MatrixStats(incremental);
  assert.equal(incStats.totalSincCases, 1);
  assert.equal(incStats.totalRecallCases, 1);
});

test("computePostReviewStability dampens early-review stability gain proportionally as R approaches 1", () => {
  const prevS = 100;
  const sinc = 2.5;
  const onTime = computePostReviewStability(prevS, sinc, 100, 4, 0.9, 0.9);
  const earlyMid = computePostReviewStability(prevS, sinc, 50, 4, 0.95, 0.9);
  const earlyVeryHigh = computePostReviewStability(prevS, sinc, 1, 4, 0.999, 0.9);
  const earlyLimit = computePostReviewStability(prevS, sinc, 0, 4, 1.0, 0.9);

  assert.equal(onTime, 250);
  // At R=0.95 with target 0.9, scale factor is (1-0.95)/(1-0.9)=0.5 -> 1 + 1.5*0.5 = 1.75
  assert.ok(Math.abs(earlyMid - 175) < 1e-9);
  // As R -> 1, stability gain scales linearly to 0
  assert.ok(Math.abs(earlyVeryHigh - 101.5) < 1e-9);
  assert.equal(earlyLimit, prevS);
});

test("foldSm20MatrixFromEvents skips unmemorized first rep (prevReps === 0), overridden grades, and handles compacted afterEventId", () => {
  const elId = newElementId();
  const rep1Card = scheduleSm20Item(undefined, "good", NOW, 0.9);
  const rep2Card = scheduleSm20Item(rep1Card, "good", rep1Card.due, 0.9);
  const rep3Overridden = { ...rep2Card, due: rep1Card.due + 90 * DAY_MS, scheduledDays: 90 };

  const evCreate: IrEvent = {
    id: newEventId(),
    ts: NOW - DAY_MS,
    lamport: 1,
    device: DEV,
    kind: "element-created",
    target: elId,
    payload: {
      element: {
        id: elId,
        type: "item",
        priority: 30,
        parentId: null,
        dismissed: false,
        created: NOW - DAY_MS,
        text: "Q {{c1::A}}",
        anchorState: "ok",
      },
    },
  };
  const evFirstRep: IrEvent = {
    id: newEventId(),
    ts: NOW,
    lamport: 2,
    device: DEV,
    kind: "graded",
    target: elId,
    payload: { card: rep1Card, grade: 3 },
  };
  const evSecondRep: IrEvent = {
    id: newEventId(),
    ts: rep1Card.due,
    lamport: 3,
    device: DEV,
    kind: "graded",
    target: elId,
    payload: { card: rep2Card, grade: 3 },
  };
  const evOverridden: IrEvent = {
    id: newEventId(),
    ts: rep2Card.due,
    lamport: 4,
    device: DEV,
    kind: "graded",
    target: elId,
    payload: { card: rep3Overridden, grade: 3, overridden: true },
  };

  // Only evSecondRep had a valid memorized prevCard (reps >= 1) without override
  const matrix = foldSm20MatrixFromEvents([evCreate, evFirstRep, evSecondRep, evOverridden]);
  const stats = getSm20MatrixStats(matrix);
  assert.equal(stats.totalSincCases, 1);
  assert.equal(stats.totalRecallCases, 1);

  // If afterEventId was compacted away and is missing from events, fold all remaining events rather than dropping everything
  const compacted = foldSm20MatrixFromEvents([evCreate, evFirstRep, evSecondRep], {
    baseline: snapshotSm20Matrix(createEmptySm20Matrix()),
    afterEventId: "ev_compacted_away",
  });
  // Folding from compacted cursor keeps observations
  assert.equal(getSm20MatrixStats(compacted).totalSincCases, 1);
});

test("createEmptySm20Matrix matches ABC of SuperMemo 20 alg17/StabilityIncrease.dat 0-based layout and leading IEEE-754 values", () => {
  const empty = createEmptySm20Matrix();
  assert.equal(matrixIndex(1, 1, 1), 0);
  assert.equal(matrixIndex(1, 1, 2), 1);
  assert.equal(matrixIndex(1, 1, 3), 2);
  assert.equal(matrixIndex(1, 1, 4), 3);

  // Verified against ~/code/sm20-re/docs/findings/format/alg17.md (ABC of SuperMemo 20 StabilityIncrease.dat)
  assert.ok(Math.abs(empty.sinc[0]! - 14.244807054158343) < 1e-12);
  assert.ok(Math.abs(empty.sinc[1]! - 8.4637426) < 1e-4);
  assert.ok(Math.abs(empty.sinc[2]! - 6.2417) < 1e-4);
  assert.ok(Math.abs(empty.sinc[3]! - 5.0288) < 1e-4);

  let nonZero = 0;
  for (let i = 0; i < SM20_MATRIX_CELLS; i += 1) {
    if (empty.sinc[i]! > 0) nonZero += 1;
  }
  assert.equal(nonZero, 8000);
  // Trailing sentinel slot (index 20 on contiguous axis) remains 0
  assert.equal(empty.sinc[20], 0);
});

test("computePostLapseStability: ce0600 rises with difficulty, falls with lapses (#68)", () => {
  const easy = computePostLapseStability(10, 1, 0.1);
  const hard = computePostLapseStability(10, 1, 0.9);
  const manyLapses = computePostLapseStability(10, 8, 0.5);
  const fewLapses = computePostLapseStability(10, 1, 0.5);
  assert.ok(hard > easy);
  assert.ok(fewLapses > manyLapses);
  assert.ok(easy >= SM20_STABILITY_MIN && hard <= SM20_STABILITY_MAX);
});

test("reconcileRetentionMatrixOutliers: smooths Δ>0.5 low cells (#70)", () => {
  const raw = [0.9, 0.1, 0.85, 0.8];
  const fixed = reconcileRetentionMatrixOutliers(raw);
  assert.ok(fixed[1]! > 0.1);
  assert.ok(fixed[1]! < 0.9);
});

test("smoothSm20SincCube: averages neighbor cells (#68)", () => {
  const matrix = createEmptySm20Matrix();
  const idx = matrixIndex(5, 5, 5);
  matrix.sinc[idx] = 100;
  const before = matrix.sinc[idx]!;
  smoothSm20SincCube(matrix);
  assert.notEqual(matrix.sinc[idx]!, before);
  assert.ok(matrix.sinc[idx]! < before);
});

test("getLog2IntervalDistributionBucket (0x00cfc860) & computeIntervalDistribution match SM-20 13-bucket boundaries (#71)", () => {
  assert.equal(getLog2IntervalDistributionBucket(0), 1);
  assert.equal(getLog2IntervalDistributionBucket(1.0), 1);
  assert.equal(getLog2IntervalDistributionBucket(1.1), 1);
  assert.equal(getLog2IntervalDistributionBucket(1.11), 2);
  assert.equal(getLog2IntervalDistributionBucket(2.1), 2);
  assert.equal(getLog2IntervalDistributionBucket(2.11), 3);
  assert.equal(getLog2IntervalDistributionBucket(4.1), 3);
  assert.equal(getLog2IntervalDistributionBucket(2048.1), 12);
  assert.equal(getLog2IntervalDistributionBucket(2048.2), 13);
  assert.equal(getLog2IntervalDistributionBucket(10000), 13);

  const item1 = {
    ...newElement({ id: newElementId(), type: "item", priority: 20, now: NOW }),
    card: {
      due: NOW,
      stability: 1,
      difficulty: 5,
      elapsedDays: 0,
      scheduledDays: 1,
      reps: 1,
      lapses: 0,
      state: 2,
    },
  };
  const topic8 = {
    ...newElement({ id: newElementId(), type: "topic", priority: 30, now: NOW }),
    schedule: { due: NOW, interval: 8, aFactor: 2 },
  };
  const dist = computeIntervalDistribution([item1, topic8]);
  assert.equal(dist.buckets.length, 13);
  assert.equal(dist.buckets[0]!.items, 1);
  assert.equal(dist.buckets[3]!.reading, 1);
  assert.equal(dist.totalScheduled, 2);
});

test("formatSm20RecallDataCsv (0x00ce5500) & formatCategoryDifficultyDeviationCsv (0x00bc6410) emit diagnostic CSVs (#71)", () => {
  const matrix = createEmptySm20Matrix();
  recordSm20Outcome(matrix, {
    prevDifficulty01: 0.2,
    prevStability: 5,
    retrievability: 0.9,
    nextStability: 15,
    smGrade: 4,
  });
  const recallCsv = formatSm20RecallDataCsv(matrix);
  assert.match(recallCsv, /A in Recall=A\*R\+B/);
  assert.match(recallCsv, /B in Recall=A\*R\+B/);
  assert.match(recallCsv, /Repetition cases in Recall=A\*R\+B/);

  const rootA = {
    ...newElement({ id: newElementId(), type: "topic", priority: 10, now: NOW }),
    notePath: "Math/Algebra.md",
  };
  const rootB = {
    ...newElement({ id: newElementId(), type: "topic", priority: 20, now: NOW }),
    notePath: "History/Rome.md",
  };
  const hardItem = {
    ...newElement({ id: newElementId(), type: "item", priority: 15, now: NOW }),
    parentId: rootA.id,
    card: { due: NOW, stability: 4, difficulty: 9, elapsedDays: 2, scheduledDays: 4, reps: 5, lapses: 3, state: 2 },
  };
  const easyItem = {
    ...newElement({ id: newElementId(), type: "item", priority: 25, now: NOW }),
    parentId: rootB.id,
    card: { due: NOW, stability: 20, difficulty: 3, elapsedDays: 10, scheduledDays: 20, reps: 5, lapses: 0, state: 2 },
  };
  const diffCsv = formatCategoryDifficultyDeviationCsv([rootA, rootB, hardItem, easyItem]);
  assert.match(diffCsv, /Category,Items,MeanDifficulty,DeviationFromMean,MeanLapses/);
  assert.match(diffCsv, /Algebra/);
  assert.match(diffCsv, /Rome/);
});
