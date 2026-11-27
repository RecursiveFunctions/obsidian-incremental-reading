import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeCalibrationAndModelBenchmark,
  computeIntervalChoiceEnsemble,
  computeItemMemoryCurve,
  formatSm20RepetitionLogCsv,
  simulateLongHorizonWorkload,
  SM20_DEFAULT_ENSEMBLE_WEIGHTS,
} from "../src/ir/sm20-analytics";
import { checkGradeDivergence } from "../src/ir/grade-divergence";
import { computeElementTelemetry } from "../src/ir/element-telemetry";
import { newDeviceId, newElementId, newEventId } from "../src/ir/ids";
import { newElement, type IrEvent, type StoredCard } from "../src/ir/model";
import { scheduleSm20Item } from "../src/ir/sm20-scheduler";

const NOW = 1_760_000_000_000;
const DAY_MS = 86_400_000;
const DEV = newDeviceId();

test("computeIntervalChoiceEnsemble matches 0x00d8b990 weights (6/14/45/25/10), weighted mean, and left/right SD (0x00cec060)", () => {
  assert.deepEqual(SM20_DEFAULT_ENSEMBLE_WEIGHTS, {
    sm2: 6,
    sm15: 14,
    sm18: 45,
    sm20: 25,
    fsrs: 10,
  });

  const res = computeIntervalChoiceEnsemble({
    sm2Days: 10,
    sm15Days: 12,
    sm18Days: 20,
    sm20Days: 24,
    fsrsDays: 18,
  });
  // (6*10 + 14*12 + 45*20 + 25*24 + 10*18) / 100 = (60 + 168 + 900 + 600 + 180) / 100 = 19.08 -> 19d
  assert.ok(Math.abs(res.weightedAverageRaw - 19.08) < 1e-9);
  assert.equal(res.weightedAverageDays, 19);
  assert.equal(res.minIntervalDays, 10);
  assert.equal(res.maxIntervalDays, 24);
  assert.ok(res.leftSdDays > 0);
  assert.ok(res.rightSdDays > 0);
});

test("checkGradeDivergence exposes weightedAverageDays and minIntervalDays from TIntervalChoiceForm", () => {
  const card: StoredCard = {
    due: NOW,
    stability: 30,
    difficulty: 2.0,
    elapsedDays: 30,
    scheduledDays: 30,
    reps: 6,
    lapses: 0,
    state: 2,
    lastReview: NOW - 30 * DAY_MS,
  };
  const sm20Next = scheduleSm20Item(card, "easy", NOW, 0.9);
  const div = checkGradeDivergence(card, sm20Next, "easy", NOW, 1.05, 2, 20, {
    primaryScheduler: "sm20",
    effectiveRetention: 0.9,
  });
  assert.ok(div !== null);
  assert.ok(div.ensemble.weightedAverageDays >= div.ensemble.minIntervalDays);
  assert.ok(div.ensemble.weightedAverageDays <= div.ensemble.maxIntervalDays);
});

test("simulateLongHorizonWorkload (0x00e66750) respects dailyCapacity, accumulates backlog under low cap, and grows memorized items", () => {
  const items = Array.from({ length: 20 }, (_, i) => ({
    ...newElement({ id: newElementId(), type: "item", priority: (i + 1) * 4, now: NOW - 10 * DAY_MS }),
    card: {
      due: NOW - DAY_MS,
      stability: 5,
      difficulty: 5,
      elapsedDays: 5,
      scheduledDays: 5,
      reps: 2,
      lapses: 0,
      state: 2,
      lastReview: NOW - 6 * DAY_MS,
    },
  }));

  const capped = simulateLongHorizonWorkload({
    elements: items,
    nowMs: NOW,
    horizonDays: 30,
    dailyCapacity: 5,
    newItemsPerDay: 2,
    desiredRetention: 0.9,
    scheduler: "sm20",
    seed: 42,
  });
  assert.equal(capped.days.length, 30);
  assert.ok(capped.days.every((d) => d.reviewsDone <= 5));
  assert.equal(capped.days[0]!.reviewsDone, 5);
  assert.ok(capped.days[0]!.backlogCount >= 15);
  assert.ok(capped.summary.finalMemorizedCount > 20);
  assert.ok(capped.summary.meanRetention > 0.5 && capped.summary.meanRetention <= 1);

  const highCap = simulateLongHorizonWorkload({
    elements: items,
    nowMs: NOW,
    horizonDays: 30,
    dailyCapacity: 100,
    newItemsPerDay: 2,
    desiredRetention: 0.9,
    scheduler: "sm20",
    seed: 42,
  });
  assert.ok(highCap.summary.peakBacklog < capped.summary.peakBacklog);
});

test("computeItemMemoryCurve (TMemForm 0x00cdc860) clamps horizon to [14, 365] and attaches to ItemElementTelemetry", () => {
  const elId = newElementId();
  const c1 = scheduleSm20Item(undefined, 4, NOW - 10 * DAY_MS, 0.9);
  const c2 = scheduleSm20Item(c1, 4, NOW - 2 * DAY_MS, 0.9);
  const item = {
    ...newElement({ id: elId, type: "item", priority: 20, now: NOW - 10 * DAY_MS }),
    text: "What is SInc? {{c1::Stability increase}}",
    card: c2,
  };
  const ev1: IrEvent = {
    id: newEventId(),
    ts: NOW - 10 * DAY_MS,
    lamport: 1,
    device: DEV,
    kind: "graded",
    target: elId,
    payload: { card: c1, grade: 3, smGrade: 4 },
  };
  const ev2: IrEvent = {
    id: newEventId(),
    ts: NOW - 2 * DAY_MS,
    lamport: 2,
    device: DEV,
    kind: "graded",
    target: elId,
    payload: { card: c2, grade: 3, smGrade: 4 },
  };

  const curve = computeItemMemoryCurve(item, NOW, [ev1, ev2], 0.9);
  assert.ok(curve !== null);
  assert.ok(curve.horizonDays >= 14 && curve.horizonDays <= 365);
  assert.equal(curve.history.length, 2);
  assert.ok(curve.points.length >= 15);
  assert.ok(curve.points[0]!.retrievabilityPct > curve.points[curve.points.length - 1]!.retrievabilityPct);

  const tel = computeElementTelemetry({
    element: item,
    allElements: [item],
    nowMs: NOW,
    rawBodyText: item.text,
    activeScheduler: "sm20",
    requestRetention: 0.9,
    recentEvents: [ev1, ev2],
  });
  assert.equal(tel.kind, "item");
  assert.ok(tel.memoryCurve !== null && tel.memoryCurve !== undefined);
});

test("computeCalibrationAndModelBenchmark (0x00cc69e0, 0x00a96f00) and formatSm20RepetitionLogCsv (0x00ce16c0)", () => {
  const elId = newElementId();
  const c0: StoredCard = {
    due: NOW - 5 * DAY_MS,
    stability: 5,
    difficulty: 5,
    elapsedDays: 0,
    scheduledDays: 5,
    reps: 1,
    lapses: 0,
    state: 2,
    lastReview: NOW - 10 * DAY_MS,
  };
  const c1 = scheduleSm20Item(c0, 4, NOW - 5 * DAY_MS, 0.9);
  const c2 = scheduleSm20Item(c1, 1, NOW, 0.9);

  const events: IrEvent[] = [
    {
      id: newEventId(),
      ts: NOW - 10 * DAY_MS,
      lamport: 1,
      device: DEV,
      kind: "element-created",
      target: elId,
      payload: {
        element: {
          ...newElement({ id: elId, type: "item", priority: 25, now: NOW - 10 * DAY_MS }),
          card: c0,
        },
      },
    },
    {
      id: newEventId(),
      ts: NOW - 5 * DAY_MS,
      lamport: 2,
      device: DEV,
      kind: "graded",
      target: elId,
      payload: { card: c1, grade: 3, smGrade: 4, scheduler: "sm20" },
    },
    {
      id: newEventId(),
      ts: NOW,
      lamport: 3,
      device: DEV,
      kind: "graded",
      target: elId,
      payload: { card: c2, grade: 1, smGrade: 1, scheduler: "sm20" },
    },
  ];

  const bench = computeCalibrationAndModelBenchmark(events);
  assert.equal(bench.sampleCount, 2);
  assert.equal(bench.models.length, 4);
  for (const m of bench.models) {
    assert.ok(Number.isFinite(m.rmse) && m.rmse >= 0);
    assert.ok(Number.isFinite(m.brier) && m.brier >= 0);
    assert.ok(Number.isFinite(m.logLoss) && m.logLoss >= 0);
  }
  assert.equal(bench.calibrationBins.length, 10);

  const csv = formatSm20RepetitionLogCsv(events);
  const lines = csv.trim().split("\n");
  assert.equal(lines.length, 3); // header + 2 graded outcomes
  assert.match(lines[0]!, /Date,ElementId,Repetition,Lapses,SmGrade,UsedIntervalDays/);
});
