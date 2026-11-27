/**
 * SuperMemo 20 Collection Operations (`~/code/sm20-re` Pillar C):
 * - `TElementFilter` (`0x00ca7040`): multi-range numeric/date filtering
 * - `TBrowser.SearchAndReplace` (`0x00b797e0`): subset text search & replace
 * - `TSpreadPrioritiesDlg` (`0x00d4e980`): linear/step priority redistribution
 * - `CheckElementDataIntegrity` (`0x00d32f50`) & `DetectBackwardlyRescheduledRepetition`
 *   (`0x00d0cdc0`): collection & repetition-history audit and repair
 */

import { newDeviceId, newEventId, type DeviceId, type ElementId } from "./ids";
import { clampPriority, type IrElement, type IrEvent, type StoredCard } from "./model";
import { computeSm20Retrievability } from "./sm20-scheduler";

const MS_PER_DAY = 86_400_000;

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

// --- 1. TElementFilter (`0x00ca7040`) ---------------------------------------

export interface NumericRange {
  min?: number;
  max?: number;
}

export interface Sm20ElementFilter {
  priority?: NumericRange;
  intervalDays?: NumericRange;
  aFactor?: NumericRange;
  stabilityDays?: NumericRange;
  difficulty10?: NumericRange;
  retrievabilityPct?: NumericRange;
  reps?: NumericRange;
  lapses?: NumericRange;
  postpones?: NumericRange;
  dueAfterMs?: number;
  dueBeforeMs?: number;
  lastReviewAfterMs?: number;
  lastReviewBeforeMs?: number;
  conceptId?: string;
}

function hasBounds(range: NumericRange | undefined): boolean {
  if (!range) return false;
  return (
    (range.min !== undefined && Number.isFinite(range.min)) ||
    (range.max !== undefined && Number.isFinite(range.max))
  );
}

function inRange(value: number | undefined | null, range: NumericRange | undefined): boolean {
  if (!hasBounds(range)) return true;
  if (value === undefined || value === null || !Number.isFinite(value)) return false;
  if (range!.min !== undefined && Number.isFinite(range!.min) && value < range!.min) return false;
  if (range!.max !== undefined && Number.isFinite(range!.max) && value > range!.max) return false;
  return true;
}

export function countActiveElementFilterRules(filter: Sm20ElementFilter | undefined): number {
  if (!filter) return 0;
  let count = 0;
  if (hasBounds(filter.priority)) count += 1;
  if (hasBounds(filter.intervalDays)) count += 1;
  if (hasBounds(filter.aFactor)) count += 1;
  if (hasBounds(filter.stabilityDays)) count += 1;
  if (hasBounds(filter.difficulty10)) count += 1;
  if (hasBounds(filter.retrievabilityPct)) count += 1;
  if (hasBounds(filter.reps)) count += 1;
  if (hasBounds(filter.lapses)) count += 1;
  if (hasBounds(filter.postpones)) count += 1;
  if (filter.dueAfterMs !== undefined || filter.dueBeforeMs !== undefined) count += 1;
  if (filter.lastReviewAfterMs !== undefined || filter.lastReviewBeforeMs !== undefined) count += 1;
  if (filter.conceptId && filter.conceptId.trim().length > 0) count += 1;
  return count;
}

export function matchesElementFilter(
  element: IrElement,
  filter: Sm20ElementFilter | undefined,
  nowMs: number,
  postponeCountById?: ReadonlyMap<string, number>,
): boolean {
  if (!filter || countActiveElementFilterRules(filter) === 0) return true;

  if (!inRange(element.priority, filter.priority)) return false;

  const intervalDays =
    element.type === "item" ? element.card?.scheduledDays : element.schedule?.interval;
  if (!inRange(intervalDays, filter.intervalDays)) return false;

  const aFactor = element.type !== "item" ? element.schedule?.aFactor : undefined;
  if (!inRange(aFactor, filter.aFactor)) return false;

  if (!inRange(element.card?.stability, filter.stabilityDays)) return false;
  if (!inRange(element.card?.difficulty, filter.difficulty10)) return false;
  if (!inRange(element.card?.reps, filter.reps)) return false;
  if (!inRange(element.card?.lapses, filter.lapses)) return false;

  if (hasBounds(filter.retrievabilityPct)) {
    if (element.type !== "item" || !element.card || element.card.reps <= 0 || element.card.stability <= 0) {
      return false;
    }
    const lastMs = element.card.lastReview ?? nowMs - element.card.scheduledDays * MS_PER_DAY;
    const elapsedDays = Math.max(0, (nowMs - lastMs) / MS_PER_DAY);
    const rPct = computeSm20Retrievability(elapsedDays, element.card.stability) * 100;
    if (!inRange(rPct, filter.retrievabilityPct)) return false;
  }

  if (hasBounds(filter.postpones)) {
    const pCount = postponeCountById?.get(element.id) ?? 0;
    if (!inRange(pCount, filter.postpones)) return false;
  }

  const dueMs = element.type === "item" ? element.card?.due : element.schedule?.due;
  if (filter.dueAfterMs !== undefined && Number.isFinite(filter.dueAfterMs)) {
    if (dueMs === undefined || dueMs < filter.dueAfterMs) return false;
  }
  if (filter.dueBeforeMs !== undefined && Number.isFinite(filter.dueBeforeMs)) {
    if (dueMs === undefined || dueMs > filter.dueBeforeMs) return false;
  }

  const lastRevMs = element.card?.lastReview;
  if (filter.lastReviewAfterMs !== undefined && Number.isFinite(filter.lastReviewAfterMs)) {
    if (lastRevMs === undefined || lastRevMs < filter.lastReviewAfterMs) return false;
  }
  if (filter.lastReviewBeforeMs !== undefined && Number.isFinite(filter.lastReviewBeforeMs)) {
    if (lastRevMs === undefined || lastRevMs > filter.lastReviewBeforeMs) return false;
  }

  if (filter.conceptId && filter.conceptId.trim().length > 0) {
    const elConcept = (element as { conceptId?: string }).conceptId;
    if (elConcept !== filter.conceptId.trim()) return false;
  }

  return true;
}

// --- 2. Subset Search & Replace (`0x00b797e0`) ------------------------------

export interface SubsetSearchReplaceOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
  subsetIds?: ReadonlySet<string>;
}

export interface SubsetReplaceMatch {
  elementId: ElementId;
  notePath?: string;
  beforeText: string;
  afterText: string;
  replacements: number;
}

export interface SubsetSearchReplacePlan {
  findText: string;
  replaceText: string;
  matches: SubsetReplaceMatch[];
  totalReplacements: number;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function planSubsetSearchAndReplace(
  elements: Iterable<IrElement>,
  findText: string,
  replaceText: string,
  options: SubsetSearchReplaceOptions = {},
): SubsetSearchReplacePlan {
  if (
    !findText ||
    findText.length > 2_000 ||
    replaceText.length > 20_000 ||
    findText === replaceText
  ) {
    return { findText, replaceText, matches: [], totalReplacements: 0 };
  }
  const caseSensitive = options.caseSensitive ?? false;
  if (!caseSensitive && findText.toLowerCase() === replaceText.toLowerCase() && findText === replaceText) {
    return { findText, replaceText, matches: [], totalReplacements: 0 };
  }

  const escaped = escapeRegExp(findText);
  const pattern = options.wholeWord ? `\\b${escaped}\\b` : escaped;
  const flags = caseSensitive ? "g" : "gi";
  const regex = new RegExp(pattern, flags);

  const matches: SubsetReplaceMatch[] = [];
  let totalReplacements = 0;

  for (const el of elements) {
    if (el.dismissed) continue;
    if (options.subsetIds && !options.subsetIds.has(el.id)) continue;
    if (!el.text) continue;

    let count = 0;
    const afterText = el.text.replace(regex, () => {
      count += 1;
      return replaceText;
    });
    if (count > 0 && afterText !== el.text) {
      matches.push({
        elementId: el.id,
        notePath: el.notePath,
        beforeText: el.text,
        afterText,
        replacements: count,
      });
      totalReplacements += count;
    }
  }

  return {
    findText,
    replaceText,
    matches,
    totalReplacements,
  };
}

// --- 3. Spread Priorities (`0x00d4e980`) ------------------------------------

export interface SpreadPrioritiesInput {
  minPriority: number;
  maxPriority: number;
  step?: number;
  subsetIds?: ReadonlySet<string>;
}

export interface SpreadPriorityUpdate {
  elementId: ElementId;
  oldPriority: number;
  newPriority: number;
}

export interface SpreadPrioritiesResult {
  minPriority: number;
  maxPriority: number;
  updates: SpreadPriorityUpdate[];
}

/**
 * Implements `ApplySpreadPrioritySettings` (`0x00d4e980`):
 * normalizes reversed bounds, expands equal bounds by `±0.1`, clamps to `[0, 100]`,
 * and redistributes priorities linearly across target elements in current order.
 */
export function computeSpreadPrioritiesSchedule(
  elements: Iterable<IrElement>,
  input: SpreadPrioritiesInput,
): SpreadPrioritiesResult {
  let lo = Number.isFinite(input.minPriority) ? input.minPriority : 0;
  let hi = Number.isFinite(input.maxPriority) ? input.maxPriority : 100;

  if (hi < lo) {
    const tmp = lo;
    lo = hi;
    hi = tmp;
  }
  if (lo === hi) {
    lo -= 0.1;
    hi += 0.1;
  }
  lo = clamp(lo, 0, 99);
  hi = clamp(hi, 0.0001, 100);
  if (hi < lo) {
    const tmp = lo;
    lo = hi;
    hi = tmp;
  }

  const targets: IrElement[] = [];
  for (const el of elements) {
    if (el.dismissed) continue;
    if (input.subsetIds && !input.subsetIds.has(el.id)) continue;
    targets.push(el);
  }
  targets.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));

  if (targets.length === 0) {
    return { minPriority: lo, maxPriority: hi, updates: [] };
  }
  if (targets.length === 1) {
    const targetP = clampPriority(Math.round(lo * 10000) / 10000);
    return {
      minPriority: lo,
      maxPriority: hi,
      updates: [
        {
          elementId: targets[0]!.id,
          oldPriority: targets[0]!.priority,
          newPriority: targetP,
        },
      ],
    };
  }

  const stepVal =
    input.step !== undefined && Number.isFinite(input.step) && input.step > 0
      ? clamp(input.step, 0.0001, 100)
      : (hi - lo) / (targets.length - 1);

  const updates: SpreadPriorityUpdate[] = [];
  for (let i = 0; i < targets.length; i += 1) {
    const rawP = input.step && input.step > 0 ? lo + i * stepVal : lo + ((hi - lo) * i) / (targets.length - 1);
    const newPriority = clampPriority(Math.min(hi, Math.round(rawP * 10000) / 10000));
    updates.push({
      elementId: targets[i]!.id,
      oldPriority: targets[i]!.priority,
      newPriority,
    });
  }

  return {
    minPriority: Math.round(lo * 10000) / 10000,
    maxPriority: Math.round(hi * 10000) / 10000,
    updates,
  };
}

// --- 4. Collection & Repetition History Audit/Repair (`0x00d32f50`, `0x00d0cdc0`) ---

export interface IntegrityAuditInput {
  elements: ReadonlyMap<string, IrElement>;
  events: readonly IrEvent[];
  nowMs: number;
  device?: DeviceId;
  startingLamport?: number;
  existingVaultPaths?: ReadonlySet<string>;
}

export interface IntegrityIssue {
  kind:
    | "orphan-parent"
    | "parent-cycle"
    | "missing-schedule"
    | "dangling-source"
    | "history-backward-timestamp"
    | "card-counter-drift";
  elementId: ElementId;
  detail: string;
}

export interface IntegrityAuditReport {
  issues: IntegrityIssue[];
  counts: {
    orphanParents: number;
    parentCycles: number;
    missingSchedules: number;
    danglingSources: number;
    historyAnomalies: number;
    cardCounterDrifts: number;
  };
  repairEvents: IrEvent[];
}

export function auditAndRepairCollectionIntegrity(
  input: IntegrityAuditInput,
): IntegrityAuditReport {
  const device = input.device ?? newDeviceId();
  let nextLamport = Math.max(
    1,
    input.startingLamport ??
      input.events.reduce((m, e) => (e.lamport > m ? e.lamport : m), 0) + 1,
  );
  const issues: IntegrityIssue[] = [];
  const repairEvents: IrEvent[] = [];
  const counts = {
    orphanParents: 0,
    parentCycles: 0,
    missingSchedules: 0,
    danglingSources: 0,
    historyAnomalies: 0,
    cardCounterDrifts: 0,
  };

  const emitRepair = (kind: IrEvent["kind"], target: ElementId, payload: Record<string, unknown>) => {
    repairEvents.push({
      id: newEventId(),
      ts: input.nowMs,
      lamport: nextLamport++,
      device,
      kind,
      target,
      payload,
    });
  };

  // 1. Orphan parentId check
  const effectiveParent = new Map<string, string | null>();
  for (const [id, el] of input.elements) {
    if (el.parentId !== null && !input.elements.has(el.parentId)) {
      counts.orphanParents += 1;
      issues.push({
        kind: "orphan-parent",
        elementId: el.id,
        detail: `Parent ${el.parentId} does not exist; promoted to root.`,
      });
      effectiveParent.set(id, null);
      emitRepair("reparented", el.id, { parentId: null });
    } else {
      effectiveParent.set(id, el.parentId);
    }
  }

  // 2. Parent cycle check (0x00d32f50)
  const globallyClean = new Set<string>();
  for (const id of input.elements.keys()) {
    if (globallyClean.has(id)) continue;
    const chain: string[] = [];
    const indexInChain = new Map<string, number>();
    let cur: string | null = id;
    while (cur !== null && !globallyClean.has(cur)) {
      const prevIdx = indexInChain.get(cur);
      if (prevIdx !== undefined) {
        const cycleMembers = chain.slice(prevIdx);
        cycleMembers.sort();
        const breakTarget = cycleMembers[cycleMembers.length - 1]! as ElementId;
        counts.parentCycles += 1;
        issues.push({
          kind: "parent-cycle",
          elementId: breakTarget,
          detail: `Parent cycle detected (${cycleMembers.join(" -> ")}); broke edge on ${breakTarget}.`,
        });
        effectiveParent.set(breakTarget, null);
        emitRepair("reparented", breakTarget, { parentId: null });
        break;
      }
      indexInChain.set(cur, chain.length);
      chain.push(cur);
      cur = effectiveParent.get(cur) ?? null;
    }
    for (const visited of chain) globallyClean.add(visited);
  }

  // 3. Missing schedule on active reading elements & dangling vault paths
  for (const el of input.elements.values()) {
    if (!el.dismissed && (el.type === "topic" || el.type === "extract") && !el.schedule) {
      counts.missingSchedules += 1;
      issues.push({
        kind: "missing-schedule",
        elementId: el.id,
        detail: `Active ${el.type} lacked a schedule; seeded 1d interval.`,
      });
      emitRepair("topic-advanced", el.id, {
        schedule: {
          due: input.nowMs + MS_PER_DAY,
          interval: 1,
          aFactor: 2,
        },
      });
    }

    if (input.existingVaultPaths) {
      const checkPath = el.notePath ?? el.anchor?.sourcePath;
      if (checkPath && el.anchorState !== "detached" && !input.existingVaultPaths.has(checkPath)) {
        counts.danglingSources += 1;
        issues.push({
          kind: "dangling-source",
          elementId: el.id,
          detail: `Referenced file "${checkPath}" is missing in vault.`,
        });
      }
    }
  }

  // 4. Repetition history monotonicity (`0x00d0cdc0`) & card counter drift
  const undone = new Set<string>();
  for (const ev of input.events) {
    if (ev.kind === "grade-undone" && typeof ev.payload.eventId === "string") {
      undone.add(ev.payload.eventId);
    }
  }
  const sortedEvents = [...input.events].sort(
    (a, b) => a.lamport - b.lamport || a.id.localeCompare(b.id),
  );
  const perItemStats = new Map<
    string,
    { reps: number; lapses: number; lastTs: number | null; backwardReported: boolean }
  >();

  for (const ev of sortedEvents) {
    if (ev.kind === "grade-undone" || undone.has(ev.id)) continue;
    if (ev.kind === "card-reset" || (ev.kind === "mercy-postponed" && ev.payload.operation === "forget-reset")) {
      const resetCard = ev.payload.card as StoredCard | undefined;
      perItemStats.set(ev.target, {
        reps: resetCard?.reps ?? 0,
        lapses: resetCard?.lapses ?? 0,
        lastTs: resetCard?.lastReview ?? null,
        backwardReported: false,
      });
      continue;
    }
    if (ev.kind === "element-created") {
      const created = ev.payload.element as IrElement | undefined;
      if (created?.card) {
        perItemStats.set(ev.target, {
          reps: created.card.reps,
          lapses: created.card.lapses,
          lastTs: created.card.lastReview ?? null,
          backwardReported: false,
        });
      }
      continue;
    }
    if (ev.kind === "graded") {
      const cur = perItemStats.get(ev.target) ?? {
        reps: 0,
        lapses: 0,
        lastTs: null,
        backwardReported: false,
      };
      if (cur.lastTs !== null && ev.ts < cur.lastTs && !cur.backwardReported) {
        cur.backwardReported = true;
        counts.historyAnomalies += 1;
        issues.push({
          kind: "history-backward-timestamp",
          elementId: ev.target,
          detail: `Backwardly timestamped repetition (${ev.ts} < ${cur.lastTs}) in lamport order.`,
        });
      }
      cur.reps += 1;
      const smG = typeof ev.payload.smGrade === "number" ? ev.payload.smGrade : undefined;
      const gNum = typeof ev.payload.grade === "number" ? ev.payload.grade : 3;
      const failed = smG !== undefined ? smG < 3 : gNum <= 1;
      if (failed) cur.lapses += 1;
      cur.lastTs = Math.max(cur.lastTs ?? ev.ts, ev.ts);
      perItemStats.set(ev.target, cur);
    }
  }

  for (const [id, stats] of perItemStats) {
    const el = input.elements.get(id);
    if (!el || el.type !== "item" || !el.card) continue;
    if (el.card.reps !== stats.reps || el.card.lapses !== stats.lapses) {
      counts.cardCounterDrifts += 1;
      issues.push({
        kind: "card-counter-drift",
        elementId: el.id,
        detail: `Card counters (${el.card.reps} reps, ${el.card.lapses} lapses) drifted from ledger (${stats.reps} reps, ${stats.lapses} lapses).`,
      });
      const fixedCard: StoredCard = {
        ...el.card,
        reps: Math.max(0, stats.reps),
        lapses: Math.max(0, stats.lapses),
        ...(stats.lastTs !== null ? { lastReview: stats.lastTs } : {}),
      };
      emitRepair("card-reset", el.id, { card: fixedCard });
    }
  }

  return {
    issues,
    counts,
    repairEvents,
  };
}
