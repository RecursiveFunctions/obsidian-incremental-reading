/**
 * Golden contract for src/ir/anchor.ts (Q1: layered selector chain C).
 *
 * Claude-authored, fenced out of the delegated scope. opencode implements
 * src/ir/anchor.ts from the TASK.md prose and is judged solely by this suite
 * plus `tsc -noEmit`.
 *
 * The cardinal rule under test: a failed or ambiguous relocation must return
 * { status: "needs-reanchor" }, never a confident wrong span.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAnchor, normalizeForMatch } from "../src/ir/anchor";
import type { Anchor } from "../src/ir/model";

function anchor(p: {
  exact: string;
  prefix?: string;
  suffix?: string;
  position?: { start: number; end: number };
}): Anchor {
  return {
    sourcePath: "Note.md",
    quote: { exact: p.exact, prefix: p.prefix ?? "", suffix: p.suffix ?? "" },
    position: p.position,
  };
}

test("position fast path: correct hint resolves with repaired=false", () => {
  const src = "alpha beta gamma";
  const r = resolveAnchor(anchor({ exact: "beta", position: { start: 6, end: 10 } }), src);
  assert.deepEqual(r, { status: "ok", start: 6, end: 10, repaired: false });
});

test("stale position, unique exact elsewhere: relocates and marks repaired", () => {
  const src = "xx beta yy"; // beta is at 3..7, not the stale 6..10
  const r = resolveAnchor(anchor({ exact: "beta", position: { start: 6, end: 10 } }), src);
  assert.equal(r.status, "ok");
  if (r.status !== "ok") return;
  assert.equal(src.slice(r.start, r.end), "beta");
  assert.equal(r.repaired, true);
});

test("no position, unique exact: resolves repaired=true", () => {
  const src = "the quick brown fox";
  const r = resolveAnchor(anchor({ exact: "brown" }), src);
  assert.equal(r.status, "ok");
  if (r.status !== "ok") return;
  assert.equal(src.slice(r.start, r.end), "brown");
  assert.equal(r.repaired, true);
});

test("duplicate exact disambiguated by prefix/suffix context", () => {
  const src = "a cat sat. a cat ran.";
  // Two "cat"; the suffix " ran" picks the second one.
  const r = resolveAnchor(anchor({ exact: "cat", prefix: "a ", suffix: " ran" }), src);
  assert.equal(r.status, "ok");
  if (r.status !== "ok") return;
  assert.equal(r.start, 13);
  assert.equal(src.slice(r.start, r.end), "cat");
  assert.equal(src.slice(r.end, r.end + 4), " ran");
});

test("duplicate exact, ambiguous context, position present: nearest wins", () => {
  const src = "cat ... cat"; // occurrences at 0 and 8
  const r = resolveAnchor(
    anchor({ exact: "cat", position: { start: 7, end: 10 } }),
    src,
  );
  assert.equal(r.status, "ok");
  if (r.status !== "ok") return;
  assert.equal(r.start, 8); // nearest to position.start = 7
});

test("duplicate exact, no disambiguator at all: needs-reanchor, never a guess", () => {
  const src = "cat and cat";
  const r = resolveAnchor(anchor({ exact: "cat" }), src);
  assert.deepEqual(r, { status: "needs-reanchor" });
});

test("whitespace-reflowed source still resolves (normalized match)", () => {
  // Quote was captured as one line; the source has since been re-wrapped.
  const src = "intro\nthe quick\nbrown   fox\nend";
  const r = resolveAnchor(anchor({ exact: "the quick brown fox" }), src);
  assert.equal(r.status, "ok");
  if (r.status !== "ok") return;
  // Contract: the resolved raw span, normalized, equals the normalized quote.
  assert.equal(
    normalizeForMatch(src.slice(r.start, r.end)),
    normalizeForMatch("the quick brown fox"),
  );
  assert.equal(r.repaired, true);
});

test("text genuinely gone: needs-reanchor", () => {
  const src = "completely different content here";
  const r = resolveAnchor(anchor({ exact: "the quick brown fox" }), src);
  assert.deepEqual(r, { status: "needs-reanchor" });
});

test("empty source: needs-reanchor", () => {
  assert.deepEqual(
    resolveAnchor(anchor({ exact: "anything" }), ""),
    { status: "needs-reanchor" },
  );
});

test("normalizeForMatch collapses whitespace and trims", () => {
  assert.equal(normalizeForMatch("  a\t b\n\n c  "), "a b c");
});

test("normalizeForMatch strips emphasis, code, and heading syntax", () => {
  assert.equal(normalizeForMatch("**bold** and `code`"), "bold and code");
  assert.equal(normalizeForMatch("# Heading ~~x~~"), "Heading x");
  assert.equal(normalizeForMatch("__a__ _b_"), "a b");
});

test("normalizeForMatch is idempotent", () => {
  const once = normalizeForMatch("##  *Hello*   World  ");
  assert.equal(normalizeForMatch(once), once);
});
