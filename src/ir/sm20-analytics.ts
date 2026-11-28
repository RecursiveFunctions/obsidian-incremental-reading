/**
 * SuperMemo 20 Analytics, Simulator, Memory Status Curve, Calibration &
 * TIntervalChoiceForm Ensemble (`~/code/sm20-re` Pillar B):
 * - `TIntervalChoiceForm` (`0x00cec060`, `0x00cef9b0`, `0x00cf2b80`, `0x00d8b990`)
 * - `SimulateDayRepetitionsUpToDayCapacity` (`0x00e66750`)
 * - `TMemForm.PaintBox1Paint` (`0x00cdc860`)
 * - `CalculateAlgorithmCalibrationCurves` (`0x00cc69e0`) & multi-model RMSE (`0x00a96f00`)
 * - `ExportRepetitionLogCsvToStatsFolder` (`0x00ce16c0`)
 */

import { cardToStored, schedule, storedToCard, type Grade } from "../fsrs";
import { sm2 } from "../scheduler";
import { roundHalfToEven } from "../sm18-ir-mechanics";
import type { PrimaryItemScheduler } from "./item-scheduler";
import type { IrElement, IrEvent, StoredCard } from "./model";
import { gradeToSmGrade, type Sm20Matrix } from "./sm20-matrix";
import {
  computeSm20Retrievability,
  evaluatePa20TripleRetrievability,
  scheduleSm20Item,
  smGradeToFsrsGrade,
  storedDifficultyTo01,
  type SmGrade,
} from "./sm20-scheduler";

const MS_PER_DAY = 86_400_000;

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

// --- 1. TIntervalChoiceForm Ensemble (`0x00d8b990`, `0x00cf2b80`, `0x00cec060`) ---

/** Exact default algorithm ensemble weights from `TDatabase_ReadDatabaseConfiguration` (`0x00d8b990`). */
export const SM20_DEFAULT_ENSEMBLE_WEIGHTS = {
  sm2: 6,
  sm15: 14,
  sm18: 45,
  sm20: 25,
  fsrs: 10,
} as const;

export interface IntervalChoiceEnsembleInput {
  sm2Days: number;
  sm15Days: number;
  sm18Days: number;
  sm20Days: number;
  fsrsDays: number;
  weights?: Partial<typeof SM20_DEFAULT_ENSEMBLE_WEIGHTS>;
}

export interface IntervalChoiceEnsembleResult {
  weightedAverageRaw: number;
  weightedAverageDays: number;
  minIntervalDays: number;
  maxIntervalDays: number;
  standardDeviationDays: number;
  leftSdDays: number;
  rightSdDays: number;
}

/**
 * Computes weighted average interval, min/max bounds, and asymmetric left/right
 * weighted standard deviation (`Str_WeightedAverageSSDLeftSD` at `0x00cec060`).
 */
export function computeIntervalChoiceEnsemble(
  input: IntervalChoiceEnsembleInput,
): IntervalChoiceEnsembleResult {
  const w = { ...SM20_DEFAULT_ENSEMBLE_WEIGHTS, ...(input.weights ?? {}) };
  const pairs: Array<{ ivl: number; weight: number }> = [
    { ivl: Math.max(1, input.sm2Days), weight: Math.max(0, w.sm2) },
    { ivl: Math.max(1, input.sm15Days), weight: Math.max(0, w.sm15) },
    { ivl: Math.max(1, input.sm18Days), weight: Math.max(0, w.sm18) },
    { ivl: Math.max(1, input.sm20Days), weight: Math.max(0, w.sm20) },
    { ivl: Math.max(1, input.fsrsDays), weight: Math.max(0, w.fsrs) },
  ];

  const totalW = pairs.reduce((s, p) => s + p.weight, 0);
  const weightedAverageRaw =
    totalW > 0
      ? pairs.reduce((s, p) => s + p.ivl * p.weight, 0) / totalW
      : pairs[3]!.ivl;
  const weightedAverageDays = Math.max(1, roundHalfToEven(weightedAverageRaw));

  const ivls = pairs.map((p) => Math.round(p.ivl));
  const minIntervalDays = Math.min(...ivls);
  const maxIntervalDays = Math.max(...ivls);

  let varAll = 0;
  let varLeft = 0;
  let wLeft = 0;
  let varRight = 0;
  let wRight = 0;
  for (const p of pairs) {
    const diff = p.ivl - weightedAverageRaw;
    varAll += p.weight * diff * diff;
    if (diff < 0) {
      varLeft += p.weight * diff * diff;
      wLeft += p.weight;
    } else if (diff > 0) {
      varRight += p.weight * diff * diff;
      wRight += p.weight;
    }
  }

  const standardDeviationDays = totalW > 0 ? Math.sqrt(varAll / totalW) : 0;
  const leftSdDays = wLeft > 0 ? Math.sqrt(varLeft / wLeft) : 0;
  const rightSdDays = wRight > 0 ? Math.sqrt(varRight / wRight) : 0;

  return {
    weightedAverageRaw,
    weightedAverageDays,
    minIntervalDays,
    maxIntervalDays,
    standardDeviationDays: Math.round(standardDeviationDays * 100) / 100,
    leftSdDays: Math.round(leftSdDays * 100) / 100,
    rightSdDays: Math.round(rightSdDays * 100) / 100,
  };
}

// --- 2. Long-Horizon Workload & Retention Simulator (`0x00e66750`) ----------

export interface WorkloadSimulatorInput {
  elements: Iterable<IrElement>;
  nowMs: number;
  /** Number of days to simulate (`1..5475`, SM-20 max `0x1564`). */
  horizonDays: number;
  /** Maximum item repetitions executed per day. */
  dailyCapacity: number;
  /** New recall items introduced per day. */
  newItemsPerDay: number;
  /** Target retention (`0.70..0.99`). */
  desiredRetention: number;
  scheduler: PrimaryItemScheduler;
  sm20Matrix?: Sm20Matrix;
  seed?: number;
}

export interface SimulatedDayPoint {
  day: number;
  reviewsDone: number;
  lapsesCount: number;
  backlogCount: number;
  memorizedCount: number;
  meanRetention: number;
}

export interface WorkloadSimulationResult {
  days: SimulatedDayPoint[];
  summary: {
    avgDailyReviews: number;
    peakDailyReviews: number;
    peakBacklog: number;
    finalBacklog: number;
    finalMemorizedCount: number;
    meanRetention: number;
    totalLapses: number;
  };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SimCardItem {
  priority: number;
  dueDay: number;
  lastReviewDay: number;
  card: StoredCard | undefined;
}

/**
 * Simulates daily repetitions up to `dailyCapacity` in priority order (`0x00e66750`),
 * carrying unreviewed due items into backlog and introducing `newItemsPerDay`.
 */
interface WorkloadSimulator {
  done(): boolean;
  currentDay(): number;
  horizon(): number;
  stepDay(): void;
  finish(): WorkloadSimulationResult;
}

function createWorkloadSimulator(input: WorkloadSimulatorInput): WorkloadSimulator {
  const horizon = clamp(Math.round(input.horizonDays), 1, 5475);
  const cap = Math.max(0, Math.round(input.dailyCapacity));
  const inflow = Math.max(0, Math.round(input.newItemsPerDay));
  const retention = clamp(input.desiredRetention, 0.7, 0.99);
  const rng = mulberry32(input.seed ?? 42);

  const pool: SimCardItem[] = [];
  for (const el of input.elements) {
    if (el.dismissed || el.type !== "item") continue;
    if (el.card && el.card.reps > 0) {
      const dueDay = Math.floor((el.card.due - input.nowMs) / MS_PER_DAY);
      const lastDay =
        el.card.lastReview !== undefined
          ? Math.floor((el.card.lastReview - input.nowMs) / MS_PER_DAY)
          : dueDay - Math.max(1, el.card.scheduledDays);
      pool.push({
        priority: el.priority,
        dueDay,
        lastReviewDay: lastDay,
        card: { ...el.card },
      });
    } else {
      pool.push({
        priority: el.priority,
        dueDay: 0,
        lastReviewDay: 0,
        card: undefined,
      });
    }
  }

  const days: SimulatedDayPoint[] = [];
  let sumReviews = 0;
  let peakDailyReviews = 0;
  let peakBacklog = 0;
  let sumRetentionWeighted = 0;
  let retentionWeightCount = 0;
  let totalLapses = 0;

  let day = 0;

  const stepDay = (): void => {
    if (day >= horizon) return;
    for (let k = 0; k < inflow; k += 1) {
      pool.push({
        priority: clamp(20 + rng() * 60, 0, 100),
        dueDay: day,
        lastReviewDay: day,
        card: undefined,
      });
    }

    const dueIndices: number[] = [];
    for (let i = 0; i < pool.length; i += 1) {
      if (pool[i]!.dueDay <= day) dueIndices.push(i);
    }
    dueIndices.sort(
      (ia, ib) => pool[ia]!.priority - pool[ib]!.priority || pool[ia]!.dueDay - pool[ib]!.dueDay,
    );

    const toReview = dueIndices.slice(0, cap);
    const backlogCount = Math.max(0, dueIndices.length - toReview.length);
    let dayLapses = 0;
    let dayRetSum = 0;
    let dayRetCount = 0;
    const simNowMs = input.nowMs + day * MS_PER_DAY;

    for (const idx of toReview) {
      const item = pool[idx]!;
      let recallProb = retention;
      if (item.card && item.card.reps > 0 && item.card.stability > 0) {
        const elapsed = Math.max(0, day - item.lastReviewDay);
        recallProb = computeSm20Retrievability(elapsed, item.card.stability);
        dayRetSum += recallProb;
        dayRetCount += 1;
      } else {
        recallProb = 0.88;
      }

      const roll = rng();
      let smGrade: SmGrade;
      if (roll > recallProb) {
        smGrade = 1;
        dayLapses += 1;
        totalLapses += 1;
      } else {
        const passRoll = roll / Math.max(1e-6, recallProb);
        smGrade = passRoll < 0.2 ? 3 : passRoll < 0.82 ? 4 : 5;
      }

      let nextCard: StoredCard;
      if (input.scheduler === "sm20") {
        const prevAligned = item.card
          ? { ...item.card, lastReview: input.nowMs + item.lastReviewDay * MS_PER_DAY }
          : undefined;
        nextCard = scheduleSm20Item(prevAligned, smGrade, simNowMs, retention, input.sm20Matrix);
      } else {
        const fsrsGrade: Grade = smGradeToFsrsGrade(smGrade);
        const prevAligned = item.card
          ? { ...item.card, lastReview: input.nowMs + item.lastReviewDay * MS_PER_DAY }
          : undefined;
        nextCard = cardToStored(
          schedule(storedToCard(prevAligned), fsrsGrade, new Date(simNowMs), retention),
        );
      }

      item.card = nextCard;
      item.lastReviewDay = day;
      item.dueDay = day + Math.max(1, nextCard.scheduledDays);
    }

    let memorizedCount = 0;
    for (const item of pool) {
      if (item.card && item.card.reps > 0) memorizedCount += 1;
    }

    const dayMeanRet = dayRetCount > 0 ? dayRetSum / dayRetCount : retention;
    if (dayRetCount > 0) {
      sumRetentionWeighted += dayRetSum;
      retentionWeightCount += dayRetCount;
    }
    sumReviews += toReview.length;
    if (toReview.length > peakDailyReviews) peakDailyReviews = toReview.length;
    if (backlogCount > peakBacklog) peakBacklog = backlogCount;

    days.push({
      day: day + 1,
      reviewsDone: toReview.length,
      lapsesCount: dayLapses,
      backlogCount,
      memorizedCount,
      meanRetention: Math.round(dayMeanRet * 1000) / 1000,
    });
    day += 1;
  };

  const finish = (): WorkloadSimulationResult => {
    const last = days[days.length - 1]!;
    return {
      days,
      summary: {
        avgDailyReviews: Math.round((sumReviews / horizon) * 10) / 10,
        peakDailyReviews,
        peakBacklog,
        finalBacklog: last?.backlogCount ?? 0,
        finalMemorizedCount: last?.memorizedCount ?? 0,
        meanRetention:
          Math.round(
            ((retentionWeightCount > 0 ? sumRetentionWeighted / retentionWeightCount : retention) *
              1000),
          ) / 1000,
        totalLapses,
      },
    };
  };

  return {
    done: () => day >= horizon,
    currentDay: () => day,
    horizon: () => horizon,
    stepDay,
    finish,
  };
}

/**
 * One full synchronous run. Fine for tests and small inputs; UI callers
 * should prefer the time-sliced variant below (#136).
 */
export function simulateLongHorizonWorkload(
  input: WorkloadSimulatorInput,
): WorkloadSimulationResult {
  const sim = createWorkloadSimulator(input);
  while (!sim.done()) sim.stepDay();
  return sim.finish();
}

export interface WorkloadSimulationAsyncOptions {
  /** Wall-clock budget per burst of simulated days (default 12 ms). */
  chunkMs?: number;
  /** Checked between bursts; returning true stops the run and yields undefined. */
  shouldAbort?: () => boolean;
  /** Called after each burst with the number of simulated days completed. */
  onProgress?: (completedDays: number, horizonDays: number) => void;
}

/**
 * Time-sliced `simulateLongHorizonWorkload` (#136): simulates days in
 * wall-clock bursts, yielding to the event loop between bursts so the UI
 * stays responsive during long horizons. Returns undefined when
 * `shouldAbort` cancelled the run.
 */
export async function simulateLongHorizonWorkloadAsync(
  input: WorkloadSimulatorInput,
  opts: WorkloadSimulationAsyncOptions = {},
): Promise<WorkloadSimulationResult | undefined> {
  const chunkMs = Math.max(1, opts.chunkMs ?? 12);
  const sim = createWorkloadSimulator(input);
  while (!sim.done()) {
    if (opts.shouldAbort?.()) return undefined;
    const startedAt = Date.now();
    do {
      sim.stepDay();
    } while (!sim.done() && Date.now() - startedAt < chunkMs);
    opts.onProgress?.(sim.currentDay(), sim.horizon());
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  if (opts.shouldAbort?.()) return undefined;
  return sim.finish();
}

// --- 3. Per-Item Memory Status Curve (`TMemForm.PaintBox1Paint` `0x00cdc860`) ---

export interface ItemRepetitionMarker {
  ts: number;
  smGrade: number;
  scheduledDays: number;
  stability: number;
  difficulty: number;
}

export interface ItemMemoryCurve {
  horizonDays: number;
  elapsedDaysNow: number;
  currentRetrievabilityPct: number;
  targetRetentionPct: number;
  dueOffsetDays: number;
  points: Array<{ dayOffset: number; retrievabilityPct: number }>;
  history: ItemRepetitionMarker[];
}

/**
 * Builds per-item forgetting curve projection (`14..365` days per `0x00cdc860`)
 * and chronological repetition history markers.
 */
export function computeItemMemoryCurve(
  element: IrElement,
  nowMs: number,
  events?: readonly IrEvent[],
  desiredRetention = 0.9,
): ItemMemoryCurve | null {
  if (element.type !== "item" || !element.card || element.card.reps <= 0 || element.card.stability <= 0) {
    return null;
  }
  const card = element.card;
  const stability = card.stability;
  const horizonDays = clamp(Math.round(stability * 1.5), 14, 365);
  const lastReviewMs = card.lastReview ?? nowMs - Math.max(0, card.scheduledDays) * MS_PER_DAY;
  const elapsedDaysNow = Math.max(0, (nowMs - lastReviewMs) / MS_PER_DAY);
  const currentRetrievabilityPct =
    Math.round(computeSm20Retrievability(elapsedDaysNow, stability) * 1000) / 10;
  const targetRetentionPct = Math.round(clamp(desiredRetention, 0.7, 0.99) * 1000) / 10;
  const dueOffsetDays = Math.round(((card.due - lastReviewMs) / MS_PER_DAY) * 10) / 10;

  const sampleCount = 24;
  const points: Array<{ dayOffset: number; retrievabilityPct: number }> = [];
  for (let i = 0; i <= sampleCount; i += 1) {
    const dayOffset = Math.round(((horizonDays * i) / sampleCount) * 100) / 100;
    const r = computeSm20Retrievability(dayOffset, stability);
    points.push({
      dayOffset,
      retrievabilityPct: Math.round(r * 1000) / 10,
    });
  }

  const history: ItemRepetitionMarker[] = [];
  if (events && events.length > 0) {
    const undone = new Set<string>();
    for (const ev of events) {
      if (ev.kind === "grade-undone" && typeof ev.payload.eventId === "string") {
        undone.add(ev.payload.eventId);
      }
    }
    const sorted = [...events]
      .filter((e) => e.target === element.id && e.kind === "graded" && !undone.has(e.id))
      .sort((a, b) => a.lamport - b.lamport || a.id.localeCompare(b.id));
    for (const ev of sorted) {
      const c = ev.payload.card as StoredCard | undefined;
      if (!c) continue;
      const rawSm = ev.payload.smGrade;
      const smGrade =
        typeof rawSm === "number" && Number.isFinite(rawSm)
          ? clamp(Math.round(rawSm), 0, 5)
          : gradeToSmGrade(typeof ev.payload.grade === "number" ? ev.payload.grade : 3);
      history.push({
        ts: ev.ts,
        smGrade,
        scheduledDays: c.scheduledDays,
        stability: Math.round(c.stability * 100) / 100,
        difficulty: Math.round(c.difficulty * 100) / 100,
      });
    }
  }

  return {
    horizonDays,
    elapsedDaysNow: Math.round(elapsedDaysNow * 10) / 10,
    currentRetrievabilityPct,
    targetRetentionPct,
    dueOffsetDays,
    points,
    history,
  };
}

// --- 4. Calibration Curves & Multi-Model Benchmark (`0x00cc69e0`, `0x00a96f00`) ---

export interface ModelBenchmarkMetrics {
  modelId: "SM-20 (PA20)" | "SM-18 (PA19)" | "FSRS-6" | "SM-2";
  brier: number;
  rmse: number;
  logLoss: number;
  ece: number;
}

export interface CalibrationBinSummary {
  binIndex: number;
  rangeLabel: string;
  count: number;
  predictedMean: number;
  actualRecallRate: number;
}

export interface CalibrationBenchmarkResult {
  sampleCount: number;
  models: ModelBenchmarkMetrics[];
  calibrationBins: CalibrationBinSummary[];
}

interface ReplayObservation {
  ts: number;
  elementId: string;
  rep: number;
  lapses: number;
  smGrade: number;
  passed: number;
  elapsedDays: number;
  prevStability: number;
  nextStability: number;
  prevD01: number;
  rSm20: number;
  rSm18: number;
  rFsrs: number;
  rSm2: number;
  sm20NextDays: number;
  fsrsNextDays: number;
}

function replayReviewObservations(events: readonly IrEvent[]): ReplayObservation[] {
  const undone = new Set<string>();
  for (const ev of events) {
    if (ev.kind === "grade-undone" && typeof ev.payload.eventId === "string") {
      undone.add(ev.payload.eventId);
    }
  }
  const sorted = [...events].sort((a, b) => a.lamport - b.lamport || a.id.localeCompare(b.id));
  const cardByTarget = new Map<string, StoredCard>();
  const out: ReplayObservation[] = [];

  for (const ev of sorted) {
    if (ev.kind === "grade-undone" || undone.has(ev.id)) continue;
    if (ev.kind === "element-created") {
      const el = ev.payload.element as { card?: StoredCard } | undefined;
      if (el?.card) cardByTarget.set(ev.target, el.card);
    } else if (ev.kind === "card-reset" || (ev.kind === "mercy-postponed" && ev.payload.operation === "forget-reset")) {
      const resetCard = ev.payload.card as StoredCard | undefined;
      if (resetCard) cardByTarget.set(ev.target, resetCard);
      else cardByTarget.delete(ev.target);
    } else if (ev.kind === "graded") {
      const nextCard = ev.payload.card as StoredCard | undefined;
      if (!nextCard) continue;
      const prevCard = cardByTarget.get(ev.target);
      if (prevCard && prevCard.reps > 0 && prevCard.stability > 0 && !ev.payload.overridden) {
        const rawSm = ev.payload.smGrade;
        const smGrade =
          typeof rawSm === "number" && Number.isFinite(rawSm)
            ? clamp(Math.round(rawSm), 0, 5)
            : gradeToSmGrade(typeof ev.payload.grade === "number" ? ev.payload.grade : 3);
        const passed = smGrade >= 3 ? 1 : 0;
        const elapsedDays =
          prevCard.lastReview !== undefined && nextCard.lastReview !== undefined
            ? Math.max(0, (nextCard.lastReview - prevCard.lastReview) / MS_PER_DAY)
            : Math.max(0, nextCard.elapsedDays ?? prevCard.scheduledDays ?? 1);
        const prevS = Math.max(0.7, prevCard.stability);
        const prevD01 = storedDifficultyTo01(prevCard.difficulty);

        const rSm18 = computeSm20Retrievability(elapsedDays, prevS);
        const rSm20 = evaluatePa20TripleRetrievability(Math.max(1e-5, elapsedDays), prevS, prevD01);
        // FSRS-6 power-law retrievability (1 + factor * t / S)^(-w20), default w20=0.5 -> factor=19/81
        const rFsrs = clamp(Math.pow(1 + (19 / 81) * (elapsedDays / prevS), -0.5), 0.005, 0.995);
        const sm2Ivl = Math.max(1, prevCard.scheduledDays || Math.round(prevS));
        const rSm2 = clamp(Math.exp((Math.log(0.9) * elapsedDays) / sm2Ivl), 0.005, 0.995);

        const sm20Pred = scheduleSm20Item(prevCard, smGrade as SmGrade, ev.ts, 0.9);
        const fsrsPred = cardToStored(
          schedule(storedToCard(prevCard), smGradeToFsrsGrade(smGrade as SmGrade), new Date(ev.ts), 0.9),
        );

        out.push({
          ts: ev.ts,
          elementId: ev.target,
          rep: prevCard.reps + 1,
          lapses: prevCard.lapses,
          smGrade,
          passed,
          elapsedDays,
          prevStability: prevS,
          nextStability: nextCard.stability,
          prevD01,
          rSm20,
          rSm18,
          rFsrs,
          rSm2,
          sm20NextDays: sm20Pred.scheduledDays,
          fsrsNextDays: fsrsPred.scheduledDays,
        });
      }
      cardByTarget.set(ev.target, nextCard);
    }
  }
  return out;
}

function scorePredictions(
  modelId: ModelBenchmarkMetrics["modelId"],
  obs: readonly ReplayObservation[],
  pickR: (o: ReplayObservation) => number,
): ModelBenchmarkMetrics {
  if (obs.length === 0) {
    return { modelId, brier: 0, rmse: 0, logLoss: 0, ece: 0 };
  }
  let sumSq = 0;
  let sumLogLoss = 0;
  const bins = Array.from({ length: 10 }, () => ({ n: 0, pSum: 0, ySum: 0 }));

  for (const o of obs) {
    const p = clamp(pickR(o), 1e-4, 1 - 1e-4);
    const diff = p - o.passed;
    sumSq += diff * diff;
    sumLogLoss += -(o.passed * Math.log(p) + (1 - o.passed) * Math.log(1 - p));
    const bIdx = clamp(Math.floor(p * 10), 0, 9);
    bins[bIdx]!.n += 1;
    bins[bIdx]!.pSum += p;
    bins[bIdx]!.ySum += o.passed;
  }

  const brier = sumSq / obs.length;
  const rmse = Math.sqrt(brier);
  const logLoss = sumLogLoss / obs.length;
  let ece = 0;
  for (const b of bins) {
    if (b.n > 0) {
      ece += (b.n / obs.length) * Math.abs(b.pSum / b.n - b.ySum / b.n);
    }
  }
  return {
    modelId,
    brier: Math.round(brier * 10000) / 10000,
    rmse: Math.round(rmse * 10000) / 10000,
    logLoss: Math.round(logLoss * 10000) / 10000,
    ece: Math.round(ece * 10000) / 10000,
  };
}

export function computeCalibrationAndModelBenchmark(
  events: readonly IrEvent[],
): CalibrationBenchmarkResult {
  const obs = replayReviewObservations(events);
  const models: ModelBenchmarkMetrics[] = [
    scorePredictions("SM-20 (PA20)", obs, (o) => o.rSm20),
    scorePredictions("SM-18 (PA19)", obs, (o) => o.rSm18),
    scorePredictions("FSRS-6", obs, (o) => o.rFsrs),
    scorePredictions("SM-2", obs, (o) => o.rSm2),
  ];

  const rawBins = Array.from({ length: 10 }, (_, i) => ({
    binIndex: i,
    rangeLabel: `${i * 10}–${(i + 1) * 10}%`,
    count: 0,
    predSum: 0,
    passSum: 0,
  }));
  for (const o of obs) {
    const bIdx = clamp(Math.floor(o.rSm20 * 10), 0, 9);
    rawBins[bIdx]!.count += 1;
    rawBins[bIdx]!.predSum += o.rSm20;
    rawBins[bIdx]!.passSum += o.passed;
  }
  const calibrationBins: CalibrationBinSummary[] = rawBins.map((b) => ({
    binIndex: b.binIndex,
    rangeLabel: b.rangeLabel,
    count: b.count,
    predictedMean: b.count > 0 ? Math.round((b.predSum / b.count) * 1000) / 1000 : (b.binIndex + 0.5) / 10,
    actualRecallRate: b.count > 0 ? Math.round((b.passSum / b.count) * 1000) / 1000 : 0,
  }));

  return {
    sampleCount: obs.length,
    models,
    calibrationBins,
  };
}

// --- 5. SM-20 Repetition Log CSV Export (`0x00ce16c0`) ----------------------

function csvEscape(cell: string): string {
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

export function formatSm20RepetitionLogCsv(events: readonly IrEvent[]): string {
  const obs = replayReviewObservations(events);
  const lines = [
    "Date,ElementId,Repetition,Lapses,SmGrade,UsedIntervalDays,StabilityBefore,StabilityAfter,Difficulty01,PredictedR,SM20Interval,FSRSInterval",
  ];
  for (const o of obs) {
    const iso = new Date(o.ts).toISOString();
    lines.push(
      [
        iso,
        csvEscape(o.elementId),
        String(o.rep),
        String(o.lapses),
        String(o.smGrade),
        o.elapsedDays.toFixed(2),
        o.prevStability.toFixed(3),
        o.nextStability.toFixed(3),
        o.prevD01.toFixed(4),
        o.rSm20.toFixed(4),
        String(o.sm20NextDays),
        String(o.fsrsNextDays),
      ].join(","),
    );
  }
  // Keep unused sm2 import referenced cleanly if tree-shaken
  void sm2;
  return lines.join("\n");
}
