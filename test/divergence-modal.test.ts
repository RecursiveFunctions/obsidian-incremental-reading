/**
 * Golden contract for src/ir/divergence-modal.ts (DESIGN.md §5 picker UI).
 *
 * Pure decision/config builder for the multi-scheduler picker modal.
 * Reuses the existing `diverges` predicate semantics from
 * src/scheduler.ts but does NOT run schedulers itself — the maintainer-
 * owned dispatcher in src/review.ts feeds in pre-computed member
 * intervals. Claude-authored, fenced out of the delegated scope.
 * Skips until the module exists; computed specifier keeps tsc green.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const SPEC = ["..", "src", "ir", "divergence-modal.ts"].join("/");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function load(): Promise<any> {
  try {
    return await import(SPEC);
  } catch {
    return null;
  }
}

const T0 = 1_700_000_000_000;

function mkMember(id: string, intervalDays: number, due = T0) {
  return { id, intervalDays, due };
}

test("returns null when fewer than two finite-positive intervals", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/divergence-modal.ts not implemented yet");

  // Single member.
  const r1 = m.buildDivergenceModal({
    members: [mkMember("fsrs", 10)],
    primaryId: "fsrs",
    threshold: 1.5,
    floorDays: 0,
  });
  assert.equal(r1, null);

  // Two members, one is zero/negative/non-finite.
  const r2 = m.buildDivergenceModal({
    members: [mkMember("fsrs", 10), mkMember("sm2", 0)],
    primaryId: "fsrs",
    threshold: 1.5,
    floorDays: 0,
  });
  assert.equal(r2, null);
});

test("returns null when max interval is below floorDays", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/divergence-modal.ts not implemented yet");
  const r = m.buildDivergenceModal({
    members: [mkMember("fsrs", 2), mkMember("sm2", 5)],
    primaryId: "fsrs",
    threshold: 1.5,
    floorDays: 7,
  });
  assert.equal(r, null);
});

test("returns null when max/min ratio is at or below threshold", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/divergence-modal.ts not implemented yet");
  // 12 / 10 = 1.2 <= 1.5
  const r = m.buildDivergenceModal({
    members: [mkMember("fsrs", 10), mkMember("sm2", 12)],
    primaryId: "fsrs",
    threshold: 1.5,
    floorDays: 0,
  });
  assert.equal(r, null);
});

test("returns config when ratio exceeds threshold AND max >= floor", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/divergence-modal.ts not implemented yet");
  const r = m.buildDivergenceModal({
    members: [
      mkMember("fsrs-default", 10),
      mkMember("fsrs-tuned", 14),
      mkMember("sm2", 30),
    ],
    primaryId: "fsrs-default",
    threshold: 1.5,
    floorDays: 7,
  });
  assert.ok(r !== null, "expected a divergence config");
  assert.equal(r.primaryId, "fsrs-default");
  assert.equal(r.primaryInterval, 10);
});

test("members are sorted by id ascending for deterministic display order", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/divergence-modal.ts not implemented yet");
  const r = m.buildDivergenceModal({
    members: [
      mkMember("sm2", 30),
      mkMember("fsrs-default", 10),
      mkMember("fsrs-tuned", 14),
    ],
    primaryId: "fsrs-default",
    threshold: 1.5,
    floorDays: 0,
  });
  assert.ok(r !== null);
  const ids = r.members.map((x: { id: string }) => x.id);
  assert.deepEqual(ids, ["fsrs-default", "fsrs-tuned", "sm2"]);
});

test("ratioVsPrimary is intervalDays / primaryInterval", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/divergence-modal.ts not implemented yet");
  const r = m.buildDivergenceModal({
    members: [
      mkMember("fsrs-default", 10),
      mkMember("fsrs-tuned", 20),
      mkMember("sm2", 30),
    ],
    primaryId: "fsrs-default",
    threshold: 1.5,
    floorDays: 0,
  });
  assert.ok(r !== null);
  const byId = Object.fromEntries(r.members.map((x: { id: string; ratioVsPrimary: number }) => [x.id, x.ratioVsPrimary]));
  assert.equal(byId["fsrs-default"], 1);
  assert.equal(byId["fsrs-tuned"], 2);
  assert.equal(byId["sm2"], 3);
});

test("returns null when the named primaryId is not among members", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/divergence-modal.ts not implemented yet");
  const r = m.buildDivergenceModal({
    members: [mkMember("fsrs", 10), mkMember("sm2", 30)],
    primaryId: "does-not-exist",
    threshold: 1.5,
    floorDays: 0,
  });
  assert.equal(r, null);
});

test("non-finite or non-positive member intervals are excluded from the ratio test", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/divergence-modal.ts not implemented yet");
  // primary=10, junk=Infinity (excluded), sm2=30 -> ratio 3 > 1.5
  const r = m.buildDivergenceModal({
    members: [
      mkMember("fsrs", 10),
      mkMember("junk", Number.POSITIVE_INFINITY),
      mkMember("sm2", 30),
    ],
    primaryId: "fsrs",
    threshold: 1.5,
    floorDays: 0,
  });
  assert.ok(r !== null, "expected a divergence config");
  // Junk member must NOT appear in the config (excluded entirely).
  const ids = r.members.map((x: { id: string }) => x.id);
  assert.ok(!ids.includes("junk"), `junk member should be excluded; got ${JSON.stringify(ids)}`);
});

test("message is a non-empty string", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/divergence-modal.ts not implemented yet");
  const r = m.buildDivergenceModal({
    members: [mkMember("fsrs", 10), mkMember("sm2", 30)],
    primaryId: "fsrs",
    threshold: 1.5,
    floorDays: 0,
  });
  assert.ok(r !== null);
  assert.equal(typeof r.message, "string");
  assert.ok(r.message.length > 0);
});

test("identical inputs produce a deep-equal config (determinism)", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/divergence-modal.ts not implemented yet");
  const input = {
    members: [
      mkMember("fsrs-default", 10),
      mkMember("fsrs-tuned", 14),
      mkMember("sm2", 30),
    ],
    primaryId: "fsrs-default",
    threshold: 1.5,
    floorDays: 0,
  };
  const a = m.buildDivergenceModal(input);
  const b = m.buildDivergenceModal(input);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test("does not mutate its input members array", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/divergence-modal.ts not implemented yet");
  const members = [
    mkMember("sm2", 30),
    mkMember("fsrs-default", 10),
    mkMember("fsrs-tuned", 14),
  ];
  const snap = JSON.parse(JSON.stringify(members));
  m.buildDivergenceModal({
    members,
    primaryId: "fsrs-default",
    threshold: 1.5,
    floorDays: 0,
  });
  assert.deepEqual(members, snap, "input members array must not be mutated");
});
