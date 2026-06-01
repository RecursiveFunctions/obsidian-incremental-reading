/**
 * Tests for the pure span-finder helpers used by the bulk-extract commands.
 * Each test fixes a small body string and asserts the resulting spans
 * slice back to the expected substring, so it's obvious what the helper
 * is supposed to grab when a regression sneaks in.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findAllBlockquotes,
  findAllListItems,
  findAllParagraphs,
  findHeadingSectionAtOffset,
  findParagraphAtOffset,
  type Span,
} from "../src/ir/extract-spans";

function slice(body: string, span: Span): string {
  return body.slice(span.start, span.end);
}

/* ------------------------------------------------------------------ */
/* findParagraphAtOffset                                               */
/* ------------------------------------------------------------------ */

test("findParagraphAtOffset: grabs the block under the cursor", () => {
  const body = "first para line one\nfirst para line two\n\nsecond para\n";
  const cursor = body.indexOf("line two");
  const span = findParagraphAtOffset(body, cursor)!;
  assert.equal(slice(body, span), "first para line one\nfirst para line two");
});

test("findParagraphAtOffset: returns null on a blank line", () => {
  const body = "alpha\n\nbeta\n";
  const cursor = body.indexOf("\n\n") + 1;
  assert.equal(findParagraphAtOffset(body, cursor), null);
});

test("findParagraphAtOffset: handles cursor at start of file", () => {
  const body = "first\nsecond\n\nthird\n";
  const span = findParagraphAtOffset(body, 0)!;
  assert.equal(slice(body, span), "first\nsecond");
});

test("findParagraphAtOffset: handles single-line body", () => {
  const body = "lonely line";
  const span = findParagraphAtOffset(body, 3)!;
  assert.equal(slice(body, span), "lonely line");
});

test("findParagraphAtOffset: returns null on empty body", () => {
  assert.equal(findParagraphAtOffset("", 0), null);
});

/* ------------------------------------------------------------------ */
/* findHeadingSectionAtOffset                                          */
/* ------------------------------------------------------------------ */

test("findHeadingSectionAtOffset: takes from heading to next same-level heading", () => {
  const body = "## A\nalpha\nbeta\n\n## B\ngamma\n";
  const cursor = body.indexOf("alpha");
  const span = findHeadingSectionAtOffset(body, cursor)!;
  assert.equal(slice(body, span), "## A\nalpha\nbeta");
});

test("findHeadingSectionAtOffset: stops at HIGHER-level heading (e.g. ## stops ###'s walk)", () => {
  const body = "### child\nbody\n## parent\nmore\n";
  const cursor = body.indexOf("body");
  const span = findHeadingSectionAtOffset(body, cursor)!;
  assert.equal(slice(body, span), "### child\nbody");
});

test("findHeadingSectionAtOffset: deeper sub-headings stay inside the section", () => {
  const body = "## top\nintro\n### sub\nfine\n## next\n";
  const cursor = body.indexOf("intro");
  const span = findHeadingSectionAtOffset(body, cursor)!;
  assert.equal(slice(body, span), "## top\nintro\n### sub\nfine");
});

test("findHeadingSectionAtOffset: cursor on the heading line itself works", () => {
  const body = "## A\nalpha\n\n## B\nbeta\n";
  const cursor = body.indexOf("## B");
  const span = findHeadingSectionAtOffset(body, cursor)!;
  assert.equal(slice(body, span), "## B\nbeta");
});

test("findHeadingSectionAtOffset: returns null when no heading precedes the cursor", () => {
  const body = "intro line\nmore intro\n## later\nstuff\n";
  const cursor = body.indexOf("intro line");
  assert.equal(findHeadingSectionAtOffset(body, cursor), null);
});

/* ------------------------------------------------------------------ */
/* findAllBlockquotes                                                  */
/* ------------------------------------------------------------------ */

test("findAllBlockquotes: groups contiguous > lines into one span", () => {
  const body = "intro\n\n> first quoted\n> second quoted\n\nafter\n";
  const spans = findAllBlockquotes(body);
  assert.equal(spans.length, 1);
  assert.equal(slice(body, spans[0]!), "> first quoted\n> second quoted");
});

test("findAllBlockquotes: separate blockquotes become separate spans", () => {
  const body = "> alpha\n\n> beta\n\nplain\n\n> gamma\n";
  const spans = findAllBlockquotes(body);
  assert.deepEqual(
    spans.map((s) => slice(body, s)),
    ["> alpha", "> beta", "> gamma"],
  );
});

test("findAllBlockquotes: clips to range when provided", () => {
  const body = "> alpha\n\n> beta\n\n> gamma\n";
  const start = body.indexOf("> beta");
  const end = body.indexOf("> gamma");
  const spans = findAllBlockquotes(body, { start, end });
  assert.equal(spans.length, 1);
  assert.equal(slice(body, spans[0]!), "> beta");
});

test("findAllBlockquotes: returns [] when there are no quotes", () => {
  assert.deepEqual(findAllBlockquotes("only prose here\n"), []);
});

/* ------------------------------------------------------------------ */
/* findAllListItems                                                    */
/* ------------------------------------------------------------------ */

test("findAllListItems: one span per top-level bullet", () => {
  const body = "- alpha\n- beta\n- gamma\n";
  const spans = findAllListItems(body, { start: 0, end: body.length });
  assert.deepEqual(
    spans.map((s) => slice(body, s)),
    ["- alpha", "- beta", "- gamma"],
  );
});

test("findAllListItems: numbered lists are included", () => {
  const body = "1. first\n2. second\n3) third\n";
  const spans = findAllListItems(body, { start: 0, end: body.length });
  assert.equal(spans.length, 3);
  assert.equal(slice(body, spans[2]!), "3) third");
});

test("findAllListItems: continuation lines under a bullet stay with it", () => {
  const body = "- alpha\n  continued under alpha\n- beta\n";
  const spans = findAllListItems(body, { start: 0, end: body.length });
  assert.equal(spans.length, 2);
  assert.equal(slice(body, spans[0]!), "- alpha\n  continued under alpha");
  assert.equal(slice(body, spans[1]!), "- beta");
});

test("findAllListItems: nested items become their own spans", () => {
  const body = "- parent\n  - child A\n  - child B\n- next parent\n";
  const spans = findAllListItems(body, { start: 0, end: body.length });
  assert.deepEqual(
    spans.map((s) => slice(body, s)),
    ["- parent", "  - child A", "  - child B", "- next parent"],
  );
});

test("findAllListItems: respects the selection range", () => {
  const body = "- alpha\n- beta\n- gamma\n- delta\n";
  const start = body.indexOf("- beta");
  const end = body.indexOf("- delta");
  const spans = findAllListItems(body, { start, end });
  assert.deepEqual(
    spans.map((s) => slice(body, s)),
    ["- beta", "- gamma"],
  );
});

/* ------------------------------------------------------------------ */
/* findAllParagraphs                                                   */
/* ------------------------------------------------------------------ */

test("findAllParagraphs: splits a selection into blank-line-separated spans", () => {
  const body = "para one\nstill one\n\npara two\n\npara three\n";
  const spans = findAllParagraphs(body, { start: 0, end: body.length });
  assert.deepEqual(
    spans.map((s) => slice(body, s)),
    ["para one\nstill one", "para two", "para three"],
  );
});

test("findAllParagraphs: a paragraph straddling the selection edge is included whole", () => {
  // Intentional behaviour: slicing paragraphs mid-sentence produces weak
  // cards, so a paragraph the selection only touches is still returned in
  // full so the user reviews a complete thought.
  const body = "alpha alpha\n\nbeta beta\n\ngamma gamma\n";
  const start = body.indexOf("beta beta") + 4;
  const end = body.indexOf("gamma gamma") + 5;
  const spans = findAllParagraphs(body, { start, end });
  assert.deepEqual(
    spans.map((s) => slice(body, s)),
    ["beta beta", "gamma gamma"],
  );
});

test("findAllParagraphs: empty range returns []", () => {
  const body = "alpha\n\nbeta\n";
  assert.deepEqual(findAllParagraphs(body, { start: 0, end: 0 }), []);
});

// `spanIsInsideExtractMark` and its tests deleted under DESIGN §Q3:
// bulk-extract idempotency now reads the store for existing anchor ranges
// (see main.ts `existingExtractRangesForSource`) instead of scanning the
// body for inline `<mark>` chrome.
