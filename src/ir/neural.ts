/**
 * SuperMemo spreading-activation walk (Neural creativity, Feb 2016).
 * Pure: no Obsidian, no I/O. The graph adapter lives in neural-graph.ts.
 *
 * CombinePriority(P, GroupP) = 1 - (1-P)*(1-GroupP)
 * Lower P fires sooner. IR stores priority as 0–100; convert with toUnitPriority.
 */

import type { LogState } from "./log";
import type { ElementId } from "./ids";

export const WIKILINK_DEGREE_CAP = 12;
export const NEURAL_MAX_QUEUE = 200;
export const NEURAL_MAX_LAYERS = 3;

/** Published SuperMemo groupP values. Lower = stronger association. */
export const GROUP_P = {
  tag: 0.01,
  wikilink: 0.05,
  child: 0.16,
  parent: 0.16,
  rootParent: 0.4,
  sibling: 0.26,
  siblingFar: 0.5,
} as const;

export function toUnitPriority(priority: number): number {
  if (!Number.isFinite(priority)) return 0.5;
  return Math.min(1, Math.max(0, priority / 100));
}

/**
 * SuperMemo CombinePriority. The help-file comment disagrees with the
 * Pascal; this is the code: (1-0.2)*(1-0.6)=0.32 → Result 0.68, not 0.32.
 */
export function combinePriority(originalP: number, groupP: number): number {
  const op = 1 - originalP;
  const gp = 1 - groupP;
  return 1 - op * gp;
}

export interface NeuralNeighbor {
  id: string;
  groupP: number;
}

export interface NeuralWalkOpts {
  seed: string;
  /** IR priority 0–100; lower is more important. */
  priorityOf: (id: string) => number;
  neighbors: (id: string) => readonly NeuralNeighbor[];
  /** Skip (except the seed). */
  dismissed?: (id: string) => boolean;
  maxLayers?: number;
  maxQueue?: number;
  /**
   * Optional RNG in [0, 1). When omitted the frontier is sorted by
   * combined P then id (deterministic). When set, nodes are shuffled
   * with weight (1-P) so important nodes still tend to fire first.
   */
  random?: () => number;
}

/**
 * Map a vault note to the IR element that *is* that note (topic or
 * promoted extract/item), not extracts merely anchored in it.
 */
export function elementIdForNotePath(
  state: LogState,
  notePath: string,
): ElementId | null {
  let fallback: ElementId | null = null;
  for (const el of state.elements.values()) {
    if (el.notePath !== notePath || el.dismissed) continue;
    if (el.type === "topic") return el.id;
    if (fallback === null) fallback = el.id;
  }
  return fallback;
}

/** IR neighbors first, then unmarked relays, truncated to the degree cap. */
export function capWikilinkNeighbors(
  neighbors: string[],
  irNotePaths: Set<string>,
  cap: number = WIKILINK_DEGREE_CAP,
): string[] {
  const ir: string[] = [];
  const rest: string[] = [];
  for (const p of neighbors) {
    (irNotePaths.has(p) ? ir : rest).push(p);
  }
  return ir.concat(rest).slice(0, cap);
}

/**
 * Layered spreading activation. The seed is always first. Each later
 * layer is the neighbors of the previous layer, scored with CombinePriority.
 */
export function neuralWalk(opts: NeuralWalkOpts): string[] {
  const maxLayers = opts.maxLayers ?? NEURAL_MAX_LAYERS;
  const maxQueue = opts.maxQueue ?? NEURAL_MAX_QUEUE;
  const dismissed = opts.dismissed ?? (() => false);
  const sequence: string[] = [];
  const emitted = new Set<string>();
  let frontier = new Map<string, number>();
  frontier.set(opts.seed, toUnitPriority(opts.priorityOf(opts.seed)));

  for (let layer = 0; layer < maxLayers && sequence.length < maxQueue; layer++) {
    const nodes = orderFrontier(frontier, opts.random);
    frontier = new Map();
    for (const [id] of nodes) {
      if (emitted.has(id)) continue;
      if (id !== opts.seed && dismissed(id)) continue;
      emitted.add(id);
      sequence.push(id);
      if (sequence.length >= maxQueue) break;
      for (const n of opts.neighbors(id)) {
        if (emitted.has(n.id)) continue;
        if (n.id !== opts.seed && dismissed(n.id)) continue;
        const combined = combinePriority(
          toUnitPriority(opts.priorityOf(n.id)),
          n.groupP,
        );
        const prev = frontier.get(n.id);
        if (prev === undefined || combined < prev) frontier.set(n.id, combined);
      }
    }
  }
  return sequence;
}

function orderFrontier(
  frontier: Map<string, number>,
  random?: () => number,
): [string, number][] {
  const nodes = [...frontier.entries()];
  nodes.sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  if (!random) return nodes;
  weightedShuffle(nodes, (pair) => 1 - pair[1], random);
  return nodes;
}

/**
 * Weighted Fisher-Yates: higher weight is more likely to land early.
 * Sequential sampling without replacement, O(n^2) on a few hundred nodes.
 */
export function makeLcg(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = ((s * 1664525) >>> 0) + 1013904223;
    s >>>= 0;
    return s / 0x1_0000_0000;
  };
}

export function weightedShuffle<T>(
  arr: T[],
  weightOf: (item: T) => number,
  random: () => number,
): void {
  for (let i = 0; i < arr.length - 1; i++) {
    let total = 0;
    for (let j = i; j < arr.length; j++) {
      total += Math.max(0, weightOf(arr[j]!));
    }
    if (total <= 0) break;
    let pick = random() * total;
    let k = i;
    for (; k < arr.length; k++) {
      pick -= Math.max(0, weightOf(arr[k]!));
      if (pick <= 0) break;
    }
    if (k >= arr.length) k = arr.length - 1;
    const tmp = arr[i]!;
    arr[i] = arr[k]!;
    arr[k] = tmp;
  }
}
