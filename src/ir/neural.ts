/**
 * SuperMemo spreading-activation walk (Neural creativity, Feb 2016).
 * Pure: no Obsidian, no I/O. The graph adapter lives in neural-graph.ts.
 *
 * CombinePriority(P, GroupP) = 1 - (1-P)*(1-GroupP)
 * Lower P fires sooner. IR stores priority as 0–100; convert with toUnitPriority.
 */

import type { LogState } from "./log";
import type { ElementId } from "./ids";
import type { IrElement } from "./model";

export const WIKILINK_DEGREE_CAP = 12;
export const NEURAL_MAX_QUEUE = 200;
export const NEURAL_EXPAND_THRESHOLD = 50;
export const NEURAL_MAX_LAYERS = 3;
export const NEURAL_STATE_VERSION = 1;
export const NEURAL_COOLDOWN_MS = 4 * 3_600_000;

/** Published SuperMemo groupP values. Lower = stronger association. */
export const GROUP_P = {
  tag: 0.01,
  wikilink: 0.05,
  child: 0.16,
  parent: 0.16,
  titleMention: 0.20,
  sibling: 0.26,
  lexical: 0.35,
  rootParent: 0.4,
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

export type NeuralEdgeKind =
  | "wikilink"
  | "child"
  | "parent"
  | "rootParent"
  | "sibling"
  | "tag"
  | "titleMention"
  | "lexical";

export interface NeuralNeighbor {
  id: string;
  groupP: number;
  kind: NeuralEdgeKind;
  /** Set when `kind` is `tag`. */
  tag?: string;
  /** Set when `kind` is `titleMention` or `lexical`. */
  term?: string;
}

/** How this card was reached from the previous firing node. Seed has none. */
export interface NeuralProvenance {
  fromId: string;
  kind: NeuralEdgeKind;
  tag?: string;
  term?: string;
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

export function neuralViaLabel(
  via: NeuralProvenance,
  fromLabel: string,
): string {
  switch (via.kind) {
    case "wikilink":
      return `via wikilink ← ${fromLabel}`;
    case "child":
      return `via child of ${fromLabel}`;
    case "parent":
    case "rootParent":
      return `via parent ← ${fromLabel}`;
    case "sibling":
      return `via sibling of ${fromLabel}`;
    case "tag":
      return via.tag ? `via tag #${via.tag}` : `via tag ← ${fromLabel}`;
    case "titleMention":
      return via.term ? `via mention "${via.term}" ← ${fromLabel}` : `via mention ← ${fromLabel}`;
    case "lexical":
      return via.term ? `via term "${via.term}" ← ${fromLabel}` : `via term ← ${fromLabel}`;
  }
}

/**
 * Layered spreading activation. The seed is always first. Each later
 * layer is the neighbors of the previous layer, scored with CombinePriority.
 */
export function neuralWalk(opts: NeuralWalkOpts): string[] {
  return neuralWalkDetailed(opts).sequence;
}

/**
 * Same walk as {@link neuralWalk}, plus the winning inbound edge per node
 * (lowest CombinePriority when several neighbors reach it).
 */
export function neuralWalkDetailed(opts: NeuralWalkOpts): {
  sequence: string[];
  provenance: Map<string, NeuralProvenance>;
} {
  const maxLayers = opts.maxLayers ?? NEURAL_MAX_LAYERS;
  const maxQueue = opts.maxQueue ?? NEURAL_MAX_QUEUE;
  const dismissed = opts.dismissed ?? (() => false);
  const sequence: string[] = [];
  const provenance = new Map<string, NeuralProvenance>();
  const emitted = new Set<string>();
  let frontier = new Map<string, FrontierEntry>();
  frontier.set(opts.seed, {
    p: toUnitPriority(opts.priorityOf(opts.seed)),
    via: null,
  });

  for (let layer = 0; layer < maxLayers && sequence.length < maxQueue; layer++) {
    const nodes = orderFrontier(frontier, opts.random);
    frontier = new Map();
    for (const [id, entry] of nodes) {
      if (emitted.has(id)) continue;
      if (id !== opts.seed && dismissed(id)) continue;
      emitted.add(id);
      sequence.push(id);
      if (entry.via) provenance.set(id, entry.via);
      if (sequence.length >= maxQueue) break;
      for (const n of opts.neighbors(id)) {
        if (emitted.has(n.id)) continue;
        if (n.id !== opts.seed && dismissed(n.id)) continue;
        const combined = combinePriority(
          toUnitPriority(opts.priorityOf(n.id)),
          n.groupP,
        );
        const via: NeuralProvenance = {
          fromId: id,
          kind: n.kind,
          ...(n.tag ? { tag: n.tag } : {}),
          ...(n.term ? { term: n.term } : {}),
        };
        const prev = frontier.get(n.id);
        if (prev === undefined || combined < prev.p) {
          frontier.set(n.id, { p: combined, via });
        }
      }
    }
  }
  return { sequence, provenance };
}

interface FrontierEntry {
  p: number;
  via: NeuralProvenance | null;
}

function orderFrontier(
  frontier: Map<string, FrontierEntry>,
  random?: () => number,
): [string, FrontierEntry][] {
  const nodes = [...frontier.entries()];
  nodes.sort(
    (a, b) => a[1].p - b[1].p || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
  );
  if (!random) return nodes;
  weightedShuffle(nodes, (pair) => 1 - pair[1].p, random);
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

export interface NeuralFrontierEntry {
  id: ElementId;
  score: number;
  via?: NeuralProvenance;
}

export interface NeuralQueueState {
  schemaVersion: 1;
  seedId: ElementId | null;
  entries: NeuralFrontierEntry[];
  visitedAt: Record<string, number>;
  updatedAt: number;
}

export function createNeuralQueueState(
  seedId: ElementId | null = null,
  nowMs = 0,
): NeuralQueueState {
  return {
    schemaVersion: NEURAL_STATE_VERSION,
    seedId,
    entries: [],
    visitedAt: {},
    updatedAt: nowMs,
  };
}

export function parseNeuralQueueState(value: unknown): NeuralQueueState | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const rec = value as Record<string, unknown>;
  if (rec.schemaVersion !== NEURAL_STATE_VERSION) return null;
  if (rec.seedId !== null && typeof rec.seedId !== "string") return null;
  if (!Array.isArray(rec.entries)) return null;
  if (rec.visitedAt === null || typeof rec.visitedAt !== "object" || Array.isArray(rec.visitedAt)) {
    return null;
  }
  if (typeof rec.updatedAt !== "number" || !Number.isFinite(rec.updatedAt)) return null;

  const entries: NeuralFrontierEntry[] = [];
  const seen = new Set<string>();
  for (const raw of rec.entries) {
    if (raw === null || typeof raw !== "object") return null;
    const entry = raw as Record<string, unknown>;
    if (typeof entry.id !== "string" || entry.id.length === 0) return null;
    if (typeof entry.score !== "number" || !Number.isFinite(entry.score)) return null;
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    let via: NeuralProvenance | undefined;
    if (entry.via && typeof entry.via === "object") {
      const v = entry.via as Record<string, unknown>;
      if (typeof v.fromId === "string" && typeof v.kind === "string") {
        via = {
          fromId: v.fromId,
          kind: v.kind as NeuralEdgeKind,
          ...(typeof v.tag === "string" ? { tag: v.tag } : {}),
          ...(typeof v.term === "string" ? { term: v.term } : {}),
        };
      }
    }
    entries.push({
      id: entry.id as ElementId,
      score: entry.score,
      ...(via ? { via } : {}),
    });
  }

  const visitedAt: Record<string, number> = {};
  for (const [k, v] of Object.entries(rec.visitedAt as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v)) {
      visitedAt[k] = v;
    }
  }

  return {
    schemaVersion: NEURAL_STATE_VERSION,
    seedId: rec.seedId as ElementId | null,
    entries,
    visitedAt,
    updatedAt: rec.updatedAt,
  };
}

/** Prune deleted (`TDatabase.IsDeleted`) and dismissed elements, keeping bounded sorted capacity. */
export function normalizeNeuralQueueState(
  state: NeuralQueueState | null | undefined,
  elements?: ReadonlyMap<ElementId, IrElement>,
  capacity = NEURAL_MAX_QUEUE,
): NeuralQueueState {
  if (!state) return createNeuralQueueState();
  const seen = new Set<ElementId>();
  const filtered: NeuralFrontierEntry[] = [];
  for (const entry of state.entries) {
    if (seen.has(entry.id)) continue;
    if (elements) {
      const el = elements.get(entry.id);
      if (!el) continue;
      if (entry.id !== state.seedId && el.dismissed) continue;
    }
    seen.add(entry.id);
    filtered.push(entry);
  }
  filtered.sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));
  const seedValid =
    state.seedId !== null && (!elements || elements.has(state.seedId))
      ? state.seedId
      : null;
  return {
    schemaVersion: NEURAL_STATE_VERSION,
    seedId: seedValid,
    entries: filtered.slice(0, Math.max(1, capacity)),
    visitedAt: { ...state.visitedAt },
    updatedAt: state.updatedAt,
  };
}

export interface NeuralExciteOptions {
  elementId: ElementId;
  priorityOf: (id: ElementId) => number;
  neighbors: (id: ElementId) => readonly NeuralNeighbor[];
  dismissed?: (id: ElementId) => boolean;
  nowMs?: number;
  cooldownMs?: number;
  capacity?: number;
}

/** `TNeuralQueue.Add` + `Excite` (`0x00fa9b50`..`0x00faddb0`): excite neighbors with recency cooldown and cap eviction. */
export function exciteNeuralElement(
  state: NeuralQueueState,
  opts: NeuralExciteOptions,
): NeuralQueueState {
  const nowMs = opts.nowMs ?? state.updatedAt;
  const cooldownMs = Math.max(1, opts.cooldownMs ?? NEURAL_COOLDOWN_MS);
  const capacity = Math.max(1, opts.capacity ?? NEURAL_MAX_QUEUE);
  const isDismissed = opts.dismissed ?? (() => false);

  const visitedAt: Record<string, number> = {
    ...state.visitedAt,
    [opts.elementId]: nowMs,
  };

  const byId = new Map<ElementId, NeuralFrontierEntry>();
  for (const existing of state.entries) {
    if (existing.id === opts.elementId) continue;
    if (isDismissed(existing.id)) continue;
    byId.set(existing.id, { ...existing });
  }

  for (const neighbor of opts.neighbors(opts.elementId)) {
    const nId = neighbor.id as ElementId;
    if (nId === opts.elementId || isDismissed(nId)) continue;
    const baseScore = combinePriority(
      toUnitPriority(opts.priorityOf(nId)),
      neighbor.groupP,
    );
    const lastVisited = visitedAt[nId];
    let score = baseScore;
    if (lastVisited !== undefined && nowMs >= lastVisited && nowMs - lastVisited < cooldownMs) {
      const recencyFrac = 1 - (nowMs - lastVisited) / cooldownMs;
      score = combinePriority(baseScore, 0.85 * recencyFrac);
    }
    const via: NeuralProvenance = {
      fromId: opts.elementId,
      kind: neighbor.kind,
      ...(neighbor.tag ? { tag: neighbor.tag } : {}),
      ...(neighbor.term ? { term: neighbor.term } : {}),
    };
    const prev = byId.get(nId);
    if (!prev || score < prev.score) {
      byId.set(nId, { id: nId, score, via });
    }
  }

  const entries = [...byId.values()]
    .sort((a, b) => a.score - b.score || a.id.localeCompare(b.id))
    .slice(0, capacity);

  return {
    schemaVersion: NEURAL_STATE_VERSION,
    seedId: state.seedId ?? opts.elementId,
    entries,
    visitedAt,
    updatedAt: nowMs,
  };
}

/** `TNeuralQueue.NeedsExpanding` (`0x00b5cf00`): true when frontier size is below 50 (`0x32`). */
export function needsNeuralExpansion(
  state: NeuralQueueState,
  threshold = NEURAL_EXPAND_THRESHOLD,
): boolean {
  return state.entries.length < threshold;
}

export interface ExpandNeuralQueueOptions {
  priorityOf: (id: ElementId) => number;
  neighbors: (id: ElementId) => readonly NeuralNeighbor[];
  dismissed?: (id: ElementId) => boolean;
  nowMs?: number;
  cooldownMs?: number;
  capacity?: number;
  threshold?: number;
  random?: () => number;
}

function spreadFromEntries(
  state: NeuralQueueState,
  sources: readonly NeuralFrontierEntry[],
  layerPenalty: number,
  opts: ExpandNeuralQueueOptions,
): NeuralQueueState {
  const nowMs = opts.nowMs ?? state.updatedAt;
  const cooldownMs = Math.max(1, opts.cooldownMs ?? NEURAL_COOLDOWN_MS);
  const capacity = Math.max(1, opts.capacity ?? NEURAL_MAX_QUEUE);
  const isDismissed = opts.dismissed ?? (() => false);

  const byId = new Map<ElementId, NeuralFrontierEntry>();
  for (const existing of state.entries) {
    if (existing.id !== state.seedId && isDismissed(existing.id)) continue;
    byId.set(existing.id, { ...existing });
  }

  for (const src of sources) {
    for (const neighbor of opts.neighbors(src.id)) {
      const nId = neighbor.id as ElementId;
      if (nId === src.id || isDismissed(nId)) continue;
      const hopScore = combinePriority(
        toUnitPriority(opts.priorityOf(nId)),
        neighbor.groupP,
      );
      let score = layerPenalty > 0 ? combinePriority(hopScore, layerPenalty) : hopScore;
      const lastVisited = state.visitedAt[nId];
      if (lastVisited !== undefined && nowMs >= lastVisited && nowMs - lastVisited < cooldownMs) {
        const recencyFrac = 1 - (nowMs - lastVisited) / cooldownMs;
        score = combinePriority(score, 0.85 * recencyFrac);
      }
      const via: NeuralProvenance = {
        fromId: src.id,
        kind: neighbor.kind,
        ...(neighbor.tag ? { tag: neighbor.tag } : {}),
        ...(neighbor.term ? { term: neighbor.term } : {}),
      };
      const prev = byId.get(nId);
      if (!prev || score < prev.score) {
        byId.set(nId, { id: nId, score, via });
      }
    }
  }

  const entries = [...byId.values()]
    .sort((a, b) => a.score - b.score || a.id.localeCompare(b.id))
    .slice(0, capacity);
  return {
    ...state,
    entries,
    updatedAt: nowMs,
  };
}

function sampleEntries(
  entries: readonly NeuralFrontierEntry[],
  count: number,
  random?: () => number,
): NeuralFrontierEntry[] {
  if (entries.length <= count) return [...entries];
  if (!random) return entries.slice(0, count);
  const pool = [...entries];
  for (let i = 0; i < count; i += 1) {
    const j = i + Math.floor(random() * (pool.length - i));
    const tmp = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = tmp;
  }
  return pool.slice(0, count);
}

/**
 * `0x00b5f280`: incremental `< 50` expansion.
 * Pass 1 samples up to 15 (`0xf`) entries with penalty `0.5`;
 * Pass 2 (if still `< 50`) samples up to 30 (`0x1e`) entries with penalty `0.9`.
 */
export function expandNeuralQueueIfNeeded(
  state: NeuralQueueState,
  opts: ExpandNeuralQueueOptions,
): NeuralQueueState {
  const threshold = Math.max(1, opts.threshold ?? NEURAL_EXPAND_THRESHOLD);
  if (!needsNeuralExpansion(state, threshold)) return state;

  const pass1Sources = sampleEntries(state.entries, 15, opts.random);
  let next = spreadFromEntries(state, pass1Sources, 0.5, opts);
  if (!needsNeuralExpansion(next, threshold)) return next;

  const pass2Sources = sampleEntries(next.entries, 30, opts.random);
  next = spreadFromEntries(next, pass2Sources, 0.9, opts);
  return next;
}

export interface SeedNeuralQueueOptions {
  seedId: ElementId;
  baseState?: NeuralQueueState | null;
  priorityOf: (id: ElementId) => number;
  neighbors: (id: ElementId) => readonly NeuralNeighbor[];
  dismissed?: (id: ElementId) => boolean;
  nowMs?: number;
  cooldownMs?: number;
  capacity?: number;
  threshold?: number;
  random?: () => number;
}

/**
 * `0x00b5ece0` + `0x00b5ee50` + `0x00b5f280`: enqueue seed (`score = -1`),
 * spread 1-hop neighbors, and expand incrementally while `< 50`.
 */
export function seedNeuralQueueState(opts: SeedNeuralQueueOptions): NeuralQueueState {
  const nowMs = opts.nowMs ?? 0;
  const capacity = Math.max(1, opts.capacity ?? NEURAL_MAX_QUEUE);
  const visitedAt = { ...(opts.baseState?.visitedAt ?? {}) };
  const seedState: NeuralQueueState = {
    schemaVersion: NEURAL_STATE_VERSION,
    seedId: opts.seedId,
    entries: [{ id: opts.seedId, score: -1 }],
    visitedAt,
    updatedAt: nowMs,
  };

  const oneHop = spreadFromEntries(
    seedState,
    seedState.entries,
    0,
    {
      priorityOf: opts.priorityOf,
      neighbors: opts.neighbors,
      dismissed: opts.dismissed,
      nowMs,
      cooldownMs: opts.cooldownMs,
      capacity,
    },
  );

  return expandNeuralQueueIfNeeded(oneHop, {
    priorityOf: opts.priorityOf,
    neighbors: opts.neighbors,
    dismissed: opts.dismissed,
    nowMs,
    cooldownMs: opts.cooldownMs,
    capacity,
    threshold: opts.threshold,
    random: opts.random,
  });
}

/**
 * `TNeuralQueue.PickNext` (`0x00b5d220`).
 * Deterministic lowest-score pop when `opts.rng` is omitted; heavy-tailed stochastic
 * selection (`factor = r < 0.5 ? 1 / max(r, 0.0001) : 1 - r`) when `opts.rng` is provided.
 */
export function popNextNeuralElement(
  state: NeuralQueueState,
  opts?: {
    excludeIds?: ReadonlySet<ElementId>;
    elements?: ReadonlyMap<ElementId, IrElement>;
    rng?: () => number;
    nowMs?: number;
    cooldownMs?: number;
  },
): { next: NeuralFrontierEntry | null; state: NeuralQueueState } {
  const normalized = normalizeNeuralQueueState(state, opts?.elements);
  const exclude = opts?.excludeIds;
  const candidates = normalized.entries.filter((entry) => !exclude?.has(entry.id));
  if (candidates.length === 0) return { next: null, state: normalized };

  let picked: NeuralFrontierEntry;
  if (!opts?.rng) {
    picked = candidates[0]!;
  } else if (candidates[0]!.score <= 0) {
    picked = candidates[0]!;
  } else {
    const nowMs = opts.nowMs ?? normalized.updatedAt;
    const cooldownMs = Math.max(1, opts.cooldownMs ?? NEURAL_COOLDOWN_MS);
    const uncooled = candidates.filter((entry) => {
      const lastVisited = normalized.visitedAt[entry.id];
      return !(lastVisited !== undefined && nowMs >= lastVisited && nowMs - lastVisited < cooldownMs);
    });
    const pool = uncooled.length > 0 ? uncooled : candidates;
    let best = pool[0]!;
    let bestWeighted = Number.POSITIVE_INFINITY;
    for (const entry of pool) {
      const r = opts.rng();
      const factor = r < 0.5 ? 1.0 / Math.max(r, 0.0001) : 1.0 - r;
      const weighted = factor * Math.max(entry.score, 1e-6);
      if (weighted < bestWeighted) {
        bestWeighted = weighted;
        best = entry;
      }
    }
    picked = best;
  }

  const rest = normalized.entries.filter((entry) => entry.id !== picked.id);
  return {
    next: picked,
    state: {
      ...normalized,
      entries: rest,
    },
  };
}

