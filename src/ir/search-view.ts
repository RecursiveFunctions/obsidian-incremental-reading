/**
 * Fenced adapter for Obsidian's core `search` view (docs/DESIGN.md §2).
 * Inspects `app.workspace.getLeavesOfType("search")` via `dom.resultDomLookup`
 * Map first, falling back to rendered `.tree-item-self` / file-title DOM nodes.
 */

import type { App } from "obsidian";

interface SearchViewLike {
  dom?: {
    resultDomLookup?: unknown;
    vChildren?: { children?: Array<{ file?: { path?: unknown } }> };
  };
  resultDomLookup?: unknown;
  searchComponent?: { getValue?: () => unknown };
  containerEl?: {
    querySelectorAll?: (selector: string) => Iterable<{
      getAttribute?: (name: string) => string | null;
      textContent?: string | null;
      querySelector?: (selector: string) => { textContent?: string | null } | null;
    }>;
    querySelector?: (selector: string) => { value?: unknown } | null;
  };
}

function addUniquePath(out: string[], seen: Set<string>, raw: unknown): void {
  if (typeof raw !== "string") return;
  const trimmed = raw.trim();
  if (!trimmed || seen.has(trimmed)) return;
  seen.add(trimmed);
  out.push(trimmed);
}

function collectLookupKeys(lookup: unknown, out: string[], seen: Set<string>): void {
  if (!lookup || typeof lookup !== "object") return;
  const mapLike = lookup as { keys?: () => Iterable<unknown> };
  if (typeof mapLike.keys !== "function") return;
  for (const key of mapLike.keys()) {
    if (typeof key === "string") {
      addUniquePath(out, seen, key);
    } else if (key && typeof key === "object" && "path" in key) {
      addUniquePath(out, seen, (key as { path?: unknown }).path);
    }
  }
}

export function readCoreSearchMatchedPaths(app: App): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const leaves = app?.workspace?.getLeavesOfType?.("search") ?? [];

  for (const leaf of leaves) {
    const view = (leaf as unknown as { view?: SearchViewLike } | null | undefined)?.view;
    if (!view || typeof view !== "object") continue;

    try {
      collectLookupKeys(view.dom?.resultDomLookup, out, seen);
      collectLookupKeys(view.resultDomLookup, out, seen);
      const vChildren = view.dom?.vChildren?.children;
      if (Array.isArray(vChildren)) {
        for (const child of vChildren) {
          addUniquePath(out, seen, child?.file?.path);
        }
      }
    } catch {
      // Fall through to DOM inspection when core view internals change.
    }

    if (out.length === 0 && view.containerEl?.querySelectorAll) {
      try {
        const items = view.containerEl.querySelectorAll(".tree-item-self");
        const vaultFiles = app?.vault?.getFiles?.() ?? [];
        for (const item of items) {
          const dataPath = item.getAttribute?.("data-path");
          if (dataPath) {
            addUniquePath(out, seen, dataPath);
            continue;
          }
          const titleEl = item.querySelector?.(".search-result-file-title") ?? item;
          const label = titleEl?.textContent?.trim();
          if (!label) continue;
          const dest = app?.metadataCache?.getFirstLinkpathDest?.(label, "");
          if (dest?.path) {
            addUniquePath(out, seen, dest.path);
            continue;
          }
          const byName = vaultFiles.find(
            (f) => f.path === label || f.name === label || f.basename === label,
          );
          if (byName) addUniquePath(out, seen, byName.path);
        }
      } catch {
        // Ignore DOM read failures cleanly.
      }
    }
  }

  return out;
}

export function readCoreSearchQuery(app: App): string {
  const leaves = app?.workspace?.getLeavesOfType?.("search") ?? [];
  for (const leaf of leaves) {
    const view = (leaf as unknown as { view?: SearchViewLike } | null | undefined)?.view;
    if (!view) continue;
    try {
      const val = view.searchComponent?.getValue?.();
      if (typeof val === "string" && val.trim()) return val.trim();
      const inputVal = view.containerEl?.querySelector?.('input[type="search"]')?.value;
      if (typeof inputVal === "string" && inputVal.trim()) return inputVal.trim();
    } catch {
      // Ignore query inspection failure.
    }
  }
  return "";
}
