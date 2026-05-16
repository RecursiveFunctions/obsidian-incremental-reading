/**
 * Cloze deletion format.
 *
 * One Anki-compatible syntax, defined in exactly one place so the writer
 * (extract/cloze creation) and the future reader (Review UI) cannot drift:
 *
 *     {{c1::hidden answer}}
 *
 * The numbered group supports multiple deletions per note later without a
 * format change.
 */

/** Wrap `answer` as cloze group `n` (defaults to 1). */
export function wrapCloze(answer: string, n = 1): string {
  return `{{c${n}::${answer}}}`;
}

/** Global matcher for cloze spans; capture group 1 is the hidden answer. */
export const CLOZE_RE = /\{\{c(\d+)::([\s\S]*?)\}\}/g;

/** True if `text` contains at least one cloze deletion. */
export function hasCloze(text: string): boolean {
  CLOZE_RE.lastIndex = 0;
  return CLOZE_RE.test(text);
}
