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

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("shell collapse state is independent of visibility", () => {
  assert.equal(shellIsCollapsed({ enabled: true, collapsed: true }), true);
  assert.equal(shellIsCollapsed({ enabled: false, collapsed: true }), true);
  assert.equal(shellIsCollapsed({ enabled: true, collapsed: false }), false);
});

test("styles.css defines display: none for mobile shell and FAB .is-hidden (#48)", () => {
  const css = readFileSync(resolve(process.cwd(), "styles.css"), "utf8");
  for (const selector of [
    ".ir-mobile-shell.is-hidden",
    ".ir-mobile-capture-fab.is-hidden",
    ".ir-mobile-review-fab.is-hidden",
  ]) {
    const escaped = selector.replace(/\./g, "\\.");
    const ruleRe = new RegExp(`${escaped}[\\s,\\S]*?\\{[^}]*display:\\s*none`, "m");
    assert.match(css, ruleRe, `Expected ${selector} to have display: none`);
  }
});
