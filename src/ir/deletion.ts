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
