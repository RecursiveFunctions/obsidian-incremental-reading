import type { ElementId } from "./ids";

export interface DuePrioritySnapshot {
  id: ElementId;
  priority: number;
  type: "item" | "reading";
}

export interface AnalyticsSession {
  id: string;
  mode: "due" | "random" | "neural";
  processedIds: ElementId[];
  skippedIds: ElementId[];
  remainingIds: ElementId[];
}

export interface DailyPriorityAnalytics {
  schemaVersion: 1;
  deviceId: string;
  dayKey: string;
  createdAt: number;
  utcOffsetMinutes: number;
  policyVersion: number;
  due: DuePrioritySnapshot[];
  sessions: AnalyticsSession[];
  sortingPolicy?: Record<string, unknown>;
  autoPostpone?: Record<string, unknown>;
  capacity?: number;
  readingProportion?: number;
}

export interface ProtectionSummary {
  item: number | null;
  reading: number | null;
  itemOutstanding: number;
  readingOutstanding: number;
  itemProcessed: number;
  readingProcessed: number;
}

export function priorityProtection(day: DailyPriorityAnalytics): ProtectionSummary {
  const processed = new Set(day.sessions.flatMap((session) => session.processedIds));
  const remaining = day.due.filter((entry) => !processed.has(entry.id));
  const item = remaining.filter((entry) => entry.type === "item");
  const reading = remaining.filter((entry) => entry.type === "reading");
  return {
    item: item.length ? Math.min(...item.map((entry) => entry.priority)) : null,
    reading: reading.length ? Math.min(...reading.map((entry) => entry.priority)) : null,
    itemOutstanding: item.length,
    readingOutstanding: reading.length,
    itemProcessed: day.due.filter((entry) => entry.type === "item" && processed.has(entry.id)).length,
    readingProcessed: day.due.filter((entry) => entry.type === "reading" && processed.has(entry.id)).length,
  };
}

export function mergeAnalyticsSessions(
  sessions: readonly AnalyticsSession[],
): AnalyticsSession[] {
  const byId = new Map<string, AnalyticsSession>();
  for (const session of sessions) {
    const prior = byId.get(session.id);
    if (!prior) {
      byId.set(session.id, {
        ...session,
        processedIds: [...new Set(session.processedIds)],
        skippedIds: [...new Set(session.skippedIds)],
        remainingIds: [...new Set(session.remainingIds)],
      });
      continue;
    }
    prior.processedIds = [...new Set([...prior.processedIds, ...session.processedIds])];
    prior.skippedIds = [...new Set([...prior.skippedIds, ...session.skippedIds])];
    prior.remainingIds = [...new Set([...prior.remainingIds, ...session.remainingIds])];
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export interface PriorityGrade {
  grade: number;
  priority?: number;
}

export function forgettingIndexByPriority(
  grades: readonly PriorityGrade[],
  bucketSize = 10,
): Array<{ start: number; end: number; failures: number; samples: number; rate: number }> {
  const size = Math.max(1, Math.min(100, Math.round(bucketSize)));
  const buckets = new Map<number, { failures: number; samples: number }>();
  for (const grade of grades) {
    if (!Number.isFinite(grade.priority) || grade.grade < 1 || grade.grade > 4) continue;
    const start = Math.min(100 - size, Math.floor(Math.min(100, Math.max(0, grade.priority!)) / size) * size);
    const bucket = buckets.get(start) ?? { failures: 0, samples: 0 };
    bucket.samples += 1;
    if (grade.grade === 1) bucket.failures += 1;
    buckets.set(start, bucket);
  }
  return [...buckets.entries()].sort(([a], [b]) => a - b).map(([start, value]) => ({
    start,
    end: start + size,
    ...value,
    rate: value.failures / value.samples,
  }));
}

export function parseDailyPriorityAnalytics(value: unknown): DailyPriorityAnalytics | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const day = value as DailyPriorityAnalytics;
  if (day.schemaVersion !== 1 || typeof day.deviceId !== "string" ||
    typeof day.dayKey !== "string" || !Number.isFinite(day.createdAt) ||
    !Number.isFinite(day.utcOffsetMinutes) || !Number.isInteger(day.policyVersion) ||
    !Array.isArray(day.due) || !Array.isArray(day.sessions)) return null;
  if (!day.due.every((entry) => entry && typeof entry.id === "string" &&
    Number.isFinite(entry.priority) && (entry.type === "item" || entry.type === "reading"))) return null;
  return day;
}
