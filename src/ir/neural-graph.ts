/**
 * Build the neural-review adjacency list from the IR element tree plus a
 * note-link index (wikilinks / backlinks / tags). No Obsidian imports.
 */

import type { IrElement } from "./model";
import type { LogState } from "./log";
import type { ElementId } from "./ids";
import {
  GROUP_P,
  WIKILINK_DEGREE_CAP,
  capWikilinkNeighbors,
  type NeuralNeighbor,
} from "./neural";

export interface NoteLinkIndex {
  outgoing(path: string): readonly string[];
  incoming(path: string): readonly string[];
  tags(path: string): readonly string[];
}

export type NeuralAdjacency = Map<string, NeuralNeighbor[]>;

export function emptyLinkIndex(): NoteLinkIndex {
  return {
    outgoing: () => [],
    incoming: () => [],
    tags: () => [],
  };
}

/**
 * Undirected adjacency: tree (parent/child/sibling) plus wikilinks between
 * IR notes, including a single unmarked-note relay so A → Bridge → B
 * still connects A and B.
 */
export function buildNeuralAdjacency(
  state: LogState,
  links: NoteLinkIndex,
  opts?: { useTags?: boolean; tagDegreeCap?: number },
): NeuralAdjacency {
  const adj: NeuralAdjacency = new Map();
  const add = (from: string, to: string, groupP: number) => {
    if (from === to) return;
    const list = adj.get(from) ?? [];
    const existing = list.find((n) => n.id === to);
    if (existing) {
      if (groupP < existing.groupP) existing.groupP = groupP;
      return;
    }
    list.push({ id: to, groupP });
    adj.set(from, list);
  };
  const addUndirected = (a: string, b: string, groupP: number) => {
    add(a, b, groupP);
    add(b, a, groupP);
  };

  const elements = [...state.elements.values()];
  const byNote = new Map<string, IrElement[]>();
  const irNotePaths = new Set<string>();
  const childrenByParent = new Map<string, IrElement[]>();

  for (const el of elements) {
    if (el.notePath) {
      irNotePaths.add(el.notePath);
      push(byNote, el.notePath, el);
    }
    if (el.anchor?.sourcePath) {
      irNotePaths.add(el.anchor.sourcePath);
      push(byNote, el.anchor.sourcePath, el);
    }
    if (el.parentId) push(childrenByParent, el.parentId, el);
  }

  for (const el of elements) {
    if (el.parentId && state.elements.has(el.parentId as ElementId)) {
      const parent = state.elements.get(el.parentId as ElementId)!;
      const parentP = parent.parentId === null ? GROUP_P.rootParent : GROUP_P.parent;
      add(el.id, parent.id, parentP);
      add(parent.id, el.id, GROUP_P.child);
    }
  }

  for (const siblings of childrenByParent.values()) {
    const sorted = [...siblings].sort(
      (a, b) => a.priority - b.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    const n = sorted.length;
    if (n < 2) continue;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dist = j - i;
        const groupP =
          GROUP_P.sibling +
          (dist / Math.max(n - 1, 1)) * (GROUP_P.siblingFar - GROUP_P.sibling);
        addUndirected(sorted[i]!.id, sorted[j]!.id, groupP);
      }
    }
  }

  for (const occupants of byNote.values()) {
    if (occupants.length < 2) continue;
    for (let i = 0; i < occupants.length; i++) {
      for (let j = i + 1; j < occupants.length; j++) {
        addUndirected(occupants[i]!.id, occupants[j]!.id, GROUP_P.child);
      }
    }
  }

  for (const el of elements) {
    const path = el.notePath;
    if (!path) continue;
    const neighborNotes = linkedIrNotes(path, links, irNotePaths);
    const capped = capWikilinkNeighbors(neighborNotes, irNotePaths, WIKILINK_DEGREE_CAP);
    for (const destPath of capped) {
      for (const dest of byNote.get(destPath) ?? []) {
        if (dest.notePath === destPath) {
          addUndirected(el.id, dest.id, GROUP_P.wikilink);
        }
      }
    }
  }

  if (opts?.useTags) {
    const cap = opts.tagDegreeCap ?? 40;
    const byTag = new Map<string, IrElement[]>();
    for (const el of elements) {
      if (!el.notePath) continue;
      for (const tag of links.tags(el.notePath)) {
        push(byTag, tag, el);
      }
    }
    for (const members of byTag.values()) {
      if (members.length < 2 || members.length > cap) continue;
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          addUndirected(members[i]!.id, members[j]!.id, GROUP_P.tag);
        }
      }
    }
  }

  return adj;
}

/** Wikilink degree is capped per node at walk time so a MOC does not dump the vault, while a spoke can still reach the hub. */
export function neighborsForWalk(
  adj: NeuralAdjacency,
  id: string,
): NeuralNeighbor[] {
  const all = adj.get(id) ?? [];
  const wiki: NeuralNeighbor[] = [];
  const rest: NeuralNeighbor[] = [];
  for (const n of all) {
    (n.groupP === GROUP_P.wikilink ? wiki : rest).push(n);
  }
  wiki.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return rest.concat(wiki.slice(0, WIKILINK_DEGREE_CAP));
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const arr = map.get(key);
  if (arr) arr.push(value);
  else map.set(key, [value]);
}

function allNeighbors(path: string, links: NoteLinkIndex): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of [...links.outgoing(path), ...links.incoming(path)]) {
    if (p === path || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

/** Direct IR neighbors plus IR notes one unmarked hop away. */
function linkedIrNotes(
  path: string,
  links: NoteLinkIndex,
  irNotePaths: Set<string>,
): string[] {
  const out = new Set<string>();
  for (const n of allNeighbors(path, links)) {
    if (irNotePaths.has(n)) {
      out.add(n);
      continue;
    }
    for (const n2 of allNeighbors(n, links)) {
      if (n2 !== path && irNotePaths.has(n2)) out.add(n2);
    }
  }
  return [...out];
}
