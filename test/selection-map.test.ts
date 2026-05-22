import { test } from "node:test";
import assert from "node:assert/strict";
import { locateTextInBody } from "../src/ir/selection-map";

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
