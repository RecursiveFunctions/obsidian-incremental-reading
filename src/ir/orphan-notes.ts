/**
 * Return a note path that is not in `isTaken`, appending " 2", " 3", ... to
 * the stem. Used when promoting orphans whose id tag and first line collide.
 */
export function uniquePromotedNotePath(
  basePath: string,
  isTaken: (path: string) => boolean,
): string {
  const dot = basePath.lastIndexOf(".");
  const stem = dot > 0 ? basePath.slice(0, dot) : basePath;
  const extension = dot > 0 ? basePath.slice(dot) : "";
  let candidate = basePath;
  let suffix = 2;
  while (isTaken(candidate)) {
    candidate = `${stem} ${suffix}${extension}`;
    suffix += 1;
  }
  return candidate;
}

/**
 * Put IR-marked notes back in the ledger when they vanished from the fold.
 *
 * A folder move used to fire source-gone, which `element-deleted` every
 * file-backed topic/extract/item. The notes still exist (new path, same
 * `ir-type` frontmatter). Migration does not re-run, so they stay out of
 * `.ir/` until something appends `element-created` again.
 *
 * Resurrect with the *old* element id when the log or a tombstone names
 * the previous path — a fresh `el_mig_<newpath>` would break `parentId`
 * links. Fall back to `migrateNotes` for notes the ledger never saw.
 */

import type { DeviceId, ElementId, EventId } from "./ids";
import { fold } from "./log";
import { elementIdForPath, migrateNotes, type FrontmatterNote } from "./migrate";
import type { IrElement, IrEvent } from "./model";
import {
  buildPriorityPlacement,
  collectionSortOrder,
  insertionIndexForPriority,
  type PriorityPlacement,
} from "./relative-priority";
import { clampPriority } from "./model";
import {
  basenameOf,
  dirnameOf,
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
    } else if (ev.kind === "promoted") {
      const notePath = ev.payload.notePath;
      if (typeof notePath === "string") s.add(notePath);
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
    } else if (ev.kind === "promoted") {
      if (ev.payload.notePath === notePath) {
        id = ev.target;
      }
    }
  }
  return id;
}

/**
 * Elements whose latest lifecycle event is a deliberate Collection
 * `element-deleted`, not a folder-move tombstone (`#28`). A Collection
 * delete leaves the note on disk with `ir-type` frontmatter, so the
 * orphan pass would resurrect it every startup. When the note was moved,
 * its last known path sits in `tombSet` instead and recovery stays on.
 */
export function explicitlyDeletedIds(
  events: IrEvent[],
  tombSet: ReadonlySet<string>,
): Set<ElementId> {
  const sorted = [...events].sort((a, b) => {
    if (a.lamport !== b.lamport) return a.lamport - b.lamport;
    return a.id.localeCompare(b.id);
  });
  const pathById = new Map<ElementId, string>();
  const deleted = new Set<ElementId>();
  for (const ev of sorted) {
    if (ev.kind === "element-created") {
      const p = (ev.payload.element as IrElement | undefined)?.notePath;
      if (typeof p === "string") pathById.set(ev.target, p);
      deleted.delete(ev.target);
    } else if (ev.kind === "source-renamed") {
      if (typeof ev.payload.newPath === "string") {
        pathById.set(ev.target, ev.payload.newPath);
      }
    } else if (ev.kind === "promoted") {
      if (typeof ev.payload.notePath === "string") {
        pathById.set(ev.target, ev.payload.notePath);
      }
    } else if (ev.kind === "element-deleted") {
      deleted.add(ev.target);
    }
  }
  const out = new Set<ElementId>();
  for (const id of deleted) {
    const p = pathById.get(id);
    if (p === undefined || !tombSet.has(p)) out.add(id);
  }
  return out;
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

interface MoveIndex {
  candidatesByBasename: Map<string, string[]>;
  uniqueVaultByBasename: Map<string, string | null>;
  prefix: { from: string; to: string } | null;
  tombs: ReadonlySet<string>;
}

function buildLastIdByPath(sortedEvents: readonly IrEvent[]): Map<string, ElementId> {
  const map = new Map<string, ElementId>();
  for (const ev of sortedEvents) {
    if (ev.kind === "element-created") {
      const el = ev.payload.element as IrElement | undefined;
      if (el?.notePath) map.set(el.notePath, ev.target);
    } else if (ev.kind === "source-renamed") {
      if (typeof ev.payload.oldPath === "string") {
        map.set(ev.payload.oldPath, ev.target);
      }
      if (typeof ev.payload.newPath === "string") {
        map.set(ev.payload.newPath, ev.target);
      }
    } else if (ev.kind === "promoted") {
      if (typeof ev.payload.notePath === "string") {
        map.set(ev.payload.notePath, ev.target);
      }
    }
  }
  return map;
}

function buildMoveIndex(
  historicalList: readonly string[],
  vault: readonly string[],
  tombs: ReadonlySet<string>,
): MoveIndex {
  const uniqueCandidates = [...new Set(historicalList.filter(Boolean))];
  const candidatesByBasename = new Map<string, string[]>();
  for (const p of uniqueCandidates) {
    const base = basenameOf(p);
    if (!base) continue;
    let bucket = candidatesByBasename.get(base);
    if (!bucket) {
      bucket = [];
      candidatesByBasename.set(base, bucket);
    }
    bucket.push(p);
  }

  const uniqueVaultByBasename = new Map<string, string | null>();
  const vaultSet = new Set<string>();
  for (const p of vault) {
    vaultSet.add(p);
    const base = basenameOf(p);
    if (!base) continue;
    if (!uniqueVaultByBasename.has(base)) {
      uniqueVaultByBasename.set(base, p);
    } else if (uniqueVaultByBasename.get(base) !== p) {
      uniqueVaultByBasename.set(base, null);
    }
  }

  const votes = new Map<string, number>();
  for (const gone of uniqueCandidates) {
    const base = basenameOf(gone);
    if (!base) continue;
    let hit: string | null = null;
    const singleVault = uniqueVaultByBasename.get(base) ?? null;
    if (singleVault && singleVault !== gone) {
      hit = singleVault;
    } else {
      const needle = `/${gone}`;
      let suffixHit: string | null = null;
      let suffixAmbiguous = false;
      for (const vp of vault) {
        if (vp === gone) continue;
        if (vp.endsWith(needle)) {
          if (suffixHit !== null) {
            suffixAmbiguous = true;
            break;
          }
          suffixHit = vp;
        }
      }
      if (!suffixAmbiguous && suffixHit) {
        hit = suffixHit;
      } else if (singleVault === null) {
        // Only possible if gone itself was one of 2 vault files with same basename
        let altHit: string | null = null;
        let altCount = 0;
        if (vaultSet.has(gone)) {
          for (const vp of vault) {
            if (vp === gone) continue;
            if (basenameOf(vp) === base) {
              altHit = vp;
              altCount += 1;
              if (altCount > 1) break;
            }
          }
          if (altCount === 1) hit = altHit;
        }
      }
    }
    if (!hit) continue;
    const from = dirnameOf(gone);
    const to = dirnameOf(hit);
    if (from === to) continue;
    const key = `${from}\n${to}`;
    votes.set(key, (votes.get(key) ?? 0) + 1);
  }

  let best: { from: string; to: string; n: number } | null = null;
  for (const [key, n] of votes) {
    if (n < 2) continue;
    if (!best || n > best.n) {
      const sep = key.indexOf("\n");
      best = { from: key.slice(0, sep), to: key.slice(sep + 1), n };
    }
  }

  return {
    candidatesByBasename,
    uniqueVaultByBasename,
    prefix: best ? { from: best.from, to: best.to } : null,
    tombs,
  };
}

function matchMovedFromIndexed(newPath: string, index: MoveIndex): string | null {
  const base = basenameOf(newPath);
  const sameBase = (index.candidatesByBasename.get(base) ?? []).filter(
    (p) => p !== newPath,
  );
  if (sameBase.length === 0) return null;

  const bySuffix = originalPathBySuffix(newPath, sameBase);
  if (bySuffix) return bySuffix;

  if (index.uniqueVaultByBasename.get(base) === newPath) {
    const byUnique = [...sameBase];
    if (byUnique.length === 1) return byUnique[0]!;
    if (byUnique.length > 1) {
      const tombHits = byUnique.filter((p) => index.tombs.has(p));
      if (tombHits.length === 1) return tombHits[0]!;
      byUnique.sort((a, b) => b.length - a.length);
      if (byUnique[0]!.length > byUnique[1]!.length) return byUnique[0]!;
    }
  }

  if (index.prefix) {
    const prefix = index.prefix;
    const hits = sameBase.filter(
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

function recoveredIdForIndexed(
  lastIdByPath: ReadonlyMap<string, ElementId>,
  notePath: string,
  oldPath: string | null,
  tombSet: Set<string>,
  historical: Set<string>,
): ElementId | null {
  const fromOld = oldPath ? (lastIdByPath.get(oldPath) ?? null) : null;
  if (fromOld) return fromOld;
  const fromNew = lastIdByPath.get(notePath) ?? null;
  if (fromNew) return fromNew;
  if (
    oldPath &&
    (tombSet.has(oldPath) || historical.has(oldPath))
  ) {
    return elementIdForPath(oldPath);
  }
  return null;
}

function insertIntoCollectionOrder(
  order: ElementId[],
  live: ReadonlyMap<ElementId, IrElement>,
  el: IrElement,
): PriorityPlacement {
  const existingIdx = order.indexOf(el.id);
  if (existingIdx !== -1) order.splice(existingIdx, 1);
  const index = insertionIndexForPriority(el.priority, order.length + 1);
  const placement: PriorityPlacement = {
    requestedPriority: clampPriority(el.priority),
    beforeId: order[index],
    afterId: index > 0 ? order[index - 1] : undefined,
  };
  // Maintain collectionSortOrder invariant: priority ASC, created DESC, id ASC
  let lo = 0;
  let hi = order.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const midEl = live.get(order[mid]!)!;
    const cmp =
      el.priority - midEl.priority ||
      midEl.created - el.created ||
      el.id.localeCompare(midEl.id);
    if (cmp < 0) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }
  order.splice(lo, 0, el.id);
  return placement;
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
      schedule: known.schedule ?? fromFm?.schedule,
      card: known.card ?? fromFm?.card,
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

  const sortedEvents = [...events].sort((a, b) => {
    if (a.lamport !== b.lamport) return a.lamport - b.lamport;
    return a.id.localeCompare(b.id);
  });
  const lastIdByPath = buildLastIdByPath(sortedEvents);

  const tombSet = new Set(tombstonePaths);
  const explicitDeletes = explicitlyDeletedIds(sortedEvents, tombSet);
  const historicalList = [
    ...knownNotePathsFromEvents(sortedEvents),
    ...tombSet,
  ];
  const historical = new Set(historicalList);
  const vault = Array.from(vaultPaths);
  const moveIndex = buildMoveIndex(historicalList, vault, tombSet);
  const currentOrder = collectionSortOrder(live.values());

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
    const oldPath = matchMovedFromIndexed(note.path, moveIndex);
    const recoveredId = recoveredIdForIndexed(
      lastIdByPath,
      note.path,
      oldPath,
      tombSet,
      historical,
    );

    // Exclude deliberate Collection deletes regardless of whether the note
    // has since moved. Folder-move deletes carry a tombstone and are already
    // excluded from explicitDeletes, so intended recovery is unaffected.
    if (recoveredId && explicitDeletes.has(recoveredId)) {
      continue;
    }

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
      const placement = insertIntoCollectionOrder(currentOrder, live, element);
      push("element-created", recoveredId, {
        element,
        placement,
      });
      live.set(recoveredId, element);
      seenIds.add(recoveredId);
      restored += 1;
    } else {
      const created = migrateNotes([note], now);
      if (created.length === 0) continue;
      const ev = created[0]!;
      if (seenIds.has(ev.target) || live.has(ev.target)) continue;
      const element = ev.payload.element as IrElement;
      const placement = insertIntoCollectionOrder(currentOrder, live, element);
      push("element-created", ev.target, {
        ...ev.payload,
        placement,
      });
      live.set(ev.target, element);
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
        lastIdByPath.get(oldPath) ??
        elementIdForPath(oldPath);
      push("source-restored", target, { path: oldPath, restoredPath: newPath });
      restoredTombs.add(oldPath);
    }
  }

  return { events: out, restored };
}
