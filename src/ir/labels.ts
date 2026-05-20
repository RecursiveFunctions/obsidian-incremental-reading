/**
 * Display label helpers shared by the tree view and the review pane
 * (UI commitment #5: breadcrumb visible during review). Pure: no Obsidian
 * APIs, no I/O, so they unit-test directly.
 */

import type { IrElement } from "./model";

/** Human label for an element. Prefer the note basename; fall back to the
 *  first ~80 chars of stored text; fall back to a "(type)" tag. */
export function labelFor(el: IrElement): string {
  if (el.notePath) {
    const base = el.notePath.split("/").pop() ?? el.notePath;
    return base.replace(/\.md$/i, "");
  }
  const text = el.text.trim().replace(/\s+/g, " ");
  if (text.length === 0) return `(${el.type})`;
  return text.length > 80 ? text.slice(0, 77) + "..." : text;
}

/**
 * Walk parent links from `start` toward the root. Returns the ancestors in
 * root-first order (immediate parent last). Excludes `start` itself. Stops
 * at `maxDepth` ancestors, at a missing parent (orphan branch), or at a
 * cycle. Default `maxDepth = 4` keeps the breadcrumb readable.
 */
export function ancestorChain(
  start: IrElement,
  byId: Map<string, IrElement>,
  maxDepth = 4,
): IrElement[] {
  const chain: IrElement[] = [];
  const seen = new Set<string>([start.id]);
  let cur: IrElement | undefined = start;
  while (cur?.parentId && chain.length < maxDepth) {
    const parent = byId.get(cur.parentId);
    if (!parent || seen.has(parent.id)) break;
    chain.unshift(parent);
    seen.add(parent.id);
    cur = parent;
  }
  return chain;
}
