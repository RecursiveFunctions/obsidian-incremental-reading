import assert from "node:assert/strict";
import { test } from "node:test";
import { S_MIN } from "ts-fsrs";
import { readCardFromFrontmatter, schedule } from "../src/fsrs";
import { IR_KEYS } from "../src/types";

const NOW = new Date("2026-03-04T00:00:00.000Z");

function fm(values: Record<string, unknown>): Record<string, unknown> {
  return { [IR_KEYS.due]: "2026-03-03T00:00:00.000Z", ...values };
}

test("out-of-range card state falls back to New and cannot crash grading", () => {
  const card = readCardFromFrontmatter(fm({ [IR_KEYS.state]: 99, [IR_KEYS.stability]: 5, [IR_KEYS.difficulty]: 5 }));
  assert.equal(card.state, 0);
  const result = schedule(card, "good", NOW);
  assert.equal(result.state >= 0, true);
});

test("negative card state falls back to New", () => {
  const card = readCardFromFrontmatter(fm({ [IR_KEYS.state]: -1 }));
  assert.equal(card.state, 0);
});

test("fractional card state falls back to New", () => {
  const card = readCardFromFrontmatter(fm({ [IR_KEYS.state]: 1.5 }));
  assert.equal(card.state, 0);
});

test("negative review stability is clamped and cannot crash grading", () => {
  const card = readCardFromFrontmatter(fm({ [IR_KEYS.state]: 2, [IR_KEYS.stability]: -5, [IR_KEYS.difficulty]: 5 }));
  assert.equal(card.stability, S_MIN);
  const result = schedule(card, "good", NOW);
  assert.equal(result.state >= 0, true);
});

test("legitimate small review stability is preserved", () => {
  const card = readCardFromFrontmatter(fm({ [IR_KEYS.state]: 2, [IR_KEYS.stability]: 0.1, [IR_KEYS.difficulty]: 5 }));
  assert.equal(card.stability, 0.1);
});

test("negative difficulty is clamped to the valid range", () => {
  const card = readCardFromFrontmatter(fm({ [IR_KEYS.state]: 2, [IR_KEYS.stability]: 5, [IR_KEYS.difficulty]: -10 }));
  assert.equal(card.difficulty >= 1, true);
  assert.equal(card.difficulty <= 10, true);
});

test("huge review stability is clamped", () => {
  const card = readCardFromFrontmatter(fm({ [IR_KEYS.state]: 2, [IR_KEYS.stability]: 1e300, [IR_KEYS.difficulty]: 5 }));
  assert.equal(card.stability <= 36500, true);
});

test("difficulty above ten is clamped", () => {
  const card = readCardFromFrontmatter(fm({ [IR_KEYS.state]: 2, [IR_KEYS.stability]: 5, [IR_KEYS.difficulty]: 99 }));
  assert.equal(card.difficulty <= 10, true);
});

test("legitimate New card zero stability and difficulty are preserved", () => {
  const card = readCardFromFrontmatter(fm({ [IR_KEYS.state]: 0, [IR_KEYS.stability]: 0, [IR_KEYS.difficulty]: 0 }));
  assert.equal(card.stability, 0);
  assert.equal(card.difficulty, 0);
  const result = schedule(card, "good", NOW);
  assert.equal(result.state >= 0, true);
});

test("review states one through three survive the sanitizer", () => {
  for (const state of [1, 2, 3]) {
    const card = readCardFromFrontmatter(fm({ [IR_KEYS.state]: state, [IR_KEYS.stability]: 5, [IR_KEYS.difficulty]: 5 }));
    assert.equal(card.state, state);
  }
});
