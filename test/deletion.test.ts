/**
 * Golden contract for src/ir/deletion.ts (DESIGN.md Q1 "Source deletion
 * behavior": tombstone, never cascade-delete, reparent to grandparent,
 * auto-promote genuinely-rootless detached extracts).
 *
 * Pure planner over the model; asserted by folding its output through
 * the real fold. Claude-authored, fenced out of scope. Skips until the
 * module exists; computed specifier keeps tsc green.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { fold } from "../src/ir/log";
import { newElement } from "../src/ir/model";
import type { IrElement, IrEvent } from "../src/ir/model";
import type { ElementId, EventId, DeviceId } from "../src/ir/ids";

const SPEC = ["..", "src", "ir", "deletion.ts"].join("/");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function load(): Promise<any> {
  try {
    return await import(SPEC);
  } catch {
    return null;
  }
}

const SRC_PATH = "Notes/Source.md";
const NOW = 1_700_000_000_000;

function anchored(sourcePath: string) {
  return {
    sourcePath,
    quote: { exact: "q", prefix: "", suffix: "" },
    position: { start: 0, end: 1 },
  };
}

// el_src is the deleted note. ex1 (anchored, child of src), ex2 (anchored,
// child of ex1), it1 (item child of ex1), unrel (anchored to a DIFFERENT
// note, must be untouched).
function world(): IrElement[] {
  return [
    newElement({
      id: "el_src" as ElementId,
      type: "topic",
      priority: 50,
      parentId: null,
      notePath: SRC_PATH,
      now: 0,
    }),
    newElement({
      id: "el_ex1" as ElementId,
      type: "extract",
      priority: 50,
      parentId: "el_src" as ElementId,
      anchor: anchored(SRC_PATH),
      now: 0,
    }),
    newElement({
      id: "el_ex2" as ElementId,
      type: "extract",
      priority: 50,
      parentId: "el_ex1" as ElementId,
      anchor: anchored(SRC_PATH),
      now: 0,
    }),
    newElement({
      id: "el_it1" as ElementId,
      type: "item",
      priority: 50,
      parentId: "el_ex1" as ElementId,
      now: 0,
    }),
    newElement({
      id: "el_unrel" as ElementId,
      type: "extract",
      priority: 50,
      parentId: null,
      anchor: anchored("Other.md"),
      now: 0,
    }),
  ];
}

function seedEvents(els: IrElement[]): IrEvent[] {
  return els.map((e, i) => ({
    id: `ev_seed_${e.id}` as EventId,
    ts: 1,
    lamport: i + 1,
    device: "dev_seed" as DeviceId,
    kind: "element-created" as const,
    target: e.id,
    payload: { element: e },
  }));
}

function plan(m: { planSourceDeletion: (...a: unknown[]) => IrEvent[] }) {
  const els = world();
  return m.planSourceDeletion(
    els,
    SRC_PATH,
    "Source",
    NOW,
    100, // startLamport, strictly above the seed lamports
    "dev_test" as DeviceId,
    (i: number) => `ev_del_${i}` as EventId,
    (el: IrElement) => `Promoted/${el.id}.md`,
    { autoPromoteRootless: true },
  );
}

test("writes a source tombstone, never a null", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/deletion.ts not implemented yet");

  const st = fold([...seedEvents(world()), ...plan(m)]);
  const tomb = st.tombstones.get(SRC_PATH);
  assert.ok(tomb);
  assert.deepEqual(tomb, {
    path: SRC_PATH,
    title: "Source",
    deletedAt: NOW,
  });
});

test("the source element is removed; extracts are never cascade-deleted", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/deletion.ts not implemented yet");

  const st = fold([...seedEvents(world()), ...plan(m)]);
  assert.equal(st.elements.has("el_src" as ElementId), false);
  assert.equal(st.elements.has("el_ex1" as ElementId), true);
  assert.equal(st.elements.has("el_ex2" as ElementId), true);
  assert.equal(st.elements.has("el_it1" as ElementId), true);
});

test("child of the source reparents to the grandparent and detaches", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/deletion.ts not implemented yet");

  const ex1 = fold([...seedEvents(world()), ...plan(m)]).elements.get(
    "el_ex1" as ElementId,
  )!;
  assert.equal(ex1.parentId, null); // src's parent was null (grandparent)
  assert.equal(ex1.anchorState, "detached");
});

test("genuinely rootless detached extract auto-promotes", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/deletion.ts not implemented yet");

  const ex1 = fold([...seedEvents(world()), ...plan(m)]).elements.get(
    "el_ex1" as ElementId,
  )!;
  assert.equal(ex1.notePath, "Promoted/el_ex1.md");
});

test("non-rootless detached extract is detached but not promoted", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/deletion.ts not implemented yet");

  const ex2 = fold([...seedEvents(world()), ...plan(m)]).elements.get(
    "el_ex2" as ElementId,
  )!;
  assert.equal(ex2.anchorState, "detached");
  assert.equal(ex2.parentId, "el_ex1"); // still parented under ex1
  assert.equal(ex2.notePath, undefined);
});

test("elements anchored to a different note are untouched", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/deletion.ts not implemented yet");

  const st = fold([...seedEvents(world()), ...plan(m)]);
  const unrel = st.elements.get("el_unrel" as ElementId)!;
  assert.equal(unrel.anchorState, "ok");
  assert.equal(unrel.notePath, undefined);
  const it1 = st.elements.get("el_it1" as ElementId)!;
  assert.equal(it1.anchorState, "ok");
  assert.equal(it1.parentId, "el_ex1");
});

test("deterministic (byte-identical plan on re-run)", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/deletion.ts not implemented yet");

  assert.equal(JSON.stringify(plan(m)), JSON.stringify(plan(m)));
});

test("relinkCandidates lists extracts still pointing at the tombstone", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/deletion.ts not implemented yet");

  const st = fold([...seedEvents(world()), ...plan(m)]);
  const cands = m.relinkCandidates(
    Array.from(st.elements.values()),
    SRC_PATH,
  ) as IrElement[];
  assert.deepEqual(
    cands.map((e) => e.id).sort(),
    ["el_ex1", "el_ex2"],
  );
});

test("planSourceRelink repairs anchors and source-restored drops the tombstone", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/deletion.ts not implemented yet");

  const afterDel = fold([...seedEvents(world()), ...plan(m)]);
  const relink = m.planSourceRelink(
    Array.from(afterDel.elements.values()),
    SRC_PATH,
    SRC_PATH,
    NOW + 1,
    200,
    "dev_test" as DeviceId,
    (i: number) => `ev_relink_${i}` as EventId,
  ) as IrEvent[];
  const st = fold([...seedEvents(world()), ...plan(m), ...relink]);
  assert.equal(st.tombstones.has(SRC_PATH), false);
  const ex1 = st.elements.get("el_ex1" as ElementId)!;
  assert.equal(ex1.anchorState, "ok");
  assert.equal(ex1.anchor?.sourcePath, SRC_PATH);
  const ex2 = st.elements.get("el_ex2" as ElementId)!;
  assert.equal(ex2.anchorState, "ok");
  assert.equal(ex2.anchor?.sourcePath, SRC_PATH);
  const unrel = st.elements.get("el_unrel" as ElementId)!;
  assert.equal(unrel.anchor?.sourcePath, "Other.md");
});

test("autoPromoteRootless false detaches without creating notes", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/deletion.ts not implemented yet");

  const els = world();
  const events = m.planSourceDeletion(
    els,
    SRC_PATH,
    "Source",
    NOW,
    100,
    "dev_test" as DeviceId,
    (i: number) => `ev_det_${i}` as EventId,
    (el: IrElement) => `Promoted/${el.id}.md`,
    { autoPromoteRootless: false },
  ) as IrEvent[];
  const st = fold([...seedEvents(world()), ...events]);
  const ex1 = st.elements.get("el_ex1" as ElementId)!;
  assert.equal(ex1.anchorState, "detached");
  assert.equal(ex1.notePath, undefined);
  assert.equal(
    events.filter((e) => e.kind === "promoted").length,
    0,
  );
});

test("missingSourcePaths lists gone notes that have no tombstone", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/deletion.ts not implemented yet");

  const els = world();
  const vault = new Set(["Other.md"]);
  const missing = m.missingSourcePaths(
    els,
    [],
    (p: string) => vault.has(p),
  ) as string[];
  assert.deepEqual(missing, [SRC_PATH]);
});

test("missingSourcePaths skips tombstoned paths", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/deletion.ts not implemented yet");

  const missing = m.missingSourcePaths(
    world(),
    [SRC_PATH],
    (p: string) => p === "Other.md",
  ) as string[];
  assert.deepEqual(missing, []);
});

test("planSourceTombstoneOnly writes a tombstone and leaves the tree", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/deletion.ts not implemented yet");

  const events = m.planSourceTombstoneOnly(
    world(),
    SRC_PATH,
    "Source",
    NOW,
    100,
    "dev_test" as DeviceId,
    (i: number) => `ev_tomb_${i}` as EventId,
  ) as IrEvent[];
  const st = fold([...seedEvents(world()), ...events]);
  assert.ok(st.tombstones.get(SRC_PATH));
  assert.equal(st.elements.has("el_src" as ElementId), true);
  const ex1 = st.elements.get("el_ex1" as ElementId)!;
  assert.equal(ex1.anchorState, "ok");
  assert.equal(ex1.parentId, "el_src");
});

test("planUndoSourceDeletion restores the tree, drops promoted notes, keeps the tombstone", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/deletion.ts not implemented yet");

  const before = world();
  const deletion = plan(m);
  const undo = m.planUndoSourceDeletion(
    before,
    deletion,
    NOW + 1,
    200,
    "dev_test" as DeviceId,
    (i: number) => `ev_undo_${i}` as EventId,
  ) as IrEvent[];
  const st = fold([...seedEvents(before), ...deletion, ...undo]);
  assert.ok(st.tombstones.get(SRC_PATH));
  assert.equal(st.elements.has("el_src" as ElementId), true);
  const ex1 = st.elements.get("el_ex1" as ElementId)!;
  assert.equal(ex1.parentId, "el_src");
  assert.equal(ex1.anchorState, "ok");
  assert.equal(ex1.notePath, undefined);
  const ex2 = st.elements.get("el_ex2" as ElementId)!;
  assert.equal(ex2.parentId, "el_ex1");
  assert.equal(ex2.anchorState, "ok");
});

test("planClearTombstone drops the tombstone without repairing anchors", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/deletion.ts not implemented yet");

  const afterDel = fold([...seedEvents(world()), ...plan(m)]);
  const cleared = m.planClearTombstone(
    SRC_PATH,
    "el_ex1" as ElementId,
    NOW + 1,
    200,
    "dev_test" as DeviceId,
    (i: number) => `ev_clear_${i}` as EventId,
  ) as IrEvent[];
  const st = fold([...seedEvents(world()), ...plan(m), ...cleared]);
  assert.equal(st.tombstones.has(SRC_PATH), false);
  const ex1 = st.elements.get("el_ex1" as ElementId)!;
  assert.equal(ex1.anchorState, "detached");
});
