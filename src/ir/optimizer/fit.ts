/**
 * Optimizer stage 2 (PLAN-OPTIMIZER.md §3): fit the 21 FSRS-6 weights to
 * the vault's revlog. Adam over binary cross-entropy, central-difference
 * numerical gradients, seeded and deterministic. Guard rails are part of
 * the contract, not the UI: a candidate that does not beat the defaults
 * on the held-out split is never returned as the vector to apply.
 *
 * Pure: no Obsidian imports, no I/O.
 */

import { clipParameters } from "ts-fsrs";
import {
  FSRS6_DEFAULTS,
  datasetLoss,
  engineFor,
  prepare,
  type PreparedCard,
} from "./forward";
import type { RevlogCard } from "./revlog";

export interface FitOptions {
  /** PRNG seed; same revlog + same seed = identical parameters. */
  seed?: number;
  /** Cards per gradient step. */
  batchSize?: number;
  /** Total Adam steps; default max(100, 5*ceil(cards/512)). */
  steps?: number;
  /** Initial learning rate (cosine-annealed to 0). */
  lr?: number;
}

export interface FitProgress {
  step: number;
  totalSteps: number;
  /** Mean batch loss under the current weights. */
  loss: number;
}

export interface FitResult {
  /**
   * The vector to apply: the fitted candidate when `improved`, otherwise
   * the FSRS-6 defaults untouched.
   */
  w: number[];
  tier: "none" | "pretrain" | "full";
  /** True when the candidate beat the defaults on the held-out split. */
  improved: boolean;
  /** Mean held-out BCE of the fitted candidate (even when not improved). */
  candidateHeldOutLoss: number;
  defaultsHeldOutLoss: number;
  /** Mean train-split BCE of the fitted candidate. */
  trainLoss: number;
  /** Under 400 rated reviews: show as low-confidence. */
  lowData: boolean;
  trainCards: number;
  heldOutCards: number;
}

/** Deterministic PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Deterministic 80/20 card split by id hash. Exported so the oracle test
 * can evaluate reference parameters on the exact same held-out cards.
 */
export function splitCards(
  cards: readonly RevlogCard[],
  seed: number,
): { train: RevlogCard[]; heldOut: RevlogCard[] } {
  const train: RevlogCard[] = [];
  const heldOut: RevlogCard[] = [];
  for (const c of cards) {
    (fnv1a(`${c.elementId}:${seed}`) % 5 === 0 ? heldOut : train).push(c);
  }
  return { train, heldOut };
}

function shuffle<T>(arr: T[], rand: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}

const N_WEIGHTS = 21;
/** Our shipped scheduler uses one relearning step and short-term memory. */
const clip = (w: number[]): number[] => clipParameters([...w], 1, true);

function meanLoss(cards: readonly PreparedCard[], w?: readonly number[]) {
  const { loss, n } = datasetLoss(cards, engineFor(w));
  return n > 0 ? loss / n : 0;
}

/**
 * The fit, as an async generator: yields once per Adam step so a UI can
 * await a frame between steps and cancel by breaking out of iteration;
 * the generator's return value is the result. Use `runFit` to just drain.
 */
export async function* fit(
  cards: RevlogCard[],
  opts: FitOptions = {},
): AsyncGenerator<FitProgress, FitResult, void> {
  const seed = opts.seed ?? 42;
  const defaults = clip([...FSRS6_DEFAULTS]);
  const totalReviews = cards.reduce((s, c) => s + c.reviews.length, 0);
  const lowData = totalReviews < 400;

  if (cards.length < 8) {
    const all = prepare(cards);
    const base = meanLoss(all);
    return {
      w: defaults,
      tier: "none",
      improved: false,
      candidateHeldOutLoss: base,
      defaultsHeldOutLoss: base,
      trainLoss: base,
      lowData,
      trainCards: cards.length,
      heldOutCards: 0,
    };
  }

  const tier: "pretrain" | "full" = cards.length < 64 ? "pretrain" : "full";
  const optimIdx =
    tier === "pretrain"
      ? [0, 1, 2, 3]
      : Array.from({ length: N_WEIGHTS }, (_, i) => i);

  const split = splitCards(cards, seed);
  // Degenerate split (tiny or skewed data): evaluate against everything
  // rather than a meaningless handful.
  const evalCards = split.heldOut.length >= 4 ? split.heldOut : cards;
  const trainCards = split.train.length >= 4 ? split.train : cards;
  const trainP = prepare(trainCards);
  const evalP = prepare(evalCards);

  const totalSteps =
    opts.steps ?? Math.max(100, 5 * Math.ceil(cards.length / 512));
  const batchSize = opts.batchSize ?? 256;
  const lr0 = opts.lr ?? 0.04;

  let w = [...defaults];
  const m = new Array<number>(N_WEIGHTS).fill(0);
  const v = new Array<number>(N_WEIGHTS).fill(0);
  const beta1 = 0.9;
  const beta2 = 0.999;
  const adamEps = 1e-8;

  const rand = mulberry32(seed);
  const order = [...trainP];
  let cursor = 0;

  for (let step = 1; step <= totalSteps; step++) {
    if (cursor === 0) shuffle(order, rand);
    const batch = order.slice(cursor, cursor + batchSize);
    cursor = cursor + batchSize >= order.length ? 0 : cursor + batchSize;
    const batchN = batch.reduce((s, pc) => s + pc.n, 0);
    if (batchN === 0) continue;

    const grad = new Array<number>(N_WEIGHTS).fill(0);
    for (const j of optimIdx) {
      const h = Math.max(1e-4, Math.abs(w[j]!) * 1e-3);
      const wp = [...w];
      wp[j] = w[j]! + h;
      const wm = [...w];
      wm[j] = w[j]! - h;
      // Probes are clipped like the live vector, so a weight parked on a
      // bound reads a zero gradient instead of an invalid excursion.
      const lp = datasetLoss(batch, engineFor(clip(wp))).loss;
      const lm = datasetLoss(batch, engineFor(clip(wm))).loss;
      grad[j] = (lp - lm) / (2 * h * batchN);
    }

    const lr = lr0 * 0.5 * (1 + Math.cos((Math.PI * step) / totalSteps));
    for (const j of optimIdx) {
      m[j] = beta1 * m[j]! + (1 - beta1) * grad[j]!;
      v[j] = beta2 * v[j]! + (1 - beta2) * grad[j]! * grad[j]!;
      const mHat = m[j]! / (1 - Math.pow(beta1, step));
      const vHat = v[j]! / (1 - Math.pow(beta2, step));
      w[j] = w[j]! - (lr * mHat) / (Math.sqrt(vHat) + adamEps);
    }
    w = clip(w);

    yield {
      step,
      totalSteps,
      loss: datasetLoss(batch, engineFor(w)).loss / batchN,
    };
  }

  const candidateHeldOutLoss = meanLoss(evalP, w);
  const defaultsHeldOutLoss = meanLoss(evalP);
  const improved = candidateHeldOutLoss < defaultsHeldOutLoss;

  return {
    w: improved ? w : defaults,
    tier,
    improved,
    candidateHeldOutLoss,
    defaultsHeldOutLoss,
    trainLoss: meanLoss(trainP, w),
    lowData,
    trainCards: trainCards.length,
    heldOutCards: split.heldOut.length >= 4 ? split.heldOut.length : 0,
  };
}

/** Drain the generator without UI pacing; tests and CLI use this. */
export async function runFit(
  cards: RevlogCard[],
  opts: FitOptions = {},
): Promise<FitResult> {
  const it = fit(cards, opts);
  for (;;) {
    const { value, done } = await it.next();
    if (done) return value;
  }
}
