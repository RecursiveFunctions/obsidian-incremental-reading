import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLOZE_RE,
  buildClozeBody,
  buildClozeFromText,
  bodyWithSingleClozeGroup,
  escapeClozeHtmlFragment,
  hasCloze,
  listClozeGroupNumbers,
  nextClozeNumber,
  parseClozeInner,
  transformClozes,
  wrapCloze,
} from "../src/cloze";

test("wrapCloze uses group 1 by default and honors n", () => {
  assert.equal(wrapCloze("x"), "{{c1::x}}");
  assert.equal(wrapCloze("x", 2), "{{c2::x}}");
});

test("wrapCloze optional hint", () => {
  assert.equal(wrapCloze("Paris", 1, "capital"), "{{c1::Paris::capital}}");
  assert.equal(wrapCloze("a::b", 2, "hint"), "{{c2::a::b::hint}}");
});

test("parseClozeInner splits on last ::", () => {
  assert.deepEqual(parseClozeInner("only"), { answer: "only" });
  assert.deepEqual(parseClozeInner("a::b"), { answer: "a", hint: "b" });
  assert.deepEqual(parseClozeInner("a::b::c"), { answer: "a::b", hint: "c" });
  assert.deepEqual(parseClozeInner("a::"), { answer: "a" });
});

test("escapeClozeHtmlFragment escapes markup", () => {
  assert.equal(escapeClozeHtmlFragment("<x>"), "&lt;x&gt;");
});

test("CLOZE_RE captures group number and inner payload; hasCloze detects", () => {
  CLOZE_RE.lastIndex = 0;
  const m = CLOZE_RE.exec("a {{c3::hidden}} b");
  assert.equal(m?.[1], "3");
  assert.equal(m?.[2], "hidden");
  CLOZE_RE.lastIndex = 0;
  const m2 = CLOZE_RE.exec("x {{c1::ans::hint}} y");
  assert.equal(m2?.[1], "1");
  assert.equal(m2?.[2], "ans::hint");
  assert.equal(hasCloze("no cloze here"), false);
  assert.equal(hasCloze("has {{c1::one}}"), true);
});

test("single-line selection in the middle", () => {
  const r = buildClozeBody(["The quick brown fox"], 4, 9);
  assert.equal(r.answer, "quick");
  assert.equal(r.body, "The {{c1::quick}} brown fox");
});

test("buildClozeBody with optional hint", () => {
  const r = buildClozeBody(["The quick brown fox"], 4, 9, "color word");
  assert.equal(r.answer, "quick");
  assert.equal(r.body, "The {{c1::quick::color word}} brown fox");
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

/* ------------------------------------------------------------------ */
/* transformClozes                                                     */
/* ------------------------------------------------------------------ */

test("transformClozes: replaces bare cloze markers without code wrap", () => {
  const out = transformClozes(
    "The {{c1::quick}} brown fox",
    ({ answer }, inCodeSpan) =>
      inCodeSpan ? `<code>[${answer}]</code>` : `[${answer}]`,
  );
  assert.equal(out, "The [quick] brown fox");
});

test("transformClozes: consumes surrounding backticks and signals inCodeSpan", () => {
  const out = transformClozes(
    "use `{{c1::pip install}}` here",
    ({ answer }, inCodeSpan) =>
      inCodeSpan ? `<code>[${answer}]</code>` : `[${answer}]`,
  );
  assert.equal(out, "use <code>[pip install]</code> here");
});

test("transformClozes: only consumes backticks when present on BOTH sides", () => {
  // Leading backtick only — leave it; not a balanced inline-code span.
  assert.equal(
    transformClozes(
      "a `{{c1::x}} b",
      ({ answer }, inCodeSpan) =>
        inCodeSpan ? `<code>[${answer}]</code>` : `[${answer}]`,
    ),
    "a `[x] b",
  );
  // Trailing backtick only — same.
  assert.equal(
    transformClozes(
      "a {{c1::x}}` b",
      ({ answer }, inCodeSpan) =>
        inCodeSpan ? `<code>[${answer}]</code>` : `[${answer}]`,
    ),
    "a [x]` b",
  );
});

test("transformClozes: passes parsed hint through", () => {
  const out = transformClozes(
    "Q: {{c1::Paris::capital}}.",
    ({ answer, hint }) => `[${answer}|${hint ?? ""}]`,
  );
  assert.equal(out, "Q: [Paris|capital].");
});

test("transformClozes: handles multiple markers, mixed contexts", () => {
  const out = transformClozes(
    "use `{{c1::pip}}` then {{c2::twine}} to publish",
    ({ answer }, inCodeSpan) =>
      inCodeSpan ? `<code>[${answer}]</code>` : `[${answer}]`,
  );
  assert.equal(out, "use <code>[pip]</code> then [twine] to publish");
});

test("transformClozes: no markers yields the input unchanged", () => {
  assert.equal(
    transformClozes("no clozes here", () => "X"),
    "no clozes here",
  );
});

test("listClozeGroupNumbers collects distinct ascending N", () => {
  assert.deepEqual(listClozeGroupNumbers(""), []);
  assert.deepEqual(listClozeGroupNumbers("plain"), []);
  assert.deepEqual(listClozeGroupNumbers("{{c2::b}} {{c1::a}}"), [1, 2]);
});

test("bodyWithSingleClozeGroup keeps one blank as c1", () => {
  const raw = "A {{c1::one}} B {{c2::two}} C";
  assert.equal(
    bodyWithSingleClozeGroup(raw, 1),
    "A {{c1::one}} B two C",
  );
  assert.equal(
    bodyWithSingleClozeGroup(raw, 2),
    "A one B {{c1::two}} C",
  );
});

test("bodyWithSingleClozeGroup preserves hint on focused group", () => {
  assert.equal(
    bodyWithSingleClozeGroup("x {{c3::ans::hint}} y", 3),
    "x {{c1::ans::hint}} y",
  );
});
