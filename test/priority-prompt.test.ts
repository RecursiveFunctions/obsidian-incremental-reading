import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCandidatePriority } from "../src/priority-prompt";

test("parseCandidatePriority: empty string returns null", () => {
  assert.equal(parseCandidatePriority(""), null);
});

test("parseCandidatePriority: whitespace-only returns null", () => {
  assert.equal(parseCandidatePriority("   "), null);
});

test("parseCandidatePriority: non-numeric returns null", () => {
  assert.equal(parseCandidatePriority("abc"), null);
});

test("parseCandidatePriority: NaN returns null", () => {
  assert.equal(parseCandidatePriority("NaN"), null);
});

test("parseCandidatePriority: Infinity returns null", () => {
  assert.equal(parseCandidatePriority("Infinity"), null);
});

test("parseCandidatePriority: valid integer in range", () => {
  assert.equal(parseCandidatePriority("42"), 42);
});

test("parseCandidatePriority: valid integer with whitespace", () => {
  assert.equal(parseCandidatePriority("  42  "), 42);
});

test("parseCandidatePriority: zero (minimum)", () => {
  assert.equal(parseCandidatePriority("0"), 0);
});

test("parseCandidatePriority: 100 (maximum)", () => {
  assert.equal(parseCandidatePriority("100"), 100);
});

test("parseCandidatePriority: negative clamped to 0", () => {
  assert.equal(parseCandidatePriority("-5"), 0);
});

test("parseCandidatePriority: over 100 clamped to 100", () => {
  assert.equal(parseCandidatePriority("150"), 100);
});

test("parseCandidatePriority: fractional value passes through clamp", () => {
  const result = parseCandidatePriority("33.7");
  assert.ok(result !== null);
  assert.ok(result >= 0 && result <= 100);
});
