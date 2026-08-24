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
  for (const m of marks) {
    const needle = readingViewNeedle(m.text);
    if (!needle) continue;
    const n = counts.get(needle) ?? 0;
    counts.set(needle, n + 1);
    wrapNthOccurrenceInTextNode(root, needle, n, m.cls);
  }
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
