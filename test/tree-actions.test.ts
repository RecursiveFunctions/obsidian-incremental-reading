/**
 * Golden contract for src/ir/tree-actions.ts (unlocks the 0.0.2 tree view).
 *
 * Pure gesture-to-action-plan controller for the element tree view. The
 * tree view ItemView dispatches TreeAction values to the existing store
 * mutations; this module makes that translation deterministic and
 * unit-testable without Obsidian. Claude-authored, fenced out of the
 * delegated scope. Skips until the module exists; computed specifier
 * keeps tsc from failing on the missing module.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const SPEC = ["..", "src", "ir", "tree-actions.ts"].join("/");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function load(): Promise<any> {
  try {
    return await import(SPEC);
  } catch {
    return null;
  }
}

const NOW = 1_700_000_000_000;

function mkElement(over: Record<string, unknown> = {}) {
  return {
    id: "el_a",
    type: "topic",
    priority: 50,
    parentId: null,
    dismissed: false,
    created: NOW - 1000,
    text: "",
    anchorState: "ok",
    ...over,
  };
}

test("set-priority within 0..100 passes through", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/tree-actions.ts not implemented yet");
  const plan = m.planTreeAction({
    gesture: { kind: "set-priority", value: 30 },
    element: mkElement(),
    now: NOW,
  });
  assert.deepEqual(plan, { kind: "set-priority", elementId: "el_a", priority: 30 });
});

test("set-priority is clamped to 0..100", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/tree-actions.ts not implemented yet");
  const low = m.planTreeAction({
    gesture: { kind: "set-priority", value: -25 },
    element: mkElement(),
    now: NOW,
  });
  assert.equal(low.kind, "set-priority");
  assert.equal(low.priority, 0);

  const high = m.planTreeAction({
    gesture: { kind: "set-priority", value: 250 },
    element: mkElement(),
    now: NOW,
  });
  assert.equal(high.kind, "set-priority");
  assert.equal(high.priority, 100);
});

test("set-priority with non-finite value is a noop with a reason", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/tree-actions.ts not implemented yet");
  const plan = m.planTreeAction({
    gesture: { kind: "set-priority", value: Number.NaN },
    element: mkElement(),
    now: NOW,
  });
  assert.equal(plan.kind, "noop");
  assert.ok(typeof plan.reason === "string" && plan.reason.length > 0);
});

test("toggle-dismiss flips the element's current dismissed flag", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/tree-actions.ts not implemented yet");
  const fromFalse = m.planTreeAction({
    gesture: { kind: "toggle-dismiss" },
    element: mkElement({ dismissed: false }),
    now: NOW,
  });
  assert.deepEqual(fromFalse, {
    kind: "toggle-dismiss",
    elementId: "el_a",
    dismissed: true,
  });

  const fromTrue = m.planTreeAction({
    gesture: { kind: "toggle-dismiss" },
    element: mkElement({ dismissed: true }),
    now: NOW,
  });
  assert.deepEqual(fromTrue, {
    kind: "toggle-dismiss",
    elementId: "el_a",
    dismissed: false,
  });
});

test("postpone with days >= 1 passes through", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/tree-actions.ts not implemented yet");
  const plan = m.planTreeAction({
    gesture: { kind: "postpone", days: 7 },
    element: mkElement(),
    now: NOW,
  });
  assert.deepEqual(plan, { kind: "postpone", elementId: "el_a", days: 7 });
});

test("postpone with days < 1 is a noop with a reason", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/tree-actions.ts not implemented yet");
  for (const days of [0, -3, 0.4]) {
    const plan = m.planTreeAction({
      gesture: { kind: "postpone", days },
      element: mkElement(),
      now: NOW,
    });
    assert.equal(plan.kind, "noop", `days=${days} should noop`);
    assert.ok(typeof plan.reason === "string" && plan.reason.length > 0);
  }
});

test("postpone floors fractional days >= 1 to an integer day count", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/tree-actions.ts not implemented yet");
  const plan = m.planTreeAction({
    gesture: { kind: "postpone", days: 3.9 },
    element: mkElement(),
    now: NOW,
  });
  assert.equal(plan.kind, "postpone");
  assert.equal(plan.days, 3);
});

test("open with notePath set yields open-note", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/tree-actions.ts not implemented yet");
  const plan = m.planTreeAction({
    gesture: { kind: "open" },
    element: mkElement({ notePath: "Topics/Foo.md" }),
    now: NOW,
  });
  assert.deepEqual(plan, { kind: "open-note", notePath: "Topics/Foo.md" });
});

test("open without notePath is a noop with a reason", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/tree-actions.ts not implemented yet");
  const plan = m.planTreeAction({
    gesture: { kind: "open" },
    element: mkElement(),
    now: NOW,
  });
  assert.equal(plan.kind, "noop");
  assert.ok(typeof plan.reason === "string" && plan.reason.length > 0);
});

test("identical inputs produce a deep-equal plan (determinism)", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/tree-actions.ts not implemented yet");
  const input = {
    gesture: { kind: "set-priority", value: 42 } as const,
    element: mkElement({ notePath: "Topics/Foo.md" }),
    now: NOW,
  };
  const a = m.planTreeAction(input);
  const b = m.planTreeAction(input);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test("planTreeAction does not mutate its input element", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/tree-actions.ts not implemented yet");
  const element = mkElement({ priority: 50, dismissed: false });
  const snap = JSON.parse(JSON.stringify(element));
  m.planTreeAction({
    gesture: { kind: "set-priority", value: 12 },
    element,
    now: NOW,
  });
  m.planTreeAction({
    gesture: { kind: "toggle-dismiss" },
    element,
    now: NOW,
  });
  assert.deepEqual(element, snap, "input element must not be mutated");
});
