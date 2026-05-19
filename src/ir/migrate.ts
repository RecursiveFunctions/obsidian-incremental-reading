/**
 * Pure frontmatter → append-only store events migration (DESIGN.md).
 */

import { readCardFromFrontmatter, cardToStored } from "../fsrs";
import { readTopicFromFrontmatter } from "../topic";
import { IR_KEYS } from "../types";
import {
  clampPriority,
  newElement,
  type IrElement,
  type IrEvent,
} from "./model";
import type { ElementId } from "./ids";

const MIGRATION_DEVICE = "dev_mig_ir_store" as IrEvent["device"];

const TOPIC_SETTINGS = {
  topicFirstInterval: 3,
  topicAFactor: 2,
  topicMaxInterval: 365,
};

export interface FrontmatterNote {
  path: string;
  frontmatter: Record<string, unknown>;
}

function encodePathForMigrId(path: string): string {
  const bytes = new TextEncoder().encode(path);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The element id a note path maps to. Exported so the live plugin targets
 * the *same* id the migration produced (and a re-migration would produce):
 * mutations made through the running UI land on the migrated element, and
 * recording a freshly created note is idempotent under re-run.
 */
export function elementIdForPath(path: string): ElementId {
  return `el_mig_${encodePathForMigrId(path)}` as ElementId;
}

function eventIdForPath(path: string): IrEvent["id"] {
  return `ev_mig_${encodePathForMigrId(path)}` as IrEvent["id"];
}

function hasValidIrDue(fm: Record<string, unknown>): boolean {
  const v = fm[IR_KEYS.due];
  if (typeof v === "string" || v instanceof Date) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return true;
  }
  return false;
}

function isMigratableType(v: unknown): v is IrElement["type"] {
  return v === "topic" || v === "extract" || v === "item";
}

export function migrateNotes(
  notes: FrontmatterNote[],
  now: number,
): IrEvent[] {
  const migrated = notes.filter((n) =>
    isMigratableType(n.frontmatter[IR_KEYS.type]),
  );
  migrated.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const out: IrEvent[] = [];
  let lamport = 0;

  for (const note of migrated) {
    lamport += 1;
    const fm = note.frontmatter;
    const type = fm[IR_KEYS.type] as IrElement["type"];
    const id = elementIdForPath(note.path);

    const rawPri = fm[IR_KEYS.priority];
    let element = newElement({
      id,
      type,
      priority: clampPriority(
        typeof rawPri === "number" && Number.isFinite(rawPri) ? rawPri : 50,
      ),
      now,
    });

    const parentRaw = fm[IR_KEYS.parent];
    const parentId =
      typeof parentRaw === "string"
        ? elementIdForPath(parentRaw)
        : null;

    element = {
      ...element,
      parentId,
      dismissed: fm[IR_KEYS.dismissed] === true,
      notePath: note.path,
      anchor: undefined,
      anchorState: "ok",
    };

    if (type === "topic" || type === "extract") {
      const state = readTopicFromFrontmatter(
        fm,
        TOPIC_SETTINGS,
        new Date(now),
      );
      element = {
        ...element,
        schedule: {
          due: state.dueMs,
          interval: state.interval,
          aFactor: state.aFactor,
        },
      };
    } else {
      let card = cardToStored(readCardFromFrontmatter(fm));
      if (!hasValidIrDue(fm)) {
        card = { ...card, due: now };
      }
      element = { ...element, card };
    }

    out.push({
      id: eventIdForPath(note.path),
      ts: now,
      lamport,
      device: MIGRATION_DEVICE,
      kind: "element-created",
      target: id,
      payload: { element },
    });
  }

  return out;
}
