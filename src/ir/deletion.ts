import type { IrElement, IrEvent, SourceTombstone } from "./model";
import type { ElementId, EventId, DeviceId } from "./ids";

export interface DeletionOptions {
  autoPromoteRootless: boolean;
}

export function planSourceDeletion(
  elements: IrElement[],
  deletedPath: string,
  title: string,
  now: number,
  startLamport: number,
  device: DeviceId,
  mkEventId: (i: number) => EventId,
  promotePath: (el: IrElement) => string,
  opts: DeletionOptions,
): IrEvent[] {
  if (elements.length === 0) {
    return [];
  }

  const sorted = [...elements].sort((a, b) => a.id.localeCompare(b.id));

  const sourceIds = new Set<ElementId>();
  for (const el of sorted) {
    if (el.notePath === deletedPath) {
      sourceIds.add(el.id);
    }
  }

  const idToEl = new Map<ElementId, IrElement>();
  for (const el of sorted) {
    idToEl.set(el.id, el);
  }

  const sourceEls = sorted.filter((e) => e.notePath === deletedPath);
  const tombTarget: ElementId =
    sourceEls.length > 0 ? sourceEls[0].id : sorted[0].id;

  const reparentCandidates = sorted.filter(
    (e) => e.parentId !== null && sourceIds.has(e.parentId),
  );

  const parentAfterReparent = new Map<ElementId, ElementId | null>();
  for (const el of sorted) {
    parentAfterReparent.set(el.id, el.parentId);
  }
  for (const el of reparentCandidates) {
    const parent = idToEl.get(el.parentId as ElementId);
    const grandparent = parent ? parent.parentId : null;
    parentAfterReparent.set(el.id, grandparent);
  }

  function isGenuinelyRootless(el: IrElement): boolean {
    const pid = parentAfterReparent.get(el.id) ?? null;
    if (pid === null) return true;
    return sourceIds.has(pid);
  }

  const anchoredToSource = sorted.filter(
    (e) => e.anchor?.sourcePath === deletedPath,
  );

  const promoteTargets = opts.autoPromoteRootless
    ? anchoredToSource.filter((e) => isGenuinelyRootless(e))
    : [];

  const out: IrEvent[] = [];
  let seq = 0;
  let lamport = startLamport;

  const push = (
    kind: IrEvent["kind"],
    target: ElementId,
    payload: Record<string, unknown>,
  ) => {
    out.push({
      id: mkEventId(seq),
      ts: now,
      lamport,
      device,
      kind,
      target,
      payload,
    });
    seq += 1;
    lamport += 1;
  };

  const tombstone: SourceTombstone = {
    path: deletedPath,
    title,
    deletedAt: now,
  };
  push("source-tombstoned", tombTarget, { tombstone });

  for (const el of reparentCandidates) {
    const parent = idToEl.get(el.parentId as ElementId);
    const newParentId = parent ? parent.parentId : null;
    push("reparented", el.id, { parentId: newParentId });
  }

  for (const el of sourceEls) {
    push("element-deleted", el.id, {});
  }

  for (const el of anchoredToSource) {
    push("anchor-detached", el.id, {});
  }

  for (const el of promoteTargets) {
    push("promoted", el.id, { notePath: promotePath(el) });
  }

  return out;
}

/** Extracts (and promoted notes) whose anchor still names this deleted source. */
export function relinkCandidates(
  elements: IrElement[],
  tombstonePath: string,
): IrElement[] {
  return [...elements]
    .filter((e) => e.anchor?.sourcePath === tombstonePath)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Restore `sourcePath` on every extract that still names the tombstone, then
 * drop the tombstone. `restoredPath` is where the note lives now (same as
 * `tombstonePath` on a trash restore; a rename-onto-the-old-path can differ).
 */
export function planSourceRelink(
  elements: IrElement[],
  tombstonePath: string,
  restoredPath: string,
  now: number,
  startLamport: number,
  device: DeviceId,
  mkEventId: (i: number) => EventId,
): IrEvent[] {
  const candidates = relinkCandidates(elements, tombstonePath);
  const out: IrEvent[] = [];
  let seq = 0;
  let lamport = startLamport;

  const push = (
    kind: IrEvent["kind"],
    target: ElementId,
    payload: Record<string, unknown>,
  ) => {
    out.push({
      id: mkEventId(seq),
      ts: now,
      lamport,
      device,
      kind,
      target,
      payload,
    });
    seq += 1;
    lamport += 1;
  };

  for (const el of candidates) {
    if (!el.anchor) continue;
    push("anchor-repaired", el.id, {
      anchor: { ...el.anchor, sourcePath: restoredPath },
    });
  }

  const tombTarget: ElementId =
    candidates[0]?.id ?? (`el_restored:${tombstonePath}` as ElementId);
  push("source-restored", tombTarget, {
    path: tombstonePath,
    restoredPath,
  });
  return out;
}

/**
 * Paths the collection still names whose markdown file is gone, and which
 * have no tombstone yet. Used on plugin load to catch deletes that happened
 * while Obsidian was closed (Sync, git, file explorer).
 */
export function missingSourcePaths(
  elements: IrElement[],
  tombstonePaths: Iterable<string>,
  fileExists: (path: string) => boolean,
): string[] {
  const tombs = new Set(tombstonePaths);
  const found = new Set<string>();
  for (const el of elements) {
    for (const path of [el.notePath, el.anchor?.sourcePath]) {
      if (!path || tombs.has(path) || fileExists(path)) continue;
      found.add(path);
    }
  }
  return [...found].sort();
}

export function titleFromSourcePath(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.(md|pdf)$/i, "") || path;
}

/**
 * Remember that this path is gone without tearing down the tree. Used when
 * the user undoes source-delete handling: we must not prompt again on the
 * next load, but extracts stay parented and anchored as they were.
 */
export function planSourceTombstoneOnly(
  elements: IrElement[],
  deletedPath: string,
  title: string,
  now: number,
  startLamport: number,
  device: DeviceId,
  mkEventId: (i: number) => EventId,
): IrEvent[] {
  const sorted = [...elements].sort((a, b) => a.id.localeCompare(b.id));
  const sourceEls = sorted.filter((e) => e.notePath === deletedPath);
  const tombTarget: ElementId =
    sourceEls[0]?.id ??
    sorted.find((e) => e.anchor?.sourcePath === deletedPath)?.id ??
    (`el_tomb:${deletedPath}` as ElementId);
  const tombstone: SourceTombstone = {
    path: deletedPath,
    title,
    deletedAt: now,
  };
  return [
    {
      id: mkEventId(0),
      ts: now,
      lamport: startLamport,
      device,
      kind: "source-tombstoned",
      target: tombTarget,
      payload: { tombstone },
    },
  ];
}

/**
 * Reverse a source-deletion plan: restore deleted source elements, original
 * parents, and anchors; drop notePaths we promoted. Keeps the tombstone so a
 * later load does not treat the missing file as a new deletion.
 */
export function planUndoSourceDeletion(
  before: IrElement[],
  deletionEvents: IrEvent[],
  now: number,
  startLamport: number,
  device: DeviceId,
  mkEventId: (i: number) => EventId,
): IrEvent[] {
  const byId = new Map(before.map((e) => [e.id, e]));
  const out: IrEvent[] = [];
  let seq = 0;
  let lamport = startLamport;

  const push = (
    kind: IrEvent["kind"],
    target: ElementId,
    payload: Record<string, unknown>,
  ) => {
    out.push({
      id: mkEventId(seq),
      ts: now,
      lamport,
      device,
      kind,
      target,
      payload,
    });
    seq += 1;
    lamport += 1;
  };

  const deleted = deletionEvents.filter((e) => e.kind === "element-deleted");
  const reparented = deletionEvents.filter((e) => e.kind === "reparented");
  const detached = deletionEvents.filter((e) => e.kind === "anchor-detached");
  const promoted = deletionEvents.filter((e) => e.kind === "promoted");

  for (const ev of deleted) {
    const el = byId.get(ev.target);
    if (el) push("element-created", ev.target, { element: el });
  }
  for (const ev of reparented) {
    const el = byId.get(ev.target);
    if (el) push("reparented", ev.target, { parentId: el.parentId });
  }
  for (const ev of detached) {
    const el = byId.get(ev.target);
    if (el?.anchor) {
      push("anchor-repaired", ev.target, { anchor: el.anchor });
    }
  }
  for (const ev of promoted) {
    push("demoted", ev.target, {});
  }
  return out;
}

/** Forget a tombstone without repairing anchors (user declined re-link). */
export function planClearTombstone(
  tombstonePath: string,
  target: ElementId,
  now: number,
  startLamport: number,
  device: DeviceId,
  mkEventId: (i: number) => EventId,
): IrEvent[] {
  return [
    {
      id: mkEventId(0),
      ts: now,
      lamport: startLamport,
      device,
      kind: "source-restored",
      target,
      payload: { path: tombstonePath },
    },
  ];
}
