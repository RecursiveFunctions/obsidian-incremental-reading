/**
 * Golden contract for src/ir/tree.ts (DESIGN.md section 3 / v0.2
 * "Element tree view": the pure data builder behind the hierarchy
 * panel; the Obsidian ItemView is maintainer glue, not delegated).
 *
 * Claude-authored, fenced out of scope. Skips until the module exists.
 * Computed specifier keeps tsc from failing on the missing module.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { newElement } from "../src/ir/model";
import type { ElementId } from "../src/ir/ids";

const SPEC = ["..", "src", "ir", "tree.ts"].join("/");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function load(): Promise<any> {
  try {
    return await import(SPEC);
  } catch {
    return null;
  }
}

const el = (
  id: string,
  type: "topic" | "extract" | "item",
  priority: number,
  parentId: string | null,
) =>
  newElement({
    id: id as ElementId,
    type,
    priority,
    parentId: parentId as ElementId | null,
    now: 0,
  });

// root1 -> {c2, c1 -> gc1}; orphan has a missing parent; x<->y is a cycle.
const forest = () => [
  el("el_root1", "topic", 50, null),
  el("el_c1", "extract", 10, "el_root1"),
  el("el_c2", "extract", 5, "el_root1"),
  el("el_gc1", "item", 0, "el_c1"),
  el("el_orphan", "extract", 99, "el_missing"),
  el("el_x", "extract", 70, "el_y"),
  el("el_y", "extract", 80, "el_x"),
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function flatten(nodes: any[]): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    out.push(n.id);
    out.push(...flatten(n.children));
  }
  return out;
}

test("roots: null-parent and missing-parent and cycle members, sorted", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/tree.ts not implemented yet");

  const roots = m.buildTree(forest());
  // Sorted by priority asc then id asc: root1(50), x(70, cycle root), orphan(99).
  assert.deepEqual(
    roots.map((n: { id: string }) => n.id),
    ["el_root1", "el_x", "el_orphan"],
  );
});

test("children sorted by priority then id", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/tree.ts not implemented yet");

  const roots = m.buildTree(forest());
  const root1 = roots.find((n: { id: string }) => n.id === "el_root1");
  assert.deepEqual(
    root1.children.map((n: { id: string }) => n.id),
    ["el_c2", "el_c1"], // c2 priority 5 before c1 priority 10
  );
  const c1 = root1.children.find((n: { id: string }) => n.id === "el_c1");
  assert.deepEqual(
    c1.children.map((n: { id: string }) => n.id),
    ["el_gc1"],
  );
});

test("every element appears exactly once; cycles terminate", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/tree.ts not implemented yet");

  const ids = flatten(m.buildTree(forest()));
  assert.equal(ids.length, 7);
  assert.deepEqual(
    [...ids].sort(),
    [
      "el_c1",
      "el_c2",
      "el_gc1",
      "el_orphan",
      "el_root1",
      "el_x",
      "el_y",
    ],
  );
});

test("cycle is cut after one descent (no infinite recursion)", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/tree.ts not implemented yet");

  const roots = m.buildTree(forest());
  const x = roots.find((n: { id: string }) => n.id === "el_x");
  assert.deepEqual(
    x.children.map((n: { id: string }) => n.id),
    ["el_y"],
  );
  const y = x.children[0];
  assert.deepEqual(y.children, []); // back-edge to x is cut
});

test("node carries the source element; deterministic", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/tree.ts not implemented yet");

  const roots = m.buildTree(forest());
  const root1 = roots.find((n: { id: string }) => n.id === "el_root1");
  assert.equal(root1.type, "topic");
  assert.equal(root1.element.id, "el_root1");

  const a = JSON.stringify(m.buildTree(forest()));
  const b = JSON.stringify(m.buildTree(forest()));
  assert.equal(a, b);
});
