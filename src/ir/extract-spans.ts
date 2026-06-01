/**
 * Pure span-finders for the bulk-extract commands.
 *
 * Each helper takes a body string (no frontmatter; the caller is responsible
 * for stripping it) and returns body-relative `{ start, end }` ranges. The
 * caller passes those into the bulk-extract engine, which records anchored
 * extracts against the unchanged source body (DESIGN §Q3); idempotency is
 * enforced by the caller checking the store's existing extract ranges, not
 * by inspecting the body for marks.
 *
 * No Obsidian imports — keeps the segmentation logic unit-testable and
 * lets us iterate on edge cases (blank lines around fences, indented list
 * continuations, etc.) without spinning up a vault.
 */

export interface Span {
  start: number;
  end: number;
}

/* ------------------------------------------------------------------ */
/* Internal helpers                                                    */
/* ------------------------------------------------------------------ */

interface Line {
  start: number;
  end: number;
  text: string;
}

function splitLines(body: string): Line[] {
  const out: Line[] = [];
  let lineStart = 0;
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] === "\n") {
      out.push({ start: lineStart, end: i, text: body.slice(lineStart, i) });
      lineStart = i + 1;
    }
  }
  if (lineStart <= body.length) {
    out.push({
      start: lineStart,
      end: body.length,
      text: body.slice(lineStart, body.length),
    });
  }
  return out;
}

function lineIndexForOffset(lines: Line[], cursor: number): number {
  for (let i = 0; i < lines.length; i += 1) {
    if (cursor <= lines[i]!.end) return i;
  }
  return lines.length - 1;
}

function isBlank(line: Line): boolean {
  return line.text.trim().length === 0;
}

function isHeading(line: Line): { level: number } | null {
  const m = /^(#{1,6})\s+\S/.exec(line.text);
  return m ? { level: m[1]!.length } : null;
}

function isBlockquote(line: Line): boolean {
  return /^>\s?/.test(line.text);
}

const LIST_ITEM_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+\S/;
const LIST_INDENT_RE = /^(\s+)\S/;

function listItemIndent(line: Line): number | null {
  const m = LIST_ITEM_RE.exec(line.text);
  return m ? m[1]!.length : null;
}

function leadingIndent(line: Line): number {
  const m = LIST_INDENT_RE.exec(line.text);
  return m ? m[1]!.length : 0;
}

function clampSpanToRange(span: Span, range: Span | undefined): Span | null {
  if (!range) return span;
  const start = Math.max(span.start, range.start);
  const end = Math.min(span.end, range.end);
  if (end <= start) return null;
  return { start, end };
}

function trimSpan(body: string, span: Span): Span | null {
  let start = span.start;
  let end = span.end;
  // Leading whitespace can be meaningful (list-item indent, fenced code
  // alignment); trailing whitespace never is. Only strip the trailing
  // side so a "  - child" stays "  - child" instead of "- child".
  while (end > start && /\s/.test(body[end - 1]!)) end -= 1;
  if (end <= start) return null;
  return { start, end };
}

/* ------------------------------------------------------------------ */
/* findParagraphAtOffset                                               */
/* ------------------------------------------------------------------ */

/**
 * Body-offset span of the paragraph the cursor sits in. A paragraph is a
 * run of non-blank lines bounded by blank lines (or file edges). Returns
 * null when the cursor is on a blank line — nothing meaningful to extract,
 * and the caller should surface that to the user instead of silently
 * grabbing the next paragraph.
 */
export function findParagraphAtOffset(
  body: string,
  cursor: number,
): Span | null {
  if (body.length === 0) return null;
  const lines = splitLines(body);
  const idx = lineIndexForOffset(lines, Math.max(0, Math.min(cursor, body.length)));
  if (isBlank(lines[idx]!)) return null;

  let startLine = idx;
  while (startLine > 0 && !isBlank(lines[startLine - 1]!)) startLine -= 1;
  let endLine = idx;
  while (endLine < lines.length - 1 && !isBlank(lines[endLine + 1]!)) {
    endLine += 1;
  }
  const span: Span = {
    start: lines[startLine]!.start,
    end: lines[endLine]!.end,
  };
  return trimSpan(body, span);
}

/* ------------------------------------------------------------------ */
/* findHeadingSectionAtOffset                                          */
/* ------------------------------------------------------------------ */

/**
 * Body-offset span of the heading section the cursor sits in: from the
 * nearest preceding heading line down to (but not including) the next
 * same-or-higher-level heading. Returns null when no heading precedes
 * the cursor — there's no "section" above the first heading to extract.
 *
 * The heading line itself is included so the extracted card carries its
 * own title in the review pane.
 */
export function findHeadingSectionAtOffset(
  body: string,
  cursor: number,
): Span | null {
  if (body.length === 0) return null;
  const lines = splitLines(body);
  const idx = lineIndexForOffset(lines, Math.max(0, Math.min(cursor, body.length)));
  let headingLine = -1;
  let level = 0;
  for (let i = idx; i >= 0; i -= 1) {
    const h = isHeading(lines[i]!);
    if (h) {
      headingLine = i;
      level = h.level;
      break;
    }
  }
  if (headingLine === -1) return null;
  let endLine = lines.length - 1;
  for (let i = headingLine + 1; i < lines.length; i += 1) {
    const h = isHeading(lines[i]!);
    if (h && h.level <= level) {
      endLine = i - 1;
      break;
    }
  }
  while (endLine > headingLine && isBlank(lines[endLine]!)) endLine -= 1;
  const span: Span = {
    start: lines[headingLine]!.start,
    end: lines[endLine]!.end,
  };
  return trimSpan(body, span);
}

/* ------------------------------------------------------------------ */
/* findAllBlockquotes                                                  */
/* ------------------------------------------------------------------ */

/**
 * Every contiguous blockquote in `body` (lines starting with `>`),
 * optionally clipped to `range`. Adjacent `>` lines collapse into one
 * span so a multi-line quote becomes a single extract. Blank lines split
 * the run, matching CommonMark's blockquote semantics.
 */
export function findAllBlockquotes(body: string, range?: Span): Span[] {
  const lines = splitLines(body);
  const out: Span[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!isBlockquote(lines[i]!)) {
      i += 1;
      continue;
    }
    const startLine = i;
    while (i < lines.length && isBlockquote(lines[i]!)) i += 1;
    const endLine = i - 1;
    const span = trimSpan(body, {
      start: lines[startLine]!.start,
      end: lines[endLine]!.end,
    });
    if (!span) continue;
    const clipped = clampSpanToRange(span, range);
    if (clipped) out.push(clipped);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* findAllListItems                                                    */
/* ------------------------------------------------------------------ */

/**
 * Every list item (bullet or ordered) whose marker line falls inside
 * `range`. Continuation lines (indented under the marker) are included
 * in the item's span so wrapped prose under a bullet still extracts as
 * one card. A nested list item starts a new span.
 */
export function findAllListItems(body: string, range: Span): Span[] {
  const lines = splitLines(body);
  const out: Span[] = [];
  let i = 0;
  while (i < lines.length) {
    const markerIndent = listItemIndent(lines[i]!);
    if (markerIndent === null) {
      i += 1;
      continue;
    }
    const startLine = i;
    let endLine = i;
    i += 1;
    while (i < lines.length) {
      const cur = lines[i]!;
      if (isBlank(cur)) break;
      const childItem = listItemIndent(cur);
      if (childItem !== null) break;
      const indent = leadingIndent(cur);
      if (indent <= markerIndent) break;
      endLine = i;
      i += 1;
    }
    const span = trimSpan(body, {
      start: lines[startLine]!.start,
      end: lines[endLine]!.end,
    });
    if (!span) continue;
    if (span.end <= range.start || span.start >= range.end) continue;
    const clipped = clampSpanToRange(span, range);
    if (clipped) out.push(clipped);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* findAllParagraphs                                                   */
/* ------------------------------------------------------------------ */

/**
 * Every paragraph (run of non-blank lines) intersecting `range`. Used by
 * the "extract every paragraph in selection" bulk command — the user
 * highlights a region, and each blank-line-separated block within it
 * becomes its own anchored extract.
 *
 * A paragraph that straddles the selection edge is still included as a
 * single full-paragraph span: we don't slice paragraphs mid-sentence
 * because that produces awkward review cards.
 */
export function findAllParagraphs(body: string, range: Span): Span[] {
  const lines = splitLines(body);
  const out: Span[] = [];
  let i = 0;
  while (i < lines.length) {
    if (isBlank(lines[i]!)) {
      i += 1;
      continue;
    }
    const startLine = i;
    while (i < lines.length && !isBlank(lines[i]!)) i += 1;
    const endLine = i - 1;
    const span = trimSpan(body, {
      start: lines[startLine]!.start,
      end: lines[endLine]!.end,
    });
    if (!span) continue;
    if (span.end <= range.start || span.start >= range.end) continue;
    out.push(span);
  }
  return out;
}
