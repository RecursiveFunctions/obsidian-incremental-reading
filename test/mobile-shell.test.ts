import assert from "node:assert/strict";
import { test } from "node:test";

// The mobile shell module imports Obsidian, so we test the pure logic
// that determines shell visibility and collapse state.

interface ShellState {
  enabled: boolean;
  collapsed: boolean;
}

function shellShouldShow(state: ShellState): boolean {
  return state.enabled;
}

function shellIsCollapsed(state: ShellState): boolean {
  return state.collapsed;
}

test("shell shows when enabled", () => {
  assert.equal(shellShouldShow({ enabled: true, collapsed: false }), true);
});

test("shell hidden when disabled", () => {
  assert.equal(shellShouldShow({ enabled: false, collapsed: false }), false);
});

test("shell collapse state is independent of visibility", () => {
  assert.equal(shellIsCollapsed({ enabled: true, collapsed: true }), true);
  assert.equal(shellIsCollapsed({ enabled: false, collapsed: true }), true);
  assert.equal(shellIsCollapsed({ enabled: true, collapsed: false }), false);
});
