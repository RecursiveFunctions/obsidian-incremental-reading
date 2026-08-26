import { test } from "node:test";
import assert from "node:assert/strict";
import { findImageEmbedRange, imageEmbedMarkup } from "../src/ir/image-embed";

test("findImageEmbedRange locates wikilink and markdown embeds", () => {
  const body = "Intro\n\n![[pics/heart.png|300]]\n\nMore ![alt](pics/heart.png \"t\") end";
  const first = findImageEmbedRange(body, "pics/heart.png");
  assert.ok(first);
  assert.equal(first!.markup, "![[pics/heart.png|300]]");
  assert.equal(body.slice(first!.start, first!.end), first!.markup);
  const second = findImageEmbedRange(body, "heart.png", 1);
  assert.equal(second?.markup, '![alt](pics/heart.png "t")');
  assert.equal(findImageEmbedRange(body, "other.png"), null);
  assert.equal(imageEmbedMarkup("a/b.png"), "![[a/b.png]]");
});

test("findImageEmbedRange does not match a longer basename suffix", () => {
  const body = "![[notheart.png]] ![[heart.png]]";
  const r = findImageEmbedRange(body, "heart.png");
  assert.equal(r?.markup, "![[heart.png]]");
});
