import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nthOccurrenceOffset,
  readingViewNeedle,
  readingViewNeedleBlocks,
  readingViewNeedlePasses,
} from "../src/ir/extract-reading-marks";

test("readingViewNeedlePasses: skips short needles, keeps duplicate quotes", () => {
  const passes = readingViewNeedlePasses([
    { text: "ab" },
    { text: "  first quote  " },
    { text: "first quote" },
    { text: "other passage here" },
  ]);
  assert.deepEqual(passes, [
    { needle: "first quote", n: 0 },
    { needle: "first quote", n: 1 },
    { needle: "other passage here", n: 0 },
  ]);
});

test("readingViewNeedle: strips markdown emphasis so rendered text matches", () => {
  assert.equal(readingViewNeedle("**bold phrase here**"), "bold phrase here");
  assert.equal(readingViewNeedle("_italic span ok_"), "italic span ok");
  assert.equal(readingViewNeedle("ab"), "");
});

test("readingViewNeedlePasses: markdown-wrapped quotes normalize to one needle", () => {
  const passes = readingViewNeedlePasses([
    { text: "**same words here**" },
    { text: "same words here" },
  ]);
  assert.deepEqual(passes, [
    { needle: "same words here", n: 0 },
    { needle: "same words here", n: 1 },
  ]);
});

test("nthOccurrenceOffset: second identical quote is a later index", () => {
  const hay = "the cat sat on the mat";
  assert.equal(nthOccurrenceOffset(hay, "the", 0), 0);
  assert.equal(nthOccurrenceOffset(hay, "the", 1), hay.lastIndexOf("the"));
  assert.equal(nthOccurrenceOffset(hay, "the", 2), -1);
});

test("readingViewNeedleBlocks: splits a multi-block extract into per-block needles", () => {
  const blocks = readingViewNeedleBlocks(
    "Alpha paragraph text.\n\nBeta paragraph text.",
  );
  assert.deepEqual(
    blocks.map((b) => b.needle),
    ["Alpha paragraph text.", "Beta paragraph text."],
  );
});

test("readingViewNeedleBlocks: strips list chrome the renderer never shows", () => {
  const blocks = readingViewNeedleBlocks(
    "- first bullet here\n- second bullet here",
  );
  assert.equal(blocks.length, 1);
  assert.deepEqual(blocks[0]!.lines, [
    "first bullet here",
    "second bullet here",
  ]);
});

test("readingViewNeedleBlocks: strips blockquote, ordered-list, and heading chrome", () => {
  assert.deepEqual(
    readingViewNeedleBlocks("> quoted line here")[0]!.lines,
    ["quoted line here"],
  );
  assert.deepEqual(
    readingViewNeedleBlocks("1. numbered line here")[0]!.lines,
    ["numbered line here"],
  );
  // `#` is already dropped as emphasis chrome, so the heading needle and its
  // line needle agree and no separate line fallback is recorded.
  assert.deepEqual(readingViewNeedleBlocks("## Heading here"), [
    { needle: "Heading here", lines: [] },
  ]);
});

test("readingViewNeedleBlocks: a single plain paragraph needs no line fallback", () => {
  assert.deepEqual(readingViewNeedleBlocks("one plain paragraph"), [
    { needle: "one plain paragraph", lines: [] },
  ]);
});

test("readingViewNeedle: flattens link syntax to what the renderer shows", () => {
  assert.equal(
    readingViewNeedle("[the anchor guide](https://example.com/anchors)"),
    "the anchor guide",
  );
  assert.equal(readingViewNeedle("see [[Notes|the notes]] later"), "see the notes later");
  assert.equal(readingViewNeedle("see [[Notes]] later"), "see Notes later");
  assert.equal(readingViewNeedle("figure ![alt text](img.png) here"), "figure here");
});
