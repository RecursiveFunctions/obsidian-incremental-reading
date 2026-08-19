/**
 * Display label helpers shared by the tree view and the review pane
 * (UI commitment #5: breadcrumb visible during review). Pure: no Obsidian
 * APIs, no I/O, so they unit-test directly.
 */

import type { IrElement, IrType } from "./model";
import { stripExtractMarks } from "./frontmatter-body";
import { hasCloze, redactClozeAnswers } from "../cloze";

/** Human label for an element. Prefer the note basename; fall back to the
 *  first ~80 chars of stored text; fall back to a "(type)" tag.
 *
 *  Strips `<mark class="ir-extract-source">` chrome so a label drawn from
 *  the stored text of an extract whose body contained a sibling extract
 *  does not show the raw HTML as escaped text in the breadcrumb. */
export function labelFor(el: IrElement): string {
  if (el.notePath) {
    const base = el.notePath.split("/").pop() ?? el.notePath;
    return base.replace(/\.(md|pdf)$/i, "");
  }
  const text = stripExtractMarks(el.text).trim().replace(/\s+/g, " ");
  if (text.length === 0) return `(${el.type})`;
  return text.length > 80 ? text.slice(0, 77) + "..." : text;
}

/**
 * Short disambiguator drawn from an element id, used as the visible tag in
 * spoiler-masked rows like `Cloze item (kqwhz5)`.
 *
 * Implementation note: the previous version stripped `_` and took the first
 * 6 alnum chars. That reads fine for random UUIDs (`el_<uuid>`) but collapses
 * every migrated id to a near-identical tag, because migration ids share a
 * literal `el_mig_` prefix and their suffix is the path encoded as hex —
 * many notes that live under the same folder produce the same first six
 * alnum chars (e.g. every note starting with `K` becomes `elmig4` because
 * `K` is `0x4b`). Hashing the id with djb2 spreads the values uniformly so
 * distinct migrated ids get distinct, stable tags. djb2 is plenty for a
 * 6-char UI label — no security or strict-uniqueness guarantees needed.
 */
export function shortElementTag(id: string): string {
  let h = 5381 >>> 0;
  for (let i = 0; i < id.length; i++) {
    h = (((h << 5) + h) ^ id.charCodeAt(i)) >>> 0;
  }
  return h.toString(36).padStart(6, "0").slice(-6);
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
 *
 * When `body` is supplied (the tree view loads it via `cachedRead` before
 * rendering) and contains cloze syntax, the masked label becomes the cloze
 * question with each `{{cN::…}}` answer replaced by `____`. That lets the
 * user identify a card by its prompt while still hiding the answer:
 *
 *     "A is defined as {{c1::B}}"  →  "A is defined as ____"
 *
 * Falls back to the neutral `Cloze item (xxxxxx)` form when no body is
 * available or the body has no cloze syntax (basenames are still
 * answer-shaped, so we never trust them for masked rows).
 */
export function treeRowLabel(
  el: IrElement,
  maskSpoilers = false,
  body?: string,
): string {
  if (maskSpoilers && el.type === "item") {
    return maskedItemLabel(el, body);
  }
  return labelFor(el);
}

function maskedItemLabel(el: IrElement, body: string | undefined): string {
  if (body && hasCloze(body)) {
    const redacted = redactClozeAnswers(body).trim().replace(/\s+/g, " ");
    if (redacted.length > 0) {
      return redacted.length > 80 ? redacted.slice(0, 77) + "..." : redacted;
    }
  }
  return `${neutralTypeLabel(el.type)} (${shortElementTag(el.id)})`;
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
