/**
 * Session audit (UI commitment #7). Compiles the list of every IR action
 * taken since the current review pass started (Alt+R / Alt+N), so the user can
 * "audit their own pass" the way SuperMemo never made obvious.
 *
 * Pure: takes events + an element index + the session start timestamp,
 * returns a sorted list of entries. The store already records every IR
 * action as an event, so this is a filter + format, not a new tracking
 * mechanism (which would risk drifting from the store's truth).
 */

import { treeRowLabel } from "./labels";
import type { IrElement, IrEvent, IrEventKind } from "./model";

export interface SessionEntry {
  ts: number;
  kind: IrEventKind;
  elementId: string;
  label: string;
  notePath?: string;
}

const KIND_LABEL: Record<IrEventKind, string> = {
  "element-created": "created",
  "priority-set": "priority set",
  "dismiss-set": "dismissed",
  graded: "graded",
  "grade-undone": "grade undone",
  "topic-advanced": "advanced",
  "mercy-postponed": "mercy postponed",
  "anchor-repaired": "anchor repaired",
  "anchor-detached": "anchor detached",
  promoted: "promoted",
  reparented: "reparented",
  "source-tombstoned": "source removed",
  "source-restored": "source restored",
  "source-renamed": "source renamed",
  "element-deleted": "deleted",
  "text-edited": "text edited",
};

export function actionLabel(kind: IrEventKind): string {
  return KIND_LABEL[kind] ?? kind;
}

/**
 * Returns the session entries newest first. An event whose target element
 * is missing from `byId` still shows up (the action happened), but the
 * label falls back to the raw element id.
 */
export function sessionEntries(
  events: Iterable<IrEvent>,
  byId: Map<string, IrElement>,
  sessionStartMs: number,
): SessionEntry[] {
  const out: SessionEntry[] = [];
  for (const ev of events) {
    if (ev.ts < sessionStartMs) continue;
    const el = byId.get(ev.target);
    out.push({
      ts: ev.ts,
      kind: ev.kind,
      elementId: ev.target,
      label: el ? treeRowLabel(el) : ev.target,
      notePath: el?.notePath,
    });
  }
  out.sort((a, b) => b.ts - a.ts);
  return out;
}

/** Local-time HH:MM:SS for the audit row. */
export function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}
