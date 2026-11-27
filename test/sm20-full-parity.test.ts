import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeBlendedForgettingCurveRetention,
  computePa20FailedStability,
  computePa20InitialDifficulty01,
  computePa20InitialStability,
  computePa20PassedStability,
   computePostLapseIntervalSm20,
  computeInitialUFactor,
  evaluatePa20TripleRetrievability,
  scheduleSm20Item,
  SM20_PA20_WEIGHTS,
  smGradeToFsrsGrade,
  updatePa20Difficulty01,
  updateSm20Difficulty01,
} from "../src/ir/sm20-scheduler";
import {
  createEmptySm20Matrix,
  encodeSm20Alg17DatFiles,
  foldSm20MatrixFromEvents,
  getSm20MatrixStats,
  parseSm20Alg17DatFiles,
  recordSm20Outcome,
  restoreSm20Matrix,
  SM20_DIFFICULTY_DIST_DAT_BYTES,
  SM20_FIRST_INTERVAL_RECORD_BYTES,
  SM20_FORGETTING_CURVE_RECORD_BYTES,
  SM20_MATRIX_SCHEMA_VERSION,
  SM20_RETRIEVABILITY_RECORD_BYTES,
  snapshotSm20Matrix,
} from "../src/ir/sm20-matrix";
import { scheduleItem } from "../src/ir/item-scheduler";
import { IrLedger, type VaultFs } from "../src/ir/ledger";
import { cloneDefaultSettings } from "../src/ir/settings-data";
import { resolveSm20SixPointDigit } from "../src/ir/review-keys";
import { newDeviceId, newElementId, newEventId } from "../src/ir/ids";
import { validateIrEvent, type IrEvent, type StoredCard } from "../src/ir/model";

const NOW = 1_760_000_000_000;
const DAY_MS = 86_400_000;

function memFs(): VaultFs {
  const files = new Map<string, string>();
  return {
    async exists(p) {
      return files.has(p);
    },
    async read(p) {
      const v = files.get(p);
      if (v === undefined) throw new Error(`ENOENT ${p}`);
      return v;
    },
    async write(p, data) {
      files.set(p, data);
    },
    async append(p, data) {
      files.set(p, (files.get(p) ?? "") + data);
    },
    async list(dir) {
      const pre = dir.endsWith("/") ? dir : dir + "/";
      const out: string[] = [];
      for (const k of files.keys()) {
        if (k.startsWith(pre) && !k.slice(pre.length).includes("/")) out.push(k);
      }
      return out;
    },
  };
}

test("SM20_PA20_WEIGHTS matches exact 35 IEEE-754 float64 table at 0x0115f4d0 in sm20.exe", () => {
  assert.equal(SM20_PA20_WEIGHTS.length, 35);
  assert.equal(SM20_PA20_WEIGHTS[0], 0.9286298950420208);
  assert.equal(SM20_PA20_WEIGHTS[10], 17.65771045770738);
  assert.equal(SM20_PA20_WEIGHTS[25], 42.21989471200275);
  assert.equal(SM20_PA20_WEIGHTS[31], -0.6915519353695037);
  assert.equal(SM20_PA20_WEIGHTS[34], 0.12374729387559685);

  assert.equal(computePa20InitialStability(4), 17.65771045770738);
  assert.equal(computePa20InitialStability(5), 77.77877780253718);
  assert.equal(computePa20InitialDifficulty01(4), 0.27244747048223983);
  assert.equal(computePa20InitialDifficulty01(0), 0.6895479373487655);

  // At elapsed === stability, triple-curve blend hits ~0.90
  const rAtS = evaluatePa20TripleRetrievability(100, 100, 4 / 9);
  assert.ok(Math.abs(rAtS - 0.9) < 0.005, `expected ~0.90, got ${rAtS}`);

  const dPass = updatePa20Difficulty01(0.444, 10, 0.9, 4);
  const dFail = updatePa20Difficulty01(0.444, 10, 0.9, 1);
  assert.ok(dPass < 0.444);
  assert.ok(dFail > 0.444);

  const sFail = computePa20FailedStability(dFail, 10, 0.9);
  const sPass3 = computePa20PassedStability(dPass, 10, 0.9, 10, 3);
  const sPass4 = computePa20PassedStability(dPass, 10, 0.9, 10, 4);
  const sPass5 = computePa20PassedStability(dPass, 10, 0.9, 10, 5);
  assert.ok(sFail < 10);
  assert.ok(sPass3 < sPass4 && sPass4 < sPass5);

  // computeBlendedForgettingCurveRetention uses exact 0x00cad6a0 constants
  assert.ok(Math.abs(computeBlendedForgettingCurveRetention(dPass, 10, 0.9, 10, 4) - sPass4) < 1e-12);
});

test("updateSm20Difficulty01 implements exact 0x00bc6ff0 BlendRetrievabilityWithLapsePrior", () => {
  // Pass at R = 0.9 -> target = (0.9 - 1.0 + 0.1) * 9 = 0; alpha = 0.2 -> 0.8 * prevD01
  const dOnTimePass = updateSm20Difficulty01(0.5, 0.9, 4, 3, 0);
  assert.ok(Math.abs(dOnTimePass - 0.4) < 1e-12);

  // Rep 2 lapse 0 uses alpha = 0.7 -> 0.3 * prevD01 at R = 0.9 pass
  const dRep2Pass = updateSm20Difficulty01(0.5, 0.9, 4, 2, 0);
  assert.ok(Math.abs(dRep2Pass - 0.15) < 1e-12);

  // Fail at R = 0.9 -> target = (0.9 - 0 + 0.1) * 9 = 9.0 -> clamped to [0,1] after blend
  const dFail = updateSm20Difficulty01(0.3, 0.9, 1, 3, 1);
  assert.equal(dFail, 1.0);
});

test("computePostLapseIntervalSm20 (0x00ce0230) and computeInitialUFactor (0x00cfa420)", () => {
  const ivLowFi = computePostLapseIntervalSm20(1.0, 4);
  const ivHighFi = computePostLapseIntervalSm20(1.0, 20);
  assert.ok(ivLowFi >= 1 && ivLowFi <= 11);
  assert.ok(ivHighFi >= ivLowFi && ivHighFi <= 11);

  const ufEasy = computeInitialUFactor(2, 1);
  const ufHard = computeInitialUFactor(18, 1);
  assert.ok(ufEasy > ufHard);
});

test("6-point SuperMemo grades (0..5) schedule monotonically and interoperate with FSRS-6", () => {
  const defaults = cloneDefaultSettings();
  assert.equal(defaults.gradingScale, "4-point");
  assert.equal(resolveSm20SixPointDigit("0"), 0);
  assert.equal(resolveSm20SixPointDigit("5"), 5);
  assert.equal(resolveSm20SixPointDigit("6"), null);

  assert.equal(smGradeToFsrsGrade(0), "again");
  assert.equal(smGradeToFsrsGrade(1), "again");
  assert.equal(smGradeToFsrsGrade(2), "again");
  assert.equal(smGradeToFsrsGrade(3), "hard");
  assert.equal(smGradeToFsrsGrade(4), "good");
  assert.equal(smGradeToFsrsGrade(5), "easy");

  const base: StoredCard = {
    due: NOW,
    stability: 10,
    difficulty: 5,
    elapsedDays: 10,
    scheduledDays: 10,
    reps: 3,
    lapses: 0,
    state: 2,
    lastReview: NOW - 10 * DAY_MS,
  };

  const g0 = scheduleSm20Item(base, 0, NOW, 0.9);
  const g1 = scheduleSm20Item(base, 1, NOW, 0.9);
  const g2 = scheduleSm20Item(base, 2, NOW, 0.9);
  const g3 = scheduleSm20Item(base, 3, NOW, 0.9);
  const g4 = scheduleSm20Item(base, 4, NOW, 0.9);
  const g5 = scheduleSm20Item(base, 5, NOW, 0.9);

  assert.ok(g0.lapses === 1 && g1.lapses === 1 && g2.lapses === 1);
  assert.ok(g0.stability <= g1.stability && g1.stability <= g2.stability);
  assert.ok(g3.lapses === 0 && g4.lapses === 0 && g5.lapses === 0);
  assert.ok(g3.stability < g4.stability && g4.stability < g5.stability);
  assert.ok(g3.scheduledDays <= g4.scheduledDays && g4.scheduledDays <= g5.scheduledDays);

  // scheduleItem accepts numeric smGrade 0..5 for both sm20 and fsrs
  const resSm20 = scheduleItem(base, 5, NOW, { primaryScheduler: "sm20", requestRetention: 0.9 });
  const resFsrs = scheduleItem(base, 2, NOW, { primaryScheduler: "fsrs", requestRetention: 0.9 });
  assert.equal(resSm20.stored.scheduledDays, g5.scheduledDays);
  assert.equal(resFsrs.stored.lapses, 1);

  assert.equal(
    validateIrEvent({
      id: newEventId(),
      ts: NOW,
      lamport: 1,
      device: newDeviceId(),
      kind: "graded",
      target: newElementId(),
      payload: { card: resSm20.stored, grade: 4, smGrade: 5, scheduler: "sm20" },
    }),
    null,
  );
});

test("Sm20Matrix schema v4 encodes/decodes all 8 alg17 .dat files and records rep-1, post-lapse, calibration & difficulty bins", () => {
  assert.equal(SM20_MATRIX_SCHEMA_VERSION, 4);
  assert.equal(SM20_FIRST_INTERVAL_RECORD_BYTES, 0xf810);
  assert.equal(SM20_FORGETTING_CURVE_RECORD_BYTES, 0x90);
  assert.equal(SM20_RETRIEVABILITY_RECORD_BYTES, 0x23a0);
  assert.equal(SM20_DIFFICULTY_DIST_DAT_BYTES, 0x50);

  const matrix = createEmptySm20Matrix();
  // Rep 1 (first forgetting curve)
  recordSm20Outcome(matrix, {
    prevDifficulty01: 0.3,
    prevStability: 4,
    retrievability: 0.9,
    nextStability: 12,
    smGrade: 4,
    prevReps: 1,
    prevLapses: 0,
    elapsedDays: 4,
  });
  // Post-lapse rep 1 (FirstInterval.dat)
  recordSm20Outcome(matrix, {
    prevDifficulty01: 0.7,
    prevStability: 2,
    retrievability: 0.85,
    nextStability: 6,
    smGrade: 4,
    prevReps: 1,
    prevLapses: 2,
    elapsedDays: 2,
  });

  const stats = getSm20MatrixStats(matrix);
  assert.equal(stats.totalForgettingCurveCases, 1);
  assert.equal(stats.totalFirstIntervalCases, 1);
  assert.equal(stats.totalCalibrationCases, 2);
  assert.equal(stats.totalDifficultyItems, 2);

  const encoded = encodeSm20Alg17DatFiles(matrix);
  assert.equal(encoded.firstInterval.byteLength, SM20_FIRST_INTERVAL_RECORD_BYTES * 2);
  assert.equal(encoded.forgettingCurve.byteLength, SM20_FORGETTING_CURVE_RECORD_BYTES * 2);
  assert.equal(encoded.retrievability.byteLength, SM20_RETRIEVABILITY_RECORD_BYTES * 2);
  assert.equal(encoded.difficultyDistribution.byteLength, SM20_DIFFICULTY_DIST_DAT_BYTES);

  const reparsed = parseSm20Alg17DatFiles(encoded);
  assert.deepEqual(getSm20MatrixStats(reparsed), stats);

  const snap = snapshotSm20Matrix(reparsed);
  assert.equal(snap.version, 4);
  const restored = restoreSm20Matrix(snap);
  assert.deepEqual(getSm20MatrixStats(restored), stats);
});

test("Upgrading v2 sm20-matrix.json preserves baseline + due dates while triggering v3 matrix rebuild", async () => {
  const fs = memFs();
  const ledger = new IrLedger(fs, { conflict: "clock-order" });
  await ledger.init({ hostname: "test-host" });
  const dev = await ledger.getDeviceId();
  const elId = newElementId();
  const preservedDue = NOW + 17 * DAY_MS;

  const ev1: IrEvent = {
    id: newEventId(),
    ts: NOW - 5 * DAY_MS,
    lamport: 1,
    device: dev,
    kind: "element-created",
    target: elId,
    payload: {
      element: {
        id: elId,
        type: "item",
        priority: 25,
        parentId: null,
        dismissed: false,
        created: NOW - 5 * DAY_MS,
        text: "Q {{c1::A}}",
        anchorState: "ok",
        card: {
          due: NOW,
          stability: 5,
          difficulty: 5,
          elapsedDays: 5,
          scheduledDays: 5,
          reps: 1,
          lapses: 0,
          state: 2,
          lastReview: NOW - 5 * DAY_MS,
        },
      },
    },
  };
  const ev2: IrEvent = {
    id: newEventId(),
    ts: NOW,
    lamport: 2,
    device: dev,
    kind: "graded",
    target: elId,
    payload: {
      card: {
        due: preservedDue,
        stability: 17,
        difficulty: 4.2,
        elapsedDays: 5,
        scheduledDays: 17,
        reps: 2,
        lapses: 0,
        state: 2,
        lastReview: NOW,
      },
      grade: 3,
      smGrade: 4,
      scheduler: "sm20",
    },
  };
  await ledger.appendEvents([ev1, ev2]);

  // Simulate legacy v2 sm20-matrix.json on disk with an imported baseline
  const baselineMatrix = createEmptySm20Matrix();
  baselineMatrix.sincCases[0] = 9;
  baselineMatrix.sinc[0] = 3.2;
  const legacyV2Json = {
    schemaVersion: 2,
    matrix: {
      version: 2,
      sinc: "",
      sincCases: "",
      recall: "",
      recallCases: "",
    },
    baseline: {
      version: 2,
      sinc: snapshotSm20Matrix(baselineMatrix).sinc,
      sincCases: snapshotSm20Matrix(baselineMatrix).sincCases,
      recall: snapshotSm20Matrix(baselineMatrix).recall,
      recallCases: snapshotSm20Matrix(baselineMatrix).recallCases,
    },
    baselineCursorEventId: ev1.id,
    headEventId: ev2.id,
    eventCount: 2,
  };
  await fs.write(".ir/sm20-matrix.json", JSON.stringify(legacyV2Json));

  const readBack = await ledger.readSm20Matrix();
  assert.ok(readBack !== null);
  assert.equal(readBack.schemaVersion, 2);
  assert.ok(readBack.baseline !== undefined);

  const rebuilt = foldSm20MatrixFromEvents([ev1, ev2], {
    baseline: readBack.baseline,
    afterEventId: readBack.baselineCursorEventId ?? undefined,
  });
  const rebuiltStats = getSm20MatrixStats(rebuilt);
  assert.equal(rebuilt.sincCases[0], 9);
  assert.equal(rebuiltStats.totalSincCases, 10);
  assert.equal(rebuiltStats.totalForgettingCurveCases, 1);

  // Verify ledger state keeps card due date completely untouched
  const state = await ledger.load();
  assert.equal(state.elements.get(elId)?.card?.due, preservedDue);
});
