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
import { isVaultFile } from "./ir/vault-file";
import { computeNeuralActivation, elementIdForNotePath, NEURAL_MAX_QUEUE } from "./ir/neural";

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
  seedNotePath: string | null
): ReviewSlot[] {
  // Prefer the element that *is* the note. Seeding the path at score 1
  // puts every occupant at 0.5, so a hotter extract on the same file
  // sorts ahead of the topic the user opened.
  let elementId = seedElementId;
  let notePath = seedNotePath;
  if (!elementId && notePath) {
    elementId = elementIdForNotePath(state, notePath);
    if (elementId) notePath = null;
  }
  const scores = computeNeuralActivation(app, state, elementId, notePath);
  
  const entries: (QueueEntry & { score: number })[] = [];
  for (const [id, score] of Object.entries(scores)) {
    const el = state.elements.get(id as ElementId);
    if (!el || el.dismissed) continue;
    
    entries.push({
      id: el.id,
      type: el.type,
      priority: el.priority,
      dueMs: dueMsOf(el),
      dismissed: el.dismissed,
      score
    });
  }
  
  entries.sort((a, b) => b.score - a.score || a.priority - b.priority);
  
  const slots: ReviewSlot[] = [];
  for (const entry of entries) {
    const el = state.elements.get(entry.id as ElementId)!;
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
