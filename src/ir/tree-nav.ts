/**
 * Pure tree-navigation policy (polish phase 3). The ItemView owns DOM;
 * this module owns the click/key contracts so they stay unit-tested.
 */

export type TreeClickKind = "select" | "reveal-or-open" | "open-note";

export function treeClickKind(evt: {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  detail: number;
}): TreeClickKind {
  if (evt.metaKey || evt.ctrlKey || evt.shiftKey) return "select";
  if (evt.detail >= 2) return "open-note";
  return "reveal-or-open";
}

export function treeNavId(
  visibleIds: readonly string[],
  currentId: string | null,
  delta: number,
): string | null {
  if (visibleIds.length === 0) return null;
  if (!currentId) {
    return visibleIds[delta >= 0 ? 0 : visibleIds.length - 1] ?? null;
  }
  const i = visibleIds.indexOf(currentId);
  if (i < 0) return visibleIds[0] ?? null;
  const next = Math.max(0, Math.min(visibleIds.length - 1, i + delta));
  return visibleIds[next] ?? null;
}

/**
 * While a text/type filter is on, collapsed chevrons would hide matching
 * descendants. Ignore collapse for rendering; keep the Set so clearing the
 * filter restores the user's expand/collapse.
 */
export function treeRowCollapsed(
  collapsed: ReadonlySet<string>,
  id: string,
  filterForcesExpand: boolean,
): boolean {
  if (filterForcesExpand) return false;
  return collapsed.has(id);
}

export type TreeKeyCommand =
  | { kind: "move"; delta: number }
  | { kind: "collapse-or-parent" }
  | { kind: "expand-or-child" }
  | { kind: "enter-review" }
  | { kind: "open-note" }
  | { kind: "priority" }
  | { kind: "dismiss" }
  | { kind: "postpone" }
  | { kind: "toggle-collapse" };

export function treeKeyCommand(evt: {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}): TreeKeyCommand | null {
  if (evt.altKey || evt.ctrlKey || evt.metaKey) return null;
  switch (evt.key) {
    case "ArrowDown":
    case "j":
      return { kind: "move", delta: 1 };
    case "ArrowUp":
    case "k":
      return { kind: "move", delta: -1 };
    case "ArrowLeft":
      return { kind: "collapse-or-parent" };
    case "ArrowRight":
      return { kind: "expand-or-child" };
    case "Enter":
      return { kind: "enter-review" };
    case "o":
      return { kind: "open-note" };
    case "p":
      return { kind: "priority" };
    case "d":
      return { kind: "dismiss" };
    case "m":
      return { kind: "postpone" };
    case " ":
      return { kind: "toggle-collapse" };
    default:
      return null;
  }
}

export function shouldShowReanchorBanner(
  anchorState: string | undefined,
): boolean {
  return anchorState === "needs-reanchor" || anchorState === "detached";
}
