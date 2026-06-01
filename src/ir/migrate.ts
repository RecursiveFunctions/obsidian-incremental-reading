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

/**
 * 64-bit FNV-1a hash returned as 16 hex chars. Not cryptographic; used only
 * to bound element-id filenames for deeply nested notes. Collision space
 * (2^64) is far past the hundreds-of-thousands-of-notes scale this plugin
 * targets. JS numbers can't hold 64 bits losslessly, so the inner loop runs
 * on BigInt.
 */
function fnv1a64Hex(s: string): string {
  // Constructor form, not literals: tsconfig targets ES2018 (BigInt
  // literals need ES2020). The runtime supports BigInt either way.
  const FNV_OFFSET = BigInt("0xcbf29ce484222325");
  const FNV_PRIME = BigInt("0x100000001b3");
  const MASK = BigInt("0xffffffffffffffff");
  let h = FNV_OFFSET;
  const bytes = new TextEncoder().encode(s);
  for (const b of bytes) {
    h ^= BigInt(b);
    h = (h * FNV_PRIME) & MASK;
  }
  return h.toString(16).padStart(16, "0");
}

/**
 * Encode a vault path into the body of `el_mig_<...>` / `ev_mig_<...>`.
 *
 * - Short paths use the original hex-of-utf8 encoding so existing ids in
 *   the event log stay byte-identical (backward compat for the >99% case).
 * - Long paths collapse to `h_<16-hex-hash>` so the resulting state file
 *   filename actually fits. Hash is deterministic, so a re-migration of
 *   the same vault produces identical ids and `.ir/state` stays idempotent.
 *
 * Threshold math: state file is `.ir/state/<id>.json`. Linux/macOS cap the
 * basename at 255 bytes (directory prefix is irrelevant). `<id>` must be
 * ≤ 250 chars; after the 7-char `el_mig_`/`ev_mig_` prefix and a 3-char
 * safety margin, the encoded body must be ≤ 240 hex chars (= 120 path
 * bytes of source).
 */
const ENCODED_BODY_MAX = 240;

function encodePathForMigrId(path: string): string {
  const bytes = new TextEncoder().encode(path);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  if (hex.length <= ENCODED_BODY_MAX) {
    return hex;
  }
  return `h_${fnv1a64Hex(path)}`;
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
