import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLOZE_RE,
  buildClozeBody,
  buildClozeFromText,
  hasCloze,
  nextClozeNumber,
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

test("buildClozeFromText: flat offsets locate the spanned lines", () => {
  const raw = "The quick brown fox\njumps over the lazy dog";
  // "quick" lives at offsets 4..9 in the joined string.
  const r = buildClozeFromText(raw, 4, 9);
  assert.equal(r.answer, "quick");
  assert.equal(r.body, "The {{c1::quick}} brown fox");
});

test("buildClozeFromText: selection crossing the newline keeps both lines", () => {
  const raw = "first line here\nsecond line there";
  // Offsets that bracket "line here\nsecond" inside the joined block.
  const start = raw.indexOf("line here");
  const end = raw.indexOf("second") + "second".length;
  const r = buildClozeFromText(raw, start, end);
  assert.equal(r.answer, "line here\nsecond");
  assert.equal(r.body, "first {{c1::line here\nsecond}} line there");
});

test("buildClozeFromText: end-of-line selection lands at column length", () => {
  const raw = "alpha\nbeta";
  // Select "alpha" (offsets 0..5).
  const r = buildClozeFromText(raw, 0, 5);
  assert.equal(r.answer, "alpha");
  assert.equal(r.body, "{{c1::alpha}}");
});

test("nextClozeNumber returns 1 on text with no clozes", () => {
  assert.equal(nextClozeNumber(""), 1);
  assert.equal(nextClozeNumber("nothing hidden here"), 1);
});

test("nextClozeNumber returns max existing + 1, ignoring order", () => {
  assert.equal(nextClozeNumber("a {{c1::x}} b"), 2);
  assert.equal(nextClozeNumber("a {{c1::x}} {{c2::y}} b"), 3);
  // Out-of-order or non-contiguous numbers still pick the next free slot
  // strictly above the max so an Anki import keeps each card distinct.
  assert.equal(nextClozeNumber("a {{c5::x}} {{c2::y}} b"), 6);
});
