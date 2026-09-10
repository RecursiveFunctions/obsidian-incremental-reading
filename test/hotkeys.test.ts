/**
 * Help-panel hotkey rendering and resolution. Pure and DOM-free.
 *
 * The load-bearing case is `effectiveHotkeys`: the panel exists to tell the
 * user which key to press, so it must report a rebind, not the default that
 * shipped with the command.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Command, Hotkey } from "obsidian";
import {
  effectiveHotkeys,
  formatHotkey,
  formatHotkeys,
  qualifiedCommandId,
} from "../src/ir/hotkeys";

const ALT_X: Hotkey = { modifiers: ["Alt"], key: "x" };
const CTRL_W: Hotkey = { modifiers: ["Mod"], key: "w" };

test("formatHotkey: single modifier, key uppercased", () => {
  assert.equal(formatHotkey({ modifiers: ["Alt"], key: "r" }), "Alt+R");
});

test("formatHotkey: multiple modifiers keep their order", () => {
  assert.equal(
    formatHotkey({ modifiers: ["Alt", "Shift"], key: "u" }),
    "Alt+Shift+U",
  );
});

test("formatHotkey: Mod renders as Ctrl, named keys are not uppercased", () => {
  assert.equal(formatHotkey({ modifiers: ["Mod"], key: "Enter" }), "Ctrl+Enter");
});

test("formatHotkey: nothing to render is empty, not undefined", () => {
  assert.equal(formatHotkey(undefined), "");
});

test("formatHotkeys: several bindings are all shown", () => {
  assert.equal(formatHotkeys([ALT_X, CTRL_W]), "Alt+X / Ctrl+W");
  assert.equal(formatHotkeys([]), "");
  assert.equal(formatHotkeys(undefined), "");
});

test("effectiveHotkeys: a user rebind wins over the registered default", () => {
  const got = effectiveHotkeys(
    { customKeys: { "incremental-reading:extract": [CTRL_W] } },
    "incremental-reading:extract",
    [ALT_X],
  );
  assert.deepEqual(got, [CTRL_W]);
});

test("effectiveHotkeys: clearing a binding is honored, not treated as unset", () => {
  // Obsidian records "no key" as an empty array. Falling back to the default
  // here would tell the user to press a key that does nothing.
  const got = effectiveHotkeys(
    { customKeys: { "incremental-reading:extract": [] } },
    "incremental-reading:extract",
    [ALT_X],
  );
  assert.deepEqual(got, []);
});

test("effectiveHotkeys: method lookups are preferred when present", () => {
  const got = effectiveHotkeys(
    {
      getHotkeys: (id) => (id === "ir:x" ? [CTRL_W] : undefined),
      customKeys: { "ir:x": [ALT_X] },
    },
    "ir:x",
    [],
  );
  assert.deepEqual(got, [CTRL_W]);
});

test("effectiveHotkeys: falls back to the manager's default, then the registered one", () => {
  assert.deepEqual(
    effectiveHotkeys({ defaultKeys: { "ir:x": [ALT_X] } }, "ir:x", []),
    [ALT_X],
  );
  assert.deepEqual(effectiveHotkeys({}, "ir:x", [ALT_X]), [ALT_X]);
});

test("effectiveHotkeys: a missing hotkey manager degrades to the default", () => {
  assert.deepEqual(effectiveHotkeys(undefined, "ir:x", [ALT_X]), [ALT_X]);
  assert.deepEqual(effectiveHotkeys(undefined, "ir:x", undefined), []);
});

test("qualifiedCommandId: namespaces bare ids, leaves qualified ones alone", () => {
  assert.equal(
    qualifiedCommandId("incremental-reading", { id: "open-help" } as Command),
    "incremental-reading:open-help",
  );
  assert.equal(
    qualifiedCommandId("incremental-reading", {
      id: "other-plugin:thing",
    } as Command),
    "other-plugin:thing",
  );
});
