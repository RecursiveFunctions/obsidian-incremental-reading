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
 * Reduce markdown link syntax to what the renderer actually shows, so a
 * needle built from stored text can match a rendered text node.
 * `[label](url)` shows `label`, `[[note|alias]]` shows `alias`, and images
 * / embeds show no text at all. Without this a cloze or extract on link
 * text carries `](https://…)` in its needle and never matches anything.
 */
export function flattenLinksForMatch(text: string): string {
  return text
    .replace(/!\[\[[^\]\n]+\]\]/g, "")
    .replace(/!\[[^\]\n]*\]\([^)\n]*\)/g, "")
    .replace(/\[\[[^\]\n|]*\|([^\]\n]*)\]\]/g, "$1")
    .replace(/\[\[([^\]\n]+)\]\]/g, "$1")
    .replace(/\[([^\]\n]*)\]\([^)\n]*\)/g, "$1");
}

/**
 * Turn stored extract/cloze text into a needle that can match a rendered
 * preview text node. Markdown emphasis markers and link syntax are stripped
 * because the reading view / MarkdownRenderer output no longer contains them.
 */
export function readingViewNeedle(text: string, minLen = MIN_NEEDLE): string {
  const flat = flattenLinksForMatch(text);
  const normalized = normalizeForMatch(flat);
  if (normalized.length >= minLen) return normalized;
  const trimmed = flat.trim();
  return trimmed.length >= minLen ? trimmed : "";
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

/**
 * Which occurrence of its own needle a stored span is, counted in the
 * source body. The painter used to number marks by the order they arrived,
 * so extracting the *second* "Paris" in a note highlighted the first one.
 * Counting in the body (links flattened, whitespace collapsed, same rules
 * as the needle) gives the index the DOM walk will land on.
 */
export function occurrenceIndexInSource(
  body: string,
  start: number,
  text: string,
): number {
  const needle = readingViewNeedle(text, 1);
  if (!needle) return 0;
  const before = normalizeForMatch(flattenLinksForMatch(body.slice(0, start)));
  let n = 0;
  let from = 0;
  for (;;) {
    const i = before.indexOf(needle, from);
    if (i === -1) return n;
    n += 1;
    from = i + 1;
  }
}

/** Normalized left/right context around `[start, end]` in `body` for exact DOM span disambiguation. */
export function sourceMarkContext(
  body: string,
  start: number,
  end: number,
  window = 48,
): { leftContext: string; rightContext: string } {
  const rawLeft = body.slice(Math.max(0, start - window), start);
  const rawRight = body.slice(end, Math.min(body.length, end + window));
  return {
    leftContext: normalizeForMatch(flattenLinksForMatch(rawLeft)),
    rightContext: normalizeForMatch(flattenLinksForMatch(rawRight)),
  };
}

/**
 * Image / embed targets in stored text, in source order. An extract or
 * cloze whose span is only a figure has no text to match, so the painter
 * flags the rendered `<img>` instead of wrapping a `<mark>`.
 */
export function imageTargetsInText(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/!\[\[([^\]\n]+)\]\]/g)) {
    out.push((m[1] ?? "").split("|")[0]!.split("#")[0]!.trim());
  }
  for (const m of text.matchAll(/!\[[^\]\n]*\]\(([^)\n]*)\)/g)) {
    out.push((m[1] ?? "").split("#")[0]!.trim());
  }
  return out.filter((t) => t.length > 0);
}

/** Basename of an embed target or an `<img>` src, for loose matching. */
function imageBasename(target: string): string {
  let decoded = target;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    /* a stray % in the path: match on the raw form */
  }
  return (decoded.split("?")[0] ?? "").split("/").pop() ?? "";
}

export interface DomSourceMark {
  text: string;
  cls: string;
  /**
   * Occurrence of this needle to paint, from the source offsets. Without
   * it the painter falls back to counting marks in arrival order.
   */
  occurrence?: number;
  /** Optional normalized prefix/suffix around the anchored source span. */
  leftContext?: string;
  rightContext?: string;
}

/**
 * Paint extract/cloze marks into an already-rendered markdown root.
 * Used by the review pane (ItemView) where HTML-in-markdown splicing is
 * unreliable, and as the shared implementation behind the reading-view
 * MarkdownPostProcessor.
 *
 * Identical needles are marked using local surrounding context when anchored
 * (breaking ties by `occurrence`), and using normalized DOM traversal so
 * inline formatting (`<strong>`, `<a>`, `<code>`) or prior `<mark>` splits
 * never shift occurrence counts.
 */
export function paintIrSourceMarksInElement(
  root: HTMLElement,
  marks: ReadonlyArray<DomSourceMark>,
): void {
  const counts = new Map<string, number>();
  const paint = (
    needle: string,
    cls: string,
    ctx?: { leftContext?: string; rightContext?: string },
  ): boolean => {
    const n = counts.get(needle) ?? 0;
    counts.set(needle, n + 1);
    return wrapNthOccurrenceAcrossNodes(root, needle, n, cls, ctx);
  };
  const paintImages = (text: string, cls: string): void => {
    for (const target of imageTargetsInText(text)) {
      const base = imageBasename(target);
      if (!base) continue;
      const hit = Array.from(root.querySelectorAll("img")).find(
        (img) =>
          !img.classList.contains(cls) &&
          imageBasename(img.getAttribute("src") ?? "") === base,
      );
      hit?.classList.add(cls, "ir-source-image");
    }
  };
  for (const m of marks) {
    // A figure contributes no text, so it is flagged on the element itself.
    paintImages(m.text, m.cls);
    const hasAnchorHint =
      m.occurrence !== undefined ||
      m.leftContext !== undefined ||
      m.rightContext !== undefined;
    const needle = readingViewNeedle(m.text, hasAnchorHint ? 1 : MIN_NEEDLE);
    if (!needle) continue;
    if (m.occurrence !== undefined) {
      counts.set(needle, m.occurrence);
    }
    const ctx =
      m.leftContext !== undefined || m.rightContext !== undefined
        ? { leftContext: m.leftContext, rightContext: m.rightContext }
        : undefined;
    if (paint(needle, m.cls, ctx)) continue;
    // The extract covers more than one rendered block (multi-paragraph
    // selection, list, or a multi-span Ctrl-select extract whose spans are
    // stored joined by a blank line). Paint block by block, then line by line.
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

const BLOCK_TAG_NAMES = new Set([
  "P", "DIV", "LI", "UL", "OL",
  "H1", "H2", "H3", "H4", "H5", "H6",
  "BLOCKQUOTE", "PRE", "TABLE", "TR", "TD", "TH",
]);

function nearestBlockAncestor(node: Node, root: HTMLElement): Node {
  let cur: Node | null = node.parentNode;
  while (cur && cur !== root) {
    if (cur.nodeType === Node.ELEMENT_NODE && BLOCK_TAG_NAMES.has(((cur as Element).tagName ?? "").toUpperCase())) {
      return cur;
    }
    cur = cur.parentNode;
  }
  return root;
}

function pickBestOccurrenceOffset(
  haystack: string,
  needle: string,
  n: number,
  ctx?: { leftContext?: string; rightContext?: string },
): number {
  if (!needle) return -1;
  const left = ctx?.leftContext ?? "";
  const right = ctx?.rightContext ?? "";
  if (!left && !right) {
    return nthOccurrenceOffset(haystack, needle, n);
  }
  const candidates: number[] = [];
  let from = 0;
  while (from <= haystack.length) {
    const i = haystack.indexOf(needle, from);
    if (i === -1) break;
    candidates.push(i);
    from = i + 1;
  }
  if (candidates.length === 0) return -1;
  if (candidates.length === 1) return candidates[0]!;

  // Compare suffix of `left` against `haystack` immediately preceding `i`
  // (ignoring optional single space boundary) and prefix of `right` after `i + needle.length`.
  const scoreAt = (idx: number): number => {
    let score = 0;
    if (left) {
      let hi = idx - 1;
      let li = left.length - 1;
      if (hi >= 0 && haystack[hi] === " " && li >= 0 && left[li] !== " ") {
        hi -= 1;
      }
      while (hi >= 0 && li >= 0 && haystack[hi] === left[li]) {
        score += 1;
        hi -= 1;
        li -= 1;
      }
    }
    if (right) {
      let hi = idx + needle.length;
      let ri = 0;
      if (hi < haystack.length && haystack[hi] === " " && ri < right.length && right[ri] !== " ") {
        hi += 1;
      }
      while (hi < haystack.length && ri < right.length && haystack[hi] === right[ri]) {
        score += 1;
        hi += 1;
        ri += 1;
      }
    }
    return score;
  };

  let bestScore = -1;
  let bestIndices: number[] = [];
  for (let ci = 0; ci < candidates.length; ci += 1) {
    const s = scoreAt(candidates[ci]!);
    if (s > bestScore) {
      bestScore = s;
      bestIndices = [ci];
    } else if (s === bestScore) {
      bestIndices.push(ci);
    }
  }
  if (bestIndices.length === 1 && bestScore > 0) {
    return candidates[bestIndices[0]!]!;
  }
  if (bestScore > 0) {
    // Multiple candidates tied on local context: pick the one closest to `n`.
    const chosenCi = bestIndices.reduce((prev, curr) =>
      Math.abs(curr - n) < Math.abs(prev - n) ? curr : prev,
    );
    return candidates[chosenCi]!;
  }
  return nthOccurrenceOffset(haystack, needle, n);
}

/**
 * Formatting-tolerant variant: normalizes the concatenated text of every
 * text node under `root` (same rules as the needle), finds the matching
 * occurrence (by local context when anchored, breaking ties on `n`), and
 * wraps each touched text node's slice in its own `<mark>`.
 */
export function wrapNthOccurrenceAcrossNodes(
  root: HTMLElement,
  needle: string,
  n: number,
  cls: string,
  ctx?: { leftContext?: string; rightContext?: string },
): boolean {
  const norm = new Normalizer<{ node: Text; offset: number }>();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null = walker.nextNode();
  let prevBlock: Node | null = null;
  while (node) {
    const t = node as Text;
    const block = nearestBlockAncestor(t, root);
    if (prevBlock !== null && block !== prevBlock) {
      norm.separateBlock();
    }
    prevBlock = block;
    const text = t.nodeValue ?? "";
    for (let i = 0; i < text.length; i++) {
      norm.push(text[i]!, { node: t, offset: i });
    }
    node = walker.nextNode();
  }
  const idx = pickBestOccurrenceOffset(norm.text, needle, n, ctx);
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
