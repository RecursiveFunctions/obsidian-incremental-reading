/**
 * Tests for pure helpers extracted from view modules:
 *   - findExtractRange    (src/ir/extract-range.ts)
 *   - formatDueLabel      (src/ir/due-label.ts)
 *   - stripFrontmatter    (src/ir/frontmatter-body.ts)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { findExtractRange } from "../src/ir/extract-range";
import { formatDueLabel } from "../src/ir/due-label";
import {
  sanitizeExtractSelection,
  stripFrontmatter,
  wrapExtractHighlight,
} from "../src/ir/frontmatter-body";
import type { IrElement } from "../src/ir/model";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function makeElement(overrides: Partial<IrElement> = {}): IrElement {
  return {
    id: "el-1" as IrElement["id"],
    type: "extract",
    priority: 50,
    parentId: "parent-1" as IrElement["parentId"],
    dismissed: false,
    created: 0,
    text: "",
    anchorState: "ok",
    ...overrides,
  } as IrElement;
}

const SOURCE = "The quick brown fox jumps over the lazy dog.";
const MS_PER_DAY = 86_400_000;

/* ------------------------------------------------------------------ */
/* findExtractRange                                                    */
/* ------------------------------------------------------------------ */

test("findExtractRange: plain text match (no anchor)", () => {
  const el = makeElement({ text: "brown fox" });
  const r = findExtractRange(el, SOURCE);
  assert.ok(r);
  assert.equal(SOURCE.slice(r.start, r.end), "brown fox");
});

test("findExtractRange: returns undefined when text not found", () => {
  const el = makeElement({ text: "purple elephant" });
  assert.equal(findExtractRange(el, SOURCE), undefined);
});

test("findExtractRange: returns undefined when text is ambiguous (multiple matches)", () => {
  const repeated = "abc abc abc";
  const el = makeElement({ text: "abc" });
  assert.equal(findExtractRange(el, repeated), undefined);
});

test("findExtractRange: trims whitespace before matching", () => {
  const el = makeElement({ text: "  brown fox  " });
  const r = findExtractRange(el, SOURCE);
  assert.ok(r);
  assert.equal(SOURCE.slice(r.start, r.end), "brown fox");
});

test("findExtractRange: returns undefined for empty text", () => {
  const el = makeElement({ text: "" });
  assert.equal(findExtractRange(el, SOURCE), undefined);
});

test("findExtractRange: anchor position fast path", () => {
  const el = makeElement({
    text: "brown fox",
    anchor: {
      sourcePath: "Note.md",
      quote: { exact: "brown fox", prefix: "quick ", suffix: " jumps" },
      position: { start: 10, end: 19 },
    },
  });
  const r = findExtractRange(el, SOURCE);
  assert.ok(r);
  assert.equal(SOURCE.slice(r.start, r.end), "brown fox");
});

test("findExtractRange: anchor text-quote fallback when position drifted", () => {
  const drifted = "INSERTED " + SOURCE;
  const el = makeElement({
    text: "brown fox",
    anchor: {
      sourcePath: "Note.md",
      quote: { exact: "brown fox", prefix: "quick ", suffix: " jumps" },
      position: { start: 10, end: 19 },
    },
  });
  const r = findExtractRange(el, drifted);
  assert.ok(r);
  assert.equal(drifted.slice(r.start, r.end), "brown fox");
});

test("findExtractRange: falls back to indexOf when anchor fails entirely", () => {
  const el = makeElement({
    text: "brown fox",
    anchor: {
      sourcePath: "Note.md",
      quote: { exact: "DELETED TEXT", prefix: "xxx", suffix: "yyy" },
      position: { start: 999, end: 1010 },
    },
  });
  const r = findExtractRange(el, SOURCE);
  assert.ok(r);
  assert.equal(SOURCE.slice(r.start, r.end), "brown fox");
});

/* ------------------------------------------------------------------ */
/* formatDueLabel                                                      */
/* ------------------------------------------------------------------ */

const NOW = 1_700_000_000_000;

test("formatDueLabel: overdue returns 'due'", () => {
  assert.equal(formatDueLabel(NOW - 1000, NOW), "due");
});

test("formatDueLabel: exactly now returns 'due'", () => {
  assert.equal(formatDueLabel(NOW, NOW), "due");
});

test("formatDueLabel: due in < 1 day still shows 1d", () => {
  assert.equal(formatDueLabel(NOW + MS_PER_DAY * 0.5, NOW), "1d");
});

test("formatDueLabel: due in exactly 1 day", () => {
  assert.equal(formatDueLabel(NOW + MS_PER_DAY, NOW), "1d");
});

test("formatDueLabel: due in 29 days", () => {
  assert.equal(formatDueLabel(NOW + MS_PER_DAY * 29, NOW), "29d");
});

test("formatDueLabel: due in 30 days shows 1mo", () => {
  assert.equal(formatDueLabel(NOW + MS_PER_DAY * 30, NOW), "1mo");
});

test("formatDueLabel: due in 364 days", () => {
  const label = formatDueLabel(NOW + MS_PER_DAY * 364, NOW);
  assert.match(label, /mo$/);
});

test("formatDueLabel: due in 365 days shows 1y", () => {
  assert.equal(formatDueLabel(NOW + MS_PER_DAY * 365, NOW), "1y");
});

test("formatDueLabel: due in 730 days shows 2y", () => {
  assert.equal(formatDueLabel(NOW + MS_PER_DAY * 730, NOW), "2y");
});

/* ------------------------------------------------------------------ */
/* stripFrontmatter                                                    */
/* ------------------------------------------------------------------ */

test("stripFrontmatter: removes YAML front matter", () => {
  const input = "---\ntitle: Hello\n---\nBody text here.";
  assert.equal(stripFrontmatter(input), "Body text here.");
});

test("stripFrontmatter: preserves body when no front matter", () => {
  assert.equal(stripFrontmatter("Just a body."), "Just a body.");
});

test("stripFrontmatter: empty string returns empty", () => {
  assert.equal(stripFrontmatter(""), "");
});

test("stripFrontmatter: front matter only returns empty", () => {
  assert.equal(stripFrontmatter("---\nkey: val\n---\n"), "");
});

test("stripFrontmatter: trims whitespace around body", () => {
  const input = "---\nk: v\n---\n\n  Body  \n\n";
  assert.equal(stripFrontmatter(input), "Body");
});

test("stripFrontmatter: handles multi-line front matter", () => {
  const input = "---\na: 1\nb: 2\nc: 3\n---\nContent after.";
  assert.equal(stripFrontmatter(input), "Content after.");
});

test("sanitizeExtractSelection: strips accidental YAML from a selection", () => {
  const sel = "---\nir-type: topic\n---\nActual quote";
  assert.equal(sanitizeExtractSelection(sel), "Actual quote");
});

test("wrapExtractHighlight: wraps a body span with ir-extract-source mark", () => {
  const body = "The quick brown fox";
  assert.equal(
    wrapExtractHighlight(body, 4, 9),
    'The <mark class="ir-extract-source">quick</mark> brown fox',
  );
});

test("wrapExtractHighlight: does not double-wrap mark or legacy ==", () => {
  const marked =
    'The <mark class="ir-extract-source">quick</mark> brown fox';
  const q = marked.indexOf("quick");
  assert.equal(wrapExtractHighlight(marked, q, q + 5), marked);
  const legacy = "The ==quick== brown fox";
  assert.equal(wrapExtractHighlight(legacy, 6, 11), legacy);
});
