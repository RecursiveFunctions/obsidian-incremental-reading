import type { App, TFile } from "obsidian";
import type { LogState } from "./log";
import type { ElementId } from "./ids";
import { isVaultFile } from "./vault-file";

/**
 * Map a vault note to the IR element that *is* that note (topic or
 * promoted extract/item), not extracts merely anchored in it.
 *
 * Prefer a topic when several elements share the path. Returns null when
 * the note is not itself an IR element — callers may still walk from the
 * path as a note seed.
 */
export function elementIdForNotePath(
  state: LogState,
  notePath: string,
): ElementId | null {
  let fallback: ElementId | null = null;
  for (const el of state.elements.values()) {
    if (el.notePath !== notePath || el.dismissed) continue;
    if (el.type === "topic") return el.id;
    if (fallback === null) fallback = el.id;
  }
  return fallback;
}

// Spreading activation parameters
const DECAY = 0.5; // Each step halves the activation
const MAX_DEPTH = 3;
/** Unmarked notes may relay once without spending a neural layer. */
const MAX_RELAYS = 1;
/** Keep a MOC from dumping the vault into layer 1. */
export const WIKILINK_DEGREE_CAP = 12;
/** SuperMemo caps the neural queue at a few hundred. */
export const NEURAL_MAX_QUEUE = 200;

interface NeuralHop {
  type: "element" | "note";
  id: string;
  score: number;
  depth: number;
  relays: number;
}

function linkedNotePaths(app: App, file: TFile): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (p: string) => {
    if (p === file.path || seen.has(p)) return;
    seen.add(p);
    out.push(p);
  };
  const cache = app.metadataCache.getFileCache(file);
  if (cache?.links) {
    for (const link of cache.links) {
      const dest = app.metadataCache.getFirstLinkpathDest(link.link, file.path);
      if (dest) add(dest.path);
    }
  }
  const resolved = app.metadataCache.resolvedLinks;
  for (const sourcePath in resolved) {
    if (resolved[sourcePath][file.path]) add(sourcePath);
  }
  return out;
}

/** IR neighbors first, then unmarked relays, truncated to the degree cap. */
export function capWikilinkNeighbors(
  neighbors: string[],
  irNotePaths: Set<string>,
  cap: number = WIKILINK_DEGREE_CAP,
): string[] {
  const ir: string[] = [];
  const rest: string[] = [];
  for (const p of neighbors) {
    (irNotePaths.has(p) ? ir : rest).push(p);
  }
  return ir.concat(rest).slice(0, cap);
}
function enqueueLinkedNote(
  queue: NeuralHop[],
  path: string,
  score: number,
  depth: number,
  relays: number,
  irNotePaths: Set<string>,
): void {
  const isIr = irNotePaths.has(path);
  if (isIr) {
    queue.push({
      type: "note",
      id: path,
      score: score * DECAY,
      depth: depth + 1,
      relays,
    });
    return;
  }
  if (relays >= MAX_RELAYS) return;
  queue.push({
    type: "note",
    id: path,
    score,
    depth,
    relays: relays + 1,
  });
}

export interface NeuralScores {
  [elementId: string]: number;
}

export function computeNeuralActivation(
  app: App,
  state: LogState,
  seedElementId: ElementId | null,
  seedNotePath: string | null
): NeuralScores {
  const scores: NeuralScores = {};
  const activeNotes = new Map<string, number>();
  const activeElements = new Map<string, number>();

  const irNotePaths = new Set<string>();
  for (const el of state.elements.values()) {
    if (el.notePath) irNotePaths.add(el.notePath);
    if (el.anchor?.sourcePath) irNotePaths.add(el.anchor.sourcePath);
  }

  // Initialize queue for BFS. `relays` counts unmarked notes traversed
  // without spending a layer, so A → Bridge.md → B still reaches B.
  const queue: NeuralHop[] = [];

  if (seedElementId) {
    queue.push({ type: "element", id: seedElementId, score: 1.0, depth: 0, relays: 0 });
  }
  if (seedNotePath) {
    queue.push({ type: "note", id: seedNotePath, score: 1.0, depth: 0, relays: 0 });
  }

  while (queue.length > 0) {
    const { type, id, score, depth, relays } = queue.shift()!;

    if (depth > MAX_DEPTH || score < 0.05) continue;

    if (type === "element") {
      if ((activeElements.get(id) ?? 0) >= score) continue;
      activeElements.set(id, score);
      scores[id] = score;
      if (Object.keys(scores).length >= NEURAL_MAX_QUEUE) break;
      if (Object.keys(scores).length >= NEURAL_MAX_QUEUE) break;

      const element = state.elements.get(id as ElementId);
      if (!element) continue;

      // Spread to parent
      if (element.parentId) {
        queue.push({
          type: "element",
          id: element.parentId,
          score: score * DECAY,
          depth: depth + 1,
          relays,
        });
      }

      // Spread to children
      for (const [childId, child] of state.elements) {
        if (child.parentId === id) {
          queue.push({
            type: "element",
            id: childId,
            score: score * DECAY,
            depth: depth + 1,
            relays,
          });
        }
      }

      // Spread to note
      const noteId = element.notePath ?? element.anchor?.sourcePath;
      if (noteId) {
        queue.push({
          type: "note",
          id: noteId,
          score: score * DECAY,
          depth: depth + 1,
          relays,
        });
      }
    } else if (type === "note") {
      if ((activeNotes.get(id) ?? 0) >= score) continue;
      activeNotes.set(id, score);

      // Spread to elements anchored to this note
      for (const [elementId, element] of state.elements) {
        if (element.notePath === id || element.anchor?.sourcePath === id) {
          queue.push({
            type: "element",
            id: elementId,
            score: score * DECAY,
            depth: depth + 1,
            relays,
          });
        }
      }

      // Spread to linked notes
      const file = app.vault.getAbstractFileByPath(id);
      if (isVaultFile(file)) {
        const neighbors = linkedNotePaths(app, file);
        const capped = capWikilinkNeighbors(neighbors, irNotePaths);
        for (const path of capped) {
          enqueueLinkedNote(queue, path, score, depth, relays, irNotePaths);
        }
      }
    }
  }

  return scores;
}
