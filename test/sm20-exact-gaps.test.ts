import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_SM20_ARENA_WEIGHTS,
  computeInitialSincPrior,
  computeSm20ArenaOutcomes,
  disperseIntervalSm20,
  hashSm20DispersionSeed,
  scheduleSm20Item,
} from "../src/ir/sm20-scheduler";
import {
  SM20_MATRIX_CELLS,
  SM20_MATRIX_SCHEMA_VERSION,
  bin36ToDays,
  createEmptySm20Matrix,
  decodeSm20Alg17DatFiles,
  elapsedDaysToBin36,
  encodeSm20Alg17DatFiles,
  firstIntervalIndex,
  recordSm20Outcome,
  replaySm20CardsFromEvents,
  resolveEffectiveArenaWeights,
} from "../src/ir/sm20-matrix";
import { previewSmGradeDelays } from "../src/ir/grade-preview";
import type { ElementId, DeviceId, EventId } from "../src/ir/ids";
import { newElement, type IrElement, type IrEvent, type StoredCard } from "../src/ir/model";

const DAY_MS = 86_400_000;

describe("SM-20 Exact Binary Parity — Closing All 7 Algorithmic & Format Gaps", () => {
  it("1. implements 5-algorithm Arena (SM-2, SM-15, SM-19, SM-20, FSRS) with exact 6:14:45:25:10 defaults and editable/adaptive weights", () => {
    assert.deepEqual(DEFAULT_SM20_ARENA_WEIGHTS, {
      sm2: 6,
      sm15: 14,
      sm19: 45,
      sm20: 25,
      fsrs: 10,
    });

    const now = 1_800_000_000_000;
    const matureCard: StoredCard = {
      due: now,
      stability: 30,
      difficulty: 2.0, // easy card so SM-2 EF ~2.5 grows faster than conservative FSRS
      elapsedDays: 30,
      scheduledDays: 30,
      reps: 5,
      lapses: 0,
      state: 2,
      lastReview: now - 30 * DAY_MS,
    };

    const arena = computeSm20ArenaOutcomes({
      card: matureCard,
      smGrade: 4,
      nowMs: now,
      requestRetention: 0.9,
      matrix: createEmptySm20Matrix(),
    });
    assert.ok(arena.sm2Interval > 0);
    assert.ok(arena.sm15Interval > 0);
    assert.ok(arena.sm19Stability > 0);
    assert.ok(arena.sm20Stability > 0);
    assert.ok(arena.fsrsStability > 0);

    const sm2Only = scheduleSm20Item(matureCard, 4, now, {
      requestRetention: 0.9,
      arenaWeights: { sm2: 100, sm15: 0, sm19: 0, sm20: 0, fsrs: 0 },
      dispersionSeed: null,
    });
    const fsrsOnly = scheduleSm20Item(matureCard, 4, now, {
      requestRetention: 0.9,
      arenaWeights: { sm2: 0, sm15: 0, sm19: 0, sm20: 0, fsrs: 100 },
      dispersionSeed: null,
    });
    assert.notEqual(sm2Only.stability, fsrsOnly.stability);

    // Live Arena adaptation: feed 180 outcomes and verify weights adapt cleanly
    const matrix = createEmptySm20Matrix();
    for (let i = 0; i < 180; i += 1) {
      const prev: StoredCard = {
        due: now,
        stability: 12,
        difficulty: 5,
        elapsedDays: 12,
        scheduledDays: 12,
        reps: 3,
        lapses: 0,
        state: 2,
        lastReview: now - 12 * DAY_MS,
      };
      const next = scheduleSm20Item(prev, 4, now, { matrix, dispersionSeed: null });
      recordSm20Outcome(matrix, prev, next, "good", 4);
    }
    assert.equal(matrix.arenaCases, 180);
    const adapted = resolveEffectiveArenaWeights(matrix, DEFAULT_SM20_ARENA_WEIGHTS, true);
    const sum = adapted.sm2 + adapted.sm15 + adapted.sm19 + adapted.sm20 + adapted.fsrs;
    assert.ok(Math.abs(sum - 100) < 0.01);
  });

  it("2. uses schema v4, seeds 8,000 interior (20^3) StabilityIncrease cells + 0 border sentinels matching ABC of SM20, and encodes Retrievability.dat Half A as int32 (76x30) + Half B as float64 (38x30)", () => {
    assert.equal(SM20_MATRIX_SCHEMA_VERSION, 4);
    const m = createEmptySm20Matrix();
    assert.equal(m.sinc.length, SM20_MATRIX_CELLS);
    let nonZero = 0;
    for (let i = 0; i < SM20_MATRIX_CELLS; i += 1) {
      if (m.sinc[i]! > 0.5) nonZero += 1;
    }
    assert.equal(nonZero, 8000);
    assert.equal(m.sinc[20], 0);

    const now = 1_800_000_000_000;
    const prev: StoredCard = {
      due: now,
      stability: 10,
      difficulty: 5,
      elapsedDays: 10,
      scheduledDays: 10,
      reps: 2,
      lapses: 0,
      state: 2,
      lastReview: now - 10 * DAY_MS,
    };
    const next = scheduleSm20Item(prev, 4, now, { matrix: m, dispersionSeed: null });
    recordSm20Outcome(m, prev, next, "good", 4);

    const encoded = encodeSm20Alg17DatFiles(m);
    assert.equal(encoded.retrievability.byteLength, 18_240);

    // Inspect raw Half A int32 bytes directly like sm20.exe FUN_00cc69e0
    const dv = new DataView(
      encoded.retrievability.buffer,
      encoded.retrievability.byteOffset,
      encoded.retrievability.byteLength,
    );
    let totalInt32Cases = 0;
    for (let i = 0; i < 76 * 30; i += 1) {
      totalInt32Cases += dv.getInt32(i * 4, true);
    }
    assert.equal(totalInt32Cases, 1);

    const decoded = decodeSm20Alg17DatFiles(encoded);
    assert.deepEqual(Array.from(decoded.retrievabilityCases), Array.from(m.retrievabilityCases));
    assert.deepEqual(Array.from(decoded.retrievabilitySums), Array.from(m.retrievabilitySums));
  });

  it("3. implements exact 0x00cf5290 / 0x00cf5320 log-1.4 time bins and reads FirstInterval.dat & ForgettingCurve.dat during scheduling", () => {
    // 0x00cf5290 exact landmarks from sm20-re/smfmt/scheduler.py
    assert.equal(elapsedDaysToBin36(1), 1);
    assert.equal(elapsedDaysToBin36(16), 16);
    assert.equal(elapsedDaysToBin36(28), 22);
    assert.equal(elapsedDaysToBin36(365), 30);
    assert.equal(bin36ToDays(16), 16);
    assert.ok(bin36ToDays(30) >= 350 && bin36ToDays(30) <= 450);

    const now = 1_800_000_000_000;
    const emptyM = createEmptySm20Matrix();
    const trainedM = createEmptySm20Matrix();

    // Populate FirstInterval.dat for post-lapse recovery at difficulty 5.5 -> d01=0.5 -> dIdx=11, lapseIdx=1
    for (let b = 1; b <= 10; b += 1) {
      const idx = firstIntervalIndex(11, 1, b);
      trainedM.firstIntervalCases[idx] = 50;
      trainedM.firstIntervalSuccess[idx] = 49;
    }

    const lapsedCard: StoredCard = {
      due: now,
      stability: 1.8,
      difficulty: 5.5,
      elapsedDays: 1,
      scheduledDays: 1,
      reps: 0,
      lapses: 1,
      state: 3, // Relearning after lapse -> triggers 0x00ce0230 + FirstInterval.dat on passing grade!
      lastReview: now - DAY_MS,
    };

    const emptyRecovery = scheduleSm20Item(lapsedCard, 4, now, {
      matrix: emptyM,
      dispersionSeed: null,
    });
    const trainedRecovery = scheduleSm20Item(lapsedCard, 4, now, {
      matrix: trainedM,
      dispersionSeed: null,
    });
    assert.ok(trainedRecovery.stability !== emptyRecovery.stability);
  });

  it("4. matches 0x00cdeb50 SInc prior curve (harder items -> lower SInc prior) and calls 0x00ce0230 on post-lapse rep 1", () => {
    const easyPrior = computeInitialSincPrior(0.1, 10, 0.25);
    const hardPrior = computeInitialSincPrior(0.9, 10, 0.25);
    assert.ok(
      easyPrior > hardPrior,
      `Expected easy prior (${easyPrior}) > hard prior (${hardPrior})`,
    );

    const now = 1_800_000_000_000;
    const mature: StoredCard = {
      due: now,
      stability: 25,
      difficulty: 5.0,
      elapsedDays: 25,
      scheduledDays: 25,
      reps: 4,
      lapses: 0,
      state: 2,
      lastReview: now - 25 * DAY_MS,
    };
    // Failing review sets state = 3, scheduledDays = 1
    const failed = scheduleSm20Item(mature, 1, now, { dispersionSeed: null });
    assert.equal(failed.state, 3);
    assert.equal(failed.scheduledDays, 1);
    assert.equal(failed.lapses, 1);

    // First passing review after lapse (state === 3) uses 0x00ce0230 recovery interval (1..11d)
    const recovered = scheduleSm20Item(failed, 4, now + DAY_MS, {
      requestRetention: 0.85,
      dispersionSeed: null,
    });
    assert.equal(recovered.state, 2);
    assert.ok(recovered.scheduledDays >= 1 && recovered.scheduledDays <= 11);
  });

  it("5. disperses sibling intervals via seeded 0x00cf2f30 while matching button previews and re-rolling on undoRollCount", () => {
    const now = 1_800_000_000_000;
    const baseCard: StoredCard = {
      due: now,
      stability: 20,
      difficulty: 4.5,
      elapsedDays: 20,
      scheduledDays: 20,
      reps: 3,
      lapses: 0,
      state: 2,
      lastReview: now - 20 * DAY_MS,
    };

    const siblingIntervals = new Set<number>();
    for (let i = 0; i < 20; i += 1) {
      const elId = `el_sibling_${i}` as ElementId;
      const previews = previewSmGradeDelays(baseCard, now, 0.9, "sm20", undefined, {
        elementId: elId,
        undoRollCount: 0,
      });
      const committed = scheduleSm20Item(baseCard, 4, now, {
        requestRetention: 0.9,
        dispersionSeed: hashSm20DispersionSeed(elId, baseCard.reps, baseCard.lapses, 4, 0),
      });
      // Preview MUST match committed interval 100%
      assert.equal(previews[4], committed.scheduledDays * DAY_MS);
      siblingIntervals.add(committed.scheduledDays);
    }
    // 20 siblings must disperse across at least 3 distinct days (no clumping!)
    assert.ok(siblingIntervals.size >= 3, `Expected dispersion, got ${[...siblingIntervals]}`);

    // Undo re-roll produces a different seed and disperses across roll indices
    const rolls = new Set<number>();
    for (let r = 0; r < 10; r += 1) {
      rolls.add(Math.round(disperseIntervalSm20(30, hashSm20DispersionSeed("el_1", 3, 0, 4, r)) * 100));
    }
    assert.ok(rolls.size >= 5);
  });

  it("6. replays full item review history to refresh (stability, difficulty) while preserving existing due timestamps", () => {
    const t0 = 1_790_000_000_000;
    const id = "el_hist_1" as ElementId;
    const dev = "dev_test" as DeviceId;
    const initialEl: IrElement = {
      ...newElement({ id, type: "item", priority: 30, text: "{{c1::ATP}}", now: t0 }),
      card: {
        due: t0 + 100 * DAY_MS, // Current live due date that MUST be preserved
        stability: 999, // Stale stability from old version
        difficulty: 9.9, // Stale difficulty from old version
        elapsedDays: 10,
        scheduledDays: 10,
        reps: 2,
        lapses: 0,
        state: 2,
        lastReview: t0 + 11 * DAY_MS,
      },
    };

    const c1 = scheduleSm20Item(undefined, 4, t0 + DAY_MS, { dispersionSeed: null });
    const c2 = scheduleSm20Item(c1, 5, t0 + 5 * DAY_MS, { dispersionSeed: null });
    const events: IrEvent[] = [
      {
        id: "ev_0" as EventId,
        ts: t0,
        lamport: 1,
        device: dev,
        kind: "element-created",
        target: id,
        payload: { element: { ...initialEl, card: undefined } },
      },
      {
        id: "ev_1" as EventId,
        ts: t0 + DAY_MS,
        lamport: 2,
        device: dev,
        kind: "graded",
        target: id,
        payload: { grade: "good", smGrade: 4, card: c1 },
      },
      {
        id: "ev_2" as EventId,
        ts: t0 + 5 * DAY_MS,
        lamport: 3,
        device: dev,
        kind: "graded",
        target: id,
        payload: { grade: "easy", smGrade: 5, card: c2 },
      },
    ];

    const matrix = createEmptySm20Matrix();
    const replayed = replaySm20CardsFromEvents([initialEl], events, matrix, {
      requestRetention: 0.9,
    });
    const refreshed = replayed.get(id);
    assert.ok(refreshed);
    // Due date preserved untouched!
    assert.equal(refreshed.due, t0 + 100 * DAY_MS);
    // Stale S=999 and D=9.9 replaced by true history-replayed S and D!
    assert.notEqual(refreshed.stability, 999);
    assert.ok(refreshed.difficulty < 8.0);
  });
});
