/**
 * Display label helpers shared by the tree view and the review pane
 * (UI commitment #5: breadcrumb visible during review). Pure: no Obsidian
 * APIs, no I/O, so they unit-test directly.
 */

import type { IrElement, IrType } from "./model";
import { stripExtractMarks } from "./frontmatter-body";

/** Human label for an element. Prefer the note basename; fall back to the
 *  first ~80 chars of stored text; fall back to a "(type)" tag.
 *
 *  Strips `<mark class="ir-extract-source">` chrome so a label drawn from
 *  the stored text of an extract whose body contained a sibling extract
 *  does not show the raw HTML as escaped text in the breadcrumb. */
export function labelFor(el: IrElement): string {
  if (el.notePath) {
    const base = el.notePath.split("/").pop() ?? el.notePath;
    return base.replace(/\.md$/i, "");
  }
  const text = stripExtractMarks(el.text).trim().replace(/\s+/g, " ");
  if (text.length === 0) return `(${el.type})`;
  return text.length > 80 ? text.slice(0, 77) + "..." : text;
}

/** Short disambiguator from a store element id (filename-safe-ish). */
export function shortElementTag(id: string): string {
  const alnum = id.replace(/[^a-zA-Z0-9]/g, "");
  return (alnum.slice(0, 6) || id.slice(0, 6)).toLowerCase();
}

/** Non-spoilery type word for cloze/extract rows where titles leak answers. */
export function neutralTypeLabel(type: IrType): string {
  switch (type) {
    case "topic":
      return "Topic";
    case "extract":
      return "Extract";
    case "item":
      return "Cloze item";
  }
}

/**
 * Tree / session-log row title. Topics and extracts always keep their real
 * names — only cloze items risk leaking their hidden answer through the
 * label (the basename / first chars of text often *are* the answer), so
 * those are the only rows masked when `maskSpoilers` is on.
 */
export function treeRowLabel(el: IrElement, maskSpoilers = false): string {
  if (maskSpoilers && el.type === "item") {
    return `${neutralTypeLabel(el.type)} (${shortElementTag(el.id)})`;
  }
  return labelFor(el);
}

/**
 * Review pane progress line (`1 of N · Review · …`). For cloze items before
 * reveal, note basenames usually spoil the card; use a neutral headline.
 */
export function reviewHeadlineLabel(
  el: IrElement,
  maskClozeTitle: boolean,
): string {
  if (!maskClozeTitle || el.type !== "item") return labelFor(el);
  return `${neutralTypeLabel(el.type)} (${shortElementTag(el.id)})`;
}

/**
 * Breadcrumb segment for an ancestor. When `maskClozeContext` is true (cloze
 * item before reveal), ancestor note titles often restate the answer.
 */
export function ancestorBreadcrumbLabel(
  el: IrElement,
  maskClozeContext: boolean,
): string {
  if (!maskClozeContext) return labelFor(el);
  return neutralTypeLabel(el.type);
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
