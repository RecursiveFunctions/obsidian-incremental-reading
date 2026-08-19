/**
 * Locate already-clozed spans in a source body so the editor / review
 * decorations can paint them (SuperMemo: you see what you have already
 * turned into items). Pure: no Obsidian, no I/O.
 *
 * Prefers a stored item `anchor` when it points at this source. Falls back
 * to a unique substring match of each `{{cN::answer}}` in the item body
 * (covers items created before anchors were recorded).
 */

import type { Anchor, IrElement } from "./model";
import { resolveAnchor } from "./anchor";
import { listClozeGroups } from "../cloze";
import { isPdfPath } from "./pdf-fragment";
import type { ElementId } from "./ids";

export type SourceMarkKind = "extract" | "cloze";

export interface SourceMarkRange {
  start: number;
  end: number;
  text: string;
  kind: SourceMarkKind;
}

export function itemSourcePath(
  el: IrElement,
  byId: ReadonlyMap<string, IrElement>,
): string | null {
  if (el.anchor?.sourcePath && !isPdfPath(el.anchor.sourcePath)) {
    return el.anchor.sourcePath;
  }
  const seen = new Set<ElementId>([el.id]);
  let cur: IrElement | undefined = el;
  while (cur?.parentId) {
    if (seen.has(cur.parentId)) break;
    seen.add(cur.parentId);
    const parent = byId.get(cur.parentId);
    if (!parent) break;
    if (parent.notePath && !isPdfPath(parent.notePath)) return parent.notePath;
    if (parent.anchor?.sourcePath && !isPdfPath(parent.anchor.sourcePath)) {
      return parent.anchor.sourcePath;
    }
    cur = parent;
  }
  return null;
}

function uniqueIndexOf(haystack: string, needle: string): number {
  if (!needle) return -1;
  const idx = haystack.indexOf(needle);
  if (idx === -1) return -1;
  if (haystack.indexOf(needle, idx + 1) !== -1) return -1;
  return idx;
}

function overlaps(
  a: { start: number; end: number },
  b: { start: number; end: number },
): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Cloze ranges in `body` for items whose source is `sourcePath`.
 * Skips ambiguous / empty answers so we never paint the wrong span.
 */
export function clozeRangesInBody(
  items: readonly IrElement[],
  body: string,
  sourcePath: string,
  byId: ReadonlyMap<string, IrElement>,
): SourceMarkRange[] {
  const out: SourceMarkRange[] = [];
  for (const el of items) {
    if (el.type !== "item") continue;
    if (itemSourcePath(el, byId) !== sourcePath) continue;
    if (el.anchor && el.anchor.sourcePath === sourcePath && !el.anchor.pdf) {
      const r = resolveAnchor(el.anchor, body);
      if (r.status === "ok") {
        out.push({
          start: r.start,
          end: r.end,
          text: el.anchor.quote.exact || body.slice(r.start, r.end),
          kind: "cloze",
        });
        continue;
      }
    }
    for (const g of listClozeGroups(el.text)) {
      const needle = g.answer.trim();
      if (needle.length < 2) continue;
      const idx = uniqueIndexOf(body, needle);
      if (idx === -1) continue;
      const range = {
        start: idx,
        end: idx + needle.length,
        text: needle,
        kind: "cloze" as const,
      };
      if (out.some((e) => overlaps(e, range))) continue;
      out.push(range);
    }
  }
  return out;
}

/**
 * Review HTML splice cannot nest overlapping marks. Clozes win the
 * overlapping bytes; extracts keep the remainder.
 */
export function packSourceMarksPreferringCloze(
  ranges: readonly SourceMarkRange[],
): SourceMarkRange[] {
  const clozes: SourceMarkRange[] = [];
  const clozeSorted = [...ranges.filter((r) => r.kind === "cloze")].sort(
    (a, b) => a.start - b.start,
  );
  let lastEnd = -1;
  for (const c of clozeSorted) {
    if (c.start < lastEnd) continue;
    clozes.push(c);
    lastEnd = c.end;
  }
  const extracts: SourceMarkRange[] = [];
  for (const e of ranges.filter((r) => r.kind === "extract")) {
    let cursor = e.start;
    const hits = clozes
      .filter((c) => c.start < e.end && e.start < c.end)
      .sort((a, b) => a.start - b.start);
    for (const c of hits) {
      if (cursor < c.start) {
        extracts.push({
          start: cursor,
          end: c.start,
          text: e.text,
          kind: "extract",
        });
      }
      cursor = Math.max(cursor, c.end);
    }
    if (cursor < e.end) {
      extracts.push({
        start: cursor,
        end: e.end,
        text: e.text,
        kind: "extract",
      });
    }
  }
  return [...clozes, ...extracts];
}

/** Text-quote + position anchor for a cloze span in a markdown source body. */
export function buildTextQuoteAnchor(
  sourcePath: string,
  sourceText: string,
  selStart: number,
  selEnd: number,
  contextLen = 64,
): Anchor {
  return {
    sourcePath,
    quote: {
      exact: sourceText.slice(selStart, selEnd),
      prefix: sourceText.slice(Math.max(0, selStart - contextLen), selStart),
      suffix: sourceText.slice(selEnd, selEnd + contextLen),
    },
    position: { start: selStart, end: selEnd },
  };
}

export interface ReviewSourceSplice {
  start: number;
  end: number;
  cls: string;
}

/**
 * Review HTML cannot nest overlapping `<mark>`s. Pack first, then pick CSS:
 * clozes are `ir-cloze-source`; extract remainder inside the focused card
 * is `ir-extract-highlight` (scroll-into-view); other extracts stay
 * `ir-extract-source`. If a cloze ate the whole focused span, the cloze
 * also gets `ir-extract-highlight` so scroll still finds a mark.
 */
export function reviewSourceSplices(
  ranges: readonly SourceMarkRange[],
  focused?: { start: number; end: number },
): ReviewSourceSplice[] {
  const packed = packSourceMarksPreferringCloze(ranges);
  const out: ReviewSourceSplice[] = packed.map((r) => {
    const insideFocus =
      !!focused && r.start >= focused.start && r.end <= focused.end;
    if (r.kind === "cloze") {
      return { start: r.start, end: r.end, cls: "ir-cloze-source" };
    }
    return {
      start: r.start,
      end: r.end,
      cls: insideFocus ? "ir-extract-highlight" : "ir-extract-source",
    };
  });
  if (focused && !out.some((m) => m.cls.includes("ir-extract-highlight"))) {
    const i = packed.findIndex(
      (r) => r.start < focused.end && focused.start < r.end,
    );
    if (i >= 0) {
      out[i] = { ...out[i], cls: `${out[i].cls} ir-extract-highlight` };
    }
  }
  return out;
}
