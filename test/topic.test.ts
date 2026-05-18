import { test } from "node:test";
import assert from "node:assert/strict";
import {
  advanceTopic,
  laterToday,
  newTopicState,
  readTopicFromFrontmatter,
  writeTopicToFrontmatter,
} from "../src/topic";
import { IR_KEYS } from "../src/types";

const SETTINGS = {
  topicFirstInterval: 1,
  topicAFactor: 2,
  topicMaxInterval: 100,
};
const NOW = new Date("2026-05-17T12:00:00.000Z");
const DAY = 86_400_000;

test("a new topic is due now, no interval, settings A-Factor", () => {
  const s = newTopicState(SETTINGS, NOW);
  assert.equal(s.dueMs, NOW.getTime());
  assert.equal(s.interval, 0);
  assert.equal(s.aFactor, 2);
});

test("first Next uses the first interval; later Nexts multiply by A-Factor", () => {
  let s = newTopicState(SETTINGS, NOW);

  s = advanceTopic(s, SETTINGS, NOW);
  assert.equal(s.interval, 1);
  assert.equal(s.dueMs, NOW.getTime() + 1 * DAY);

  s = advanceTopic(s, SETTINGS, NOW);
  assert.equal(s.interval, 2);

  s = advanceTopic(s, SETTINGS, NOW);
  assert.equal(s.interval, 4);

  s = advanceTopic(s, SETTINGS, NOW);
  assert.equal(s.interval, 8);
});

test("interval is capped at topicMaxInterval", () => {
  let s = { dueMs: NOW.getTime(), interval: 80, aFactor: 2 };
  s = advanceTopic(s, SETTINGS, NOW);
  assert.equal(s.interval, 100); // 160 clamped to max 100
  assert.equal(s.dueMs, NOW.getTime() + 100 * DAY);
});

test("per-element A-Factor overrides the settings default", () => {
  let s = { dueMs: NOW.getTime(), interval: 10, aFactor: 3 };
  s = advanceTopic(s, SETTINGS, NOW);
  assert.equal(s.interval, 30);
});

test("a degenerate A-Factor (<= 1) falls back so the interval still grows", () => {
  let s = { dueMs: NOW.getTime(), interval: 4, aFactor: 1 };
  s = advanceTopic(s, SETTINGS, NOW);
  assert.equal(s.interval, 8); // fell back to settings A-Factor 2
});

test("Later today postpones without touching interval or A-Factor", () => {
  const s = { dueMs: NOW.getTime() - DAY, interval: 9, aFactor: 2.5 };
  const l = laterToday(s, NOW);
  assert.equal(l.interval, 9);
  assert.equal(l.aFactor, 2.5);
  assert.ok(l.dueMs > NOW.getTime());
  assert.ok(l.dueMs <= NOW.getTime() + 60 * 60_000);
});

test("frontmatter round-trips", () => {
  const fm: Record<string, unknown> = {};
  const s = advanceTopic(newTopicState(SETTINGS, NOW), SETTINGS, NOW);
  writeTopicToFrontmatter(fm, s);
  assert.equal(typeof fm[IR_KEYS.due], "string");
  assert.equal(fm[IR_KEYS.interval], 1);
  assert.equal(fm[IR_KEYS.aFactor], 2);

  const back = readTopicFromFrontmatter(fm, SETTINGS, NOW);
  assert.equal(back.interval, 1);
  assert.equal(back.aFactor, 2);
  assert.equal(back.dueMs, s.dueMs);
});

test("an old topic with only ir-due (stale FSRS keys) reads as interval 0", () => {
  // Migration path: a topic seeded before the topic model existed still has
  // an ir-due and leftover FSRS keys but no ir-interval. It must read as a
  // fresh schedule so its first Next seeds the interval cleanly.
  const fm = {
    [IR_KEYS.due]: "2026-01-01T00:00:00.000Z",
    [IR_KEYS.state]: 2,
    [IR_KEYS.reps]: 5,
  };
  const s = readTopicFromFrontmatter(fm, SETTINGS, NOW);
  assert.equal(s.interval, 0);
  assert.equal(s.aFactor, 2);

  const advanced = advanceTopic(s, SETTINGS, NOW);
  assert.equal(advanced.interval, 1);
});

test("garbage frontmatter falls back to a sane new schedule", () => {
  const s = readTopicFromFrontmatter(
    { [IR_KEYS.interval]: "nope", [IR_KEYS.aFactor]: -3 },
    SETTINGS,
    NOW,
  );
  assert.equal(s.interval, 0);
  assert.equal(s.aFactor, 2);
});
