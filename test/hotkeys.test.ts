/**
 * `formatHotkey` renders a command's default binding for the help panel.
 * Pure and DOM-free, so it tests directly.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Command } from "obsidian";
import { formatHotkey } from "../src/ir/hotkeys";

function cmd(hotkeys?: Command["hotkeys"]): Command {
  return { id: "x", name: "X", hotkeys } as Command;
}

test("formatHotkey: single modifier, key uppercased", () => {
  assert.equal(
    formatHotkey(cmd([{ modifiers: ["Alt"], key: "r" }])),
    "Alt+R",
  );
});

test("formatHotkey: multiple modifiers keep their order", () => {
  assert.equal(
    formatHotkey(cmd([{ modifiers: ["Alt", "Shift"], key: "u" }])),
    "Alt+Shift+U",
  );
});

test("formatHotkey: Mod renders as Ctrl, named keys are not uppercased", () => {
  assert.equal(
    formatHotkey(cmd([{ modifiers: ["Mod"], key: "Enter" }])),
    "Ctrl+Enter",
  );
});

test("formatHotkey: no default binding renders empty, not undefined", () => {
  assert.equal(formatHotkey(cmd()), "");
  assert.equal(formatHotkey(cmd([])), "");
});
