/**
 * Hotkey formatting and resolution for the help panel.
 *
 * Lives in the pure core (type-only import of `Command`, erased at runtime)
 * so it can be unit-tested; `obsidian` is not resolvable outside the
 * Obsidian runtime, and anything importing `ItemView` and friends for real
 * cannot be loaded by the test runner.
 */

import type { Command, Hotkey } from "obsidian";

/** Render one binding the way Obsidian's own hotkey settings do. */
export function formatHotkey(hk: Hotkey | undefined): string {
  if (!hk) return "";
  const mods = (hk.modifiers ?? []).map((m) =>
    String(m) === "Mod" ? "Ctrl" : String(m),
  );
  const key = hk.key.length === 1 ? hk.key.toUpperCase() : hk.key;
  return [...mods, key].join("+");
}

/**
 * Render a list of bindings. Obsidian lets a command carry several; show
 * them all rather than pretending the first is the only way in.
 */
export function formatHotkeys(hotkeys: ReadonlyArray<Hotkey> | undefined): string {
  if (!hotkeys || hotkeys.length === 0) return "";
  return hotkeys.map((hk) => formatHotkey(hk)).filter(Boolean).join(" / ");
}

/**
 * Shape of the slice of Obsidian's hotkey manager we read.
 *
 * Not in the public typings. The help panel asks it for the binding the
 * user will actually press, which is the whole point of the panel; falling
 * back to the registered default would make the sheet lie the moment
 * anyone rebinds anything.
 */
export interface HotkeyLookup {
  customKeys?: Record<string, Hotkey[]>;
  defaultKeys?: Record<string, Hotkey[]>;
  getHotkeys?: (id: string) => Hotkey[] | undefined;
  getDefaultHotkeys?: (id: string) => Hotkey[] | undefined;
}

/**
 * The binding a user will actually press for `commandId`.
 *
 * Precedence matches Obsidian: a custom binding replaces the default
 * outright (including replacing it with nothing, which is why an empty
 * custom array is honored rather than treated as "unset"). Every lookup is
 * optional, so a future Obsidian that moves or renames these degrades to
 * the registered default instead of throwing inside a render.
 */
export function effectiveHotkeys(
  lookup: HotkeyLookup | undefined,
  commandId: string,
  registeredDefault: ReadonlyArray<Hotkey> | undefined,
): ReadonlyArray<Hotkey> {
  if (lookup) {
    const custom =
      lookup.getHotkeys?.(commandId) ?? lookup.customKeys?.[commandId];
    if (custom !== undefined) return custom;
    const dflt =
      lookup.getDefaultHotkeys?.(commandId) ?? lookup.defaultKeys?.[commandId];
    if (dflt !== undefined) return dflt;
  }
  return registeredDefault ?? [];
}

/** Fully-qualified command id, the key Obsidian files hotkeys under. */
export function qualifiedCommandId(pluginId: string, cmd: Command): string {
  return cmd.id.includes(":") ? cmd.id : `${pluginId}:${cmd.id}`;
}
