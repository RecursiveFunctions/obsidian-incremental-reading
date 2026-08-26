import { test } from "node:test";
import assert from "node:assert/strict";
import { fuzzyLocateInBody, normalizeNeedle } from "../src/ir/fuzzy-text";

test("fuzzyLocateInBody ignores emphasis and whitespace shape", () => {
  const raw = "Intro line.\n\nThe **quick** brown\nfox _jumps_ over `the` lazy dog.";
  const hit = fuzzyLocateInBody(raw, "quick brown fox jumps over the lazy");
  assert.ok(hit);
  assert.equal(raw.slice(hit!.start, hit!.end), "**quick** brown\nfox _jumps_ over `the` lazy");
});

test("fuzzyLocateInBody refuses ambiguous and tiny needles", () => {
  assert.equal(fuzzyLocateInBody("a b a b", "a b"), null);
  assert.equal(fuzzyLocateInBody("hello", "h"), null);
  assert.equal(fuzzyLocateInBody("hello", "zzz"), null);
  assert.equal(normalizeNeedle("  **bold**   text \n"), "bold text");
});
