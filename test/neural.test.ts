/**
 * Spreading activation + neural queue.
 *
 * SuperMemo neural review is subset review ordered by activation, with real
 * repetitions (including mid-interval / not-yet-due). These tests pin that
 * contract and the graph walk (tree, note, wikilink, backlink).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { App } from "obsidian";
import { computeNeuralActivation, elementIdForNotePath } from "../src/ir/neural";
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
}

/** Minimal App: vault files + wikilinks + resolved backlinks. */
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
        return {
          links: n.links.map((link) => ({ link })),
        };
      },
      getFirstLinkpathDest: (link: string, _from: string) =>
        byPath.get(link) ?? null,
      resolvedLinks,
    },
  } as unknown as App;
}

test("isVaultFile: notes pass, folders and null do not", () => {
  assert.equal(isVaultFile(null), false);
  assert.equal(isVaultFile({ path: "Folder" }), false);
  assert.equal(
    isVaultFile({ path: "Note.md", extension: "md", basename: "Note" }),
    true,
  );
});

test("empty seeds yield no scores", () => {
  const s = state([el("topic", { type: "topic", notePath: "A.md", text: "a" })]);
  const scores = computeNeuralActivation(fakeApp([]), s, null, null);
  assert.deepEqual(scores, {});
});

test("seed element scores 1 and decays to parent and children", () => {
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
  const scores = computeNeuralActivation(fakeApp([]), s, eid("child"), null);
  assert.equal(scores["child"], 1);
  assert.equal(scores["parent"], 0.5);
});

test("seed note activates elements on that note at decay", () => {
  const topic = el("topic", {
    type: "topic",
    notePath: "Dog.md",
    text: "dogs",
  });
  const s = state([topic]);
  const app = fakeApp([
    { path: "Dog.md", basename: "Dog", extension: "md", links: [] },
  ]);
  const scores = computeNeuralActivation(app, s, null, "Dog.md");
  assert.equal(scores["topic"], 0.5);
});

test("anchor.sourcePath is a note hop when notePath is absent", () => {
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
  const s = state([extract, sibling]);
  const scores = computeNeuralActivation(
    fakeApp([]),
    s,
    eid("ex"),
    null,
  );
  assert.equal(scores["ex"], 1);
  // extract → article note (0.5) → sibling extract (0.25)
  assert.equal(scores["sib"], 0.25);
});

test("forward wikilink spreads to the destination note's elements", () => {
  const a = el("a", { type: "topic", notePath: "A.md", text: "a" });
  const b = el("b", { type: "topic", notePath: "B.md", text: "b" });
  const app = fakeApp([
    { path: "A.md", basename: "A", extension: "md", links: ["B.md"] },
    { path: "B.md", basename: "B", extension: "md", links: [] },
  ]);
  const scores = computeNeuralActivation(app, state([a, b]), eid("a"), null);
  assert.equal(scores["a"], 1);
  // a → A.md (0.5) → B.md (0.25) → b (0.125)
  assert.equal(scores["b"], 0.125);
});

test("backlinks spread to the source note's elements", () => {
  const hub = el("hub", { type: "topic", notePath: "Hub.md", text: "hub" });
  const spoke = el("spoke", {
    type: "topic",
    notePath: "Spoke.md",
    text: "spoke",
  });
  const app = fakeApp([
    { path: "Hub.md", basename: "Hub", extension: "md", links: [] },
    {
      path: "Spoke.md",
      basename: "Spoke",
      extension: "md",
      links: ["Hub.md"],
    },
  ]);
  const scores = computeNeuralActivation(
    app,
    state([hub, spoke]),
    eid("hub"),
    null,
  );
  assert.equal(scores["hub"], 1);
  // hub → Hub.md (0.5) → Spoke.md via backlink (0.25) → spoke (0.125)
  assert.equal(scores["spoke"], 0.125);
});

test("cycles do not loop forever; higher score wins", () => {
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
  const scores = computeNeuralActivation(
    fakeApp([]),
    state([a, b]),
    eid("a"),
    null,
  );
  assert.equal(scores["a"], 1);
  assert.equal(scores["b"], 0.5);
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
  const app = fakeApp([]);
  const q = neuralQueue(app, state([due, future, dismissed, ghost]), eid("due"), null);
  assert.deepEqual(
    q.map((s) => s.id),
    ["due", "future"],
  );
});

test("neuralQueue orders by activation then priority (lower = more important)", () => {
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
  // seed score 1, children 0.5; among children, priority 10 before 90
  assert.deepEqual(
    q.map((s) => s.id),
    ["seed", "hot", "cold"],
  );
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
  assert.deepEqual(
    q.map((s) => s.id),
    ["topic", "hot"],
  );
});
