import type { App } from "obsidian";
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

  // Initialize queue for BFS
  const queue: { type: "element" | "note"; id: string; score: number; depth: number }[] = [];

  if (seedElementId) {
    queue.push({ type: "element", id: seedElementId, score: 1.0, depth: 0 });
  }
  if (seedNotePath) {
    queue.push({ type: "note", id: seedNotePath, score: 1.0, depth: 0 });
  }

  while (queue.length > 0) {
    const { type, id, score, depth } = queue.shift()!;

    if (depth > MAX_DEPTH || score < 0.05) continue;

    if (type === "element") {
      if ((activeElements.get(id) ?? 0) >= score) continue;
      activeElements.set(id, score);
      scores[id] = score;

      const element = state.elements.get(id as ElementId);
      if (!element) continue;

      // Spread to parent
      if (element.parentId) {
        queue.push({ type: "element", id: element.parentId, score: score * DECAY, depth: depth + 1 });
      }

      // Spread to children
      for (const [childId, child] of state.elements) {
        if (child.parentId === id) {
          queue.push({ type: "element", id: childId, score: score * DECAY, depth: depth + 1 });
        }
      }

      // Spread to note
      if (element.notePath) {
        queue.push({ type: "note", id: element.notePath, score: score * DECAY, depth: depth + 1 });
      } else if (element.anchor?.sourcePath) {
        queue.push({ type: "note", id: element.anchor.sourcePath, score: score * DECAY, depth: depth + 1 });
      }
    } else if (type === "note") {
      if ((activeNotes.get(id) ?? 0) >= score) continue;
      activeNotes.set(id, score);

      // Spread to elements anchored to this note
      for (const [elementId, element] of state.elements) {
        if (element.notePath === id || element.anchor?.sourcePath === id) {
          queue.push({ type: "element", id: elementId, score: score * DECAY, depth: depth + 1 });
        }
      }

      // Spread to linked notes
      const file = app.vault.getAbstractFileByPath(id);
      if (isVaultFile(file)) {
        // Forward links
        const cache = app.metadataCache.getFileCache(file);
        if (cache?.links) {
          for (const link of cache.links) {
            const dest = app.metadataCache.getFirstLinkpathDest(link.link, file.path);
            if (dest) {
              queue.push({ type: "note", id: dest.path, score: score * DECAY, depth: depth + 1 });
            }
          }
        }
        
        // Backlinks
        const resolved = app.metadataCache.resolvedLinks;
        for (const sourcePath in resolved) {
          if (resolved[sourcePath][file.path]) {
            queue.push({ type: "note", id: sourcePath, score: score * DECAY, depth: depth + 1 });
          }
        }
      }
    }
  }

  return scores;
}
