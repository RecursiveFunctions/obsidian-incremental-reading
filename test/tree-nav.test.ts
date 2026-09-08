import assert from "node:assert/strict";
import { test } from "node:test";
import {
  shouldShowReanchorBanner,
  treeClickKind,
  treeKeyCommand,
  treeNavId,
  treeRowCollapsed,
} from "../src/ir/tree-nav";

test("tree click: modifiers select, double-click opens the note", () => {
  assert.equal(
    treeClickKind({ metaKey: true, ctrlKey: false, shiftKey: false, detail: 1 }),
    "select",
  );
  assert.equal(
    treeClickKind({ metaKey: false, ctrlKey: true, shiftKey: false, detail: 1 }),
    "select",
  );
  assert.equal(
    treeClickKind({ metaKey: false, ctrlKey: false, shiftKey: true, detail: 1 }),
    "select",
  );
  assert.equal(
    treeClickKind({ metaKey: false, ctrlKey: false, shiftKey: false, detail: 2 }),
    "open-note",
  );
  assert.equal(
    treeClickKind({ metaKey: false, ctrlKey: false, shiftKey: false, detail: 1 }),
    "reveal-or-open",
  );
});

test("treeNavId walks visible order and clamps", () => {
  const ids = ["a", "b", "c"];
  assert.equal(treeNavId(ids, null, 1), "a");
  assert.equal(treeNavId(ids, "a", 1), "b");
  assert.equal(treeNavId(ids, "c", 1), "c");
  assert.equal(treeNavId(ids, "a", -1), "a");
  assert.equal(treeNavId(ids, "missing", 1), "a");
  assert.equal(treeNavId([], "a", 1), null);
});

test("filter forces expand without mutating the collapsed set", () => {
  const collapsed = new Set(["el_1"]);
  assert.equal(treeRowCollapsed(collapsed, "el_1", false), true);
  assert.equal(treeRowCollapsed(collapsed, "el_1", true), false);
  assert.equal(collapsed.has("el_1"), true);
});

test("tree keys: j/k and arrows move; Enter/o/p/d/m/Space are actions", () => {
  const none = { altKey: false, ctrlKey: false, metaKey: false };
  assert.deepEqual(treeKeyCommand({ key: "j", ...none }), { kind: "move", delta: 1 });
  assert.deepEqual(treeKeyCommand({ key: "k", ...none }), { kind: "move", delta: -1 });
  assert.deepEqual(treeKeyCommand({ key: "Enter", ...none }), { kind: "enter-review" });
  assert.deepEqual(treeKeyCommand({ key: "o", ...none }), { kind: "open-note" });
  assert.deepEqual(treeKeyCommand({ key: "p", ...none }), { kind: "priority" });
  assert.deepEqual(treeKeyCommand({ key: "d", ...none }), { kind: "dismiss" });
  assert.deepEqual(treeKeyCommand({ key: "m", ...none }), { kind: "postpone" });
  assert.deepEqual(treeKeyCommand({ key: " ", ...none }), { kind: "toggle-collapse" });
  assert.equal(treeKeyCommand({ key: "j", altKey: true, ctrlKey: false, metaKey: false }), null);
});

test("tree keys: x picks up, v drops, Escape cancels a move", () => {
  const none = { altKey: false, ctrlKey: false, metaKey: false };
  assert.deepEqual(treeKeyCommand({ key: "x", ...none }), { kind: "move-pick" });
  assert.deepEqual(treeKeyCommand({ key: "v", ...none }), { kind: "move-drop" });
  assert.deepEqual(treeKeyCommand({ key: "Escape", ...none }), {
    kind: "move-cancel",
  });
  // Modified keys stay out of the tree's hands so Obsidian keeps its own.
  assert.equal(
    treeKeyCommand({ key: "x", altKey: false, ctrlKey: true, metaKey: false }),
    null,
  );
});

test("reanchor banner shows for drifted and detached extracts", () => {
  assert.equal(shouldShowReanchorBanner("ok"), false);
  assert.equal(shouldShowReanchorBanner("needs-reanchor"), true);
  assert.equal(shouldShowReanchorBanner("detached"), true);
  assert.equal(shouldShowReanchorBanner(undefined), false);
});
