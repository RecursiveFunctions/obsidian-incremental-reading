import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nthOccurrenceOffset,
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

test("nthOccurrenceOffset: second identical quote is a later index", () => {
  const hay = "the cat sat on the mat";
  assert.equal(nthOccurrenceOffset(hay, "the", 0), 0);
  assert.equal(nthOccurrenceOffset(hay, "the", 1), hay.lastIndexOf("the"));
  assert.equal(nthOccurrenceOffset(hay, "the", 2), -1);
});
