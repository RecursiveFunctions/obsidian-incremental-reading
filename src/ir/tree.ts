/**
 * Pure element-hierarchy builder for the v0.2 element tree view (DESIGN.md §3).
 * Deterministic, total, and cycle-safe: each input element appears exactly once.
 */

import type { IrElement, IrType } from "./model";
import type { ElementId } from "./ids";

export interface TreeNode {
  id: string;
  type: IrType;
  element: IrElement;
  children: TreeNode[];
}

function compareByPriorityThenId(a: IrElement, b: IrElement): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function compareRoots(a: TreeNode, b: TreeNode): number {
  return compareByPriorityThenId(a.element, b.element);
}

export function buildTree(elements: IrElement[]): TreeNode[] {
  if (elements.length === 0) return [];

  const index = new Map<string, IrElement>();
  for (const el of elements) {
    index.set(el.id, el);
  }

  const placed = new Set<string>();
  const roots: TreeNode[] = [];

  function buildSubtree(root: IrElement): TreeNode {
    placed.add(root.id);

    const childElems: IrElement[] = [];
    for (const e of elements) {
      if (e.parentId === root.id) {
        childElems.push(e);
      }
    }
    childElems.sort(compareByPriorityThenId);

    const children: TreeNode[] = [];
    for (const c of childElems) {
      if (placed.has(c.id)) continue;
      children.push(buildSubtree(c));
    }

    return {
      id: root.id,
      type: root.type,
      element: root,
      children,
    };
  }

  const naturalRoots = elements.filter(
    (e) => e.parentId === null || !index.has(e.parentId as ElementId),
  );
  naturalRoots.sort(compareByPriorityThenId);

  for (const r of naturalRoots) {
    if (placed.has(r.id)) continue;
    roots.push(buildSubtree(r));
  }

  for (;;) {
    let smallest: string | undefined;
    for (const e of elements) {
      if (placed.has(e.id)) continue;
      if (smallest === undefined || e.id < smallest) {
        smallest = e.id;
      }
    }
    if (smallest === undefined) break;
    const synthetic = index.get(smallest);
    if (synthetic === undefined) break;
    roots.push(buildSubtree(synthetic));
  }

  roots.sort(compareRoots);
  return roots;
}
