import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLOZE_RE,
  buildClozeBody,
  hasCloze,
  wrapCloze,
} from "../src/cloze";

test("wrapCloze uses group 1 by default and honors n", () => {
  assert.equal(wrapCloze("x"), "{{c1::x}}");
  assert.equal(wrapCloze("x", 2), "{{c2::x}}");
});

test("CLOZE_RE captures group number and answer; hasCloze detects", () => {
  CLOZE_RE.lastIndex = 0;
  const m = CLOZE_RE.exec("a {{c3::hidden}} b");
  assert.equal(m?.[1], "3");
  assert.equal(m?.[2], "hidden");
  assert.equal(hasCloze("no cloze here"), false);
  assert.equal(hasCloze("has {{c1::one}}"), true);
});

test("single-line selection in the middle", () => {
  const r = buildClozeBody(["The quick brown fox"], 4, 9);
  assert.equal(r.answer, "quick");
  assert.equal(r.body, "The {{c1::quick}} brown fox");
});

test("single-line: picks the selected occurrence, not the first match", () => {
  // Select the *second* "ba" (chars 3..5), not the first.
  const r = buildClozeBody(["ba ba black sheep"], 3, 5);
  assert.equal(r.answer, "ba");
  assert.equal(r.body, "ba {{c1::ba}} black sheep");
});

test("selection at line start and at line end", () => {
  assert.equal(
    buildClozeBody(["hello world"], 0, 5).body,
    "{{c1::hello}} world",
  );
  assert.equal(
    buildClozeBody(["hello world"], 6, 11).body,
    "hello {{c1::world}}",
  );
});

test("multi-line selection keeps the spanned lines as context", () => {
  const r = buildClozeBody(["first line here", "second line there"], 6, 6);
  assert.equal(r.answer, "line here\nsecond");
  assert.equal(r.body, "first {{c1::line here\nsecond}} line there");
});

test("whole single line", () => {
  const line = "entire line selected";
  const r = buildClozeBody([line], 0, line.length);
  assert.equal(r.answer, line);
  assert.equal(r.body, `{{c1::${line}}}`);
});
