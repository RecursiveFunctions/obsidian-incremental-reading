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

  const exact = raw.indexOf(slice);
  if (exact !== -1 && raw.indexOf(slice, exact + 1) === -1) {
    return { start: exact, end: exact + slice.length, text: slice };
  }

  return locateTextInBody(raw, slice);
}
