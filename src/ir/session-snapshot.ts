import type { ElementId } from "./ids";

export const SESSION_SNAPSHOT_VERSION = 1;
export type SessionMode = "due" | "random" | "neural";

export interface SessionSnapshot {
  schemaVersion: 1;
  mode: SessionMode;
  orderedIds: ElementId[];
  cursor: number;
  seed: number;
  policyVersion: number;
  repetitionDayKey: string;
  createdAt: number;
}

export function repetitionDayKey(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseSessionSnapshot(value: unknown): SessionSnapshot | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== SESSION_SNAPSHOT_VERSION) return null;
  if (candidate.mode !== "due" && candidate.mode !== "random" && candidate.mode !== "neural") return null;
  if (!Array.isArray(candidate.orderedIds) ||
    !candidate.orderedIds.every((id) => typeof id === "string" && id.length > 0)) return null;
  if (!Number.isInteger(candidate.cursor) || (candidate.cursor as number) < 0) return null;
  if (!Number.isFinite(candidate.seed) || !Number.isInteger(candidate.policyVersion) ||
    (candidate.policyVersion as number) < 1) return null;
  if (typeof candidate.repetitionDayKey !== "string" || !candidate.repetitionDayKey) return null;
  if (!Number.isFinite(candidate.createdAt)) return null;
  const orderedIds = [...new Set(candidate.orderedIds as ElementId[])];
  return {
    schemaVersion: 1,
    mode: candidate.mode,
    orderedIds,
    cursor: Math.min(candidate.cursor as number, Math.max(0, orderedIds.length - 1)),
    seed: Math.trunc(candidate.seed as number),
    policyVersion: candidate.policyVersion as number,
    repetitionDayKey: candidate.repetitionDayKey,
    createdAt: candidate.createdAt as number,
  };
}

export function restoreSessionSnapshot(
  snapshot: SessionSnapshot,
  availableIds: ReadonlySet<ElementId>,
  currentDayKey: string,
  supportedPolicyVersion: number,
): SessionSnapshot | null {
  if (snapshot.policyVersion !== supportedPolicyVersion) return null;
  if (snapshot.mode === "due" && snapshot.repetitionDayKey !== currentDayKey) return null;
  const currentId = snapshot.orderedIds[snapshot.cursor];
  const orderedIds = snapshot.orderedIds.filter((id) => availableIds.has(id));
  if (orderedIds.length === 0) return null;
  const currentIndex = currentId === undefined ? -1 : orderedIds.indexOf(currentId);
  const removedBefore = snapshot.orderedIds
    .slice(0, snapshot.cursor)
    .filter((id) => !availableIds.has(id)).length;
  return {
    ...snapshot,
    orderedIds,
    cursor: currentIndex >= 0
      ? currentIndex
      : Math.min(orderedIds.length - 1, Math.max(0, snapshot.cursor - removedBefore)),
  };
}
