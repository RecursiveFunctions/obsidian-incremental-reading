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
  elementIdForNotePath,
  makeLcg,
  neuralViaLabel,
  neuralWalk,
  neuralWalkDetailed,
  WIKILINK_DEGREE_CAP,
} from "../src/ir/neural";
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
