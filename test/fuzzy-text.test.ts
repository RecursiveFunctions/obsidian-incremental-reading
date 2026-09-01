import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fuzzyLocateInBody,
  hiddenLinkChrome,
  normalizedOccurrencesBefore,
  normalizeNeedle,
} from "../src/ir/fuzzy-text";

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

test("hiddenLinkChrome: keeps the visible label, hides the syntax", () => {
  const visible = (raw: string) => {
    const hidden = hiddenLinkChrome(raw);
    return raw
      .split("")
      .filter((_, i) => !hidden[i])
      .join("");
  };
  assert.equal(visible("a [b label](https://x.y) d"), "a b label d");
  assert.equal(visible("x [[Note|alias]] y"), "x alias y");
  assert.equal(visible("x [[Note]] y"), "x Note y");
  assert.equal(visible("x ![alt](img.png) y"), "x  y");
  assert.equal(visible("x ![[img.png]] y"), "x  y");
  assert.equal(visible("plain [ bracket ] text"), "plain [ bracket ] text");
});

test("fuzzyLocateInBody: locates a rendered span that crosses a link", () => {
  const raw = "Delta points at [the anchor guide](https://example.com/a) for more.";
  const hit = fuzzyLocateInBody(raw, "points at the anchor guide for");
  assert.ok(hit);
  assert.equal(
    raw.slice(hit.start, hit.end),
    "points at [the anchor guide](https://example.com/a) for",
  );
});

test("fuzzyLocateInBody: a needle that is exactly the link label spans the whole link", () => {
  const raw = "and at [the anchor guide](https://example.com/a) for the rest.";
  const hit = fuzzyLocateInBody(raw, "the anchor guide");
  assert.ok(hit);
  assert.equal(
    raw.slice(hit.start, hit.end),
    "[the anchor guide](https://example.com/a)",
  );
});

test("normalizedOccurrencesBefore: counts twins in normalized space", () => {
  const rendered = "Zeta says the knob turns\nEta says the knob turns";
  const second = rendered.lastIndexOf("the knob turns");
  assert.equal(normalizedOccurrencesBefore(rendered, 0, "the knob turns"), 0);
  assert.equal(normalizedOccurrencesBefore(rendered, second, "the knob turns"), 1);
});

test("fuzzyLocateInBody: nth picks the twin instead of refusing", () => {
  const raw = "Zeta says the knob turns here.\n\nEta says the knob turns here.";
  assert.equal(fuzzyLocateInBody(raw, "the knob turns here"), null);
  const second = fuzzyLocateInBody(raw, "the knob turns here", 1);
  assert.ok(second);
  assert.ok(second.start > raw.indexOf("Eta"));
  const first = fuzzyLocateInBody(raw, "the knob turns here", 0);
  assert.ok(first);
  assert.ok(first.start < raw.indexOf("Eta"));
});
