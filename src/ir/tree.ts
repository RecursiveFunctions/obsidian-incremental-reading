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

/**
 * Prune a forest to nodes the predicate accepts, plus every ancestor needed
 * to reach them. Used by the tree view's search and type-filter chips.
 *
 * Why ancestors are kept regardless of their own match: a topic that holds
 * the only matching extract still needs to render so the user can see where
 * the match lives. The tree view's chevrons stay collapsed/expanded
 * independently of the filter.
 *
 * Pure: the caller is responsible for any per-node side-effects (label
 * lookups, body reads). The predicate is consulted node-by-node so the
 * caller can compose multiple filters (text + type + due-status) cheaply.
 *
 * The returned forest is a deep copy of the matching slice; the original
 * `roots` argument is left untouched. Returns an empty array when no node
 * passes — callers should treat that as "no matches" rather than re-render
 * the whole tree.
 */
/**
 * Compute the inclusive range of visible-tree ids from `anchorId` to
 * `targetId` for shift-click bulk-selection. The order argument is the
 * already-flattened pre-order traversal of the currently-rendered tree
 * (collapsed children excluded), which is what the tree view holds in
 * `lastRenderedRoots` after each render.
 *
 * Returns `[targetId]` alone when either id is missing from the order
 * (e.g. anchor was on a now-collapsed branch). The caller should treat
 * that as "selection switches to a single row" rather than an error.
 *
 * Pure: lives here so the math is unit-testable without DOM/Obsidian.
 */
export function rangeSelectIds(
  visibleOrder: string[],
  anchorId: string,
  targetId: string,
): string[] {
  const i1 = visibleOrder.indexOf(anchorId);
  const i2 = visibleOrder.indexOf(targetId);
  if (i1 < 0 || i2 < 0) return [targetId];
  const lo = Math.min(i1, i2);
  const hi = Math.max(i1, i2);
  return visibleOrder.slice(lo, hi + 1);
}

export function filterTreeByPredicate(
  roots: TreeNode[],
  predicate: (node: TreeNode) => boolean,
): TreeNode[] {
  const walk = (node: TreeNode): TreeNode | null => {
    const filteredChildren = node.children
      .map(walk)
      .filter((c): c is TreeNode => c !== null);
    if (predicate(node) || filteredChildren.length > 0) {
      return { ...node, children: filteredChildren };
    }
    return null;
  };
  return roots.map(walk).filter((n): n is TreeNode => n !== null);
}
