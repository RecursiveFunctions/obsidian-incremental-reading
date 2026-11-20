/**
 * Spreading activation + neural queue.
 *
 * SuperMemo neural review is subset review ordered by CombinePriority, with
 * real repetitions (including mid-interval / not-yet-due).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { App } from "obsidian";
import {
  capWikilinkNeighbors,
  combinePriority,
  createNeuralQueueState,
  elementIdForNotePath,
  exciteNeuralElement,
  expandNeuralQueueIfNeeded,
  makeLcg,
  needsNeuralExpansion,
  neuralViaLabel,
  neuralWalk,
  neuralWalkDetailed,
  normalizeNeuralQueueState,
  popNextNeuralElement,
  seedNeuralQueueState,
  WIKILINK_DEGREE_CAP,
} from "../src/ir/neural";
import { IrLedger, META, type VaultFs } from "../src/ir/ledger";
import {
  buildNeuralAdjacency,
  emptyLinkIndex,
  neighborsForWalk,
  type NoteLinkIndex,
} from "../src/ir/neural-graph";
import { neuralQueue } from "../src/review";
import { newElement } from "../src/ir/model";
import type { IrElement } from "../src/ir/model";
import type { LogState } from "../src/ir/log";
import type { ElementId } from "../src/ir/ids";
import { isVaultFile } from "../src/ir/vault-file";

const NOW = 1_000_000;
const FUTURE = NOW + 86_400_000;

function eid(s: string): ElementId {
  return s as ElementId;
}

function el(
  id: string,
  extra: Partial<IrElement> & Pick<IrElement, "type">,
): IrElement {
  const base = newElement({
    id: eid(id),
    type: extra.type,
    priority: extra.priority ?? 50,
    parentId: extra.parentId ?? null,
    text: extra.text,
    notePath: extra.notePath,
    now: 0,
  });
  return {
    ...base,
    ...extra,
    id: eid(id),
  };
}

function state(elements: IrElement[]): LogState {
  const map = new Map<ElementId, IrElement>();
  for (const e of elements) map.set(e.id, e);
  return { elements: map, tombstones: new Map() };
}

interface FakeNote {
  path: string;
  basename: string;
  extension: string;
  links: string[];
  tags?: string[];
}

function linkIndex(notes: FakeNote[]): NoteLinkIndex {
  const byPath = new Map(notes.map((n) => [n.path, n]));
  const incoming = new Map<string, string[]>();
  for (const n of notes) {
    for (const dest of n.links) {
      const list = incoming.get(dest) ?? [];
      list.push(n.path);
      incoming.set(dest, list);
    }
  }
  return {
    outgoing: (path) => byPath.get(path)?.links ?? [],
    incoming: (path) => incoming.get(path) ?? [],
    tags: (path) => byPath.get(path)?.tags ?? [],
  };
}

function fakeApp(notes: FakeNote[]): App {
  const byPath = new Map(notes.map((n) => [n.path, n]));
  const resolvedLinks: Record<string, Record<string, number>> = {};
  for (const n of notes) {
    const outgoing: Record<string, number> = {};
    for (const dest of n.links) outgoing[dest] = 1;
    resolvedLinks[n.path] = outgoing;
  }
  return {
    vault: {
      getAbstractFileByPath: (p: string) => byPath.get(p) ?? null,
    },
    metadataCache: {
      getFileCache: (file: { path: string }) => {
        const n = byPath.get(file.path);
        if (!n) return null;
        return { links: n.links.map((link) => ({ link })) };
      },
      getFirstLinkpathDest: (link: string, _from: string) =>
        byPath.get(link) ?? null,
      resolvedLinks,
    },
  } as unknown as App;
}

function walk(
  elements: IrElement[],
  seed: string,
  links: NoteLinkIndex = emptyLinkIndex(),
  graphOpts?: { useTags?: boolean; tagDegreeCap?: number },
): string[] {
  const s = state(elements);
  const adj = buildNeuralAdjacency(s, links, graphOpts);
  return neuralWalk({
    seed,
    priorityOf: (id) => s.elements.get(id as ElementId)?.priority ?? 50,
    neighbors: (id) => neighborsForWalk(adj, id),
    dismissed: (id) => s.elements.get(id as ElementId)?.dismissed === true,
  });
}

test("isVaultFile: notes pass, folders and null do not", () => {
  assert.equal(isVaultFile(null), false);
  assert.equal(isVaultFile({ path: "Folder" }), false);
  assert.equal(
    isVaultFile({ path: "Note.md", extension: "md", basename: "Note" }),
    true,
  );
});

test("CombinePriority matches the published Pascal, not the comment", () => {
  assert.ok(Math.abs(combinePriority(0.2, 0.01) - 0.208) < 1e-9);
  assert.ok(Math.abs(combinePriority(0.2, 0.26) - 0.408) < 1e-9);
  assert.ok(Math.abs(combinePriority(0.2, 0.6) - 0.68) < 1e-9);
});

test("empty seeds yield no scores", () => {
  const q = neuralQueue(
    fakeApp([]),
    state([el("topic", { type: "topic", notePath: "A.md", text: "a" })]),
    null,
    null,
  );
  assert.deepEqual(q.map((s) => s.id), []);
});

test("seed element is first; parent follows via the tree", () => {
  const parent = el("parent", {
    type: "topic",
    notePath: "Root.md",
    text: "root",
  });
  const child = el("child", {
    type: "extract",
    parentId: eid("parent"),
    text: "extract body",
  });
  const seq = walk([parent, child], "child");
  assert.equal(seq[0], "child");
  assert.ok(seq.includes("parent"));
});

test("tree-only graph still walks without wikilinks", () => {
  const root = el("root", { type: "topic", notePath: "R.md", text: "r" });
  const a = el("a", { type: "extract", parentId: eid("root"), text: "a" });
  const b = el("b", { type: "extract", parentId: eid("root"), text: "b" });
  const seq = walk([root, a, b], "a");
  assert.deepEqual(new Set(seq), new Set(["root", "a", "b"]));
});

test("colocated extracts on one source reach each other", () => {
  const extract = el("ex", {
    type: "extract",
    text: "quote",
    anchor: {
      sourcePath: "Article.md",
      quote: { exact: "quote", prefix: "", suffix: "" },
    },
  });
  const sibling = el("sib", {
    type: "extract",
    text: "other",
    anchor: {
      sourcePath: "Article.md",
      quote: { exact: "other", prefix: "", suffix: "" },
    },
  });
  const seq = walk([extract, sibling], "ex");
  assert.equal(seq[0], "ex");
  assert.ok(seq.includes("sib"));
});

test("forward wikilink connects the destination topic", () => {
  const a = el("a", { type: "topic", notePath: "A.md", text: "a" });
  const b = el("b", { type: "topic", notePath: "B.md", text: "b" });
  const notes: FakeNote[] = [
    { path: "A.md", basename: "A", extension: "md", links: ["B.md"] },
    { path: "B.md", basename: "B", extension: "md", links: [] },
  ];
  const seq = walk([a, b], "a", linkIndex(notes));
  assert.equal(seq[0], "a");
  assert.ok(seq.includes("b"));
});

test("backlinks connect the source topic", () => {
  const hub = el("hub", { type: "topic", notePath: "Hub.md", text: "hub" });
  const spoke = el("spoke", {
    type: "topic",
    notePath: "Spoke.md",
    text: "spoke",
  });
  const notes: FakeNote[] = [
    { path: "Hub.md", basename: "Hub", extension: "md", links: [] },
    { path: "Spoke.md", basename: "Spoke", extension: "md", links: ["Hub.md"] },
  ];
  const seq = walk([hub, spoke], "hub", linkIndex(notes));
  assert.ok(seq.includes("spoke"));
});

test("an unmarked bridge note still connects the far IR topic", () => {
  const a = el("a", { type: "topic", notePath: "A.md", text: "a" });
  const b = el("b", { type: "topic", notePath: "B.md", text: "b" });
  const notes: FakeNote[] = [
    { path: "A.md", basename: "A", extension: "md", links: ["Bridge.md"] },
    { path: "Bridge.md", basename: "Bridge", extension: "md", links: ["B.md"] },
    { path: "B.md", basename: "B", extension: "md", links: [] },
  ];
  const seq = walk([a, b], "a", linkIndex(notes));
  assert.ok(seq.includes("b"));
});

test("two unmarked hops in a row do not reach the far IR note", () => {
  const a = el("a", { type: "topic", notePath: "A.md", text: "a" });
  const b = el("b", { type: "topic", notePath: "B.md", text: "b" });
  const notes: FakeNote[] = [
    { path: "A.md", basename: "A", extension: "md", links: ["N1.md"] },
    { path: "N1.md", basename: "N1", extension: "md", links: ["N2.md"] },
    { path: "N2.md", basename: "N2", extension: "md", links: ["B.md"] },
    { path: "B.md", basename: "B", extension: "md", links: [] },
  ];
  const seq = walk([a, b], "a", linkIndex(notes));
  assert.equal(seq.includes("b"), false);
});

test("cycles do not loop forever", () => {
  const a = el("a", {
    type: "topic",
    notePath: "A.md",
    parentId: eid("b"),
    text: "a",
  });
  const b = el("b", {
    type: "topic",
    notePath: "B.md",
    parentId: eid("a"),
    text: "b",
  });
  const seq = walk([a, b], "a");
  assert.equal(seq[0], "a");
  assert.ok(seq.includes("b"));
  assert.equal(seq.length, 2);
});

test("wikilink neighbors emit before siblings of equal element priority", () => {
  const seed = el("seed", {
    type: "topic",
    notePath: "Seed.md",
    text: "seed",
    priority: 50,
  });
  const sib = el("sib", {
    type: "extract",
    parentId: eid("seed"),
    text: "sib",
    priority: 50,
  });
  const linked = el("linked", {
    type: "topic",
    notePath: "Linked.md",
    text: "linked",
    priority: 50,
  });
  const notes: FakeNote[] = [
    { path: "Seed.md", basename: "Seed", extension: "md", links: ["Linked.md"] },
    { path: "Linked.md", basename: "Linked", extension: "md", links: [] },
  ];
  const seq = walk([seed, sib, linked], "seed", linkIndex(notes));
  const iLinked = seq.indexOf("linked");
  const iSib = seq.indexOf("sib");
  assert.ok(iLinked >= 0 && iSib >= 0);
  assert.ok(iLinked < iSib);
});

test("neuralQueue drops dismissed and body-less elements, keeps not-due", () => {
  const due = el("due", {
    type: "item",
    text: "q",
    priority: 50,
    card: {
      due: NOW - 1,
      stability: 1,
      difficulty: 5,
      elapsedDays: 0,
      scheduledDays: 1,
      reps: 1,
      lapses: 0,
      state: 2,
    },
  });
  const future = el("future", {
    type: "item",
    text: "later",
    priority: 50,
    parentId: eid("due"),
    card: {
      due: FUTURE,
      stability: 1,
      difficulty: 5,
      elapsedDays: 0,
      scheduledDays: 1,
      reps: 1,
      lapses: 0,
      state: 2,
    },
  });
  const dismissed = el("gone", {
    type: "item",
    text: "x",
    dismissed: true,
    parentId: eid("due"),
  });
  const ghost = el("ghost", {
    type: "item",
    text: "",
    notePath: "Missing.md",
    parentId: eid("due"),
  });
  const q = neuralQueue(
    fakeApp([]),
    state([due, future, dismissed, ghost]),
    eid("due"),
    null,
  );
  assert.deepEqual(
    q.map((s) => s.id),
    ["due", "future"],
  );
});

test("neuralQueue seed is first; hotter child still follows", () => {
  const seed = el("seed", {
    type: "topic",
    notePath: "Seed.md",
    text: "seed",
    priority: 80,
  });
  const hot = el("hot", {
    type: "extract",
    parentId: eid("seed"),
    text: "hot",
    priority: 10,
  });
  const cold = el("cold", {
    type: "extract",
    parentId: eid("seed"),
    text: "cold",
    priority: 90,
  });
  const q = neuralQueue(
    fakeApp([]),
    state([seed, hot, cold]),
    eid("seed"),
    null,
  );
  assert.equal(q[0]?.id, "seed");
  const rest = q.slice(1).map((s) => s.id);
  assert.deepEqual(rest, ["hot", "cold"]);
});

test("neuralQueue empty when nothing related is reviewable", () => {
  const q = neuralQueue(fakeApp([]), state([]), eid("nope"), null);
  assert.deepEqual(q, []);
});

test("elementIdForNotePath prefers the topic on that path", () => {
  const topic = el("topic", {
    type: "topic",
    notePath: "Topic.md",
    text: "t",
    priority: 80,
  });
  const promoted = el("promo", {
    type: "extract",
    notePath: "Other.md",
    text: "p",
  });
  const s = state([topic, promoted]);
  assert.equal(elementIdForNotePath(s, "Topic.md"), eid("topic"));
  assert.equal(elementIdForNotePath(s, "Other.md"), eid("promo"));
  assert.equal(elementIdForNotePath(s, "Missing.md"), null);
});

test("neuralQueue from a note path seeds the topic, not a hotter extract on it", () => {
  const topic = el("topic", {
    type: "topic",
    notePath: "Topic.md",
    text: "t",
    priority: 80,
  });
  const hot = el("hot", {
    type: "extract",
    parentId: eid("topic"),
    text: "hot",
    priority: 10,
    anchor: {
      sourcePath: "Topic.md",
      quote: { exact: "hot", prefix: "", suffix: "" },
    },
  });
  const app = fakeApp([
    { path: "Topic.md", basename: "Topic", extension: "md", links: [] },
  ]);
  const q = neuralQueue(app, state([topic, hot]), null, "Topic.md");
  assert.equal(q[0]?.id, "topic");
  assert.ok(q.some((s) => s.id === "hot"));
});

test("capWikilinkNeighbors keeps IR notes first and truncates", () => {
  const ir = new Set(["A.md", "B.md"]);
  assert.deepEqual(
    capWikilinkNeighbors(["Z.md", "A.md", "Y.md", "B.md"], ir, 3),
    ["A.md", "B.md", "Z.md"],
  );
});

test("a high-degree MOC does not dump every out-link into the walk", () => {
  const hub = el("hub", { type: "topic", notePath: "Hub.md", text: "hub" });
  const spokes: IrElement[] = [];
  const notes: FakeNote[] = [
    { path: "Hub.md", basename: "Hub", extension: "md", links: [] },
  ];
  for (let i = 0; i < 40; i++) {
    const path = `S${i}.md`;
    spokes.push(el(`s${i}`, { type: "topic", notePath: path, text: `s${i}` }));
    notes[0]!.links.push(path);
    notes.push({ path, basename: `S${i}`, extension: "md", links: [] });
  }
  const seq = walk([hub, ...spokes], "hub", linkIndex(notes));
  const spokeHits = seq.filter((k) => k.startsWith("s"));
  assert.equal(seq[0], "hub");
  assert.equal(spokeHits.length, WIKILINK_DEGREE_CAP);
});

test("same RNG seed yields the same neural walk", () => {
  const seed = el("seed", { type: "topic", notePath: "S.md", text: "s" });
  const notes: FakeNote[] = [
    { path: "S.md", basename: "S", extension: "md", links: [] },
  ];
  const elems = [seed];
  for (let i = 0; i < 8; i++) {
    const path = `N${i}.md`;
    elems.push(el(`n${i}`, { type: "topic", notePath: path, text: `n${i}` }));
    notes[0]!.links.push(path);
    notes.push({ path, basename: `N${i}`, extension: "md", links: [] });
  }
  const s = state(elems);
  const adj = buildNeuralAdjacency(s, linkIndex(notes));
  const opts = {
    seed: "seed",
    priorityOf: (id: string) => s.elements.get(id as ElementId)?.priority ?? 50,
    neighbors: (id: string) => neighborsForWalk(adj, id),
  };
  const a = neuralWalk({ ...opts, random: makeLcg(42) });
  const b = neuralWalk({ ...opts, random: makeLcg(42) });
  const c = neuralWalk({ ...opts, random: makeLcg(99) });
  assert.deepEqual(a, b);
  assert.equal(a[0], "seed");
  assert.equal(c[0], "seed");
});

test("shared tags connect topics like concept links", () => {
  const dogsA = el("dogsA", { type: "topic", notePath: "DogsA.md", text: "a" });
  const dogsB = el("dogsB", { type: "topic", notePath: "DogsB.md", text: "b" });
  const cars = el("cars", { type: "topic", notePath: "Cars.md", text: "c" });
  const notes: FakeNote[] = [
    { path: "DogsA.md", basename: "DogsA", extension: "md", links: [], tags: ["dogs"] },
    { path: "DogsB.md", basename: "DogsB", extension: "md", links: [], tags: ["dogs"] },
    { path: "Cars.md", basename: "Cars", extension: "md", links: [], tags: ["cars"] },
  ];
  const seq = walk([dogsA, dogsB, cars], "dogsA", linkIndex(notes), {
    useTags: true,
  });
  assert.ok(seq.includes("dogsB"));
  assert.equal(seq.includes("cars"), false);
});

test("oversized tags are ignored as hubs", () => {
  const notes: FakeNote[] = [];
  const elems: IrElement[] = [];
  for (let i = 0; i < 41; i++) {
    const path = `T${i}.md`;
    elems.push(el(`t${i}`, { type: "topic", notePath: path, text: `t${i}` }));
    notes.push({
      path,
      basename: `T${i}`,
      extension: "md",
      links: [],
      tags: ["todo"],
    });
  }
  const seq = walk(elems, "t0", linkIndex(notes), {
    useTags: true,
    tagDegreeCap: 40,
  });
  assert.equal(seq.length, 1);
  assert.equal(seq[0], "t0");
});

test("neuralViaLabel: wikilink, child, tag copy", () => {
  assert.equal(
    neuralViaLabel({ fromId: "x", kind: "wikilink" }, "Foo"),
    "via wikilink ← Foo",
  );
  assert.equal(
    neuralViaLabel({ fromId: "x", kind: "child" }, "Bar"),
    "via child of Bar",
  );
  assert.equal(
    neuralViaLabel({ fromId: "x", kind: "tag", tag: "dogs" }, "Other"),
    "via tag #dogs",
  );
  assert.equal(
    neuralViaLabel({ fromId: "x", kind: "parent" }, "Kid"),
    "via parent ← Kid",
  );
});

test("neuralWalkDetailed: child of seed records via child of seed", () => {
  const parent = el("parent", {
    type: "topic",
    notePath: "Root.md",
    text: "root",
  });
  const child = el("child", {
    type: "extract",
    parentId: eid("parent"),
    text: "extract body",
  });
  const s = state([parent, child]);
  const adj = buildNeuralAdjacency(s, emptyLinkIndex());
  const { sequence, provenance } = neuralWalkDetailed({
    seed: "parent",
    priorityOf: (id) => s.elements.get(id as ElementId)?.priority ?? 50,
    neighbors: (id) => neighborsForWalk(adj, id),
  });
  assert.equal(sequence[0], "parent");
  assert.equal(provenance.get("parent"), undefined);
  assert.equal(provenance.get("child")?.kind, "child");
  assert.equal(provenance.get("child")?.fromId, "parent");
});

test("neuralWalkDetailed: shared tag carries the tag name", () => {
  const dogsA = el("dogsA", { type: "topic", notePath: "DogsA.md", text: "a" });
  const dogsB = el("dogsB", { type: "topic", notePath: "DogsB.md", text: "b" });
  const notes: FakeNote[] = [
    { path: "DogsA.md", basename: "DogsA", extension: "md", links: [], tags: ["dogs"] },
    { path: "DogsB.md", basename: "DogsB", extension: "md", links: [], tags: ["dogs"] },
  ];
  const s = state([dogsA, dogsB]);
  const adj = buildNeuralAdjacency(s, linkIndex(notes), { useTags: true });
  const { provenance } = neuralWalkDetailed({
    seed: "dogsA",
    priorityOf: (id) => s.elements.get(id as ElementId)?.priority ?? 50,
    neighbors: (id) => neighborsForWalk(adj, id),
  });
  assert.equal(provenance.get("dogsB")?.kind, "tag");
  assert.equal(provenance.get("dogsB")?.tag, "dogs");
});

test("neuralQueue stamps neuralVia on non-seed cards", () => {
  const seed = el("seed", {
    type: "topic",
    notePath: "Seed.md",
    text: "seed",
  });
  const hot = el("hot", {
    type: "extract",
    parentId: eid("seed"),
    text: "hot",
  });
  const q = neuralQueue(fakeApp([]), state([seed, hot]), eid("seed"), null);
  assert.equal(q[0]!.neuralVia, undefined);
  assert.equal(q[1]!.neuralVia?.kind, "child");
  assert.equal(q[1]!.neuralVia?.fromId, "seed");
});

test("exciteNeuralElement dynamically excites neighbors, enforces recency cooldown, and evicts weakest beyond capacity", () => {
  const a = el("a", { type: "topic", notePath: "A.md", text: "a", priority: 20 });
  const b = el("b", { type: "extract", parentId: eid("a"), text: "b", priority: 20 });
  const c = el("c", { type: "extract", parentId: eid("b"), text: "c", priority: 20 });
  const d = el("d", { type: "extract", parentId: eid("b"), text: "d", priority: 95 });
  const s = state([a, b, c, d]);
  const adj = buildNeuralAdjacency(s, emptyLinkIndex());

  let q = createNeuralQueueState(eid("a"), 1_000);
  q = exciteNeuralElement(q, {
    elementId: eid("a"),
    priorityOf: (id) => s.elements.get(id)?.priority ?? 50,
    neighbors: (id) => neighborsForWalk(adj, id),
    nowMs: 1_000,
    cooldownMs: 10_000,
    capacity: 2,
  });
  assert.equal(q.entries[0]?.id, eid("b"));
  assert.equal(q.entries[0]?.via?.fromId, "a");

  q = exciteNeuralElement(q, {
    elementId: eid("b"),
    priorityOf: (id) => s.elements.get(id)?.priority ?? 50,
    neighbors: (id) => neighborsForWalk(adj, id),
    nowMs: 2_000,
    cooldownMs: 10_000,
    capacity: 2,
  });
  // Unvisited child c outranks recently visited parent a thanks to recency cooldown, and capacity=2 evicts weakest d
  assert.equal(q.entries.length, 2);
  assert.equal(q.entries[0]?.id, eid("c"));
  assert.equal(q.entries.some((e) => e.id === eid("d")), false);

  const popped = popNextNeuralElement(q, { elements: s.elements });
  assert.equal(popped.next?.id, eid("c"));
});

test("IrLedger.readNeural and writeNeural persist generation-scoped neural.json and prune deleted elements", async () => {
  const files = new Map<string, string>();
  const fs: VaultFs = {
    exists: async (p) => files.has(p),
    read: async (p) => {
      const v = files.get(p);
      if (v === undefined) throw new Error(`ENOENT ${p}`);
      return v;
    },
    write: async (p, d) => {
      files.set(p, d);
    },
    append: async (p, d) => {
      files.set(p, (files.get(p) ?? "") + d);
    },
    list: async (dir) => {
      const pre = dir.endsWith("/") ? dir : `${dir}/`;
      return [...files.keys()].filter(
        (k) => k.startsWith(pre) && !k.slice(pre.length).includes("/"),
      );
    },
  };
  const ledger = new IrLedger(fs);
  await ledger.init();

  const live = el("live", { type: "topic", notePath: "L.md", text: "live", priority: 25 });
  const child = el("child", { type: "extract", parentId: eid("live"), text: "c", priority: 30 });
  const s = state([live, child]);
  const adj = buildNeuralAdjacency(s, emptyLinkIndex());

  const seeded = seedNeuralQueueState({
    seedId: eid("live"),
    priorityOf: (id) => s.elements.get(id)?.priority ?? 50,
    neighbors: (id) => neighborsForWalk(adj, id),
    nowMs: 5_000,
  });
  await ledger.writeNeural(seeded);

  // Simulate child deleted from ledger state
  const pruned = await ledger.readNeural(new Map([[live.id, live]]));
  assert.deepEqual(
    pruned.entries.map((e) => e.id),
    [eid("live")],
  );
  assert.deepEqual(
    normalizeNeuralQueueState(seeded, new Map([[live.id, live]])).entries.map((e) => e.id),
    [eid("live")],
  );

  // Generation bump isolates neural.json
  await fs.write(
    META,
    JSON.stringify({ schemaVersion: 1, migration: "complete", generation: "gen_2" }),
  );
  const nextLedger = new IrLedger(fs);
  await nextLedger.init();
  assert.deepEqual((await nextLedger.readNeural()).entries, []);
});

test("needsNeuralExpansion and expandNeuralQueueIfNeeded expand <50 and halt at >=50", () => {
  const nodes: IrElement[] = [];
  const notes: FakeNote[] = [];
  for (let i = 0; i < 65; i += 1) {
    const id = `n${i}`;
    const path = `N${i}.md`;
    const links: string[] = [];
    if (2 * i + 1 < 65) links.push(`N${2 * i + 1}.md`);
    if (2 * i + 2 < 65) links.push(`N${2 * i + 2}.md`);
    nodes.push(el(id, { type: "topic", notePath: path, text: `node ${i}`, priority: 30 }));
    notes.push({
      path,
      basename: `N${i}`,
      extension: "md",
      links,
    });
  }
  const s = state(nodes);
  const adj = buildNeuralAdjacency(s, linkIndex(notes));

  const small = createNeuralQueueState(eid("n0"), 1_000);
  assert.equal(needsNeuralExpansion(small), true);

  const seeded = seedNeuralQueueState({
    seedId: eid("n0"),
    priorityOf: (id) => s.elements.get(id)?.priority ?? 50,
    neighbors: (id) => neighborsForWalk(adj, id),
    nowMs: 1_000,
    random: makeLcg(7),
  });
  assert.ok(seeded.entries.length >= 2);

  // Repeated incremental expansion stops once >= 50 or component is exhausted
  let cur = seeded;
  for (let step = 0; step < 20 && needsNeuralExpansion(cur); step += 1) {
    cur = expandNeuralQueueIfNeeded(cur, {
      priorityOf: (id) => s.elements.get(id)?.priority ?? 50,
      neighbors: (id) => neighborsForWalk(adj, id),
      nowMs: 1_000 + step,
      random: makeLcg(7 + step),
    });
  }
  assert.ok(cur.entries.length >= 50);
  assert.equal(needsNeuralExpansion(cur), false);

  const unchanged = expandNeuralQueueIfNeeded(cur, {
    priorityOf: (id) => s.elements.get(id)?.priority ?? 50,
    neighbors: (id) => neighborsForWalk(adj, id),
  });
  assert.equal(unchanged, cur);
});

test("popNextNeuralElement is deterministic without rng and heavy-tailed stochastic with rng", () => {
  const q = createNeuralQueueState(eid("a"), 10_000);
  q.entries = [
    { id: eid("a"), score: 0.2 },
    { id: eid("b"), score: 0.4 },
    { id: eid("c"), score: 0.6 },
    { id: eid("d"), score: 0.8 },
  ];

  const det = popNextNeuralElement(q);
  assert.equal(det.next?.id, eid("a"));

  const rng = makeLcg(12345);
  const picks = new Set<string>();
  for (let i = 0; i < 12; i += 1) {
    const p = popNextNeuralElement(q, { rng, nowMs: 10_000 });
    if (p.next) picks.add(p.next.id);
  }
  assert.ok(picks.size >= 2, "stochastic PickNext should explore beyond only the top entry");
});

test("buildNeuralAdjacency with useLexical connects titleMention & rare lexical terms, ignores URLs/stopwords, and respects cap", () => {
  const t1 = el("t1", {
    type: "topic",
    notePath: "Quantum Entanglement.md",
    text: "See https://example.com/quantum-entanglement-ignore-url for details about superconductivity and decoherence.",
  });
  const t2 = el("t2", {
    type: "extract",
    text: "We observed Quantum Entanglement in the lab with strong decoherence effects.",
  });
  const t3 = el("t3", {
    type: "extract",
    text: "Another note discussing superconductivity without linking directly.",
  });
  const t4 = el("t4", {
    type: "extract",
    text: "This note only shares common stopwords like because and through and https://example.com/quantum-entanglement-ignore-url.",
  });

  const s = state([t1, t2, t3, t4]);
  const adjOn = buildNeuralAdjacency(s, emptyLinkIndex(), { useLexical: true, lexicalDegreeCap: 5 });
  const t1Neighbors = adjOn.get("t1") ?? [];
  const mentionEdge = t1Neighbors.find((n) => n.id === "t2");
  assert.equal(mentionEdge?.kind, "titleMention");
  assert.equal(mentionEdge?.term, "Quantum Entanglement");
  assert.equal(
    neuralViaLabel({ fromId: "t1", kind: "titleMention", term: "Quantum Entanglement" }, "Quantum Entanglement"),
    "via mention \"Quantum Entanglement\" ← Quantum Entanglement",
  );

  const lexicalEdge = t1Neighbors.find((n) => n.id === "t3");
  assert.equal(lexicalEdge?.kind, "lexical");
  assert.equal(lexicalEdge?.term, "superconductivity");
  assert.equal(
    neuralViaLabel({ fromId: "t1", kind: "lexical", term: "superconductivity" }, "Quantum Entanglement"),
    "via term \"superconductivity\" ← Quantum Entanglement",
  );

  // Stopwords & URLs do not connect t4
  assert.equal(t1Neighbors.some((n) => n.id === "t4"), false);

  // useLexical: false disables both titleMention and lexical edges
  const adjOff = buildNeuralAdjacency(s, emptyLinkIndex(), { useLexical: false });
  assert.equal((adjOff.get("t1") ?? []).length, 0);
});
