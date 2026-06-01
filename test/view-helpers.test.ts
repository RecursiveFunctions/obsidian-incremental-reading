/**
 * Tests for pure helpers extracted from view modules:
 *   - findExtractRange    (src/ir/extract-range.ts)
 *   - formatDueLabel      (src/ir/due-label.ts)
 *   - stripFrontmatter    (src/ir/frontmatter-body.ts)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findExtractRange,
  findExtractEditorPosition,
} from "../src/ir/extract-range";
import { formatDueLabel } from "../src/ir/due-label";
import {
  bodyOffsetsFromFullOffsets,
  sanitizeExtractSelection,
  stripExtractMarks,
  stripFrontmatter,
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

test("findExtractRange: cloze item locates itself inside plain parent source", () => {
  // Split-cloze item: body carries `{{cN::…}}` syntax for the active blank
  // (other groups inlined). The parent source is plain prose. Direct
  // substring search misses; the cloze-stripped fallback must find it so the
  // review pane and tree-view can scroll the source to this position.
  const source =
    "Intro paragraph.\n\nRefactor/re-architect targets cloud-native patterns (e.g., microservices, containers) and is usually the highest effort migration path.\n\nFollow-up.";
  const el = makeElement({
    type: "item",
    text: "Refactor/re-architect targets cloud-native patterns (e.g., {{c1::microservices}}, containers) and is usually the highest effort migration path.",
  });
  const r = findExtractRange(el, source);
  assert.ok(r);
  assert.equal(
    source.slice(r.start, r.end),
    "Refactor/re-architect targets cloud-native patterns (e.g., microservices, containers) and is usually the highest effort migration path.",
  );
});

test("findExtractRange: cloze fallback respects ambiguity guard", () => {
  // Two identical plain occurrences in the source → the fallback must refuse
  // to pick one (same contract as the direct-text path).
  const source = "alpha beta gamma. ... later alpha beta gamma.";
  const el = makeElement({
    type: "item",
    text: "alpha {{c1::beta}} gamma",
  });
  assert.equal(findExtractRange(el, source), undefined);
});

/* ------------------------------------------------------------------ */
/* findExtractEditorPosition                                           */
/* ------------------------------------------------------------------ */

test("findExtractEditorPosition: simple body, single line", () => {
  const full = "The quick brown fox";
  const el = makeElement({ text: "brown fox" });
  const p = findExtractEditorPosition(el, full);
  assert.deepEqual(p, { line: 0, ch: 10 });
});

test("findExtractEditorPosition: multi-line body counts newlines", () => {
  const full = "line one\nline two has the target here\nline three";
  const el = makeElement({ text: "the target" });
  const p = findExtractEditorPosition(el, full);
  assert.ok(p);
  assert.equal(p.line, 1);
  assert.equal(full.split("\n")[p.line]!.slice(p.ch, p.ch + 10), "the target");
});

test("findExtractEditorPosition: skips frontmatter when computing line", () => {
  const full =
    "---\ntitle: Hello\nauthor: Me\n---\nfirst body line\nbrown fox here\n";
  const el = makeElement({ text: "brown fox" });
  const p = findExtractEditorPosition(el, full);
  assert.ok(p);
  // Frontmatter occupies lines 0..3; "first body line" is line 4; the target
  // is on line 5 starting at column 0.
  assert.equal(p.line, 5);
  assert.equal(p.ch, 0);
  assert.equal(
    full.split("\n")[p.line]!.slice(p.ch, p.ch + 9),
    "brown fox",
  );
});

test("findExtractEditorPosition: handles leading blank lines after frontmatter", () => {
  const full = "---\nk: v\n---\n\n\nbrown fox starts here\n";
  const el = makeElement({ text: "brown fox" });
  const p = findExtractEditorPosition(el, full);
  assert.ok(p);
  assert.equal(full.split("\n")[p.line]!.slice(p.ch, p.ch + 9), "brown fox");
});

test("findExtractEditorPosition: returns undefined when text is missing", () => {
  const full = "no match here";
  const el = makeElement({ text: "brown fox" });
  assert.equal(findExtractEditorPosition(el, full), undefined);
});

test("findExtractEditorPosition: uses anchor over text when both differ", () => {
  // Body has two occurrences of "abc"; anchor's position hint points at the
  // second one, which the helper must honor over indexOf's first hit.
  const full = "---\nk: v\n---\nabc xx abc yy";
  const el = makeElement({
    text: "abc",
    anchor: {
      sourcePath: "Note.md",
      quote: { exact: "abc", prefix: "xx ", suffix: " yy" },
      position: { start: 7, end: 10 },
    },
  });
  const p = findExtractEditorPosition(el, full);
  assert.ok(p);
  // The body line is "abc xx abc yy"; the second "abc" is at column 7.
  assert.equal(p.line, 3);
  assert.equal(p.ch, 7);
});

test("findExtractEditorPosition: locates extract wrapped in <mark> chrome", () => {
  // After wrapExtractHighlight runs, the source body contains the extract
  // wrapped in IR's mark. The anchor's quote.exact stores the wrapped text,
  // so the helper must still resolve it correctly to the wrap's start.
  const full =
    'first line\n<mark class="ir-extract-source">brown fox</mark> jumps\n';
  const wrapped = '<mark class="ir-extract-source">brown fox</mark>';
  const el = makeElement({
    text: "brown fox",
    anchor: {
      sourcePath: "Note.md",
      quote: { exact: wrapped, prefix: "", suffix: " jumps" },
      position: { start: 11, end: 11 + wrapped.length },
    },
  });
  const p = findExtractEditorPosition(el, full);
  assert.ok(p);
  assert.equal(p.line, 1);
  assert.equal(p.ch, 0);
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

// `wrapExtractHighlight` and its tests deleted under DESIGN §Q3: extracts no
// longer mutate the source body, so there is no wrapper to round-trip. The
// `findExtractEditorPosition: locates extract wrapped in <mark> chrome` test
// above still covers anchor resolution against legacy notes that carry the
// pre-§Q3 chrome on disk.

/* ------------------------------------------------------------------ */
/* bodyOffsetsFromFullOffsets                                          */
/* ------------------------------------------------------------------ */

test("bodyOffsetsFromFullOffsets: maps offsets past frontmatter", () => {
  const full = "---\ntitle: Hello\n---\nBody text here.";
  const bodyStart = full.indexOf("Body");
  const r = bodyOffsetsFromFullOffsets(full, bodyStart, bodyStart + 4);
  assert.deepEqual(r, { start: 0, end: 4 });
  assert.equal(stripFrontmatter(full).slice(r!.start, r!.end), "Body");
});

test("bodyOffsetsFromFullOffsets: accounts for leading whitespace trimmed by stripFrontmatter", () => {
  const full = "---\nk: v\n---\n\n  Body  \n";
  const stripped = stripFrontmatter(full);
  assert.equal(stripped, "Body");
  const bodyStart = full.indexOf("Body");
  const r = bodyOffsetsFromFullOffsets(full, bodyStart, bodyStart + 4);
  assert.deepEqual(r, { start: 0, end: 4 });
  assert.equal(stripped.slice(r!.start, r!.end), "Body");
});

test("bodyOffsetsFromFullOffsets: works for files without frontmatter", () => {
  const full = "The quick brown fox";
  const r = bodyOffsetsFromFullOffsets(full, 4, 9);
  assert.deepEqual(r, { start: 4, end: 9 });
  assert.equal(full.slice(r!.start, r!.end), "quick");
});

test("bodyOffsetsFromFullOffsets: returns null for selection inside frontmatter", () => {
  const full = "---\ntitle: Hello\n---\nBody text.";
  assert.equal(bodyOffsetsFromFullOffsets(full, 4, 9), null);
});

test("bodyOffsetsFromFullOffsets: returns null for empty/inverted range", () => {
  const full = "Hello body.";
  assert.equal(bodyOffsetsFromFullOffsets(full, 5, 5), null);
  assert.equal(bodyOffsetsFromFullOffsets(full, 7, 3), null);
});

test("bodyOffsetsFromFullOffsets: anchors duplicate substrings by position, not by text", () => {
  // Same phrase appears twice; substring-search would bail, position-map
  // resolves to the exact selected occurrence.
  const full = "---\nk: v\n---\nfoo bar foo bar";
  // Second "foo" is at full offset 21.
  const r = bodyOffsetsFromFullOffsets(full, 21, 24);
  assert.deepEqual(r, { start: 8, end: 11 });
  assert.equal(stripFrontmatter(full).slice(r!.start, r!.end), "foo");
});

test("bodyOffsetsFromFullOffsets: clamps when selection extends past trimmed body", () => {
  const full = "---\nk: v\n---\nBody  \n";
  const stripped = stripFrontmatter(full);
  // Try to select "Body  " (includes trailing whitespace stripped by trim).
  const r = bodyOffsetsFromFullOffsets(full, 13, 19);
  assert.deepEqual(r, { start: 0, end: stripped.length });
  assert.equal(stripped.slice(r!.start, r!.end), "Body");
});

/* ------------------------------------------------------------------ */
/* stripExtractMarks                                                   */
/* ------------------------------------------------------------------ */

test("stripExtractMarks: leaves text without marks unchanged", () => {
  assert.equal(stripExtractMarks("plain text"), "plain text");
  assert.equal(stripExtractMarks(""), "");
});

test("stripExtractMarks: removes a single extract-source mark", () => {
  assert.equal(
    stripExtractMarks(
      'The <mark class="ir-extract-source">quick</mark> brown fox',
    ),
    "The quick brown fox",
  );
});

test("stripExtractMarks: removes multiple sibling marks", () => {
  assert.equal(
    stripExtractMarks(
      'a <mark class="ir-extract-source">b</mark> c <mark class="ir-extract-source">d</mark> e',
    ),
    "a b c d e",
  );
});

test("stripExtractMarks: unwraps nested extract marks", () => {
  // An extract whose body itself contains a sibling extract mark.
  const nested =
    '<mark class="ir-extract-source">outer <mark class="ir-extract-source">inner</mark> tail</mark>';
  assert.equal(stripExtractMarks(nested), "outer inner tail");
});

test("stripExtractMarks: leaves unrelated mark classes alone", () => {
  const cloze = '<mark class="ir-cloze-elision">[ ... ]</mark>';
  assert.equal(stripExtractMarks(cloze), cloze);
});

test("stripExtractMarks: strips orphan IR-class opener (selection started mid-mark)", () => {
  // Real-world case: the user selected a span that began inside an existing
  // IR extract, so the captured text has the opener but the closer fell
  // outside the selection. Without this strip the tree row leaks the long
  // class attribute as literal text.
  const orphanOpen =
    '<mark class="ir-extract-source">Poetry lets you easily build and package projects.';
  assert.equal(
    stripExtractMarks(orphanOpen),
    "Poetry lets you easily build and package projects.",
  );
});

test("stripExtractMarks: strips orphan </mark> (selection ended mid-mark)", () => {
  const orphanClose = "Poetry lets you build and package projects.</mark>";
  assert.equal(
    stripExtractMarks(orphanClose),
    "Poetry lets you build and package projects.",
  );
});

test("stripExtractMarks: preserves a user's own balanced <mark>…</mark> pair", () => {
  // No IR class on this pair → must survive intact so we never silently
  // damage user-authored HTML highlights.
  const userMark = "before <mark>plain highlight</mark> after";
  assert.equal(stripExtractMarks(userMark), userMark);
});

test("stripExtractMarks: mixed orphan opener + user-authored balanced pair", () => {
  const mixed =
    '<mark class="ir-extract-source">lead text <mark>plain</mark> rest of body';
  assert.equal(
    stripExtractMarks(mixed),
    "lead text <mark>plain</mark> rest of body",
  );
});
