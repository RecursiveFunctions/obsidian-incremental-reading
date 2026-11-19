import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyDrillGrade,
  emptyDrillState,
  enqueueDrillElement,
  gradePassesDrill,
  normalizeDrillState,
  orderDrillIds,
  removeDrillElement,
  shouldEnqueueForDrill,
} from "../src/ir/drill";
import { IrLedger, META, type VaultFs } from "../src/ir/ledger";
import type { ElementId } from "../src/ir/ids";
import type { IrElement } from "../src/ir/model";

const id = (v: string) => v as ElementId;

function makeItem(
  elementId: string,
  overrides: Partial<IrElement> = {},
): IrElement {
  return {
    id: id(elementId),
    type: "item",
    priority: 40,
    parentId: null,
    dismissed: false,
    created: 1_000,
    text: "Q {{c1::A}}",
    anchorState: "ok",
    ...overrides,
  };
}

function memFs(): VaultFs & { dump(): Map<string, string> } {
  const files = new Map<string, string>();
  return {
    dump: () => files,
    async exists(p) {
      return files.has(p);
    },
    async read(p) {
      const v = files.get(p);
      if (v === undefined) throw new Error(`ENOENT ${p}`);
      return v;
    },
    async write(p, data) {
      files.set(p, data);
    },
    async append(p, data) {
      files.set(p, (files.get(p) ?? "") + data);
    },
    async list(dir) {
      const pre = dir.endsWith("/") ? dir : `${dir}/`;
      const out: string[] = [];
      for (const k of files.keys()) {
        if (k.startsWith(pre) && !k.slice(pre.length).includes("/")) out.push(k);
      }
      return out;
    },
  };
}

test("shouldEnqueueForDrill and gradePassesDrill match SM20 < Good threshold and again-only mode", () => {
  assert.equal(shouldEnqueueForDrill("again", "again-and-hard"), true);
  assert.equal(shouldEnqueueForDrill("hard", "again-and-hard"), true);
  assert.equal(shouldEnqueueForDrill("good", "again-and-hard"), false);
  assert.equal(shouldEnqueueForDrill("easy", "again-and-hard"), false);

  assert.equal(gradePassesDrill("again", "again-and-hard"), false);
  assert.equal(gradePassesDrill("hard", "again-and-hard"), false);
  assert.equal(gradePassesDrill("good", "again-and-hard"), true);
  assert.equal(gradePassesDrill("easy", "again-and-hard"), true);

  assert.equal(shouldEnqueueForDrill("hard", "again"), false);
  assert.equal(gradePassesDrill("hard", "again"), true);
  assert.equal(shouldEnqueueForDrill("again", "off"), false);
});

test("enqueueDrillElement deduplicates, applyDrillGrade rotates failures and removes passes", () => {
  let state = emptyDrillState("2026-11-19");
  state = enqueueDrillElement(state, id("a")).state;
  state = enqueueDrillElement(state, id("b")).state;
  const dup = enqueueDrillElement(state, id("a"));
  assert.equal(dup.added, false);
  assert.deepEqual(dup.state.elementIds, [id("a"), id("b")]);

  const failed = applyDrillGrade(dup.state, id("a"), "hard", "again-and-hard");
  assert.equal(failed.passed, false);
  assert.deepEqual(failed.state.elementIds, [id("b"), id("a")]);

  const passed = applyDrillGrade(failed.state, id("b"), "good", "again-and-hard");
  assert.equal(passed.passed, true);
  assert.deepEqual(passed.state.elementIds, [id("a")]);

  const removed = removeDrillElement(passed.state, id("a"));
  assert.deepEqual(removed.elementIds, []);
});

test("normalizeDrillState clears stale-day drill and prunes deleted, dismissed, and topic elements", () => {
  const elements = new Map<ElementId, IrElement>([
    [id("live"), makeItem("live")],
    [id("dismissed"), makeItem("dismissed", { dismissed: true })],
    [id("topic"), makeItem("topic", { type: "topic" })],
  ]);
  const raw = {
    schemaVersion: 1 as const,
    dayKey: "2026-11-19",
    elementIds: [id("live"), id("deleted"), id("dismissed"), id("topic"), id("live")],
  };
  assert.deepEqual(normalizeDrillState(raw, "2026-11-19", elements).elementIds, [id("live")]);
  assert.deepEqual(normalizeDrillState(raw, "2026-11-20", elements).elementIds, []);
});

test("orderDrillIds preserves order when randomize=false and shuffles deterministically with seeded rng", () => {
  const input = [id("a"), id("b"), id("c"), id("d")];
  assert.deepEqual(orderDrillIds(input, false), input);
  let seed = 7;
  const rng = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const shuffled = orderDrillIds(input, true, rng);
  assert.equal(shuffled.length, 4);
  assert.deepEqual([...shuffled].sort(), [...input].sort());
});

test("IrLedger.readDrill and writeDrill scope drill.json to the active ledger generation", async () => {
  const fs = memFs();
  const ledger = new IrLedger(fs);
  await ledger.init();

  let drill = await ledger.readDrill("2026-11-19");
  assert.deepEqual(drill.elementIds, []);

  drill = enqueueDrillElement(drill, id("item_1")).state;
  await ledger.writeDrill(drill);
  assert.deepEqual((await ledger.readDrill("2026-11-19")).elementIds, [id("item_1")]);
  assert.deepEqual((await ledger.readDrill("2026-11-20")).elementIds, []);

  await fs.write(
    META,
    JSON.stringify({ schemaVersion: 1, migration: "complete", generation: "gen_2" }),
  );
  const nextGenLedger = new IrLedger(fs);
  await nextGenLedger.init();
  assert.deepEqual((await nextGenLedger.readDrill("2026-11-19")).elementIds, []);
});
