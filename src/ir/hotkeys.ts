/**
 * Hotkey formatting for the help panel.
 *
 * Lives in the pure core (type-only import of `Command`, erased at runtime)
 * so it can be unit-tested; `obsidian` is not resolvable outside the
 * Obsidian runtime, and anything importing `ItemView` and friends for real
 * cannot be loaded by the test runner.
 */

import type { Command } from "obsidian";

/**
 * Render a command's default binding the way Obsidian's own hotkey settings
 * do. Commands without a default return an empty string; the caller decides
 * how to fill the gap.
 */
export function formatHotkey(cmd: Command): string {
  const hk = cmd.hotkeys?.[0];
  if (!hk) return "";
  const mods = (hk.modifiers ?? []).map((m) =>
    String(m) === "Mod" ? "Ctrl" : String(m),
  );
  const key = hk.key.length === 1 ? hk.key.toUpperCase() : hk.key;
  return [...mods, key].join("+");
}
