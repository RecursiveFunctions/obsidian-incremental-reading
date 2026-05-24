import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ancestorBreadcrumbLabel,
  ancestorChain,
  labelFor,
  reviewHeadlineLabel,
  shortElementTag,
  treeRowLabel,
} from "../src/ir/labels";
import type { IrElement } from "../src/ir/model";
import type { ElementId } from "../src/ir/ids";

function el(
  p: Omit<Partial<IrElement>, "id" | "parentId"> & {
    id: string;
    parentId?: string | null;
  },
): IrElement {
  const { id, parentId, ...rest } = p;
  return {
    type: "topic",
    priority: 50,
    parentId: (parentId ?? null) as ElementId | null,
    dismissed: false,
    created: 0,
    text: "",
    anchorState: "ok",
    ...rest,
    id: id as ElementId,
  };
}

test("labelFor: notePath wins, .md stripped", () => {
  assert.equal(
    labelFor(el({ id: "x", notePath: "Some/Folder/My Note.md" })),
    "My Note",
  );
});

test("labelFor: falls back to first ~80 chars of text", () => {
  const long = "A".repeat(100);
  const out = labelFor(el({ id: "x", text: long }));
  assert.equal(out, "A".repeat(77) + "...");
});

test("labelFor: whitespace-only text falls back to (type) tag", () => {
  assert.equal(
    labelFor(el({ id: "x", type: "extract", text: "   \n  " })),
    "(extract)",
  );
});

test("ancestorChain: empty for a root", () => {
  const root = el({ id: "a", parentId: null });
  const byId = new Map([[root.id, root]]);
  assert.deepEqual(ancestorChain(root, byId), []);
});

test("ancestorChain: returns chain in root-first order", () => {
  const root = el({ id: "root", notePath: "Root.md" });
  const mid = el({ id: "mid", parentId: "root", notePath: "Mid.md" });
  const leaf = el({ id: "leaf", parentId: "mid", notePath: "Leaf.md" });
  const byId = new Map<string, IrElement>([
    ["root", root],
    ["mid", mid],
    ["leaf", leaf],
  ]);
  const chain = ancestorChain(leaf, byId);
  assert.deepEqual(
    chain.map((e) => e.id),
    ["root", "mid"],
  );
});

test("ancestorChain: stops at missing parent (orphan)", () => {
  const orphan = el({ id: "o", parentId: "ghost" });
  const byId = new Map([[orphan.id, orphan]]);
  assert.deepEqual(ancestorChain(orphan, byId), []);
});

test("ancestorChain: maxDepth limits chain length", () => {
  const a = el({ id: "a" });
  const b = el({ id: "b", parentId: "a" });
  const c = el({ id: "c", parentId: "b" });
  const d = el({ id: "d", parentId: "c" });
  const e = el({ id: "e", parentId: "d" });
  const byId = new Map<string, IrElement>([
    ["a", a],
    ["b", b],
    ["c", c],
    ["d", d],
    ["e", e],
  ]);
  const chain = ancestorChain(e, byId, 2);
  assert.equal(chain.length, 2);
  assert.deepEqual(
    chain.map((x) => x.id),
    ["c", "d"],
  );
});

test("ancestorChain: cycle terminates", () => {
  const a = el({ id: "a", parentId: "b" });
  const b = el({ id: "b", parentId: "a" });
  const byId = new Map<string, IrElement>([
    ["a", a],
    ["b", b],
  ]);
  const chain = ancestorChain(a, byId);
  // a's parent is b; b's parent is a, which is `start`, so seen detects it.
  assert.deepEqual(
    chain.map((x) => x.id),
    ["b"],
  );
});

test("shortElementTag: produces a 6-char alphanumeric tag", () => {
  assert.match(shortElementTag("abc-def-012"), /^[0-9a-z]{6}$/);
});

test("shortElementTag: deterministic for the same id", () => {
  const id = "el_a1b2c3d4-e5f6-7890";
  assert.equal(shortElementTag(id), shortElementTag(id));
});

test("shortElementTag: distinct ids get distinct tags", () => {
  const a = shortElementTag("el_a1b2c3");
  const b = shortElementTag("el_z9y8x7");
  assert.notEqual(a, b);
});

test("shortElementTag: migrated ids that share a folder prefix don't collide", () => {
  // Regression: under the old implementation every cloze whose source note
  // lived under (e.g.) `Kubernetes/` rendered as the same `elmig4` because
  // the first 6 alnum chars of a migrated id are dominated by the literal
  // `el_mig_` prefix plus the hex of the shared folder name. Two migrated
  // ids that differ only in the path's tail must now produce different
  // tags. Both sample ids decode to "Kubernetes/foo.md" / "Kubernetes/bar.md".
  const foo = shortElementTag(
    "el_mig_4b756265726e657465732f666f6f2e6d64",
  );
  const bar = shortElementTag(
    "el_mig_4b756265726e657465732f6261722e6d64",
  );
  assert.match(foo, /^[0-9a-z]{6}$/);
  assert.match(bar, /^[0-9a-z]{6}$/);
  assert.notEqual(foo, bar);
});

test("treeRowLabel: topic uses note title", () => {
  assert.equal(
    treeRowLabel(
      el({ id: "x1", type: "topic", notePath: "T/My Topic.md" }),
    ),
    "My Topic",
  );
});

test("treeRowLabel: item shows real title by default", () => {
  assert.equal(
    treeRowLabel(
      el({
        id: "item-uuid-99",
        type: "item",
        notePath: "continuous delivery spoiler.md",
      }),
    ),
    "continuous delivery spoiler",
  );
});

test("treeRowLabel: item is neutral + tag when spoilers masked", () => {
  const label = treeRowLabel(
    el({
      id: "item-uuid-99",
      type: "item",
      notePath: "continuous delivery spoiler.md",
    }),
    true,
  );
  assert.match(label, /^Cloze item \([0-9a-z]{6}\)$/);
});

test("treeRowLabel: extracts stay readable even when masking is on", () => {
  // Spoiler risk only applies to cloze items (label can leak the answer).
  // Extracts are excerpts — keep their title visible during review too,
  // otherwise the tree is unreadable when a review pane is open.
  assert.equal(
    treeRowLabel(
      el({
        id: "ex-1",
        type: "extract",
        text: "Autoscaling adjusts capacity based on signals.",
      }),
      true,
    ),
    "Autoscaling adjusts capacity based on signals.",
  );
});

test("reviewHeadlineLabel: masks item until caller says reveal", () => {
  const item = el({
    id: "abc",
    type: "item",
    notePath: "Secret Title.md",
  });
  assert.match(reviewHeadlineLabel(item, true), /^Cloze item \([0-9a-z]{6}\)$/);
  assert.equal(reviewHeadlineLabel(item, false), "Secret Title");
});

test("reviewHeadlineLabel: topic never masked by item flag", () => {
  const topic = el({ id: "t", type: "topic", notePath: "X.md" });
  assert.equal(reviewHeadlineLabel(topic, true), "X");
});

test("ancestorBreadcrumbLabel: masks to type word", () => {
  const topic = el({ id: "r", type: "topic", notePath: "Root.md" });
  assert.equal(ancestorBreadcrumbLabel(topic, true), "Topic");
  assert.equal(ancestorBreadcrumbLabel(topic, false), "Root");
});
