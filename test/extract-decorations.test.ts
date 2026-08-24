import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nthOccurrenceOffset,
  readingViewNeedle,
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
