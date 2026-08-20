import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyScrollProgress,
  formatReadLabel,
  scrollFits,
  scrollProgress,
  scrollTopFromProgress,
} from "../src/ir/reading-progress";

test("scrollFits: nothing to scroll", () => {
  assert.equal(scrollFits(400, 400), true);
  assert.equal(scrollFits(401, 400), true);
  assert.equal(scrollFits(800, 400), false);
});

test("scrollProgress: top, mid, bottom", () => {
  assert.equal(scrollProgress(0, 1000, 200), 0);
  assert.equal(scrollProgress(400, 1000, 200), 0.5);
  assert.equal(scrollProgress(800, 1000, 200), 1);
});

test("scrollProgress: fits-in-view is 1", () => {
  assert.equal(scrollProgress(0, 200, 200), 1);
});

test("scrollTopFromProgress: inverse of scrollProgress", () => {
  const h = 1000;
  const c = 200;
  for (const p of [0, 0.25, 0.5, 1]) {
    const top = scrollTopFromProgress(p, h, c);
    assert.equal(scrollProgress(top, h, c), p);
  }
});

test("applyScrollProgress writes the matching scrollTop", () => {
  const el = { scrollTop: 0, scrollHeight: 1000, clientHeight: 200 };
  applyScrollProgress(el as HTMLElement, 0.5);
  assert.equal(el.scrollTop, 400);
});

test("formatReadLabel", () => {
  assert.equal(formatReadLabel(0.42, false), "42% read");
  assert.equal(formatReadLabel(1, true), "Fits in view");
});
