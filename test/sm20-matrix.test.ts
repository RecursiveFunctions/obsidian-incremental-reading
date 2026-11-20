import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calibrateSm20Retrievability,
  createEmptySm20Matrix,
  foldSm20MatrixFromEvents,
  getSm20MatrixStats,
  lookupBlendedSinc,
  matrixIndex,
  parseSm20Alg17DatFiles,
  recordSm20Outcome,
  restoreSm20Matrix,
  retrievabilityToIndex20,
  SM20_CASES_DAT_BYTES,
  SM20_MATRIX_CELLS,
  SM20_SINC_DAT_BYTES,
  snapshotSm20Matrix,
} from "../src/ir/sm20-matrix";
import {
  difficulty01ToIndex20,
  scheduleSm20Item,
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
