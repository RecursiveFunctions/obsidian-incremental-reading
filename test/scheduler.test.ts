/**
 * Golden contract for src/scheduler.ts (DESIGN.md section 5: the
 * multi-scheduler ensemble's classic SM-2 member + the divergence
 * metric). FSRS stays the primary; this is a pure shadow scheduler and
 * the ratio test used to decide when the picker is worth surfacing.
 *
 * Claude-authored, fenced out of scope. Skips until the module exists;
 * computed specifier keeps tsc green. Vectors are hand-computed from the
 * canonical SM-2 update and verified against a reference impl.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const SPEC = ["..", "src", "scheduler.ts"].join("/");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function load(): Promise<any> {
  try {
    return await import(SPEC);
  } catch {
    return null;
  }
}

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;
const fresh = () => ({ repetitions: 0, easeFactor: 2.5, intervalDays: 0 });

test("sm2: first 'good' -> interval 1 day, EF unchanged at 2.5", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/scheduler.ts not implemented yet");

  const p = m.sm2.predict(fresh(), "good", NOW);
  assert.equal(p.intervalDays, 1);
  assert.equal(p.due, NOW + 1 * DAY);
  assert.deepEqual(p.nextState, {
    repetitions: 1,
    easeFactor: 2.5,
    intervalDays: 1,
  });
});

test("sm2: 'good' progression 1 -> 6 -> round(6*EF)", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/scheduler.ts not implemented yet");

  const s2 = m.sm2.predict(
    { repetitions: 1, easeFactor: 2.5, intervalDays: 1 },
    "good",
    NOW,
  );
  assert.equal(s2.intervalDays, 6);
  assert.equal(s2.nextState.repetitions, 2);

  const s3 = m.sm2.predict(s2.nextState, "good", NOW);
  assert.equal(s3.intervalDays, 15); // round(6 * 2.5)
  assert.equal(s3.nextState.repetitions, 3);
});

test("sm2: 'easy' on a fresh card raises EF to 2.6", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/scheduler.ts not implemented yet");

  const p = m.sm2.predict(fresh(), "easy", NOW);
  assert.equal(p.intervalDays, 1);
  assert.equal(Math.round(p.nextState.easeFactor * 1e6) / 1e6, 2.6);
});

test("sm2: 'hard' on a fresh card lowers EF to 2.36, still passes", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/scheduler.ts not implemented yet");

  const p = m.sm2.predict(fresh(), "hard", NOW);
  assert.equal(p.intervalDays, 1);
  assert.equal(p.nextState.repetitions, 1);
  assert.equal(Math.round(p.nextState.easeFactor * 1e6) / 1e6, 2.36);
});

test("sm2: 'again' is a lapse -> reps 0, interval 1, EF floored, not below 1.3", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/scheduler.ts not implemented yet");

  const p = m.sm2.predict(
    { repetitions: 3, easeFactor: 2.5, intervalDays: 15 },
    "again",
    NOW,
  );
  assert.equal(p.intervalDays, 1);
  assert.equal(p.nextState.repetitions, 0);
  assert.equal(Math.round(p.nextState.easeFactor * 1e6) / 1e6, 1.7);

  const floored = m.sm2.predict(
    { repetitions: 0, easeFactor: 1.3, intervalDays: 1 },
    "again",
    NOW,
  );
  assert.equal(floored.nextState.easeFactor, 1.3); // never below 1.3
});

test("sm2: deterministic", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/scheduler.ts not implemented yet");
  assert.equal(
    JSON.stringify(m.sm2.predict(fresh(), "good", NOW)),
    JSON.stringify(m.sm2.predict(fresh(), "good", NOW)),
  );
});

test("diverges: ratio over k beyond the floor", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/scheduler.ts not implemented yet");

  assert.equal(m.diverges([10, 25], 2, 7), true); // 25/10 = 2.5 > 2
  assert.equal(m.diverges([10, 15], 2, 7), false); // 1.5 < 2
});

test("diverges: short intervals never nag (below the floor)", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/scheduler.ts not implemented yet");

  assert.equal(m.diverges([1, 4], 2, 7), false); // max 4 < floor 7
});

test("diverges: degenerate inputs are false, not a crash", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/scheduler.ts not implemented yet");

  assert.equal(m.diverges([10], 2, 7), false); // fewer than 2 usable
  assert.equal(m.diverges([0, -3], 2, 7), false); // nothing positive
  assert.equal(m.diverges([20, 0], 2, 7), false); // <2 positive after filter
});
