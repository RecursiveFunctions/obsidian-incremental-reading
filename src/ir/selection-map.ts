/**
 * Map DOM / editor selections to offsets in a markdown note body (no YAML).
 */

/** Shown when a preview selection cannot be mapped onto source markdown. */
export const SWITCH_TO_EDIT_COPY =
  "Switch to Edit to extract the exact markdown.";

const BLOCK_TAGS = new Set([
  "P",
  "DIV",
  "LI",
  "UL",
  "OL",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "BLOCKQUOTE",
  "PRE",
  "TABLE",
  "TR",
  "TD",
  "TH",
  "HR",
]);

/** Walk rendered HTML into a plain string with `\n` between block elements. */
export function renderedPlainText(root: HTMLElement): string {
  const parts: string[] = [];

  const pushNewline = () => {
    const last = parts[parts.length - 1];
    if (last !== undefined && !last.endsWith("\n")) parts.push("\n");
  };

  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.textContent ?? "");
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    if (el.tagName === "BR") {
      pushNewline();
      return;
    }
    const isBlock = BLOCK_TAGS.has(el.tagName);
    if (isBlock) pushNewline();
    for (const child of Array.from(el.childNodes)) walk(child);
    if (isBlock) pushNewline();
  };

  walk(root);
  return parts.join("").replace(/\n{3,}/g, "\n\n");
}

function offsetAtBoundary(
  root: HTMLElement,
  container: Node,
  offset: number,
  plain: string,
): number | null {
  if (container.nodeType === Node.TEXT_NODE) {
    let pos = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const t = walker.currentNode as Text;
      if (t === container) return pos + offset;
      pos += t.length;
    }
    return null;
  }
  if (container.nodeType === Node.ELEMENT_NODE) {
    const el = container as Element;
    const child = el.childNodes[offset] ?? el.childNodes[offset - 1];
    if (!child) {
      if (offset === 0) return 0;
      const last = el.childNodes[el.childNodes.length - 1];
      if (!last) return null;
      return offsetAtBoundary(root, last, last.textContent?.length ?? 0, plain);
    }
    return offsetAtBoundary(root, child, 0, plain);
  }
  return null;
}

/** Character offsets of a DOM Range inside `renderedPlainText(root)`. */
export function rangeOffsetsInRendered(
  root: HTMLElement,
  range: Range,
): { start: number; end: number } | null {
  const plain = renderedPlainText(root);
  const start = offsetAtBoundary(root, range.startContainer, range.startOffset, plain);
  const end = offsetAtBoundary(root, range.endContainer, range.endOffset, plain);
  if (start === null || end === null || end <= start) return null;
  return { start, end: Math.min(end, plain.length) };
}

/** Collapsed caret offset in `renderedPlainText(root)`. */
export function caretOffsetInRendered(
  root: HTMLElement,
  container: Node,
  offset: number,
): number | null {
  const plain = renderedPlainText(root);
  const pos = offsetAtBoundary(root, container, offset, plain);
  if (pos === null) return null;
  return Math.max(0, Math.min(pos, plain.length));
}

const RAW_MARKUP = /[#*_`~[\]()!>+-]/;

/**
 * Walk `rendered` and `raw` together, skipping markdown punctuation that
 * preview does not show, so a caret in rendered text lands in the source.
 */
export function alignRenderedOffsetToRaw(
  rendered: string,
  raw: string,
  rel: number,
): number {
  const target = Math.max(0, Math.min(rel, rendered.length));
  let r = 0;
  let w = 0;
  while (r < target && w < raw.length) {
    const rc = rendered[r]!;
    const wc = raw[w]!;
    if (/\s/.test(rc) && /\s/.test(wc)) {
      while (r < rendered.length && /\s/.test(rendered[r]!)) r += 1;
      while (w < raw.length && /\s/.test(raw[w]!)) w += 1;
      continue;
    }
    if (rc === wc) {
      r += 1;
      w += 1;
      continue;
    }
    if (RAW_MARKUP.test(wc) && rc !== wc) {
      w += 1;
      continue;
    }
    r += 1;
  }
  return w;
}

/**
 * Inverse of {@link alignRenderedOffsetToRaw}: a body offset in markdown
 * `raw` mapped onto `rendered` (preview text without punctuation).
 */
export function alignRawOffsetToRendered(
  rendered: string,
  raw: string,
  rawOff: number,
): number {
  const target = Math.max(0, Math.min(rawOff, raw.length));
  let r = 0;
  let w = 0;
  while (w < target && w < raw.length) {
    if (r >= rendered.length) return rendered.length;
    const rc = rendered[r]!;
    const wc = raw[w]!;
    if (/\s/.test(rc) && /\s/.test(wc)) {
      while (r < rendered.length && /\s/.test(rendered[r]!)) r += 1;
      while (w < raw.length && /\s/.test(raw[w]!)) w += 1;
      continue;
    }
    if (rc === wc) {
      r += 1;
      w += 1;
      continue;
    }
    if (RAW_MARKUP.test(wc) && rc !== wc) {
      w += 1;
      continue;
    }
    r += 1;
  }
  return r;
}

/**
 * Visible phrase around a raw caret, for finding that spot in preview
 * `textContent` after leaving the editor.
 */
export function previewScrollNeedle(
  raw: string,
  offset: number,
): string | null {
  const pos = Math.max(0, Math.min(offset, raw.length));
  const strip = (s: string) =>
    s.replace(/[#*_`~[\]()!>+-]/g, "").replace(/\s+/g, " ").trim();
  for (const width of [24, 40, 64]) {
    const needle = strip(raw.slice(pos, Math.min(raw.length, pos + width)));
    if (needle.length >= 12) return needle.slice(0, 48);
  }
  for (const width of [24, 40, 64]) {
    const needle = strip(raw.slice(Math.max(0, pos - width), pos));
    if (needle.length >= 12) return needle.slice(-48);
  }
  return null;
}

export function uniqueIndex(hay: string, needle: string): number | null {
  if (!needle) return null;
  const i = hay.indexOf(needle);
  if (i === -1) return null;
  if (hay.indexOf(needle, i + 1) !== -1) return null;
  return i;
}

/** Text-node point at a `textContent` offset inside `root`. */
export function textPointAtTextOffset(
  root: HTMLElement,
  offset: number,
): { node: Text; offset: number } | null {
  const target = Math.max(0, offset);
  let pos = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const t = walker.currentNode as Text;
    const len = t.length;
    if (pos + len >= target) {
      return { node: t, offset: Math.max(0, Math.min(target - pos, len)) };
    }
    pos += len;
  }
  return null;
}

/**
 * Map a caret in rendered preview text onto a body offset in markdown `raw`.
 */
export function mapRenderedCaretToRaw(
  raw: string,
  rendered: string,
  caret: number,
): number | null {
  if (!raw) return 0;
  if (!rendered) return 0;
  const pos = Math.max(0, Math.min(caret, rendered.length));

  for (const width of [16, 32, 48, 80]) {
    const from = Math.max(0, pos - width);
    const to = Math.min(rendered.length, pos + width);
    const slice = rendered.slice(from, to);
    if (!slice.trim()) continue;
    const loc = locateTextInBody(raw, slice);
    if (!loc) continue;
    const rel = pos - from;
    const inner = alignRenderedOffsetToRaw(slice, loc.text, rel);
    return Math.max(loc.start, Math.min(loc.start + inner, loc.end));
  }

  const loc = locateTextInBody(raw, rendered);
  if (!loc) return null;
  const inner = alignRenderedOffsetToRaw(rendered, loc.text, pos);
  return Math.max(loc.start, Math.min(loc.start + inner, loc.end));
}

/**
 * Locate `needle` in `raw` for highlighting / selection recovery.
 * Tries exact match first, then line-bridged match when the DOM collapsed
 * newlines to spaces.
 */
export function locateTextInBody(
  raw: string,
  needle: string,
): { start: number; end: number; text: string } | null {
  const trimmed = needle.trim();
  if (!trimmed) return null;

  const exact = raw.indexOf(needle);
  if (exact !== -1 && raw.indexOf(needle, exact + 1) === -1) {
    return { start: exact, end: exact + needle.length, text: needle };
  }

  const exactTrim = raw.indexOf(trimmed);
  if (exactTrim !== -1 && raw.indexOf(trimmed, exactTrim + 1) === -1) {
    return { start: exactTrim, end: exactTrim + trimmed.length, text: trimmed };
  }

  const lineParts = trimmed.split(/\n/).map((l) => l.trim()).filter(Boolean);
  if (lineParts.length < 2) {
    const collapsed = trimmed.replace(/\s+/g, " ");
    const re = new RegExp(
      collapsed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "[\\s\\n]+"),
    );
    const m = re.exec(raw);
    if (!m) return null;
    re.lastIndex = 0;
    if (re.test(raw.slice(m.index + 1))) return null;
    return {
      start: m.index,
      end: m.index + m[0].length,
      text: raw.slice(m.index, m.index + m[0].length),
    };
  }

  const first = lineParts[0]!;
  const last = lineParts[lineParts.length - 1]!;
  const start = raw.indexOf(first);
  if (start === -1) return null;
  const lastIdx = raw.indexOf(last, start);
  if (lastIdx === -1) return null;
  const end = lastIdx + last.length;
  const text = raw.slice(start, end);
  if (raw.indexOf(text, start + 1) !== -1) return null;
  return { start, end, text };
}

/**
 * Map a rendered preview selection to offsets in the markdown body string.
 */
export function mapRenderedSelectionToRaw(
  raw: string,
  root: HTMLElement,
  range: Range,
): { start: number; end: number; text: string } | null {
  const rendered = renderedPlainText(root);
  const rOff = rangeOffsetsInRendered(root, range);
  if (!rOff) return null;
  const slice = rendered.slice(rOff.start, rOff.end);
  if (!slice.trim()) return null;

  const hit = (() => {
    const exact = raw.indexOf(slice);
    if (exact !== -1 && raw.indexOf(slice, exact + 1) === -1) {
      return { start: exact, end: exact + slice.length, text: slice };
    }
    return locateTextInBody(raw, slice);
  })();
  if (!hit) return null;

  // The rendered plain text of `[data.tf](#datatf)` is just `data.tf`, so a
  // preview selection of the visible label lands *inside* the `[...]` in raw
  // and would splice link syntax across the extract/cloze boundary. Snap out
  // to whole-link so callers get a clean token.
  const snapped = expandSelectionAroundLinks(raw, hit.start, hit.end);
  if (snapped.start === hit.start && snapped.end === hit.end) return hit;
  return {
    start: snapped.start,
    end: snapped.end,
    text: raw.slice(snapped.start, snapped.end),
  };
}

// Markdown/wiki link tokens we refuse to split across an extract or cloze
// boundary. `!?\[...\]\(...\)` covers `[label](url)` and `![alt](url)`;
// `\[\[...\]\]` covers `[[wikilink]]` and `[[wikilink|alias]]`. Both patterns
// forbid newlines and un-escaped closing brackets so a runaway match can't
// swallow the rest of the note when the source has stray `[` characters.
const LINK_PATTERNS: readonly RegExp[] = [
  /!?\[[^\]\n]*\]\([^)\n]*\)/g,
  /\[\[[^\]\n]+?\]\]/g,
];

/**
 * If `[start, end]` straddles a markdown link, wikilink, or image token,
 * expand outward so the whole token is inside the selection. A selection
 * that already sits fully outside every link, or fully contains one, is
 * returned unchanged. Splitting a link produces cloze/extract text like
 * `[{{c1::data.tf}}](#datatf)` — valid markdown but the anchored extract
 * quote becomes `data.tf](#dat`, which never round-trips. This is the guard.
 */
export function expandSelectionAroundLinks(
  raw: string,
  start: number,
  end: number,
): { start: number; end: number } {
  if (end <= start) return { start, end };
  let s = start;
  let e = end;
  // Fixed-point: expanding to swallow one link can pull the selection into
  // an adjacent one (rare, but possible with back-to-back links). Loop
  // until no pattern moves the bounds; capped so a pathological regex can't
  // spin forever.
  for (let guard = 0; guard < 8; guard += 1) {
    let moved = false;
    for (const re of LINK_PATTERNS) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(raw)) !== null) {
        const L = m.index;
        const R = L + m[0].length;
        if (L >= e) break;
        if (R <= s) continue;
        if (s > L && s < R) {
          s = L;
          moved = true;
        }
        if (e > L && e < R) {
          e = R;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
  return { start: s, end: e };
}
