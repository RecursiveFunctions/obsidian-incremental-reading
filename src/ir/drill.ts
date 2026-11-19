import type { Grade } from "../fsrs";
import type { ElementId } from "./ids";
import type { IrElement } from "./model";

export type FinalDrillMode = "again-and-hard" | "again" | "off";

export const DRILL_STATE_VERSION = 1;

export interface DrillState {
  schemaVersion: 1;
  dayKey: string;
  elementIds: ElementId[];
}

export function emptyDrillState(dayKey: string): DrillState {
  return {
    schemaVersion: DRILL_STATE_VERSION,
    dayKey,
    elementIds: [],
  };
}

/** `0x00f7ef90`: items scoring below the Good threshold (`< 4` in SM) enter `drill.dat`. */
export function shouldEnqueueForDrill(grade: Grade, mode: FinalDrillMode): boolean {
  if (mode === "off") return false;
  if (mode === "again") return grade === "again";
  return grade === "again" || grade === "hard";
}

export function gradePassesDrill(grade: Grade, mode: FinalDrillMode): boolean {
  if (mode === "off") return true;
  if (mode === "again") return grade !== "again";
  return grade === "good" || grade === "easy";
}

export function parseDrillState(value: unknown): DrillState | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== DRILL_STATE_VERSION) return null;
  if (typeof record.dayKey !== "string" || record.dayKey.length === 0) return null;
  if (
    !Array.isArray(record.elementIds) ||
    !record.elementIds.every((id) => typeof id === "string" && id.length > 0)
  ) {
    return null;
  }
  return {
    schemaVersion: DRILL_STATE_VERSION,
    dayKey: record.dayKey,
    elementIds: [...new Set(record.elementIds as ElementId[])],
  };
}

/** Reset stale-day drills and prune deleted, dismissed, or non-item elements (`TDatabase.IsDeleted`). */
export function normalizeDrillState(
  state: DrillState | null | undefined,
  currentDayKey: string,
  elements?: ReadonlyMap<ElementId, IrElement>,
): DrillState {
  if (!state || state.dayKey !== currentDayKey) {
    return emptyDrillState(currentDayKey);
  }
  const seen = new Set<ElementId>();
  const filtered: ElementId[] = [];
  for (const id of state.elementIds) {
    if (seen.has(id)) continue;
    if (elements) {
      const el = elements.get(id);
      if (!el || el.dismissed || el.type !== "item") continue;
    }
    seen.add(id);
    filtered.push(id);
  }
  return {
    schemaVersion: DRILL_STATE_VERSION,
    dayKey: currentDayKey,
    elementIds: filtered,
  };
}

export function enqueueDrillElement(
  state: DrillState,
  id: ElementId,
): { state: DrillState; added: boolean } {
  if (state.elementIds.includes(id)) {
    return { state, added: false };
  }
  return {
    state: {
      ...state,
      elementIds: [...state.elementIds, id],
    },
    added: true,
  };
}

export function removeDrillElement(state: DrillState, id: ElementId): DrillState {
  if (!state.elementIds.includes(id)) return state;
  return {
    ...state,
    elementIds: state.elementIds.filter((existing) => existing !== id),
  };
}

export function applyDrillGrade(
  state: DrillState,
  id: ElementId,
  grade: Grade,
  mode: FinalDrillMode,
): { state: DrillState; passed: boolean } {
  const rest = state.elementIds.filter((existing) => existing !== id);
  if (gradePassesDrill(grade, mode)) {
    return {
      state: { ...state, elementIds: rest },
      passed: true,
    };
  }
  return {
    state: { ...state, elementIds: [...rest, id] },
    passed: false,
  };
}

export function orderDrillIds(
  ids: readonly ElementId[],
  randomize: boolean,
  rng: () => number = Math.random,
): ElementId[] {
  const out = [...ids];
  if (!randomize || out.length <= 1) return out;
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.min(i, Math.max(0, Math.floor(rng() * (i + 1))));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}
