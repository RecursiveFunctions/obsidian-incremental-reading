/**
 * The review loop: find what is due, show it one element at a time, and
 * reschedule it.
 *
 * Source of truth is the plugin-owned store (Option 1, docs/DESIGN.md): the
 * queue is built from the folded event log, and every review action appends
 * an event. Frontmatter is *also* written on each action so the migration
 * fallback stays intact and a user can still read state in the note until
 * cutover is confirmed; nothing here ever reads frontmatter to decide the
 * queue.
 *
 * Two element classes, two models, matching SuperMemo:
 *
 *  - Items (cloze) are *recall tested*. Reveal the answer, then grade
 *    Again/Hard/Good/Easy; FSRS reschedules from the grade.
 *  - Topics and extracts are *read*, never graded. You press Next and the
 *    topic schedule stretches the interval by its A-Factor. "Later today"
 *    postpones without advancing; Dismiss holds it out of the queue.
 *
 * Priority (the SuperMemo 0-100 percentile that orders the queue) is editable
 * inline on every element, since reordering is a constant part of the flow.
 *
 * In-place editing and child-note creation are also first-class: topics and
 * extracts open as rendered markdown; **Edit** swaps in a textarea over the
 * preview. Text can be selected in either mode for extract/cloze (preview
 * selection maps back to the markdown source when possible), and edits
 * auto-save when the card advances. For cloze items, edit/extract/cloze are
 * gated until the answer is revealed, because the raw body is the answer.
 */

import type { App, TFile } from "obsidian";
import { interleavedQueue, type QueueEntry } from "./queue";
import type { LogState } from "./ir/log";
import type { IrElement } from "./ir/model";
import type { ElementId } from "./ir/ids";
import { dueMsOf } from "./ir/queue-adapter";
import { elementIdForNotePath, neuralWalk, NEURAL_MAX_QUEUE } from "./ir/neural";
import {
  buildNeuralAdjacency,
  neighborsForWalk,
  type NoteLinkIndex,
} from "./ir/neural-graph";
import { isVaultFile } from "./ir/vault-file";

/**
 * One element scheduled into the session: its current store state plus the
 * vault note that renders it (absent if the source note was removed; the
 * element survives on its stored text).
 */
export interface ReviewSlot {
  id: ElementId;
  element: IrElement;
  file: TFile | null;
}

/**
 * The interleaved daily session, due now. Adapts the folded store state into
 * plain `QueueEntry` records and delegates ordering to the pure, unit-tested
 * `interleavedQueue`. The store is the only source consulted.
 */
export function dueQueue(
  app: App,
  reviewsPerReading: number,
  state: LogState,
  now: Date = new Date(),
  interleaveSimilarPriority = true,
): ReviewSlot[] {
  const slots = new Map<string, ReviewSlot>();
  const entries: QueueEntry[] = [];

  for (const el of state.elements.values()) {
    let file: TFile | null = null;
    if (el.notePath) {
      const af = app.vault.getAbstractFileByPath(el.notePath);
      file = isVaultFile(af) ? af : null;
    }
    // Drop elements with no reviewable body: their `notePath` no longer
    // resolves (deleted/renamed/synced away) AND no `text` snapshot was
    // captured. Without this filter the review surface shows "the source
    // note for this element is no longer in the vault" with no way to act
    // on it. The element stays in the store, so if the file ever reappears
    // at its old path (Sync, trash restore) the next build picks it up.
    if (!file && !el.text) continue;
    slots.set(el.id, { id: el.id, element: el, file });
    entries.push({
      id: el.id,
      type: el.type,
      priority: el.priority,
      dueMs: dueMsOf(el),
      dismissed: el.dismissed,
    });
  }

  return interleavedQueue(entries, reviewsPerReading, now.getTime(), {
    interleaveSimilarPriority,
  })
    .map((id) => slots.get(id))
    .filter((s): s is ReviewSlot => s !== undefined);
}

/** Neural review is SuperMemo-style subset review: real reps, not due-gated. */
export function neuralQueue(
  app: App,
  state: LogState,
  seedElementId: ElementId | null,
  seedNotePath: string | null,
  random?: () => number,
): ReviewSlot[] {
  let elementId = seedElementId;
  let notePath = seedNotePath;
  if (!elementId && notePath) {
    elementId = elementIdForNotePath(state, notePath);
    if (elementId) notePath = null;
  }
  if (!elementId && notePath) {
    // Unmarked note: walk from every IR occupant of that path, if any.
    // With none, there is no seed.
    return [];
  }
  if (!elementId) return [];

  const adj = buildNeuralAdjacency(state, obsidianLinkIndex(app));
  const ids = neuralWalk({
    seed: elementId,
    priorityOf: (id) => state.elements.get(id as ElementId)?.priority ?? 50,
    neighbors: (id) => neighborsForWalk(adj, id),
    dismissed: (id) => state.elements.get(id as ElementId)?.dismissed === true,
    maxQueue: NEURAL_MAX_QUEUE,
    random,
  });

  const slots: ReviewSlot[] = [];
  for (const id of ids) {
    const el = state.elements.get(id as ElementId);
    if (!el) continue;
    let file: TFile | null = null;
    if (el.notePath) {
      const af = app.vault.getAbstractFileByPath(el.notePath);
      file = isVaultFile(af) ? af : null;
    }
    if (!file && !el.text) continue;
    slots.push({ id: el.id, element: el, file });
    if (slots.length >= NEURAL_MAX_QUEUE) break;
  }
  return slots;
}

function obsidianLinkIndex(app: App): NoteLinkIndex {
  const resolved = app.metadataCache.resolvedLinks ?? {};
  const incoming = new Map<string, string[]>();
  for (const src of Object.keys(resolved)) {
    for (const dest of Object.keys(resolved[src] ?? {})) {
      const list = incoming.get(dest) ?? [];
      list.push(src);
      incoming.set(dest, list);
    }
  }
  return {
    outgoing(path: string): readonly string[] {
      const file = app.vault.getAbstractFileByPath(path);
      if (!isVaultFile(file)) {
        return Object.keys(resolved[path] ?? {});
      }
      const cache = app.metadataCache.getFileCache(file);
      const out: string[] = [];
      const seen = new Set<string>();
      if (cache?.links) {
        for (const link of cache.links) {
          const dest = app.metadataCache.getFirstLinkpathDest(link.link, file.path);
          if (dest && !seen.has(dest.path)) {
            seen.add(dest.path);
            out.push(dest.path);
          }
        }
      }
      return out.length > 0 ? out : Object.keys(resolved[path] ?? {});
    },
    incoming(path: string): readonly string[] {
      return incoming.get(path) ?? [];
    },
    tags(_path: string): readonly string[] {
      return [];
    },
  };
}
