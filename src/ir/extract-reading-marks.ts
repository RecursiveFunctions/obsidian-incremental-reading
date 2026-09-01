/**
 * Reading-view extract highlight policy (DESIGN §Q3). Pure helpers so
 * tests do not load the CodeMirror decoration module.
 *
 * Needles are normalized (markdown emphasis chars stripped, whitespace
 * collapsed) so they match Obsidian's rendered text nodes. Identical
 * quotes each get a mark at the Nth occurrence. Needles shorter than
 * 4 characters are skipped to avoid noisy matches.
 */

import { normalizeForMatch } from "./anchor";
import { Normalizer } from "./fuzzy-text";

const MIN_NEEDLE = 4;

/**
 * Turn stored extract/cloze text into a needle that can match a rendered
 * preview text node. Markdown emphasis markers are stripped because the
 * reading view / MarkdownRenderer output no longer contains them.
 */
export function readingViewNeedle(text: string): string {
  const normalized = normalizeForMatch(text);
  if (normalized.length >= MIN_NEEDLE) return normalized;
  const trimmed = text.trim();
  return trimmed.length >= MIN_NEEDLE ? trimmed : "";
}

export function readingViewNeedlePasses(
  ranges: ReadonlyArray<{ text: string }>,
): { needle: string; n: number }[] {
  const counts = new Map<string, number>();
  const out: { needle: string; n: number }[] = [];
  for (const r of ranges) {
    const needle = readingViewNeedle(r.text);
    if (!needle) continue;
    const n = counts.get(needle) ?? 0;
    counts.set(needle, n + 1);
    out.push({ needle, n });
  }
  return out;
}

/**
 * Markdown chrome the renderer eats at the head of a line: blockquote
 * markers, list bullets, ordered-list numbers, heading hashes. Stored
 * extract text keeps them; the rendered `<li>` / `<p>` does not.
 */
const BLOCK_CHROME_RE = /^[ \t]*(?:>[ \t]*)*(?:(?:[-*+]|\d+[.)])[ \t]+|#{1,6}[ \t]+)?/;

/** One rendered block's worth of an extract, plus its per-line fallbacks. */
export interface NeedleBlock {
  /** Needle for the whole paragraph / list item. */
  needle: string;
  /** Per-line needles, block chrome stripped, for lists and hard breaks. */
  lines: string[];
}

/**
 * Split a stored extract into the needles that can actually match rendered
 * HTML. A needle never spans two blocks: Obsidian builds the preview DOM
 * with no whitespace between block elements, so the end of one paragraph
 * and the start of the next concatenate with nothing between them, while
 * the stored text has a blank line there. The same applies to a multi-span
 * (Ctrl multi-select) extract, whose spans are joined with a blank line.
 *
 * Callers try the whole-extract needle first and fall back to these.
 */
export function readingViewNeedleBlocks(text: string): NeedleBlock[] {
  const out: NeedleBlock[] = [];
  for (const para of text.split(/\r?\n[ \t]*\r?\n/)) {
    const needle = readingViewNeedle(para);
    const lines: string[] = [];
    for (const line of para.split(/\r?\n/)) {
      const n = readingViewNeedle(line.replace(BLOCK_CHROME_RE, ""));
      if (n && n !== needle && !lines.includes(n)) lines.push(n);
    }
    if (needle || lines.length > 0) out.push({ needle, lines });
  }
  return out;
}

/** Offset of the `n`-th (0-based) occurrence of `needle` in `haystack`. */
export function nthOccurrenceOffset(
  haystack: string,
  needle: string,
  n: number,
): number {
  if (!needle || n < 0) return -1;
  let from = 0;
  let seen = 0;
  while (from <= haystack.length) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) return -1;
    if (seen === n) return idx;
    seen += 1;
    from = idx + 1;
  }
  return -1;
}

export interface DomSourceMark {
  text: string;
  cls: string;
}

/**
 * Paint extract/cloze marks into an already-rendered markdown root.
 * Used by the review pane (ItemView) where HTML-in-markdown splicing is
 * unreliable, and as the shared implementation behind the reading-view
 * MarkdownPostProcessor.
 *
 * Identical needles are marked at the Nth occurrence (stable with the
 * decoration cache order). Spans already inside an IR mark are left alone.
 */
export function paintIrSourceMarksInElement(
  root: HTMLElement,
  marks: ReadonlyArray<DomSourceMark>,
): void {
  const counts = new Map<string, number>();
  const paint = (needle: string, cls: string): boolean => {
    const n = counts.get(needle) ?? 0;
    counts.set(needle, n + 1);
    // Fast path: the whole needle sits in one text node. Otherwise the
    // extract crosses inline formatting (bold, links, code) and we wrap
    // each text-node slice it touches.
    if (wrapNthOccurrenceInTextNode(root, needle, n, cls)) return true;
    return wrapNthOccurrenceAcrossNodes(root, needle, n, cls);
  };
  for (const m of marks) {
    const needle = readingViewNeedle(m.text);
    if (!needle) continue;
    if (paint(needle, m.cls)) continue;
    // The extract covers more than one rendered block (multi-paragraph
    // selection, list, or a multi-span Ctrl-select extract whose spans are
    // stored joined by a blank line). No single needle can match across a
    // block boundary, so paint block by block, then line by line.
    for (const block of readingViewNeedleBlocks(m.text)) {
      if (block.needle && block.needle !== needle) {
        if (paint(block.needle, m.cls)) continue;
      }
      for (const line of block.lines) {
        if (line !== needle) paint(line, m.cls);
      }
    }
  }
}

/**
 * Formatting-tolerant variant: normalizes the concatenated text of every
 * text node under `root` (same rules as the needle), finds the n-th
 * occurrence, and wraps each touched text node's slice in its own
 * `<mark>`. Returns true on a hit.
 */
export function wrapNthOccurrenceAcrossNodes(
  root: HTMLElement,
  needle: string,
  n: number,
  cls: string,
): boolean {
  const norm = new Normalizer<{ node: Text; offset: number }>();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null = walker.nextNode();
  while (node) {
    const t = node as Text;
    const text = t.nodeValue ?? "";
    for (let i = 0; i < text.length; i++) {
      norm.push(text[i]!, { node: t, offset: i });
    }
    node = walker.nextNode();
  }
  const idx = nthOccurrenceOffset(norm.text, needle, n);
  if (idx === -1) return false;
  const refs = norm.refs.slice(idx, idx + needle.length);
  // Group consecutive refs by text node.
  const slices: Array<{ node: Text; start: number; end: number }> = [];
  for (const r of refs) {
    const last = slices[slices.length - 1];
    if (last && last.node === r.node) last.end = r.offset + 1;
    else slices.push({ node: r.node, start: r.offset, end: r.offset + 1 });
  }
  let hit = false;
  for (const sl of slices) {
    if (isInsideIrSourceMark(sl.node)) {
      hit = true;
      continue;
    }
    const parent = sl.node.parentNode;
    if (!parent) continue;
    const text = sl.node.nodeValue ?? "";
    const before = text.slice(0, sl.start);
    const mid = text.slice(sl.start, sl.end);
    const after = text.slice(sl.end);
    if (!mid.trim()) continue;
    const mark = document.createElement("mark");
    mark.className = cls;
    mark.textContent = mid;
    if (before) parent.insertBefore(document.createTextNode(before), sl.node);
    parent.insertBefore(mark, sl.node);
    if (after) parent.insertBefore(document.createTextNode(after), sl.node);
    parent.removeChild(sl.node);
    hit = true;
  }
  return hit;
}

function isInsideIrSourceMark(node: Node): boolean {
  let p: Node | null = node.parentNode;
  while (p) {
    if (
      p instanceof HTMLElement &&
      p.tagName === "MARK" &&
      (p.classList.contains("ir-extract-source") ||
        p.classList.contains("ir-cloze-source") ||
        p.classList.contains("ir-extract-highlight"))
    ) {
      return true;
    }
    p = p.parentNode;
  }
  return false;
}

/**
 * Walk text nodes under `root` in document order; wrap the `n`-th occurrence
 * of `needle` (0-based, counting inside already-marked nodes so indices
 * match source order). Returns true on a hit or if that occurrence is
 * already inside an IR mark.
 */
export function wrapNthOccurrenceInTextNode(
  root: HTMLElement,
  needle: string,
  n: number,
  cls: string,
): boolean {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let seen = 0;
  let node: Node | null = walker.nextNode();
  while (node) {
    const t = node as Text;
    const text = t.nodeValue ?? "";
    let searchFrom = 0;
    while (searchFrom < text.length) {
      const idx = text.indexOf(needle, searchFrom);
      if (idx === -1) break;
      if (seen === n) {
        if (isInsideIrSourceMark(t)) return true;
        const parent = t.parentNode;
        if (!parent) return false;
        const before = text.slice(0, idx);
        const after = text.slice(idx + needle.length);
        const mark = document.createElement("mark");
        mark.className = cls;
        mark.textContent = needle;
        if (before) parent.insertBefore(document.createTextNode(before), t);
        parent.insertBefore(mark, t);
        if (after) parent.insertBefore(document.createTextNode(after), t);
        parent.removeChild(t);
        return true;
      }
      seen += 1;
      searchFrom = idx + 1;
    }
    node = walker.nextNode();
  }
  return false;
}
