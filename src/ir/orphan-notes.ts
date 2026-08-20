/**
 * Put IR-marked notes back in the store when they vanished from the fold.
 *
 * A folder move used to fire source-gone, which `element-deleted` every
 * file-backed topic/extract/item. The notes still exist (new path, same
 * `ir-type` frontmatter). Migration does not re-run, so they stay out of
 * `.ir/` until something appends `element-created` again.
 *
 * Resurrect with the *old* element id when the log or a tombstone names
 * the previous path — a fresh `el_mig_<newpath>` would break `parentId`
 * links. Fall back to `migrateNotes` for notes the store never saw.
 */

import type { DeviceId, ElementId, EventId } from "./ids";
import { fold } from "./log";
import { elementIdForPath, migrateNotes, type FrontmatterNote } from "./migrate";
import type { IrElement, IrEvent } from "./model";
import {
  inferPrefixRewrite,
  originalPathBySuffix,
  rewriteStoredPath,
  uniqueMovedPath,
} from "./source-paths";

export function storeNotePaths(elements: Iterable<IrElement>): Set<string> {
  const s = new Set<string>();
  for (const el of elements) {
    if (el.notePath) s.add(el.notePath);
  }
  return s;
}

export function orphanNotes(
  notes: FrontmatterNote[],
  elements: Iterable<IrElement>,
): FrontmatterNote[] {
  const have = storeNotePaths(elements);
  return notes.filter((n) => !have.has(n.path));
}

export function knownNotePathsFromEvents(events: IrEvent[]): string[] {
  const s = new Set<string>();
  for (const ev of events) {
    if (ev.kind === "element-created") {
      const p = (ev.payload.element as IrElement | undefined)?.notePath;
      if (p) s.add(p);
    } else if (ev.kind === "source-renamed") {
      const oldPath = ev.payload.oldPath;
      const newPath = ev.payload.newPath;
      if (typeof oldPath === "string") s.add(oldPath);
      if (typeof newPath === "string") s.add(newPath);
    } else if (ev.kind === "source-tombstoned") {
      const t = ev.payload.tombstone as { path?: string } | undefined;
      if (typeof t?.path === "string") s.add(t.path);
    }
  }
  return [...s];
}

export function lastIdForNotePath(
  events: IrEvent[],
  notePath: string,
): ElementId | null {
  const sorted = [...events].sort((a, b) => {
    if (a.lamport !== b.lamport) return a.lamport - b.lamport;
    return a.id.localeCompare(b.id);
  });
  let id: ElementId | null = null;
  for (const ev of sorted) {
    if (ev.kind === "element-created") {
      const el = ev.payload.element as IrElement | undefined;
      if (el?.notePath === notePath) id = ev.target;
    } else if (ev.kind === "source-renamed") {
      if (ev.payload.oldPath === notePath || ev.payload.newPath === notePath) {
        id = ev.target;
      }
    }
  }
  return id;
}

/**
 * Which historical path became `newPath`. Suffix / unique basename /
 * folder-prefix, preferring a tombstoned path when several names collide.
 */
export function matchMovedFrom(
  newPath: string,
  oldCandidates: Iterable<string>,
  vaultPaths: Iterable<string>,
  tombstonePaths?: Iterable<string>,
): string | null {
  const unique = [
    ...new Set([...oldCandidates].filter((p) => p && p !== newPath)),
  ];
  const bySuffix = originalPathBySuffix(newPath, unique);
  if (bySuffix) return bySuffix;

  const vault = Array.from(vaultPaths);
  const tombs = new Set(tombstonePaths ?? []);
  const byUnique = unique.filter(
    (old) => uniqueMovedPath(old, vault) === newPath,
  );
  if (byUnique.length === 1) return byUnique[0]!;
  if (byUnique.length > 1) {
    const tombHits = byUnique.filter((p) => tombs.has(p));
    if (tombHits.length === 1) return tombHits[0]!;
    byUnique.sort((a, b) => b.length - a.length);
    if (byUnique[0]!.length > byUnique[1]!.length) return byUnique[0]!;
  }

  const prefix = inferPrefixRewrite(unique, vault);
  if (prefix) {
    const hits = unique.filter(
      (old) => rewriteStoredPath(old, prefix.from, prefix.to) === newPath,
    );
    if (hits.length === 1) return hits[0]!;
    if (hits.length > 1) {
      hits.sort((a, b) => b.length - a.length);
      return hits[0]!;
    }
  }
  return null;
}

export interface OrphanRecoveryPlan {
  events: IrEvent[];
  /** Notes put back (rename, resurrect, or first-time import). */
  restored: number;
}

function recoveredIdFor(
  events: IrEvent[],
  notePath: string,
  oldPath: string | null,
  tombSet: Set<string>,
  historical: Set<string>,
): ElementId | null {
  const fromOld = oldPath ? lastIdForNotePath(events, oldPath) : null;
  if (fromOld) return fromOld;
  const fromNew = lastIdForNotePath(events, notePath);
  if (fromNew) return fromNew;
  if (
    oldPath &&
    (tombSet.has(oldPath) || historical.has(oldPath))
  ) {
    return elementIdForPath(oldPath);
  }
  return null;
}

function elementAtNewPath(
  known: IrElement | undefined,
  note: FrontmatterNote,
  oldPath: string | null,
  recoveredId: ElementId,
  now: number,
): IrElement | null {
  const created = migrateNotes([note], now);
  const fromFm =
    created.length > 0
      ? (created[0]!.payload.element as IrElement)
      : undefined;
  if (known) {
    let element: IrElement = {
      ...known,
      notePath: note.path,
      priority: fromFm?.priority ?? known.priority,
      dismissed: fromFm?.dismissed ?? known.dismissed,
      parentId: fromFm?.parentId ?? known.parentId,
      schedule: fromFm?.schedule ?? known.schedule,
      card: fromFm?.card ?? known.card,
    };
    if (oldPath && known.anchor?.sourcePath === oldPath) {
      element = {
        ...element,
        anchor: { ...known.anchor, sourcePath: note.path },
        anchorState: "ok",
      };
    }
    return element;
  }
  if (!fromFm) return null;
  return { ...fromFm, id: recoveredId, notePath: note.path };
}

/**
 * Events that put orphan IR notes back in the fold. Fresh event ids — the
 * deterministic `ev_mig_<path>` ids collide if that path was imported once.
 */
export function planOrphanRecoveries(
  notes: FrontmatterNote[],
  liveElements: Iterable<IrElement>,
  events: IrEvent[],
  tombstonePaths: Iterable<string>,
  vaultPaths: Iterable<string>,
  now: number,
  startLamport: number,
  device: DeviceId,
  mkEventId: () => EventId,
): OrphanRecoveryPlan {
  const liveList = Array.from(liveElements);
  const orphans = orphanNotes(notes, liveList);
  if (orphans.length === 0) {
    return { events: [], restored: 0 };
  }

  const live = new Map<ElementId, IrElement>();
  for (const el of liveList) live.set(el.id, el);

  const includingDeleted = fold(
    events.filter((e) => e.kind !== "element-deleted"),
  ).elements;

  const tombSet = new Set(tombstonePaths);
  const historicalList = [
    ...knownNotePathsFromEvents(events),
    ...tombSet,
  ];
  const historical = new Set(historicalList);
  const vault = Array.from(vaultPaths);

  const out: IrEvent[] = [];
  let lamport = startLamport;
  const seenIds = new Set<ElementId>();
  const restoredTombs = new Set<string>();
  const moves: { oldPath: string; newPath: string }[] = [];
  let restored = 0;

  const push = (
    kind: IrEvent["kind"],
    target: ElementId,
    payload: Record<string, unknown>,
  ) => {
    out.push({
      id: mkEventId(),
      ts: now,
      lamport,
      device,
      kind,
      target,
      payload,
    });
    lamport += 1;
  };

  const sorted = [...orphans].sort((a, b) => a.path.localeCompare(b.path));

  for (const note of sorted) {
    const oldPath = matchMovedFrom(note.path, historicalList, vault, tombSet);
    const recoveredId = recoveredIdFor(
      events,
      note.path,
      oldPath,
      tombSet,
      historical,
    );

    if (recoveredId && seenIds.has(recoveredId)) continue;

    if (recoveredId && live.has(recoveredId)) {
      const el = live.get(recoveredId)!;
      const from = el.notePath ?? oldPath;
      if (from && from !== note.path) {
        push("source-renamed", recoveredId, {
          oldPath: from,
          newPath: note.path,
        });
        restored += 1;
      }
      seenIds.add(recoveredId);
    } else if (recoveredId) {
      const element = elementAtNewPath(
        includingDeleted.get(recoveredId),
        note,
        oldPath,
        recoveredId,
        now,
      );
      if (!element) continue;
      push("element-created", recoveredId, { element });
      seenIds.add(recoveredId);
      restored += 1;
    } else {
      const created = migrateNotes([note], now);
      if (created.length === 0) continue;
      const ev = created[0]!;
      if (seenIds.has(ev.target) || live.has(ev.target)) continue;
      push("element-created", ev.target, ev.payload);
      seenIds.add(ev.target);
      restored += 1;
    }

    if (oldPath && oldPath !== note.path) {
      moves.push({ oldPath, newPath: note.path });
    }
  }

  for (const { oldPath, newPath } of moves) {
    for (const el of live.values()) {
      if (el.anchor?.sourcePath !== oldPath) continue;
      push("anchor-repaired", el.id, {
        anchor: { ...el.anchor, sourcePath: newPath },
      });
    }
    if (tombSet.has(oldPath) && !restoredTombs.has(oldPath)) {
      const target =
        lastIdForNotePath(events, oldPath) ??
        elementIdForPath(oldPath);
      push("source-restored", target, { path: oldPath, restoredPath: newPath });
      restoredTombs.add(oldPath);
    }
  }

  return { events: out, restored };
}
