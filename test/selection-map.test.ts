import { test } from "node:test";
import assert from "node:assert/strict";
import { locateTextInBody, SWITCH_TO_EDIT_COPY, mapRenderedCaretToRaw, alignRenderedOffsetToRaw, alignRawOffsetToRendered, previewScrollNeedle, uniqueIndex, expandSelectionAroundLinks } from "../src/ir/selection-map";

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

test("alignRawOffsetToRendered: inverse of skipping markdown markers", () => {
  const rendered = "Hello world folks";
  const raw = "Hello **world** folks";
  const rawOff = raw.indexOf("world") + 2;
  const inner = alignRawOffsetToRendered(rendered, raw, rawOff);
  assert.equal(rendered.slice(inner, inner + 3), "rld");
});

test("previewScrollNeedle: unique visible phrase after a caret", () => {
  const raw = "Hello **world** folks and more words here";
  const off = raw.indexOf("world");
  const needle = previewScrollNeedle(raw, off);
  assert.ok(needle);
  assert.match(needle!, /world/);
  assert.equal(uniqueIndex("Hello world folks and more words here", needle!), 6);
});

test("SWITCH_TO_EDIT_COPY is the user-facing preview-map fallback", () => {
  assert.match(SWITCH_TO_EDIT_COPY, /Switch to Edit/);
});

test("expandSelectionAroundLinks: leaves plain-text selections alone", () => {
  const raw = "the quick brown fox";
  const r = expandSelectionAroundLinks(raw, 4, 9);
  assert.deepEqual(r, { start: 4, end: 9 });
});

test("expandSelectionAroundLinks: expands a label-interior selection to whole link", () => {
  const raw = "see [data.tf](#datatf) for details";
  const labelStart = raw.indexOf("data.tf");
  const labelEnd = labelStart + "data.tf".length;
  const r = expandSelectionAroundLinks(raw, labelStart, labelEnd);
  assert.equal(raw.slice(r.start, r.end), "[data.tf](#datatf)");
});

test("expandSelectionAroundLinks: expands when selection straddles ]( boundary", () => {
  const raw = "see [data.tf](#datatf) for details";
  const mid = raw.indexOf("tf](");
  const r = expandSelectionAroundLinks(raw, mid, mid + "tf](#dat".length);
  assert.equal(raw.slice(r.start, r.end), "[data.tf](#datatf)");
});

test("expandSelectionAroundLinks: expands wikilinks with alias", () => {
  const raw = "before [[Foo Bar|the Foo]] after";
  const alias = raw.indexOf("the Foo");
  const r = expandSelectionAroundLinks(raw, alias, alias + "the Foo".length);
  assert.equal(raw.slice(r.start, r.end), "[[Foo Bar|the Foo]]");
});

test("expandSelectionAroundLinks: expands image links", () => {
  const raw = "an ![alt text](img.png) image";
  const alt = raw.indexOf("alt");
  const r = expandSelectionAroundLinks(raw, alt, alt + "alt text".length);
  assert.equal(raw.slice(r.start, r.end), "![alt text](img.png)");
});

test("expandSelectionAroundLinks: selection already containing a link stays put", () => {
  const raw = "see [data.tf](#datatf) here";
  const start = raw.indexOf("see");
  const end = raw.indexOf("here") + "here".length;
  const r = expandSelectionAroundLinks(raw, start, end);
  assert.deepEqual(r, { start, end });
});

test("expandSelectionAroundLinks: selection ending exactly at ) is untouched", () => {
  const raw = "prefix [x](y) suffix";
  const start = raw.indexOf("prefix");
  const end = raw.indexOf(")") + 1;
  const r = expandSelectionAroundLinks(raw, start, end);
  assert.deepEqual(r, { start, end });
});

test("expandSelectionAroundLinks: back-to-back links pulled in on both ends", () => {
  const raw = "x [a](1) [b](2) y";
  const inA = raw.indexOf("a");
  const inB = raw.indexOf("b");
  const r = expandSelectionAroundLinks(raw, inA, inB + 1);
  assert.equal(raw.slice(r.start, r.end), "[a](1) [b](2)");
});

test("expandSelectionAroundLinks: empty or reversed selection is a no-op", () => {
  const raw = "see [data.tf](#datatf)";
  assert.deepEqual(expandSelectionAroundLinks(raw, 5, 5), { start: 5, end: 5 });
  assert.deepEqual(expandSelectionAroundLinks(raw, 9, 5), { start: 9, end: 5 });
});

test("expandSelectionAroundLinks: unclosed [ in prose doesn't runaway across newlines", () => {
  const raw = "loose [ bracket\nnext paragraph [ok](#ok) end";
  const okStart = raw.indexOf("ok](");
  const r = expandSelectionAroundLinks(raw, okStart, okStart + 2);
  assert.equal(raw.slice(r.start, r.end), "[ok](#ok)");
});
