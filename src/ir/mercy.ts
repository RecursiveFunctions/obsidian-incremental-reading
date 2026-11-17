const REP_CAP = 20;
const TYPICAL_INTERVAL_PAGE_ROW = 1;
const MS_PER_DAY = 86_400_000;

/**
 * 400-element uint16 baseline interval-growth table (20 rows x 20 repetition columns),
 * used by `typicalInterval` to estimate expected interval progression by repetition count.
 */
export const TYPICAL_INTERVAL_TABLE: readonly number[] = [
  2484, 1200, 1200, 1200, 1200, 1200, 1200, 1200, 1200, 1200, 1200, 1200, 1200, 1200, 1200, 1200, 1200, 1200, 1200, 1200,
  2347, 1500, 1350, 1300, 1275, 1260, 1250, 1243, 1238, 1233, 1230, 1227, 1225, 1223, 1221, 1220, 1219, 1218, 1217, 1216,
  2217, 1800, 1500, 1400, 1350, 1320, 1300, 1286, 1275, 1267, 1260, 1255, 1250, 1246, 1243, 1240, 1238, 1235, 1233, 1232,
  2094, 2100, 1650, 1500, 1425, 1380, 1350, 1329, 1312, 1300, 1290, 1282, 1275, 1269, 1264, 1260, 1256, 1253, 1250, 1247,
  1978, 2400, 1800, 1600, 1500, 1440, 1400, 1371, 1350, 1333, 1320, 1309, 1300, 1292, 1286, 1280, 1275, 1271, 1267, 1263,
  1868, 2700, 1950, 1700, 1575, 1500, 1450, 1414, 1387, 1367, 1350, 1336, 1325, 1315, 1307, 1300, 1294, 1288, 1283, 1279,
  1765, 3000, 2100, 1800, 1650, 1560, 1500, 1457, 1425, 1400, 1380, 1364, 1350, 1338, 1329, 1320, 1312, 1306, 1300, 1295,
  1667, 3300, 2250, 1900, 1725, 1620, 1550, 1500, 1462, 1433, 1410, 1391, 1375, 1362, 1350, 1340, 1331, 1324, 1317, 1311,
  1575, 3600, 2400, 2000, 1800, 1680, 1600, 1543, 1500, 1467, 1440, 1418, 1400, 1385, 1371, 1360, 1350, 1341, 1333, 1326,
  1487, 3900, 2550, 2100, 1875, 1740, 1650, 1586, 1538, 1500, 1470, 1445, 1425, 1408, 1393, 1380, 1369, 1359, 1350, 1342,
  1405, 4200, 2700, 2200, 1950, 1800, 1700, 1629, 1575, 1533, 1500, 1473, 1450, 1431, 1414, 1400, 1387, 1376, 1367, 1358,
  1327, 4500, 2850, 2300, 2025, 1860, 1750, 1671, 1613, 1567, 1530, 1500, 1475, 1454, 1436, 1420, 1406, 1394, 1383, 1374,
  1254, 4800, 3000, 2400, 2100, 1920, 1800, 1714, 1650, 1600, 1560, 1527, 1500, 1477, 1457, 1440, 1425, 1412, 1400, 1389,
  1184, 5100, 3150, 2500, 2175, 1980, 1850, 1757, 1688, 1633, 1590, 1555, 1525, 1500, 1479, 1460, 1444, 1429, 1417, 1405,
  1119, 5400, 3300, 2600, 2250, 2040, 1900, 1800, 1725, 1667, 1620, 1582, 1550, 1523, 1500, 1480, 1462, 1447, 1433, 1421,
  1057, 5700, 3450, 2700, 2325, 2100, 1950, 1843, 1762, 1700, 1650, 1609, 1575, 1546, 1521, 1500, 1481, 1465, 1450, 1437,
  998, 6000, 3600, 2800, 2400, 2160, 2000, 1886, 1800, 1733, 1680, 1636, 1600, 1569, 1543, 1520, 1500, 1482, 1467, 1453,
  943, 6300, 3750, 2900, 2475, 2220, 2050, 1929, 1837, 1767, 1710, 1664, 1625, 1592, 1564, 1540, 1519, 1500, 1483, 1468,
  890, 6600, 3900, 3000, 2550, 2280, 2100, 1971, 1875, 1800, 1740, 1691, 1650, 1615, 1586, 1560, 1538, 1518, 1500, 1484,
  841, 6900, 4050, 3100, 2625, 2340, 2150, 2014, 1913, 1833, 1770, 1718, 1675, 1638, 1607, 1580, 1556, 1535, 1517, 1500,
];

/**
 * 5-dimension Mercy ordinal weights (defaults: Importance=5, Lateness=1,
 * Easiness=6, Investment=10, Recency=8, Mode=3).
 */
export interface MercyWeights {
  importance: number;
  lateness: number;
  easiness: number;
  investment: number;
  recency: number;
  /** Bit 0 activates multi-factor Mercy ordinal scoring (modes 1 and 3); 0/2 use flat priority. */
  mode?: number;
}

export const DEFAULT_MERCY_WEIGHTS: MercyWeights = {
  importance: 5,
  lateness: 1,
  easiness: 6,
  investment: 10,
  recency: 8,
  mode: 3,
};

export interface MercyElementInput {
  /** Priority fraction in [0, 1], where 1 = highest importance (priority 0). */
  importance: number;
  /** Days overdue (clamped to >= 1; < -1 throws). */
  lateness: number;
  /** Repetition / investment count (>= 0). */
  investment: number;
  /** Easiness in [0, 1] (scaled to 0..100). */
  easiness: number;
  /** Optional stored interval cap in days. */
  intervalCap?: number;
}

/**
 * Compute the baseline expected interval (in days) for a given repetition count.
 */
export function typicalInterval(rep: number, pageRow = TYPICAL_INTERVAL_PAGE_ROW): number {
  const clampedRep = Math.max(1, Math.min(REP_CAP, Math.trunc(rep)));
  let interval = TYPICAL_INTERVAL_TABLE[0]! / 1000.0;
  const row = Math.max(1, Math.min(REP_CAP, Math.trunc(pageRow)));
  for (let k = 2; k <= clampedRep; k++) {
    const byteOff = row * 5 * 8 + k * 2 - 0x2a;
    const idx = Math.floor(byteOff / 2);
    if (idx < 0 || idx >= TYPICAL_INTERVAL_TABLE.length) {
      throw new RangeError(`typical-interval index ${idx} out of range for rep=${clampedRep} row=${row}`);
    }
    interval *= TYPICAL_INTERVAL_TABLE[idx]! / 1000.0;
  }
  return interval;
}

/**
 * Compute the five Mercy dimension scores `[d0, d1, d2, d3, d4]` in `[0, 1]`.
 */
export function computeMercyDimensionScores(element: MercyElementInput): [number, number, number, number, number] {
  const latenessDays = Number(element.lateness);
  if (latenessDays < -1) {
    throw new RangeError("Interval passed found to be negative!");
  }
  const lateness = Math.max(1.0, latenessDays);
  const investment = Math.max(0.0, Number(element.investment));
  const rep = Math.max(1, Math.min(REP_CAP, Math.round(Number(element.importance) * REP_CAP)));

  let typical = typicalInterval(rep);
  const cap = element.intervalCap !== undefined ? Number(element.intervalCap) : typical;
  if (Number.isFinite(cap) && cap > 0 && typical > cap) {
    typical = cap;
  }

  const lifetimeRatio = investment / (investment + 1.0);
  const lapseRatio = lateness / (lateness + 200.0);

  // d[0] (weighted by w_importance): investment + lateness axis
  const d0 = 0.65 * (1.0 - lifetimeRatio) + 0.35 * (1.0 - lapseRatio);
  // d[1] (weighted by w_lateness): rep + typical interval axis
  const d1 = 0.5 * (rep / (rep + 3.0)) + 0.5 * (typical / (typical + 400.0));
  // d[3] (weighted by w_investment): easiness complement
  const easinessPct = Number(element.easiness) * 100.0;
  const d3 = 1.0 - easinessPct / 100.0;
  // d[4] (weighted by w_recency): sigmoid lateness
  const ratio = typical === 0.0 ? 0.0 : lateness / typical;
  const sigmoid = 1.4 + ratio !== 0.0 ? ratio / (1.4 + ratio) : 0.0;
  const d4 = 0.6 * sigmoid + 0.4 * lapseRatio;
  // d[2] (weighted by w_easiness): recency axis (depends on d[4])
  const d2 = 0.7 * (1.0 - lifetimeRatio) + 0.3 * (1.0 - d4);

  return [d0, d1, d2, d3, d4];
}

function clampOrdinal(value: number): number {
  if (value < 0.0) return 0.0;
  if (value > 1.0) return 1.0;
  return value;
}

/**
 * Compute one Mercy ordinal per element in `[0, 1]` (higher = postpone sooner).
 */
export function computeMercyOrdinals(
  weights: MercyWeights,
  elements: readonly MercyElementInput[],
): number[] {
  const wImp = Number(weights.importance ?? 0);
  const wLate = Number(weights.lateness ?? 0);
  const wEasy = Number(weights.easiness ?? 0);
  const wInv = Number(weights.investment ?? 0);
  const wRec = Number(weights.recency ?? 0);
  const weightSum = wImp + wLate + wEasy + wInv + wRec;

  return elements.map((el) => {
    const dims = computeMercyDimensionScores(el);
    if (weightSum <= 0.0) return 0.0;
    const weighted =
      wImp * dims[0] +
      wLate * dims[1] +
      wEasy * dims[2] +
      wInv * dims[3] +
      wRec * dims[4];
    return clampOrdinal(weighted / weightSum);
  });
}

/**
 * Derive `MercyElementInput` from a plugin `MercyEntry` at `actionMs`.
 */
export function toMercyElementInput(entry: MercyEntry, actionMs: number): MercyElementInput {
  // Priority 0..100 (0 = most important) -> importance fraction 0..1 (1 = most important)
  const clampedPriority = Math.min(100, Math.max(0, Number.isFinite(entry.priority) ? entry.priority : 50));
  const importance = Math.max(0.05, (100 - clampedPriority) / 100);
  const overdueMs = Math.max(0, actionMs - entry.dueMs);
  const lateness = Math.max(1, overdueMs / MS_PER_DAY);
  const investment = Math.max(0, entry.reps ?? 0);

  // Easiness in [0, 1]: for items use FSRS difficulty (1..10, 1=easiest) or retention;
  // for reading elements use A-Factor (1.1..4.0).
  let easiness = 0.5;
  if (entry.difficulty !== undefined && Number.isFinite(entry.difficulty)) {
    easiness = Math.min(1, Math.max(0, (10 - entry.difficulty) / 9));
  } else if (entry.aFactor !== undefined && Number.isFinite(entry.aFactor)) {
    easiness = Math.min(1, Math.max(0, (entry.aFactor - 1.0) / 3.0));
  } else if (entry.requestedRetention !== undefined && Number.isFinite(entry.requestedRetention)) {
    easiness = Math.min(1, Math.max(0, entry.requestedRetention));
  }

  return {
    importance,
    lateness,
    investment,
    easiness,
    ...(entry.interval !== undefined && entry.interval > 0 ? { intervalCap: entry.interval } : {}),
  };
}

export interface MercyEntry {
  id: string;
  priority: number;
  dueMs: number;
  dismissed?: boolean;
  type?: "item" | "reading";
  interval?: number;
  reps?: number;
  difficulty?: number;
  requestedRetention?: number;
  aFactor?: number;
  postponeCount?: number;
  totalPostponeCount?: number;
}

export interface ElementHistoryCounts {
  /** Number of reading advances (`topic-advanced` events) recorded for this element. */
  readingReps: number;
  /** Total `mercy-postponed` events not undone by `mercy-undone`. */
  totalPostponeCount: number;
  /** `mercy-postponed` events since the last active `graded` or `topic-advanced` event. */
  recentPostponeCount: number;
}

/**
 * Compute real reading repetition counts and total/recent postpone counts
 * from an ordered or unordered ledger event stream.
 */
export function computeElementHistoryCounts(
  events: ReadonlyArray<{ id: string; lamport: number; kind: string; target: string; payload: Record<string, unknown> }>,
): Map<string, ElementHistoryCounts> {
  const undoneGrades = new Set<string>();
  const undoneBatches = new Set<string>();
  for (const ev of events) {
    if (ev.kind === "grade-undone" && typeof ev.payload.eventId === "string") {
      undoneGrades.add(ev.payload.eventId);
    } else if (ev.kind === "mercy-undone" && typeof ev.payload.batchId === "string") {
      undoneBatches.add(ev.payload.batchId);
    }
  }
  const sorted = [...events].sort((a, b) => a.lamport - b.lamport || a.id.localeCompare(b.id));
  const map = new Map<string, ElementHistoryCounts>();
  const ensure = (id: string): ElementHistoryCounts => {
    let cur = map.get(id);
    if (!cur) {
      cur = { readingReps: 0, totalPostponeCount: 0, recentPostponeCount: 0 };
      map.set(id, cur);
    }
    return cur;
  };
  for (const ev of sorted) {
    if (ev.kind === "graded" && !undoneGrades.has(ev.id)) {
      const c = ensure(ev.target);
      c.recentPostponeCount = 0;
    } else if (ev.kind === "topic-advanced") {
      const c = ensure(ev.target);
      c.readingReps += 1;
      c.recentPostponeCount = 0;
    } else if (ev.kind === "mercy-postponed") {
      const batchId = typeof ev.payload.batchId === "string" ? ev.payload.batchId : undefined;
      if (batchId && undoneBatches.has(batchId)) continue;
      const c = ensure(ev.target);
      c.totalPostponeCount += 1;
      c.recentPostponeCount += 1;
    }
  }
  return map;
}

export interface MercyOptions {
  ceiling: number;
  /** Priorities at or below this value are protected. */
  priorityCutoff: number;
  /**
   * Optional 5-dimension Mercy weights. When provided and active
   * (`(weights.mode ?? 3) & 1`), elements are ordered by their multi-factor
   * mercy ordinal (lowest postpone-desirability kept today; highest postponed first).
   */
  weights?: MercyWeights;
}

export interface MercyAssignment {
  id: string;
  previousDue: number;
  newDue: number;
  targetLocalDate: string;
}

export interface MercyPlan {
  totalDue: number;
  dueToday: string[];
  protectedToday: string[];
  assignments: MercyAssignment[];
  postponed: string[];
  postponedCount: number;
  effectiveToday: number;
  perDay: Array<{ date: string; count: number }>;
}

export interface AutoPostponeOptions {
  keepOverdue: number;
  priorityCutoff: number;
  weights?: MercyWeights;
}

export interface AdvancedPostponePolicy {
  operation: "postpone" | "dilute" | "advance";
  includeItems: boolean;
  includeReading: boolean;
  itemDelayFactor: number;
  readingDelayFactor: number;
  minDelayDays: number;
  maxDelayDays: number;
  skipIntervalAbove?: number;
  skipPriorityAtOrBelow?: number;
  skipPostponeCountAbove?: number;
  skipRetentionAtOrAbove?: number;
  skipAFactorAtOrBelow?: number;
  scaleByPriority?: boolean;
  scaleByRetention?: boolean;
  scaleByAFactor?: boolean;
  /** Optional 5-dimension Mercy weights to order candidates and scale delays. */
  weights?: MercyWeights;
}

export interface AdvancedPostponePlan {
  assignments: MercyAssignment[];
  protectedIds: string[];
  skippedIds: string[];
}

/** Compact mercy summary for status bar and notices. */
export interface MercyResult {
  dueToday: string[];
  postponed: string[];
  postponedCount: number;
}

function compareImportance(a: MercyEntry, b: MercyEntry): number {
  return a.priority - b.priority || a.dueMs - b.dueMs || a.id.localeCompare(b.id);
}

/**
 * Order entries from most-important-to-keep-today to most-deserving-of-postponement.
 * When `weights` is provided and `((weights.mode ?? 3) & 1) === 1`,
 * entries are sorted by ascending mercy ordinal (since a higher ordinal
 * means postpone sooner), with `compareImportance` as the tiebreaker.
 */

export function sortByMercyImportance(
  entries: readonly MercyEntry[],
  actionMs: number,
  weights?: MercyWeights,
): MercyEntry[] {
  const copy = [...entries];
  if (!weights || ((weights.mode ?? 3) & 1) === 0) {
    return copy.sort(compareImportance);
  }
  const inputs = copy.map((e) => toMercyElementInput(e, actionMs));
  const ordinals = computeMercyOrdinals(weights, inputs);
  const ordById = new Map<string, number>();
  for (let i = 0; i < copy.length; i++) {
    ordById.set(copy[i]!.id, ordinals[i]!);
  }
  return copy.sort((a, b) => {
    const oa = ordById.get(a.id) ?? 0;
    const ob = ordById.get(b.id) ?? 0;
    if (Math.abs(oa - ob) > 1e-12) return oa - ob;
    return compareImportance(a, b);
  });
}

function localDateKey(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function addLocalDays(ms: number, days: number): number {
  const d = new Date(ms);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

export function planManualPostpone(
  currentDue: number | undefined,
  nowMs: number,
  days: number,
): { previousDue: number | undefined; newDue: number } {
  const anchor =
    currentDue !== undefined && Number.isFinite(currentDue)
      ? Math.max(currentDue, nowMs)
      : nowMs;
  const newDue = addLocalDays(anchor, days);
  return { previousDue: currentDue, newDue };
}

function combineLocalDate(dateMs: number, sourceMs: number, fallbackMs: number): number {
  const date = new Date(dateMs);
  const source = new Date(Number.isFinite(sourceMs) ? sourceMs : fallbackMs);
  date.setHours(source.getHours(), source.getMinutes(), source.getSeconds(), source.getMilliseconds());
  return date.getTime();
}

/**
 * Plan capacity-aware Mercy redistribution without mutating entries. Due work
 * is sorted by importance; protected overflow remains today, while other
 * overflow is assigned to the earliest future local date with capacity.
 */
export function planMercy(
  entries: readonly MercyEntry[],
  actionMs: number,
  opts: MercyOptions,
): MercyPlan {
  const ceiling = Math.max(0, Math.floor(opts.ceiling));
  if (ceiling === 0) {
    return {
      totalDue: 0,
      dueToday: [],
      protectedToday: [],
      assignments: [],
      postponed: [],
      postponedCount: 0,
      effectiveToday: 0,
      perDay: [],
    };
  }
  const due = sortByMercyImportance(
    entries.filter((e) => !e.dismissed && Number.isFinite(e.dueMs) && e.dueMs <= actionMs),
    actionMs,
    opts.weights,
  );
  const future = entries.filter((e) => !e.dismissed && Number.isFinite(e.dueMs) && e.dueMs > actionMs);
  const dueToday = due.slice(0, ceiling);
  const protectedToday: MercyEntry[] = [];
  const overflow: MercyEntry[] = [];
  for (const entry of due.slice(ceiling)) {
    (entry.priority <= opts.priorityCutoff ? protectedToday : overflow).push(entry);
  }
  const counts = new Map<string, number>();
  for (const entry of future) {
    const day = localDateKey(entry.dueMs);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  const assignments: MercyAssignment[] = [];
  for (const entry of overflow) {
    let dayMs = addLocalDays(actionMs, 1);
    while ((counts.get(localDateKey(dayMs)) ?? 0) >= ceiling && ceiling > 0) dayMs = addLocalDays(dayMs, 1);
    const date = localDateKey(dayMs);
    const newDue = combineLocalDate(dayMs, entry.dueMs, actionMs);
    counts.set(date, (counts.get(date) ?? 0) + 1);
    assignments.push({ id: entry.id, previousDue: entry.dueMs, newDue, targetLocalDate: date });
  }
  const perDay = [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count }));
  return {
    totalDue: due.length,
    dueToday: [...dueToday, ...protectedToday].map((e) => e.id),
    protectedToday: protectedToday.map((e) => e.id),
    assignments,
    postponed: assignments.map((a) => a.id),
    postponedCount: assignments.length,
    effectiveToday: dueToday.length + protectedToday.length,
    perDay,
  };
}

export function planAutoPostpone(
  entries: readonly MercyEntry[],
  actionMs: number,
  opts: AutoPostponeOptions,
): MercyPlan {
  const todayStart = new Date(actionMs);
  todayStart.setHours(0, 0, 0, 0);
  const cutoff = todayStart.getTime();
  const overdue = sortByMercyImportance(
    entries.filter((entry) => !entry.dismissed && Number.isFinite(entry.dueMs) && entry.dueMs < cutoff),
    actionMs,
    opts.weights,
  );
  const dueToday = sortByMercyImportance(
    entries.filter((entry) => !entry.dismissed && Number.isFinite(entry.dueMs) &&
      entry.dueMs >= cutoff && entry.dueMs <= actionMs),
    actionMs,
    opts.weights,
  );
  const keep = Math.max(0, Math.floor(opts.keepOverdue));
  const keptOverdue = overdue.slice(0, keep);
  const protectedOverdue: MercyEntry[] = [];
  const overflow: MercyEntry[] = [];
  for (const entry of overdue.slice(keep)) {
    (entry.priority <= opts.priorityCutoff ? protectedOverdue : overflow).push(entry);
  }
  const assignments = overflow.map((entry, index) => {
    const dayMs = addLocalDays(cutoff, index + 1);
    return {
      id: entry.id,
      previousDue: entry.dueMs,
      newDue: combineLocalDate(dayMs, entry.dueMs, actionMs),
      targetLocalDate: localDateKey(dayMs),
    };
  });
  const perDay = assignments.map((assignment) => ({ date: assignment.targetLocalDate, count: 1 }));
  return {
    totalDue: overdue.length + dueToday.length,
    dueToday: [...keptOverdue, ...protectedOverdue, ...dueToday].map((entry) => entry.id),
    protectedToday: protectedOverdue.map((entry) => entry.id),
    assignments,
    postponed: assignments.map((assignment) => assignment.id),
    postponedCount: assignments.length,
    effectiveToday: keptOverdue.length + protectedOverdue.length + dueToday.length,
    perDay,
  };
}

export function planAdvancedPostpone(
  entries: readonly MercyEntry[],
  actionMs: number,
  policy: AdvancedPostponePolicy,
): AdvancedPostponePlan {
  const assignments: MercyAssignment[] = [];
  const protectedIds: string[] = [];
  const skippedIds: string[] = [];
  const minDelay = Math.max(0, Math.round(policy.minDelayDays));
  const maxDelay = Math.max(minDelay, Math.round(policy.maxDelayDays));
  for (const entry of sortByMercyImportance(entries, actionMs, policy.weights)) {
    const isItem = entry.type === "item";
    if ((isItem && !policy.includeItems) || (!isItem && !policy.includeReading)) {
      skippedIds.push(entry.id);
      continue;
    }
    if (entry.dismissed || !Number.isFinite(entry.dueMs) ||
      (policy.operation === "postpone" && entry.dueMs > actionMs) ||
      (policy.skipIntervalAbove !== undefined && (entry.interval ?? 0) > policy.skipIntervalAbove) ||
      (policy.skipPriorityAtOrBelow !== undefined && entry.priority <= policy.skipPriorityAtOrBelow) ||
      (policy.skipPostponeCountAbove !== undefined && (entry.postponeCount ?? 0) > policy.skipPostponeCountAbove) ||
      (policy.skipRetentionAtOrAbove !== undefined && (entry.requestedRetention ?? 0) >= policy.skipRetentionAtOrAbove) ||
      (policy.skipAFactorAtOrBelow !== undefined && (entry.aFactor ?? Infinity) <= policy.skipAFactorAtOrBelow)) {
      protectedIds.push(entry.id);
      continue;
    }
    let factor = isItem ? policy.itemDelayFactor : policy.readingDelayFactor;
    if (policy.scaleByPriority) factor *= 0.5 + entry.priority / 100;
    if (policy.scaleByRetention && entry.requestedRetention !== undefined) factor *= 1.5 - entry.requestedRetention;
    if (policy.scaleByAFactor && entry.aFactor !== undefined) factor *= entry.aFactor / 2;
    const base = Math.max(1, entry.interval ?? 1);
    const delay = Math.min(maxDelay, Math.max(minDelay, Math.round(base * factor)));
    const signedDelay = policy.operation === "advance" ? -delay : delay;
    const newDue = combineLocalDate(addLocalDays(actionMs, signedDelay), entry.dueMs, actionMs);
    assignments.push({ id: entry.id, previousDue: entry.dueMs, newDue,
      targetLocalDate: localDateKey(newDue) });
  }
  return { assignments, protectedIds, skippedIds };
}

export type BranchPolicyMode = "respect" | "ignore" | "conservative" | "liberal";

export function resolveBranchDelay(
  inherited: number,
  branch: number | undefined,
  mode: BranchPolicyMode,
): number {
  if (branch === undefined || mode === "ignore") return inherited;
  if (mode === "respect") return branch;
  return mode === "conservative" ? Math.min(inherited, branch) : Math.max(inherited, branch);
}

/** Compatibility wrapper for the original pure split contract. */
export function redistribute(entries: MercyEntry[], nowMs: number, opts: MercyOptions): MercyResult {
  const plan = planMercy(entries, nowMs, opts);
  return { dueToday: plan.dueToday, postponed: plan.postponed, postponedCount: plan.postponedCount };
}

export { localDateKey, addLocalDays, combineLocalDate };
