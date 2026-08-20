import { test } from "node:test";
import assert from "node:assert/strict";
import { locateTextInBody, SWITCH_TO_EDIT_COPY, mapRenderedCaretToRaw, alignRenderedOffsetToRaw } from "../src/ir/selection-map";

test("locateTextInBody: finds multi-line text when needle has newlines", () => {
  const raw = "intro\nfirst line here\nsecond line there\noutro";
  const needle = "line here\nsecond";
  const r = locateTextInBody(raw, needle);
  assert.ok(r);
  assert.equal(r!.text, needle);
  assert.equal(raw.slice(r!.start, r!.end), needle);
});

test("locateTextInBody: bridges lines when needle collapsed whitespace", () => {
  const raw = "first line here\nsecond line there";
  const r = locateTextInBody(raw, "line here second");
  assert.ok(r);
  assert.equal(r!.text, "line here\nsecond");
});

test("mapRenderedCaretToRaw: same string, caret on a later word", () => {
  const raw = "aaa bbb ccc ddd eee fff ggg";
  const caret = raw.indexOf("eee");
  assert.equal(mapRenderedCaretToRaw(raw, raw, caret), caret);
});

test("mapRenderedCaretToRaw: second paragraph after a blank line", () => {
  const raw = "First paragraph here.\n\nSecond paragraph with extra words.";
  const rendered = "First paragraph here.\nSecond paragraph with extra words.";
  const caret = rendered.indexOf("extra");
  const got = mapRenderedCaretToRaw(raw, rendered, caret);
  assert.ok(got !== null);
  assert.equal(raw.slice(got!, got! + 5), "extra");
});

test("alignRenderedOffsetToRaw: skips markdown markers", () => {
  const rendered = "Hello world folks";
  const raw = "Hello **world** folks";
  const rel = rendered.indexOf("world") + 2;
  const inner = alignRenderedOffsetToRaw(rendered, raw, rel);
  assert.equal(raw.slice(inner, inner + 3), "rld");
});

test("SWITCH_TO_EDIT_COPY is the user-facing preview-map fallback", () => {
  assert.match(SWITCH_TO_EDIT_COPY, /Switch to Edit/);
});
